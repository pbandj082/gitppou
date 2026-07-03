import type { LlmProviderName, LlmStyle, ReportLanguage } from "./types.js";

export const DEFAULT_REPORT_LANGUAGE: ReportLanguage = "en";
export const DEFAULT_REPORT_TIMEZONE = "Asia/Tokyo";
export const DEFAULT_LLM_PROVIDER: LlmProviderName = "template";
export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_LLM_MAX_INPUT_CHARS = 20_000;
export const DEFAULT_LLM_STYLE: LlmStyle = "concise";

const REPORT_LANGUAGES = new Set<ReportLanguage>(["en", "ja"]);
const LLM_PROVIDERS = new Set<LlmProviderName>(["template", "github-models"]);
const LLM_STYLES = new Set<LlmStyle>(["concise", "detailed"]);

export function parseReportLanguage(value: string): ReportLanguage {
  if (REPORT_LANGUAGES.has(value as ReportLanguage)) {
    return value as ReportLanguage;
  }

  throw new Error(`Unsupported report-language "${value}". Supported values are en and ja.`);
}

export function parseLlmProvider(value: string): LlmProviderName {
  if (LLM_PROVIDERS.has(value as LlmProviderName)) {
    return value as LlmProviderName;
  }

  throw new Error(`Unsupported llm-provider "${value}". Supported values are template and github-models.`);
}

export function parseLlmStyle(value: string): LlmStyle {
  if (LLM_STYLES.has(value as LlmStyle)) {
    return value as LlmStyle;
  }

  throw new Error(`Unsupported llm-style "${value}". Supported values are concise and detailed.`);
}

export function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertValidDateString(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid report-date "${value}". Use YYYY-MM-DD.`);
  }

  const [year, month, day] = parseDateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report-date "${value}". Use a real calendar date.`);
  }
}

export function assertValidTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error(`Invalid report-timezone "${value}". Use an IANA timezone such as Asia/Tokyo.`);
  }
}

export function resolveReportDate(input: string, timeZone: string, now = new Date()): string {
  assertValidTimeZone(timeZone);

  if (input.trim() !== "") {
    assertValidDateString(input.trim());
    return input.trim();
  }

  return formatDateInTimeZone(now, timeZone);
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = getDatePart(parts, "year");
  const month = getDatePart(parts, "month");
  const day = getDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

export function isOnReportDate(isoDate: string | undefined, reportDate: string, timeZone: string): boolean {
  if (!isoDate) {
    return false;
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return formatDateInTimeZone(parsed, timeZone) === reportDate;
}

export function getReportDateRange(reportDate: string, timeZone: string): { since: Date; until: Date } {
  assertValidDateString(reportDate);
  assertValidTimeZone(timeZone);

  const start = zonedDateTimeToUtc(reportDate, timeZone);
  const until = zonedDateTimeToUtc(addDays(reportDate, 1), timeZone);
  return { since: start, until };
}

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((item) => item.type === type)?.value;
  if (!part) {
    throw new Error(`Could not format date part "${type}".`);
  }

  return part;
}

function addDays(reportDate: string, days: number): string {
  const [year, month, day] = parseDateParts(reportDate);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(reportDate: string, timeZone: string): Date {
  const [year, month, day] = parseDateParts(reportDate);
  const wallClockAsUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const firstOffset = getTimeZoneOffsetMs(timeZone, wallClockAsUtc);
  let result = new Date(wallClockAsUtc.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(timeZone, result);

  if (secondOffset !== firstOffset) {
    result = new Date(wallClockAsUtc.getTime() - secondOffset);
  }

  return result;
}

function parseDateParts(value: string): [number, number, number] {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid report-date "${value}". Use YYYY-MM-DD.`);
  }

  return [year, month, day];
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const year = Number(getDatePart(parts, "year"));
  const month = Number(getDatePart(parts, "month"));
  const day = Number(getDatePart(parts, "day"));
  const hour = Number(getDatePart(parts, "hour"));
  const minute = Number(getDatePart(parts, "minute"));
  const second = Number(getDatePart(parts, "second"));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  return asUtc - date.getTime();
}
