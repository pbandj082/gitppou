import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { buildGitppouConfig } from "@gitppou/core";
import type { ConfigBuildOptions, Env, GitppouConfig } from "@gitppou/core";
import { parse as parseDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";

const DEFAULT_CONFIG_PATHS = [
  "gitppou.local.yml",
  "gitppou.local.yaml",
  "gitppou.local.json",
  "gitppou.yml",
  "gitppou.yaml",
  "gitppou.json"
];

export type PreviewConfigOptions = ConfigBuildOptions & {
  configPath?: string;
  envFilePath?: string;
};

export type LoadedPreviewConfig = {
  configPath: string;
  config: GitppouConfig;
};

export async function loadPreviewConfig(
  options: PreviewConfigOptions,
  env: Env = process.env,
  now = new Date()
): Promise<LoadedPreviewConfig> {
  const configPath = await resolveConfigPath(options.configPath);
  const previewEnv = await loadPreviewEnv(options.envFilePath, env);
  const rawConfig = await readConfigFile(configPath);

  return {
    configPath,
    config: buildPreviewConfig(rawConfig, options, previewEnv, now)
  };
}

export async function loadPreviewEnv(envFilePath: string | undefined, env: Env = process.env): Promise<Env> {
  const baseEnv = getDefinedEnv(env);
  if (!envFilePath) {
    return baseEnv;
  }

  const resolvedEnvFilePath = path.resolve(envFilePath);
  let source: string;
  try {
    source = await readFile(resolvedEnvFilePath, "utf8");
  } catch {
    throw new Error(`Env file not found: ${envFilePath}`);
  }

  try {
    return {
      ...parseDotenv(source),
      ...baseEnv
    };
  } catch (error) {
    throw new Error(`Failed to parse ${resolvedEnvFilePath}: ${formatError(error)}`);
  }
}

export function buildPreviewConfig(
  rawConfig: unknown,
  options: PreviewConfigOptions,
  env: Env,
  now = new Date()
): GitppouConfig {
  return buildGitppouConfig(
    rawConfig,
    {
      ...options,
      commitReport: false,
      slackNotify: Boolean(options.slackNotify),
      requireSlackWebhook: Boolean(options.slackNotify)
    },
    env,
    now
  );
}

async function resolveConfigPath(explicitPath: string | undefined): Promise<string> {
  if (explicitPath) {
    await assertFileExists(explicitPath);
    return path.resolve(explicitPath);
  }

  for (const configPath of DEFAULT_CONFIG_PATHS) {
    try {
      await access(configPath);
      return path.resolve(configPath);
    } catch {
      // Try the next default path.
    }
  }

  throw new Error("Config file not found. Create gitppou.local.yml or pass --config <path>.");
}

async function assertFileExists(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Config file not found: ${filePath}`);
  }
}

async function readConfigFile(filePath: string): Promise<unknown> {
  const source = await readFile(filePath, "utf8");

  try {
    if (/\.ya?ml$/i.test(filePath)) {
      return parseYaml(source) ?? {};
    }

    if (/\.json$/i.test(filePath)) {
      return JSON.parse(source) as unknown;
    }
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${formatError(error)}`);
  }

  throw new Error(`Unsupported config file extension: ${filePath}`);
}

function getDefinedEnv(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
