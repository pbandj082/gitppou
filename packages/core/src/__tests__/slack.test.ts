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
  reportFormats: ["markdown"],
  reportHtmlDir: ".gitppou/site",
  reportPdfDir: ".gitppou/pdf",
  commitReport: false,
  slackNotify: true,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

describe("generateSlackSummary", () => {
  it("links to the generated report file when GitHub Actions context is available", () => {
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
          workflow: "Daily Report",
        },
      },
      ".gitppou/reports/2026-07/2026-07-06.md",
      [
        "# 日報 - 2026-07-06",
        "",
        "## 本日対応したこと",
        "",
        "### APP-1 Login flow",
        "",
        "- PRを更新: APP-1 Login flow",
        "",
        "## 明日やること",
        "",
        "- APP-1 Login flow: ステータス: 処理中",
      ].join("\n"),
      "ログイン導線の修正を進め、PR更新と明日の確認事項を整理しました。",
    );

    expect(summary).toContain("日報 2026-07-06");
    expect(summary).toContain(
      "by octocat / Daily Report #42 / owner/repo (main)",
    );
    expect(summary).toContain(
      [
        "詳細:",
        "- <https://github.com/owner/repo/blob/main/.gitppou/reports/2026-07/2026-07-06.md|.gitppou/reports/2026-07/2026-07-06.md>",
      ].join("\n"),
    );
    expect(summary).toContain(
      "ログイン導線の修正を進め、PR更新と明日の確認事項を整理しました。",
    );
    expect(summary).not.toContain("- APP-1 Login flow");
    expect(summary).not.toContain("actions/runs/123456789");
    expect(summary).not.toContain("課題・相談:");
  });

  it("lists every generated report file link", () => {
    const summary = generateSlackSummary(
      {
        ...baseConfig,
        githubActionsContext: {
          refName: "main",
          repository: "owner/repo",
          serverUrl: "https://github.com",
        },
      },
      [
        ".gitppou/reports/2026-07/2026-07-06.md",
        ".gitppou/site/2026-07/2026-07-06.html",
        ".gitppou/pdf/2026-07/2026-07-06.pdf",
      ],
      [
        "# 日報 - 2026-07-06",
        "",
        "## 本日対応したこと",
        "",
        "### APP-1 Login flow",
      ].join("\n"),
    );

    expect(summary).toContain(
      "- <https://github.com/owner/repo/blob/main/.gitppou/reports/2026-07/2026-07-06.md|.gitppou/reports/2026-07/2026-07-06.md>",
    );
    expect(summary).toContain(
      "- <https://github.com/owner/repo/blob/main/.gitppou/site/2026-07/2026-07-06.html|.gitppou/site/2026-07/2026-07-06.html>",
    );
    expect(summary).toContain(
      "- <https://github.com/owner/repo/blob/main/.gitppou/pdf/2026-07/2026-07-06.pdf|.gitppou/pdf/2026-07/2026-07-06.pdf>",
    );
  });

  it("uses plain heading text when local summaries read linked headings", () => {
    const summary = generateSlackSummary(
      baseConfig,
      ".gitppou/reports/2026-07/2026-07-06.md",
      [
        "# 日報 - 2026-07-06",
        "",
        "## 本日対応したこと",
        "",
        "### [APP-1 Login flow](https://example.backlog.com/view/APP-1)",
        "",
        "- PRを更新: APP-1 Login flow",
        "",
        "## 明日やること",
        "",
        "- APP-1 Login flow: ステータス: 処理中",
      ].join("\n"),
    );

    expect(summary).toContain("本日はAPP-1 Login flowを中心に対応しました。");
    expect(summary).not.toContain("[APP-1 Login flow]");
    expect(summary).not.toContain("https://example.backlog.com/view/APP-1");
  });
});
