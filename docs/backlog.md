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

## Publishing Reports as Backlog Documents

Gitppou can optionally publish the generated Markdown report to Backlog
documents after the report is generated:

```yaml
backlog:
  spaces:
    your-space:
      host: your-space.backlog.jp
      projectKeys:
        - APP
  document:
    enabled: true
    space: your-space
    projectKey: APP
    # Backlog document parent ID. Omit to create at the project document root.
    parentId: "parent-document-id"
    title: "Daily Report {{date}}"
    addLast: true
```

Use `projectKey` for a readable config, or `projectId` to skip the project
lookup. `parentId` is the parent Backlog document ID used as the destination in
the document tree; you can look up candidate IDs from Backlog's document tree
API. The title supports `{{date}}`.
Gitppou can include the Backlog document URL in Slack notifications when
`projectKey` is configured, because Backlog document URLs include the project
key.

Document publishing can be used without Backlog activity collection:

```yaml
backlog:
  document:
    space: your-space
    host: your-space.backlog.jp
    projectKey: APP
```

When `git.commitReport: true` in GitHub Actions, Gitppou publishes the Backlog
document after the report files have been committed successfully.
When Slack notification is also enabled, the Slack details section includes the
created Backlog document URL.

## What Gitppou Collects

The v1 implementation collects:

- Issues updated on the report date.
- Comments created by the configured Backlog user on relevant issues.
- Recent comments before the configured user's comment, attached to that comment as context for LLM report generation.
- Status changes when they are available in Backlog comment change logs.
- Assigned issues whose due date is the report date.
- Recently updated unresolved issues assigned to the configured Backlog user for the progress chart.
- Issue metadata used for grouping context, such as issue type and category.

Backlog data is normalized into the same activity model used by GitHub data, then grouped by Backlog issue key.
Assigned issue context is used only in the progress section and is not treated as work completed on the report date.
When assigned issue context is available, next actions prefer issues whose gantt schedule includes the day after the report date.

## Project Key Filtering

When project keys are provided, Gitppou resolves those keys through each Backlog space's projects API and restricts issue fetching and issue-key detection to those projects.

## Notes

Backlog OAuth is not implemented in v1. Use a Backlog API key stored in GitHub Actions Secrets.
