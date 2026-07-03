import * as core from "@actions/core";
import {
  DEFAULT_LLM_MAX_INPUT_CHARS,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_STYLE,
  DEFAULT_REPORT_LANGUAGE,
  DEFAULT_REPORT_TIMEZONE,
  parseCommaSeparatedList,
  parseLlmProvider,
  parseLlmStyle,
  parseReportLanguage,
  resolveReportDate
} from "@gitppou/core";
import type { GitppouConfig } from "@gitppou/core";

export function readActionConfig(): GitppouConfig {
  const reportTimezone = input("report-timezone", DEFAULT_REPORT_TIMEZONE);
  const reportDate = resolveReportDate(input("report-date", ""), reportTimezone);
  const githubToken = requiredEnv("GITHUB_TOKEN");
  const backlogApiKey = requiredEnv("BACKLOG_API_KEY");
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const backlogUserId = input("backlog-user-id", "");

  return {
    githubToken,
    githubUsername: requiredInput("github-username"),
    githubRepos: parseCommaSeparatedList(input("github-repos", "")),
    backlogApiKey,
    backlogSpace: requiredInput("backlog-space"),
    backlogProjectKeys: parseCommaSeparatedList(input("backlog-project-keys", "")),
    ...(backlogUserId ? { backlogUserId } : {}),
    reportDate,
    reportTimezone,
    reportLanguage: parseReportLanguage(input("report-language", DEFAULT_REPORT_LANGUAGE)),
    reportDir: input("report-dir", "reports"),
    commitReport: parseBoolean(input("commit-report", "false"), "commit-report"),
    slackNotify: parseBoolean(input("slack-notify", "true"), "slack-notify"),
    ...(slackWebhookUrl ? { slackWebhookUrl } : {}),
    llmProvider: parseLlmProvider(input("llm-provider", DEFAULT_LLM_PROVIDER)),
    llmModel: input("llm-model", DEFAULT_LLM_MODEL),
    llmMaxInputChars: parsePositiveInteger(input("llm-max-input-chars", String(DEFAULT_LLM_MAX_INPUT_CHARS)), "llm-max-input-chars"),
    llmStyle: parseLlmStyle(input("llm-style", DEFAULT_LLM_STYLE))
  };
}

function input(name: string, fallback: string): string {
  const value = core.getInput(name).trim();
  return value === "" ? fallback : value;
}

function requiredInput(name: string): string {
  const value = core.getInput(name, { required: true }).trim();
  if (value === "") {
    throw new Error(`Input "${name}" is required.`);
  }

  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Environment variable ${name} is required. Pass it via env from GitHub Actions secrets.`);
  }

  return value;
}

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Input "${name}" must be true or false.`);
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Input "${name}" must be a positive integer.`);
  }

  return parsed;
}
