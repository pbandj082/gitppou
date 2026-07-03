import { isOnReportDate } from "./config.js";
import type { GitppouConfig, NormalizedActivity } from "./types.js";

type BacklogUser = {
  id: number;
  name: string;
};

type BacklogProject = {
  id: number;
  projectKey: string;
  name: string;
};

type BacklogIssue = {
  id: number;
  issueKey: string;
  summary: string;
  description?: string;
  url?: string;
  created?: string;
  updated?: string;
  dueDate?: string | null;
  status?: {
    id: number;
    name: string;
  };
  priority?: {
    id: number;
    name: string;
  };
  assignee?: BacklogUser | null;
  createdUser?: BacklogUser;
};

type BacklogComment = {
  id: number;
  content?: string;
  created?: string;
  updated?: string;
  createdUser?: BacklogUser;
  changeLog?: Array<{
    field?: string;
    originalValue?: string;
    newValue?: string;
    attachmentInfo?: unknown;
  }>;
};

type QueryValue = string | number | boolean | readonly (string | number | boolean)[];

export async function fetchBacklogActivities(config: GitppouConfig): Promise<NormalizedActivity[]> {
  const projectIds = await resolveProjectIds(config);
  const issues = await fetchRelevantIssues(config, projectIds);
  const commentLists = await Promise.all(issues.map((issue) => fetchIssueComments(config, issue.issueKey)));

  return issues.flatMap((issue, index) => {
    const comments = commentLists[index] ?? [];
    return [
      ...issueToActivities(config, issue),
      ...commentsToActivities(config, issue, comments)
    ];
  });
}

async function resolveProjectIds(config: GitppouConfig): Promise<number[]> {
  if (config.backlogProjectKeys.length === 0) {
    return [];
  }

  const projects = await backlogGet<BacklogProject[]>(config, "/projects", {});
  const wanted = new Set(config.backlogProjectKeys.map((key) => key.toUpperCase()));
  const projectIds = projects
    .filter((project) => wanted.has(project.projectKey.toUpperCase()))
    .map((project) => project.id);

  const missing = [...wanted].filter(
    (key) => !projects.some((project) => project.projectKey.toUpperCase() === key)
  );

  if (missing.length > 0) {
    throw new Error(`Backlog project key not found: ${missing.join(", ")}`);
  }

  return projectIds;
}

async function fetchRelevantIssues(config: GitppouConfig, projectIds: number[]): Promise<BacklogIssue[]> {
  const commonParams: Record<string, QueryValue> = {
    count: 100,
    sort: "updated",
    order: "desc"
  };

  if (projectIds.length > 0) {
    commonParams["projectId[]"] = projectIds;
  }

  const updatedIssues = await backlogGet<BacklogIssue[]>(config, "/issues", {
    ...commonParams,
    updatedSince: config.reportDate,
    updatedUntil: config.reportDate
  });

  const assignedIssues = config.backlogUserId
    ? await backlogGet<BacklogIssue[]>(config, "/issues", {
        ...commonParams,
        "assigneeId[]": [config.backlogUserId]
      })
    : [];

  const issues = new Map<string, BacklogIssue>();
  for (const issue of [...updatedIssues, ...assignedIssues]) {
    issues.set(issue.issueKey, issue);
  }

  return [...issues.values()];
}

async function fetchIssueComments(config: GitppouConfig, issueKey: string): Promise<BacklogComment[]> {
  return backlogGet<BacklogComment[]>(config, `/issues/${encodeURIComponent(issueKey)}/comments`, {
    count: 100,
    order: "asc"
  });
}

function issueToActivities(config: GitppouConfig, issue: BacklogIssue): NormalizedActivity[] {
  const activities: NormalizedActivity[] = [];
  const projectKey = getProjectKey(issue.issueKey);
  const metadata = compactMetadata({
    backlogIssueId: issue.id,
    status: issue.status?.name,
    priority: issue.priority?.name,
    assignee: issue.assignee?.name,
    dueDate: issue.dueDate ?? undefined
  });

  if (isOnReportDate(issue.updated, config.reportDate, config.reportTimezone) || isAssignedToUser(config, issue)) {
    activities.push({
      source: "backlog",
      kind: "issue",
      projectKey,
      issueKey: issue.issueKey,
      title: `${issue.issueKey} ${issue.summary}`,
      ...(issue.description ? { body: issue.description } : {}),
      url: buildIssueUrl(config.backlogSpace, issue.issueKey),
      ...(issue.created ? { createdAt: issue.created } : {}),
      ...(issue.updated ? { updatedAt: issue.updated } : {}),
      metadata
    });
  }

  if (issue.dueDate && issue.dueDate <= config.reportDate && isAssignedToUser(config, issue)) {
    activities.push({
      source: "backlog",
      kind: "due_issue",
      projectKey,
      issueKey: issue.issueKey,
      title: `${issue.issueKey} due: ${issue.summary}`,
      url: buildIssueUrl(config.backlogSpace, issue.issueKey),
      ...(issue.updated ? { updatedAt: issue.updated } : {}),
      metadata
    });
  }

  return activities;
}

function commentsToActivities(
  config: GitppouConfig,
  issue: BacklogIssue,
  comments: BacklogComment[]
): NormalizedActivity[] {
  const activities: NormalizedActivity[] = [];
  const projectKey = getProjectKey(issue.issueKey);

  for (const comment of comments) {
    if (!isOnReportDate(comment.created, config.reportDate, config.reportTimezone)) {
      continue;
    }

    if (config.backlogUserId && String(comment.createdUser?.id) !== config.backlogUserId) {
      continue;
    }

    const url = `${buildIssueUrl(config.backlogSpace, issue.issueKey)}#comment-${comment.id}`;
    const metadata = compactMetadata({
      backlogIssueId: issue.id,
      backlogCommentId: comment.id,
      author: comment.createdUser?.name
    });

    if (comment.content?.trim()) {
      activities.push({
        source: "backlog",
        kind: "comment",
        projectKey,
        issueKey: issue.issueKey,
        title: `${issue.issueKey} comment: ${issue.summary}`,
        body: comment.content.trim(),
        url,
        ...(comment.created ? { createdAt: comment.created } : {}),
        ...(comment.updated ? { updatedAt: comment.updated } : {}),
        metadata
      });
    }

    for (const change of comment.changeLog ?? []) {
      if (!change.field || !/status/i.test(change.field)) {
        continue;
      }

      activities.push({
        source: "backlog",
        kind: "status_change",
        projectKey,
        issueKey: issue.issueKey,
        title: `${issue.issueKey} status changed: ${issue.summary}`,
        body: describeStatusChange(change.originalValue, change.newValue),
        url,
        ...(comment.created ? { createdAt: comment.created } : {}),
        metadata: compactMetadata({
          ...metadata,
          field: change.field,
          originalValue: change.originalValue,
          newValue: change.newValue
        })
      });
    }
  }

  return activities;
}

async function backlogGet<T>(
  config: GitppouConfig,
  path: string,
  params: Record<string, QueryValue>
): Promise<T> {
  const url = new URL(`https://${config.backlogSpace}.backlog.com/api/v2${path}`);
  url.searchParams.set("apiKey", config.backlogApiKey);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gitppou"
    }
  });

  if (!response.ok) {
    throw new Error(`Backlog API request failed for ${path} with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function isAssignedToUser(config: GitppouConfig, issue: BacklogIssue): boolean {
  return Boolean(config.backlogUserId && String(issue.assignee?.id) === config.backlogUserId);
}

function buildIssueUrl(space: string, issueKey: string): string {
  return `https://${space}.backlog.com/view/${issueKey}`;
}

function getProjectKey(issueKey: string): string {
  return issueKey.split("-")[0] ?? issueKey;
}

function describeStatusChange(originalValue: string | undefined, newValue: string | undefined): string {
  if (originalValue && newValue) {
    return `Status changed from "${originalValue}" to "${newValue}".`;
  }

  if (newValue) {
    return `Status changed to "${newValue}".`;
  }

  return "Status changed.";
}

function compactMetadata(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}
