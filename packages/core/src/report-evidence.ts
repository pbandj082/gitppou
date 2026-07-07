import type { ActivityGroup, NormalizedActivity } from "./types.js";

export type ReportEvidenceAction = {
  source: NormalizedActivity["source"];
  kind: NormalizedActivity["kind"];
  title: string;
  issueKey?: string;
  repository?: string;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ReportEvidenceContext = {
  source: NormalizedActivity["source"];
  kind: NormalizedActivity["kind"];
  title: string;
  issueKey?: string;
  repository?: string;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ReportEvidence = {
  userActions: ReportEvidenceAction[];
  contextOnly: ReportEvidenceContext[];
};

export function isUserActionActivity(activity: NormalizedActivity): boolean {
  switch (activity.kind) {
    case "issue":
    case "assigned_issue":
    case "due_issue":
      return false;
    default:
      return true;
  }
}

export function filterUserActionActivities(activities: NormalizedActivity[]): NormalizedActivity[] {
  return activities.filter(isUserActionActivity);
}

export function filterGroupsByUserActions(groups: ActivityGroup[]): ActivityGroup[] {
  return groups
    .map((group) => ({
      ...group,
      activities: group.activities.filter(isUserActionActivity)
    }))
    .filter((group) => group.activities.length > 0);
}

export function buildReportEvidence(activities: NormalizedActivity[]): ReportEvidence {
  return {
    userActions: activities.filter(isUserActionActivity).map(toEvidenceAction),
    contextOnly: activities.filter((activity) => !isUserActionActivity(activity)).map(toEvidenceContext)
  };
}

function toEvidenceAction(activity: NormalizedActivity): ReportEvidenceAction {
  return compactEvidence({
    source: activity.source,
    kind: activity.kind,
    title: activity.title,
    ...(activity.issueKey ? { issueKey: activity.issueKey } : {}),
    ...(activity.repository ? { repository: activity.repository } : {}),
    ...(activity.body ? { body: activity.body } : {}),
    ...(activity.url ? { url: activity.url } : {}),
    ...(activity.createdAt ? { createdAt: activity.createdAt } : {}),
    ...(activity.updatedAt ? { updatedAt: activity.updatedAt } : {}),
    ...(activity.metadata ? { metadata: activity.metadata } : {})
  });
}

function toEvidenceContext(activity: NormalizedActivity): ReportEvidenceContext {
  return compactEvidence({
    source: activity.source,
    kind: activity.kind,
    title: activity.title,
    ...(activity.issueKey ? { issueKey: activity.issueKey } : {}),
    ...(activity.repository ? { repository: activity.repository } : {}),
    ...(activity.body ? { body: activity.body } : {}),
    ...(activity.url ? { url: activity.url } : {}),
    ...(activity.createdAt ? { createdAt: activity.createdAt } : {}),
    ...(activity.updatedAt ? { updatedAt: activity.updatedAt } : {}),
    ...(activity.metadata ? { metadata: activity.metadata } : {})
  });
}

function compactEvidence<T extends ReportEvidenceAction | ReportEvidenceContext>(evidence: T): T {
  return Object.fromEntries(
    Object.entries(evidence).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }

      if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
        return false;
      }

      return true;
    })
  ) as T;
}
