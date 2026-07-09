import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGitHubActivities,
  parseGitHubRepoSpecString,
  resolveGitHubTokenForOwner,
} from "../github.js";
import type { GitppouConfig } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "default-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [
    {
      space: "example",
      projectKeys: [],
    },
  ],
  reportDate: "2026-07-06",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "en",
  reportDir: "reports",
  reportFormats: ["markdown"],
  reportHtmlDir: ".gitppou/site",
  commitReport: false,
  slackNotify: false,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveGitHubTokenForOwner", () => {
  it("uses an owner-specific token when configured", () => {
    expect(
      resolveGitHubTokenForOwner(
        {
          ...baseConfig,
          githubTokensByOwner: {
            "org-a": "org-a-token",
          },
        },
        "org-a",
      ),
    ).toBe("org-a-token");
  });

  it("matches owners case-insensitively", () => {
    expect(
      resolveGitHubTokenForOwner(
        {
          ...baseConfig,
          githubTokensByOwner: {
            "Org-A": "org-a-token",
          },
        },
        "org-a",
      ),
    ).toBe("org-a-token");
  });

  it("falls back to the default token", () => {
    expect(resolveGitHubTokenForOwner(baseConfig, "org-a")).toBe(
      "default-token",
    );
  });
});

describe("fetchGitHubActivities", () => {
  it("includes pull request diff stats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/repos/owner/repo/commits") {
          return jsonResponse([]);
        }

        if (url.pathname === "/repos/owner/repo/issues/comments") {
          return jsonResponse([]);
        }

        if (url.pathname === "/search/issues") {
          const query = url.searchParams.get("q") ?? "";
          if (
            query.includes("is:pr") &&
            query.includes("involves:octocat") &&
            query.includes("updated:2026-07-06")
          ) {
            return jsonResponse({
              total_count: 1,
              incomplete_results: false,
              items: [
                {
                  number: 12,
                  title: "APP-1 Update login flow",
                  state: "open",
                  html_url: "https://github.com/owner/repo/pull/12",
                  created_at: "2026-07-05T10:00:00Z",
                  updated_at: "2026-07-06T10:00:00Z",
                  body: "APP-1",
                  user: {
                    login: "octocat",
                  },
                },
              ],
            });
          }

          return jsonResponse({
            total_count: 0,
            incomplete_results: false,
            items: [],
          });
        }

        if (url.pathname === "/repos/owner/repo/pulls/12") {
          return jsonResponse({
            additions: 120,
            deletions: 32,
            changed_files: 4,
            head: {
              ref: "feature/APP-1-login",
            },
            base: {
              ref: "main",
            },
          });
        }

        if (url.pathname === "/repos/owner/repo/pulls/12/commits") {
          return jsonResponse([]);
        }

        return jsonResponse({}, 404);
      }),
    );

    await expect(
      fetchGitHubActivities({
        ...baseConfig,
        githubRepos: ["owner/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "pull_request",
        metadata: expect.objectContaining({
          additions: 120,
          deletions: 32,
          changedFiles: 4,
          branch: "feature/APP-1-login",
          baseBranch: "main",
        }),
      }),
    ]);
  });

  it("includes commits from matching pull request branches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/repos/owner/repo/commits") {
          return jsonResponse([]);
        }

        if (url.pathname === "/repos/owner/repo/issues/comments") {
          return jsonResponse([]);
        }

        if (url.pathname === "/search/issues") {
          const query = url.searchParams.get("q") ?? "";
          if (
            query.includes("is:pr") &&
            query.includes("involves:octocat") &&
            query.includes("updated:2026-07-06")
          ) {
            return jsonResponse({
              total_count: 1,
              incomplete_results: false,
              items: [
                {
                  id: 1200,
                  number: 12,
                  title: "APP-1 Update login flow",
                  state: "open",
                  html_url: "https://github.com/owner/repo/pull/12",
                  repository_url: "https://api.github.com/repos/owner/repo",
                  created_at: "2026-07-05T10:00:00Z",
                  updated_at: "2026-07-06T10:00:00Z",
                  body: "APP-1",
                  user: {
                    login: "octocat",
                  },
                },
              ],
            });
          }

          return jsonResponse({
            total_count: 0,
            incomplete_results: false,
            items: [],
          });
        }

        if (url.pathname === "/repos/owner/repo/pulls/12") {
          return jsonResponse({
            additions: 120,
            deletions: 32,
            changed_files: 4,
            head: {
              ref: "feature/APP-1-login",
            },
            base: {
              ref: "main",
            },
          });
        }

        if (url.pathname === "/repos/owner/repo/pulls/12/commits") {
          return jsonResponse([
            {
              sha: "abc123456789",
              html_url: "https://github.com/owner/repo/commit/abc123456789",
              author: {
                login: "octocat",
              },
              commit: {
                message: "implement branch-only change",
                author: {
                  date: "2026-07-06T10:00:00Z",
                },
              },
            },
            {
              sha: "def123456789",
              html_url: "https://github.com/owner/repo/commit/def123456789",
              author: {
                login: "someone-else",
              },
              commit: {
                message: "ignore another author",
                author: {
                  date: "2026-07-06T10:00:00Z",
                },
              },
            },
          ]);
        }

        return jsonResponse({}, 404);
      }),
    );

    await expect(
      fetchGitHubActivities({
        ...baseConfig,
        githubRepos: ["owner/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "pull_request",
        title: "APP-1 Update login flow",
      }),
      expect.objectContaining({
        kind: "commit",
        title: "implement branch-only change",
        repository: "owner/repo",
        metadata: expect.objectContaining({
          branch: "feature/APP-1-login",
          pullRequestNumber: 12,
          pullRequestTitle: "APP-1 Update login flow",
          pullRequestUrl: "https://github.com/owner/repo/pull/12",
        }),
      }),
    ]);
  });

  it("includes branch context from pull requests associated with commits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/repos/owner/repo/commits") {
          return jsonResponse([
            {
              sha: "abc123456789",
              html_url: "https://github.com/owner/repo/commit/abc123456789",
              commit: {
                message: "refine report output",
                author: {
                  date: "2026-07-06T10:00:00Z",
                },
              },
            },
          ]);
        }

        if (url.pathname === "/repos/owner/repo/commits/abc123456789/pulls") {
          return jsonResponse([
            {
              number: 12,
              title: "Feature app 1",
              html_url: "https://github.com/owner/repo/pull/12",
              head: {
                ref: "feature/APP-1-login",
              },
            },
          ]);
        }

        if (url.pathname === "/repos/owner/repo/issues/comments") {
          return jsonResponse([]);
        }

        if (url.pathname === "/search/issues") {
          return jsonResponse({
            total_count: 0,
            incomplete_results: false,
            items: [],
          });
        }

        return jsonResponse({}, 404);
      }),
    );

    await expect(
      fetchGitHubActivities({
        ...baseConfig,
        githubRepos: ["owner/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "commit",
        metadata: expect.objectContaining({
          branch: "feature/APP-1-login",
          pullRequestNumber: 12,
          pullRequestTitle: "Feature app 1",
          pullRequestUrl: "https://github.com/owner/repo/pull/12",
        }),
      }),
    ]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
  Object.defineProperty(response, "url", {
    value: "https://api.github.com/",
  });
  return response;
}

describe("parseGitHubRepoSpecString", () => {
  it("keeps explicit owner/repo entries", () => {
    expect(parseGitHubRepoSpecString("owner/repo")).toBe("owner/repo");
  });

  it("parses owner selector entries", () => {
    expect(parseGitHubRepoSpecString("org-a:20:pushed")).toEqual({
      owner: "org-a",
      limit: 20,
      sort: "pushed",
    });
  });

  it("parses owner selector entries with sort only", () => {
    expect(parseGitHubRepoSpecString("org-a:pushed")).toEqual({
      owner: "org-a",
      sort: "pushed",
    });
  });

  it("rejects owner selector limits above the supported maximum", () => {
    expect(() => parseGitHubRepoSpecString("org-a:101:pushed")).toThrow(
      "github.repos owner selector limit must be less than or equal to 100.",
    );
  });

  it("rejects owner selector names that are not GitHub logins", () => {
    expect(() => parseGitHubRepoSpecString("gaia_crypto:20:pushed")).toThrow(
      "not underscores",
    );
  });
});
