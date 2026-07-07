import type { ActivityGroup, GitHubActionsContext, GitppouConfig } from "./types.js";

type SlackPayload = {
  text: string;
};

export function generateSlackSummary(
  config: GitppouConfig,
  groups: ActivityGroup[],
  reportPath: string
): string {
  const isJapanese = config.reportLanguage === "ja";
  const title = isJapanese ? `日報 ${config.reportDate}` : `Daily Report - ${config.reportDate}`;
  const workLabel = isJapanese ? "本日対応:" : "Work:";
  const blockerLabel = isJapanese ? "課題・相談:" : "Blockers / Questions:";
  const runLabel = isJapanese ? "実行:" : "Run:";
  const detailsLabel = isJapanese ? "詳細:" : "Details:";
  const runLines = githubActionsContextLines(config.githubActionsContext, config.reportLanguage);
  const workItems = groups.slice(0, 8).map((group) => `- ${formatGroup(group)}`);
  const blockers = groups
    .flatMap((group) =>
      group.activities
        .filter((activity) => /blocker|blocked|question|needs confirmation|確認|課題|相談|ブロック|未解決/i.test(
          `${activity.title}\n${activity.body ?? ""}`
        ))
        .map((activity) => `- ${activity.issueKey ? `${activity.issueKey} ` : ""}${activity.title}`)
    )
    .slice(0, 5);
  const lines = [
    title,
    "",
    ...(runLines.length > 0 ? [runLabel, ...runLines, ""] : []),
    workLabel,
    ...(workItems.length > 0 ? workItems : [isJapanese ? "- 活動なし" : "- No activity found"]),
    "",
    blockerLabel,
    ...(blockers.length > 0 ? blockers : [isJapanese ? "- なし" : "- None found"]),
    "",
    detailsLabel,
    reportPath
  ];

  return truncate(lines.join("\n"), 3500);
}

function githubActionsContextLines(
  context: GitHubActionsContext | undefined,
  language: GitppouConfig["reportLanguage"]
): string[] {
  if (!context) {
    return [];
  }

  const isJapanese = language === "ja";
  const runUrl = githubActionsRunUrl(context);
  return [
    context.actor ? `- ${isJapanese ? "実行者" : "Actor"}: ${context.actor}` : undefined,
    context.workflow || context.runNumber
      ? `- Workflow: ${[context.workflow, context.runNumber ? `#${context.runNumber}` : undefined].filter(Boolean).join(" ")}`
      : undefined,
    context.repository || context.refName
      ? `- Repository: ${[context.repository, context.refName ? `(${context.refName})` : undefined].filter(Boolean).join(" ")}`
      : undefined,
    context.eventName ? `- Event: ${context.eventName}` : undefined,
    runUrl ? `- URL: ${runUrl}` : undefined
  ].filter((line): line is string => Boolean(line));
}

function githubActionsRunUrl(context: GitHubActionsContext): string | undefined {
  if (!context.repository || !context.runId) {
    return undefined;
  }

  const serverUrl = context.serverUrl ?? "https://github.com";
  return `${serverUrl.replace(/\/+$/g, "")}/${context.repository}/actions/runs/${context.runId}`;
}

export async function sendSlackNotification(webhookUrl: string | undefined, text: string): Promise<void> {
  if (!webhookUrl) {
    return;
  }

  const payload: SlackPayload = { text };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Slack webhook request failed with status ${response.status}.`);
  }
}

function formatGroup(group: ActivityGroup): string {
  if (group.issueKey === "Unlinked") {
    return "Unlinked";
  }

  return group.title ? `${group.issueKey} ${group.title}` : group.issueKey;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}
