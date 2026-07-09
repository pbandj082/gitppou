import type { GitppouConfig, ReportResult } from "@gitppou/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitReportIfNeeded: vi.fn(),
  generateDailyReport: vi.fn(),
  generateSlackSummary: vi.fn(),
  publishBacklogDocument: vi.fn(),
  readActionConfig: vi.fn(),
  sendSlackNotification: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  syncReportBranchBeforeWrite: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  setFailed: mocks.setFailed,
  setOutput: mocks.setOutput,
  warning: mocks.warning,
}));

vi.mock("@gitppou/core", () => ({
  generateDailyReport: mocks.generateDailyReport,
  generateSlackSummary: mocks.generateSlackSummary,
  publishBacklogDocument: mocks.publishBacklogDocument,
  sendSlackNotification: mocks.sendSlackNotification,
}));

vi.mock("../config.js", () => ({
  readActionConfig: mocks.readActionConfig,
}));

vi.mock("../git.js", () => ({
  commitReportIfNeeded: mocks.commitReportIfNeeded,
  syncReportBranchBeforeWrite: mocks.syncReportBranchBeforeWrite,
}));

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogSpaces: [],
  reportDate: "2026-07-08",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "ja",
  reportDir: ".gitppou/reports",
  reportFormats: ["markdown"],
  reportHtmlDir: ".gitppou/site",
  reportPdfDir: ".gitppou/pdf",
  commitReport: true,
  slackNotify: false,
  llmProvider: "template",
  llmModel: "openai/gpt-4o-mini",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

const reportResult: ReportResult = {
  reportPath: ".gitppou/pdf/2026-07/2026-07-08.pdf",
  reportHtmlPath: ".gitppou/site/2026-07/2026-07-08.html",
  reportPdfPath: ".gitppou/pdf/2026-07/2026-07-08.pdf",
  reportPaths: [
    ".gitppou/reports/2026-07/2026-07-08.md",
    ".gitppou/site/2026-07/2026-07-08.html",
    ".gitppou/pdf/2026-07/2026-07-08.pdf",
  ],
  reportMarkdown: "# 日報",
  slackSummary: "summary",
};

beforeEach(() => {
  vi.resetModules();
  mocks.commitReportIfNeeded.mockReset();
  mocks.generateDailyReport.mockReset();
  mocks.generateSlackSummary.mockReset();
  mocks.publishBacklogDocument.mockReset();
  mocks.readActionConfig.mockReset();
  mocks.sendSlackNotification.mockReset();
  mocks.setFailed.mockReset();
  mocks.setOutput.mockReset();
  mocks.syncReportBranchBeforeWrite.mockReset();
  mocks.warning.mockReset();
});

describe("action entrypoint", () => {
  it("reloads config after syncing the report branch before generating files", async () => {
    const staleConfig: GitppouConfig = {
      ...baseConfig,
      reportFormats: ["markdown"],
    };
    const syncedConfig: GitppouConfig = {
      ...baseConfig,
      reportFormats: ["markdown", "html", "pdf"],
    };
    mocks.readActionConfig
      .mockResolvedValueOnce(staleConfig)
      .mockResolvedValueOnce(syncedConfig);
    mocks.generateDailyReport.mockResolvedValue(reportResult);

    await import("../index.js");

    expect(mocks.readActionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.syncReportBranchBeforeWrite).toHaveBeenCalledTimes(1);
    const syncOrder =
      mocks.syncReportBranchBeforeWrite.mock.invocationCallOrder[0];
    const secondReadOrder = mocks.readActionConfig.mock.invocationCallOrder[1];
    expect(syncOrder).toBeDefined();
    expect(secondReadOrder).toBeDefined();
    expect(syncOrder ?? 0).toBeLessThan(secondReadOrder ?? 0);
    expect(mocks.generateDailyReport).toHaveBeenCalledWith(syncedConfig);
    expect(mocks.commitReportIfNeeded).toHaveBeenCalledWith({
      reportPaths: reportResult.reportPaths,
      reportDate: "2026-07-08",
    });
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "report-html-path",
      ".gitppou/site/2026-07/2026-07-08.html",
    );
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "report-pdf-path",
      ".gitppou/pdf/2026-07/2026-07-08.pdf",
    );
  });

  it("publishes Backlog documents after committing reports", async () => {
    const config: GitppouConfig = {
      ...baseConfig,
      backlogApiKey: "backlog-key",
      backlogDocument: {
        space: "example",
        projectId: 456,
      },
      slackNotify: true,
    };
    mocks.readActionConfig.mockResolvedValue(config);
    mocks.generateDailyReport.mockResolvedValue({
      ...reportResult,
      slackSummaryText: "LLM summary",
    });
    const backlogDocument = {
      id: "document-id",
      projectId: 456,
      title: "Daily Report 2026-07-08",
      url: "https://example.backlog.com/document/APP/document-id",
    };
    mocks.publishBacklogDocument.mockResolvedValue(backlogDocument);
    mocks.generateSlackSummary.mockReturnValue("summary with Backlog document");

    await import("../index.js");

    expect(mocks.generateDailyReport).toHaveBeenCalledWith({
      ...config,
      deferSlackNotification: true,
      deferBacklogDocumentPublish: true,
    });
    const commitOrder = mocks.commitReportIfNeeded.mock.invocationCallOrder[0];
    const publishOrder =
      mocks.publishBacklogDocument.mock.invocationCallOrder[0];
    expect(commitOrder).toBeDefined();
    expect(publishOrder).toBeDefined();
    expect(commitOrder ?? 0).toBeLessThan(publishOrder ?? 0);
    expect(mocks.publishBacklogDocument).toHaveBeenCalledWith(config, "# 日報");
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "backlog-document-id",
      "document-id",
    );
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "backlog-document-title",
      "Daily Report 2026-07-08",
    );
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "backlog-document-url",
      "https://example.backlog.com/document/APP/document-id",
    );
    expect(mocks.generateSlackSummary).toHaveBeenCalledWith(
      config,
      reportResult.reportPaths,
      "# 日報",
      "LLM summary",
      { backlogDocument },
    );
    expect(mocks.sendSlackNotification).toHaveBeenCalledWith(
      undefined,
      "summary with Backlog document",
    );
  });
});
