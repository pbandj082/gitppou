import { readFile } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { buildGitppouConfig } from "@gitppou/core";
import type { Env, GitppouConfig } from "@gitppou/core";
import { parse as parseYaml } from "yaml";

export async function readActionConfig(env: Env = process.env, now = new Date()): Promise<GitppouConfig> {
  const configPath = input("config", "gitppou.yml");
  const rawConfig = await readConfigFile(configPath);
  const reportNow = hasConfiguredReportDate(rawConfig) ? now : await resolveWorkflowRunCreatedAt(rawConfig, env, now);

  return buildGitppouConfig(rawConfig, {}, env, reportNow);
}

function input(name: string, fallback: string): string {
  const value = core.getInput(name).trim();
  return value === "" ? fallback : value;
}

async function readConfigFile(filePath: string): Promise<unknown> {
  const resolvedPath = path.resolve(filePath);
  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(`Config file not found: ${filePath}. Run actions/checkout before gitppou.`);
  }

  try {
    if (/\.ya?ml$/i.test(filePath)) {
      return parseYaml(source) ?? {};
    }

    if (/\.json$/i.test(filePath)) {
      return JSON.parse(source) as unknown;
    }
  } catch (error) {
    throw new Error(`Failed to parse ${resolvedPath}: ${formatError(error)}`);
  }

  throw new Error(`Unsupported config file extension: ${filePath}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveWorkflowRunCreatedAt(rawConfig: unknown, env: Env, fallbackNow: Date): Promise<Date> {
  if (env.GITHUB_ACTIONS !== "true") {
    return fallbackNow;
  }

  const repository = env.GITHUB_REPOSITORY?.trim();
  const runId = env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    return fallbackNow;
  }

  const tokenEnv = getConfiguredGitHubTokenEnv(rawConfig);
  const token = env[tokenEnv]?.trim() || env.GITHUB_TOKEN?.trim();
  if (!token) {
    core.warning(
      `Could not resolve original workflow run date because ${tokenEnv} is not set; using current runner time.`
    );
    return fallbackNow;
  }

  try {
    return await fetchWorkflowRunCreatedAt({
      apiUrl: env.GITHUB_API_URL?.trim() || "https://api.github.com",
      repository,
      runId,
      token
    });
  } catch (error) {
    core.warning(
      `Could not resolve original workflow run date; using current runner time. ${formatError(error)} ` +
        "Add permissions.actions: read if this runs in GitHub Actions."
    );
    return fallbackNow;
  }
}

async function fetchWorkflowRunCreatedAt(options: {
  apiUrl: string;
  repository: string;
  runId: string;
  token: string;
}): Promise<Date> {
  const [owner, repo] = options.repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${options.repository}`);
  }

  const url = `${options.apiUrl.replace(/\/+$/g, "")}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/actions/runs/${encodeURIComponent(options.runId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${options.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    throw new Error(`GET ${url} failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || typeof payload.created_at !== "string") {
    throw new Error("Workflow run response did not include created_at.");
  }

  const createdAt = new Date(payload.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(`Workflow run created_at is invalid: ${payload.created_at}`);
  }

  return createdAt;
}

function hasConfiguredReportDate(rawConfig: unknown): boolean {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.report)) {
    return false;
  }

  return typeof rawConfig.report.date === "string" && rawConfig.report.date.trim() !== "";
}

function getConfiguredGitHubTokenEnv(rawConfig: unknown): string {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.github) || typeof rawConfig.github.tokenEnv !== "string") {
    return "GITHUB_TOKEN";
  }

  return rawConfig.github.tokenEnv.trim() || "GITHUB_TOKEN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
