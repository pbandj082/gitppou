export type ReportLanguage = "en" | "ja";
export type LlmProviderName = "template" | "github-models";
export type LlmStyle = "concise" | "detailed";

export type GitppouConfig = {
  githubToken: string;
  githubUsername: string;
  githubRepos: string[];

  backlogApiKey: string;
  backlogSpace: string;
  backlogProjectKeys: string[];
  backlogUserId?: string;

  reportDate: string;
  reportTimezone: string;
  reportLanguage: ReportLanguage;
  reportDir: string;

  commitReport: boolean;
  slackNotify: boolean;
  slackWebhookUrl?: string;

  llmProvider: LlmProviderName;
  llmModel: string;
  llmMaxInputChars: number;
  llmStyle: LlmStyle;
};

export type ActivitySource = "github" | "backlog";

export type ActivityKind =
  | "commit"
  | "pull_request"
  | "review"
  | "comment"
  | "issue"
  | "status_change"
  | "due_issue";

export type NormalizedActivity = {
  source: ActivitySource;
  kind: ActivityKind;
  projectKey?: string;
  issueKey?: string;
  title: string;
  body?: string;
  url?: string;
  repository?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ActivityGroup = {
  issueKey: string | "Unlinked";
  title?: string;
  activities: NormalizedActivity[];
};

export type ReportResult = {
  reportPath: string;
  reportMarkdown: string;
  slackSummary: string;
};
