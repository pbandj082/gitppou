import * as core from "@actions/core";
import { generateDailyReport } from "@gitppou/core";
import { readActionConfig } from "./config.js";
import { commitReportIfNeeded } from "./git.js";

async function main(): Promise<void> {
  try {
    const config = readActionConfig();
    const result = await generateDailyReport(config);

    core.setOutput("report-path", result.reportPath);
    core.setOutput("report-markdown", result.reportMarkdown);

    if (config.commitReport) {
      await commitReportIfNeeded({
        reportPath: result.reportPath,
        reportDate: config.reportDate
      });
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

await main();
