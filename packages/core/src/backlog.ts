import { isOnReportDate } from "./config.js";
import type { BacklogSpaceConfig, GitppouConfig, NormalizedActivity } from "./types.js";

type BacklogSpaceContext = BacklogSpaceConfig & {
  backlogApiKey: string;
  backlogUserId?: string;
  reportDate: string;
  reportTimezone: string;
};

type BacklogUser = {
  id: number;
  name: string;
};

type BacklogProject = {
  id: number;
  projectKey: string;
  name: string;
};

type BacklogNamedValue = {
  id: number;
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
  startDate?: string | null;
  dueDate?: string | null;
  status?: {
    id: number;
    name: string;
  };
  issueType?: BacklogNamedValue | null;
  category?: BacklogNamedValue[] | null;
  milestone?: BacklogNamedValue[] | null;
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
const ASSIGNED_PROGRESS_FETCH_LIMIT = 50;

export async function fetchBacklogActivities(config: GitppouConfig): Promise<NormalizedActivity[]> {
  if (config.backlogSpaces.length === 0) {
    return [];
  }

  if (!config.backlogApiKey) {
    throw new Error("BACKLOG_API_KEY is required when Backlog is enabled.");
  }

  const backlogApiKey = config.backlogApiKey;
  const activitySets = await Promise.all(
    config.backlogSpaces.map((spaceConfig) =>
      fetchBacklogSpaceActivities({
        ...spaceConfig,
        backlogApiKey,
        ...(config.backlogUserId ? { backlogUserId: config.backlogUserId } : {}),
        reportDate: config.reportDate,
        reportTimezone: config.reportTimezone
      })
    )
  );

  return activitySets.flat();
}

async function fetchBacklogSpaceActivities(config: BacklogSpaceContext): Promise<NormalizedActivity[]> {
  const resolvedConfig = await resolveBacklogUserId(config);
  const projectIds = await resolveProjectIds(resolvedConfig);
  const activityIssues = await fetchRelevantIssues(resolvedConfig, projectIds);
  const assignedProgressIssues = await fetchAssignedProgressIssues(resolvedConfig, projectIds);
  const commentLists = await Promise.all(
    activityIssues.map((issue) => fetchIssueComments(resolvedConfig, issue.issueKey))
  );

  const activityItems = activityIssues.flatMap((issue, index) => {
    const comments = commentLists[index] ?? [];
    const commentActivities = commentsToActivities(resolvedConfig, issue, comments);
    const issueActivities = issueToActivities(resolvedConfig, issue).filter(
      (activity) => activity.kind !== "issue" || commentActivities.length === 0
    );

    return [
      ...issueActivities,
      ...commentActivities
    ];
  });

  return [
    ...activityItems,
    ...assignedProgressIssues.flatMap((issue) => issueToAssignedProgressActivity(resolvedConfig, issue))
  ];
}

async function resolveBacklogUserId(config: BacklogSpaceContext): Promise<BacklogSpaceContext> {
  if (config.backlogUserId) {
    return config;
  }

  const user = await backlogGet<BacklogUser>(config, "/users/myself", {});
  return {
    ...config,
    backlogUserId: String(user.id)
  };
}

async function resolveProjectIds(config: BacklogSpaceContext): Promise<number[]> {
  if (config.projectKeys.length === 0) {
    return [];
  }

  const projects = await backlogGet<BacklogProject[]>(config, "/projects", {});
  const wanted = new Set(config.projectKeys.map((key) => key.toUpperCase()));
  const projectIds = projects
    .filter((project) => wanted.has(project.projectKey.toUpperCase()))
    .map((project) => project.id);

  const missing = [...wanted].filter(
    (key) => !projects.some((project) => project.projectKey.toUpperCase() === key)
  );

  if (missing.length > 0) {
    throw new Error(`Backlog project key not found in ${config.space}: ${missing.join(", ")}`);
  }

  return projectIds;
}

async function fetchRelevantIssues(config: BacklogSpaceContext, projectIds: number[]): Promise<BacklogIssue[]> {
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
        "assigneeId[]": [config.backlogUserId],
        updatedSince: config.reportDate,
        updatedUntil: config.reportDate
      })
    : [];

  const issues = new Map<string, BacklogIssue>();
  for (const issue of [...updatedIssues, ...assignedIssues]) {
    issues.set(issue.issueKey, issue);
  }

  return [...issues.values()];
}

async function fetchAssignedProgressIssues(
  config: BacklogSpaceContext,
  projectIds: number[]
): Promise<BacklogIssue[]> {
  if (!config.backlogUserId) {
    return [];
  }

  const params: Record<string, QueryValue> = {
    count: ASSIGNED_PROGRESS_FETCH_LIMIT,
    sort: "updated",
    order: "desc",
    "assigneeId[]": [config.backlogUserId]
  };

  if (projectIds.length > 0) {
    params["projectId[]"] = projectIds;
  }

  return backlogGet<BacklogIssue[]>(config, "/issues", params);
}

async function fetchIssueComments(config: BacklogSpaceContext, issueKey: string): Promise<BacklogComment[]> {
  return backlogGet<BacklogComment[]>(config, `/issues/${encodeURIComponent(issueKey)}/comments`, {
    count: 100,
    order: "asc"
  });
}

function issueToActivities(config: BacklogSpaceContext, issue: BacklogIssue): NormalizedActivity[] {
  const activities: NormalizedActivity[] = [];
  const projectKey = getProjectKey(issue.issueKey);
  const metadata = issueMetadata(config, issue);

  if (isOnReportDate(issue.updated, config.reportDate, config.reportTimezone)) {
    activities.push({
      source: "backlog",
      kind: "issue",
      projectKey,
      issueKey: issue.issueKey,
      title: `${issue.issueKey} ${issue.summary}`,
      ...(issue.description ? { body: issue.description } : {}),
      url: buildIssueUrl(config, issue.issueKey),
      ...(issue.created ? { createdAt: issue.created } : {}),
      ...(issue.updated ? { updatedAt: issue.updated } : {}),
      metadata
    });
  }

  if (issue.dueDate === config.reportDate && isAssignedToUser(config, issue)) {
    activities.push({
      source: "backlog",
      kind: "due_issue",
      projectKey,
      issueKey: issue.issueKey,
      title: `${issue.issueKey} due: ${issue.summary}`,
      url: buildIssueUrl(config, issue.issueKey),
      ...(issue.updated ? { updatedAt: issue.updated } : {}),
      metadata
    });
  }

  return activities;
}

function issueToAssignedProgressActivity(
  config: BacklogSpaceContext,
  issue: BacklogIssue
): NormalizedActivity[] {
  if (!isAssignedToUser(config, issue)) {
    return [];
  }

  if (issue.status?.name && isResolvedBacklogStatus(issue.status.name)) {
    return [];
  }

  const startDate = dateOnly(issue.startDate);
  const dueDate = dateOnly(issue.dueDate);
  if (!startDate && !dueDate) {
    return [];
  }

  const projectKey = getProjectKey(issue.issueKey);
  return [
    {
      source: "backlog",
      kind: "assigned_issue",
      projectKey,
      issueKey: issue.issueKey,
      title: `${issue.issueKey} ${issue.summary}`,
      url: buildIssueUrl(config, issue.issueKey),
      ...(issue.updated ? { updatedAt: issue.updated } : {}),
      metadata: compactMetadata({
        ...issueMetadata(config, issue),
        ...(startDate ? { startDate } : {}),
        ...(dueDate ? { dueDate } : {})
      })
    }
  ];
}

function commentsToActivities(
  config: BacklogSpaceContext,
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

    const url = `${buildIssueUrl(config, issue.issueKey)}#comment-${comment.id}`;
    const metadata = compactMetadata({
      ...issueMetadata(config, issue),
      backlogCommentId: comment.id,
      author: comment.createdUser?.name
    });

    if (comment.content?.trim()) {
      activities.push({
        source: "backlog",
        kind: "comment",
        projectKey,
        issueKey: issue.issueKey,
        title: `${issue.issueKey} ${issue.summary}`,
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
        title: `${issue.issueKey} ${issue.summary}`,
        body: describeStatusChange(change.originalValue, change.newValue),
        url,
        ...(comment.created ? { createdAt: comment.created } : {}),
        metadata: compactMetadata({
          ...metadata,
          field: change.field,
          status: change.newValue,
          originalValue: change.originalValue,
          newValue: change.newValue
        })
      });
    }
  }

  return activities;
}

async function backlogGet<T>(
  config: BacklogSpaceContext,
  path: string,
  params: Record<string, QueryValue>
): Promise<T> {
  const host = backlogHost(config);
  const url = new URL(`https://${host}/api/v2${path}`);
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
    throw new Error(await backlogErrorMessage(config, host, path, response));
  }

  return (await response.json()) as T;
}

function isAssignedToUser(config: BacklogSpaceContext, issue: BacklogIssue): boolean {
  return Boolean(config.backlogUserId && String(issue.assignee?.id) === config.backlogUserId);
}

function issueMetadata(config: BacklogSpaceContext, issue: BacklogIssue): Record<string, unknown> {
  return compactMetadata({
    backlogIssueId: issue.id,
    backlogSpace: config.space,
    issueType: issue.issueType?.name,
    categories: namesOf(issue.category),
    milestones: namesOf(issue.milestone),
    status: issue.status?.name
  });
}

function namesOf(values: BacklogNamedValue[] | null | undefined): string[] | undefined {
  const names = (values ?? []).map((value) => value.name).filter(Boolean);
  return names.length > 0 ? names : undefined;
}

function dateOnly(value: string | null | undefined): string | undefined {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

function isResolvedBacklogStatus(status: string): boolean {
  return /done|closed|resolved|completed|処理済み|完了|対応済み|終了|クローズ/i.test(status);
}

function backlogHost(config: BacklogSpaceContext): string {
  return config.host?.trim() || `${config.space}.backlog.com`;
}

async function backlogErrorMessage(
  config: BacklogSpaceContext,
  host: string,
  path: string,
  response: Response
): Promise<string> {
  const details = compactResponseBody(await safeResponseText(response));
  const hostHint = host.endsWith(".backlog.com")
    ? ` If this space uses backlog.jp or another Backlog host, set backlog.spaces.${config.space}.host.`
    : "";
  const assigneeHint = /assigneeId/i.test(details)
    ? " Check backlog.userId. It must be the numeric Backlog user id for this space; omit backlog.userId to use the API key owner from /users/myself."
    : "";

  return [
    `Backlog API request failed for https://${host}/api/v2${path} with status ${response.status}.`,
    details ? `Response: ${details}.` : "",
    hostHint,
    assigneeHint
  ].filter(Boolean).join(" ");
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function compactResponseBody(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function buildIssueUrl(config: BacklogSpaceContext, issueKey: string): string {
  return `https://${backlogHost(config)}/view/${issueKey}`;
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
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }

      if (Array.isArray(value) && value.length === 0) {
        return false;
      }

      return true;
    })
  );
}
