import { describe, expect, it } from "vitest";
import { generateSlackSummary } from "../slack.js";
import type { GitppouConfig } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [],
  reportDate: "2026-07-06",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "ja",
  reportDir: "reports",
  commitReport: false,
  slackNotify: true,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise"
};

describe("generateSlackSummary", () => {
  it("includes GitHub Actions context when available", () => {
    const summary = generateSlackSummary(
      {
        ...baseConfig,
        githubActionsContext: {
          actor: "octocat",
          eventName: "workflow_dispatch",
          refName: "main",
          repository: "owner/repo",
          runId: "123456789",
          runNumber: "42",
          serverUrl: "https://github.com",
          workflow: "Daily Report"
        }
      },
      [],
      "reports/2026-07/2026-07-06.md"
    );

    expect(summary).toContain("実行:");
    expect(summary).toContain("- 実行者: octocat");
    expect(summary).toContain("- Workflow: Daily Report #42");
    expect(summary).toContain("- Repository: owner/repo (main)");
    expect(summary).toContain("- Event: workflow_dispatch");
    expect(summary).toContain("- URL: https://github.com/owner/repo/actions/runs/123456789");
  });
});
