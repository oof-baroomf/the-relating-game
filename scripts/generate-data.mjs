import { mkdir, rm, writeFile } from "node:fs/promises";
import winkEmbeddings from "wink-embeddings-small-en-50d";

const ENABLE_URL =
  "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";
const FREQUENCY_URL =
  "https://raw.githubusercontent.com/possibly-wrong/word-frequency/main/word-frequency.txt";

const OUT_DIR = new URL("../public/data/", import.meta.url);
const DIM = 50;
const SCALE = 127;
const MAX_SUBWORDS = 60000;
const COMMON_ENDPOINT_EXCLUSION = 400000;
const MIN_NGRAM = 3;
const MAX_NGRAM = 6;

const embeddings = winkEmbeddings.default || winkEmbeddings.embeddings || winkEmbeddings;

function cleanWord(word) {
  return word.normalize("NFKC").trim().toLowerCase();
}

function isDictionaryWord(word) {
  return /^[a-z]{2,15}$/.test(word);
}

function isEndpointWord(word) {
  return /^[a-z]{3,12}$/.test(word);
}

function normalizeVector(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  const divisor = Math.sqrt(norm) || 1;
  return vector.map((value) => value / divisor);
}

function quantizeVector(vector) {
  return vector.map((value) =>
    Math.max(-127, Math.min(127, Math.round(value * SCALE))),
  );
}

function encodeInt8(rows) {
  const bytes = new Int8Array(rows.length * DIM);
  rows.forEach((row, rowIndex) => {
    bytes.set(row, rowIndex * DIM);
  });
  return Buffer.from(bytes.buffer).toString("base64");
}

function ngramsFor(word) {
  const source = `<${word}>`;
  const grams = [];
  for (let size = MIN_NGRAM; size <= MAX_NGRAM; size += 1) {
    for (let index = 0; index <= source.length - size; index += 1) {
      grams.push(source.slice(index, index + size));
    }
  }
  return grams;
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addHashedGram(vector, gram) {
  for (let index = 0; index < vector.length; index += 1) {
    const hash = hashString(`${gram}:${index}`);
    vector[index] += ((hash % 2001) - 1000) / 1000;
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function main() {
  const [dictionaryText, frequencyText] = await Promise.all([
    fetchText(ENABLE_URL),
    fetchText(FREQUENCY_URL),
  ]);

  const dictionaryWords = [...new Set(
    dictionaryText
      .split(/\r?\n/)
      .map(cleanWord)
      .filter(isDictionaryWord),
  )].sort();
  const dictionarySet = new Set(dictionaryWords);
  const commonWords = new Set(
    frequencyText
      .split(/\r?\n/)
      .slice(0, COMMON_ENDPOINT_EXCLUSION)
      .map((line) => cleanWord(line.split("\t")[0] || ""))
      .filter(isDictionaryWord),
  );

  const rankedDirectEntries = Object.entries(embeddings)
    .map(([word, vector]) => [cleanWord(word), vector])
    .filter(
      ([word, vector]) =>
        isDictionaryWord(word) &&
        dictionarySet.has(word) &&
        Array.isArray(vector) &&
        vector.length === DIM,
    )
    .map(([word, vector]) => [word, normalizeVector(vector)]);

  const directEntries = [...rankedDirectEntries]
    .sort(([left], [right]) => left.localeCompare(right));

  const endpointWords = dictionaryWords
    .filter(isEndpointWord)
    .filter((word) => !commonWords.has(word));

  const gramCounts = new Map();
  for (const [word] of directEntries) {
    for (const gram of new Set(ngramsFor(word))) {
      gramCounts.set(gram, (gramCounts.get(gram) || 0) + 1);
    }
  }

  const selectedGrams = [...gramCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_SUBWORDS)
    .map(([gram]) => gram)
    .sort();
  const selectedGramSet = new Set(selectedGrams);
  const gramSums = new Map(selectedGrams.map((gram) => [gram, new Array(DIM).fill(0)]));
  const gramUseCounts = new Map(selectedGrams.map((gram) => [gram, 0]));

  for (const [word, vector] of directEntries) {
    for (const gram of new Set(ngramsFor(word))) {
      if (!selectedGramSet.has(gram)) continue;
      const sum = gramSums.get(gram);
      for (let index = 0; index < DIM; index += 1) {
        sum[index] += vector[index];
      }
      gramUseCounts.set(gram, gramUseCounts.get(gram) + 1);
    }
  }

  const gramRows = selectedGrams.map((gram) => {
    const count = gramUseCounts.get(gram) || 1;
    const average = gramSums.get(gram).map((value) => value / count);
    return quantizeVector(normalizeVector(average));
  });
  const gramIndex = new Map(selectedGrams.map((gram, index) => [gram, index]));

  function embedEndpoint(word) {
    const vector = new Array(DIM).fill(0);
    let count = 0;
    const grams = ngramsFor(word);

    for (const gram of grams) {
      const rowIndex = gramIndex.get(gram);
      if (rowIndex === undefined) continue;
      const row = gramRows[rowIndex];
      for (let index = 0; index < DIM; index += 1) {
        vector[index] += row[index] / SCALE;
      }
      count += 1;
    }

    if (count === 0) {
      for (const gram of grams) {
        addHashedGram(vector, gram);
        count += 1;
      }
    }

    for (let index = 0; index < DIM; index += 1) {
      vector[index] /= count;
    }
    return quantizeVector(normalizeVector(vector));
  }

  const directWords = directEntries.map(([word]) => word);
  const directRows = directEntries.map(([, vector]) => quantizeVector(vector));
  const endpointRows = endpointWords.map(embedEndpoint);

  await mkdir(OUT_DIR, { recursive: true });
  await rm(new URL("nouns.txt", OUT_DIR), { force: true });

  await writeFile(
    new URL("dictionary.txt", OUT_DIR),
    `${dictionaryWords.join("\n")}\n`,
  );
  await writeFile(
    new URL("endpoints.json", OUT_DIR),
    `${JSON.stringify({
      dim: DIM,
      scale: SCALE,
      source: "generated subword vectors for frequency-filtered endpoints",
      words: endpointWords,
      vectors: encodeInt8(endpointRows),
    })}\n`,
  );
  await writeFile(
    new URL("embeddings.json", OUT_DIR),
    `${JSON.stringify({
      dim: DIM,
      scale: SCALE,
      source: "wink-embeddings-small-en-50d",
      words: directWords,
      vectors: encodeInt8(directRows),
    })}\n`,
  );
  await writeFile(
    new URL("subword.json", OUT_DIR),
    `${JSON.stringify({
      dim: DIM,
      scale: SCALE,
      minN: MIN_NGRAM,
      maxN: MAX_NGRAM,
      source: "fastText-style character n-gram averages over cached embeddings",
      grams: selectedGrams,
      vectors: encodeInt8(gramRows),
    })}\n`,
  );
  await writeFile(
    new URL("manifest.json", OUT_DIR),
    `${JSON.stringify(
      {
        dictionaryWords: dictionaryWords.length,
        cachedWords: directWords.length,
        endpointWords: endpointWords.length,
        commonEndpointExclusion: COMMON_ENDPOINT_EXCLUSION,
        frequencySource: FREQUENCY_URL,
        subwords: selectedGrams.length,
        dim: DIM,
        dictionarySource: ENABLE_URL,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        dictionaryWords: dictionaryWords.length,
        cachedWords: directWords.length,
        endpointWords: endpointWords.length,
        commonEndpointExclusion: COMMON_ENDPOINT_EXCLUSION,
        commonWords: commonWords.size,
        subwords: selectedGrams.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
