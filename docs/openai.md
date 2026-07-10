# OpenAI

Gitppou uses the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) to refine its fact-based template report and, when Slack notifications are enabled, to create the Slack summary. Template mode is the default and does not send data to an external LLM.

## Create an API Key

Create and manage a Platform API key in the [OpenAI API keys dashboard](https://platform.openai.com/api-keys). The API key must belong to an OpenAI Platform project with billing and access to the selected model.

OpenAI Platform API billing is separate from ChatGPT subscriptions and workspace credits. Do not put the key in `gitppou.yml`, a committed `.env` file, or workflow source.

## Configure Gitppou

Set `llm.provider` to `openai`. `model` is optional and defaults to `gpt-5-nano`.

```yaml
llm:
  provider: openai
  # model: gpt-5-nano
  # apiKeyEnv: OPENAI_API_KEY
```

Gitppou reads the key from `OPENAI_API_KEY` by default. Use `llm.apiKeyEnv` when your environment variable has a different name.

## Local Preview

Store the API key in an uncommitted `.env` file, then pass it to the preview command:

```dotenv
OPENAI_API_KEY=your-api-key
```

```sh
pnpm preview -- --env-file .env --date 2026-07-10 --print
```

Existing shell environment variables take precedence over values in `--env-file`.

## GitHub Actions

Create a repository or organization Actions secret named `OPENAI_API_KEY`, then pass it through `env`. OpenAI mode needs no extra GitHub Actions permission beyond the permissions Gitppou normally needs to read activity data.

```yaml
- uses: your-org/gitppou@v1
  with:
    config: gitppou.yml
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    BACKLOG_API_KEY: ${{ secrets.BACKLOG_API_KEY }}
```

See [`examples/daily-report-openai.yml`](../examples/daily-report-openai.yml) for a complete workflow.

## Data Handling and Failures

Gitppou sends the fact-based template draft and normalized GitHub and Backlog activity data to OpenAI. The final report Markdown is also sent when generating a Slack summary. `llm.maxInputChars` limits the activity input, and Gitppou requests Responses API storage to be disabled.

If an OpenAI report or Slack-summary request fails, Gitppou fails the run. Use `llm.provider: template` to generate reports without an external LLM.
