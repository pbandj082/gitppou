import { filterGroupsByUserActions } from "../report-evidence.js";
import { formatMarkdownInlineText, markdownLinkUrl } from "../markdown.js";
import type { ActivityGroup, GitppouConfig, NormalizedActivity } from "../types.js";

type TemplateReportInput = {
  config: GitppouConfig;
  activities: NormalizedActivity[];
  groups: ActivityGroup[];
};

type Labels = {
  title: string;
  work: string;
  progress: string;
  nextActions: string;
  rawActivity: string;
  github: string;
  backlog: string;
  noActivity: string;
  noNextActions: string;
};

type ActivityDescriptionContext = {
  groupIssueKey?: string;
  groupTitle?: string;
};

const LABELS: Record<GitppouConfig["reportLanguage"], Labels> = {
  en: {
    title: "Daily Report",
    work: "Work completed today",
    progress: "Progress",
    nextActions: "Next actions",
    rawActivity: "Raw Activity",
    github: "GitHub",
    backlog: "Backlog",
    noActivity: "No user action was found for this date.",
    noNextActions: "Needs confirmation."
  },
  ja: {
    title: "日報",
    work: "本日対応したこと",
    progress: "進捗",
    nextActions: "明日やること",
    rawActivity: "Raw Activity",
    github: "GitHub",
    backlog: "Backlog",
    noActivity: "この日のユーザー行動は見つかりませんでした。",
    noNextActions: "確認が必要"
  }
};

export function applyTemplateProvider(templateDraft: string): string {
  return templateDraft;
}

export function generateTemplateReport({ config, activities, groups }: TemplateReportInput): string {
  const labels = LABELS[config.reportLanguage];
  const reportGroups = filterGroupsByUserActions(groups);
  const lines: string[] = [`# ${labels.title} - ${config.reportDate}`, ""];

  lines.push(`## ${labels.work}`, "");
  if (reportGroups.length === 0) {
    lines.push(`- ${labels.noActivity}`, "");
  } else {
    for (const group of reportGroups) {
      const descriptionContext = descriptionContextForGroup(group);
      lines.push(`### ${formatLinkedGroupHeading(group, activities)}`, "");
      const metadataLine = issueMetadataLine(group, config.reportLanguage);
      if (metadataLine) {
        lines.push(metadataLine, "");
      }
      const summary = issueSummaryParagraph(group, config.reportLanguage);
      if (summary) {
        lines.push(summary, "");
      }
      for (const activity of group.activities) {
        lines.push(...describeActivityLines(activity, config.reportLanguage, descriptionContext));
      }
      lines.push("");
    }
  }

  lines.push(`## ${labels.progress}`, "");
  for (const line of progressLines(activities, reportGroups, config)) {
    lines.push(line);
  }
  lines.push("");

  lines.push(`## ${labels.nextActions}`, "");
  const nextActions = nextActionLines(activities, reportGroups, config);
  if (nextActions.length === 0) {
    lines.push(`- ${labels.noNextActions}`);
  } else {
    for (const nextAction of nextActions) {
      lines.push(`- ${nextAction}`);
    }
  }
  lines.push("");

  lines.push(`## ${labels.rawActivity}`, "");
  lines.push(`### ${labels.github}`, "");
  for (const line of rawActivityLines(activities.filter((activity) => activity.source === "github"))) {
    lines.push(`- ${line}`);
  }
  if (!activities.some((activity) => activity.source === "github")) {
    lines.push("- None");
  }
  lines.push("");

  lines.push(`### ${labels.backlog}`, "");
  for (const line of rawActivityLines(activities.filter((activity) => activity.source === "backlog"))) {
    lines.push(`- ${line}`);
  }
  if (!activities.some((activity) => activity.source === "backlog")) {
    lines.push("- None");
  }

  return lines.join("\n").trimEnd();
}

function formatGroupHeading(group: ActivityGroup): string {
  if (group.issueKey === "Unlinked") {
    return "Unlinked";
  }

  return group.title ? `${group.issueKey} ${group.title}` : group.issueKey;
}

function formatLinkedGroupHeading(group: ActivityGroup, activities: NormalizedActivity[]): string {
  const heading = formatGroupHeading(group);
  const url = backlogIssueUrlForGroup(group, activities);

  return url ? `[${markdownLinkText(heading)}](${markdownLinkUrl(url)})` : heading;
}

function backlogIssueUrlForGroup(group: ActivityGroup, activities: NormalizedActivity[]): string | undefined {
  if (group.issueKey === "Unlinked") {
    return undefined;
  }

  for (const activity of [...group.activities, ...activities]) {
    if (activity.source !== "backlog" || activity.issueKey !== group.issueKey || !activity.url) {
      continue;
    }

    const issueUrl = backlogIssueUrl(activity.url, group.issueKey);
    if (issueUrl) {
      return issueUrl;
    }
  }

  return undefined;
}

function backlogIssueUrl(url: string, issueKey: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("backlog.") || !parsed.pathname.includes(`/view/${issueKey}`)) {
      return undefined;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.includes(`/view/${issueKey}`) ? url.split("#")[0]?.split("?")[0] : undefined;
  }
}

function markdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function descriptionContextForGroup(group: ActivityGroup): ActivityDescriptionContext {
  return {
    ...(group.issueKey === "Unlinked" ? {} : { groupIssueKey: group.issueKey }),
    ...(group.title ? { groupTitle: group.title } : {})
  };
}

function describeActivity(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"],
  context: ActivityDescriptionContext = {}
): string {
  const prefix = issuePrefix(activity, context);
  const title = stripMarkdownBreaks(activity.title);

  if (language === "ja") {
    switch (activity.kind) {
      case "commit":
        return `${prefix}commitを作成: ${title}`;
      case "pull_request":
        return `${prefix}PRを更新: ${title}${pullRequestStatsSuffix(activity, "ja")}`;
      case "review":
        return `${prefix}PRレビューを実施: ${title}`;
      case "comment":
        return `${prefix}${commentText(activity, title, context, "ja")}`;
      case "comment_context":
        return `${prefix}コメント前後の文脈: ${title}`;
      case "issue":
        return `${prefix}Backlog課題が更新: ${title}${statusSuffix(activity, "現在のステータス")}`;
      case "status_change":
        return `${prefix}${statusChangeText(activity, "ja")}`;
      case "assigned_issue":
        return `${prefix}担当中のBacklog課題: ${title}`;
      case "due_issue":
        return `${prefix}本日が期限の課題: ${title}`;
    }
  }

  switch (activity.kind) {
    case "commit":
      return `${prefix}Committed: ${title}`;
    case "pull_request":
      return `${prefix}Updated pull request: ${title}${pullRequestStatsSuffix(activity, "en")}`;
    case "review":
      return `${prefix}Reviewed pull request: ${title}`;
    case "comment":
      return `${prefix}${commentText(activity, title, context, "en")}`;
    case "comment_context":
      return `${prefix}Comment context: ${title}`;
    case "issue":
      return `${prefix}Backlog issue updated: ${title}${statusSuffix(activity, "current status")}`;
    case "status_change":
      return `${prefix}${statusChangeText(activity, "en")}`;
    case "assigned_issue":
      return `${prefix}Assigned Backlog issue: ${title}`;
    case "due_issue":
      return `${prefix}Assigned issue due today: ${title}`;
  }
}

function issuePrefix(activity: NormalizedActivity, context: ActivityDescriptionContext): string {
  if (!activity.issueKey) {
    return "";
  }

  if (activity.issueKey === context.groupIssueKey) {
    return "";
  }

  return `${activity.issueKey}: `;
}

function describeActivityLines(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"],
  context: ActivityDescriptionContext = {}
): string[] {
  const description = describeActivity(activity, language, context);
  const details = activityDetailLines(activity, language);

  if (details.length === 0) {
    return [`- ${description}`];
  }

  return [`- ${description}`, "", ...details, ""];
}

function activityDetailLines(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"]
): string[] {
  if (activity.kind !== "comment") {
    return [];
  }

  const blocks: Array<{ label: string; body: string }> = [];
  const relatedComments = relatedCommentCandidates(activity).slice(-2);
  for (const comment of relatedComments) {
    blocks.push({
      label: relatedCommentBlockLabel(comment, language),
      body: shortContext(comment.body)
    });
  }

  const body = compactBody(activity.body);
  if (body) {
    blocks.push({
      label: language === "ja" ? "投稿コメント" : "Posted comment",
      body
    });
  }

  return blocks.flatMap((block, index) => [
    ...(index > 0 ? [""] : []),
    `  > **${block.label}**`,
    `  > ${formatMarkdownInlineText(block.body)}`
  ]);
}

function relatedCommentBlockLabel(
  comment: PreviousCommentContext,
  language: GitppouConfig["reportLanguage"]
): string {
  const author = speakerName(comment.author) ?? (language === "ja" ? "不明" : "unknown");
  const createdAt = comment.createdAt ? ` / ${comment.createdAt}` : "";
  return language === "ja" ? `関連コメント（発言者: ${author}${createdAt}）` : `Related comment (speaker: ${author}${createdAt})`;
}

function commentText(
  activity: NormalizedActivity,
  title: string,
  context: ActivityDescriptionContext,
  language: GitppouConfig["reportLanguage"]
): string {
  const rawBody = compactBody(activity.body);
  const fallbackText = formatMarkdownInlineText(title);
  const target = commentTarget(activity, title, context, language);
  const isConfirmation = rawBody ? isConfirmationComment(rawBody) : false;
  const replyTarget = commentReplyTarget(activity, language, isConfirmation);
  const inlineBody = rawBody ? "" : `: ${fallbackText}`;

  if (language === "ja") {
    if (isConfirmation) {
      return `${replyTarget ?? target}確認コメントを追加${inlineBody}`;
    }

    if (replyTarget) {
      return `${replyTarget}コメントを追加${inlineBody}`;
    }

    return `${target}コメントを追加${inlineBody}`;
  }

  if (isConfirmation) {
    return `Added a confirmation comment ${replyTarget ?? target}${inlineBody}`;
  }

  if (replyTarget) {
    return `Commented ${replyTarget}${inlineBody}`;
  }

  return `Commented ${target}${inlineBody}`;
}

function commentTarget(
  activity: NormalizedActivity,
  title: string,
  context: ActivityDescriptionContext,
  language: GitppouConfig["reportLanguage"]
): string {
  if (activity.issueKey && activity.issueKey === context.groupIssueKey) {
    return language === "ja" ? "この課題について" : "on this issue";
  }

  const targetTitle = stripLeadingIssueKey(title, activity.issueKey);
  if (targetTitle) {
    return language === "ja" ? `「${targetTitle}」について` : `on "${targetTitle}"`;
  }

  return language === "ja" ? "" : "on the activity";
}

function commentReplyTarget(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"],
  isConfirmation: boolean
): string | undefined {
  const previousComment = relatedPreviousComment(activity, isConfirmation);
  if (!previousComment) {
    return undefined;
  }

  if (language === "ja") {
    if (isConfirmation) {
      const requestTarget = confirmationRequestTarget(previousComment.body);
      if (requestTarget) {
        return `${previousCommentSpeakerPrefix(previousComment, language)}の確認依頼「${requestTarget}」に対して`;
      }

      return `${previousCommentSpeakerPrefix(previousComment, language)}への`;
    }

    return `${previousCommentSpeakerPrefix(previousComment, language)}への返信として`;
  }

  if (isConfirmation) {
    const requestTarget = confirmationRequestTarget(previousComment.body);
    if (requestTarget) {
      return `for the confirmation request from ${speakerName(previousComment.author) ?? "unknown"} about "${requestTarget}"`;
    }

    return `in response to ${previousCommentSpeakerPrefix(previousComment, language)}`;
  }

  return `in reply to ${previousCommentSpeakerPrefix(previousComment, language)}`;
}

type PreviousCommentContext = {
  id?: string | number;
  author?: string;
  createdAt?: string;
  body: string;
};

function relatedPreviousComment(
  activity: NormalizedActivity,
  isConfirmation: boolean
): PreviousCommentContext | undefined {
  const previousComments = relatedCommentCandidates(activity);
  if (previousComments.length === 0) {
    return undefined;
  }

  if (isConfirmation) {
    const confirmationRequestComment = [...previousComments]
      .reverse()
      .find((comment) => confirmationRequestTarget(comment.body));
    if (confirmationRequestComment) {
      return confirmationRequestComment;
    }
  }

  return previousComments[previousComments.length - 1];
}

function relatedCommentCandidates(activity: NormalizedActivity): PreviousCommentContext[] {
  const previousComments = previousCommentContexts(activity).filter((comment) => !isLowSignalContextComment(comment.body));
  const currentAuthor = typeof activity.metadata?.author === "string" ? speakerName(activity.metadata.author) : undefined;
  if (!currentAuthor) {
    return previousComments;
  }

  const currentAuthorKey = normalizeSpeakerName(currentAuthor);
  const nonSelfComments = previousComments.filter(
    (comment) => normalizeSpeakerName(speakerName(comment.author)) !== currentAuthorKey
  );
  return nonSelfComments;
}

function previousCommentContexts(activity: NormalizedActivity): PreviousCommentContext[] {
  const commentContext = activity.metadata?.commentContext;
  if (!isRecord(commentContext)) {
    return [];
  }

  const previousComments = commentContext.previousComments;
  if (!Array.isArray(previousComments)) {
    return [];
  }

  return previousComments
    .map((previousComment) => {
      if (!isRecord(previousComment) || typeof previousComment.body !== "string") {
        return undefined;
      }

      const body = stripMarkdownBreaks(previousComment.body);
      if (!body) {
        return undefined;
      }

      return {
        ...(typeof previousComment.id === "string" || typeof previousComment.id === "number"
          ? { id: previousComment.id }
          : {}),
        ...(typeof previousComment.author === "string" && previousComment.author.trim()
          ? { author: previousComment.author.trim() }
          : {}),
        ...(typeof previousComment.createdAt === "string" && previousComment.createdAt.trim()
          ? { createdAt: previousComment.createdAt.trim() }
          : {}),
        body
      };
    })
    .filter((comment): comment is PreviousCommentContext => Boolean(comment));
}

function previousCommentSpeakerPrefix(
  comment: PreviousCommentContext,
  language: GitppouConfig["reportLanguage"]
): string {
  const author = speakerName(comment.author);
  if (language === "ja") {
    return `関連コメント（発言者: ${author ?? "不明"}）`;
  }

  return `the related comment by ${author ?? "unknown"}`;
}

function speakerName(author: string | undefined): string | undefined {
  const name = author?.replace(/^@+/, "").trim();
  return name || undefined;
}

function normalizeSpeakerName(author: string | undefined): string {
  return author?.replace(/\s+/g, "").trim() ?? "";
}

function confirmationRequestTarget(value: string): string | undefined {
  const normalized = stripMarkdownBreaks(value).replace(/^@[^\s]+[\s　]+/, "");
  const target = normalized
    .replace(/(?:について)?(?:ご)?確認(?:を)?(?:お願い(?:します|いたします)|ください)[。.!！]*$/u, "")
    .replace(/(?:について)?(?:ご)?確認(?:を)?お願いします[。.!！]*$/u, "")
    .trim();

  if (!target || target === normalized) {
    return undefined;
  }

  return shortContext(target);
}

function shortContext(value: string): string {
  const compact = stripMarkdownBreaks(value);
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function issueMetadataLine(group: ActivityGroup, language: GitppouConfig["reportLanguage"]): string | undefined {
  if (group.issueKey === "Unlinked") {
    return undefined;
  }

  const issueType = firstStringMetadata(group.activities, "issueType");
  const categories = firstStringArrayMetadata(group.activities, "categories");
  const categoriesText = categories.join(", ");

  const parts =
    language === "ja"
      ? [
          issueType ? `**種別:** ${metadataValue(issueType)}` : undefined,
          categoriesText ? `**カテゴリー:** ${metadataValue(categoriesText)}` : undefined
        ]
      : [
          issueType ? `**Type:** ${metadataValue(issueType)}` : undefined,
          categoriesText ? `**Categories:** ${metadataValue(categoriesText)}` : undefined
        ];

  const line = parts.filter((part): part is string => Boolean(part)).join(" / ");

  return line || undefined;
}

function issueSummaryParagraph(group: ActivityGroup, language: GitppouConfig["reportLanguage"]): string | undefined {
  const githubSummary = issueSourceSummary(group.activities, "github", group.issueKey, language);
  const backlogSummary = issueSourceSummary(group.activities, "backlog", group.issueKey, language);

  if (!githubSummary && !backlogSummary) {
    return undefined;
  }

  if (language === "ja") {
    const clauses = [githubSummary, backlogSummary].filter((value): value is string => Boolean(value));
    const subject = group.issueKey === "Unlinked" ? "この項目" : "この課題";
    return `${subject}では、${clauses.join("、")}を行いました。`;
  }

  const clauses = [githubSummary, backlogSummary].filter((value): value is string => Boolean(value));
  const subject = group.issueKey === "Unlinked" ? "these unlinked activities" : "this issue";
  return `For ${subject}, work included ${clauses.join(", plus ")}.`;
}

function issueSourceSummary(
  activities: NormalizedActivity[],
  source: NormalizedActivity["source"],
  issueKey: string,
  language: GitppouConfig["reportLanguage"]
): string | undefined {
  const sourceActivities = activities.filter((activity) => activity.source === source);
  const terms = issueSummaryTerms(sourceActivities, language);
  if (terms.length === 0) {
    return undefined;
  }

  const topics = issueSummaryTopics(sourceActivities, issueKey, language);
  const sourceLabel = source === "github" ? "GitHub" : "Backlog";

  if (language === "ja") {
    const topicPrefix = topics.length > 0 ? `${quoteTopics(topics, language)}を中心に` : "";
    return `${sourceLabel}で${topicPrefix}${joinJapaneseTerms(terms)}`;
  }

  const topicSuffix = topics.length > 0 ? ` around ${quoteTopics(topics, language)}` : "";
  return `${sourceLabel} ${joinEnglishTerms(terms)}${topicSuffix}`;
}

function issueSummaryTerms(
  activities: NormalizedActivity[],
  language: GitppouConfig["reportLanguage"]
): string[] {
  const kinds = new Set(activities.map((activity) => activity.kind));

  if (language === "ja") {
    return [
      kinds.has("commit") ? "commit作成" : undefined,
      kinds.has("pull_request") ? "PR更新" : undefined,
      kinds.has("review") ? "PRレビュー" : undefined,
      kinds.has("comment") ? "コメント対応" : undefined,
      kinds.has("status_change") ? "ステータス変更" : undefined
    ].filter((value): value is string => Boolean(value));
  }

  return [
    kinds.has("commit") ? "commits" : undefined,
    kinds.has("pull_request") ? "pull request updates" : undefined,
    kinds.has("review") ? "pull request reviews" : undefined,
    kinds.has("comment") ? "comments" : undefined,
    kinds.has("status_change") ? "status changes" : undefined
  ].filter((value): value is string => Boolean(value));
}

function issueSummaryTopics(
  activities: NormalizedActivity[],
  issueKey: string,
  language: GitppouConfig["reportLanguage"]
): string[] {
  const unique = new Map<string, string>();

  for (const activity of activities) {
    const topic = activitySummaryTopic(activity, issueKey, language);
    if (!topic) {
      continue;
    }

    const key = topic.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, topic);
    }
  }

  return [...unique.values()].slice(0, 2);
}

function activitySummaryTopic(
  activity: NormalizedActivity,
  issueKey: string,
  language: GitppouConfig["reportLanguage"]
): string | undefined {
  switch (activity.kind) {
    case "commit":
    case "pull_request":
    case "review":
      return titleSummaryTopic(activity.title, issueKey);
    case "comment": {
      const isConfirmation = activity.body ? isConfirmationComment(activity.body) : false;
      const previousComment = relatedPreviousComment(activity, isConfirmation);
      if (previousComment) {
        const previousTopic = textSummaryTopic(
          confirmationRequestTarget(previousComment.body) ?? previousComment.body,
          issueKey
        );
        if (previousTopic) {
          return language === "ja" ? `${previousTopic}への返信` : `reply to ${previousTopic}`;
        }
      }

      return textSummaryTopic(activity.body ?? activity.title, issueKey);
    }
    case "status_change":
      return statusChangeSummaryTopic(activity, language);
    default:
      return undefined;
  }
}

function titleSummaryTopic(title: string, issueKey: string): string | undefined {
  const topic = textSummaryTopic(title, issueKey);
  if (!topic || isLowValueTitleTopic(topic)) {
    return undefined;
  }

  return topic;
}

function textSummaryTopic(value: string, issueKey: string): string | undefined {
  const cleaned = stripLeadingIssueKey(stripConventionalCommitPrefix(cleanSummaryText(value)), issueKey);
  return cleaned ? shortSummaryTopic(cleaned) : undefined;
}

function statusChangeSummaryTopic(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"]
): string | undefined {
  const originalValue = metadataString(activity, "originalValue");
  const newValue = metadataString(activity, "newValue");

  if (originalValue && newValue) {
    return language === "ja"
      ? `ステータスを${originalValue}から${newValue}へ変更`
      : `status change from "${originalValue}" to "${newValue}"`;
  }

  if (newValue) {
    return language === "ja" ? `ステータスを${newValue}へ変更` : `status change to "${newValue}"`;
  }

  return undefined;
}

function cleanSummaryText(value: string): string {
  return stripMarkdownBreaks(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[^\s　]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripConventionalCommitPrefix(value: string): string {
  return value.replace(/^(?:feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(?:\([^)]+\))?!?:\s*/i, "");
}

function shortSummaryTopic(value: string): string {
  const compact = value.replace(/[。.!！]+$/u, "").trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function isLowValueTitleTopic(value: string): boolean {
  return (
    /^merge pull request #\d+/i.test(value) ||
    /^merge branch/i.test(value) ||
    /^(?:feature|fix|hotfix|release)[/\s:_-]+[a-z0-9_]+[\s_-]*\d+$/i.test(value)
  );
}

function quoteTopics(values: string[], language: GitppouConfig["reportLanguage"]): string {
  const quoted = values.map((value) => (language === "ja" ? `「${value}」` : `"${value}"`));
  return language === "ja" ? joinJapaneseTerms(quoted) : joinEnglishTerms(quoted);
}

function joinJapaneseTerms(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  return `${values.slice(0, -1).join("、")}と${values[values.length - 1]}`;
}

function joinEnglishTerms(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function progressLines(
  activities: NormalizedActivity[],
  groups: ActivityGroup[],
  config: GitppouConfig
): string[] {
  const assignedIssues = assignedProgressActivities(activities, config.reportDate);
  if (assignedIssues.length > 0) {
    return assignedProgressLines(assignedIssues, config);
  }

  const language = config.reportLanguage;
  if (groups.length === 0) {
    return [`- ${language === "ja" ? "記録された進捗はありません。" : "No recorded progress."}`];
  }

  return groups.map((group) => {
    const status = firstStringMetadata(group.activities, "status");
    const githubCount = group.activities.filter((activity) => activity.source === "github").length;
    const backlogCount = group.activities.filter((activity) => activity.source === "backlog").length;
    const prefix = group.issueKey === "Unlinked" ? "Unlinked" : group.issueKey;

    if (language === "ja") {
      const statusText = status ? `ステータス: ${status}` : "ステータス確認が必要";
      return `- ${prefix}: ${statusText}。GitHub ${githubCount}件、Backlog ${backlogCount}件。`;
    }

    const statusText = status ? `status: ${status}` : "status needs confirmation";
    return `- ${prefix}: ${statusText}; ${githubCount} GitHub item(s), ${backlogCount} Backlog item(s).`;
  });
}

function assignedProgressActivities(activities: NormalizedActivity[], reportDate?: string): NormalizedActivity[] {
  return activities
    .filter((activity) => activity.kind === "assigned_issue")
    .filter((activity) => progressSchedule(activity, reportDate) !== undefined)
    .sort((left, right) => compareProgressStartDate(left, right, reportDate))
    .slice(0, 10);
}

function compareProgressStartDate(
  left: NormalizedActivity,
  right: NormalizedActivity,
  reportDate?: string
): number {
  const leftStart = progressStartDate(left, reportDate);
  const rightStart = progressStartDate(right, reportDate);
  return leftStart.localeCompare(rightStart) || left.title.localeCompare(right.title);
}

function assignedProgressLines(
  activities: NormalizedActivity[],
  config: GitppouConfig
): string[] {
  const isJapanese = config.reportLanguage === "ja";
  return [
    "```mermaid",
    "gantt",
    `  title ${isJapanese ? "直近の担当課題" : "Recent assigned issues"}`,
    "  dateFormat  YYYY-MM-DD",
    "  axisFormat  %m/%d",
    ...mermaidMilestoneSections(activities, config),
    "```"
  ];
}

function mermaidMilestoneSections(
  activities: NormalizedActivity[],
  config: GitppouConfig
): string[] {
  const fallbackSection = config.reportLanguage === "ja" ? "マイルストーン未設定" : "No milestone";
  const lines: string[] = [];
  const sections = new Map<string, NormalizedActivity[]>();

  for (const activity of activities) {
    const section = firstStringArrayMetadata([activity], "milestones")[0] ?? fallbackSection;
    const sectionActivities = sections.get(section) ?? [];
    sectionActivities.push(activity);
    sections.set(section, sectionActivities);
  }

  for (const [section, sectionActivities] of sections) {
    lines.push(`  section ${mermaidText(section)}`);
    for (const activity of sectionActivities) {
      lines.push(`  ${mermaidTaskLine(activity, config.reportDate)}`);
    }
  }

  return lines;
}

function mermaidTaskLine(activity: NormalizedActivity, reportDate: string): string {
  const issueKey = activity.issueKey ?? "Unlinked";
  const title = mermaidTaskTitle(activity);
  const marker = mermaidStatusMarker(metadataString(activity, "status"));
  const taskId = `task_${issueKey.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const markerPrefix = marker ? `${marker}, ${taskId}` : taskId;
  const schedule = progressSchedule(activity, reportDate) ?? `${reportDate}, 1d`;

  return `${title} :${markerPrefix}, ${schedule}`;
}

function mermaidTaskTitle(activity: NormalizedActivity): string {
  const title = stripLeadingIssueKey(stripMarkdownBreaks(activity.title), activity.issueKey).slice(0, 80);
  return mermaidText(`${activity.issueKey ?? "Unlinked"} ${title}`);
}

function mermaidText(value: string): string {
  return stripMarkdownBreaks(value).replace(/[:\n\r]/g, " -").replace(/,/g, "、");
}

function mermaidStatusMarker(status: string | undefined): string | undefined {
  if (!status) {
    return undefined;
  }

  if (isResolvedStatus(status)) {
    return "done";
  }

  if (/progress|review|処理|レビュー|確認依頼/i.test(status)) {
    return "active";
  }

  return undefined;
}

function progressSchedule(activity: NormalizedActivity, reportDate?: string): string | undefined {
  const range = progressDateRange(activity, reportDate);
  if (!range) {
    return undefined;
  }

  if (range.start === range.due) {
    return `${range.start}, 1d`;
  }

  return `${range.start}, ${range.due}`;
}

function progressDateRange(
  activity: NormalizedActivity,
  reportDate?: string
): { start: string; due: string } | undefined {
  const startDate = metadataDate(activity, "startDate");
  const dueDate = metadataDate(activity, "dueDate");
  if (!startDate && !dueDate) {
    return undefined;
  }

  const start = startDate ?? inferredStartDate(dueDate, reportDate);
  const due = dueDate ?? startDate;
  if (!start || !due) {
    return undefined;
  }

  return { start, due };
}

function progressStartDate(activity: NormalizedActivity, reportDate?: string): string {
  return progressDateRange(activity, reportDate)?.start ?? "9999-12-31";
}

function inferredStartDate(dueDate: string | undefined, reportDate: string | undefined): string | undefined {
  if (!dueDate) {
    return reportDate;
  }

  if (!reportDate) {
    return dueDate;
  }

  return dueDate < reportDate ? dueDate : reportDate;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function nextActionLines(
  activities: NormalizedActivity[],
  groups: ActivityGroup[],
  config: GitppouConfig
): string[] {
  const scheduledActions = nextScheduledAssignedIssueLines(activities, config);
  if (scheduledActions.length > 0) {
    return scheduledActions;
  }

  const language = config.reportLanguage;
  const candidates = groups
    .filter((group) =>
      group.activities.some((activity) => {
        const status = String(activity.metadata?.status ?? "").toLowerCase();
        const state = String(activity.metadata?.state ?? "").toLowerCase();
        return (
          activity.kind === "due_issue" ||
          status.includes("progress") ||
          status.includes("review") ||
          status.includes("処理") ||
          status.includes("レビュー") ||
          state === "open"
        );
      })
    )
    .slice(0, 8);

  return candidates.map((group) => {
    const heading = formatGroupHeading(group);
    return language === "ja" ? `${heading} の次の対応を確認` : `Confirm next step for ${heading}.`;
  });
}

function nextScheduledAssignedIssueLines(
  activities: NormalizedActivity[],
  config: GitppouConfig
): string[] {
  const tomorrow = addDays(config.reportDate, 1);
  return assignedProgressActivities(activities, config.reportDate)
    .filter((activity) => progressIncludesDate(activity, tomorrow, config.reportDate))
    .map((activity) => scheduledAssignedIssueLine(activity, config.reportLanguage));
}

function progressIncludesDate(activity: NormalizedActivity, date: string, reportDate: string): boolean {
  const range = progressDateRange(activity, reportDate);
  return Boolean(range && range.start <= date && date <= range.due);
}

function scheduledAssignedIssueLine(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"]
): string {
  const heading = stripMarkdownBreaks(activity.title);
  const status = metadataString(activity, "status");
  const dueDate = metadataDate(activity, "dueDate");

  if (language === "ja") {
    const detail = [
      status ? `ステータス: ${status}` : undefined,
      dueDate ? `期限: ${dueDate}` : undefined
    ].filter((value): value is string => Boolean(value));
    return detail.length > 0 ? `${heading}: ${detail.join("、")}` : `${heading} の対応`;
  }

  const detail = [
    status ? `status: ${status}` : undefined,
    dueDate ? `due: ${dueDate}` : undefined
  ].filter((value): value is string => Boolean(value));
  return detail.length > 0 ? `${heading}: ${detail.join("; ")}` : `Work on ${heading}.`;
}

function rawActivityLines(activities: NormalizedActivity[]): string[] {
  return activities.map((activity) => {
    const repo = activity.repository ? `${activity.repository} ` : "";
    const url = activity.url ? ` (${activity.url})` : "";
    return `${labelForKind(activity.kind)}: ${repo}${activity.title}${url}`;
  });
}

function labelForKind(kind: NormalizedActivity["kind"]): string {
  switch (kind) {
    case "commit":
      return "Commit";
    case "pull_request":
      return "PR";
    case "review":
      return "Review";
    case "comment":
      return "Comment";
    case "comment_context":
      return "Context";
    case "issue":
      return "Issue";
    case "status_change":
      return "Status";
    case "assigned_issue":
      return "Assigned";
    case "due_issue":
      return "Due today";
  }
}

function statusSuffix(activity: NormalizedActivity, label = "status"): string {
  const status = typeof activity.metadata?.status === "string" ? activity.metadata.status : undefined;
  return status ? ` (${label}: ${status})` : "";
}

function pullRequestStatsSuffix(
  activity: NormalizedActivity,
  language: GitppouConfig["reportLanguage"]
): string {
  const additions = metadataNumber(activity, "additions");
  const deletions = metadataNumber(activity, "deletions");
  const changedFiles = metadataNumber(activity, "changedFiles");

  if (additions === undefined && deletions === undefined && changedFiles === undefined) {
    return "";
  }

  const diff = [
    additions === undefined ? undefined : `+${additions}`,
    deletions === undefined ? undefined : `-${deletions}`
  ].filter((value): value is string => Boolean(value)).join(" / ");
  const files = changedFiles === undefined
    ? undefined
    : `${changedFiles} files`;
  const parts = [diff || undefined, files].filter((value): value is string => Boolean(value));

  if (parts.length === 0) {
    return "";
  }

  return language === "ja" ? `（${parts.join("、")}）` : ` (${parts.join(", ")})`;
}

function statusChangeText(activity: NormalizedActivity, language: GitppouConfig["reportLanguage"]): string {
  const originalValue = metadataString(activity, "originalValue");
  const newValue = metadataString(activity, "newValue");

  if (language === "ja") {
    if (originalValue && newValue) {
      return `ステータスを「${originalValue}」から「${newValue}」に変更`;
    }

    if (newValue) {
      return `ステータスを「${newValue}」に変更`;
    }

    return "Backlogステータスを更新";
  }

  if (originalValue && newValue) {
    return `Status changed from "${originalValue}" to "${newValue}".`;
  }

  if (newValue) {
    return `Status changed to "${newValue}".`;
  }

  return activity.body ?? "Backlog status changed.";
}

function metadataString(activity: NormalizedActivity, key: string): string | undefined {
  const value = activity.metadata?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function metadataNumber(activity: NormalizedActivity, key: string): number | undefined {
  const value = activity.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadataDate(activity: NormalizedActivity, key: string): string | undefined {
  return metadataString(activity, key)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

function firstStringMetadata(activities: NormalizedActivity[], key: string): string | undefined {
  for (const activity of activities) {
    const value = activity.metadata?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function firstStringArrayMetadata(activities: NormalizedActivity[], key: string): string[] {
  for (const activity of activities) {
    const value = activity.metadata?.[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    }
  }

  return [];
}

function metadataValue(value: string): string {
  return stripMarkdownBreaks(value);
}

function compactBody(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }

  const compact = stripMarkdownBreaks(body).slice(0, 180);
  return compact.length < body.length ? `${compact}...` : compact;
}

function isConfirmationComment(value: string): boolean {
  return /確認しました|確認済み|確認いたしました|確認完了|confirmed|looks good|lgtm/i.test(
    stripMarkdownBreaks(value)
  );
}

function isLowSignalContextComment(value: string): boolean {
  const normalized = stripMarkdownBreaks(value)
    .replace(/^@[^\s　]+[\s　]*/u, "")
    .replace(/[!！。.\s]+$/gu, "")
    .trim();

  return /^(確認しました|確認済みです?|確認いたしました|確認完了|承知しました|了解しました|ok|okay|thanks|thank you|lgtm)$/iu.test(
    normalized
  );
}

function isResolvedStatus(status: string): boolean {
  return /done|closed|resolved|completed|処理済み|完了|対応済み|終了|クローズ/i.test(status);
}

function stripLeadingIssueKey(title: string, issueKey: string | undefined): string {
  if (!issueKey) {
    return title;
  }

  return title.replace(new RegExp(`^${escapeRegExp(issueKey)}[:：\\s-]*`), "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarkdownBreaks(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
