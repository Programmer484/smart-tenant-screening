export const ANTHROPIC_VERSION = "2023-06-01";
export const MODEL = "claude-sonnet-4-6";

type Tool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type CallOptions = {
  system: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  tools?: Tool[];
  tool_choice?: { type: string; name?: string };
};

type AnthropicBlock = {
  type: string;
  text?: string;
  input?: Record<string, unknown>;
  name?: string;
  id?: string;
};

type AnthropicResponse = {
  content: AnthropicBlock[];
};

export async function callClaude(
  apiKey: string,
  opts: CallOptions,
): Promise<AnthropicResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.max_tokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
      ...(opts.tools && { tools: opts.tools }),
      ...(opts.tool_choice && { tool_choice: opts.tool_choice }),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ClaudeApiError(text || res.statusText, res.status);
  }

  return (await res.json()) as AnthropicResponse;
}

export class ClaudeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ClaudeApiError";
    this.status = status >= 500 ? 502 : status;
  }
}

/** Extract text from Claude response blocks */
export function extractText(response: AnthropicResponse): string {
  return (
    response.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

/**
 * Extract the input of a forced tool_use block from a Claude response.
 * Returns null if the model did not call the expected tool (which should be
 * impossible when `tool_choice` forces a specific tool, but we guard anyway).
 */
export function extractToolUse<T = Record<string, unknown>>(
  response: AnthropicResponse,
  toolName: string,
): T | null {
  const block = response.content?.find(
    (b) => b.type === "tool_use" && b.name === toolName,
  );
  if (!block || !block.input) return null;
  return block.input as T;
}
