const DICTIONARY_URL = "./data/dictionary.txt";
const BLOCKED_WORDS_URL = "./data/blocked-words.json";
const ENDPOINTS_URL = "./data/endpoints.json";
const LEXICON_URL = "./data/lexicon.json";
const MANIFEST_URL = "./data/manifest.json";
const PUZZLE_API_URL = "./api/puzzle";
const STORAGE_KEY = "the-relating-game:v3";
const SHARE_SITE = "relating-game.pages.dev";
const START_DATE = "2026-06-10";
const MAX_STEPS = 10;

const MODES = {
  easy: { label: "Easy", gapDivisor: 2 },
  hard: { label: "Hard", gapDivisor: 3 },
};

const TARGET_PAIR_GAP = 0.9;
const MIN_PAIR_GAP = 0.86;
const MAX_PAIR_GAP = 0.94;
const TEST_PARAMS = new URLSearchParams(window.location.search);
const USE_MOCK_MODEL = TEST_PARAMS.has("mockModel");

const elements = {
  modelStatus: document.querySelector("#modelStatus"),
  kindButtons: [...document.querySelectorAll("[data-kind]")],
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  dateControls: document.querySelector("#dateControls"),
  archiveDate: document.querySelector("#archiveDate"),
  previousDay: document.querySelector("#previousDay"),
  nextDay: document.querySelector("#nextDay"),
  newRandom: document.querySelector("#newRandom"),
  startWord: document.querySelector("#startWord"),
  targetWord: document.querySelector("#targetWord"),
  puzzleSummary: document.querySelector("#puzzleSummary"),
  targetGap: document.querySelector("#targetGap"),
  targetGapBar: document.querySelector("#targetGapBar"),
  guessForm: document.querySelector("#guessForm"),
  guessInput: document.querySelector("#guessInput"),
  submitGuess: document.querySelector("#submitGuess"),
  message: document.querySelector("#message"),
  puzzleLabel: document.querySelector("#puzzleLabel"),
  startGapLabel: document.querySelector("#startGapLabel"),
  limitLabel: document.querySelector("#limitLabel"),
  stepLabel: document.querySelector("#stepLabel"),
  pathList: document.querySelector("#pathList"),
  undoStep: document.querySelector("#undoStep"),
  resetGame: document.querySelector("#resetGame"),
  giveUp: document.querySelector("#giveUp"),
  shareResult: document.querySelector("#shareResult"),
  shareRow: document.querySelector("#shareRow"),
  shareText: document.querySelector("#shareText"),
  copyShare: document.querySelector("#copyShare"),
  solutionSection: document.querySelector("#solutionSection"),
  solutionStatus: document.querySelector("#solutionStatus"),
  solutionPathList: document.querySelector("#solutionPathList"),
  playedStat: document.querySelector("#playedStat"),
  winsStat: document.querySelector("#winsStat"),
  bestStat: document.querySelector("#bestStat"),
  avgStat: document.querySelector("#avgStat"),
  resultPanel: document.querySelector("#resultPanel"),
  resultTitle: document.querySelector("#resultTitle"),
  resultText: document.querySelector("#resultText"),
  resultSolution: document.querySelector("#resultSolution"),
};

let dictionary = new Set();
let blockedWords = new Set();
let endpoints = [];
let manifest = null;
let vectorWords = new Map();
let vectorWordList = [];
let vectorShards = [];
let vectorDim = 0;
let vectorShardSize = 0;
let currentPuzzle = null;
let currentRecord = null;
let targetGapRequest = 0;

const defaultStorage = {
  mode: "easy",
  kind: "daily",
  archiveDate: previousDateId(todayId()),
  randomSeed: "",
  games: {},
  stats: {
    easy: { played: 0, wins: 0, totalSteps: 0, best: null },
    hard: { played: 0, wins: 0, totalSteps: 0, best: null },
  },
};

let storage = loadStorage();

function loadStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return mergeStorage(defaultStorage, parsed || {});
  } catch {
    return structuredClone(defaultStorage);
  }
}

function mergeStorage(base, value) {
  const merged = structuredClone(base);
  if (typeof value.mode === "string" && MODES[value.mode]) merged.mode = value.mode;
  if (["daily", "random", "archive"].includes(value.kind)) merged.kind = value.kind;
  if (isDateId(value.archiveDate)) merged.archiveDate = value.archiveDate;
  if (typeof value.randomSeed === "string") merged.randomSeed = value.randomSeed;
  if (value.games && typeof value.games === "object") merged.games = value.games;
  for (const mode of Object.keys(MODES)) {
    if (value.stats?.[mode]) {
      merged.stats[mode] = {
        ...merged.stats[mode],
        ...value.stats[mode],
      };
    }
  }
  return merged;
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

function setStatus(text, tone = "") {
  elements.modelStatus.textContent = text;
  elements.modelStatus.classList.toggle("ready", tone === "ready");
  elements.modelStatus.classList.toggle("error", tone === "error");
}

function setMessage(text, tone = "") {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", tone === "error");
  elements.message.classList.toggle("success", tone === "success");
}

function todayId() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateId(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(dateId) {
  const [year, month, day] = (isDateId(dateId) ? dateId : todayId()).split("-");
  return `${month}/${day}/${year}`;
}

function isDateId(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateFromId(dateId) {
  const [year, month, day] = dateId.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateId, amount) {
  const date = dateFromId(dateId);
  date.setDate(date.getDate() + amount);
  return formatDateId(date);
}

function previousDateId(dateId) {
  return addDays(dateId, -1);
}

function clampDate(dateId) {
  const min = START_DATE;
  const max = todayId();
  if (!isDateId(dateId)) return previousDateId(max);
  if (dateId < min) return min;
  if (dateId > max) return max;
  return dateId;
}

function normalizeTerm(value) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function isWordShape(term) {
  return /^[a-z]{2,15}$/.test(term);
}

function isBlockedWord(term) {
  return blockedWords.has(term);
}

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

function getForcedPair() {
  const forcedStart = normalizeTerm(TEST_PARAMS.get("start") || "");
  const forcedTarget = normalizeTerm(TEST_PARAMS.get("target") || "");
  if (USE_MOCK_MODEL && forcedStart && forcedTarget) {
    return {
      start: forcedStart,
      target: forcedTarget,
      gap: Number(TEST_PARAMS.get("gap")) || 1,
    };
  }
  return null;
}

function pickPair(seedText) {
  const random = mulberry32(hashString(seedText));
  for (;;) {
    const start = endpoints[Math.floor(random() * endpoints.length)];
    const target = endpoints[Math.floor(random() * endpoints.length)];
    if (start === target) continue;

    const score = scoreLocalPair(start, target);
    const gap = Math.max(0, 1 - score.similarity);
    if (gap >= MIN_PAIR_GAP && gap <= MAX_PAIR_GAP) {
      return { start, target, gap };
    }
  }
}

function scoreLocalPair(from, to) {
  const fromVector = getLocalVector(from);
  const toVector = getLocalVector(to);
  if (!fromVector || !toVector) return null;
  const similarity = cosineSimilarity(fromVector, toVector);
  return {
    similarity,
    gap: Math.max(0, 1 - similarity),
  };
}

async function buildPuzzle() {
  const kind = storage.kind;
  const date =
    kind === "daily" ? todayId() : kind === "archive" ? storage.archiveDate : "";
  const randomSeed =
    kind === "random" ? storage.randomSeed || createRandomSeed() : "";

  if (kind === "random" && !storage.randomSeed) {
    storage.randomSeed = randomSeed;
    saveStorage();
  }

  const forcedPair = getForcedPair();
  const pair =
    forcedPair ||
    (kind === "random" ? pickPair(`random:${randomSeed}`) : await fetchDailyPuzzle(date));
  return {
    kind,
    date,
    randomSeed,
    start: pair.start,
    target: pair.target,
    gap: roundScore(pair.gap || TARGET_PAIR_GAP),
    key: `${kind}:${date || randomSeed}:${pair.start}:${pair.target}:${roundScore(
      pair.gap || TARGET_PAIR_GAP,
    )}`,
  };
}

async function fetchDailyPuzzle(date) {
  const response = await fetch(`${PUZZLE_API_URL}?date=${encodeURIComponent(date)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Daily puzzle is not available.");
  }
  return payload;
}

function createRandomSeed() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${bytes[0].toString(36)}${bytes[1].toString(36)}`;
}

function gameKey() {
  return `${storage.mode}:${currentPuzzle.key}`;
}

function getMoveLimit() {
  return currentPuzzle.gap / MODES[storage.mode].gapDivisor;
}

function createEmptyRecord() {
  return {
    path: [currentPuzzle.start],
    scores: [],
    done: false,
    status: "playing",
    completedAt: "",
    solution: null,
  };
}

function getRecord() {
  const saved = storage.games[gameKey()];
  if (
    saved &&
    Array.isArray(saved.path) &&
    saved.path[0] === currentPuzzle.start &&
    saved.path.every((term) => typeof term === "string")
  ) {
    return {
      path: saved.path,
      scores: Array.isArray(saved.scores) ? saved.scores : [],
      done: Boolean(saved.done),
      status: saved.status || (saved.done ? "won" : "playing"),
      completedAt: saved.completedAt || "",
      solution:
        saved.solution && typeof saved.solution === "object"
          ? {
              status: saved.solution.status || "hidden",
              path: Array.isArray(saved.solution.path) ? saved.solution.path : [],
              scores: Array.isArray(saved.solution.scores) ? saved.solution.scores : [],
            }
          : null,
    };
  }
  return createEmptyRecord();
}

function persistRecord() {
  storage.games[gameKey()] = currentRecord;
  saveStorage();
}

async function loadGameData() {
  setStatus("Loading");
  const requests = USE_MOCK_MODEL
    ? [fetch(DICTIONARY_URL), fetch(BLOCKED_WORDS_URL), fetch(ENDPOINTS_URL), fetch(MANIFEST_URL)]
    : [
        fetch(DICTIONARY_URL),
        fetch(BLOCKED_WORDS_URL),
        fetch(ENDPOINTS_URL),
        fetch(LEXICON_URL),
        fetch(MANIFEST_URL),
      ];
  const responses = await Promise.all(requests);

  for (const response of responses) {
    if (!response.ok) {
      throw new Error(`Could not load game data: ${response.status}`);
    }
  }

  const [
    dictionaryResponse,
    blockedWordsResponse,
    endpointsResponse,
    fourthResponse,
    fifthResponse,
  ] = responses;
  const dictionaryText = await dictionaryResponse.text();
  dictionary = new Set(dictionaryText.split(/\r?\n/).filter(Boolean));
  blockedWords = new Set((await blockedWordsResponse.json()).words);
  loadEndpointTable(await endpointsResponse.json());
  if (USE_MOCK_MODEL) {
    manifest = await fourthResponse.json();
  } else {
    manifest = await fifthResponse.json();
    await loadVectorTable(await fourthResponse.json());
  }

  if (dictionary.size < 1000 || (!USE_MOCK_MODEL && endpoints.length < 100) || !manifest) {
    throw new Error("Game data did not contain enough words.");
  }
}

function loadEndpointTable(data) {
  endpoints = data.words;
}

async function loadVectorTable(data) {
  vectorDim = data.dim;
  vectorShardSize = data.shardSize;
  vectorWordList = data.words;
  vectorWords = new Map(data.words.map((word, index) => [word, index]));
  vectorShards = await Promise.all(
    data.shards.map(async (path) => {
      const response = await fetch(`./${path}`);
      if (!response.ok) {
        throw new Error(`Could not load vector shard ${path}: ${response.status}`);
      }
      return new Float32Array(await response.arrayBuffer());
    }),
  );
}

function getLocalVector(term) {
  if (USE_MOCK_MODEL) return mockEmbed(term);
  const index = vectorWords.get(term);
  if (index === undefined) return null;
  return getLocalVectorByIndex(index);
}

function getLocalVectorByIndex(index) {
  const shard = vectorShards[Math.floor(index / vectorShardSize)];
  const rowStart = (index % vectorShardSize) * vectorDim;
  return shard.subarray(rowStart, rowStart + vectorDim);
}

async function getVector(term) {
  const normalized = normalizeTerm(term);
  const local = getLocalVector(normalized);
  if (local) return local;

  if (!dictionary.has(normalized)) {
    throw new Error("That word is not in the game dictionary.");
  }

  throw new Error("That word has no fastText vector.");
}

function mockEmbed(term) {
  const normalized = normalizeTerm(term);
  if (normalized.includes("reject")) {
    return [1, 0, 0, 0];
  }
  return [0, 1, 0, 0];
}

async function scorePair(from, to) {
  const [fromVector, toVector] = await Promise.all([getVector(from), getVector(to)]);
  const similarity = cosineSimilarity(fromVector, toVector);
  return {
    from,
    to,
    similarity,
    gap: Math.max(0, 1 - similarity),
  };
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function dotSimilarity(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function render() {
  const steps = currentRecord.path.length - 1;
  const moveLimit = getMoveLimit();
  const canPlay = !currentRecord.done;
  const kindLabel =
    currentPuzzle.kind === "daily"
      ? displayDate(currentPuzzle.date)
      : currentPuzzle.kind === "archive"
        ? displayDate(currentPuzzle.date)
        : "Random";

  elements.kindButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.kind === storage.kind);
  });
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === storage.mode);
  });

  elements.dateControls.hidden = storage.kind !== "archive";
  elements.newRandom.hidden = storage.kind !== "random";
  elements.archiveDate.min = START_DATE;
  elements.archiveDate.max = todayId();
  elements.archiveDate.value = storage.archiveDate;
  elements.previousDay.disabled = storage.archiveDate <= START_DATE;
  elements.nextDay.disabled = storage.archiveDate >= todayId();

  elements.startWord.textContent = currentPuzzle.start;
  elements.targetWord.textContent = currentPuzzle.target;
  elements.puzzleLabel.textContent =
    currentPuzzle.kind === "daily" ? `Daily ${kindLabel}` : kindLabel;
  elements.startGapLabel.textContent = `Start gap: ${currentPuzzle.gap.toFixed(2)}`;
  elements.limitLabel.textContent = `${MODES[storage.mode].label} move limit: ${moveLimit.toFixed(
    2,
  )}`;
  elements.stepLabel.textContent = `${steps}/${MAX_STEPS}`;
  elements.puzzleSummary.textContent =
    `Each move must be ${moveLimit.toFixed(2)} or less. ` +
    `Reach the target in ${MAX_STEPS} steps.`;

  elements.guessInput.disabled = !canPlay;
  elements.submitGuess.disabled = !canPlay;
  elements.undoStep.disabled = !canPlay || currentRecord.path.length <= 1;
  elements.resetGame.disabled = currentRecord.path.length <= 1 && !currentRecord.done;
  elements.giveUp.disabled = !canPlay;
  elements.shareResult.disabled = !currentRecord.done;

  const shareText = currentRecord.done ? buildShareText() : "";
  elements.shareRow.hidden = !currentRecord.done;
  elements.shareText.value = shareText;

  elements.pathList.replaceChildren(
    ...currentRecord.path.map((term, index) =>
      createGuessRow(term, index, currentRecord.scores[index - 1]),
    ),
  );

  renderResult();
  renderSolution();
  renderStats();
}

function renderResult() {
  elements.resultPanel.hidden = !currentRecord.done;
  if (!currentRecord.done) {
    elements.resultText.textContent = "";
    return;
  }

  elements.resultTitle.textContent =
    currentRecord.status === "won"
      ? "Solved"
      : currentRecord.status === "gave-up"
        ? "Gave up"
        : "Game over";
  elements.resultText.textContent = buildShareText();
}

function renderSolution() {
  const solution = currentRecord.solution;
  elements.solutionSection.hidden = !solution;
  if (!solution) {
    elements.solutionStatus.textContent = "Waiting";
    elements.solutionPathList.replaceChildren();
    elements.resultSolution.textContent = "";
    return;
  }

  if (solution.status === "searching") {
    elements.solutionStatus.textContent = "Searching";
    elements.resultSolution.textContent = "RelateBot's solution is being searched.";
  } else if (solution.status === "ready") {
    elements.solutionStatus.textContent = `${Math.max(0, solution.path.length - 1)}/${MAX_STEPS}`;
    elements.resultSolution.textContent = `RelateBot's solution: ${solution.path.join(" -> ")}`;
  } else {
    elements.solutionStatus.textContent = "No path found";
    elements.resultSolution.textContent = "RelateBot did not find a valid path.";
  }

  elements.solutionPathList.replaceChildren(
    ...solution.path.map((term, index) => createGuessRow(term, index, solution.scores[index - 1])),
  );
}

function createGuessRow(term, index, score) {
  const row = document.createElement("tr");
  row.className = "path-row";

  const number = document.createElement("td");
  number.textContent = index === 0 ? "0" : String(index);

  const word = document.createElement("td");
  word.className = "path-word";
  word.textContent = term;

  const stepGap = document.createElement("td");
  stepGap.textContent = score ? score.gap.toFixed(2) : "-";

  const targetGap = document.createElement("td");
  targetGap.textContent = score ? score.targetGap.toFixed(2) : currentPuzzle.gap.toFixed(2);

  const read = document.createElement("td");
  const badge = document.createElement("span");
  const label = score ? proximityLabel(score.targetGap) : "start";
  badge.className = `read-badge ${label}`;
  badge.textContent = label;
  read.append(badge);

  row.append(number, word, stepGap, targetGap, read);
  return row;
}

function proximityLabel(targetGap) {
  if (targetGap <= 0.000001) return "target";
  const ratio = targetGap / currentPuzzle.gap;
  if (ratio <= 0.25) return "hot";
  if (ratio <= 0.5) return "warm";
  if (ratio <= 0.75) return "closer";
  return "cold";
}

function renderStats() {
  const stats = storage.stats[storage.mode] || defaultStorage.stats[storage.mode];
  elements.playedStat.textContent = stats.played;
  elements.winsStat.textContent = stats.wins;
  elements.bestStat.textContent = stats.best ?? "-";
  elements.avgStat.textContent =
    stats.wins > 0 ? (stats.totalSteps / stats.wins).toFixed(1) : "-";
}

async function updateTargetGap() {
  const requestId = ++targetGapRequest;
  const current = currentRecord.path[currentRecord.path.length - 1];
  elements.targetGap.textContent = "...";
  elements.targetGapBar.style.width = "0%";
  elements.targetGapBar.className = "";

  try {
    const score = await scorePair(current, currentPuzzle.target);
    if (requestId !== targetGapRequest) return;
    renderTargetGap(score.gap);
  } catch (error) {
    if (requestId !== targetGapRequest) return;
    elements.targetGap.textContent = "unavailable";
    elements.targetGapBar.className = "blocked";
    setMessage(error.message || "Could not score that word.", "error");
  }
}

function renderTargetGap(gap) {
  const progress = Math.max(0, Math.min(1, 1 - gap / currentPuzzle.gap));
  elements.targetGap.textContent = gap.toFixed(2);
  elements.targetGapBar.style.width = `${Math.round(progress * 100)}%`;
  elements.targetGapBar.className =
    gap <= getMoveLimit() ? "" : progress > 0.5 ? "warning" : "blocked";
}

async function handleGuessSubmit(event) {
  event.preventDefault();
  if (!currentPuzzle || currentRecord.done) return;

  const term = normalizeTerm(elements.guessInput.value);
  const previous = currentRecord.path[currentRecord.path.length - 1];
  const moveLimit = getMoveLimit();

  if (!isWordShape(term)) {
    setMessage("Enter one dictionary word, using only letters.", "error");
    focusGuessInput();
    return;
  }
  if (!dictionary.has(term)) {
    setMessage("That word is not in the game dictionary.", "error");
    focusGuessInput();
    return;
  }
  if (isBlockedWord(term)) {
    setMessage("That word is not allowed in this game.", "error");
    focusGuessInput();
    return;
  }
  if (term === previous) {
    setMessage("That is already your current word.", "error");
    focusGuessInput();
    return;
  }
  if (currentRecord.path.includes(term)) {
    setMessage("Use each word once.", "error");
    focusGuessInput();
    return;
  }

  setBusy(true);
  setMessage(`Checking ${previous} to ${term}.`);

  try {
    const [stepScore, targetScore] = await Promise.all([
      scorePair(previous, term),
      scorePair(term, currentPuzzle.target),
    ]);

    if (stepScore.gap > moveLimit + 0.000001) {
      setMessage(
        `Step gap ${stepScore.gap.toFixed(2)} is over the ${moveLimit.toFixed(2)} limit.`,
        "error",
      );
      return;
    }

    currentRecord.path.push(term);
    currentRecord.scores.push({
      from: previous,
      to: term,
      similarity: roundScore(stepScore.similarity),
      gap: roundScore(stepScore.gap),
      targetGap: roundScore(targetScore.gap),
      at: new Date().toISOString(),
    });
    elements.guessInput.value = "";

    if (term === currentPuzzle.target) {
      finishGame("won", "Solved.");
    } else if (currentRecord.path.length - 1 >= MAX_STEPS) {
      finishGame("lost", "Out of steps.");
    } else {
      setMessage(
        `Accepted. Target gap is ${targetScore.gap.toFixed(2)} (${proximityLabel(
          targetScore.gap,
        )}).`,
        "success",
      );
    }

    persistRecord();
    render();
    updateTargetGap();
    if (currentRecord.done) {
      showResult();
      revealRelateBotSolution();
    }
  } catch (error) {
    setMessage(error.message || "Could not score that step.", "error");
  } finally {
    setBusy(false);
    focusGuessInput();
  }
}

function setBusy(isBusy) {
  elements.submitGuess.textContent = isBusy ? "..." : "Try";
  if (currentRecord.done) return;
  elements.guessInput.disabled = isBusy;
  elements.submitGuess.disabled = isBusy;
}

function focusGuessInput() {
  if (!currentRecord || currentRecord.done || elements.guessInput.disabled) return;
  requestAnimationFrame(() => {
    if (!currentRecord.done && !elements.guessInput.disabled) {
      elements.guessInput.focus({ preventScroll: true });
    }
  });
}

async function revealRelateBotSolution() {
  if (currentRecord.solution?.status === "ready" || currentRecord.solution?.status === "none") {
    return;
  }

  currentRecord.solution = { status: "searching", path: [], scores: [] };
  persistRecord();
  render();

  const path = await findRelateBotPath();
  if (path) {
    currentRecord.solution = {
      status: "ready",
      path,
      scores: await scoreSolutionPath(path),
    };
  } else {
    currentRecord.solution = { status: "none", path: [], scores: [] };
  }

  persistRecord();
  render();
}

async function findRelateBotPath() {
  const direct = await scorePair(currentPuzzle.start, currentPuzzle.target);
  if (direct.gap <= getMoveLimit() + 0.000001) {
    return [currentPuzzle.start, currentPuzzle.target];
  }

  const shortPath = await findShortBridgePath();
  if (shortPath) return shortPath;

  return findGreedyRelateBotPath();
}

async function findShortBridgePath() {
  if (USE_MOCK_MODEL) return null;

  const moveLimit = getMoveLimit();
  const minSimilarity = 1 - moveLimit - 0.000001;
  const startIndex = vectorWords.get(currentPuzzle.start);
  const targetIndex = vectorWords.get(currentPuzzle.target);
  const startNeighbors = await scanNeighborIndices(startIndex, minSimilarity);
  const targetNeighbors = await scanNeighborIndices(targetIndex, minSimilarity);
  const targetNeighborSet = new Set(targetNeighbors);

  for (const middle of startNeighbors) {
    if (targetNeighborSet.has(middle)) {
      return [
        currentPuzzle.start,
        vectorWordList[middle],
        currentPuzzle.target,
      ];
    }
  }

  for (const left of startNeighbors) {
    const leftVector = getLocalVectorByIndex(left);
    for (const right of targetNeighbors) {
      if (dotSimilarity(leftVector, getLocalVectorByIndex(right)) >= minSimilarity) {
        return [
          currentPuzzle.start,
          vectorWordList[left],
          vectorWordList[right],
          currentPuzzle.target,
        ];
      }
    }
  }

  return null;
}

async function scanNeighborIndices(baseIndex, minSimilarity) {
  const baseVector = getLocalVectorByIndex(baseIndex);
  const neighbors = [];
  for (let index = 0; index < vectorWordList.length; index += 1) {
    const word = vectorWordList[index];
    if (
      index !== baseIndex &&
      !isBlockedWord(word) &&
      dotSimilarity(baseVector, getLocalVectorByIndex(index)) >= minSimilarity
    ) {
      neighbors.push(index);
    }
  }
  return neighbors;
}

async function findGreedyRelateBotPath() {
  const moveLimit = getMoveLimit();
  const path = [currentPuzzle.start];
  const used = new Set(path);

  const targetVector = getLocalVector(currentPuzzle.target);
  if (!targetVector) return null;

  while (path.length - 1 < MAX_STEPS) {
    const from = path[path.length - 1];
    const directTarget = await scorePair(from, currentPuzzle.target);
    if (directTarget.gap <= moveLimit + 0.000001) {
      path.push(currentPuzzle.target);
      return path;
    }

    const fromVector = getLocalVector(from);
    const currentTargetGap = directTarget.gap;
    let best = null;

    for (let index = 0; index < vectorWordList.length; index += 1) {
      const word = vectorWordList[index];
      if (used.has(word) || word === currentPuzzle.target || isBlockedWord(word)) continue;

      const vector = getLocalVectorByIndex(index);
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

async function scoreSolutionPath(path) {
  const scores = [];
  for (let index = 1; index < path.length; index += 1) {
    const stepScore = await scorePair(path[index - 1], path[index]);
    const targetScore = await scorePair(path[index], currentPuzzle.target);
    scores.push({
      from: path[index - 1],
      to: path[index],
      similarity: roundScore(stepScore.similarity),
      gap: roundScore(stepScore.gap),
      targetGap: roundScore(targetScore.gap),
      at: new Date().toISOString(),
    });
  }
  return scores;
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}

function finishGame(status, message) {
  if (currentRecord.done) return;
  const steps = currentRecord.path.length - 1;
  currentRecord.done = true;
  currentRecord.status = status;
  currentRecord.completedAt = new Date().toISOString();

  const stats = storage.stats[storage.mode];
  stats.played += 1;
  if (status === "won") {
    stats.wins += 1;
    stats.totalSteps += steps;
    stats.best = stats.best === null ? steps : Math.min(stats.best, steps);
  }
  setMessage(message, status === "won" ? "success" : "error");
}

function showResult() {
  requestAnimationFrame(() => {
    elements.resultPanel.scrollIntoView({ block: "nearest" });
  });
}

async function giveUp() {
  if (currentRecord.done) return;
  finishGame("gave-up", "Gave up.");
  persistRecord();
  render();
  showResult();
  await revealRelateBotSolution();
}

function resetCurrentGame() {
  currentRecord = createEmptyRecord();
  persistRecord();
  setMessage("Puzzle reset.");
  render();
  updateTargetGap();
  elements.guessInput.focus();
}

function undoStep() {
  if (currentRecord.done || currentRecord.path.length <= 1) return;
  currentRecord.path.pop();
  currentRecord.scores.pop();
  persistRecord();
  setMessage("Last step removed.");
  render();
  updateTargetGap();
  elements.guessInput.focus();
}

function switchKind(kind) {
  if (!["daily", "random", "archive"].includes(kind)) return;
  storage.kind = kind;
  if (kind === "archive") {
    storage.archiveDate = clampDate(storage.archiveDate);
  }
  if (kind === "random" && !storage.randomSeed) {
    storage.randomSeed = createRandomSeed();
  }
  saveStorage();
  queuePuzzleLoad();
}

function switchMode(mode) {
  if (!MODES[mode]) return;
  storage.mode = mode;
  saveStorage();
  queuePuzzleLoad();
}

async function loadPuzzle() {
  currentPuzzle = await buildPuzzle();
  currentRecord = getRecord();
  render();
  if (currentRecord.done) {
    setMessage(
      currentRecord.status === "won" ? "Solved." : "Game over.",
      currentRecord.status === "won" ? "success" : "error",
    );
  } else {
    setMessage("Enter a word that is close enough to your current word.");
  }
  updateTargetGap();
  if (currentRecord.done && !currentRecord.solution) {
    revealRelateBotSolution();
  }
  focusGuessInput();
}

function queuePuzzleLoad() {
  loadPuzzle().catch((error) => {
    setStatus("Error", "error");
    setMessage(error.message || "Could not load that puzzle.", "error");
  });
}

function setArchiveDate(dateId) {
  storage.kind = "archive";
  storage.archiveDate = clampDate(dateId);
  saveStorage();
  queuePuzzleLoad();
}

function newRandomPuzzle() {
  storage.kind = "random";
  storage.randomSeed = createRandomSeed();
  saveStorage();
  queuePuzzleLoad();
}

async function shareCurrentResult() {
  if (!currentRecord.done) return;
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    setMessage("Result copied.", "success");
  } catch {
    elements.shareText.focus();
    elements.shareText.select();
    setMessage("Share text selected.");
  }
}

function buildShareText() {
  const steps = Math.min(MAX_STEPS, currentRecord.path.length - 1);
  const score = currentRecord.status === "won" ? String(steps) : "X";
  const date = currentPuzzle.date || todayId();
  return `The Relating Game ${displayDate(date)} | ${MODES[storage.mode].label} ${score}/${MAX_STEPS} | ${SHARE_SITE}`;
}

function wireEvents() {
  elements.kindButtons.forEach((button) => {
    button.addEventListener("click", () => switchKind(button.dataset.kind));
  });
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => switchMode(button.dataset.mode));
  });
  elements.archiveDate.addEventListener("change", () => {
    setArchiveDate(elements.archiveDate.value);
  });
  elements.previousDay.addEventListener("click", () => {
    setArchiveDate(addDays(storage.archiveDate, -1));
  });
  elements.nextDay.addEventListener("click", () => {
    setArchiveDate(addDays(storage.archiveDate, 1));
  });
  elements.newRandom.addEventListener("click", newRandomPuzzle);
  elements.guessForm.addEventListener("submit", handleGuessSubmit);
  elements.undoStep.addEventListener("click", undoStep);
  elements.resetGame.addEventListener("click", resetCurrentGame);
  elements.giveUp.addEventListener("click", giveUp);
  elements.shareResult.addEventListener("click", shareCurrentResult);
  elements.copyShare.addEventListener("click", shareCurrentResult);
}

async function init() {
  wireEvents();
  elements.archiveDate.min = START_DATE;
  elements.archiveDate.max = todayId();
  storage.archiveDate = clampDate(storage.archiveDate);

  try {
    await loadGameData();
    await loadPuzzle();
    setStatus("Ready", "ready");
  } catch (error) {
    setStatus("Error", "error");
    setMessage(error.message || "Could not prepare the puzzle.", "error");
  }
}

init();
