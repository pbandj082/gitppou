export type ReportLanguage = "en" | "ja";
export type LlmProviderName = "template" | "github-models";
export type LlmStyle = "concise" | "detailed";
export type GitHubRepoSort = "created" | "updated" | "pushed" | "full_name";

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

export type GitppouConfig = {
  githubToken: string;
  githubTokensByOwner?: Record<string, string>;
  githubUsername: string;
  githubRepos: GitHubRepoSpec[];

  backlogApiKey?: string;
  backlogUserId?: string;
  backlogSpaces: BacklogSpaceConfig[];

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
