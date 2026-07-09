import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveReportDate } from "../config.js";
import { renderReportHtml } from "../html.js";
import { generateTemplateReport } from "../llm/template.js";
import {
  buildReportHtmlPath,
  buildReportPath,
  buildReportPdfPath,
  generateDailyReport,
} from "../report.js";
import type { GitppouConfig, NormalizedActivity } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [
    {
      space: "example",
      projectKeys: ["APP"],
    },
  ],
  reportDate: "2026-07-06",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "en",
  reportDir: "reports",
  reportFormats: ["markdown"],
  reportHtmlDir: ".gitppou/site",
  reportPdfDir: ".gitppou/pdf",
  commitReport: false,
  slackNotify: false,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

describe("report helpers", () => {
  it("builds the monthly report path", () => {
    expect(buildReportPath("reports", "2026-07-03")).toBe(
      "reports/2026-07/2026-07-03.md",
    );
  });

  it("builds the monthly HTML report path", () => {
    expect(buildReportHtmlPath(".gitppou/site", "2026-07-03")).toBe(
      ".gitppou/site/2026-07/2026-07-03.html",
    );
  });

  it("builds the monthly PDF report path", () => {
    expect(buildReportPdfPath(".gitppou/pdf", "2026-07-03")).toBe(
      ".gitppou/pdf/2026-07/2026-07-03.pdf",
    );
  });

  it("rejects report paths outside the workspace", () => {
    expect(() => buildReportPath("../reports", "2026-07-03")).toThrow(
      "report-dir",
    );
  });

  it("rejects HTML report paths outside the workspace", () => {
    expect(() => buildReportHtmlPath("../site", "2026-07-03")).toThrow(
      "report.htmlDir",
    );
  });

  it("rejects PDF report paths outside the workspace", () => {
    expect(() => buildReportPdfPath("../pdf", "2026-07-03")).toThrow(
      "report.pdfDir",
    );
  });

  it("renders Markdown reports to HTML with escaped raw HTML and Mermaid blocks", () => {
    const html = renderReportHtml(
      [
        "# Daily Report",
        "",
        "<script>alert(1)</script>",
        "",
        "```mermaid",
        "gantt",
        "  title Progress",
        "```",
      ].join("\n"),
      baseConfig,
    );

    expect(html).toContain("<title>Daily Report - 2026-07-06</title>");
    expect(html).toContain("Noto+Sans+JP");
    expect(html).toContain('"Noto Sans JP"');
    expect(html).toContain("themeVariables");
    expect(html).toContain(".mermaid text");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('<pre class="mermaid">gantt');
  });

  it("resolves a date from timezone when input is empty", () => {
    const date = resolveReportDate(
      "",
      "Asia/Tokyo",
      new Date("2026-07-02T15:30:00Z"),
    );
    expect(date).toBe("2026-07-03");
  });

  it("adds YAML front matter metadata to generated reports", async () => {
    await mkdir(".gitppou/test-reports", { recursive: true });
    const reportDir = await mkdtemp(".gitppou/test-reports/front-matter-");

    try {
      const result = await generateDailyReport(
        {
          ...baseConfig,
          githubRepos: [],
          backlogSpaces: [],
          reportDir,
          githubActionsContext: {
            actor: "hubot",
            eventName: "workflow_dispatch",
            refName: "main",
            repository: "owner/repo",
            runId: "123",
            runNumber: "42",
            workflow: "Daily Report",
          },
        },
        new Date("2026-07-06T10:00:00Z"),
      );

      expect(result.reportMarkdown).toMatch(
        /^---\nreportDate: "2026-07-06"\ntimezone: "Asia\/Tokyo"\nauthor: "octocat"\ngeneratedBy: "hubot"\ngeneratedAt: "2026-07-06T10:00:00.000Z"\ngenerator: "gitppou"\nrepository: "owner\/repo"\nref: "main"\nworkflow: "Daily Report"\nrunId: "123"\nrunNumber: "42"\neventName: "workflow_dispatch"\n---\n\n# Daily Report - 2026-07-06/,
      );
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  });

  it("keeps a blank line after every markdown heading", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "issue",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      url: "https://example.backlog.com/view/APP-1",
    };
    const markdown = generateTemplateReport({
      config: baseConfig,
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });
    const lines = markdown.split("\n");

    for (const [index, line] of lines.entries()) {
      if (/^#{1,6} /.test(line)) {
        expect(lines[index + 1]).toBe("");
      }
    }
  });

  it("links Backlog issue headings to the Backlog issue URL", () => {
    const githubActivity: NormalizedActivity = {
      source: "github",
      kind: "commit",
      issueKey: "APP-1",
      title: "refine report output",
      repository: "owner/repo",
    };
    const backlogContext: NormalizedActivity = {
      source: "backlog",
      kind: "assigned_issue",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      url: "https://example.backlog.com/view/APP-1#comment-123",
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [githubActivity, backlogContext],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [githubActivity],
        },
      ],
    });

    expect(markdown).toContain(
      "### [APP-1 Updated issue](https://example.backlog.com/view/APP-1)",
    );
    expect(markdown).not.toContain(
      "### [APP-1 Updated issue](https://example.backlog.com/view/APP-1#comment-123)",
    );
  });

  it("renders an issue summary between metadata and activity bullets", () => {
    const pullRequest: NormalizedActivity = {
      source: "github",
      kind: "pull_request",
      issueKey: "APP-1",
      title: "APP-1 Update login flow",
    };
    const comment: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "確認しました。",
    };
    const statusChange: NormalizedActivity = {
      source: "backlog",
      kind: "status_change",
      issueKey: "APP-1",
      title: "APP-1 status changed: Updated issue",
      metadata: {
        issueType: "Task",
        categories: ["Backend"],
        originalValue: "確認依頼",
        newValue: "処理済み",
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [pullRequest, comment, statusChange],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [pullRequest, comment, statusChange],
        },
      ],
    });

    expect(markdown).toContain(
      [
        "**種別:** Task / **カテゴリー:** Backend",
        "",
        "この課題では、GitHubで「Update login flow」を中心にPR更新、Backlogで「確認しました」と「ステータスを確認依頼から処理済みへ変更」を中心にコメント対応とステータス変更を行いました。",
        "",
        "- PRを更新: APP-1 Update login flow",
      ].join("\n"),
    );
  });

  it("describes Backlog status changes explicitly in Japanese", () => {
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [
        {
          source: "backlog",
          kind: "status_change",
          issueKey: "APP-1",
          title: "APP-1 status changed: Updated issue",
          metadata: {
            issueType: "Task",
            categories: ["Backend", "Security"],
            status: "処理済み",
            priority: "High",
            dueDate: "2026-07-08T00:00:00Z",
            originalValue: "確認依頼",
            newValue: "処理済み",
          },
        },
      ],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [
            {
              source: "backlog",
              kind: "status_change",
              issueKey: "APP-1",
              title: "APP-1 status changed: Updated issue",
              metadata: {
                issueType: "Task",
                categories: ["Backend", "Security"],
                status: "処理済み",
                priority: "High",
                dueDate: "2026-07-08T00:00:00Z",
                originalValue: "確認依頼",
                newValue: "処理済み",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toContain(
      [
        "### APP-1 Updated issue",
        "",
        "**種別:** Task / **カテゴリー:** Backend, Security",
      ].join("\n"),
    );
    expect(markdown).not.toContain("| 種別 | カテゴリー |");
    expect(markdown).not.toContain("**優先度:**");
    expect(markdown).not.toContain("**期限:**");
    expect(markdown).toContain(
      "- ステータスを「確認依頼」から「処理済み」に変更",
    );
    expect(markdown).not.toContain(
      "- APP-1: ステータスを「確認依頼」から「処理済み」に変更",
    );
    expect(markdown).toContain(
      "APP-1: ステータス: 処理済み。GitHub 0件、Backlog 1件。",
    );
    expect(markdown).not.toContain(
      "APP-1: 種別: Task、カテゴリー: Backend, Security",
    );
    expect(markdown).not.toContain("Backlog課題を確認");
    expect(markdown).not.toContain("## 課題・相談事項");
  });

  it("describes confirmation comments with the current issue context", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "@alice 確認しました！",
      url: "https://example.backlog.com/view/APP-1",
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain(
      [
        "- この課題について確認コメントを追加",
        "",
        "  > **投稿コメント**",
        "  > @alice 確認しました！",
      ].join("\n"),
    );
    expect(markdown).not.toContain("- APP-1: コメントを追加");
    expect(markdown).not.toContain("## 課題・相談事項");
  });

  it("describes confirmation comments with their previous comment context", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "確認しました！",
      url: "https://example.backlog.com/view/APP-1#comment-901",
      metadata: {
        commentContext: {
          previousComments: [
            {
              id: 900,
              author: "@Reviewer",
              createdAt: "2026-07-06T09:00:00+09:00",
              body: "@alice ログイン後に二重遷移しないか確認をお願いします。",
            },
          ],
        },
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain(
      "- 関連コメント（発言者: Reviewer）の確認依頼「ログイン後に二重遷移しないか」に対して確認コメントを追加",
    );
    expect(markdown).toContain(
      [
        "  > **関連コメント（発言者: Reviewer / 2026-07-06T09:00:00+09:00）**",
        "  > @alice ログイン後に二重遷移しないか確認をお願いします。",
        "",
        "  > **投稿コメント**",
        "  > 確認しました！",
      ].join("\n"),
    );
    expect(markdown).not.toContain("発言者: @Reviewer");
    expect(markdown).not.toContain("- この課題について確認コメントを追加");
  });

  it("does not treat low-signal previous confirmations as reply context", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "@Reviewer 実装を更新しました。ご確認お願いいたします。",
      url: "https://example.backlog.com/view/APP-1#comment-902",
      metadata: {
        commentContext: {
          previousComments: [
            {
              id: 901,
              author: "@Reviewer",
              createdAt: "2026-07-01T09:00:00+09:00",
              body: "@alice 確認しました！",
            },
          ],
        },
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain("- この課題についてコメントを追加");
    expect(markdown).toContain("  > **投稿コメント**");
    expect(markdown).not.toContain("関連コメント");
    expect(markdown).not.toContain("@alice 確認しました");
  });

  it("does not treat previous comments by the same speaker as reply context", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "@Reviewer 修正を追加しました。",
      metadata: {
        author: "Alice",
        commentContext: {
          previousComments: [
            {
              id: 901,
              author: "@Alice",
              createdAt: "2026-07-01T09:00:00+09:00",
              body: "@Reviewer 先に調査結果を共有しました。",
            },
          ],
        },
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain("- この課題についてコメントを追加");
    expect(markdown).not.toContain("関連コメント");
    expect(markdown).not.toContain("先に調査結果を共有");
  });

  it("renders URLs in comments as Markdown links", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-1",
      title: "APP-1 Updated issue",
      body: "PRを確認しました https://github.com/owner/repo/pull/1。",
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Updated issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain(
      "  > PRを確認しました [リンク](https://github.com/owner/repo/pull/1)。",
    );
    expect(markdown).not.toContain("https://github.com/owner/repo/pull/1。");
  });

  it("renders pull request diff stats", () => {
    const activity: NormalizedActivity = {
      source: "github",
      kind: "pull_request",
      title: "APP-1 Update login flow",
      repository: "owner/repo",
      metadata: {
        additions: 120,
        deletions: 32,
        changedFiles: 4,
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Update login flow",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain(
      "- PRを更新: APP-1 Update login flow（+120 / -32、4 files）",
    );
  });

  it("keeps the issue key when an activity belongs to a different issue than the group", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "comment",
      issueKey: "APP-2",
      title: "APP-2 Child issue",
      body: "関連する子課題を更新しました。",
      url: "https://example.backlog.com/view/APP-2",
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Parent issue",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain(
      [
        "- APP-2: 「Child issue」についてコメントを追加",
        "",
        "  > **投稿コメント**",
        "  > 関連する子課題を更新しました。",
      ].join("\n"),
    );
  });

  it("does not render context-only Backlog issue updates as work", () => {
    const activity: NormalizedActivity = {
      source: "backlog",
      kind: "issue",
      issueKey: "APP-1",
      title: "APP-1 Context-only issue update",
      url: "https://example.backlog.com/view/APP-1",
    };
    const markdown = generateTemplateReport({
      config: baseConfig,
      activities: [activity],
      groups: [
        {
          issueKey: "APP-1",
          title: "Context-only issue update",
          activities: [activity],
        },
      ],
    });

    expect(markdown).toContain("- No user action was found for this date.");
    expect(markdown).not.toContain("Backlog issue updated");
    expect(markdown).toContain("- Issue: APP-1 Context-only issue update");
  });

  it("renders assigned Backlog issues as a Mermaid gantt progress chart", () => {
    const laterActivity: NormalizedActivity = {
      source: "backlog",
      kind: "assigned_issue",
      issueKey: "APP-1",
      title: "APP-1 Assigned issue",
      metadata: {
        status: "処理中",
        dueDate: "2026-07-08",
        milestones: ["Sprint 2"],
      },
    };
    const earlierActivity: NormalizedActivity = {
      source: "backlog",
      kind: "assigned_issue",
      issueKey: "APP-2",
      title: "APP-2 Earlier assigned issue",
      metadata: {
        status: "着手可能",
        startDate: "2026-07-01",
        dueDate: "2026-07-05",
        milestones: ["Sprint 1"],
      },
    };
    const markdown = generateTemplateReport({
      config: {
        ...baseConfig,
        reportLanguage: "ja",
      },
      activities: [laterActivity, earlierActivity],
      groups: [],
    });

    expect(markdown).toContain(
      "- この日のユーザー行動は見つかりませんでした。",
    );
    expect(markdown).toContain(
      [
        "```mermaid",
        "gantt",
        "  title 直近の担当課題",
        "  dateFormat  YYYY-MM-DD",
        "  axisFormat  %m/%d",
        "  section Sprint 1",
        "  APP-2 Earlier assigned issue :task_APP_2, 2026-07-01, 2026-07-05",
        "  section Sprint 2",
        "  APP-1 Assigned issue :active, task_APP_1, 2026-07-06, 2026-07-08",
        "```",
      ].join("\n"),
    );
    expect(markdown.indexOf("## 進捗")).toBeLessThan(
      markdown.indexOf("## 明日やること"),
    );
    expect(markdown.indexOf("## 明日やること")).toBeLessThan(
      markdown.indexOf("## Raw Activity"),
    );
    expect(markdown).toContain(
      [
        "```",
        "",
        "## 明日やること",
        "",
        "- APP-1 Assigned issue: ステータス: 処理中、期限: 2026-07-08",
      ].join("\n"),
    );
    expect(markdown).not.toContain("## 課題・相談事項");
    expect(markdown).not.toContain(
      "- APP-2 Earlier assigned issue: ステータス:",
    );
    expect(markdown).not.toContain("- APP-2: ステータス:");
    expect(markdown).not.toContain("- APP-1: ステータス:");
  });
});
