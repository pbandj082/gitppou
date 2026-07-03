# Gitppou

Gitppou generates engineer daily reports from GitHub activity and Backlog progress, then can notify Slack and optionally commit the generated Markdown report back to the repository.

The name means **Git + nippou**. `nippou` means daily report in Japanese.

Gitppou is a GitHub Action MVP. It is not a web service, does not use a database, and does not provide a web UI.

## Quick Start

```yaml
name: Gitppou Daily Report

on:
  schedule:
    - cron: "0 9 * * 1-5" # JST 18:00
  workflow_dispatch:

permissions:
  contents: write
  issues: read
  pull-requests: read
  models: read

jobs:
  report:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - uses: your-org/gitppou@v1
        with:
          github-username: your-name
          github-repos: owner/repo
          backlog-space: your-space
          backlog-project-keys: APP
          backlog-user-id: "123456"
          report-language: en
          report-timezone: Asia/Tokyo
          report-dir: reports
          llm-provider: github-models
          llm-model: openai/gpt-4o-mini
          commit-report: true
          slack-notify: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BACKLOG_API_KEY: ${{ secrets.BACKLOG_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

The generated report path is:

```text
reports/YYYY-MM/YYYY-MM-DD.md
```

Example:

```text
reports/2026-07/2026-07-03.md
```

## Required Permissions

For template mode without committing:

```yaml
permissions:
  contents: read
  issues: read
  pull-requests: read
```

For GitHub Models:

```yaml
permissions:
  contents: read
  issues: read
  pull-requests: read
  models: read
```

For committing reports:

```yaml
permissions:
  contents: write
  issues: read
  pull-requests: read
  models: read
```

If you need to scan multiple private repositories, use a fine-grained personal access token with the minimum required permissions:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.REPORT_GITHUB_TOKEN }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-repos` | `""` | Comma-separated repositories to scan, such as `owner/repo-a,owner/repo-b`. |
| `github-username` | Required | GitHub username to collect activity for. |
| `backlog-space` | Required | Backlog space key or domain prefix, such as `example` for `example.backlog.com`. |
| `backlog-project-keys` | `""` | Comma-separated Backlog project keys, such as `APP,WEB`. |
| `backlog-user-id` | `""` | Backlog user ID. |
| `report-date` | Today in `report-timezone` | Report date in `YYYY-MM-DD`. |
| `report-timezone` | `Asia/Tokyo` | Timezone used to resolve the default report date. |
| `report-language` | `en` | Report language. Supported values: `en`, `ja`. |
| `report-dir` | `reports` | Directory to save Markdown reports. |
| `commit-report` | `false` | Commit the generated report to the repository. |
| `slack-notify` | `true` | Send a Slack Incoming Webhook notification. |
| `llm-provider` | `template` | `template` or `github-models`. |
| `llm-model` | `openai/gpt-4o-mini` | Model ID for GitHub Models. |
| `llm-max-input-chars` | `20000` | Maximum normalized activity characters sent to the LLM. |
| `llm-style` | `concise` | `concise` or `detailed`. |

## Environment Variables

Secrets must be passed via `env`, not `with`.

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes | GitHub token used for activity collection and GitHub Models. |
| `BACKLOG_API_KEY` | Yes | Backlog API key. |
| `SLACK_WEBHOOK_URL` | Only for Slack | Slack Incoming Webhook URL. |

Do not hard-code these values. Store them in GitHub Actions Secrets.

## Template Mode

Template mode is the default:

```yaml
with:
  llm-provider: template
```

Template mode does not send activity data to an external LLM. It creates a fact-based Markdown report directly from normalized GitHub and Backlog activity.

## GitHub Models Mode

GitHub Models mode is opt-in:

```yaml
with:
  llm-provider: github-models
  llm-model: openai/gpt-4o-mini
```

When `llm-provider` is set to `github-models`, Gitppou sends normalized GitHub and Backlog activity data to GitHub Models for report generation. Gitppou first creates a fact-based template report, then asks GitHub Models to refine that report without inventing unsupported work.

GitHub Models can be used with a free, rate-limited quota available to GitHub accounts. For production or higher-volume use, users may need to enable paid GitHub Models usage. GitHub Models billing is separate from GitHub Copilot billing.

If GitHub Models fails, Gitppou logs a warning and falls back to the template report.

## Report Languages

English is the default:

```yaml
with:
  report-language: en
```

Japanese reports are supported:

```yaml
with:
  report-language: ja
```

Documentation, examples, code comments, and default generated reports use English as the base language.

## Backlog Issue Key Grouping

Gitppou groups work by Backlog issue key. Include issue keys in branch names, commit messages, PR titles, PR bodies, and Backlog comments.

Examples:

```text
feature/APP-123-login-fix
APP-123 fix login validation
APP-123 Fix login validation
```

Issue keys use this pattern:

```ts
/[A-Z][A-Z0-9_]+-\d+/g
```

When `backlog-project-keys` is set, detected issue keys are restricted to those projects.

## Slack Notifications

Gitppou posts a concise summary to Slack via Incoming Webhook when:

```yaml
with:
  slack-notify: true
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Slack receives a summary, not the full raw activity. Slack failures are warnings in v1 and do not fail the action.

## Commit Behavior

When `commit-report: true`, Gitppou:

1. Configures git user as `gitppou[bot]`.
2. Adds the generated report file.
3. Commits with `Add daily report YYYY-MM-DD`.
4. Pushes the branch.

If there are no report changes, the commit is skipped. If commit or push fails while `commit-report: true`, the action fails.

Committing reports to public repositories is not recommended. Private repositories are recommended for storing daily reports.

## Security Notes

Do not hard-code secrets, and do not print secrets to logs. Use GitHub Actions Secrets for `GITHUB_TOKEN`, `BACKLOG_API_KEY`, and `SLACK_WEBHOOK_URL`.

Reports may contain internal issue names, customer names, internal URLs, incident details, personal names, or private comments. Treat generated reports as internal engineering records.

When using GitHub Models, normalized GitHub and Backlog activity data is sent to GitHub Models. The default template provider does not send activity data to an external LLM.

## Examples

See:

- [`examples/daily-report.yml`](examples/daily-report.yml)
- [`examples/daily-report-with-commit.yml`](examples/daily-report-with-commit.yml)
- [`examples/daily-report-template-mode.yml`](examples/daily-report-template-mode.yml)

## Troubleshooting

`Backlog project key not found`

Check `backlog-space` and `backlog-project-keys`. The project key must exist in the configured Backlog space.

`Resource not accessible by integration`

Check workflow `permissions`. For private repositories, the default `GITHUB_TOKEN` may only access the current repository.

`GitHub Models request failed`

Check `permissions.models: read`, the selected `llm-model`, and whether GitHub Models is enabled for the account or organization. Gitppou will still generate the template report.

`Slack webhook request failed`

Check that `SLACK_WEBHOOK_URL` is configured as a secret. Gitppou treats Slack failures as warnings in v1.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

The root `action.yml` runs:

```yaml
runs:
  using: node24
  main: packages/action/dist/index.js
```
