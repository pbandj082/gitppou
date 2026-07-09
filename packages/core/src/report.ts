import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBacklogActivities } from "./backlog.js";
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
import { filterGroupsByUserActions } from "./report-evidence.js";
import { generateSlackSummary, sendSlackNotification } from "./slack.js";
import type {
  GitppouConfig,
  NormalizedActivity,
  ReportResult,
} from "./types.js";

export async function generateDailyReport(
  config: GitppouConfig,
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
  reportMarkdown = normalizeMarkdownLinks(reportMarkdown);

  const reportPaths: string[] = [];
  const formats =
    config.reportFormats.length > 0 ? config.reportFormats : ["markdown"];
  const markdownPath = buildReportPath(config.reportDir, config.reportDate);
  const reportHtmlPath = formats.includes("html")
    ? buildReportHtmlPath(config.reportHtmlDir, config.reportDate)
    : undefined;

  if (formats.includes("markdown")) {
    await saveReport(markdownPath, reportMarkdown);
    reportPaths.push(markdownPath);
  }

  if (reportHtmlPath) {
    await saveReport(reportHtmlPath, renderReportHtml(reportMarkdown, config));
    reportPaths.push(reportHtmlPath);
  }

  const slackSummaryText = await generateSlackSummaryText(
    config,
    reportMarkdown,
  );
  const primaryReportPath = reportHtmlPath ?? markdownPath;
  const slackSummary = generateSlackSummary(
    config,
    primaryReportPath,
    reportMarkdown,
    slackSummaryText,
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
    reportPaths,
    reportMarkdown,
    slackSummary,
  };
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

async function saveReport(reportPath: string, contents: string): Promise<void> {
  const absolutePath = path.resolve(reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${contents.trimEnd()}\n`, "utf8");
}

function buildDatedReportPath(
  reportDir: string,
  reportDate: string,
  extension: "md" | "html",
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
