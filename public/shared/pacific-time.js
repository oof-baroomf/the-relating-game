export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const pacificDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pacificHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

function dateFromValue(value) {
  return value instanceof Date ? value : new Date(value);
}

function partValue(parts, type) {
  return parts.find((part) => part.type === type)?.value || "";
}

export function pacificDateId(value = new Date()) {
  const parts = pacificDateFormatter.formatToParts(dateFromValue(value));
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
}

export function pacificHour(value = new Date()) {
  const parts = pacificHourFormatter.formatToParts(dateFromValue(value));
  return Number(partValue(parts, "hour"));
}

export function isPacificMidnight(value = new Date()) {
  return pacificHour(value) === 0;
}
