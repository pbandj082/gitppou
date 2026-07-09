import {
  DEFAULT_LLM_MAX_INPUT_CHARS,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_STYLE,
  DEFAULT_REPORT_LANGUAGE,
  DEFAULT_REPORT_TIMEZONE,
  parseLlmProvider,
  parseLlmStyle,
  parseReportLanguage,
  resolveReportDate,
} from "./config.js";
import type {
  BacklogSpaceConfig,
  GitHubActionsContext,
  GitHubRepoOwnerSpec,
  GitHubRepoSort,
  GitHubRepoSpec,
  ReportFormat,
  GitppouConfig,
} from "./types.js";

const MAX_REPO_SELECTOR_LIMIT = 100;

type RawObject = Record<string, unknown>;
export type Env = Record<string, string | undefined>;

export type ConfigBuildOptions = {
  reportDate?: string;
  reportTimezone?: string;
  reportLanguage?: string;
  reportDir?: string;
  llmProvider?: string;
  llmModel?: string;
  llmMaxInputChars?: string;
  llmStyle?: string;
  commitReport?: boolean;
  slackNotify?: boolean;
  requireSlackWebhook?: boolean;
};

export function buildGitppouConfig(
  rawConfig: unknown,
  options: ConfigBuildOptions,
  env: Env,
  now = new Date(),
): GitppouConfig {
  const root = asObject(rawConfig, "config");
  const github = getSection(root, "github");
  const backlog = getSection(root, "backlog");
  const hasBacklogSection = root.backlog !== undefined;
  const report = getSection(root, "report");
  const llm = getSection(root, "llm");
  const slack = getSection(root, "slack");
  const git = getSection(root, "git");
  const githubTokensByOwner = resolveGitHubTokensByOwner(github, env);

  const reportTimezone =
    options.reportTimezone ??
    getString(report, "timezone", "config.report.timezone") ??
    DEFAULT_REPORT_TIMEZONE;
  const reportDate = resolveReportDate(
    options.reportDate ?? getString(report, "date", "config.report.date") ?? "",
    reportTimezone,
    now,
  );
  const llmMaxInputChars = parsePositiveInteger(
    options.llmMaxInputChars ??
      getStringOrNumber(llm, "maxInputChars", "config.llm.maxInputChars") ??
      String(DEFAULT_LLM_MAX_INPUT_CHARS),
    "llm-max-input-chars",
  );
  const slackNotify =
    options.slackNotify ??
    getOptionalBoolean(slack, "notify", "config.slack.notify") ??
    true;
  const backlogEnabled =
    getOptionalBoolean(backlog, "enabled", "config.backlog.enabled") ??
    hasBacklogSection;

  const config: GitppouConfig = {
    githubToken: requiredEnv(
      env,
      getString(github, "tokenEnv", "config.github.tokenEnv") || "GITHUB_TOKEN",
    ),
    githubUsername: requiredString(
      github,
      "username",
      "config.github.username",
    ),
    githubRepos: getGitHubRepoSpecs(github, "repos", "config.github.repos"),
    backlogSpaces: backlogEnabled ? resolveBacklogSpaces(backlog) : [],
    reportDate,
    reportTimezone,
    reportLanguage: parseReportLanguage(
      options.reportLanguage ??
        getString(report, "language", "config.report.language") ??
        DEFAULT_REPORT_LANGUAGE,
    ),
    reportDir:
      options.reportDir ??
      getString(report, "dir", "config.report.dir") ??
      "reports",
    reportFormats: getReportFormats(report),
    reportHtmlDir:
      getString(report, "htmlDir", "config.report.htmlDir") ?? ".gitppou/site",
    commitReport:
      options.commitReport ??
      getOptionalBoolean(git, "commitReport", "config.git.commitReport") ??
      false,
    slackNotify,
    llmProvider: parseLlmProvider(
      options.llmProvider ??
        getString(llm, "provider", "config.llm.provider") ??
        DEFAULT_LLM_PROVIDER,
    ),
    llmModel:
      options.llmModel ??
      getString(llm, "model", "config.llm.model") ??
      DEFAULT_LLM_MODEL,
    llmMaxInputChars,
    llmStyle: parseLlmStyle(
      options.llmStyle ??
        getString(llm, "style", "config.llm.style") ??
        DEFAULT_LLM_STYLE,
    ),
  };

  if (Object.keys(githubTokensByOwner).length > 0) {
    config.githubTokensByOwner = githubTokensByOwner;
  }

  if (backlogEnabled) {
    config.backlogApiKey = requiredEnv(env, "BACKLOG_API_KEY");

    const backlogUserId = getString(backlog, "userId", "config.backlog.userId");
    if (backlogUserId) {
      config.backlogUserId = normalizeBacklogUserId(
        backlogUserId,
        "config.backlog.userId",
      );
    }
  }

  if (config.slackNotify) {
    const slackWebhookUrl = options.requireSlackWebhook
      ? requiredEnv(env, "SLACK_WEBHOOK_URL")
      : env.SLACK_WEBHOOK_URL?.trim();
    if (slackWebhookUrl) {
      config.slackWebhookUrl = slackWebhookUrl;
    }
  }

  const githubActionsContext = resolveGitHubActionsContext(env);
  if (githubActionsContext) {
    config.githubActionsContext = githubActionsContext;
  }

  return config;
}

function getReportFormats(report: RawObject): ReportFormat[] {
  const formats = getStringArray(report, "formats", "config.report.formats");
  if (formats.length === 0) {
    return ["markdown"];
  }

  const parsed = formats.map((format) =>
    parseReportFormat(format, "config.report.formats"),
  );
  return [...new Set(parsed)];
}

function parseReportFormat(value: string, pathLabel: string): ReportFormat {
  if (value === "markdown" || value === "html") {
    return value;
  }

  throw new Error(`${pathLabel} must contain only markdown or html.`);
}

function getSection(root: RawObject, key: string): RawObject {
  const value = root[key];
  if (value === undefined) {
    return {};
  }

  return asObject(value, `config.${key}`);
}

function resolveGitHubActionsContext(
  env: Env,
): GitHubActionsContext | undefined {
  const context = compactObject({
    actor: env.GITHUB_ACTOR?.trim(),
    eventName: env.GITHUB_EVENT_NAME?.trim(),
    refName: env.GITHUB_REF_NAME?.trim(),
    repository: env.GITHUB_REPOSITORY?.trim(),
    runId: env.GITHUB_RUN_ID?.trim(),
    runNumber: env.GITHUB_RUN_NUMBER?.trim(),
    serverUrl: env.GITHUB_SERVER_URL?.trim(),
    workflow: env.GITHUB_WORKFLOW?.trim(),
  });

  return Object.keys(context).length > 0 ? context : undefined;
}

function asObject(value: unknown, pathLabel: string): RawObject {
  if (isObject(value)) {
    return value;
  }

  throw new Error(`${pathLabel} must be an object.`);
}

function requiredString(
  section: RawObject,
  key: string,
  pathLabel: string,
): string {
  const value = getString(section, key, pathLabel);
  if (!value) {
    throw new Error(`${pathLabel} is required.`);
  }

  return value;
}

function getString(
  section: RawObject,
  key: string,
  pathLabel: string,
): string | undefined {
  const value = section[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${pathLabel} must be a string.`);
  }

  return value.trim();
}

function getStringOrNumber(
  section: RawObject,
  key: string,
  pathLabel: string,
): string | undefined {
  const value = section[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  throw new Error(`${pathLabel} must be a string or number.`);
}

function getStringArray(
  section: RawObject,
  key: string,
  pathLabel: string,
): string[] {
  const value = section[key];
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an array of strings.`);
  }

  return value
    .map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`${pathLabel}[${index}] must be a string.`);
      }

      return item.trim();
    })
    .filter(Boolean);
}

function getGitHubRepoSpecs(
  section: RawObject,
  key: string,
  pathLabel: string,
): GitHubRepoSpec[] {
  const value = section[key];
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an array.`);
  }

  return value.map((item, index) =>
    parseGitHubRepoSpec(item, `${pathLabel}[${index}]`),
  );
}

function parseGitHubRepoSpec(
  value: unknown,
  pathLabel: string,
): GitHubRepoSpec {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!isObject(value)) {
    throwInvalidGitHubRepoSpec(pathLabel);
  }

  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throwInvalidGitHubRepoSpec(pathLabel);
  }

  const entry = entries[0];
  if (!entry) {
    throwInvalidGitHubRepoSpec(pathLabel);
  }

  const [key, specValue] = entry;
  if (key === "repo") {
    if (typeof specValue !== "string") {
      throw new Error(`${pathLabel}.repo must be a string.`);
    }

    return {
      repo: requiredString(value, "repo", `${pathLabel}.repo`),
    };
  }

  if (!key.trim() || key.includes("/")) {
    throw new Error(
      `${pathLabel} owner selector key must not be empty or contain "/".`,
    );
  }

  return parseRepoOwnerSpec(key.trim(), specValue, `${pathLabel}.${key}`);
}

function throwInvalidGitHubRepoSpec(pathLabel: string): never {
  throw new Error(
    `${pathLabel} must be one of: "owner/repo", { repo: "owner/repo" }, or { owner: { limit: 20, sort: "pushed" } }. In YAML, indent selector options under the owner key.`,
  );
}

function parseRepoOwnerSpec(
  owner: string,
  value: unknown,
  pathLabel: string,
): GitHubRepoOwnerSpec {
  const selector = value == null ? {} : asObject(value, pathLabel);
  const limit = getOptionalRepoSelectorLimit(
    selector,
    "limit",
    `${pathLabel}.limit`,
  );
  const sort = getGitHubRepoSort(selector, "sort", `${pathLabel}.sort`);
  const includeForks = getOptionalBoolean(
    selector,
    "includeForks",
    `${pathLabel}.includeForks`,
  );
  const includeArchived = getOptionalBoolean(
    selector,
    "includeArchived",
    `${pathLabel}.includeArchived`,
  );
  const spec: GitHubRepoOwnerSpec = {
    owner,
  };

  if (limit !== undefined) {
    spec.limit = limit;
  }

  if (sort !== undefined) {
    spec.sort = sort;
  }

  if (includeForks !== undefined) {
    spec.includeForks = includeForks;
  }

  if (includeArchived !== undefined) {
    spec.includeArchived = includeArchived;
  }

  return spec;
}

function getOptionalRepoSelectorLimit(
  section: RawObject,
  key: string,
  pathLabel: string,
): number | undefined {
  const value = getOptionalPositiveInteger(section, key, pathLabel);
  if (value !== undefined && value > MAX_REPO_SELECTOR_LIMIT) {
    throw new Error(
      `${pathLabel} must be less than or equal to ${MAX_REPO_SELECTOR_LIMIT}.`,
    );
  }

  return value;
}

function getOptionalPositiveInteger(
  section: RawObject,
  key: string,
  pathLabel: string,
): number | undefined {
  const value = section[key];
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${pathLabel} must be a positive integer.`);
  }

  return parsed;
}

function getGitHubRepoSort(
  section: RawObject,
  key: string,
  pathLabel: string,
): GitHubRepoSort | undefined {
  const value = getString(section, key, pathLabel);
  if (value === undefined) {
    return undefined;
  }

  if (["created", "updated", "pushed", "full_name"].includes(value)) {
    return value as GitHubRepoSort;
  }

  throw new Error(
    `${pathLabel} must be created, updated, pushed, or full_name.`,
  );
}

function getOptionalBoolean(
  section: RawObject,
  key: string,
  pathLabel: string,
): boolean | undefined {
  const value = section[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${pathLabel} must be a boolean.`);
  }

  return value;
}

function resolveBacklogSpaces(backlog: RawObject): BacklogSpaceConfig[] {
  if (
    backlog.space !== undefined ||
    backlog.projectKeys !== undefined ||
    backlog.apiKeyEnv !== undefined
  ) {
    throw new Error(
      "config.backlog uses spaces only. Move space settings under config.backlog.spaces.",
    );
  }

  if (backlog.spaces === undefined) {
    throw new Error("config.backlog.spaces is required.");
  }

  return parseBacklogSpaces(backlog.spaces);
}

function parseBacklogSpaces(value: unknown): BacklogSpaceConfig[] {
  const spaces = asObject(value, "config.backlog.spaces");
  const entries = Object.entries(spaces);
  if (entries.length === 0) {
    throw new Error("config.backlog.spaces must contain at least one space.");
  }

  return entries.map(([space, spaceConfig]) => {
    const normalizedSpace = space.trim();
    if (!normalizedSpace || normalizedSpace.includes("/")) {
      throw new Error(
        'config.backlog.spaces keys must not be empty or contain "/".',
      );
    }

    return parseBacklogSpaceConfig(
      normalizedSpace,
      spaceConfig,
      `config.backlog.spaces.${space}`,
    );
  });
}

function parseBacklogSpaceConfig(
  space: string,
  value: unknown,
  pathLabel: string,
): BacklogSpaceConfig {
  const section = value == null ? {} : asObject(value, pathLabel);
  if (section.apiKeyEnv !== undefined || section.userId !== undefined) {
    throw new Error(`${pathLabel} supports host and projectKeys only.`);
  }

  const config: BacklogSpaceConfig = {
    space,
    projectKeys: getStringArray(
      section,
      "projectKeys",
      `${pathLabel}.projectKeys`,
    ),
  };

  const host = getString(section, "host", `${pathLabel}.host`);
  if (host) {
    config.host = normalizeBacklogHost(host, `${pathLabel}.host`);
  }

  return config;
}

function normalizeBacklogHost(value: string, pathLabel: string): string {
  const normalized = value
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .trim();
  if (!normalized || normalized.includes("/") || normalized.includes("?")) {
    throw new Error(
      `${pathLabel} must be a Backlog host such as your-space.backlog.com or your-space.backlog.jp.`,
    );
  }

  return normalized;
}

function normalizeBacklogUserId(value: string, pathLabel: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${pathLabel} must be the numeric Backlog user id, not a user handle or Nulab id. Omit it to use the API key owner from /users/myself.`,
    );
  }

  return value;
}

function getStringRecord(
  section: RawObject,
  key: string,
  pathLabel: string,
): Record<string, string> {
  const value = section[key];
  if (value === undefined) {
    return {};
  }

  if (!isObject(value)) {
    throw new Error(`${pathLabel} must be an object with string values.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      if (typeof entryValue !== "string") {
        throw new Error(`${pathLabel}.${entryKey} must be a string.`);
      }

      const normalizedKey = entryKey.trim();
      const normalizedValue = entryValue.trim();
      if (!normalizedKey || !normalizedValue) {
        throw new Error(`${pathLabel} entries must not be empty.`);
      }

      return [normalizedKey, normalizedValue];
    }),
  );
}

function resolveGitHubTokensByOwner(
  github: RawObject,
  env: Env,
): Record<string, string> {
  const tokenEnvByOwner = getStringRecord(
    github,
    "tokens",
    "config.github.tokens",
  );

  return Object.fromEntries(
    Object.entries(tokenEnvByOwner).map(([owner, envName]) => [
      owner,
      requiredEnv(env, envName),
    ]),
  );
}

function compactObject<T extends Record<string, string | undefined>>(
  value: T,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
}

function requiredEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Environment variable ${name} is required.`);
  }

  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Option "${name}" must be a positive integer.`);
  }

  return parsed;
}

function isObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
