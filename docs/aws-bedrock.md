# AWS Bedrock

Gitppou uses the [Amazon Bedrock Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) to refine its fact-based template report and, when Slack notifications are enabled, to create the Slack summary.

## Prerequisites

The AWS identity used by Gitppou needs access to the selected model or inference profile in the configured region. Grant `bedrock:InvokeModel` with the resource scope limited to that model or inference profile. Model availability and access are region-specific; confirm access in the [Amazon Bedrock model catalog](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

## Configure Gitppou

Set `llm.provider` to `aws-bedrock`. `model` defaults to `jp.amazon.nova-2-lite-v1:0`; `region` defaults to `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `ap-northeast-1`.

```yaml
llm:
  provider: aws-bedrock
  # model: jp.amazon.nova-2-lite-v1:0
  region: ap-northeast-1
  # Use only for local previews.
  # profile: your-local-profile
```

## Local Preview

Gitppou uses the AWS SDK credential chain. Configure AWS credentials locally with your normal AWS CLI or SSO profile, then select that profile in `llm.profile` when needed.

```yaml
llm:
  provider: aws-bedrock
  region: ap-northeast-1
  profile: your-local-profile
```

```sh
pnpm preview -- --date 2026-07-10 --print
```

Do not put AWS access keys in `gitppou.local.yml` or commit them to the repository.

## GitHub Actions with OIDC

For GitHub Actions, use OIDC to assume an IAM role with short-lived credentials instead of storing AWS access keys in GitHub Secrets.

### Create the IAM Resources

[`cloudformation/github-oidc-bedrock-role.yml`](../cloudformation/github-oidc-bedrock-role.yml) creates an IAM role with a trust policy restricted to one GitHub repository and branch (or GitHub Environment). It also creates the `token.actions.githubusercontent.com` OIDC provider unless it already exists in the AWS account.

In the CloudFormation console, choose **Create stack**, select **With new resources (standard)**, then select **Upload a template file** and upload `cloudformation/github-oidc-bedrock-role.yml`. CloudFormation requires acknowledgement that the stack creates IAM resources.

Before creating the stack:

1. Set `GitHubRepository`, `GitHubBranch`, and `BedrockModelId` to the values used by your workflow and `gitppou.yml`.
2. Set `CreateGitHubOidcProvider` to `false` if the GitHub OIDC provider already exists in this AWS account. The provider is account-wide and can be shared by multiple roles.
3. To restrict access through a GitHub Environment instead of a branch, set `GitHubEnvironment` and add the same environment to the workflow job.

The template grants only `bedrock:InvokeModel` for the selected foundation model ID or inference profile ID. For model and inference-profile ARN formats, see the AWS [Bedrock IAM policy examples](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html).

### Configure the Workflow

```yaml
permissions:
  actions: read
  contents: read
  issues: read
  pull-requests: read
  id-token: write

jobs:
  daily-report:
    runs-on: ubuntu-latest
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
          BACKLOG_API_KEY: ${{ secrets.BACKLOG_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

`id-token: write` only lets the workflow request an OIDC token. AWS permissions are controlled by the IAM role. See GitHub's [OIDC in AWS guide](https://docs.github.com/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) for the required trust-policy claims.

See [`examples/daily-report-aws-bedrock.yml`](../examples/daily-report-aws-bedrock.yml) for a complete workflow.

## Data Handling and Failures

Gitppou sends the fact-based template draft and normalized GitHub and Backlog activity data to Bedrock. The final report Markdown is also sent when generating a Slack summary. `llm.maxInputChars` limits the activity input.

If a Bedrock report or Slack-summary request fails, Gitppou fails the run. Use `llm.provider: template` to generate reports without an external LLM.
