import { describe, expect, it } from "vitest";
import { resolveReportDate } from "../config.js";
import { generateTemplateReport } from "../llm/template.js";
import { buildReportPath } from "../report.js";
import type { GitppouConfig, NormalizedActivity } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [
    {
      space: "example",
      projectKeys: ["APP"]
    }
  ],
  reportDate: "2026-07-06",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "en",
  reportDir: "reports",
  commitReport: false,
  slackNotify: false,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise"
};

describe("report helpers", () => {
  it("builds the monthly report path", () => {
    expect(buildReportPath("reports", "2026-07-03")).toBe("reports/2026-07/2026-07-03.md");
  });

  it("rejects report paths outside the workspace", () => {
    expect(() => buildReportPath("../reports", "2026-07-03")).toThrow("report-dir");
  });

  it("resolves a date from timezone when input is empty", () => {
    const date = resolveReportDate("", "Asia/Tokyo", new Date("2026-07-02T15:30:00Z"));
    expect(date).toBe("2026-07-03");
  });

  it("keeps a blank line after every markdown heading", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "issue",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      url: "https://example.backlog.com/view/APP-1"
    };
    const markdown = generateTemplateReport({
      config: baseConfig,
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity]
        }
      ]
    });
    const lines = markdown.split("\n");

    for (const [index, line] of lines.entries()) {
      if (/^#{1,6} /.test(line)) {
        expect(lines[index + 1]).toBe("");
      }
    }
  });
});
