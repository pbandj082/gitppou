import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBacklogActivities, publishBacklogDocument } from "./backlog.js";
import { fetchGitHubActivities } from "./github.js";
import { renderReportHtml } from "./html.js";
import {
  applyTemplateProvider,
  generateTemplateReport,
  refineWithGitHubModels,
  summarizeSlackWithGitHubModels,
} from "./llm/index.js";
import { normalizeMarkdownLinks } from "./markdown.js";
import { groupActivitiesByIssueKey, normalizeActivities } from "./normalize.js";
import { saveReportPdf } from "./pdf.js";
import { filterGroupsByUserActions } from "./report-evidence.js";
import { generateSlackSummary, sendSlackNotification } from "./slack.js";
import type {
  GitppouConfig,
  NormalizedActivity,
  ReportResult,
} from "./types.js";

export async function generateDailyReport(
  config: GitppouConfig,
  generatedAt = new Date(),
): Promise<ReportResult> {
  const [githubActivities, backlogActivities] = await fetchActivities(config);
  const backlogProjectKeys = config.backlogSpaces.flatMap(
    (space) => space.projectKeys,
  );
  const activities = normalizeActivities(
    [...githubActivities, ...backlogActivities],
    backlogProjectKeys,
  );
  const groups = groupActivitiesByIssueKey(activities);
  const actionGroups = filterGroupsByUserActions(groups);
  const templateDraft = generateTemplateReport({
    config,
    activities,
    groups: actionGroups,
  });
  let reportMarkdown = applyTemplateProvider(templateDraft);

  if (config.llmProvider === "github-models") {
    try {
      reportMarkdown = await refineWithGitHubModels({
        config,
        templateDraft,
        activities,
        groups: actionGroups,
      });
    } catch (error) {
      console.warn(
        `Gitppou warning: GitHub Models failed; using template report. ${formatError(error)}`,
      );
    }
  }
  reportMarkdown = addReportMetadataLine(
    normalizeMarkdownLinks(reportMarkdown),
    config,
    generatedAt,
  );

  const reportPaths: string[] = [];
  const formats =
    config.reportFormats.length > 0 ? config.reportFormats : ["markdown"];
  const markdownPath = buildReportPath(config.reportDir, config.reportDate);
  const reportHtmlPath = formats.includes("html")
    ? buildReportHtmlPath(config.reportHtmlDir, config.reportDate)
    : undefined;
  const reportPdfPath = formats.includes("pdf")
    ? buildReportPdfPath(config.reportPdfDir, config.reportDate)
    : undefined;
  const reportHtml =
    reportHtmlPath || reportPdfPath
      ? renderReportHtml(reportMarkdown, config)
      : undefined;

  if (formats.includes("markdown")) {
    await saveReport(markdownPath, reportMarkdown);
    reportPaths.push(markdownPath);
  }

  if (reportHtmlPath && reportHtml) {
    await saveReport(reportHtmlPath, reportHtml);
    reportPaths.push(reportHtmlPath);
  }

  if (reportPdfPath && reportHtml) {
    await saveReportPdf(reportHtml, reportPdfPath);
    reportPaths.push(reportPdfPath);
  }

  const backlogDocument = config.deferBacklogDocumentPublish
    ? undefined
    : await publishBacklogDocument(config, reportMarkdown);
  const slackSummaryText = await generateSlackSummaryText(
    config,
    reportMarkdown,
  );
  const primaryReportPath = reportPdfPath ?? reportHtmlPath ?? markdownPath;
  const slackSummary = generateSlackSummary(
    config,
    reportPaths,
    reportMarkdown,
    slackSummaryText,
    backlogDocument ? { backlogDocument } : {},
  );
  if (config.slackNotify && !config.deferSlackNotification) {
    try {
      await sendSlackNotification(config.slackWebhookUrl, slackSummary);
    } catch (error) {
      console.warn(
        `Gitppou warning: Slack notification failed. ${formatError(error)}`,
      );
    }
  }

  return {
    reportPath: primaryReportPath,
    ...(reportHtmlPath ? { reportHtmlPath } : {}),
    ...(reportPdfPath ? { reportPdfPath } : {}),
    reportPaths,
    reportMarkdown,
    slackSummary,
    ...(slackSummaryText ? { slackSummaryText } : {}),
    ...(backlogDocument ? { backlogDocument } : {}),
  };
}

function addReportMetadataLine(
  reportMarkdown: string,
  config: GitppouConfig,
  generatedAt: Date,
): string {
  const lines = reportMarkdown.trimStart().split("\n");
  const metadataLine = reportMetadataLine(config, generatedAt);
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  if (headingIndex < 0) {
    return [metadataLine, "", ...lines].join("\n");
  }

  const before = lines.slice(0, headingIndex + 1);
  const after = lines.slice(headingIndex + 1);
  return [
    ...before,
    "",
    metadataLine,
    "",
    ...dropLeadingBlankLines(after),
  ].join("\n");
}

function reportMetadataLine(config: GitppouConfig, generatedAt: Date): string {
  const labels =
    config.reportLanguage === "ja"
      ? { author: "作成者", generatedAt: "作成日時" }
      : { author: "author", generatedAt: "generatedAt" };
  return [
    `**${labels.author}**: ${config.reportAuthor ?? config.githubUsername}`,
    `**${labels.generatedAt}**: ${formatDateTimeInTimeZone(generatedAt, config.reportTimezone)}`,
  ].join(" / ");
}

function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return `${dateTimePart(parts, "year")}-${dateTimePart(parts, "month")}-${dateTimePart(parts, "day")} ${dateTimePart(parts, "hour")}:${dateTimePart(parts, "minute")}:${dateTimePart(parts, "second")} (${timeZone})`;
}

function dateTimePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Could not format date time part "${type}".`);
  }

  return value;
}

function dropLeadingBlankLines(lines: string[]): string[] {
  const firstContentIndex = lines.findIndex((line) => line.trim() !== "");
  return firstContentIndex < 0 ? [] : lines.slice(firstContentIndex);
}

async function generateSlackSummaryText(
  config: GitppouConfig,
  reportMarkdown: string,
): Promise<string | undefined> {
  if (!config.slackNotify || config.llmProvider !== "github-models") {
    return undefined;
  }

  try {
    return await summarizeSlackWithGitHubModels({
      config,
      reportMarkdown,
    });
  } catch (error) {
    console.warn(
      `Gitppou warning: GitHub Models Slack summary failed; using local summary. ${formatError(error)}`,
    );
    return undefined;
  }
}

async function fetchActivities(
  config: GitppouConfig,
): Promise<[NormalizedActivity[], NormalizedActivity[]]> {
  const [githubResult, backlogResult] = await Promise.allSettled([
    fetchGitHubActivities(config),
    fetchBacklogActivities(config),
  ]);

  if (
    githubResult.status === "rejected" ||
    backlogResult.status === "rejected"
  ) {
    const failures = [
      rejectedReason("GitHub", githubResult),
      rejectedReason("Backlog", backlogResult),
    ].filter((failure): failure is string => Boolean(failure));

    throw new Error(
      `Activity fetch failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  return [githubResult.value, backlogResult.value];
}

function rejectedReason(
  label: string,
  result: PromiseSettledResult<NormalizedActivity[]>,
): string | undefined {
  if (result.status === "fulfilled") {
    return undefined;
  }

  return `${label}: ${formatError(result.reason)}`;
}

export function buildReportPath(reportDir: string, reportDate: string): string {
  return buildDatedReportPath(reportDir, reportDate, "md", "report-dir");
}

export function buildReportHtmlPath(
  reportHtmlDir: string,
  reportDate: string,
): string {
  return buildDatedReportPath(
    reportHtmlDir,
    reportDate,
    "html",
    "report.htmlDir",
  );
}

export function buildReportPdfPath(
  reportPdfDir: string,
  reportDate: string,
): string {
  return buildDatedReportPath(reportPdfDir, reportDate, "pdf", "report.pdfDir");
}

async function saveReport(reportPath: string, contents: string): Promise<void> {
  const absolutePath = path.resolve(reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${contents.trimEnd()}\n`, "utf8");
}

function buildDatedReportPath(
  reportDir: string,
  reportDate: string,
  extension: "md" | "html" | "pdf",
  label: string,
): string {
  const cleanDir =
    reportDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "reports";
  if (cleanDir.split("/").some((segment) => segment === "..")) {
    throw new Error(`${label} must not contain ".." path segments.`);
  }

  const month = reportDate.slice(0, 7);
  return path.posix.join(cleanDir, month, `${reportDate}.${extension}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
