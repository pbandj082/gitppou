import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitReportIfNeeded, syncReportBranchBeforeWrite } from "../git.js";

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  exec: execMock,
}));

beforeEach(() => {
  execMock.mockReset();
});

describe("commitReportIfNeeded", () => {
  it("fast-forwards the branch before the report file is written", async () => {
    execMock.mockResolvedValue(0);

    await syncReportBranchBeforeWrite();

    expect(gitArgs()).toEqual([["pull", "--ff-only"]]);
  });

  it("rebases onto the remote branch before pushing the report commit", async () => {
    execMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "diff") {
        return 1;
      }

      return 0;
    });

    await commitReportIfNeeded({
      reportPaths: [
        ".gitppou/reports/2026-07/2026-07-08.md",
        ".gitppou/site/2026-07/2026-07-08.html",
      ],
      reportDate: "2026-07-08",
    });

    expect(gitArgs()).toEqual([
      ["config", "user.name", "gitppou[bot]"],
      ["config", "user.email", "gitppou[bot]@users.noreply.github.com"],
      [
        "add",
        "--",
        ".gitppou/reports/2026-07/2026-07-08.md",
        ".gitppou/site/2026-07/2026-07-08.html",
      ],
      [
        "diff",
        "--cached",
        "--quiet",
        "--",
        ".gitppou/reports/2026-07/2026-07-08.md",
        ".gitppou/site/2026-07/2026-07-08.html",
      ],
      [
        "commit",
        "-m",
        "Add daily report 2026-07-08",
        "--",
        ".gitppou/reports/2026-07/2026-07-08.md",
        ".gitppou/site/2026-07/2026-07-08.html",
      ],
      ["pull", "--rebase", "--autostash"],
      ["push"],
    ]);
  });

  it("rebases and retries once when push is rejected", async () => {
    let pushCount = 0;
    execMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "diff") {
        return 1;
      }

      if (args[0] === "push") {
        pushCount += 1;
        return pushCount === 1 ? 1 : 0;
      }

      return 0;
    });

    await commitReportIfNeeded({
      reportPaths: [".gitppou/reports/2026-07/2026-07-08.md"],
      reportDate: "2026-07-08",
    });

    expect(gitArgs().filter((args) => args[0] === "pull")).toHaveLength(2);
    expect(gitArgs().filter((args) => args[0] === "push")).toHaveLength(2);
  });

  it("does not pull or push when the report is unchanged", async () => {
    execMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "diff") {
        return 0;
      }

      return 0;
    });

    await commitReportIfNeeded({
      reportPaths: [".gitppou/reports/2026-07/2026-07-08.md"],
      reportDate: "2026-07-08",
    });

    expect(gitArgs().some((args) => args[0] === "pull")).toBe(false);
    expect(gitArgs().some((args) => args[0] === "push")).toBe(false);
  });
});

function gitArgs(): string[][] {
  return execMock.mock.calls.map((call) => call[1] as string[]);
}
