import { afterEach, describe, expect, it, vi } from "vitest";
import { readActionConfig } from "../config.js";

const { inputs } = vi.hoisted(() => ({
  inputs: new Map<string, string>()
}));
const originalEnv = { ...process.env };

vi.mock("@actions/core", () => ({
  getInput: vi.fn((name: string) => inputs.get(name) ?? ""),
  warning: vi.fn()
}));

afterEach(() => {
  inputs.clear();
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
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

  it("uses the original workflow run creation date when report date is omitted in GitHub Actions", async () => {
    inputs.set("config", "src/__tests__/fixtures/gitppou-without-date.yml");
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_API_URL = "https://api.github.com";
    process.env.GITHUB_REPOSITORY = "owner/report-repo";
    process.env.GITHUB_RUN_ID = "123456";
    process.env.GITHUB_TOKEN = "github-token";

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ created_at: "2026-07-07T15:30:00Z" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = await readActionConfig(process.env, new Date("2026-07-09T00:00:00Z"));

    expect(config.reportDate).toBe("2026-07-08");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/report-repo/actions/runs/123456",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer github-token"
        })
      })
    );
  });

  it("does not query the workflow run when report date is configured explicitly", async () => {
    inputs.set("config", "src/__tests__/fixtures/gitppou.yml");
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_API_URL = "https://api.github.com";
    process.env.GITHUB_REPOSITORY = "owner/report-repo";
    process.env.GITHUB_RUN_ID = "123456";
    process.env.GITHUB_TOKEN = "github-token";
    process.env.BACKLOG_API_KEY = "backlog-key";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const config = await readActionConfig(process.env, new Date("2026-07-09T00:00:00Z"));

    expect(config.reportDate).toBe("2026-07-06");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing config files clearly", async () => {
    inputs.set("config", "missing.yml");

    await expect(readActionConfig()).rejects.toThrow("Config file not found: missing.yml");
  });
});
