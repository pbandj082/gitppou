import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitppouConfig } from "../types.js";

const bedrockMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(config: unknown) {
      bedrockMocks.construct(config);
    }

    destroy = bedrockMocks.destroy;
    send = bedrockMocks.send;
  },
  ConverseCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

import { chatWithLlmProvider } from "../llm/chat.js";

const baseConfig: GitppouConfig = {
  githubToken: "github-token",
  githubUsername: "octocat",
  githubRepos: [],
  backlogSpaces: [],
  reportDate: "2026-07-10",
  reportTimezone: "Asia/Tokyo",
  reportLanguage: "ja",
  reportDir: "reports",
  reportFormats: ["markdown"],
  reportHtmlDir: ".gitppou/site",
  reportPdfDir: ".gitppou/pdf",
  commitReport: false,
  slackNotify: false,
  llmProvider: "openai",
  llmModel: "gpt-5-nano",
  llmMaxInputChars: 20_000,
  llmStyle: "concise",
};

beforeEach(() => {
  bedrockMocks.construct.mockReset();
  bedrockMocks.destroy.mockReset();
  bedrockMocks.send.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chatWithLlmProvider", () => {
  it("calls the OpenAI Responses API without storing the response", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "# 日報\n\n完了" }],
            },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatWithLlmProvider({
      config: { ...baseConfig, llmApiKey: "openai-key" },
      prompt: "日報を作成してください",
      maxTokens: 4000,
      temperature: 0.1,
    });

    expect(result).toBe("# 日報\n\n完了");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openai-key",
        }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "gpt-5-nano",
      input: "日報を作成してください",
      max_output_tokens: 4000,
      store: false,
      reasoning: {
        effort: "minimal",
      },
    });
  });

  it("rejects incomplete OpenAI responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
        }),
      ),
    );

    await expect(
      chatWithLlmProvider({
        config: { ...baseConfig, llmApiKey: "openai-key" },
        prompt: "prompt",
        maxTokens: 4000,
        temperature: 0.1,
      }),
    ).rejects.toThrow(
      "OpenAI response was incomplete. status=incomplete reason=max_output_tokens.",
    );
  });

  it("calls Amazon Bedrock through the Converse API", async () => {
    bedrockMocks.send.mockResolvedValue({
      stopReason: "end_turn",
      output: {
        message: {
          content: [{ text: "# 日報\n\n完了" }],
        },
      },
    });

    const result = await chatWithLlmProvider({
      config: {
        ...baseConfig,
        llmProvider: "aws-bedrock",
        llmModel: "jp.amazon.nova-2-lite-v1:0",
        llmRegion: "ap-northeast-1",
        llmProfile: "gaia",
      },
      prompt: "日報を作成してください",
      maxTokens: 4000,
      temperature: 0.1,
    });

    expect(result).toBe("# 日報\n\n完了");
    expect(bedrockMocks.construct).toHaveBeenCalledWith({
      region: "ap-northeast-1",
      profile: "gaia",
    });
    const command = bedrockMocks.send.mock.calls[0]?.[0] as {
      input: unknown;
    };
    expect(command.input).toEqual({
      modelId: "jp.amazon.nova-2-lite-v1:0",
      messages: [
        {
          role: "user",
          content: [{ text: "日報を作成してください" }],
        },
      ],
      inferenceConfig: {
        maxTokens: 4000,
        temperature: 0.1,
      },
    });
    expect(bedrockMocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects truncated Amazon Bedrock responses", async () => {
    bedrockMocks.send.mockResolvedValue({
      stopReason: "max_tokens",
      output: {
        message: {
          content: [{ text: "truncated" }],
        },
      },
    });

    await expect(
      chatWithLlmProvider({
        config: {
          ...baseConfig,
          llmProvider: "aws-bedrock",
          llmModel: "jp.amazon.nova-2-lite-v1:0",
          llmRegion: "ap-northeast-1",
        },
        prompt: "prompt",
        maxTokens: 4000,
        temperature: 0.1,
      }),
    ).rejects.toThrow(
      "AWS Bedrock response was incomplete. stopReason=max_tokens.",
    );
    expect(bedrockMocks.destroy).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
