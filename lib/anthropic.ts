export const ANTHROPIC_VERSION = "2023-06-01";
export const MODEL = "claude-opus-4-7";

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

/** Strip markdown code fences that Claude sometimes adds despite instructions */
export function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
