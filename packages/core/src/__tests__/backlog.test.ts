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

        if (
          url.pathname === "/api/v2/issues" &&
          url.searchParams.getAll("assigneeId[]").includes("123") &&
          url.searchParams.has("updatedSince")
        ) {
          return jsonResponse([]);
        }

        if (url.pathname === "/api/v2/issues" && url.searchParams.getAll("assigneeId[]").includes("123")) {
          return jsonResponse([
            {
              id: 789,
              issueKey: "APP-1",
              summary: "Old assigned issue",
              updated: "2026-07-01T10:00:00Z",
              startDate: "2026-06-30",
              dueDate: "2026-07-01",
              milestone: [
                {
                  id: 5,
                  name: "Sprint 1"
                }
              ],
              assignee: {
                id: 123,
                name: "Admin"
              }
            },
            {
              id: 790,
              issueKey: "APP-2",
              summary: "Completed assigned issue",
              updated: "2026-07-01T10:00:00Z",
              startDate: "2026-06-30",
              dueDate: "2026-07-01",
              status: {
                id: 4,
                name: "完了"
              },
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

    const activities = await fetchBacklogActivities(baseConfig);
    expect(activities).toMatchObject([
      {
        kind: "assigned_issue",
        issueKey: "APP-1",
        metadata: {
          startDate: "2026-06-30",
          dueDate: "2026-07-01",
          milestones: ["Sprint 1"]
        }
      }
    ]);
    expect(activities).not.toEqual(expect.arrayContaining([expect.objectContaining({ issueKey: "APP-2" })]));
    expect(activities).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "issue" })]));
    expect(activities).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "due_issue" })]));
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
              priority: {
                id: 4,
                name: "High"
              },
              issueType: {
                id: 1,
                name: "Task"
              },
              category: [
                {
                  id: 2,
                  name: "Backend"
                },
                {
                  id: 3,
                  name: "Security"
                }
              ],
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

    const activities = await fetchBacklogActivities(baseConfig);
    expect(activities).toMatchObject([
      {
        kind: "issue",
        issueKey: "APP-1",
        metadata: {
          issueType: "Task",
          categories: ["Backend", "Security"]
        }
      },
      {
        kind: "due_issue",
        issueKey: "APP-1",
        metadata: {
          issueType: "Task",
          categories: ["Backend", "Security"]
        }
      }
    ]);
    for (const activity of activities) {
      expect(activity.metadata).not.toHaveProperty("priority");
      expect(activity.metadata).not.toHaveProperty("assignee");
      expect(activity.metadata).not.toHaveProperty("dueDate");
    }
  });

  it("prefers concrete comment activities over generic issue updates", async () => {
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

        if (url.pathname === "/api/v2/issues") {
          return jsonResponse([
            {
              id: 789,
              issueKey: "APP-1",
              summary: "Status changed issue",
              updated: "2026-07-06T10:00:00+09:00",
              issueType: {
                id: 1,
                name: "Task"
              },
              category: [
                {
                  id: 2,
                  name: "Backend"
                }
              ],
              assignee: {
                id: 123,
                name: "Admin"
              }
            }
          ]);
        }

        if (url.pathname === "/api/v2/issues/APP-1/comments") {
          return jsonResponse([
            {
              id: 987,
              created: "2026-07-06T10:00:00+09:00",
              createdUser: {
                id: 123,
                name: "Admin"
              },
              changeLog: [
                {
                  field: "status",
                  originalValue: "Open",
                  newValue: "Done"
                }
              ]
            }
          ]);
        }

        return jsonResponse({}, 404);
      })
    );

    await expect(fetchBacklogActivities(baseConfig)).resolves.toMatchObject([
      {
        kind: "status_change",
        issueKey: "APP-1",
        metadata: {
          issueType: "Task",
          categories: ["Backend"],
          originalValue: "Open",
          newValue: "Done"
        }
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
