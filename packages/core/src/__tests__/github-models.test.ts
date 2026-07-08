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
  commitReport: false,
  slackNotify: false,
  llmProvider: "github-models",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refineWithGitHubModels", () => {
  it("rejects incomplete model responses so callers can fall back to the template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              finish_reason: "length",
              message: {
                content: "# 日報\n\n## 進捗\n\n```mermaid\ngantt\n  title truncated"
              }
            }
          ]
        })
      )
    );

    await expect(
      refineWithGitHubModels({
        config: baseConfig,
        templateDraft: "# 日報\n\n## 進捗\n\n- complete template",
        activities: [],
        groups: []
      })
    ).rejects.toThrow("finish_reason=length");
  });

  it("requests enough output tokens for full report refinement", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "# 日報\n\n- complete"
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await refineWithGitHubModels({
      config: baseConfig,
      templateDraft: "# 日報\n\n- template",
      activities: [],
      groups: []
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_tokens: 4000
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
