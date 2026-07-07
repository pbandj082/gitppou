import type { GitppouConfig, NormalizedActivity } from "../types.js";

type GitHubModelsResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type RefineInput = {
  config: GitppouConfig;
  templateDraft: string;
  activities: NormalizedActivity[];
};

const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GITHUB_API_VERSION = "2026-03-10";

export async function refineWithGitHubModels({
  config,
  templateDraft,
  activities
}: RefineInput): Promise<string> {
  const activitiesJson = JSON.stringify(activities, null, 2);
  const prompt = buildPrompt({
    date: config.reportDate,
    language: config.reportLanguage,
    templateDraft,
    activitiesJson: truncate(activitiesJson, config.llmMaxInputChars)
  });

  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.githubToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: config.llmStyle === "detailed" ? 0.2 : 0.1,
      max_tokens: config.llmStyle === "detailed" ? 1800 : 1200
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub Models request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as GitHubModelsResponse;
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("GitHub Models returned an empty response.");
  }

  return content;
}

function buildPrompt(input: {
  date: string;
  language: GitppouConfig["reportLanguage"];
  templateDraft: string;
  activitiesJson: string;
}): string {
  if (input.language === "ja") {
    return `あなたはエンジニアの日報作成アシスタントです。

以下の活動ログとテンプレート日報をもとに、日本語の日報を作成してください。

ルール:
- 事実にないことは書かない
- 完了していない作業を完了扱いしない
- 不明な点は「確認が必要」と書く
- Backlog課題キーを優先して整理する
- GitHubのcommit/PRとBacklog課題が同じ課題キーを含む場合は同じ項目にまとめる
- 課題・相談事項は、コメントやステータスから読み取れる範囲でのみ書く
- 明日やることは、レビュー待ち、処理中、本日が期限の課題から候補として書く
- Markdownで出力する
- 出力には日報本文のみを含める

日付:
${input.date}

テンプレート日報:
${input.templateDraft}

正規化済み活動ログ:
${input.activitiesJson}`;
  }

  return `You are an assistant that writes concise engineer daily reports.

Create a daily report in English from the following activity logs and template report.

Rules:
- Do not write anything that is not supported by the activity data.
- Do not mark incomplete work as completed.
- If something is unclear, write "Needs confirmation".
- Group work by Backlog issue key when possible.
- If GitHub commits/PRs and Backlog issues share the same issue key, merge them into the same section.
- Write blockers/questions only when they are supported by comments, statuses, or issue data.
- For next actions, use review-waiting, in-progress, or issues due today as candidates.
- Output Markdown only.
- Output only the report body.

Date:
${input.date}

Template report:
${input.templateDraft}

Normalized activity logs:
${input.activitiesJson}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...truncated to ${maxChars} characters`;
}
