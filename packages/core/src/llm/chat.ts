import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { GitppouConfig } from "../types.js";

type ChatInput = {
  config: GitppouConfig;
  prompt: string;
  maxTokens: number;
  temperature: number;
};

type GitHubModelsResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string;
    };
  }>;
};

type OpenAIResponse = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const GITHUB_MODELS_ENDPOINT =
  "https://models.github.ai/inference/chat/completions";
const GITHUB_API_VERSION = "2026-03-10";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function chatWithLlmProvider(input: ChatInput): Promise<string> {
  switch (input.config.llmProvider) {
    case "github-models":
      return chatWithGitHubModels(input);
    case "openai":
      return chatWithOpenAI(input);
    case "aws-bedrock":
      return chatWithBedrock(input);
    case "template":
      throw new Error(
        "The template provider does not support LLM chat requests.",
      );
  }
}

async function chatWithGitHubModels(input: ChatInput): Promise<string> {
  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.config.githubToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      model: input.config.llmModel,
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Models request failed with status ${response.status}.`,
    );
  }

  const data = (await response.json()) as GitHubModelsResponse;
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const content = choice?.message?.content?.trim();

  if (!content) {
    throw new Error("GitHub Models returned an empty response.");
  }

  if (finishReason && finishReason !== "stop") {
    throw new Error(
      `GitHub Models response was incomplete. finish_reason=${finishReason}.`,
    );
  }

  return content;
}

async function chatWithOpenAI(input: ChatInput): Promise<string> {
  if (!input.config.llmApiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.config.llmModel,
      input: input.prompt,
      max_output_tokens: input.maxTokens,
      store: false,
      ...(supportsMinimalReasoning(input.config.llmModel)
        ? { reasoning: { effort: "minimal" } }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as OpenAIResponse;
  if (data.status && data.status !== "completed") {
    const reason = data.incomplete_details?.reason;
    throw new Error(
      `OpenAI response was incomplete. status=${data.status}${reason ? ` reason=${reason}` : ""}.`,
    );
  }

  const content = data.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter(
      (item) => item.type === "output_text" && typeof item.text === "string",
    )
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

function supportsMinimalReasoning(model: string): boolean {
  return /^gpt-5(?:-(?:mini|nano)(?:-|$)|$)/.test(model);
}

async function chatWithBedrock(input: ChatInput): Promise<string> {
  if (!input.config.llmRegion) {
    throw new Error("AWS Bedrock region is not configured.");
  }

  const client = new BedrockRuntimeClient({
    region: input.config.llmRegion,
    ...(input.config.llmProfile ? { profile: input.config.llmProfile } : {}),
  });
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId: input.config.llmModel,
        messages: [
          {
            role: "user",
            content: [{ text: input.prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        },
      }),
    );

    if (
      response.stopReason &&
      response.stopReason !== "end_turn" &&
      response.stopReason !== "stop_sequence"
    ) {
      throw new Error(
        `AWS Bedrock response was incomplete. stopReason=${response.stopReason}.`,
      );
    }

    const content = response.output?.message?.content
      ?.flatMap((block) =>
        typeof block.text === "string" ? [block.text.trim()] : [],
      )
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!content) {
      throw new Error("AWS Bedrock returned an empty response.");
    }

    return content;
  } finally {
    client.destroy();
  }
}
