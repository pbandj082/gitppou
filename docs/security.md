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

## External LLM Providers

Template mode does not send activity data to an external LLM.

When `llm.provider` is `openai` or `aws-bedrock`, normalized GitHub and Backlog activity data is sent to the selected provider. The final generated report Markdown is also sent to that provider when Gitppou creates a Slack summary. Limit the amount of activity data sent with `llm.maxInputChars`.

See [OpenAI](openai.md) and [AWS Bedrock](aws-bedrock.md) for provider-specific credential and access setup.
