const START_DATE = "2026-06-10";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Expected date as YYYY-MM-DD." }, 422);
  }
  if (date < START_DATE || date > new Date().toISOString().slice(0, 10)) {
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
