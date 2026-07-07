# GitHub Models

GitHub Models mode is optional. Template mode is the default.

```yaml
permissions:
  models: read
```

```yaml
llm:
  provider: github-models
  model: openai/gpt-4o-mini
```

Gitppou uses the GitHub Models chat completions API with the workflow `GITHUB_TOKEN`.

## Data Sent to GitHub Models

When `llm.provider` is `github-models`, Gitppou sends:

- The fact-based template report.
- Normalized GitHub and Backlog activity data.
- Backlog issue metadata included in those activities, such as issue type and category.
- Assigned Backlog issue context used by the progress gantt chart.

The data is capped by `llm.maxInputChars`.

## Safety Rules

Gitppou never asks the LLM to invent a report from scratch. The pipeline is:

```text
GitHub / Backlog raw data
  -> normalize
  -> generate fact-based template report
  -> optionally improve with GitHub Models
  -> final Markdown report
```

The prompt instructs the model not to add unsupported work, not to mark incomplete work as complete, and not to remove important Backlog issue keys.

If GitHub Models fails, Gitppou falls back to the template report and continues.

## Billing

GitHub Models can be used with a free, rate-limited quota available to GitHub accounts. For production or higher-volume use, users may need to enable paid GitHub Models usage. GitHub Models billing is separate from GitHub Copilot billing.
