import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBacklogActivities } from "./backlog.js";
import { fetchGitHubActivities } from "./github.js";
import { applyTemplateProvider, generateTemplateReport, refineWithGitHubModels } from "./llm/index.js";
import { groupActivitiesByIssueKey, normalizeActivities } from "./normalize.js";
import { generateSlackSummary, sendSlackNotification } from "./slack.js";
import type { GitppouConfig, ReportResult } from "./types.js";

export async function generateDailyReport(config: GitppouConfig): Promise<ReportResult> {
  const [githubActivities, backlogActivities] = await Promise.all([
    fetchGitHubActivities(config),
    fetchBacklogActivities(config)
  ]);
  const activities = normalizeActivities([...githubActivities, ...backlogActivities], config.backlogProjectKeys);
  const groups = groupActivitiesByIssueKey(activities);
  const templateDraft = generateTemplateReport({ config, activities, groups });
  let reportMarkdown = applyTemplateProvider(templateDraft);

  if (config.llmProvider === "github-models") {
    try {
      reportMarkdown = await refineWithGitHubModels({
        config,
        templateDraft,
        activities
      });
    } catch (error) {
      console.warn(`Gitppou warning: GitHub Models failed; using template report. ${formatError(error)}`);
    }
  }

  const reportPath = buildReportPath(config.reportDir, config.reportDate);
  await saveReport(reportPath, reportMarkdown);

  const slackSummary = generateSlackSummary(config, groups, reportPath);
  if (config.slackNotify) {
    try {
      await sendSlackNotification(config.slackWebhookUrl, slackSummary);
    } catch (error) {
      console.warn(`Gitppou warning: Slack notification failed. ${formatError(error)}`);
    }
  }

  return {
    reportPath,
    reportMarkdown,
    slackSummary
  };
}

export function buildReportPath(reportDir: string, reportDate: string): string {
  const cleanDir = reportDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "reports";
  if (cleanDir.split("/").some((segment) => segment === "..")) {
    throw new Error('report-dir must not contain ".." path segments.');
  }

  const month = reportDate.slice(0, 7);
  return path.posix.join(cleanDir, month, `${reportDate}.md`);
}

async function saveReport(reportPath: string, reportMarkdown: string): Promise<void> {
  const absolutePath = path.resolve(reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${reportMarkdown.trimEnd()}\n`, "utf8");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
