import * as core from "@actions/core";
import { generateDailyReport, sendSlackNotification } from "@gitppou/core";
import { readActionConfig } from "./config.js";
import { commitReportIfNeeded, syncReportBranchBeforeWrite } from "./git.js";

async function main(): Promise<void> {
  try {
    const config = await readActionConfig();
    if (config.commitReport) {
      await syncReportBranchBeforeWrite();
    }

    const sendSlackAfterCommit = config.commitReport && config.slackNotify;
    const result = await generateDailyReport(
      sendSlackAfterCommit
        ? {
            ...config,
            deferSlackNotification: true,
          }
        : config,
    );

    core.setOutput("report-path", result.reportPath);
    core.setOutput("report-paths", result.reportPaths.join("\n"));
    if (result.reportHtmlPath) {
      core.setOutput("report-html-path", result.reportHtmlPath);
    }
    core.setOutput("report-markdown", result.reportMarkdown);

    if (config.commitReport) {
      await commitReportIfNeeded({
        reportPaths: result.reportPaths,
        reportDate: config.reportDate,
      });
    }

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
