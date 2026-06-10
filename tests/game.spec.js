import { expect, test } from "@playwright/test";

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

test("plays a mocked puzzle through to completion", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  await expect(page.getByRole("heading", { name: "The Relating Game" })).toBeVisible();
  await expect(page.locator("#startWord")).toHaveText("cat");
  await expect(page.locator("#targetWord")).toHaveText("dog");
  await expect(page.locator("#modelStatus")).toHaveText("Ready");

  await page.getByRole("button", { name: "Hard" }).click();
  await expect(page.locator("#limitLabel")).toContainText("Hard move limit: 0.33");
  await expect(page.locator("#guessInput")).toBeFocused();

  await page.locator("#guessInput").fill("bridge");
  await page.getByRole("button", { name: "Try" }).click();
  await expect(page.locator("#message")).toContainText("Accepted");
  await expect(page.locator("#guessInput")).toBeFocused();

  await page.locator("#guessInput").fill("dog");
  await page.keyboard.press("Enter");

  await expect(page.locator("#resultDialog")).toBeVisible();
  await expect(page.locator("#resultText")).toContainText("Hard 2/10");
  await expect(page.locator("#shareResult")).toBeEnabled();
  await expect(page.locator("#shareText")).toHaveValue(
    /The Relating Game \d{2}\/\d{2}\/\d{4} \| Hard 2\/10 \| relating-game\.pages\.dev/,
  );
});

test("rejects a semantic gap over the selected limit", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  await page.locator("#guessInput").fill("rejecting");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#message")).toContainText("is over the");
  await expect(page.locator(".path-row")).toHaveCount(1);
});

test("rejects guesses outside the dictionary", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  await page.locator("#guessInput").fill("notawordzz");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#message")).toContainText("not in the game dictionary");
  await expect(page.locator(".path-row")).toHaveCount(1);
});

test("ends after ten accepted non-target steps", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  for (const word of [
    "bridge",
    "water",
    "fire",
    "earth",
    "metal",
    "stone",
    "music",
    "paper",
    "chair",
    "glass",
  ]) {
    await page.locator("#guessInput").fill(word);
    await page.getByRole("button", { name: "Try" }).click();
  }

  await expect(page.locator("#message")).toContainText("Out of steps");
  await expect(page.locator("#guessInput")).toBeDisabled();
  await expect(page.locator("#shareText")).toHaveValue(/Easy X\/10/);
});

test("bot fight lets the bot race after an accepted guess", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  await page.getByRole("button", { name: "Bot fight" }).click();
  await expect(page.locator("#botSection")).toBeVisible();

  await page.locator("#guessInput").fill("bridge");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#message")).toContainText("Bot reached the target first");
  await expect(page.locator("#botStatus")).toContainText("Solved in 1/10");
  await expect(page.locator("#guessInput")).toBeDisabled();
});

test("loads the daily puzzle from the server API", async ({ page, request }) => {
  const today = new Date().toISOString().slice(0, 10);
  const response = await request.get(`/api/puzzle?date=${today}`);
  expect(response.ok()).toBeTruthy();
  const puzzle = await response.json();

  await page.goto("/?mockModel=1");

  await expect(page.locator("#startWord")).toHaveText(puzzle.start);
  await expect(page.locator("#targetWord")).toHaveText(puzzle.target);
  await expect(page.locator("#startGapLabel")).toHaveText(`Start gap: ${puzzle.gap.toFixed(2)}`);
  await expect(page.locator("#guessInput")).toBeFocused();
});

test("returns dictionary word vectors through the Pages Function", async ({ request }) => {
  const response = await request.post("/api/embed", {
    data: { word: "zymurgy" },
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.word).toBe("zymurgy");
  expect(payload.vector).toHaveLength(300);
  expect(payload.vector.some((value) => value !== 0)).toBeTruthy();
});

test("uses real fastText vectors for generated endpoint words", async ({ request }) => {
  const response = await request.post("/api/embed", {
    data: { words: ["sonny", "another"] },
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  const similarity = cosineSimilarity(payload.vectors.sonny, payload.vectors.another);
  expect(1 - similarity).toBeGreaterThan(0.45);
});

test("endpoint data uses a specific but recognizable frequency band", async ({ request }) => {
  const manifestResponse = await request.get("/data/manifest.json");
  const endpointsResponse = await request.get("/data/endpoints.json");
  expect(manifestResponse.ok()).toBeTruthy();
  expect(endpointsResponse.ok()).toBeTruthy();

  const manifest = await manifestResponse.json();
  const endpoints = await endpointsResponse.json();
  expect(manifest.endpointMinFrequencyRank).toBe(10000);
  expect(manifest.endpointMaxFrequencyRank).toBe(45000);
  expect(manifest.vectorDim).toBe(300);
  expect(manifest.vectorWords).toBe(manifest.dictionaryWords);
  expect(endpoints.words.length).toBe(manifest.endpointWords);

  for (const word of ["the", "time", "people", "world", "water", "system", "zyzzyvas"]) {
    expect(endpoints.words).not.toContain(word);
  }
});
