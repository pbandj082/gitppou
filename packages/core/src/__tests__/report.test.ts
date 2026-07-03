import { describe, expect, it } from "vitest";
import { resolveReportDate } from "../config.js";
import { buildReportPath } from "../report.js";

describe("report helpers", () => {
  it("builds the monthly report path", () => {
    expect(buildReportPath("reports", "2026-07-03")).toBe("reports/2026-07/2026-07-03.md");
  });

  it("rejects report paths outside the workspace", () => {
    expect(() => buildReportPath("../reports", "2026-07-03")).toThrow("report-dir");
  });

  it("resolves a date from timezone when input is empty", () => {
    const date = resolveReportDate("", "Asia/Tokyo", new Date("2026-07-02T15:30:00Z"));
    expect(date).toBe("2026-07-03");
  });
});
