# Slack Notifications

Gitppou supports Slack Incoming Webhooks.

```yaml
with:
  slack-notify: true
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Slack receives a concise summary:

```text
Daily Report - 2026-07-03

Work:
- APP-123 Fix login validation

Blockers / Questions:
- None found

Details:
reports/2026-07/2026-07-03.md
```

The Slack notification does not include the full Raw Activity section.

Slack failures are warnings in v1 and do not fail the action. Missing `SLACK_WEBHOOK_URL` is treated as a no-op.
