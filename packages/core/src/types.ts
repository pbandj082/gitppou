export type ReportLanguage = "en" | "ja";
export type LlmProviderName =
  "template" | "github-models" | "openai" | "aws-bedrock";
export type LlmStyle = "concise" | "detailed";
export type GitHubRepoSort = "created" | "updated" | "pushed" | "full_name";
export type ReportFormat = "markdown" | "html" | "pdf";

export type GitHubRepoOwnerSpec = {
  owner: string;
  limit?: number;
  sort?: GitHubRepoSort;
  includeForks?: boolean;
  includeArchived?: boolean;
};

export type GitHubRepoSpec =
  | string
  | {
      repo: string;
    }
  | GitHubRepoOwnerSpec;

export type BacklogSpaceConfig = {
  space: string;
  host?: string;
  projectKeys: string[];
};

export type BacklogDocumentConfig = {
  space: string;
  host?: string;
  projectId?: number;
  projectKey?: string;
  parentId?: string;
  title?: string;
  emoji?: string;
  addLast?: boolean;
};

export type BacklogDocumentResult = {
  id: string;
  projectId: number;
  title: string;
  url?: string;
  created?: string;
  updated?: string;
};

export type GitppouConfig = {
  githubToken: string;
  githubTokensByOwner?: Record<string, string>;
  githubUsername: string;
  githubRepos: GitHubRepoSpec[];

  backlogApiKey?: string;
  backlogUserId?: string;
  backlogSpaces: BacklogSpaceConfig[];
  backlogDocument?: BacklogDocumentConfig;

  reportDate: string;
  reportAuthor?: string;
  reportTimezone: string;
  reportLanguage: ReportLanguage;
  reportDir: string;
  reportFormats: ReportFormat[];
  reportHtmlDir: string;
  reportPdfDir: string;

  commitReport: boolean;
  slackNotify: boolean;
  deferSlackNotification?: boolean;
  deferBacklogDocumentPublish?: boolean;
  slackWebhookUrl?: string;
  githubActionsContext?: GitHubActionsContext;

  llmProvider: LlmProviderName;
  llmModel: string;
  llmApiKey?: string;
  llmRegion?: string;
  llmProfile?: string;
  llmMaxInputChars: number;
  llmStyle: LlmStyle;
};

export type GitHubActionsContext = {
  actor?: string;
  eventName?: string;
  refName?: string;
  repository?: string;
  runId?: string;
  runNumber?: string;
  serverUrl?: string;
  workflow?: string;
};

export type ActivitySource = "github" | "backlog";

export type ActivityKind =
  | "commit"
  | "pull_request"
  | "review"
  | "comment"
  | "comment_context"
  | "issue"
  | "status_change"
  | "assigned_issue"
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
  reportHtmlPath?: string;
  reportPdfPath?: string;
  reportPaths: string[];
  reportMarkdown: string;
  slackSummary: string;
  slackSummaryText?: string;
  backlogDocument?: BacklogDocumentResult;
};
