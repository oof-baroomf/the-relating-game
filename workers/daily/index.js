import { getScheduledDailyPuzzle } from "../../src/shared/daily-schedule.js";
import { isPacificMidnight, pacificDateId } from "../../public/shared/pacific-time.js";

function dateIdFromScheduledTime(scheduledTime) {
  return pacificDateId(scheduledTime);
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
    if (!isPacificMidnight(controller.scheduledTime)) return;
    ctx.waitUntil(setDailyPuzzle(env, dateIdFromScheduledTime(controller.scheduledTime)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const today = pacificDateId();
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
