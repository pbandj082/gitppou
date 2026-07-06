import { afterEach, describe, expect, it, vi } from "vitest";
import { readActionConfig } from "../config.js";

const { inputs } = vi.hoisted(() => ({
  inputs: new Map<string, string>()
}));
const originalEnv = { ...process.env };

vi.mock("@actions/core", () => ({
  getInput: vi.fn((name: string) => inputs.get(name) ?? "")
}));

afterEach(() => {
  inputs.clear();
  process.env = { ...originalEnv };
});

describe("readActionConfig", () => {
  it("builds config from a YAML file", async () => {
    inputs.set("config", "src/__tests__/fixtures/gitppou.yml");
    process.env.GITHUB_TOKEN = "github-token";
    process.env.BACKLOG_API_KEY = "backlog-key";

    const config = await readActionConfig();

    expect(config).toMatchObject({
      githubToken: "github-token",
      githubUsername: "octocat",
      githubRepos: ["owner/repo"],
      backlogApiKey: "backlog-key",
      backlogUserId: "123",
      backlogSpaces: [
        {
          space: "space-a",
          projectKeys: ["APP", "WEB"]
        },
        {
          space: "space-b",
          projectKeys: ["OPS"]
        }
      ],
      reportDate: "2026-07-06",
      reportLanguage: "ja",
      commitReport: true,
      slackNotify: false,
      llmProvider: "template"
    });
  });

  it("reports missing config files clearly", async () => {
    inputs.set("config", "missing.yml");

    await expect(readActionConfig()).rejects.toThrow("Config file not found: missing.yml");
  });
});
