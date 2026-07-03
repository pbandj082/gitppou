import { Octokit } from "@octokit/rest";
import { getReportDateRange, isOnReportDate } from "./config.js";
import type { GitppouConfig, NormalizedActivity } from "./types.js";

type RepoRef = {
  owner: string;
  repo: string;
  fullName: string;
};

export async function fetchGitHubActivities(config: GitppouConfig): Promise<NormalizedActivity[]> {
  if (config.githubRepos.length === 0) {
    return [];
  }

  const octokit = new Octokit({
    auth: config.githubToken,
    userAgent: "gitppou"
  });
  const repos = config.githubRepos.map(parseRepo);
  const activities = await Promise.all(repos.map((repo) => fetchRepoActivities(octokit, repo, config)));

  return activities.flat();
}

function parseRepo(value: string): RepoRef {
  const [owner, repo] = value.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid github-repos entry "${value}". Use owner/repo.`);
  }

  return { owner, repo, fullName: `${owner}/${repo}` };
}

async function fetchRepoActivities(
  octokit: Octokit,
  repo: RepoRef,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const [commits, pullRequests, comments, reviews] = await Promise.all([
    fetchCommits(octokit, repo, config),
    fetchPullRequests(octokit, repo, config),
    fetchIssueComments(octokit, repo, config),
    fetchPullRequestReviews(octokit, repo, config)
  ]);

  return [...commits, ...pullRequests, ...comments, ...reviews];
}

async function fetchCommits(
  octokit: Octokit,
  repo: RepoRef,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const { since, until } = getReportDateRange(config.reportDate, config.reportTimezone);
  const commits = await octokit.paginate(octokit.repos.listCommits, {
    owner: repo.owner,
    repo: repo.repo,
    author: config.githubUsername,
    since: since.toISOString(),
    until: until.toISOString(),
    per_page: 100
  });

  return commits
    .filter((commit) => isOnReportDate(commit.commit.author?.date, config.reportDate, config.reportTimezone))
    .map((commit) => {
      const title = firstLine(commit.commit.message);
      return {
        source: "github",
        kind: "commit",
        title,
        repository: repo.fullName,
        author: config.githubUsername,
        url: commit.html_url,
        ...(commit.commit.author?.date ? { createdAt: commit.commit.author.date } : {}),
        metadata: {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7)
        }
      } satisfies NormalizedActivity;
    });
}

async function fetchPullRequests(
  octokit: Octokit,
  repo: RepoRef,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const createdQuery = `repo:${repo.fullName} is:pr author:${config.githubUsername} created:${config.reportDate}`;
  const updatedQuery = `repo:${repo.fullName} is:pr involves:${config.githubUsername} updated:${config.reportDate}`;
  const mergedQuery = `repo:${repo.fullName} is:pr is:merged merged:${config.reportDate}`;
  const [created, updated, merged] = await Promise.all([
    searchIssues(octokit, createdQuery),
    searchIssues(octokit, updatedQuery),
    searchIssues(octokit, mergedQuery)
  ]);
  const mergedByUser = await filterMergedByUser(octokit, repo, merged, config.githubUsername);
  const items = mergeSearchItems([...created, ...updated, ...mergedByUser]);

  return items.map((item) => {
    const activity: NormalizedActivity = {
      source: "github",
      kind: "pull_request",
      title: item.title,
      repository: repo.fullName,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      url: item.html_url,
      metadata: {
        number: item.number,
        state: item.state
      }
    };

    if (item.body) {
      activity.body = item.body;
    }

    if (item.user?.login) {
      activity.author = item.user.login;
    }

    return activity;
  });
}

async function fetchIssueComments(
  octokit: Octokit,
  repo: RepoRef,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const { since } = getReportDateRange(config.reportDate, config.reportTimezone);
  const comments = await octokit.paginate(octokit.issues.listCommentsForRepo, {
    owner: repo.owner,
    repo: repo.repo,
    since: since.toISOString(),
    per_page: 100
  });

  return comments
    .filter((comment) => comment.user?.login === config.githubUsername)
    .filter((comment) => isOnReportDate(comment.created_at, config.reportDate, config.reportTimezone))
    .map((comment) => {
      const number = getIssueNumberFromUrl(comment.issue_url);
      const activity: NormalizedActivity = {
        source: "github",
        kind: "comment",
        title: `Comment on ${repo.fullName}#${number}`,
        repository: repo.fullName,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.html_url,
        metadata: {
          number
        }
      };

      if (comment.body) {
        activity.body = comment.body;
      }

      if (comment.user?.login) {
        activity.author = comment.user.login;
      }

      return activity;
    });
}

async function fetchPullRequestReviews(
  octokit: Octokit,
  repo: RepoRef,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const reviewedQuery = `repo:${repo.fullName} is:pr reviewed-by:${config.githubUsername} updated:${config.reportDate}`;
  const reviewedPulls = mergeSearchItems(await searchIssues(octokit, reviewedQuery));
  const reviewLists = await Promise.all(
    reviewedPulls.map(async (item) => ({
      item,
      reviews: await octokit.paginate(octokit.pulls.listReviews, {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: item.number,
        per_page: 100
      })
    }))
  );

  return reviewLists.flatMap(({ item, reviews }) =>
    reviews
      .filter((review) => review.user?.login === config.githubUsername)
      .filter((review) => isOnReportDate(review.submitted_at ?? undefined, config.reportDate, config.reportTimezone))
      .map((review) => {
        const activity: NormalizedActivity = {
          source: "github",
          kind: "review",
          title: `Review: ${item.title}`,
          repository: repo.fullName,
          url: review.html_url,
          metadata: {
            number: item.number,
            state: review.state
          }
        };

        if (review.body) {
          activity.body = review.body;
        }

        if (review.user?.login) {
          activity.author = review.user.login;
        }

        if (review.submitted_at) {
          activity.createdAt = review.submitted_at;
        }

        return activity;
      })
  );
}

async function searchIssues(octokit: Octokit, q: string) {
  return octokit.paginate(octokit.search.issuesAndPullRequests, {
    q,
    per_page: 100
  });
}

async function filterMergedByUser(
  octokit: Octokit,
  repo: RepoRef,
  items: Awaited<ReturnType<typeof searchIssues>>,
  githubUsername: string
) {
  const checks = await Promise.all(
    mergeSearchItems(items).map(async (item) => {
      const pull = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: item.number
      });

      return pull.data.merged_by?.login === githubUsername ? item : undefined;
    })
  );

  return checks.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mergeSearchItems<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const merged: T[] = [];

  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? value;
}

function getIssueNumberFromUrl(value: string): number | string {
  return value.split("/").at(-1) ?? "unknown";
}
