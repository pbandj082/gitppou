import { describe, expect, it } from "vitest";
import { extractIssueKeys, groupActivitiesByIssueKey, normalizeActivities } from "../normalize.js";
import type { NormalizedActivity } from "../types.js";

describe("normalizeActivities", () => {
  it("extracts issue keys and groups activities", () => {
    const activities: NormalizedActivity[] = [
      {
        source: "github",
        kind: "commit",
        title: "APP-123 fix validation",
        createdAt: "2026-07-03T01:00:00Z"
      },
      {
        source: "backlog",
        kind: "comment",
        issueKey: "APP-123",
        title: "APP-123 comment",
        createdAt: "2026-07-03T02:00:00Z"
      }
    ];

    const normalized = normalizeActivities(activities, ["APP"]);
    const groups = groupActivitiesByIssueKey(normalized);

    expect(normalized).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.issueKey).toBe("APP-123");
  });

  it("filters detected issue keys by project key", () => {
    expect(extractIssueKeys("APP-123 WEB-999", ["APP"])).toEqual(["APP-123"]);
  });

  it("removes existing issue keys outside the allowed project keys", () => {
    const normalized = normalizeActivities(
      [
        {
          source: "github",
          kind: "pull_request",
          issueKey: "WEB-999",
          projectKey: "WEB",
          title: "WEB-999 unrelated work"
        }
      ],
      ["APP"]
    );

    expect(normalized[0]?.issueKey).toBeUndefined();
    expect(normalized[0]?.projectKey).toBe("WEB");
  });
});
