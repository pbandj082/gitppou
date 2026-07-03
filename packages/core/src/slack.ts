import type { ActivityGroup, GitppouConfig } from "./types.js";

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
  const detailsLabel = isJapanese ? "詳細:" : "Details:";
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
