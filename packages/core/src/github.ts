import { Octokit } from "@octokit/rest";
import { getReportDateRange, isOnReportDate } from "./config.js";
import type { GitHubRepoOwnerSpec, GitHubRepoSort, GitHubRepoSpec, GitppouConfig, NormalizedActivity } from "./types.js";

type RepoRef = {
  owner: string;
  repo: string;
  fullName: string;
};

type RepoSearchGroup = {
  qualifier: string;
  octokit: Octokit;
  repoNames: Set<string>;
};

type SearchItem = Awaited<ReturnType<typeof searchIssues>>[number];

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
  const searchGroups = await buildRepoSearchGroups(config, octokitsByOwner, repos);
  const [repoActivities, pullRequests, reviews] = await Promise.all([
    Promise.all(
      repos.map((repo) =>
        fetchRepoActivities(octokitForOwner(octokitsByOwner, config, repo.owner), repo, config)
      )
    ),
    fetchPullRequestsForSearchGroups(searchGroups, config),
    fetchPullRequestReviewsForSearchGroups(searchGroups, config)
  ]);

  return [...repoActivities.flat(), ...pullRequests, ...reviews];
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
  const [commits, comments] = await Promise.all([
    fetchCommits(octokit, repo, config),
    fetchIssueComments(octokit, repo, config)
  ]);

  return [...commits, ...comments];
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

async function buildRepoSearchGroups(
  config: GitppouConfig,
  octokitsByOwner: Map<string, Octokit>,
  repos: RepoRef[]
): Promise<RepoSearchGroup[]> {
  const reposByOwner = new Map<string, RepoRef[]>();

  for (const repo of repos) {
    const normalizedOwner = repo.owner.toLowerCase();
    const existing = reposByOwner.get(normalizedOwner);
    if (existing) {
      existing.push(repo);
    } else {
      reposByOwner.set(normalizedOwner, [repo]);
    }
  }

  return Promise.all(
    [...reposByOwner.entries()].map(async ([normalizedOwner, ownerRepos]) => {
      const owner = ownerRepos[0]?.owner ?? normalizedOwner;
      const octokit = octokitForOwner(octokitsByOwner, config, owner);
      const qualifier =
        owner.toLowerCase() === config.githubUsername.toLowerCase()
          ? `user:${owner}`
          : await resolveOwnerSearchQualifier(octokit, owner);

      return {
        qualifier,
        octokit,
        repoNames: new Set(ownerRepos.map((repo) => repo.fullName.toLowerCase()))
      };
    })
  );
}

async function resolveOwnerSearchQualifier(octokit: Octokit, owner: string): Promise<string> {
  try {
    await octokit.orgs.get({ org: owner });
    return `org:${owner}`;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  return `user:${owner}`;
}

async function fetchPullRequestsForSearchGroups(
  groups: RepoSearchGroup[],
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const groupActivities = await Promise.all(
    groups.map(async (group) => {
      const createdQuery = `${group.qualifier} is:pr author:${config.githubUsername} created:${config.reportDate}`;
      const updatedQuery = `${group.qualifier} is:pr involves:${config.githubUsername} updated:${config.reportDate}`;
      const mergedQuery = `${group.qualifier} is:pr is:merged merged:${config.reportDate}`;
      const [created, updated, merged] = await Promise.all([
        searchIssues(group.octokit, createdQuery),
        searchIssues(group.octokit, updatedQuery),
        searchIssues(group.octokit, mergedQuery)
      ]);
      const mergedByUser = await filterMergedByUser(group.octokit, merged, config.githubUsername, group.repoNames);
      const items = mergeSearchItems([
        ...filterSearchItemsForRepos(created, group.repoNames),
        ...filterSearchItemsForRepos(updated, group.repoNames),
        ...mergedByUser
      ]);

      const itemsWithStats = await Promise.all(
        items.map(async (item) => {
          const repo = searchItemRepo(item);
          if (!repo || !group.repoNames.has(repo.fullName.toLowerCase())) {
            return undefined;
          }

          const stats = await fetchPullRequestStats(group.octokit, repo, item.number);

          return {
            item,
            repo,
            stats,
            commits: await fetchPullRequestCommitActivities(group.octokit, repo, item, stats.branch, config)
          };
        })
      );

      return itemsWithStats
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .flatMap(({ item, repo, stats, commits }) => {
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

          return [activity, ...commits];
        });
    })
  );

  return groupActivities.flat();
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

async function fetchPullRequestCommitActivities(
  octokit: Octokit,
  repo: RepoRef,
  item: SearchItem,
  branch: string,
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const commits = await octokit.paginate(octokit.pulls.listCommits, {
    owner: repo.owner,
    repo: repo.repo,
    pull_number: item.number,
    per_page: 100
  });

  return commits
    .filter((commit) => commit.author?.login === config.githubUsername)
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
          shortSha: commit.sha.slice(0, 7),
          branch,
          pullRequestNumber: item.number,
          pullRequestTitle: item.title,
          pullRequestUrl: item.html_url
        }
      } satisfies NormalizedActivity;
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

async function fetchPullRequestReviewsForSearchGroups(
  groups: RepoSearchGroup[],
  config: GitppouConfig
): Promise<NormalizedActivity[]> {
  const groupActivities = await Promise.all(
    groups.map(async (group) => {
      const reviewedQuery = `${group.qualifier} is:pr reviewed-by:${config.githubUsername} updated:${config.reportDate}`;
      const reviewedPulls = mergeSearchItems(
        filterSearchItemsForRepos(await searchIssues(group.octokit, reviewedQuery), group.repoNames)
      );
      const reviewLists = await Promise.all(
        reviewedPulls.map(async (item) => {
          const repo = searchItemRepo(item);
          if (!repo || !group.repoNames.has(repo.fullName.toLowerCase())) {
            return undefined;
          }

          return {
            item,
            repo,
            reviews: await group.octokit.paginate(group.octokit.pulls.listReviews, {
              owner: repo.owner,
              repo: repo.repo,
              pull_number: item.number,
              per_page: 100
            })
          };
        })
      );

      return reviewLists
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .flatMap(({ item, repo, reviews }) =>
          reviews
            .filter((review) => review.user?.login === config.githubUsername)
            .filter((review) =>
              isOnReportDate(review.submitted_at ?? undefined, config.reportDate, config.reportTimezone)
            )
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
    })
  );

  return groupActivities.flat();
}

function filterSearchItemsForRepos(items: SearchItem[], repoNames: Set<string>): SearchItem[] {
  return items.filter((item) => {
    const repo = searchItemRepo(item);
    return Boolean(repo && repoNames.has(repo.fullName.toLowerCase()));
  });
}

function searchItemRepo(item: SearchItem): RepoRef | undefined {
  const fromRepositoryUrl = repoFullNameFromApiUrl(item.repository_url);
  if (fromRepositoryUrl) {
    return parseRepo(fromRepositoryUrl);
  }

  const fromHtmlUrl = repoFullNameFromHtmlUrl(item.html_url);
  return fromHtmlUrl ? parseRepo(fromHtmlUrl) : undefined;
}

function repoFullNameFromApiUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const repoIndex = parts.indexOf("repos");
    const owner = repoIndex >= 0 ? parts[repoIndex + 1] : undefined;
    const repo = repoIndex >= 0 ? parts[repoIndex + 2] : undefined;
    return owner && repo ? `${owner}/${repo}` : undefined;
  } catch {
    return undefined;
  }
}

function repoFullNameFromHtmlUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo] = parts;
    return owner && repo ? `${owner}/${repo}` : undefined;
  } catch {
    return undefined;
  }
}

async function searchIssues(octokit: Octokit, q: string) {
  return octokit.paginate(octokit.search.issuesAndPullRequests, {
    q,
    per_page: 100
  });
}

async function filterMergedByUser(
  octokit: Octokit,
  items: SearchItem[],
  githubUsername: string,
  repoNames: Set<string>
) {
  const checks = await Promise.all(
    mergeSearchItems(filterSearchItemsForRepos(items, repoNames)).map(async (item) => {
      const repo = searchItemRepo(item);
      if (!repo || !repoNames.has(repo.fullName.toLowerCase())) {
        return undefined;
      }

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
