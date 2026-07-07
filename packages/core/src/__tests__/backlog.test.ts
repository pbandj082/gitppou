import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBacklogActivities } from "../backlog.js";
import type { GitppouConfig } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [
    {
      space: "example",
      host: "example.backlog.com",
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBacklogActivities", () => {
  it("skips Backlog requests when no spaces are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { backlogApiKey: _backlogApiKey, ...config } = baseConfig;

    await expect(fetchBacklogActivities({ ...config, backlogSpaces: [] })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses /users/myself when backlog.userId is omitted", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        urls.push(url);

        if (url.pathname === "/api/v2/users/myself") {
          return jsonResponse({
            id: 123,
            name: "Admin"
          });
        }

        if (url.pathname === "/api/v2/projects") {
          return jsonResponse([
            {
              id: 456,
              projectKey: "APP",
              name: "App"
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues") {
          return jsonResponse([]);
        }

        return jsonResponse({}, 404);
      })
    );

    await expect(fetchBacklogActivities(baseConfig)).resolves.toEqual([]);

    expect(urls.some((url) => url.pathname === "/api/v2/users/myself")).toBe(true);
    expect(
      urls.some(
        (url) =>
          url.pathname === "/api/v2/issues" &&
          url.searchParams.getAll("assigneeId[]").includes("123") &&
          url.searchParams.get("updatedSince") === "2026-07-06" &&
          url.searchParams.get("updatedUntil") === "2026-07-06"
      )
    ).toBe(true);
  });

  it("does not turn old assigned issues into report-date activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/api/v2/users/myself") {
          return jsonResponse({
            id: 123,
            name: "Admin"
          });
        }

        if (url.pathname === "/api/v2/projects") {
          return jsonResponse([
            {
              id: 456,
              projectKey: "APP",
              name: "App"
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues" && url.searchParams.getAll("assigneeId[]").includes("123")) {
          return jsonResponse([
            {
              id: 789,
              issueKey: "APP-1",
              summary: "Old assigned issue",
              updated: "2026-07-01T10:00:00Z",
              dueDate: "2026-07-01",
              assignee: {
                id: 123,
                name: "Admin"
              }
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues") {
          return jsonResponse([]);
        }

        if (url.pathname === "/api/v2/issues/APP-1/comments") {
          return jsonResponse([]);
        }

        return jsonResponse({}, 404);
      })
    );

    await expect(fetchBacklogActivities(baseConfig)).resolves.toEqual([]);
  });

  it("keeps issues updated on the report date and due today", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/api/v2/users/myself") {
          return jsonResponse({
            id: 123,
            name: "Admin"
          });
        }

        if (url.pathname === "/api/v2/projects") {
          return jsonResponse([
            {
              id: 456,
              projectKey: "APP",
              name: "App"
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues" && !url.searchParams.has("assigneeId[]")) {
          return jsonResponse([
            {
              id: 789,
              issueKey: "APP-1",
              summary: "Updated issue",
              updated: "2026-07-06T10:00:00+09:00",
              dueDate: "2026-07-06",
              assignee: {
                id: 123,
                name: "Admin"
              }
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues") {
          return jsonResponse([]);
        }

        if (url.pathname === "/api/v2/issues/APP-1/comments") {
          return jsonResponse([]);
        }

        return jsonResponse({}, 404);
      })
    );

    await expect(fetchBacklogActivities(baseConfig)).resolves.toMatchObject([
      {
        kind: "issue",
        issueKey: "APP-1"
      },
      {
        kind: "due_issue",
        issueKey: "APP-1"
      }
    ]);
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
