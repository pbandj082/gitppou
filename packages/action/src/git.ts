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
  await pushWithRemoteSync();
}

async function pushWithRemoteSync(): Promise<void> {
  await git(["pull", "--rebase", "--autostash"]);

  const firstPushCode = await gitExit(["push"]);
  if (firstPushCode === 0) {
    return;
  }

  await git(["pull", "--rebase", "--autostash"]);
  const secondPushCode = await gitExit(["push"]);
  if (secondPushCode !== 0) {
    throw new Error(`git push failed with exit code ${secondPushCode}.`);
  }
}

async function git(args: string[]): Promise<void> {
  const exitCode = await gitExit(args);

  if (exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed with exit code ${exitCode}.`);
  }
}

async function gitExit(args: string[]): Promise<number> {
  return exec.exec("git", args, {
    ignoreReturnCode: true
  });
}
