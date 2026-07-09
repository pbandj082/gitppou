import { describe, expect, it } from "vitest";
import { buildPreviewConfig, loadPreviewEnv } from "../config.js";

const env = {
  GITHUB_TOKEN: "github-token",
  GITPPOU_TOKEN_ORG_A: "org-a-token",
  BACKLOG_API_KEY: "backlog-key",
  SLACK_WEBHOOK_URL: "https://example.com/slack",
};

describe("buildPreviewConfig", () => {
  it("builds a preview config with safe defaults", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: ["owner/repo"],
          tokenEnv: "GITHUB_TOKEN",
          tokens: {
            "org-a": "GITPPOU_TOKEN_ORG_A",
          },
        },
        backlog: {
          userId: "123",
          spaces: {
            example: {
              projectKeys: ["APP"],
            },
          },
        },
      },
      {},
      env,
      new Date("2026-07-05T15:30:00Z"),
    );

    expect(config).toMatchObject({
      githubToken: "github-token",
      githubTokensByOwner: {
        "org-a": "org-a-token",
      },
      githubUsername: "octocat",
      githubRepos: ["owner/repo"],
      backlogApiKey: "backlog-key",
      backlogUserId: "123",
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
      llmStyle: "concise",
    });
    expect(config.slackWebhookUrl).toBeUndefined();
  });

  it("builds multiple Backlog spaces from config objects", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
        },
        backlog: {
          userId: "123",
          spaces: {
            example: {
              projectKeys: ["APP"],
            },
            other: {
              projectKeys: ["OPS"],
            },
          },
        },
      },
      {},
      env,
    );

    expect(config.backlogSpaces).toEqual([
      {
        space: "example",
        projectKeys: ["APP"],
      },
      {
        space: "other",
        projectKeys: ["OPS"],
      },
    ]);
    expect(config.backlogApiKey).toBe("backlog-key");
    expect(config.backlogUserId).toBe("123");
  });

  it("builds Backlog spaces with explicit hosts", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
        },
        backlog: {
          spaces: {
            example: {
              host: "https://example.backlog.jp/",
              projectKeys: ["APP"],
            },
          },
        },
      },
      {},
      env,
    );

    expect(config.backlogSpaces).toEqual([
      {
        space: "example",
        host: "example.backlog.jp",
        projectKeys: ["APP"],
      },
    ]);
  });

  it("builds Backlog document publishing settings", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
        },
        backlog: {
          spaces: {
            example: {
              host: "example.backlog.jp",
              projectKeys: ["APP"],
            },
          },
          document: {
            projectKey: "APP",
            parentId: "parent-document-id",
            title: "日報 {{date}}",
            addLast: true,
          },
        },
      },
      {},
      env,
      new Date("2026-07-05T15:30:00Z"),
    );

    expect(config.backlogDocument).toEqual({
      space: "example",
      host: "example.backlog.jp",
      projectKey: "APP",
      parentId: "parent-document-id",
      title: "日報 {{date}}",
      addLast: true,
    });
  });

  it("builds report author settings", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
        },
        report: {
          author: "Octo Cat",
        },
      },
      {},
      {
        GITHUB_TOKEN: "github-token",
      },
    );

    expect(config.reportAuthor).toBe("Octo Cat");
  });

  it("does not enable Backlog activity fetching for document-only config", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
        },
        backlog: {
          document: {
            space: "example",
            projectId: 456,
          },
        },
      },
      {},
      env,
    );

    expect(config.backlogSpaces).toEqual([]);
    expect(config.backlogApiKey).toBe("backlog-key");
    expect(config.backlogDocument).toEqual({
      space: "example",
      projectId: 456,
    });
  });

  it("builds GitHub-only config when Backlog is disabled", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: ["owner/repo"],
        },
        backlog: {
          enabled: false,
        },
      },
      {},
      {
        GITHUB_TOKEN: "github-token",
      },
    );

    expect(config).toMatchObject({
      githubToken: "github-token",
      githubUsername: "octocat",
      githubRepos: ["owner/repo"],
      backlogSpaces: [],
    });
    expect(config.backlogApiKey).toBeUndefined();
  });

  it("builds GitHub-only config when Backlog is omitted", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: ["owner/repo"],
        },
      },
      {},
      {
        GITHUB_TOKEN: "github-token",
      },
    );

    expect(config).toMatchObject({
      githubToken: "github-token",
      backlogSpaces: [],
    });
    expect(config.backlogApiKey).toBeUndefined();
  });

  it("rejects legacy single Backlog space config", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
          },
          backlog: {
            space: "example",
          },
        },
        {},
        env,
      ),
    ).toThrow("config.backlog uses spaces only.");
  });

  it("rejects nonnumeric Backlog user ids", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
          },
          backlog: {
            userId: "admin",
            spaces: {
              example: {},
            },
          },
        },
        {},
        env,
      ),
    ).toThrow("numeric Backlog user id");
  });

  it("builds owner selector repository specs from config objects", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: [
            "owner/repo",
            {
              "org-a": {
                limit: 20,
                sort: "pushed",
                includeForks: true,
              },
            },
          ],
        },
        backlog: {
          spaces: {
            example: {},
          },
        },
      },
      {},
      env,
    );

    expect(config.githubRepos).toEqual([
      "owner/repo",
      {
        owner: "org-a",
        limit: 20,
        sort: "pushed",
        includeForks: true,
      },
    ]);
  });

  it("rejects owner selector limits above the supported maximum", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
            repos: [
              {
                "org-a": {
                  limit: 101,
                },
              },
            ],
          },
          backlog: {
            spaces: {
              example: {},
            },
          },
        },
        {},
        env,
      ),
    ).toThrow("github.repos[0].org-a.limit must be less than or equal to 100.");
  });

  it("explains misindented owner selector options", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
            repos: [
              {
                "org-a": null,
                limit: 20,
              },
            ],
          },
          backlog: {
            spaces: {
              example: {},
            },
          },
        },
        {},
        env,
      ),
    ).toThrow("indent selector options under the owner key");
  });

  it("lets CLI options override file values", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: [],
        },
        backlog: {
          spaces: {
            example: {},
          },
        },
        report: {
          date: "2026-07-01",
          language: "en",
          dir: "reports",
        },
        llm: {
          provider: "template",
          maxInputChars: 1000,
          style: "concise",
        },
      },
      {
        reportDate: "2026-07-02",
        reportLanguage: "ja",
        reportDir: "tmp/reports",
        llmProvider: "github-models",
        llmMaxInputChars: "2000",
        llmStyle: "detailed",
        slackNotify: true,
      },
      env,
    );

    expect(config).toMatchObject({
      reportDate: "2026-07-02",
      reportLanguage: "ja",
      reportDir: "tmp/reports",
      slackNotify: true,
      slackWebhookUrl: "https://example.com/slack",
      llmProvider: "github-models",
      llmMaxInputChars: 2000,
      llmStyle: "detailed",
    });
  });

  it("builds report output format settings from config", () => {
    const config = buildPreviewConfig(
      {
        github: {
          username: "octocat",
          repos: ["owner/repo"],
        },
        backlog: {
          enabled: false,
        },
        report: {
          formats: ["markdown", "html", "pdf", "html"],
          htmlDir: "public/daily-reports",
          pdfDir: "public/daily-reports/pdf",
        },
      },
      {},
      {
        GITHUB_TOKEN: "github-token",
      },
    );

    expect(config.reportFormats).toEqual(["markdown", "html", "pdf"]);
    expect(config.reportHtmlDir).toBe("public/daily-reports");
    expect(config.reportPdfDir).toBe("public/daily-reports/pdf");
  });

  it("rejects unknown report output formats", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
            repos: ["owner/repo"],
          },
          backlog: {
            enabled: false,
          },
          report: {
            formats: ["docx"],
          },
        },
        {},
        {
          GITHUB_TOKEN: "github-token",
        },
      ),
    ).toThrow(
      "config.report.formats must contain only markdown, html, or pdf.",
    );
  });

  it("requires API credentials from environment variables", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
          },
          backlog: {
            spaces: {
              example: {},
            },
          },
        },
        {},
        {},
      ),
    ).toThrow("GITHUB_TOKEN");
  });

  it("requires the Backlog API key only when Backlog is enabled", () => {
    expect(() =>
      buildPreviewConfig(
        {
          github: {
            username: "octocat",
          },
          backlog: {
            spaces: {
              example: {},
            },
          },
        },
        {},
        {
          GITHUB_TOKEN: "github-token",
        },
      ),
    ).toThrow("BACKLOG_API_KEY");
  });

  it("loads env file values without overriding explicit environment variables", async () => {
    const loadedEnv = await loadPreviewEnv(
      "src/__tests__/fixtures/.env.preview",
      {
        GITHUB_TOKEN: "shell-github-token",
      },
    );

    expect(loadedEnv).toMatchObject({
      GITHUB_TOKEN: "shell-github-token",
      BACKLOG_API_KEY: "file-backlog-key",
      SLACK_WEBHOOK_URL: "https://example.com/file-slack",
    });
  });
});
