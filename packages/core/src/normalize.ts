import type { ActivityGroup, NormalizedActivity } from "./types.js";

export const ISSUE_KEY_PATTERN = /[A-Z][A-Z0-9_]+-\d+/g;

export function extractIssueKeys(text: string, backlogProjectKeys: string[] = []): string[] {
  const allowedProjectKeys = normalizeProjectKeys(backlogProjectKeys);
  const matches = text.match(ISSUE_KEY_PATTERN) ?? [];
  const unique = new Set<string>();

  for (const match of matches) {
    const projectKey = getProjectKey(match);
    if (allowedProjectKeys.size === 0 || allowedProjectKeys.has(projectKey)) {
      unique.add(match);
    }
  }

  return [...unique];
}

export function normalizeActivities(
  activities: NormalizedActivity[],
  backlogProjectKeys: string[] = []
): NormalizedActivity[] {
  const allowedProjectKeys = normalizeProjectKeys(backlogProjectKeys);
  const seen = new Set<string>();
  const normalized: NormalizedActivity[] = [];

  for (const activity of activities) {
    const issueKey = resolveIssueKey(activity, allowedProjectKeys);
    const projectKey = issueKey ? getProjectKey(issueKey) : activity.projectKey;
    const { issueKey: _ignoredIssueKey, projectKey: _ignoredProjectKey, ...rest } = activity;
    const next: NormalizedActivity = {
      ...rest,
      ...(issueKey ? { issueKey } : {}),
      ...(projectKey ? { projectKey } : {})
    };
    const key = dedupeKey(next);

    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(next);
    }
  }

  return normalized.sort(compareActivityDate);
}

export function groupActivitiesByIssueKey(activities: NormalizedActivity[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();

  for (const activity of activities) {
    const issueKey = activity.issueKey ?? "Unlinked";
    const existing = groups.get(issueKey);

    if (existing) {
      existing.activities.push(activity);
      const title = deriveGroupTitle(issueKey, activity);
      if (!existing.title && title) {
        existing.title = title;
      }
      continue;
    }

    const title = deriveGroupTitle(issueKey, activity);
    groups.set(issueKey, {
      issueKey,
      ...(title ? { title } : {}),
      activities: [activity]
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      activities: group.activities.sort(compareActivityDate)
    }))
    .sort((left, right) => {
      if (left.issueKey === "Unlinked") return 1;
      if (right.issueKey === "Unlinked") return -1;
      return left.issueKey.localeCompare(right.issueKey);
    });
}

function resolveIssueKey(activity: NormalizedActivity, allowedProjectKeys: Set<string>): string | undefined {
  if (activity.issueKey) {
    const projectKey = getProjectKey(activity.issueKey);
    if (allowedProjectKeys.size === 0 || allowedProjectKeys.has(projectKey)) {
      return activity.issueKey;
    }
  }

  const searchable = [
    activity.title,
    activity.body,
    activity.repository,
    typeof activity.metadata?.branch === "string" ? activity.metadata.branch : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return extractIssueKeys(searchable, [...allowedProjectKeys])[0];
}

function normalizeProjectKeys(backlogProjectKeys: string[]): Set<string> {
  return new Set(backlogProjectKeys.map((key) => key.trim().toUpperCase()).filter(Boolean));
}

function getProjectKey(issueKey: string): string {
  return issueKey.split("-")[0] ?? issueKey;
}

function deriveGroupTitle(issueKey: string, activity: NormalizedActivity): string | undefined {
  if (issueKey === "Unlinked") {
    return undefined;
  }

  return activity.title.replace(new RegExp(`^${escapeRegExp(issueKey)}\\s*[:\\-]?\\s*`), "").trim() || undefined;
}

function compareActivityDate(left: NormalizedActivity, right: NormalizedActivity): number {
  return activityTime(left) - activityTime(right) || left.title.localeCompare(right.title);
}

function activityTime(activity: NormalizedActivity): number {
  const value = activity.createdAt ?? activity.updatedAt;
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function dedupeKey(activity: NormalizedActivity): string {
  return [
    activity.source,
    activity.kind,
    activity.issueKey ?? "",
    activity.title,
    activity.url ?? "",
    activity.createdAt ?? "",
    activity.updatedAt ?? ""
  ].join("\u0000");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
