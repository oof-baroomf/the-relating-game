const DICTIONARY_URL = "./data/dictionary.txt";
const ENDPOINTS_URL = "./data/endpoints.json";
const EMBEDDINGS_URL = "./data/embeddings.json";
const MANIFEST_URL = "./data/manifest.json";
const EMBED_API_URL = "./api/embed";
const STORAGE_KEY = "the-relating-game:v3";
const SHARE_SITE = "relating-game.pages.dev";
const START_DATE = "2026-06-10";
const MAX_STEPS = 10;

const MODES = {
  easy: { label: "Easy", gapDivisor: 2 },
  hard: { label: "Hard", gapDivisor: 4 },
};

const TARGET_PAIR_GAP = 0.82;
const MIN_PAIR_GAP = 0.76;
const MAX_PAIR_GAP = 0.92;
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
  botToggle: document.querySelector("#botToggle"),
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
  shareResult: document.querySelector("#shareResult"),
  shareRow: document.querySelector("#shareRow"),
  shareText: document.querySelector("#shareText"),
  copyShare: document.querySelector("#copyShare"),
  botSection: document.querySelector("#botSection"),
  botStatus: document.querySelector("#botStatus"),
  botPathList: document.querySelector("#botPathList"),
  playedStat: document.querySelector("#playedStat"),
  winsStat: document.querySelector("#winsStat"),
  bestStat: document.querySelector("#bestStat"),
  avgStat: document.querySelector("#avgStat"),
  resultDialog: document.querySelector("#resultDialog"),
  resultTitle: document.querySelector("#resultTitle"),
  resultText: document.querySelector("#resultText"),
  dialogShare: document.querySelector("#dialogShare"),
  dialogClose: document.querySelector("#dialogClose"),
};

let dictionary = new Set();
let endpoints = [];
let manifest = null;
let embeddingWords = new Map();
let embeddingBytes = new Int8Array();
let embeddingDim = 0;
let embeddingScale = 127;
let endpointWords = new Map();
let endpointBytes = new Int8Array();
let endpointDim = 0;
let endpointScale = 127;
let currentPuzzle = null;
let currentRecord = null;
let targetGapRequest = 0;
const vectorCache = new Map();

const defaultStorage = {
  mode: "easy",
  kind: "daily",
  botFight: false,
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
  if (typeof value.botFight === "boolean") merged.botFight = value.botFight;
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

function pickPair(seedText) {
  const forcedStart = normalizeTerm(TEST_PARAMS.get("start") || "");
  const forcedTarget = normalizeTerm(TEST_PARAMS.get("target") || "");
  if (USE_MOCK_MODEL && forcedStart && forcedTarget) {
    return {
      start: forcedStart,
      target: forcedTarget,
      gap: Number(TEST_PARAMS.get("gap")) || 1,
    };
  }

  const random = mulberry32(hashString(seedText));
  let fallback = null;

  for (let attempt = 0; attempt < 1600; attempt += 1) {
    const start = endpoints[Math.floor(random() * endpoints.length)];
    const target = endpoints[Math.floor(random() * endpoints.length)];
    if (!start || !target || start === target) continue;

    const score = scoreLocalPair(start, target);
    if (!score) continue;
    const gap = Math.max(0, 1 - score.similarity);
    if (
      !fallback ||
      Math.abs(gap - TARGET_PAIR_GAP) < Math.abs(fallback.gap - TARGET_PAIR_GAP)
    ) {
      fallback = { start, target, gap };
    }
    if (gap >= MIN_PAIR_GAP && gap <= MAX_PAIR_GAP) {
      return { start, target, gap };
    }
  }

  if (fallback) return fallback;
  const start = endpoints[0] || "time";
  const target = endpoints[1] || "world";
  return { start, target, gap: scoreLocalPair(start, target)?.gap || TARGET_PAIR_GAP };
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

function buildPuzzle() {
  const kind = storage.kind;
  const date =
    kind === "daily" ? todayId() : kind === "archive" ? storage.archiveDate : "";
  const randomSeed =
    kind === "random" ? storage.randomSeed || createRandomSeed() : "";

  if (kind === "random" && !storage.randomSeed) {
    storage.randomSeed = randomSeed;
    saveStorage();
  }

  const seedText = kind === "random" ? `random:${randomSeed}` : `date:${date}`;
  const pair = pickPair(seedText);
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
    bot: createBotState(),
  };
}

function createBotState() {
  return {
    path: [currentPuzzle.start],
    scores: [],
    done: false,
    status: "playing",
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
      bot:
        saved.bot && Array.isArray(saved.bot.path)
          ? {
              path: saved.bot.path,
              scores: Array.isArray(saved.bot.scores) ? saved.bot.scores : [],
              done: Boolean(saved.bot.done),
              status: saved.bot.status || "playing",
            }
          : createBotState(),
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
  const [dictionaryResponse, endpointsResponse, embeddingsResponse, manifestResponse] =
    await Promise.all([
      fetch(DICTIONARY_URL),
      fetch(ENDPOINTS_URL),
      fetch(EMBEDDINGS_URL),
      fetch(MANIFEST_URL),
    ]);

  for (const response of [
    dictionaryResponse,
    endpointsResponse,
    embeddingsResponse,
    manifestResponse,
  ]) {
    if (!response.ok) {
      throw new Error(`Could not load game data: ${response.status}`);
    }
  }

  const dictionaryText = await dictionaryResponse.text();
  dictionary = new Set(dictionaryText.split(/\r?\n/).filter(Boolean));
  loadEndpointTable(await endpointsResponse.json());
  manifest = await manifestResponse.json();
  loadEmbeddingTable(await embeddingsResponse.json());

  if (dictionary.size < 1000 || endpoints.length < 100 || !manifest) {
    throw new Error("Game data did not contain enough words.");
  }
}

function loadEmbeddingTable(data) {
  embeddingDim = data.dim;
  embeddingScale = data.scale;
  embeddingBytes = decodeBase64Int8(data.vectors);
  embeddingWords = new Map(data.words.map((word, index) => [word, index]));
}

function loadEndpointTable(data) {
  endpoints = data.words;
  endpointDim = data.dim;
  endpointScale = data.scale;
  endpointBytes = decodeBase64Int8(data.vectors);
  endpointWords = new Map(data.words.map((word, index) => [word, index]));
}

function decodeBase64Int8(value) {
  const binary = atob(value);
  const bytes = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getLocalVector(term) {
  if (USE_MOCK_MODEL) return mockEmbed(term);
  const cached = vectorCache.get(term);
  if (cached) return cached;

  const rowIndex = embeddingWords.get(term);
  if (rowIndex !== undefined) {
    const start = rowIndex * embeddingDim;
    const row = embeddingBytes.subarray(start, start + embeddingDim);
    const vector = normalizeVector(
      Array.from(row, (value) => value / embeddingScale),
    );
    vectorCache.set(term, vector);
    return vector;
  }

  const endpointIndex = endpointWords.get(term);
  if (endpointIndex !== undefined) {
    const start = endpointIndex * endpointDim;
    const row = endpointBytes.subarray(start, start + endpointDim);
    const vector = normalizeVector(
      Array.from(row, (value) => value / endpointScale),
    );
    vectorCache.set(term, vector);
    return vector;
  }

  return null;
}

async function getVector(term) {
  const normalized = normalizeTerm(term);
  const local = getLocalVector(normalized);
  if (local) return local;

  if (!dictionary.has(normalized)) {
    throw new Error("That word is not in the game dictionary.");
  }

  const response = await fetch(EMBED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word: normalized }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Could not embed that word.");
  }

  const vector = normalizeVector(payload.vector);
  vectorCache.set(normalized, vector);
  return vector;
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

function normalizeVector(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  const divisor = Math.sqrt(norm) || 1;
  return vector.map((value) => value / divisor);
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
  elements.botToggle.classList.toggle("active", storage.botFight);
  elements.botToggle.textContent = storage.botFight ? "Bot on" : "Bot fight";

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
  elements.shareResult.disabled = !currentRecord.done;

  const shareText = currentRecord.done ? buildShareText() : "";
  elements.shareRow.hidden = !currentRecord.done;
  elements.shareText.value = shareText;

  elements.pathList.replaceChildren(
    ...currentRecord.path.map((term, index) =>
      createGuessRow(term, index, currentRecord.scores[index - 1]),
    ),
  );

  renderBot();
  renderStats();
}

function renderBot() {
  elements.botSection.hidden = !storage.botFight;
  if (!storage.botFight) return;

  const bot = currentRecord.bot || createBotState();
  const steps = bot.path.length - 1;
  elements.botStatus.textContent =
    bot.status === "won"
      ? `Solved in ${steps}/${MAX_STEPS}`
      : bot.status === "stuck"
        ? `Stuck at ${steps}/${MAX_STEPS}`
        : `${steps}/${MAX_STEPS}`;
  elements.botPathList.replaceChildren(
    ...bot.path.map((term, index) => createGuessRow(term, index, bot.scores[index - 1])),
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
      showResultDialog();
    } else if (currentRecord.path.length - 1 >= MAX_STEPS) {
      finishGame("lost", "Out of steps.");
      showResultDialog();
    } else {
      setMessage(
        `Accepted. Target gap is ${targetScore.gap.toFixed(2)} (${proximityLabel(
          targetScore.gap,
        )}).`,
        "success",
      );
      if (storage.botFight) takeBotTurn();
    }

    persistRecord();
    render();
    updateTargetGap();
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

function takeBotTurn() {
  if (!storage.botFight || currentRecord.done) return;
  currentRecord.bot ||= createBotState();
  const bot = currentRecord.bot;
  if (bot.done || bot.path.length - 1 >= MAX_STEPS) return;

  const move = chooseBotMove();
  if (!move) {
    bot.done = true;
    bot.status = "stuck";
    persistRecord();
    render();
    return;
  }

  bot.path.push(move.word);
  bot.scores.push({
    from: move.from,
    to: move.word,
    similarity: roundScore(move.similarity),
    gap: roundScore(move.gap),
    targetGap: roundScore(move.targetGap),
    at: new Date().toISOString(),
  });

  if (move.word === currentPuzzle.target) {
    bot.done = true;
    bot.status = "won";
    finishGame("lost", "Bot reached the target first.");
    showResultDialog();
  } else if (bot.path.length - 1 >= MAX_STEPS) {
    bot.done = true;
    bot.status = "stuck";
  }

  persistRecord();
  render();
}

function chooseBotMove() {
  const bot = currentRecord.bot || createBotState();
  const from = bot.path[bot.path.length - 1];
  const moveLimit = getMoveLimit();
  const used = new Set(bot.path);
  const directTarget = scoreLocalPair(from, currentPuzzle.target);
  if (directTarget && directTarget.gap <= moveLimit + 0.000001) {
    return {
      from,
      word: currentPuzzle.target,
      similarity: directTarget.similarity,
      gap: directTarget.gap,
      targetGap: 0,
    };
  }

  const fromVector = getLocalVector(from);
  const targetVector = getLocalVector(currentPuzzle.target);
  if (!fromVector || !targetVector) return null;

  const currentTargetGap = directTarget?.gap ?? currentPuzzle.gap;
  let best = null;
  let fallback = null;
  for (const word of embeddingWords.keys()) {
    if (used.has(word) || word === from || word === currentPuzzle.start) continue;
    const vector = getLocalVector(word);
    if (!vector) continue;

    const stepSimilarity = cosineSimilarity(fromVector, vector);
    const stepGap = Math.max(0, 1 - stepSimilarity);
    if (stepGap > moveLimit + 0.000001 || stepGap < 0.01) continue;

    const targetGap = Math.max(0, 1 - cosineSimilarity(vector, targetVector));
    const candidate = {
      from,
      word,
      similarity: stepSimilarity,
      gap: stepGap,
      targetGap,
    };

    if (!fallback || targetGap < fallback.targetGap) fallback = candidate;
    if (targetGap < currentTargetGap - 0.01 && (!best || targetGap < best.targetGap)) {
      best = candidate;
    }
  }

  return best || fallback;
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

function showResultDialog() {
  const won = currentRecord.status === "won";
  elements.resultTitle.textContent = won ? "Solved" : "Game over";
  elements.resultText.textContent = buildShareText();
  if (typeof elements.resultDialog.showModal === "function") {
    elements.resultDialog.showModal();
  }
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
  loadPuzzle();
}

function switchMode(mode) {
  if (!MODES[mode]) return;
  storage.mode = mode;
  saveStorage();
  loadPuzzle();
}

function toggleBotFight() {
  storage.botFight = !storage.botFight;
  if (storage.botFight) {
    currentRecord.bot ||= createBotState();
    setMessage("Bot Fight enabled. The bot moves after each accepted guess.");
  } else {
    setMessage("Bot Fight disabled.");
  }
  persistRecord();
  saveStorage();
  render();
  focusGuessInput();
}

function loadPuzzle() {
  currentPuzzle = buildPuzzle();
  currentRecord = getRecord();
  render();
  if (currentRecord.done) {
    setMessage(currentRecord.status === "won" ? "Solved." : "Game over.", currentRecord.status === "won" ? "success" : "error");
  } else {
    setMessage("Enter a word that is close enough to your current word.");
  }
  updateTargetGap();
  focusGuessInput();
}

function setArchiveDate(dateId) {
  storage.kind = "archive";
  storage.archiveDate = clampDate(dateId);
  saveStorage();
  loadPuzzle();
}

function newRandomPuzzle() {
  storage.kind = "random";
  storage.randomSeed = createRandomSeed();
  saveStorage();
  loadPuzzle();
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
  const date = currentPuzzle.date || todayId();
  return `The Relating Game ${displayDate(date)} | ${MODES[storage.mode].label} ${steps}/${MAX_STEPS} | ${SHARE_SITE}`;
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
  elements.botToggle.addEventListener("click", toggleBotFight);
  elements.guessForm.addEventListener("submit", handleGuessSubmit);
  elements.undoStep.addEventListener("click", undoStep);
  elements.resetGame.addEventListener("click", resetCurrentGame);
  elements.shareResult.addEventListener("click", shareCurrentResult);
  elements.copyShare.addEventListener("click", shareCurrentResult);
  elements.dialogShare.addEventListener("click", shareCurrentResult);
  elements.dialogClose.addEventListener("click", () => elements.resultDialog.close());
}

async function init() {
  wireEvents();
  elements.archiveDate.min = START_DATE;
  elements.archiveDate.max = todayId();
  storage.archiveDate = clampDate(storage.archiveDate);

  try {
    await loadGameData();
    setStatus("Ready", "ready");
    loadPuzzle();
  } catch (error) {
    setStatus("Error", "error");
    setMessage(error.message || "Could not prepare the puzzle.", "error");
  }
}

init();
