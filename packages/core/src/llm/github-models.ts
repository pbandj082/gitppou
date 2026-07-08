import { buildReportEvidence } from "../report-evidence.js";
import type { ActivityGroup, GitppouConfig, NormalizedActivity } from "../types.js";

type GitHubModelsResponse = {
  choices?: Array<{
    finish_reason?: string | null;
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

type SlackSummaryInput = {
  config: GitppouConfig;
  reportMarkdown: string;
};

const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GITHUB_API_VERSION = "2026-03-10";

export async function refineWithGitHubModels({
  config,
  templateDraft,
  activities,
  groups
}: RefineInput): Promise<string> {
  const reportEvidence = buildReportEvidence(activities);
  const evidenceJson = JSON.stringify(
    {
      userActions: reportEvidence.userActions,
      groupedUserActions: groups.map((group) => ({
        issueKey: group.issueKey,
        title: group.title,
        actions: group.activities,
        commentContext: commentContextForGroup(activities, group.activities)
      })),
      contextOnly: reportEvidence.contextOnly.filter((activity) => activity.kind !== "comment_context")
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

  return chatWithGitHubModels({
    config,
    prompt,
    maxTokens: config.llmStyle === "detailed" ? 6000 : 4000,
    temperature: config.llmStyle === "detailed" ? 0.2 : 0.1
  });
}

export async function summarizeSlackWithGitHubModels({
  config,
  reportMarkdown
}: SlackSummaryInput): Promise<string> {
  const prompt = buildSlackSummaryPrompt({
    date: config.reportDate,
    language: config.reportLanguage,
    reportMarkdown: truncate(reportMarkdown, Math.min(config.llmMaxInputChars, 12000))
  });

  return chatWithGitHubModels({
    config,
    prompt,
    maxTokens: config.reportLanguage === "ja" ? 240 : 180,
    temperature: 0.1
  });
}

async function chatWithGitHubModels(input: {
  config: GitppouConfig;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.config.githubToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    },
    body: JSON.stringify({
      model: input.config.llmModel,
      messages: [
        {
          role: "user",
          content: input.prompt
        }
      ],
      temperature: input.temperature,
      max_tokens: input.maxTokens
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub Models request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as GitHubModelsResponse;
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const content = choice?.message?.content?.trim();

  if (!content) {
    throw new Error("GitHub Models returned an empty response.");
  }

  if (finishReason && finishReason !== "stop") {
    throw new Error(`GitHub Models response was incomplete. finish_reason=${finishReason}.`);
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
- テンプレート日報のBacklog課題見出しにリンクが含まれる場合は、その見出しリンクを維持する
- 各課題見出しの下では、メタ情報の後、アクティビティ箇条書きの前に1文の自然文要約を置く
- 要約文はcommitメッセージ、PRタイトル、Backlogコメント本文、直前コメント文脈から「何について対応したか」を具体化し、activity種別だけの説明で終わらせない
- URLは必ずMarkdownリンク（例: [リンク](https://example.com)）として出力し、生URLのまま書かない
- 「userActions」にある当日ユーザー本人の行動だけを「本日対応したこと」に書く
- 「contextOnly」は直近の流れや課題の背景を説明するためだけに使い、ユーザー本人の作業として書かない
- Backlogの「comment_context」は、ユーザーコメントが何への返信・確認なのかを判断するために使う
- Backlogのcomment活動にmetadata.commentContext.previousCommentsがある場合は、直前コメントだけに限定せず、その中からユーザーコメントと関係が最も強い確認依頼・質問・指摘・レビュー依頼を選ぶ
- 「確認しました」「ありがとうございます」「対応しました」のような短いコメントは、関連コメント候補から確認依頼・レビュー依頼・質問・指摘の対象が分かる場合だけ、その対象を含めて書く
- 確認コメントや返信を書く場合は、分かる範囲で「何を確認したか」「何に返信したか」が伝わる表現にする
- テンプレート日報に関連コメントへの返信対象が具体的に書かれている場合は、汎用表現に戻さず維持する
- 関連コメントの発言者は「発言者: 名前」のようにラベルで示し、本文中の@メンションと混同しない表現にする
- comment_contextから対象が分かる場合は、「この課題について確認コメント」のような汎用表現のままにしない
- ただしcomment_contextに根拠がない対象や意図は推測で書かない
- コメントの根拠や関連文脈を見せる場合は、箇条書き項目の下に空行を入れ、2スペースインデントしたMarkdown引用ブロックを使って読みやすくする
- 種別、カテゴリーなどのmetadataは文脈として使い、ユーザー本人の作業として扱わない
- GitHub PRのmetadata.additions/deletions/changedFilesはPR全体の差分サマリとして扱い、テンプレートに表示されている場合は維持する
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
- If template Backlog issue headings contain links, preserve those heading links.
- Under each issue heading, keep a one-sentence natural-language summary after metadata and before activity bullets.
- Make each summary concrete by using commit messages, PR titles, Backlog comment bodies, and previous-comment context; do not summarize only by activity type.
- Always render URLs as Markdown links such as [link](https://example.com); do not emit raw URLs.
- Write "Work completed today" only from entries in "userActions".
- Use "contextOnly" only to explain recent flow or issue background. Do not present it as work done by the user.
- Use Backlog "comment_context" entries to infer what a user comment confirms or replies to.
- If a Backlog comment action has metadata.commentContext.previousComments, do not assume only the immediately previous comment is related; choose the most relevant request, question, concern, or review from that context.
- For short comments such as "confirmed", "thanks", or "done", include the request, review, question, or concern being answered only when the previous comments support it.
- When describing confirmation comments or replies, include what was confirmed or replied to when the context supports it.
- If the template report already describes a specific reply target from a previous comment, preserve that specificity instead of reverting to generic phrasing.
- Label the related comment speaker as "speaker: name" or equivalent; do not make the speaker look like a body mention.
- If comment_context identifies the target, do not keep generic phrasing such as "commented on this issue".
- Do not infer a target or intent that is not supported by comment_context.
- When showing comment evidence or related context, use a blank line below the bullet and a two-space-indented Markdown blockquote for readability.
- Use metadata such as issue type and categories only as context. Do not present metadata as user work.
- Treat GitHub PR metadata.additions/deletions/changedFiles as whole-PR diff stats, and preserve them when the template displays them.
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

function buildSlackSummaryPrompt(input: {
  date: string;
  language: GitppouConfig["reportLanguage"];
  reportMarkdown: string;
}): string {
  if (input.language === "ja") {
    return `以下の日報本文をSlack通知用に日本語で要約してください。

ルール:
- 1段落だけで書く
- 箇条書きにしない
- 120〜220字程度に収める
- リンクやURLは書かない
- 事実にないことは書かない
- 本日対応したこと、進捗、明日やることの要点を自然な文章でまとめる
- 詳細は別途リンクされる前提で、細かい活動を列挙しない

日付:
${input.date}

日報本文:
${input.reportMarkdown}`;
  }

  return `Summarize the following daily report for a Slack notification.

Rules:
- Write exactly one paragraph.
- Do not use bullets.
- Keep it around 60-100 words.
- Do not include links or URLs.
- Do not add unsupported facts.
- Summarize the key work completed today, progress, and next actions in natural prose.
- Assume the full report is linked separately, so do not enumerate every activity.

Date:
${input.date}

Daily report:
${input.reportMarkdown}`;
}

function commentContextForGroup(
  activities: NormalizedActivity[],
  groupActivities: NormalizedActivity[]
): NormalizedActivity[] {
  const issueKey = groupActivities.find((activity) => activity.issueKey)?.issueKey;
  if (!issueKey) {
    return [];
  }

  const commentIds = new Set(
    groupActivities
      .map((activity) => activity.metadata?.backlogCommentId)
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      .map(String)
  );

  return activities.filter((activity) => {
    if (activity.kind !== "comment_context" || activity.issueKey !== issueKey) {
      return false;
    }

    const contextForCommentId = activity.metadata?.contextForCommentId;
    if (commentIds.size === 0 || (typeof contextForCommentId !== "string" && typeof contextForCommentId !== "number")) {
      return true;
    }

    return commentIds.has(String(contextForCommentId));
  });
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...truncated to ${maxChars} characters`;
}
