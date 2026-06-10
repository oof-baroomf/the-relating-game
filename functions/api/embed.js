let dictionaryPromise = null;
let subwordPromise = null;

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

  const [dictionary, model] = await Promise.all([
    loadDictionary(env, request.url),
    loadSubwordModel(env, request.url),
  ]);

  const missing = normalizedWords.find((word) => !dictionary.has(word));
  if (missing) {
    return json({ error: `"${missing}" is not in the game dictionary.` }, 422);
  }

  const vectors = {};
  for (const word of normalizedWords) {
    vectors[word] = embedWithSubwords(word, model);
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

async function loadDictionary(env, requestUrl) {
  dictionaryPromise ||= fetchAssetText(env, requestUrl, "/data/dictionary.txt").then(
    (text) => new Set(text.split(/\r?\n/).filter(Boolean)),
  );
  return dictionaryPromise;
}

async function loadSubwordModel(env, requestUrl) {
  subwordPromise ||= fetchAssetJson(env, requestUrl, "/data/subword.json").then(
    (data) => ({
      dim: data.dim,
      scale: data.scale,
      minN: data.minN,
      maxN: data.maxN,
      grams: new Map(data.grams.map((gram, index) => [gram, index])),
      vectors: decodeBase64Int8(data.vectors),
    }),
  );
  return subwordPromise;
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

function decodeBase64Int8(value) {
  const binary = atob(value);
  const bytes = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function embedWithSubwords(word, model) {
  const vector = new Array(model.dim).fill(0);
  let count = 0;
  const grams = ngramsFor(word, model.minN, model.maxN);

  for (const gram of grams) {
    const rowIndex = model.grams.get(gram);
    if (rowIndex === undefined) continue;
    const rowStart = rowIndex * model.dim;
    for (let index = 0; index < model.dim; index += 1) {
      vector[index] += model.vectors[rowStart + index] / model.scale;
    }
    count += 1;
  }

  if (count === 0) {
    for (const gram of grams) {
      addHashedGram(vector, gram);
      count += 1;
    }
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= count;
  }
  return normalizeVector(vector);
}

function addHashedGram(vector, gram) {
  for (let index = 0; index < vector.length; index += 1) {
    const hash = hashString(`${gram}:${index}`);
    vector[index] += ((hash % 2001) - 1000) / 1000;
  }
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function ngramsFor(word, minN, maxN) {
  const source = `<${word}>`;
  const grams = [];
  for (let size = minN; size <= maxN; size += 1) {
    for (let index = 0; index <= source.length - size; index += 1) {
      grams.push(source.slice(index, index + size));
    }
  }
  return grams;
}

function normalizeVector(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  const divisor = Math.sqrt(norm) || 1;
  return vector.map((value) => Math.round((value / divisor) * 10000) / 10000);
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
