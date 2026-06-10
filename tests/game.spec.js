import { expect, test } from "@playwright/test";

test("plays a mocked puzzle through to completion", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog&gap=1");

  await expect(page.getByRole("heading", { name: "The Relating Game" })).toBeVisible();
  await expect(page.locator("#startWord")).toHaveText("cat");
  await expect(page.locator("#targetWord")).toHaveText("dog");
  await expect(page.locator("#modelStatus")).toHaveText("Ready");

  await page.getByRole("button", { name: "Hard" }).click();
  await expect(page.locator("#limitLabel")).toContainText("Hard move limit: 0.25");

  await page.locator("#guessInput").fill("bridge");
  await page.getByRole("button", { name: "Try" }).click();
  await expect(page.locator("#message")).toContainText("Accepted");

  await page.locator("#guessInput").fill("dog");
  await page.getByRole("button", { name: "Try" }).click();

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
  await expect(page.locator("#shareText")).toHaveValue(/Easy 10\/10/);
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

test("embeds uncached dictionary words through the Pages Function", async ({ request }) => {
  const response = await request.post("/api/embed", {
    data: { word: "zymurgy" },
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.word).toBe("zymurgy");
  expect(payload.vector).toHaveLength(50);
  expect(payload.vector.some((value) => value !== 0)).toBeTruthy();
});
