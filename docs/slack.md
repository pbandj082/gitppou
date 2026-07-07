# Slack Notifications

Gitppou supports Slack Incoming Webhooks.

```yaml
slack:
  notify: true
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Slack receives a concise summary:

```text
Daily Report - 2026-07-03

Run:
- Actor: octocat
- Workflow: Daily Report #42
- Repository: owner/repo (main)
- Event: workflow_dispatch
- URL: https://github.com/owner/repo/actions/runs/123456789

Work:
- APP-123 Fix login validation

Blockers / Questions:
- None found

Details:
reports/2026-07/2026-07-03.md
```

The Slack notification does not include the full Raw Activity section.

When Gitppou runs in GitHub Actions, the Slack summary includes GitHub Actions context from environment variables such as `GITHUB_ACTOR`, `GITHUB_WORKFLOW`, `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, `GITHUB_RUN_ID`, and `GITHUB_RUN_NUMBER`. The run URL points to the workflow run.

Slack failures are warnings in v1 and do not fail the action. Missing `SLACK_WEBHOOK_URL` is treated as a no-op.
