import { pacificDateId } from "../../public/shared/pacific-time.js";

const START_DATE = "2026-06-10";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const today = pacificDateId();
  const date = url.searchParams.get("date") || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Expected date as YYYY-MM-DD." }, 422);
  }
  if (date < START_DATE || date > today) {
    return json({ error: "That daily puzzle date is not available." }, 404);
  }

  const puzzle = await env.DAILY_PUZZLES.get(`daily:${date}`, "json");
  if (!puzzle) {
    return json({ error: `Daily puzzle ${date} has not been set by the scheduled job.` }, 404);
  }

  return json({
    date: puzzle.date,
    start: puzzle.start,
    target: puzzle.target,
    gap: puzzle.gap,
    easyPath: Array.isArray(puzzle.easyPath) ? puzzle.easyPath : null,
    hardPath: Array.isArray(puzzle.hardPath) ? puzzle.hardPath : null,
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
