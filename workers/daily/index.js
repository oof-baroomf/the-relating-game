import { getScheduledDailyPuzzle } from "../../src/shared/daily-schedule.js";

function dateIdFromScheduledTime(scheduledTime) {
  return new Date(scheduledTime).toISOString().slice(0, 10);
}

async function setDailyPuzzle(env, date) {
  const puzzle = getScheduledDailyPuzzle(date);
  if (!puzzle) {
    throw new Error(`No scheduled daily puzzle exists for ${date}.`);
  }

  const payload = {
    ...puzzle,
    source: "scheduled-daily",
    setAt: new Date().toISOString(),
  };
  await env.DAILY_PUZZLES.put(`daily:${date}`, JSON.stringify(payload));
  return payload;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(setDailyPuzzle(env, dateIdFromScheduledTime(controller.scheduledTime)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const today = new Date().toISOString().slice(0, 10);
      const puzzle = await env.DAILY_PUZZLES.get(`daily:${today}`, "json");
      return Response.json({
        ok: true,
        today,
        dailySet: Boolean(puzzle),
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
