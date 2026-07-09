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

  const rerun = isWorkflowRerun(env);
  const tokenCandidates = getWorkflowRunTokenCandidates(rawConfig, env, repository);
  if (tokenCandidates.length === 0) {
    return handleWorkflowRunDateFallback(
      rerun,
      fallbackNow,
      "No GitHub token was available to read workflow run metadata."
    );
  }

  const errors: string[] = [];
  for (const candidate of tokenCandidates) {
    try {
      return await fetchWorkflowRunCreatedAt({
        apiUrl: env.GITHUB_API_URL?.trim() || "https://api.github.com",
        repository,
        runId,
        token: candidate.token
      });
    } catch (error) {
      errors.push(`${candidate.name}: ${formatError(error)}`);
    }
  }

  return handleWorkflowRunDateFallback(
    rerun,
    fallbackNow,
    `Could not resolve original workflow run date. ${errors.join(" ")}`
  );
}

function handleWorkflowRunDateFallback(rerun: boolean, fallbackNow: Date, reason: string): Date {
  const permissionHint =
    "Add permissions.actions: read, use a token with Actions read access, or set report.date explicitly.";

  if (rerun) {
    throw new Error(`${reason} Refusing to use current runner time for a workflow rerun. ${permissionHint}`);
  }

  core.warning(`${reason} Using current runner time. ${permissionHint}`);
  return fallbackNow;
}

function isWorkflowRerun(env: Env): boolean {
  const attempt = Number(env.GITHUB_RUN_ATTEMPT?.trim() || "1");
  return Number.isFinite(attempt) && attempt > 1;
}

function getWorkflowRunTokenCandidates(
  rawConfig: unknown,
  env: Env,
  repository: string
): Array<{ name: string; token: string }> {
  const owner = repository.split("/")[0] ?? "";
  const tokenEnvNames = [
    getConfiguredGitHubTokenEnv(rawConfig),
    getConfiguredGitHubOwnerTokenEnv(rawConfig, owner),
    "GITHUB_TOKEN"
  ].filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  const candidates: Array<{ name: string; token: string }> = [];
  for (const name of tokenEnvNames) {
    if (seen.has(name)) {
      continue;
    }

    seen.add(name);
    const token = env[name]?.trim();
    if (token) {
      candidates.push({ name, token });
    }
  }

  return candidates;
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

function getConfiguredGitHubOwnerTokenEnv(rawConfig: unknown, owner: string): string | undefined {
  if (!owner || !isRecord(rawConfig) || !isRecord(rawConfig.github) || !isRecord(rawConfig.github.tokens)) {
    return undefined;
  }

  const value = rawConfig.github.tokens[owner];
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
