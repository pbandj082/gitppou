# GitHub Integration

Gitppou uses `@octokit/rest` and reads repositories listed in `github-repos`.

```yaml
with:
  github-username: your-name
  github-repos: owner/repo-a,owner/repo-b
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## What Gitppou Collects

The v1 implementation collects stable activity signals:

- Commits authored by `github-username` on the report date.
- Pull requests created by the user on the report date.
- Pull requests involving the user and updated on the report date.
- Pull requests merged by the user on the report date when available.
- Issue or PR comments by the user on the report date.
- PR reviews by the user on the report date.

The MVP does not attempt to reconstruct every possible GitHub event. It favors stable API behavior over exhaustive activity coverage.

## Private Repositories

The default `GITHUB_TOKEN` is usually enough for the current repository. To scan multiple private repositories, use a fine-grained personal access token with the minimum required repository permissions:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.REPORT_GITHUB_TOKEN }}
```
