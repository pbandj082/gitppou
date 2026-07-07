# Backlog Integration

Gitppou uses Backlog API key authentication.

```yaml
backlog:
  # Optional numeric Backlog user id. Omit to use the API key owner.
  # userId: "123456"
  spaces:
    space-a:
      host: space-a.backlog.jp
      projectKeys:
        - APP
        - WEB
    space-b:
      projectKeys:
        - OPS
```

Set `BACKLOG_API_KEY` in the workflow environment from a secret.

Omit Backlog or disable it to generate a GitHub-only report:

```yaml
backlog:
  enabled: false
```

`userId` is optional. When omitted, Gitppou calls `/api/v2/users/myself` and uses the numeric `id` returned by Backlog. If you set it explicitly, use that numeric `id`, not the Backlog `userId` handle, Nulab account ID, display name, or space key.

`host` is optional. When omitted, Gitppou uses `{space}.backlog.com`. Set `host` if your Backlog URL uses another host, such as `{space}.backlog.jp`.

For a single Backlog space, still use `backlog.spaces`:

```yaml
backlog:
  # userId: "123456"
  spaces:
    your-space:
      host: your-space.backlog.jp
      projectKeys:
        - APP
        - WEB
```

The default API base URL is:

```text
https://{space}.backlog.com/api/v2
```

## What Gitppou Collects

The v1 implementation collects:

- Issues updated on the report date.
- Comments created by the configured Backlog user on relevant issues.
- Status changes when they are available in Backlog comment change logs.
- Assigned issues whose due date is the report date.

Backlog data is normalized into the same activity model used by GitHub data, then grouped by Backlog issue key.

## Project Key Filtering

When project keys are provided, Gitppou resolves those keys through each Backlog space's projects API and restricts issue fetching and issue-key detection to those projects.

## Notes

Backlog OAuth is not implemented in v1. Use a Backlog API key stored in GitHub Actions Secrets.
