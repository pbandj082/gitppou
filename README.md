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
  # Optional: publish the generated Markdown report as a Backlog document.
  # document:
  #   space: your-space
  #   projectKey: APP
  #   parentId: "parent-document-id"
  #   title: "Daily Report {{date}}"

report:
  # Optional. Defaults to github.username.
  # author: Your Name
  language: en
  timezone: Asia/Tokyo
  dir: reports
  formats:
    - markdown
    # - html
    # - pdf
  # htmlDir: .gitppou/site
  # pdfDir: .gitppou/pdf

llm:
  provider: template

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

Markdown reports include a compact metadata line below the top-level heading,
such as `**author**: octocat / **generatedAt**: 2026-07-03 18:00:00
(Asia/Tokyo)`. Set `report.author` to customize the author label value; when
omitted, Gitppou uses `github.username`. Japanese reports use Japanese metadata
labels.

To also save a rendered HTML report:

```yaml
report:
  formats:
    - markdown
    - html
    - pdf
  htmlDir: .gitppou/site
  pdfDir: .gitppou/pdf
```

The generated HTML and PDF report paths are:

```text
.gitppou/site/YYYY-MM/YYYY-MM-DD.html
.gitppou/pdf/YYYY-MM/YYYY-MM-DD.pdf
```

When HTML or PDF output is enabled, `report-path` points to the richest generated format, preferring PDF, then HTML, then Markdown. `report-paths` contains every generated file path.

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

For AWS Bedrock with GitHub OIDC, add `id-token: write`. The assumed IAM role also needs `bedrock:InvokeModel` for the configured model or inference profile:

```yaml
permissions:
  actions: read
  contents: read
  issues: read
  pull-requests: read
  id-token: write
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

| Variable                             | Required                         | Description                                                                                                                          |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Default GitHub token env var         | Yes                              | Environment variable named by `github.tokenEnv`; `GITHUB_TOKEN` by default. Used for activity collection fallback and GitHub Models. |
| Owner-specific GitHub token env vars | Only for mapped owners           | Additional tokens referenced by `github.tokens`.                                                                                     |
| `OPENAI_API_KEY`                     | With `llm.provider: openai`      | OpenAI Platform API key. The variable name can be changed with `llm.apiKeyEnv`.                                                      |
| AWS standard credentials             | With `llm.provider: aws-bedrock` | AWS SDK credential chain, such as a local profile or credentials exported by GitHub OIDC role assumption.                            |
| `AWS_REGION` / `AWS_DEFAULT_REGION`  | Optional for AWS Bedrock         | AWS region when `llm.region` is omitted. Defaults to `ap-northeast-1`.                                                               |
| `BACKLOG_API_KEY`                    | With Backlog                     | Backlog API key.                                                                                                                     |
| `SLACK_WEBHOOK_URL`                  | Only for Slack                   | Slack Incoming Webhook URL.                                                                                                          |
| `GITPPOU_CHROME_PATH`                | Only for custom PDF environments | Chrome or Chromium executable path for PDF output when auto-detection is not enough.                                                 |

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

To also publish the generated Markdown report as a Backlog document:

```yaml
backlog:
  spaces:
    your-space:
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

`backlog.document.projectKey` is resolved to a numeric project ID through Backlog `/projects`. You can use `projectId` instead to skip that lookup. `parentId` is the parent Backlog document ID used as the destination folder in the document tree; you can look up candidate IDs from Backlog's document tree API. Gitppou can include the Backlog document URL in Slack notifications when `projectKey` is configured, because Backlog document URLs include the project key. When `git.commitReport: true` in GitHub Actions, Gitppou creates the Backlog document after the report commit succeeds.

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

If GitHub Models fails, Gitppou fails the run. To generate a report without an external LLM, explicitly set `llm.provider: template`.

## OpenAI Mode

OpenAI mode calls the OpenAI Responses API directly:

```yaml
llm:
  provider: openai
  model: gpt-5-nano
  # apiKeyEnv: OPENAI_API_KEY
```

Pass the Platform API key through the configured environment variable:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

When `model` is omitted, OpenAI mode defaults to `gpt-5-nano`. API responses are requested with storage disabled, and the original GPT-5, GPT-5 mini, and GPT-5 nano families use minimal reasoning for this summarization workload. ChatGPT workspace credits and OpenAI Platform API billing are separate.

## AWS Bedrock Mode

AWS Bedrock mode uses the Bedrock Converse API and the AWS SDK credential chain:

```yaml
llm:
  provider: aws-bedrock
  model: jp.amazon.nova-2-lite-v1:0
  region: ap-northeast-1
  # Local preview only. Omit in GitHub Actions when using OIDC.
  profile: your-profile
```

Local preview can use `llm.profile`, which overrides `AWS_PROFILE` for the Bedrock client:

```sh
pnpm preview -- --date 2026-07-10 --print
```

For GitHub Actions, prefer OIDC and short-lived credentials:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v6

  - uses: aws-actions/configure-aws-credentials@v6
    with:
      role-to-assume: ${{ secrets.AWS_BEDROCK_ROLE_ARN }}
      aws-region: ap-northeast-1

  - uses: your-org/gitppou@v1
    with:
      config: gitppou.yml
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The IAM role needs `bedrock:InvokeModel` access to the configured model or inference profile. When `model` is omitted, AWS Bedrock mode defaults to `jp.amazon.nova-2-lite-v1:0`; `region` defaults to the AWS region environment and then `ap-northeast-1`. Omit `llm.profile` in GitHub Actions so the SDK uses the short-lived credentials exported by the OIDC setup step.

All external LLM providers refine the same fact-based template draft. In each issue summary, Gitppou asks the model to interpret and paraphrase commit messages, PR titles, and comments instead of quoting their original wording. The detailed activity list remains available below the summary. If an external LLM report or Slack-summary call fails, Gitppou fails the run instead of silently using a template or local summary.

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

Slack receives a short prose summary, not the full raw activity. With any external LLM provider (`github-models`, `openai`, or `aws-bedrock`), the Slack summary is generated from the final report; template mode uses a local heading-based summary. When running in GitHub Actions, the summary includes the actor, workflow, repository/ref, and a list of links to every generated report file in the repository. If Backlog document publishing is enabled, Slack also includes the created Backlog document link. Slack failures are warnings in v1 and do not fail the action.

## HTML and PDF Reports

HTML and PDF output are optional. HTML renders the same Markdown report into a standalone HTML file with GitHub-flavored Markdown styling and Mermaid support. PDF output prints that HTML with Chrome or Chromium. Raw HTML in the report body is escaped.

Use `report.formats` to choose saved files:

```yaml
report:
  formats:
    - markdown
    - html
    - pdf
  dir: reports
  htmlDir: .gitppou/site
  pdfDir: .gitppou/pdf
```

This keeps the source Markdown in `reports/`, the distributable HTML in `.gitppou/site/`, and PDFs in `.gitppou/pdf/`. If you later enable GitHub Pages, use a Pages workflow to upload `htmlDir` as the Pages artifact, or choose `docs` as `htmlDir` when using branch-based Pages publishing.

PDF output requires Chrome or Chromium in the runtime environment. GitHub-hosted Ubuntu runners include a compatible browser. Generated HTML loads Noto Sans JP from Google Fonts so Japanese text renders correctly even when the runner does not have Japanese system fonts. For custom runners or local preview, install Chrome or set:

```sh
GITPPOU_CHROME_PATH=/path/to/chrome
```

If the runtime cannot access Google Fonts, install a Japanese font such as Noto Sans CJK JP on the runner.

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

When using `github-models`, `openai`, or `aws-bedrock`, normalized GitHub and Backlog activity data is sent to the selected provider. The default template provider does not send activity data to an external LLM.

## Examples

See:

- [`examples/daily-report.yml`](examples/daily-report.yml)
- [`examples/daily-report-with-commit.yml`](examples/daily-report-with-commit.yml)
- [`examples/daily-report-template-mode.yml`](examples/daily-report-template-mode.yml)
- [`examples/daily-report-openai.yml`](examples/daily-report-openai.yml)
- [`examples/daily-report-aws-bedrock.yml`](examples/daily-report-aws-bedrock.yml)

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

Check `permissions.models: read`, the selected `llm.model`, and whether GitHub Models is enabled for the account or organization. The run fails until the provider is available or `llm.provider` is changed to `template`.

`OpenAI request failed`

Check `OPENAI_API_KEY` (or `llm.apiKeyEnv`), the selected `llm.model`, and the OpenAI Platform project's billing and model access. The run fails until the provider is available or `llm.provider` is changed to `template`.

`AWS Bedrock ...`

Check the AWS identity, `llm.region`, inference profile ID, model access, and the role's `bedrock:InvokeModel` permission. For GitHub Actions OIDC, also check `permissions.id-token: write` and the role trust policy. The run fails until the provider is available or `llm.provider` is changed to `template`.

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
