export type OpenRouterMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export const openRouterChatModel = "nvidia/nemotron-3-ultra-550b-a55b:free";

export async function callOpenRouter({ messages }: { messages: OpenRouterMessage[] }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      ok: false as const,
      status: 503,
      message: "AI is not configured yet. Add OPENROUTER_API_KEY in the server environment.",
    };
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Cutoff Lens",
      ...(process.env.NEXT_PUBLIC_SITE_URL ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL } : {}),
    },
    body: JSON.stringify({
      model: openRouterChatModel,
      messages,
      temperature: 0.7,
      max_tokens: 1600,
    }),
  });

  const data = (await response.json().catch(() => null)) as OpenRouterResponse | null;

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      message: data?.error?.message ?? "AI request failed.",
    };
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    return {
      ok: false as const,
      status: 502,
      message: "AI returned an empty answer.",
    };
  }

  return {
    ok: true as const,
    answer,
    model: data?.model ?? openRouterChatModel,
  };
}
