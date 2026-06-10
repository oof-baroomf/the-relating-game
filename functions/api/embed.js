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

  const lexicon = await loadLexicon(env, request.url);
  const missing = normalizedWords.find((word) => !lexicon.wordIndex.has(word));
  if (missing) {
    return json({ error: `"${missing}" is not in the game dictionary.` }, 422);
  }

  const vectors = {};
  for (const word of normalizedWords) {
    vectors[word] = Array.from(await getVector(env, request.url, lexicon, word));
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
    (data) => ({
      dim: data.dim,
      shardSize: data.shardSize,
      shards: data.shards,
      wordIndex: new Map(data.words.map((word, index) => [word, index])),
    }),
  );
  return lexiconPromise;
}

async function getVector(env, requestUrl, lexicon, word) {
  const index = lexicon.wordIndex.get(word);
  const shardIndex = Math.floor(index / lexicon.shardSize);
  const shard = await loadShard(env, requestUrl, lexicon.shards[shardIndex]);
  const rowStart = (index % lexicon.shardSize) * lexicon.dim;
  return shard.subarray(rowStart, rowStart + lexicon.dim);
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
