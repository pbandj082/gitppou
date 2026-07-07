import { buildReportEvidence } from "../report-evidence.js";
import type { ActivityGroup, GitppouConfig, NormalizedActivity } from "../types.js";

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
  groups: ActivityGroup[];
};

const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GITHUB_API_VERSION = "2026-03-10";

export async function refineWithGitHubModels({
  config,
  templateDraft,
  activities,
  groups
}: RefineInput): Promise<string> {
  const evidenceJson = JSON.stringify(
    {
      ...buildReportEvidence(activities),
      groupedUserActions: groups.map((group) => ({
        issueKey: group.issueKey,
        title: group.title,
        actions: group.activities
      }))
    },
    null,
    2
  );
  const prompt = buildPrompt({
    date: config.reportDate,
    language: config.reportLanguage,
    templateDraft,
    evidenceJson: truncate(evidenceJson, config.llmMaxInputChars)
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
  evidenceJson: string;
}): string {
  if (input.language === "ja") {
    return `あなたはエンジニアの日報作成アシスタントです。

以下のユーザー行動の根拠、文脈情報、テンプレート日報をもとに、日本語の日報を作成してください。

ルール:
- 事実にないことは書かない
- 完了していない作業を完了扱いしない
- 不明な点は「確認が必要」と書く
- Backlog課題キーを優先して整理する
- GitHubのcommit/PRとBacklog課題が同じ課題キーを含む場合は同じ項目にまとめる
- 「userActions」にある当日ユーザー本人の行動だけを「本日対応したこと」に書く
- 「contextOnly」は直近の流れや課題の背景を説明するためだけに使い、ユーザー本人の作業として書かない
- 種別、カテゴリーなどのmetadataは文脈として使い、ユーザー本人の作業として扱わない
- Backlogの「issue」「assigned_issue」「due_issue」は、それだけではユーザー本人の作業として扱わない
- テンプレート日報の進捗にMermaid ganttが含まれる場合は、事実と矛盾しない範囲で維持する
- 明日やることは、レビュー待ち、処理中、本日が期限の課題から候補として書く
- Markdownで出力する
- 出力には日報本文のみを含める

日付:
${input.date}

テンプレート日報:
${input.templateDraft}

ユーザー行動の根拠と文脈情報:
${input.evidenceJson}`;
  }

  return `You are an assistant that writes concise engineer daily reports.

Create a daily report in English from the following user-action evidence, context, and template report.

Rules:
- Do not write anything that is not supported by the activity data.
- Do not mark incomplete work as completed.
- If something is unclear, write "Needs confirmation".
- Group work by Backlog issue key when possible.
- If GitHub commits/PRs and Backlog issues share the same issue key, merge them into the same section.
- Write "Work completed today" only from entries in "userActions".
- Use "contextOnly" only to explain recent flow or issue background. Do not present it as work done by the user.
- Use metadata such as issue type and categories only as context. Do not present metadata as user work.
- Do not treat Backlog "issue", "assigned_issue", or "due_issue" entries as user work by themselves.
- If the template report includes a Mermaid gantt chart in the progress section, preserve it unless it conflicts with the evidence.
- For next actions, use review-waiting, in-progress, or issues due today as candidates.
- Output Markdown only.
- Output only the report body.

Date:
${input.date}

Template report:
${input.templateDraft}

User-action evidence and context:
${input.evidenceJson}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...truncated to ${maxChars} characters`;
}
