import { readFile } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { buildGitppouConfig } from "@gitppou/core";
import type { Env, GitppouConfig } from "@gitppou/core";
import { parse as parseYaml } from "yaml";

export async function readActionConfig(env: Env = process.env, now = new Date()): Promise<GitppouConfig> {
  const configPath = input("config", "gitppou.yml");
  const rawConfig = await readConfigFile(configPath);

  return buildGitppouConfig(rawConfig, {}, env, now);
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
