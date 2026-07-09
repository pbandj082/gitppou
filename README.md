# Gitppou

Gitppou generates engineer daily reports from GitHub activity and Backlog progress, then can notify Slack and optionally commit the generated Markdown or HTML report back to the repository.

The name means **Git + nippou**. `nippou` means daily report in Japanese.

Gitppou is a GitHub Action with a local preview CLI. It is not a web service, does not use a database, and does not provide a web UI.

## Quick Start

```yaml
name: Gitppou Daily Report

on:
  schedule:
    - cron: "0 9 * * 1-5" # JST 18:00
  workflow_dispatch:

permissions:
  actions: read
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
          config: gitppou.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BACKLOG_API_KEY: ${{ secrets.BACKLOG_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Create `gitppou.yml` in the repository:

```yaml
github:
  username: your-name
  repos:
    - owner/repo

backlog:
  # Set enabled: false to generate reports from GitHub only.
  # enabled: false
  # Optional numeric Backlog user id. Omit to use the API key owner.
  # userId: "123456"
  spaces:
    your-space:
      # host: your-space.backlog.jp
      projectKeys:
        - APP

report:
  language: en
  timezone: Asia/Tokyo
  dir: reports
  formats:
    - markdown
    # - html
  # htmlDir: .gitppou/site

llm:
  provider: github-models
  model: openai/gpt-4o-mini

slack:
  notify: true

git:
  commitReport: true
```

The generated Markdown report path is:

```text
reports/YYYY-MM/YYYY-MM-DD.md
```

Example:

```text
reports/2026-07/2026-07-03.md
```

To also save a rendered HTML report:

```yaml
report:
  formats:
    - markdown
    - html
  htmlDir: .gitppou/site
```

The HTML report path is:

```text
.gitppou/site/YYYY-MM/YYYY-MM-DD.html
```

When HTML output is enabled, Slack links and the `report-path` action output point to the HTML file. `report-paths` contains every generated file path.

## Required Permissions

For template mode without committing:

```yaml
permissions:
  actions: read
  contents: read
  issues: read
  pull-requests: read
```

For GitHub Models:

```yaml
permissions:
  actions: read
  contents: read
  issues: read
  pull-requests: read
  models: read
```

For committing reports:

```yaml
permissions:
  actions: read
  contents: write
  issues: read
  pull-requests: read
  models: read
```

`actions: read` lets Gitppou resolve the original workflow run creation time. If `report.date` is omitted, rerunning a failed workflow still generates the report for the original run date instead of the rerun date. On reruns, Gitppou refuses to fall back to the current runner time when the original run date cannot be resolved. Set `report.date` explicitly when you want to override this behavior.

If you need to scan private repositories outside the workflow repository, use a fine-grained personal access token with the minimum required permissions:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.REPORT_GITHUB_TOKEN }}
```

If repositories span multiple private users or organizations, provide owner-specific token environment variables:

```yaml
github:
  username: your-name
  tokenEnv: GITHUB_TOKEN
  tokens:
    your-name: GITPPOU_TOKEN_PERSONAL
    org-a: GITPPOU_TOKEN_ORG_A
    org-b: GITPPOU_TOKEN_ORG_B
  repos:
    - your-name/private-repo
    - org-a/app
    - org-b/api
```

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  GITPPOU_TOKEN_PERSONAL: ${{ secrets.GITPPOU_TOKEN_PERSONAL }}
  GITPPOU_TOKEN_ORG_A: ${{ secrets.GITPPOU_TOKEN_ORG_A }}
  GITPPOU_TOKEN_ORG_B: ${{ secrets.GITPPOU_TOKEN_ORG_B }}
```

GitHub does not allow custom repository secret names that start with `GITHUB_`. Use the built-in `GITHUB_TOKEN` only for `github.tokenEnv`, and use another prefix such as `GITPPOU_TOKEN_` for owner-specific tokens.

## Inputs

| Input    | Default       | Description                                                                              |
| -------- | ------------- | ---------------------------------------------------------------------------------------- |
| `config` | `gitppou.yml` | Path to the Gitppou YAML or JSON config file. Run `actions/checkout` before this action. |

## Environment Variables

Secrets must be passed via `env`, not `with`.

| Variable                             | Required               | Description                                                                                                                          |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Default GitHub token env var         | Yes                    | Environment variable named by `github.tokenEnv`; `GITHUB_TOKEN` by default. Used for activity collection fallback and GitHub Models. |
| Owner-specific GitHub token env vars | Only for mapped owners | Additional tokens referenced by `github.tokens`.                                                                                     |
| `BACKLOG_API_KEY`                    | Yes                    | Backlog API key.                                                                                                                     |
| `SLACK_WEBHOOK_URL`                  | Only for Slack         | Slack Incoming Webhook URL.                                                                                                          |

Do not hard-code these values. Store them in GitHub Actions Secrets.

## Template Mode

Template mode is the default:

```yaml
llm:
  provider: template
```

Template mode does not send activity data to an external LLM. It creates a fact-based Markdown report directly from normalized GitHub and Backlog activity.
When Backlog is enabled, the progress section can include a Mermaid gantt chart for recent unresolved issues assigned to the configured Backlog user. Those assigned issue entries are progress context only and are not counted as work completed on the report date.
The next actions section is placed directly after progress and prefers assigned issues whose gantt schedule includes the next day.

## Local Preview

Use the CLI to generate a report locally before running the GitHub Action.

```sh
pnpm preview -- --env-file .env --date 2026-07-06 --print
```

The preview command reads `gitppou.local.yml`, `gitppou.local.yaml`, or `gitppou.local.json` first, then falls back to `gitppou.yml`, `gitppou.yaml`, or `gitppou.json`. `gitppou.local.yml` and `.gitppou/` are ignored for local customization and generated preview reports. It always disables committing reports, and skips Slack notifications unless `--slack` is passed.

Use `.env.example` as a reference for local credentials. Existing shell environment variables take precedence over values from `--env-file`.

Local config can mix explicit repositories and owner selectors:

```yaml
github:
  repos:
    - owner/repo
    - org-a:
        limit: 20
        sort: pushed
```

Owner selectors scan up to `limit` repositories sorted by `pushed` by default. Archived, disabled, and fork repositories are skipped unless explicitly included.

Local config collects from Backlog spaces:

```yaml
backlog:
  # Optional numeric Backlog user id. Omit to use the API key owner.
  # userId: "123456"
  spaces:
    space-a:
      # host: space-a.backlog.jp
      projectKeys:
        - APP
    space-b:
      projectKeys:
        - OPS
```

Omit Backlog or disable it to generate a GitHub-only report:

```yaml
backlog:
  enabled: false
```

## GitHub Models Mode

GitHub Models mode is opt-in:

```yaml
llm:
  provider: github-models
  model: openai/gpt-4o-mini
```

When `llm.provider` is set to `github-models`, Gitppou sends normalized GitHub and Backlog activity data to GitHub Models for report generation. Backlog activities include issue metadata such as issue type and category when available, plus recent Backlog discussion context attached to each user comment. Gitppou first creates a fact-based template report, then asks GitHub Models to refine that report without inventing unsupported work.

GitHub Models can be used with a free, rate-limited quota available to GitHub accounts. For production or higher-volume use, users may need to enable paid GitHub Models usage. GitHub Models billing is separate from GitHub Copilot billing.

If GitHub Models fails, Gitppou logs a warning and falls back to the template report.

## Report Languages

English is the default:

```yaml
report:
  language: en
```

Japanese reports are supported:

```yaml
report:
  language: ja
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
/[A-Z][A-Z0-9_]+-\d+/g;
```

When `backlog.spaces.*.projectKeys` is set, detected issue keys are restricted to those projects.

## Slack Notifications

Gitppou posts a concise summary to Slack via Incoming Webhook when:

```yaml
slack:
  notify: true
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Slack receives a short prose summary, not the full raw activity. With `llm.provider: github-models`, the Slack summary is generated from the final report; otherwise Gitppou falls back to a local heading-based summary. When running in GitHub Actions, the summary includes the actor, workflow, repository/ref, and a link to the generated report file in the repository. If HTML output is enabled, that link points to the HTML report. Slack failures are warnings in v1 and do not fail the action.

## HTML Reports

HTML output is optional. It renders the same Markdown report into a standalone HTML file with GitHub-flavored Markdown styling and Mermaid support. Raw HTML in the report body is escaped.

Use `report.formats` to choose saved files:

```yaml
report:
  formats:
    - markdown
    - html
  dir: reports
  htmlDir: .gitppou/site
```

This keeps the source Markdown in `reports/` and the distributable HTML in `.gitppou/site/`. If you later enable GitHub Pages, use a Pages workflow to upload `htmlDir` as the Pages artifact, or choose `docs` as `htmlDir` when using branch-based Pages publishing.

## Commit Behavior

When `git.commitReport: true`, Gitppou:

1. Configures git user as `gitppou[bot]`.
2. Adds the generated report file or files.
3. Commits with `Add daily report YYYY-MM-DD`.
4. Pushes the branch.

If there are no report changes, the commit is skipped. If commit or push fails while `git.commitReport: true`, the action fails.

Make sure the configured output directories are not ignored by `.gitignore` in the report repository. Gitppou uses normal `git add`, so ignored report files will not be committed.

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

Check `backlog.spaces` and project key settings. The project key must exist in the configured Backlog space.

`config.github.repos[n] must be one of...`

Check owner selector indentation. Options must be nested under the owner key:

```yaml
github:
  repos:
    - owner/repo
    - your-org:
        limit: 20
        sort: pushed
```

`GitHub owner selector "..."`

Use the owner login from the repository URL. GitHub owner names use letters, numbers, and hyphens; underscores are not valid owner names.

`Resource not accessible by integration`

Check workflow `permissions`. For private repositories, the default `GITHUB_TOKEN` may only access the current repository.

`Backlog API request failed for ... /projects ...`

Check the Backlog host. Gitppou defaults to `{space}.backlog.com`; if your space uses another host, set it explicitly:

```yaml
backlog:
  spaces:
    your-space:
      host: your-space.backlog.jp
      projectKeys:
        - APP
```

`error.invalid : assigneeId[0]`

Check `backlog.userId`. It must be the numeric Backlog user id for the space, not the Backlog `userId` handle, Nulab account ID, display name, or space key. Usually, omit `backlog.userId`; Gitppou will call `/api/v2/users/myself` and use the API key owner's numeric id.

`GitHub Models request failed`

Check `permissions.models: read`, the selected `llm.model`, and whether GitHub Models is enabled for the account or organization. Gitppou will still generate the template report.

`Slack webhook request failed`

Check that `SLACK_WEBHOOK_URL` is configured as a secret. Gitppou treats Slack failures as warnings in v1.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

## Releases

This repository uses Changesets for semantic versions. npm publishing is intentionally not configured.

Add a changeset for changes that should produce a new action tag:

```bash
pnpm changeset
```

When changesets are merged to `main`, the Release workflow opens a version PR. Merging that version PR updates package versions and changelogs, then creates a repository tag like `v0.1.0` from the `@gitppou/action` package version. Use that tag in workflows:

```yaml
- uses: your-org/gitppou@v0.1.0
```

The root `action.yml` runs:

```yaml
runs:
  using: node24
  main: packages/action/dist/index.js
```
