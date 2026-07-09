#!/usr/bin/env node
import { generateDailyReport } from "@gitppou/core";
import { parseArgs } from "node:util";
import { loadPreviewConfig, type PreviewConfigOptions } from "./config.js";

type CliOptions = PreviewConfigOptions & {
  command: "preview" | "help";
  printMarkdown: boolean;
  jsonOutput: boolean;
  help: boolean;
};

type ParsedValues = Record<string, string | boolean | undefined>;
type PreviewStringOptionKey = Exclude<
  {
    [Key in keyof PreviewConfigOptions]: PreviewConfigOptions[Key] extends
      string | undefined
      ? Key
      : never;
  }[keyof PreviewConfigOptions],
  undefined
>;

async function main(args: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    console.error(formatError(error));
    console.error("");
    console.error(helpText());
    return 1;
  }

  if (options.help || options.command === "help") {
    console.log(helpText());
    return 0;
  }

  try {
    await runPreview(options);
    return 0;
  } catch (error) {
    console.error(`Gitppou preview failed: ${formatError(error)}`);
    return 1;
  }
}

function parseCliArgs(args: string[]): CliOptions {
  const parsed = parseArgs({
    args: args.filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      "env-file": { type: "string" },
      date: { type: "string", short: "d" },
      "report-date": { type: "string" },
      timezone: { type: "string" },
      "report-timezone": { type: "string" },
      language: { type: "string" },
      "report-language": { type: "string" },
      "report-dir": { type: "string" },
      "llm-provider": { type: "string" },
      "llm-model": { type: "string" },
      "llm-max-input-chars": { type: "string" },
      "llm-style": { type: "string" },
      slack: { type: "boolean" },
      print: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const values = parsed.values as ParsedValues;
  const command = parsed.positionals[0] ?? "help";

  if (parsed.positionals.length > 1) {
    throw new Error(`Unexpected argument: ${parsed.positionals[1]}`);
  }

  if (command !== "preview" && command !== "help") {
    throw new Error(`Unknown command: ${command}`);
  }

  if (values.json && values.print) {
    throw new Error("Use either --json or --print, not both.");
  }

  const options: CliOptions = {
    command,
    printMarkdown: Boolean(values.print),
    jsonOutput: Boolean(values.json),
    help: Boolean(values.help),
    slackNotify: Boolean(values.slack),
  };
  assignStringOption(
    options,
    "configPath",
    readStringOption(values, "config", "--config"),
  );
  assignStringOption(
    options,
    "envFilePath",
    readStringOption(values, "env-file", "--env-file"),
  );
  assignStringOption(
    options,
    "reportDate",
    readFirstStringOption(values, ["date", "report-date"], "report date"),
  );
  assignStringOption(
    options,
    "reportTimezone",
    readFirstStringOption(
      values,
      ["timezone", "report-timezone"],
      "report timezone",
    ),
  );
  assignStringOption(
    options,
    "reportLanguage",
    readFirstStringOption(
      values,
      ["language", "report-language"],
      "report language",
    ),
  );
  assignStringOption(
    options,
    "reportDir",
    readStringOption(values, "report-dir", "--report-dir"),
  );
  assignStringOption(
    options,
    "llmProvider",
    readStringOption(values, "llm-provider", "--llm-provider"),
  );
  assignStringOption(
    options,
    "llmModel",
    readStringOption(values, "llm-model", "--llm-model"),
  );
  assignStringOption(
    options,
    "llmMaxInputChars",
    readStringOption(values, "llm-max-input-chars", "--llm-max-input-chars"),
  );
  assignStringOption(
    options,
    "llmStyle",
    readStringOption(values, "llm-style", "--llm-style"),
  );

  return options;
}

async function runPreview(options: CliOptions): Promise<void> {
  const { configPath, config } = await loadPreviewConfig(options);
  const result = await generateDailyReport(config);

  if (options.jsonOutput) {
    console.log(
      JSON.stringify(
        {
          configPath,
          reportDate: config.reportDate,
          reportPath: result.reportPath,
          reportPaths: result.reportPaths,
          reportHtmlPath: result.reportHtmlPath,
          reportPdfPath: result.reportPdfPath,
          backlogDocument: result.backlogDocument,
          reportMarkdown: result.reportMarkdown,
          slackSummary: result.slackSummary,
          slackNotify: config.slackNotify,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Config: ${configPath}`);
  console.log(`Report date: ${config.reportDate}`);
  for (const reportPath of result.reportPaths) {
    console.log(`Report written: ${reportPath}`);
  }
  if (result.backlogDocument) {
    console.log(
      `Backlog document created: ${result.backlogDocument.title} (${result.backlogDocument.id})`,
    );
    if (result.backlogDocument.url) {
      console.log(`Backlog document URL: ${result.backlogDocument.url}`);
    }
  }
  console.log(
    `Slack notification: ${config.slackNotify ? "requested" : "skipped"}`,
  );

  if (options.printMarkdown) {
    console.log("");
    console.log(result.reportMarkdown.trimEnd());
  }
}

function assignStringOption(
  target: PreviewConfigOptions,
  key: PreviewStringOptionKey,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function readFirstStringOption(
  values: ParsedValues,
  keys: string[],
  label: string,
): string | undefined {
  const found = keys
    .map((key) => [key, values[key]] as const)
    .filter(
      (entry): entry is readonly [string, string] =>
        typeof entry[1] === "string",
    );

  if (found.length > 1) {
    throw new Error(`Specify ${label} only once.`);
  }

  return found[0]?.[1];
}

function readStringOption(
  values: ParsedValues,
  key: string,
  label: string,
): string | undefined {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} requires a value.`);
  }

  return value;
}

function helpText(): string {
  return `Usage:
  gitppou preview [options]

Commands:
  preview                     Generate a local daily report preview

Options:
  -c, --config <path>         Config file path. Defaults to gitppou.local.yml, then gitppou.yml variants
      --env-file <path>       Load environment variables from a dotenv file
  -d, --date <YYYY-MM-DD>     Report date override
      --timezone <tz>         Report timezone override
      --language <en|ja>      Report language override
      --report-dir <path>     Directory where the Markdown report is written
      --llm-provider <name>   template or github-models
      --llm-model <model>     GitHub Models model ID
      --llm-style <style>     concise or detailed
      --slack                 Send Slack notification. Skipped by default for preview
      --print                 Print generated Markdown after writing it
      --json                  Print result as JSON
  -h, --help                  Show help

Environment:
  GITHUB_TOKEN                Required by default; configurable with github.tokenEnv
  GITPPOU_TOKEN_*             Optional owner-specific tokens referenced by github.tokens
  BACKLOG_API_KEY             Required
  SLACK_WEBHOOK_URL           Required only with --slack`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main(process.argv.slice(2));
