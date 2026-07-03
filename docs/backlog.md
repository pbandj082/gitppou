# Backlog Integration

Gitppou uses Backlog API key authentication.

```yaml
with:
  backlog-space: your-space
  backlog-project-keys: APP,WEB
  backlog-user-id: "123456"
env:
  BACKLOG_API_KEY: ${{ secrets.BACKLOG_API_KEY }}
```

The API base URL is:

```text
https://{backlog-space}.backlog.com/api/v2
```

## What Gitppou Collects

The v1 implementation collects:

- Issues updated on the report date.
- Issues assigned to `backlog-user-id`.
- Comments for relevant issues.
- Status changes when they are available in Backlog comment change logs.
- Due or overdue assigned issues.

Backlog data is normalized into the same activity model used by GitHub data, then grouped by Backlog issue key.

## Project Key Filtering

When `backlog-project-keys` is provided, Gitppou resolves those keys through the Backlog projects API and restricts issue fetching and issue-key detection to those projects.

## Notes

Backlog OAuth is not implemented in v1. Use a Backlog API key stored in GitHub Actions Secrets.
