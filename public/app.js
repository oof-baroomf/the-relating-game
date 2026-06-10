const DICTIONARY_URL = "./data/dictionary.txt";
const ENDPOINTS_URL = "./data/endpoints.json";
const EMBEDDINGS_URL = "./data/embeddings.json";
const MANIFEST_URL = "./data/manifest.json";
const EMBED_API_URL = "./api/embed";
const STORAGE_KEY = "the-relating-game:v2";
const START_DATE = "2026-06-10";

const MODES = {
  easy: {
    label: "Easy",
    gapLimit: 0.68,
  },
  hard: {
    label: "Hard",
    gapLimit: 0.55,
  },
};

const MIN_PAIR_GAP = 0.72;
const MAX_PAIR_GAP = 0.88;
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
  targetGap: document.querySelector("#targetGap"),
  targetGapBar: document.querySelector("#targetGapBar"),
  guessForm: document.querySelector("#guessForm"),
  guessInput: document.querySelector("#guessInput"),
  submitGuess: document.querySelector("#submitGuess"),
  message: document.querySelector("#message"),
  puzzleLabel: document.querySelector("#puzzleLabel"),
  limitLabel: document.querySelector("#limitLabel"),
  stepLabel: document.querySelector("#stepLabel"),
  pathList: document.querySelector("#pathList"),
  undoStep: document.querySelector("#undoStep"),
  resetGame: document.querySelector("#resetGame"),
  shareResult: document.querySelector("#shareResult"),
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
let currentPuzzle = null;
let currentRecord = null;
let targetGapRequest = 0;
const vectorCache = new Map();

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
  return formatDateId(new Date());
}

function formatDateId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateId(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateFromId(dateId) {
  const [year, month, day] = dateId.split("-").map(Number);
  return new Date(year, month - 1, day);
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
    return { start: forcedStart, target: forcedTarget };
  }

  const random = mulberry32(hashString(seedText));
  let fallback = null;

  for (let attempt = 0; attempt < 800; attempt += 1) {
    const start = endpoints[Math.floor(random() * endpoints.length)];
    const target = endpoints[Math.floor(random() * endpoints.length)];
    if (!start || !target || start === target) continue;

    const score = scoreCachedPair(start, target);
    if (!score) continue;
    const gap = Math.max(0, 1 - score.similarity);
    if (!fallback || Math.abs(gap - 0.8) < Math.abs(fallback.gap - 0.8)) {
      fallback = { start, target, gap };
    }
    if (gap >= MIN_PAIR_GAP && gap <= MAX_PAIR_GAP) {
      return { start, target };
    }
  }

  if (fallback) return { start: fallback.start, target: fallback.target };
  return {
    start: endpoints[0] || "time",
    target: endpoints[1] || "world",
  };
}

function scoreCachedPair(from, to) {
  const fromVector = getCachedVector(from);
  const toVector = getCachedVector(to);
  if (!fromVector || !toVector) return null;
  return {
    similarity: cosineSimilarity(fromVector, toVector),
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
    key: `${kind}:${date || randomSeed}:${pair.start}:${pair.target}`,
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

function getRecord() {
  const key = gameKey();
  const saved = storage.games[key];
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
      completedAt: saved.completedAt || "",
    };
  }
  return {
    path: [currentPuzzle.start],
    scores: [],
    done: false,
    completedAt: "",
  };
}

function persistRecord() {
  storage.games[gameKey()] = currentRecord;
  saveStorage();
}

async function loadGameData() {
  setStatus("Loading word list");
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
  endpoints = await endpointsResponse.json();
  manifest = await manifestResponse.json();
  loadEmbeddingTable(await embeddingsResponse.json());

  if (dictionary.size < 1000 || endpoints.length < 100) {
    throw new Error("Game data did not contain enough words.");
  }
}

function loadEmbeddingTable(data) {
  embeddingDim = data.dim;
  embeddingScale = data.scale;
  embeddingBytes = decodeBase64Int8(data.vectors);
  embeddingWords = new Map(data.words.map((word, index) => [word, index]));
}

function decodeBase64Int8(value) {
  const binary = atob(value);
  const bytes = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getCachedVector(term) {
  if (USE_MOCK_MODEL) return mockEmbed(term);
  const cached = vectorCache.get(term);
  if (cached) return cached;

  const rowIndex = embeddingWords.get(term);
  if (rowIndex === undefined) return null;

  const start = rowIndex * embeddingDim;
  const row = embeddingBytes.subarray(start, start + embeddingDim);
  const vector = normalizeVector(
    Array.from(row, (value) => value / embeddingScale),
  );
  vectorCache.set(term, vector);
  return vector;
}

async function getVector(term) {
  const normalized = normalizeTerm(term);
  const cached = getCachedVector(normalized);
  if (cached) return cached;

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
  const mode = MODES[storage.mode];
  const steps = Math.max(0, currentRecord.path.length - 1);
  const kindLabel =
    currentPuzzle.kind === "daily"
      ? `Daily ${currentPuzzle.date}`
      : currentPuzzle.kind === "archive"
        ? `Archive ${currentPuzzle.date}`
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
  elements.puzzleLabel.textContent = kindLabel;
  elements.limitLabel.textContent = `Gap limit: ${mode.gapLimit.toFixed(2)}`;
  elements.stepLabel.textContent = `${steps} ${steps === 1 ? "step" : "steps"}`;

  elements.guessInput.disabled = currentRecord.done;
  elements.submitGuess.disabled = currentRecord.done;
  elements.undoStep.disabled = currentRecord.done || currentRecord.path.length <= 1;
  elements.resetGame.disabled = currentRecord.path.length <= 1 && !currentRecord.done;
  elements.shareResult.disabled = !currentRecord.done;

  elements.pathList.replaceChildren(
    ...currentRecord.path.map((term, index) => createPathRow(term, index)),
  );

  renderStats();
}

function createPathRow(term, index) {
  const item = document.createElement("li");
  item.className = "path-row";

  const word = document.createElement("span");
  word.className = "path-word";
  word.textContent = term;

  const meta = document.createElement("span");
  meta.className = "path-meta";
  if (index === 0) {
    meta.textContent = "start";
  } else {
    const score = currentRecord.scores[index - 1];
    const isTarget = term === currentPuzzle.target;
    meta.classList.add(isTarget ? "target-hit" : "pass");
    meta.textContent = score ? `gap ${score.gap.toFixed(2)}` : "gap ...";
  }

  item.append(word, meta);
  return item;
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
  const mode = MODES[storage.mode];
  const percent = Math.min(100, Math.round((gap / mode.gapLimit) * 100));
  elements.targetGap.textContent = gap.toFixed(2);
  elements.targetGapBar.style.width = `${percent}%`;
  elements.targetGapBar.className =
    gap <= mode.gapLimit
      ? ""
      : gap <= mode.gapLimit * 1.18
        ? "warning"
        : "blocked";
}

async function handleGuessSubmit(event) {
  event.preventDefault();
  if (!currentPuzzle || currentRecord.done) return;

  const term = normalizeTerm(elements.guessInput.value);
  const previous = currentRecord.path[currentRecord.path.length - 1];
  const mode = MODES[storage.mode];

  if (!isWordShape(term)) {
    setMessage("Enter one dictionary word, using only letters.", "error");
    return;
  }
  if (!dictionary.has(term)) {
    setMessage("That word is not in the game dictionary.", "error");
    return;
  }
  if (term === previous) {
    setMessage("That is already your current word.", "error");
    return;
  }
  if (currentRecord.path.includes(term)) {
    setMessage("Use each step once.", "error");
    return;
  }

  setBusy(true);
  const scoringMessage = embeddingWords.has(term)
    ? `Checking ${previous} to ${term}.`
    : `Checking ${previous} to ${term} with the edge subword model.`;
  setMessage(scoringMessage);

  try {
    const score = await scorePair(previous, term);
    if (score.gap > mode.gapLimit + 0.000001) {
      setMessage(
        `Gap ${score.gap.toFixed(2)} is over the ${mode.gapLimit.toFixed(2)} limit.`,
        "error",
      );
      return;
    }

    currentRecord.path.push(term);
    currentRecord.scores.push({
      from: previous,
      to: term,
      similarity: roundScore(score.similarity),
      gap: roundScore(score.gap),
      at: new Date().toISOString(),
    });

    elements.guessInput.value = "";

    if (term === currentPuzzle.target) {
      finishGame();
      setMessage("Solved.", "success");
      showResultDialog();
    } else {
      setMessage(`Accepted with gap ${score.gap.toFixed(2)}.`, "success");
    }

    persistRecord();
    render();
    updateTargetGap();
  } catch (error) {
    setMessage(error.message || "Could not score that step.", "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  if (currentRecord.done) return;
  elements.guessInput.disabled = isBusy;
  elements.submitGuess.disabled = isBusy;
  elements.submitGuess.textContent = isBusy ? "..." : "Try";
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}

function finishGame() {
  if (currentRecord.done) return;
  const steps = currentRecord.path.length - 1;
  currentRecord.done = true;
  currentRecord.completedAt = new Date().toISOString();

  const stats = storage.stats[storage.mode];
  stats.played += 1;
  stats.wins += 1;
  stats.totalSteps += steps;
  stats.best = stats.best === null ? steps : Math.min(stats.best, steps);
}

function showResultDialog() {
  const steps = currentRecord.path.length - 1;
  elements.resultTitle.textContent = "Solved";
  elements.resultText.textContent =
    `${currentPuzzle.start} to ${currentPuzzle.target} in ` +
    `${steps} ${steps === 1 ? "step" : "steps"} on ${MODES[storage.mode].label}.`;
  if (typeof elements.resultDialog.showModal === "function") {
    elements.resultDialog.showModal();
  }
}

function resetCurrentGame() {
  currentRecord = {
    path: [currentPuzzle.start],
    scores: [],
    done: false,
    completedAt: "",
  };
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

function loadPuzzle() {
  currentPuzzle = buildPuzzle();
  currentRecord = getRecord();
  render();
  if (currentRecord.done) {
    setMessage("Solved.", "success");
  } else {
    setMessage("Find the shortest path you can.");
  }
  updateTargetGap();
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
    setMessage(text);
  }
}

function buildShareText() {
  const steps = currentRecord.path.length - 1;
  const title =
    currentPuzzle.kind === "random"
      ? "The Relating Game random"
      : `The Relating Game ${currentPuzzle.date}`;
  const gaps = currentRecord.scores
    .map((score) => score.gap.toFixed(2))
    .join(" ");
  return [
    `${title} ${MODES[storage.mode].label.toLowerCase()}`,
    `${currentPuzzle.start} -> ${currentPuzzle.target}`,
    `${steps} ${steps === 1 ? "step" : "steps"}`,
    `gaps ${gaps}`,
  ].join("\n");
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
  elements.shareResult.addEventListener("click", shareCurrentResult);
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
    const count = manifest?.dictionaryWords?.toLocaleString() || dictionary.size;
    setStatus(`${count} words ready`, "ready");
    loadPuzzle();
  } catch (error) {
    setStatus("Data error", "error");
    setMessage(error.message || "Could not prepare the puzzle.", "error");
  }
}

init();
