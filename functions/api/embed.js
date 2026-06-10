let lexiconPromise = null;
const shardPromises = new Map();

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON request body." }, 400);
  }

  const words = Array.isArray(body.words) ? body.words : [body.word];
  const normalizedWords = [...new Set(words.map(normalizeTerm).filter(Boolean))];
  if (normalizedWords.length === 0 || normalizedWords.length > 12) {
    return json({ error: "Send 1 to 12 words." }, 400);
  }

  const badShape = normalizedWords.find((word) => !isWordShape(word));
  if (badShape) {
    return json({ error: `"${badShape}" is not a valid game word shape.` }, 422);
  }

  let lexicon;
  try {
    lexicon = await loadLexicon(env, request.url);
  } catch (error) {
    return json({ error: error.message || "Vector data is not available." }, 500);
  }

  const missing = normalizedWords.find((word) => !lexicon.wordIndex.has(word));
  if (missing) {
    return json({ error: `"${missing}" is not in the game dictionary.` }, 422);
  }

  const vectors = {};
  try {
    for (const word of normalizedWords) {
      vectors[word] = Array.from(await getVector(env, request.url, lexicon, word));
    }
  } catch (error) {
    return json({ error: error.message || "Vector data is not available." }, 500);
  }

  if (normalizedWords.length === 1) {
    return json({ word: normalizedWords[0], vector: vectors[normalizedWords[0]] });
  }
  return json({ vectors });
}

export function onRequestGet() {
  return json({ ok: true, route: "/api/embed" });
}

function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function isWordShape(word) {
  return /^[a-z]{2,15}$/.test(word);
}

async function loadLexicon(env, requestUrl) {
  lexiconPromise ||= fetchAssetJson(env, requestUrl, "/data/lexicon.json").then(
    (data) => {
      if (
        !Number.isInteger(data.dim) ||
        !Number.isInteger(data.shardSize) ||
        !Array.isArray(data.words) ||
        !Array.isArray(data.shards) ||
        data.shards.length !== Math.ceil(data.words.length / data.shardSize)
      ) {
        throw new Error("Vector metadata does not match the word table.");
      }
      return {
        dim: data.dim,
        shardSize: data.shardSize,
        shards: data.shards,
        wordCount: data.words.length,
        wordIndex: new Map(data.words.map((word, index) => [word, index])),
      };
    },
  );
  return lexiconPromise;
}

async function getVector(env, requestUrl, lexicon, word) {
  const index = lexicon.wordIndex.get(word);
  if (!Number.isInteger(index) || index < 0 || index >= lexicon.wordCount) {
    throw new Error(`Vector index for "${word}" is not valid.`);
  }
  const shardIndex = Math.floor(index / lexicon.shardSize);
  const shardPath = lexicon.shards[shardIndex];
  if (!shardPath) {
    throw new Error(`Vector shard ${shardIndex} is not loaded.`);
  }
  const shard = await loadShard(env, requestUrl, shardPath);
  const rowStart = (index % lexicon.shardSize) * lexicon.dim;
  const rowEnd = rowStart + lexicon.dim;
  if (rowEnd > shard.length) {
    throw new Error(`Vector row for "${word}" is outside shard ${shardIndex}.`);
  }
  return shard.subarray(rowStart, rowEnd);
}

async function loadShard(env, requestUrl, path) {
  if (!shardPromises.has(path)) {
    shardPromises.set(
      path,
      fetchAssetBuffer(env, requestUrl, `/${path}`).then((buffer) => new Float32Array(buffer)),
    );
  }
  return shardPromises.get(path);
}

async function fetchAssetJson(env, requestUrl, path) {
  return JSON.parse(await fetchAssetText(env, requestUrl, path));
}

async function fetchAssetText(env, requestUrl, path) {
  const url = new URL(path, requestUrl);
  const response = await env.ASSETS.fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Could not load asset ${path}: ${response.status}`);
  }
  return response.text();
}

async function fetchAssetBuffer(env, requestUrl, path) {
  const url = new URL(path, requestUrl);
  const response = await env.ASSETS.fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Could not load asset ${path}: ${response.status}`);
  }
  return response.arrayBuffer();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
