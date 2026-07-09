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
    case "comment_context":
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
    .map((group) => {
      const activities = group.activities.filter(isUserActionActivity);
      const title = shouldReplaceGroupTitle(group.title)
        ? deriveUserActionGroupTitle(group.issueKey, activities) ?? group.title
        : group.title;

      return {
        ...group,
        ...(title ? { title } : {}),
        activities
      };
    })
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

function deriveUserActionGroupTitle(issueKey: ActivityGroup["issueKey"], activities: NormalizedActivity[]): string | undefined {
  if (issueKey === "Unlinked") {
    return undefined;
  }

  for (const activity of activities) {
    const title = stripLeadingIssueKey(activity.title, issueKey);
    if (title) {
      return title;
    }
  }

  return undefined;
}

function shouldReplaceGroupTitle(title: string | undefined): boolean {
  return typeof title === "string" && /^comment context:/i.test(title.trim());
}

function stripLeadingIssueKey(title: string, issueKey: string): string | undefined {
  const stripped = title.replace(new RegExp(`^${escapeRegExp(issueKey)}[:：\\s-]*`), "").trim();
  return stripped || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
