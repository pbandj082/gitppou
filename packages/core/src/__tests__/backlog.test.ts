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
      urls.some((url) => url.pathname === "/api/v2/issues" && url.searchParams.getAll("assigneeId[]").includes("123"))
    ).toBe(true);
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
