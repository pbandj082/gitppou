import type { ActivityGroup, GitppouConfig, NormalizedActivity } from "../types.js";

type TemplateReportInput = {
  config: GitppouConfig;
  activities: NormalizedActivity[];
  groups: ActivityGroup[];
};

type Labels = {
  title: string;
  work: string;
  progress: string;
  blockers: string;
  nextActions: string;
  rawActivity: string;
  github: string;
  backlog: string;
  noActivity: string;
  noBlockers: string;
  noNextActions: string;
};

const LABELS: Record<GitppouConfig["reportLanguage"], Labels> = {
  en: {
    title: "Daily Report",
    work: "Work completed today",
    progress: "Progress",
    blockers: "Blockers / Questions",
    nextActions: "Next actions",
    rawActivity: "Raw Activity",
    github: "GitHub",
    backlog: "Backlog",
    noActivity: "No GitHub or Backlog activity was found for this date.",
    noBlockers: "None found in today's activity.",
    noNextActions: "Needs confirmation."
  },
  ja: {
    title: "日報",
    work: "本日対応したこと",
    progress: "進捗",
    blockers: "課題・相談事項",
    nextActions: "明日やること",
    rawActivity: "Raw Activity",
    github: "GitHub",
    backlog: "Backlog",
    noActivity: "この日のGitHubまたはBacklogの活動は見つかりませんでした。",
    noBlockers: "本日の活動からは見つかりませんでした。",
    noNextActions: "確認が必要"
  }
};

export function applyTemplateProvider(templateDraft: string): string {
  return templateDraft;
}

export function generateTemplateReport({ config, activities, groups }: TemplateReportInput): string {
  const labels = LABELS[config.reportLanguage];
  const lines: string[] = [`# ${labels.title} - ${config.reportDate}`, ""];

  lines.push(`## ${labels.work}`, "");
  if (groups.length === 0) {
    lines.push(`- ${labels.noActivity}`, "");
  } else {
    for (const group of groups) {
      lines.push(`### ${formatGroupHeading(group)}`, "");
      for (const activity of group.activities) {
        lines.push(`- ${describeActivity(activity, config.reportLanguage)}`);
      }
      lines.push("");
    }
  }

  lines.push(`## ${labels.progress}`, "");
  for (const line of progressLines(groups, config.reportLanguage)) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  lines.push(`## ${labels.blockers}`, "");
  const blockers = blockerLines(activities);
  if (blockers.length === 0) {
    lines.push(`- ${labels.noBlockers}`);
  } else {
    for (const blocker of blockers) {
      lines.push(`- ${blocker}`);
    }
  }
  lines.push("");

  lines.push(`## ${labels.nextActions}`, "");
  const nextActions = nextActionLines(groups, config.reportLanguage);
  if (nextActions.length === 0) {
    lines.push(`- ${labels.noNextActions}`);
  } else {
    for (const nextAction of nextActions) {
      lines.push(`- ${nextAction}`);
    }
  }
  lines.push("");

  lines.push(`## ${labels.rawActivity}`, "");
  lines.push(`### ${labels.github}`, "");
  for (const line of rawActivityLines(activities.filter((activity) => activity.source === "github"))) {
    lines.push(`- ${line}`);
  }
  if (!activities.some((activity) => activity.source === "github")) {
    lines.push("- None");
  }
  lines.push("");

  lines.push(`### ${labels.backlog}`, "");
  for (const line of rawActivityLines(activities.filter((activity) => activity.source === "backlog"))) {
    lines.push(`- ${line}`);
  }
  if (!activities.some((activity) => activity.source === "backlog")) {
    lines.push("- None");
  }

  return lines.join("\n").trimEnd();
}

function formatGroupHeading(group: ActivityGroup): string {
  if (group.issueKey === "Unlinked") {
    return "Unlinked";
  }

  return group.title ? `${group.issueKey} ${group.title}` : group.issueKey;
}

function describeActivity(activity: NormalizedActivity, language: GitppouConfig["reportLanguage"]): string {
  const prefix = activity.issueKey ? `${activity.issueKey}: ` : "";
  const title = stripMarkdownBreaks(activity.title);

  if (language === "ja") {
    switch (activity.kind) {
      case "commit":
        return `${prefix}commitを作成: ${title}`;
      case "pull_request":
        return `${prefix}PRを更新: ${title}`;
      case "review":
        return `${prefix}PRレビューを実施: ${title}`;
      case "comment":
        return `${prefix}コメントを追加: ${compactBody(activity.body) ?? title}`;
      case "issue":
        return `${prefix}Backlog課題を確認: ${title}${statusSuffix(activity)}`;
      case "status_change":
        return `${prefix}${activity.body ?? "Backlogステータスを更新"}`;
      case "due_issue":
        return `${prefix}本日が期限の課題: ${title}`;
    }
  }

  switch (activity.kind) {
    case "commit":
      return `${prefix}Committed: ${title}`;
    case "pull_request":
      return `${prefix}Updated pull request: ${title}`;
    case "review":
      return `${prefix}Reviewed pull request: ${title}`;
    case "comment":
      return `${prefix}Commented: ${compactBody(activity.body) ?? title}`;
    case "issue":
      return `${prefix}Backlog issue activity: ${title}${statusSuffix(activity)}`;
    case "status_change":
      return `${prefix}${activity.body ?? "Backlog status changed."}`;
    case "due_issue":
      return `${prefix}Assigned issue due today: ${title}`;
  }
}

function progressLines(groups: ActivityGroup[], language: GitppouConfig["reportLanguage"]): string[] {
  if (groups.length === 0) {
    return [language === "ja" ? "記録された進捗はありません。" : "No recorded progress."];
  }

  return groups.map((group) => {
    const status = firstStringMetadata(group.activities, "status");
    const githubCount = group.activities.filter((activity) => activity.source === "github").length;
    const backlogCount = group.activities.filter((activity) => activity.source === "backlog").length;
    const prefix = group.issueKey === "Unlinked" ? "Unlinked" : group.issueKey;

    if (language === "ja") {
      const statusText = status ? `ステータス: ${status}` : "ステータス確認が必要";
      return `${prefix}: ${statusText}。GitHub ${githubCount}件、Backlog ${backlogCount}件。`;
    }

    const statusText = status ? `status: ${status}` : "status needs confirmation";
    return `${prefix}: ${statusText}; ${githubCount} GitHub item(s), ${backlogCount} Backlog item(s).`;
  });
}

function blockerLines(activities: NormalizedActivity[]): string[] {
  const pattern = /blocker|blocked|question|needs confirmation|確認|課題|相談|ブロック|未解決/i;
  return activities
    .filter((activity) => pattern.test(`${activity.title}\n${activity.body ?? ""}`))
    .slice(0, 8)
    .map((activity) => `${activity.issueKey ? `${activity.issueKey}: ` : ""}${compactBody(activity.body) ?? activity.title}`);
}

function nextActionLines(groups: ActivityGroup[], language: GitppouConfig["reportLanguage"]): string[] {
  const candidates = groups
    .filter((group) =>
      group.activities.some((activity) => {
        const status = String(activity.metadata?.status ?? "").toLowerCase();
        const state = String(activity.metadata?.state ?? "").toLowerCase();
        return (
          activity.kind === "due_issue" ||
          status.includes("progress") ||
          status.includes("review") ||
          status.includes("処理") ||
          status.includes("レビュー") ||
          state === "open"
        );
      })
    )
    .slice(0, 8);

  return candidates.map((group) => {
    const heading = formatGroupHeading(group);
    return language === "ja" ? `${heading} の次の対応を確認` : `Confirm next step for ${heading}.`;
  });
}

function rawActivityLines(activities: NormalizedActivity[]): string[] {
  return activities.map((activity) => {
    const repo = activity.repository ? `${activity.repository} ` : "";
    const url = activity.url ? ` (${activity.url})` : "";
    return `${labelForKind(activity.kind)}: ${repo}${activity.title}${url}`;
  });
}

function labelForKind(kind: NormalizedActivity["kind"]): string {
  switch (kind) {
    case "commit":
      return "Commit";
    case "pull_request":
      return "PR";
    case "review":
      return "Review";
    case "comment":
      return "Comment";
    case "issue":
      return "Issue";
    case "status_change":
      return "Status";
    case "due_issue":
      return "Due today";
  }
}

function statusSuffix(activity: NormalizedActivity): string {
  const status = typeof activity.metadata?.status === "string" ? activity.metadata.status : undefined;
  return status ? ` (${status})` : "";
}

function firstStringMetadata(activities: NormalizedActivity[], key: string): string | undefined {
  for (const activity of activities) {
    const value = activity.metadata?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function compactBody(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }

  const compact = stripMarkdownBreaks(body).slice(0, 180);
  return compact.length < body.length ? `${compact}...` : compact;
}

function stripMarkdownBreaks(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
