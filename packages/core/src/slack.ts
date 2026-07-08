import type { GitHubActionsContext, GitppouConfig } from "./types.js";

type SlackPayload = {
  text: string;
};

export function generateSlackSummary(
  config: GitppouConfig,
  reportPath: string,
  reportMarkdown: string,
  summaryText?: string
): string {
  const isJapanese = config.reportLanguage === "ja";
  const title = isJapanese ? `日報 ${config.reportDate}` : `Daily Report - ${config.reportDate}`;
  const detailsLabel = isJapanese ? "詳細" : "Details";
  const contextLine = githubActionsContextLine(config.githubActionsContext);
  const details = reportDetails(reportPath, config.githubActionsContext);
  const summary = cleanSummaryText(summaryText) ?? localReportSummary(reportMarkdown, config.reportLanguage);
  const lines = [
    title,
    ...(contextLine ? [contextLine] : []),
    `${detailsLabel}: ${details}`,
    "",
    summary
  ];

  return truncate(lines.join("\n"), 3500);
}

function githubActionsContextLine(context: GitHubActionsContext | undefined): string | undefined {
  if (!context) {
    return undefined;
  }

  const workflow = [context.workflow, context.runNumber ? `#${context.runNumber}` : undefined].filter(Boolean).join(" ");
  const repository = [context.repository, context.refName ? `(${context.refName})` : undefined].filter(Boolean).join(" ");
  const actor = context.actor ? `by ${context.actor}` : undefined;
  const parts = [actor, workflow || undefined, repository || undefined].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function reportDetails(reportPath: string, context: GitHubActionsContext | undefined): string {
  const url = githubReportFileUrl(reportPath, context);
  return url ? `<${url}|${reportPath}>` : reportPath;
}

function githubReportFileUrl(reportPath: string, context: GitHubActionsContext | undefined): string | undefined {
  if (!context?.repository || !context.refName) {
    return undefined;
  }

  const reportFilePath = reportPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const serverUrl = context.serverUrl ?? "https://github.com";
  return `${serverUrl.replace(/\/+$/g, "")}/${context.repository}/blob/${context.refName}/${encodePath(reportFilePath)}`;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function cleanSummaryText(value: string | undefined): string | undefined {
  const compact = value?.replace(/\s+/g, " ").trim();
  return compact || undefined;
}

function localReportSummary(
  reportMarkdown: string,
  language: GitppouConfig["reportLanguage"]
): string {
  const workItems = sectionHeadings(reportMarkdown, language === "ja" ? "本日対応したこと" : "Work completed today")
    .filter((heading) => heading !== "Unlinked")
    .slice(0, 3);
  const nextItems = nextActionItems(reportMarkdown, language).slice(0, 2);

  if (language === "ja") {
    if (workItems.length === 0) {
      return "本日のユーザー行動は見つかりませんでした。詳細はリンク先の日報を確認してください。";
    }

    const next = nextItems.length > 0 ? `明日は${joinJapanese(nextItems)}を確認・対応する予定です。` : "";
    return `本日は${joinJapanese(workItems)}を中心に対応しました。${next}`;
  }

  if (workItems.length === 0) {
    return "No user activity was found for this date. See the linked report for details.";
  }

  const next = nextItems.length > 0 ? ` Next actions focus on ${joinEnglish(nextItems)}.` : "";
  return `Worked mainly on ${joinEnglish(workItems)}.${next}`;
}

function sectionHeadings(reportMarkdown: string, sectionTitle: string): string[] {
  return sectionLines(reportMarkdown, sectionTitle)
    .filter((line) => /^###\s+/.test(line))
    .map((line) => stripMarkdownLinks(line.replace(/^###\s+/, "").trim()))
    .filter(Boolean);
}

function nextActionItems(reportMarkdown: string, language: GitppouConfig["reportLanguage"]): string[] {
  const sectionTitle = language === "ja" ? "明日やること" : "Next actions";
  return sectionLines(reportMarkdown, sectionTitle)
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, "").replace(/[:：].*$/, "").trim())
    .filter(Boolean);
}

function sectionLines(reportMarkdown: string, sectionTitle: string): string[] {
  const lines = reportMarkdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);
  if (start < 0) {
    return [];
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s+/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

function stripMarkdownLinks(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function joinJapanese(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join("、")}、${items[items.length - 1]}`;
}

function joinEnglish(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}
