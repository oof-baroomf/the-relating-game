import { expect, test } from "@playwright/test";

test("plays a mocked puzzle through to completion", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog");

  await expect(page.getByRole("heading", { name: "The Relating Game" })).toBeVisible();
  await expect(page.locator("#startWord")).toHaveText("cat");
  await expect(page.locator("#targetWord")).toHaveText("dog");
  await expect(page.locator("#modelStatus")).toContainText("words ready");

  await page.locator("#guessInput").fill("bridge");
  await page.getByRole("button", { name: "Try" }).click();
  await expect(page.locator("#message")).toContainText("Accepted");

  await page.locator("#guessInput").fill("dog");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#resultDialog")).toBeVisible();
  await expect(page.locator("#resultText")).toContainText("cat to dog in 2 steps");
  await expect(page.locator("#shareResult")).toBeEnabled();
});

test("rejects a semantic gap over the selected limit", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog");

  await page.locator("#guessInput").fill("rejecting");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#message")).toContainText("is over the");
  await expect(page.locator(".path-row")).toHaveCount(1);
});

test("rejects guesses outside the dictionary", async ({ page }) => {
  await page.goto("/?mockModel=1&start=cat&target=dog");

  await page.locator("#guessInput").fill("notawordzz");
  await page.getByRole("button", { name: "Try" }).click();

  await expect(page.locator("#message")).toContainText("not in the game dictionary");
  await expect(page.locator(".path-row")).toHaveCount(1);
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
