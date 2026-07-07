# Slack Notifications

Gitppou supports Slack Incoming Webhooks.

```yaml
slack:
  notify: true
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Slack receives a concise prose summary with a link to the generated report:

```text
Daily Report - 2026-07-03
by octocat / Daily Report #42 / owner/repo (main)
Details: <https://github.com/owner/repo/blob/main/.gitppou/reports/2026-07/2026-07-03.md|.gitppou/reports/2026-07/2026-07-03.md>

Work:
Fixed the login validation flow and prepared the next review items. The detailed activity list is available in the linked report.
```

The Slack notification does not include the full Raw Activity section or a task list. When `llm.provider` is `github-models`, Gitppou asks GitHub Models to summarize the final report for Slack. If GitHub Models is unavailable, Gitppou falls back to a short local summary built from the report headings.

When Gitppou runs in GitHub Actions, the Slack summary includes GitHub Actions context from environment variables such as `GITHUB_ACTOR`, `GITHUB_WORKFLOW`, `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, and `GITHUB_RUN_NUMBER`. The details URL points to the generated report file in the repository. If `git.commitReport` is true, the link becomes valid after the action commits the report.

Incoming Webhooks cannot upload the generated Markdown as a Slack file. File upload would require a Slack bot token and Slack Web API permissions, so Gitppou keeps the webhook integration link-based.

Slack failures are warnings in v1 and do not fail the action. Missing `SLACK_WEBHOOK_URL` is treated as a no-op.
