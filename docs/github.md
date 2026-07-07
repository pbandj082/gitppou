# GitHub Integration

Gitppou uses `@octokit/rest` and reads repositories listed in `github.repos`.

```yaml
github:
  username: your-name
  repos:
    - owner/repo-a
    - owner/repo-b
```

## What Gitppou Collects

The v1 implementation collects stable activity signals:

- Commits authored by `github.username` on the report date.
- Pull requests created by the user on the report date.
- Pull requests involving the user and updated on the report date.
- Pull requests merged by the user on the report date when available.
- Pull request diff stats, shown as additions, deletions, and changed files for the whole PR.
- Issue or PR comments by the user on the report date.
- PR reviews by the user on the report date.

The MVP does not attempt to reconstruct every possible GitHub event. It favors stable API behavior over exhaustive activity coverage.

## Repository Selection

Gitppou can scan explicit repositories:

```yaml
github:
  repos:
    - owner/repo
```

`repos` can also include owner selectors:

```yaml
github:
  repos:
    - owner/repo
    - org-a:
        limit: 20
        sort: pushed
```

Owner selectors use GitHub repository listing APIs and then scan only the selected repositories. `sort` can be `pushed`, `updated`, `created`, or `full_name`. Forks, archived repositories, and disabled repositories are skipped by default.

## Private Repositories

The default `GITHUB_TOKEN` is usually enough for the current repository. To scan multiple private repositories, use a fine-grained personal access token with the minimum required repository permissions:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.REPORT_GITHUB_TOKEN }}
```

If repositories span multiple private users or organizations, map each owner to a token environment variable:

```yaml
github:
  tokenEnv: GITHUB_TOKEN
  tokens:
    your-name: GITHUB_TOKEN_PERSONAL
    org-a: GITHUB_TOKEN_ORG_A
    org-b: GITHUB_TOKEN_ORG_B
  repos:
    - your-name/private-repo
    - org-a/app
    - org-b/api
```
