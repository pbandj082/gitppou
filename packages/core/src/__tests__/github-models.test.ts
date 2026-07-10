import { afterEach, describe, expect, it, vi } from "vitest";
import { refineWithGitHubModels } from "../llm/github-models.js";
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
  slackNotify: false,
  llmProvider: "github-models",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refineWithGitHubModels", () => {
  it("rejects incomplete model responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              finish_reason: "length",
              message: {
                content:
                  "# 日報\n\n## 進捗\n\n```mermaid\ngantt\n  title truncated",
              },
            },
          ],
        }),
      ),
    );

    await expect(
      refineWithGitHubModels({
        config: baseConfig,
        templateDraft: "# 日報\n\n## 進捗\n\n- complete template",
        activities: [],
        groups: [],
      }),
    ).rejects.toThrow("finish_reason=length");
  });

  it("requests enough output tokens for full report refinement", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "# 日報\n\n- complete",
              },
            },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refineWithGitHubModels({
      config: baseConfig,
      templateDraft: "# 日報\n\n- template",
      activities: [],
      groups: [],
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      max_tokens: 4000,
    });
  });

  it("truncates both template and evidence input before requesting GitHub Models", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "# 日報\n\n- complete",
              },
            },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refineWithGitHubModels({
      config: {
        ...baseConfig,
        llmMaxInputChars: 100,
      },
      templateDraft: `# 日報\n\n${"T".repeat(200)}`,
      activities: [
        {
          source: "github",
          kind: "commit",
          title: `APP-1 ${"E".repeat(200)}`,
        },
      ],
      groups: [],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = body.messages[0].content;
    expect(prompt).toContain("truncated to 35 characters");
    expect(prompt).toContain("truncated to 65 characters");
    expect(prompt).not.toContain("T".repeat(120));
    expect(prompt).not.toContain("E".repeat(120));
  });

  it("rejects model output that omits a required user-action issue group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "# 日報\n\n## 本日対応したこと\n\n### APP-1 Login",
              },
            },
          ],
        }),
      ),
    );

    await expect(
      refineWithGitHubModels({
        config: baseConfig,
        templateDraft: "# 日報\n\n### GAIATASK-1357 日報作成自動化ツール",
        activities: [],
        groups: [
          {
            issueKey: "GAIATASK-1357",
            title: "日報作成自動化ツール",
            activities: [
              {
                source: "github",
                kind: "commit",
                issueKey: "GAIATASK-1357",
                title: "fix report generation",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("LLM omitted required issue groups: GAIATASK-1357.");
  });

  it("instructs the model to paraphrase issue summaries without quoting activity text", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "# 日報\n\n- complete",
              },
            },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refineWithGitHubModels({
      config: baseConfig,
      templateDraft: "# 日報\n\n- template",
      activities: [],
      groups: [],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content).toContain("原文を「」で引用・列挙しない");
    expect(body.messages[0].content).toContain(
      "要約文では同じ文言を繰り返さず、対応内容と結果をまとめる",
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
