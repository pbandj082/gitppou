import { Octokit } from "@octokit/rest";
import { getReportDateRange, isOnReportDate } from "./config.js";
import type { GitHubRepoOwnerSpec, GitHubRepoSort, GitHubRepoSpec, GitppouConfig, NormalizedActivity } from "./types.js";

type RepoRef = {
  owner: string;
  repo: string;
  fullName: string;
};

const DEFAULT_REPO_SELECTOR_LIMIT = 20;
const MAX_REPO_SELECTOR_LIMIT = 100;
const DEFAULT_REPO_SELECTOR_SORT: GitHubRepoSort = "pushed";
const REPO_SELECTOR_SORTS = new Set<GitHubRepoSort>(["created", "updated", "pushed", "full_name"]);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export async function fetchGitHubActivities(config: GitppouConfig): Promise<NormalizedActivity[]> {
  if (config.githubRepos.length === 0) {
    return [];
  }

  const octokitsByOwner = new Map<string, Octokit>();
  const repos = await resolveRepoSpecs(config, octokitsByOwner);
  const activities = await Promise.all(
    repos.map((repo) => fetchRepoActivities(octokitForOwner(octokitsByOwner, config, repo.owner), repo, config))
  );

  return activities.flat();
}

export function parseGitHubRepoSpecString(value: string): GitHubRepoSpec {
  const trimmed = value.trim();
  if (!trimmed.includes(":")) {
    return trimmed;
  }

  const [owner, limitOrSort, sort, ...rest] = trimmed.split(":");
  if (!owner) {
    throw new Error(`Invalid github-repos entry "${value}". Use owner/repo or owner[:limit[:sort]].`);
  }
  assertValidGitHubOwner(owner, `github.repos owner selector "${owner}"`);

  if (rest.length > 0) {
    throw new Error(`Invalid github-repos entry "${value}". Use owner/repo or owner[:limit[:sort]].`);
  }

  const spec: GitHubRepoOwnerSpec = {
    owner
  };

  if (limitOrSort) {
    if (!sort && REPO_SELECTOR_SORTS.has(limitOrSort as GitHubRepoSort)) {
      spec.sort = limitOrSort as GitHubRepoSort;
    } else {
      spec.limit = parseRepoSelectorLimit(limitOrSort);
    }
  }

  if (sort) {
    spec.sort = parseRepoSelectorSort(sort);
  }

  return spec;
}

export function resolveGitHubTokenForOwner(config: GitppouConfig, owner: string): string {
  const normalizedOwner = owner.toLowerCase();
  const ownerToken = Object.entries(config.githubTokensByOwner ?? {}).find(
    ([tokenOwner]) => tokenOwner.toLowerCase() === normalizedOwner
  )?.[1];

  return ownerToken?.trim() || config.githubToken;
}

function octokitForOwner(cache: Map<string, Octokit>, config: GitppouConfig, owner: string): Octokit {
  const normalizedOwner = owner.toLowerCase();
  const cached = cache.get(normalizedOwner);
  if (cached) {
    return cached;
  }

  const octokit = new Octokit({
    auth: resolveGitHubTokenForOwner(config, owner),
    userAgent: "gitppou"
  });
  cache.set(normalizedOwner, octokit);

  return octokit;
}

async function resolveRepoSpecs(config: GitppouConfig, octokitsByOwner: Map<string, Octokit>): Promise<RepoRef[]> {
  const refs = (
    await Promise.all(
      config.githubRepos.map((spec) => resolveRepoSpec(config, octokitsByOwner, spec))
    )
  ).flat();
  const seen = new Set<string>();
  const deduped: RepoRef[] = [];

  for (const repo of refs) {
    const key = repo.fullName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(repo);
    }
  }

  return deduped;
}

async function resolveRepoSpec(
  config: GitppouConfig,
  octokitsByOwner: Map<string, Octokit>,
  spec: GitHubRepoSpec
): Promise<RepoRef[]> {
  if (typeof spec === "string") {
    return [parseRepo(spec)];
  }

  if ("repo" in spec) {
    return [parseRepo(spec.repo)];
  }

  return fetchSelectedOwnerRepos(config, octokitsByOwner, spec);
}

async function fetchSelectedOwnerRepos(
  config: GitppouConfig,
  octokitsByOwner: Map<string, Octokit>,
  spec: GitHubRepoOwnerSpec
): Promise<RepoRef[]> {
  const owner = spec.owner.trim();
  if (!owner) {
    throw new Error("github.repos owner selector is required.");
  }
  assertValidGitHubOwner(owner, `github.repos owner selector "${owner}"`);

  const octokit = octokitForOwner(octokitsByOwner, config, owner);
  const limit = validateRepoSelectorLimit(spec.limit ?? DEFAULT_REPO_SELECTOR_LIMIT);
  const sort = spec.sort ?? DEFAULT_REPO_SELECTOR_SORT;
  const repositories = await listOwnerRepos(octokit, owner, sort);

  return repositories
    .filter((repo) => spec.includeForks || !repo.fork)
    .filter((repo) => spec.includeArchived || !repo.archived)
    .filter((repo) => !repo.disabled)
    .slice(0, limit)
    .map((repo) => parseRepo(repo.full_name));
}

async function listOwnerRepos(octokit: Octokit, owner: string, sort: GitHubRepoSort) {
  try {
    return await octokit.paginate(octokit.repos.listForOrg, {
      org: owner,
      type: "all",
      sort,
      direction: "desc",
      per_page: 100
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const authenticatedUser = await getAuthenticatedUserLogin(octokit);
  if (authenticatedUser.toLowerCase() === owner.toLowerCase()) {
    return octokit.paginate(octokit.repos.listForAuthenticatedUser, {
      visibility: "all",
      affiliation: "owner",
      sort,
      direction: "desc",
      per_page: 100
    });
  }

  try {
    return await octokit.paginate(octokit.repos.listForUser, {
      username: owner,
      type: "owner",
      sort,
      direction: "desc",
      per_page: 100
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(
        `GitHub owner selector "${owner}" was not found as an organization or user. Use the owner login from the repository URL, or configure github.tokens.${owner} with a token that can access it.`
      );
    }

    throw error;
  }
}

async function getAuthenticatedUserLogin(octokit: Octokit): Promise<string> {
  const response = await octokit.users.getAuthenticated();
  return response.data.login;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function parseRepo(value: string): RepoRef {
  const [owner, repo] = value.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid github-repos entry "${value}". Use owner/repo.`);
  }
  assertValidGitHubOwner(owner, `github.repos owner "${owner}"`);

  return { owner, repo, fullName: `${owner}/${repo}` };
}

function assertValidGitHubOwner(owner: string, label: string): void {
  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    throw new Error(
      `${label} must be a GitHub user or organization login. GitHub owner names can contain letters, numbers, and hyphens, but not underscores.`
    );
  }
}

function validateRepoSelectorLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("github.repos owner selector limit must be a positive integer.");
  }

  if (value > MAX_REPO_SELECTOR_LIMIT) {
    throw new Error(`github.repos owner selector limit must be less than or equal to ${MAX_REPO_SELECTOR_LIMIT}.`);
  }

  return value;
}

function parseRepoSelectorLimit(value: string): number {
  return validateRepoSelectorLimit(Number(value));
}

function parseRepoSelectorSort(value: string): GitHubRepoSort {
  if (REPO_SELECTOR_SORTS.has(value as GitHubRepoSort)) {
    return value as GitHubRepoSort;
  }

  throw new Error(`Unsupported repository selector sort "${value}". Supported values are created, updated, pushed, and full_name.`);
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

  const reportDateCommits = commits.filter((commit) =>
    isOnReportDate(commit.commit.author?.date, config.reportDate, config.reportTimezone)
  );
  const commitsWithContext = await Promise.all(
    reportDateCommits.map(async (commit) => ({
      commit,
      pullRequestContext: await fetchCommitPullRequestContext(octokit, repo, commit.sha)
    }))
  );

  return commitsWithContext
    .map(({ commit, pullRequestContext }) => {
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
          shortSha: commit.sha.slice(0, 7),
          ...(pullRequestContext?.branch ? { branch: pullRequestContext.branch } : {}),
          ...(pullRequestContext?.pullRequestNumber ? { pullRequestNumber: pullRequestContext.pullRequestNumber } : {}),
          ...(pullRequestContext?.pullRequestTitle ? { pullRequestTitle: pullRequestContext.pullRequestTitle } : {}),
          ...(pullRequestContext?.pullRequestUrl ? { pullRequestUrl: pullRequestContext.pullRequestUrl } : {})
        }
      } satisfies NormalizedActivity;
    });
}

async function fetchCommitPullRequestContext(
  octokit: Octokit,
  repo: RepoRef,
  sha: string
): Promise<
  | {
      branch?: string;
      pullRequestNumber?: number;
      pullRequestTitle?: string;
      pullRequestUrl?: string;
    }
  | undefined
> {
  try {
    const pullRequests = await octokit.paginate(octokit.repos.listPullRequestsAssociatedWithCommit, {
      owner: repo.owner,
      repo: repo.repo,
      commit_sha: sha,
      per_page: 100
    });
    const pullRequest = pullRequests.find((pull) => pull.head?.ref) ?? pullRequests[0];
    if (!pullRequest) {
      return undefined;
    }

    return {
      ...(pullRequest.head?.ref ? { branch: pullRequest.head.ref } : {}),
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.html_url
    };
  } catch {
    return undefined;
  }
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

  const itemsWithStats = await Promise.all(
    items.map(async (item) => ({
      item,
      stats: await fetchPullRequestStats(octokit, repo, item.number)
    }))
  );

  return itemsWithStats.map(({ item, stats }) => {
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
        state: item.state,
        additions: stats.additions,
        deletions: stats.deletions,
        changedFiles: stats.changedFiles,
        branch: stats.branch,
        baseBranch: stats.baseBranch
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

async function fetchPullRequestStats(octokit: Octokit, repo: RepoRef, pullNumber: number) {
  const response = await octokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: pullNumber
  });

  return {
    additions: response.data.additions,
    deletions: response.data.deletions,
    changedFiles: response.data.changed_files,
    branch: response.data.head.ref,
    baseBranch: response.data.base.ref
  };
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
