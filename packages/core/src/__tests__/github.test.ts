import { describe, expect, it } from "vitest";
import { parseGitHubRepoSpecString, resolveGitHubTokenForOwner } from "../github.js";
import type { GitppouConfig } from "../types.js";

const baseConfig: GitppouConfig = {
  githubToken: "default-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogApiKey: "backlog-key",
  backlogSpaces: [
    {
      space: "example",
      projectKeys: []
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

describe("resolveGitHubTokenForOwner", () => {
  it("uses an owner-specific token when configured", () => {
    expect(
      resolveGitHubTokenForOwner(
        {
          ...baseConfig,
          githubTokensByOwner: {
            "org-a": "org-a-token"
          }
        },
        "org-a"
      )
    ).toBe("org-a-token");
  });

  it("matches owners case-insensitively", () => {
    expect(
      resolveGitHubTokenForOwner(
        {
          ...baseConfig,
          githubTokensByOwner: {
            "Org-A": "org-a-token"
          }
        },
        "org-a"
      )
    ).toBe("org-a-token");
  });

  it("falls back to the default token", () => {
    expect(resolveGitHubTokenForOwner(baseConfig, "org-a")).toBe("default-token");
  });
});

describe("parseGitHubRepoSpecString", () => {
  it("keeps explicit owner/repo entries", () => {
    expect(parseGitHubRepoSpecString("owner/repo")).toBe("owner/repo");
  });

  it("parses owner selector entries", () => {
    expect(parseGitHubRepoSpecString("org-a:20:pushed")).toEqual({
      owner: "org-a",
      limit: 20,
      sort: "pushed"
    });
  });

  it("parses owner selector entries with sort only", () => {
    expect(parseGitHubRepoSpecString("org-a:pushed")).toEqual({
      owner: "org-a",
      sort: "pushed"
    });
  });

  it("rejects owner selector limits above the supported maximum", () => {
    expect(() => parseGitHubRepoSpecString("org-a:101:pushed")).toThrow(
      "github.repos owner selector limit must be less than or equal to 100."
    );
  });

  it("rejects owner selector names that are not GitHub logins", () => {
    expect(() => parseGitHubRepoSpecString("gaia_crypto:20:pushed")).toThrow("not underscores");
  });
});
