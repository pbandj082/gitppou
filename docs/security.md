# Security

Gitppou processes engineering activity data. Treat generated reports as internal records.

## Secrets

Do not hard-code secrets. Store these values in GitHub Actions Secrets and pass them through `env`:

- `GITHUB_TOKEN`
- `BACKLOG_API_KEY`
- `SLACK_WEBHOOK_URL`

Gitppou does not print these secret values to logs.

## Report Storage

Committing reports to public repositories is not recommended. Private repositories are recommended for storing reports.

Reports may contain:

- Internal issue names.
- Customer names.
- Internal URLs.
- Incident details.
- Personal names.
- Private comments.

## GitHub Models

Template mode does not send activity data to an external LLM.

When `llm.provider` is set to `github-models`, normalized GitHub and Backlog activity data is sent to GitHub Models. Limit the amount of data sent with `llm.maxInputChars`.
