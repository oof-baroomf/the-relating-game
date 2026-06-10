import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getScheduledDailyPuzzle } from "../src/shared/daily-schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const local = args.includes("--local");
const dateArg = args.find((arg) => arg.startsWith("--date="));
const date = dateArg ? dateArg.slice("--date=".length) : new Date().toISOString().slice(0, 10);
const puzzle = getScheduledDailyPuzzle(date);

if (!puzzle) {
  throw new Error(`No scheduled daily puzzle exists for ${date}.`);
}

const payload = {
  ...puzzle,
  source: "scheduled-daily",
  setAt: new Date().toISOString(),
};
const tempDir = await mkdtemp(path.join(os.tmpdir(), "relating-daily-"));
const tempPath = path.join(tempDir, "puzzle.json");

try {
  await writeFile(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
  const commandArgs = [
    "wrangler",
    "kv",
    "key",
    "put",
    `daily:${date}`,
    "--path",
    tempPath,
    "--binding",
    "DAILY_PUZZLES",
    "--config",
    "wrangler.toml",
    local ? "--local" : "--remote",
  ];
  const result = spawnSync("npx", commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(JSON.stringify({ key: `daily:${date}`, local, puzzle }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
