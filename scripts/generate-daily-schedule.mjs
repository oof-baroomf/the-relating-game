import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const START_DATE = "2026-06-10";
const SCHEDULE_DAYS = 3660;
const TARGET_PAIR_GAP = 0.9;
const MIN_PAIR_GAP = 0.86;
const MAX_PAIR_GAP = 0.94;
const MAX_STEPS = 10;
const MODES = {
  easy: { gapDivisor: 1.5 },
  hard: { gapDivisor: 2 },
};
const DAILY_OVERRIDES = new Map([
  ["2026-06-10", ["grove", "iodine"]],
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "src", "shared", "daily-schedule.js");

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function nextRandom() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function dateAfter(startDate, offset) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function dotSimilarity(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function makeVectorStore(lexicon, shardBuffers) {
  const vectorWords = new Map(lexicon.words.map((word, index) => [word, index]));
  const shards = shardBuffers.map(
    (buffer) =>
      new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
      ),
  );

  function getVectorByIndex(index) {
    const shard = shards[Math.floor(index / lexicon.shardSize)];
    const rowStart = (index % lexicon.shardSize) * lexicon.dim;
    return shard.subarray(rowStart, rowStart + lexicon.dim);
  }

  function getVector(word) {
    const index = vectorWords.get(word);
    if (index === undefined) return null;
    return getVectorByIndex(index);
  }

  return {
    words: lexicon.words,
    wordIndex: vectorWords,
    getVector,
    getVectorByIndex,
  };
}

function findRelateBotPath(start, target, gap, mode, vectorStore, blockedWords) {
  const moveLimit = gap / MODES[mode].gapDivisor;
  if (gap <= moveLimit + 0.000001) {
    return [start, target];
  }

  const shortPath = findShortBridgePath(start, target, moveLimit, vectorStore, blockedWords);
  if (shortPath) return shortPath;

  return findGreedyRelateBotPath(start, target, moveLimit, vectorStore, blockedWords);
}

function findShortBridgePath(start, target, moveLimit, vectorStore, blockedWords) {
  const minSimilarity = 1 - moveLimit - 0.000001;
  const startIndex = vectorStore.wordIndex.get(start);
  const targetIndex = vectorStore.wordIndex.get(target);
  if (startIndex === undefined || targetIndex === undefined) return null;

  const startNeighbors = scanNeighborIndices(startIndex, minSimilarity, vectorStore, blockedWords);
  const targetNeighbors = scanNeighborIndices(targetIndex, minSimilarity, vectorStore, blockedWords);
  const targetNeighborSet = new Set(targetNeighbors);

  for (const middle of startNeighbors) {
    if (targetNeighborSet.has(middle)) {
      return [start, vectorStore.words[middle], target];
    }
  }

  for (const left of startNeighbors) {
    const leftVector = vectorStore.getVectorByIndex(left);
    for (const right of targetNeighbors) {
      if (dotSimilarity(leftVector, vectorStore.getVectorByIndex(right)) >= minSimilarity) {
        return [start, vectorStore.words[left], vectorStore.words[right], target];
      }
    }
  }

  return null;
}

function scanNeighborIndices(baseIndex, minSimilarity, vectorStore, blockedWords) {
  const baseVector = vectorStore.getVectorByIndex(baseIndex);
  const neighbors = [];
  for (let index = 0; index < vectorStore.words.length; index += 1) {
    const word = vectorStore.words[index];
    if (
      index !== baseIndex &&
      !blockedWords.has(word) &&
      dotSimilarity(baseVector, vectorStore.getVectorByIndex(index)) >= minSimilarity
    ) {
      neighbors.push(index);
    }
  }
  return neighbors;
}

function findGreedyRelateBotPath(start, target, moveLimit, vectorStore, blockedWords) {
  const path = [start];
  const used = new Set(path);
  const targetVector = vectorStore.getVector(target);
  if (!targetVector) return null;

  while (path.length - 1 < MAX_STEPS) {
    const from = path[path.length - 1];
    const fromVector = vectorStore.getVector(from);
    const currentTargetGap = Math.max(0, 1 - dotSimilarity(fromVector, targetVector));
    if (currentTargetGap <= moveLimit + 0.000001) {
      path.push(target);
      return path;
    }

    let best = null;
    for (let index = 0; index < vectorStore.words.length; index += 1) {
      const word = vectorStore.words[index];
      if (used.has(word) || word === target || blockedWords.has(word)) continue;

      const vector = vectorStore.getVectorByIndex(index);
      const stepGap = Math.max(0, 1 - dotSimilarity(fromVector, vector));
      if (stepGap > moveLimit + 0.000001 || stepGap < 0.01) continue;

      const targetGap = Math.max(0, 1 - dotSimilarity(vector, targetVector));
      if (targetGap < currentTargetGap - 0.01 && (!best || targetGap < best.targetGap)) {
        best = { word, targetGap };
      }
    }

    if (!best) return null;
    path.push(best.word);
    used.add(best.word);
  }

  return null;
}

function buildScheduledPair(dateId, start, target, vectorStore) {
  const gap = 1 - cosineSimilarity(vectorStore.getVector(start), vectorStore.getVector(target));
  if (gap < MIN_PAIR_GAP || gap > MAX_PAIR_GAP) {
    throw new Error(`${dateId} pair is outside the target gap band.`);
  }
  return { date: dateId, start, target, gap: roundScore(gap) };
}

function addCachedPaths(pair, vectorStore, blockedWords) {
  const candidateHardPath = findRelateBotPath(
    pair.start,
    pair.target,
    pair.gap,
    "hard",
    vectorStore,
    blockedWords,
  );
  const hardPath = isValidCachedPath(
    candidateHardPath,
    pair,
    "hard",
    vectorStore,
    blockedWords,
  )
    ? candidateHardPath
    : null;
  const easyPath = hardPath;
  return {
    ...pair,
    easyPath,
    hardPath,
  };
}

function isValidCachedPath(pathValue, pair, mode, vectorStore, blockedWords) {
  if (!Array.isArray(pathValue)) return false;
  if (pathValue.length < 2 || pathValue.length > MAX_STEPS + 1) return false;
  if (pathValue[0] !== pair.start || pathValue[pathValue.length - 1] !== pair.target) {
    return false;
  }
  if (new Set(pathValue).size !== pathValue.length) return false;

  for (const word of pathValue) {
    if (blockedWords.has(word) || !vectorStore.getVector(word)) return false;
  }

  const moveLimit = pair.gap / MODES[mode].gapDivisor;
  for (let index = 1; index < pathValue.length; index += 1) {
    const from = vectorStore.getVector(pathValue[index - 1]);
    const to = vectorStore.getVector(pathValue[index]);
    const stepGap = Math.max(0, 1 - cosineSimilarity(from, to));
    if (stepGap > moveLimit + 0.000001) return false;
  }

  return true;
}

function pickPair(dateId, endpoints, vectorStore, blockedWords) {
  const override = DAILY_OVERRIDES.get(dateId);
  if (override) {
    const [start, target] = override;
    const pair = buildScheduledPair(dateId, start, target, vectorStore);
    const cachedPair = addCachedPaths(pair, vectorStore, blockedWords);
    if (!cachedPair.hardPath) {
      throw new Error(`${dateId} override does not have a hard RelateBot path.`);
    }
    return cachedPair;
  }

  const random = mulberry32(hashString(`date:${dateId}`));
  for (;;) {
    const start = endpoints[Math.floor(random() * endpoints.length)];
    const target = endpoints[Math.floor(random() * endpoints.length)];
    if (start === target) continue;

    const gap = 1 - cosineSimilarity(vectorStore.getVector(start), vectorStore.getVector(target));
    if (gap >= MIN_PAIR_GAP && gap <= MAX_PAIR_GAP) {
      const pair = addCachedPaths(
        { date: dateId, start, target, gap: roundScore(gap) },
        vectorStore,
        blockedWords,
      );
      if (pair.hardPath) return pair;
    }
  }
}

function formatPath(pathValue) {
  return pathValue ? JSON.stringify(pathValue) : "null";
}

async function main() {
  const endpoints = JSON.parse(
    await readFile(path.join(rootDir, "public", "data", "endpoints.json"), "utf8"),
  ).words;
  const blockedWords = new Set(
    JSON.parse(await readFile(path.join(rootDir, "public", "data", "blocked-words.json"), "utf8"))
      .words,
  );
  const lexicon = JSON.parse(
    await readFile(path.join(rootDir, "public", "data", "lexicon.json"), "utf8"),
  );
  for (const word of endpoints) {
    if (blockedWords.has(word)) {
      throw new Error(`Endpoint word "${word}" is blocked.`);
    }
  }
  const shardBuffers = await Promise.all(
    lexicon.shards.map((shardPath) => readFile(path.join(rootDir, "public", shardPath))),
  );
  const vectorStore = makeVectorStore(lexicon, shardBuffers);

  const schedule = [];
  for (let offset = 0; offset < SCHEDULE_DAYS; offset += 1) {
    schedule.push(pickPair(dateAfter(START_DATE, offset), endpoints, vectorStore, blockedWords));
    if ((offset + 1) % 25 === 0) {
      console.error(`Cached ${offset + 1}/${SCHEDULE_DAYS} daily puzzles.`);
    }
  }

  const lines = [
    "// Generated by scripts/generate-daily-schedule.mjs. Do not edit by hand.",
    "",
    "export const DAILY_PUZZLES = [",
    ...schedule.map(
      ({ date, start, target, gap, easyPath, hardPath }) =>
        `  ["${date}","${start}","${target}",${gap},${formatPath(easyPath)},${formatPath(
          hardPath,
        )}],`,
    ),
    "];",
    "",
    "const DAILY_PUZZLES_BY_DATE = new Map(DAILY_PUZZLES.map((row) => [row[0], row]));",
    "",
    "export function getScheduledDailyPuzzle(dateId) {",
    "  const row = DAILY_PUZZLES_BY_DATE.get(dateId);",
    "  if (!row) return null;",
    "  const [date, start, target, gap, easyPath = null, hardPath = null] = row;",
    "  return { date, start, target, gap, easyPath, hardPath };",
    "}",
  ];

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        startDate: START_DATE,
        scheduleDays: SCHEDULE_DAYS,
        first: schedule[0],
        last: schedule[schedule.length - 1],
        easyPathCount: schedule.filter((row) => row.easyPath).length,
        hardPathCount: schedule.filter((row) => row.hardPath).length,
      },
      null,
      2,
    ),
  );
}

await main();
