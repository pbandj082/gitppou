import * as exec from "@actions/exec";

type CommitReportOptions = {
  reportPath: string;
  reportDate: string;
};

export async function commitReportIfNeeded({ reportPath, reportDate }: CommitReportOptions): Promise<void> {
  await git(["config", "user.name", "gitppou[bot]"]);
  await git(["config", "user.email", "gitppou[bot]@users.noreply.github.com"]);
  await git(["add", "--", reportPath]);

  const diffCode = await exec.exec("git", ["diff", "--cached", "--quiet", "--", reportPath], {
    ignoreReturnCode: true
  });

  if (diffCode === 0) {
    console.log("No report changes to commit.");
    return;
  }

  if (diffCode !== 1) {
    throw new Error(`git diff failed with exit code ${diffCode}.`);
  }

  await git(["commit", "-m", `Add daily report ${reportDate}`, "--", reportPath]);
  await git(["push"]);
}

async function git(args: string[]): Promise<void> {
  const exitCode = await exec.exec("git", args, {
    ignoreReturnCode: true
  });

  if (exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed with exit code ${exitCode}.`);
  }
}
