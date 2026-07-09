import * as core from "@actions/core";
import {
  generateDailyReport,
  publishBacklogDocument,
  sendSlackNotification,
} from "@gitppou/core";
import { readActionConfig } from "./config.js";
import { commitReportIfNeeded, syncReportBranchBeforeWrite } from "./git.js";

async function main(): Promise<void> {
  try {
    let config = await readActionConfig();
    if (config.commitReport) {
      await syncReportBranchBeforeWrite();
      config = await readActionConfig();
    }

    const sendSlackAfterCommit = config.commitReport && config.slackNotify;
    const publishBacklogDocumentAfterCommit =
      config.commitReport && config.backlogDocument;
    const result = await generateDailyReport(
      sendSlackAfterCommit || publishBacklogDocumentAfterCommit
        ? {
            ...config,
            ...(sendSlackAfterCommit ? { deferSlackNotification: true } : {}),
            deferBacklogDocumentPublish: true,
          }
        : config,
    );

    if (config.commitReport) {
      await commitReportIfNeeded({
        reportPaths: result.reportPaths,
        reportDate: config.reportDate,
      });
    }

    const backlogDocument = publishBacklogDocumentAfterCommit
      ? await publishBacklogDocument(config, result.reportMarkdown)
      : result.backlogDocument;

    core.setOutput("report-path", result.reportPath);
    core.setOutput("report-paths", result.reportPaths.join("\n"));
    if (result.reportHtmlPath) {
      core.setOutput("report-html-path", result.reportHtmlPath);
    }
    if (result.reportPdfPath) {
      core.setOutput("report-pdf-path", result.reportPdfPath);
    }
    if (backlogDocument) {
      core.setOutput("backlog-document-id", backlogDocument.id);
      core.setOutput("backlog-document-title", backlogDocument.title);
    }
    core.setOutput("report-markdown", result.reportMarkdown);

    if (sendSlackAfterCommit) {
      try {
        await sendSlackNotification(
          config.slackWebhookUrl,
          result.slackSummary,
        );
      } catch (error) {
        core.warning(`Slack notification failed. ${formatError(error)}`);
      }
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

await main();

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
