import { describe, expect, it } from "vitest";
import { buildReportEvidence, filterGroupsByUserActions } from "../report-evidence.js";
import type { ActivityGroup, NormalizedActivity } from "../types.js";

describe("report evidence", () => {
  it("separates user actions from context-only activities", () => {
    const activities: NormalizedActivity[] = [
      {
        source: "backlog",
        kind: "issue",
        issueKey: "APP-1",
        title: "APP-1 Context issue"
      },
      {
        source: "backlog",
        kind: "status_change",
        issueKey: "APP-1",
        title: "APP-1 Context issue",
        metadata: {
          originalValue: "Open",
          newValue: "Done"
        }
      },
      {
        source: "backlog",
        kind: "due_issue",
        issueKey: "APP-2",
        title: "APP-2 Due today"
      },
      {
        source: "backlog",
        kind: "assigned_issue",
        issueKey: "APP-3",
        title: "APP-3 Assigned issue"
      }
    ];

    expect(buildReportEvidence(activities)).toMatchObject({
      userActions: [
        {
          kind: "status_change",
          issueKey: "APP-1"
        }
      ],
      contextOnly: [
        {
          kind: "issue",
          issueKey: "APP-1"
        },
        {
          kind: "due_issue",
          issueKey: "APP-2"
        },
        {
          kind: "assigned_issue",
          issueKey: "APP-3"
        }
      ]
    });
  });

  it("drops groups that only contain context", () => {
    const groups: ActivityGroup[] = [
      {
        issueKey: "APP-1",
        activities: [
          {
            source: "backlog",
            kind: "issue",
            issueKey: "APP-1",
            title: "APP-1 Context issue"
          }
        ]
      },
      {
        issueKey: "APP-2",
        activities: [
          {
            source: "backlog",
            kind: "comment",
            issueKey: "APP-2",
            title: "APP-2 Commented"
          }
        ]
      }
    ];

    expect(filterGroupsByUserActions(groups)).toEqual([
      {
        issueKey: "APP-2",
        activities: [
          {
            source: "backlog",
            kind: "comment",
            issueKey: "APP-2",
            title: "APP-2 Commented"
          }
        ]
      }
    ]);
  });
});
