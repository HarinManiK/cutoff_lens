// Provider layer for the counsellor. One streaming entry point serves both the
// SSE route and the buffered JSON route, so there is a single code path to
// reason about rather than a provider x streaming matrix that drifts apart.
//
// Deliberate choices here:
// - Conversation history is sent. The previous version passed only the latest
//   user line, so the model could not resolve "what about the second one".
// - Reasoning models (Kimi, Gemini thinking) stream `reasoning_content` before
//   any answer text and spend the token budget on it. The budget is sized for
//   that, and a response that produced only reasoning is reported as a failure
//   rather than surfacing as an empty bubble.
// - Every upstream call is bounded by a timeout and retried once on transient
//   failures, but only while no answer text has been emitted.

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StreamResult =
  | { ok: true; model: string; text: string }
  | { ok: false; message: string; status: number };

export type ModelRequest = {
  system: string;
  dataMessage: string;
  history: ChatTurn[];
  latestUserMessage: string;
};

type Provider = "nvidia" | "gemini" | "openrouter";

// The route runs under maxDuration 60, and an attempt plus a retry has to fit
// inside it with room to still write the fallback answer. A stalled upstream
// must therefore fail fast rather than burning the whole request budget.
const TOTAL_BUDGET_MS = 40_000;
const ATTEMPT_TIMEOUT_MS = 25_000;
const FIRST_TOKEN_TIMEOUT_MS = 15_000;
const RETRY_MIN_REMAINING_MS = 10_000;
const MAX_OUTPUT_TOKENS = 3_000;
const TEMPERATURE = 0.3;

export function activeProvider(): Provider | null {
  const configured = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (configured === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (configured === "nvidia") return process.env.NVIDIA_API_KEY ? "nvidia" : null;
  if (configured === "openrouter") return process.env.OPENROUTER_API_KEY ? "openrouter" : null;
  if (process.env.NVIDIA_API_KEY) return "nvidia";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export function activeModelName(provider: Provider) {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (provider === "gemini") return "gemini-2.0-flash";
  if (provider === "openrouter") return "poolside/laguna-s-2.1:free";
  return "moonshotai/kimi-k3";
}

export function isAiConfigured() {
  return activeProvider() !== null;
}

// The grounding block rides on the newest user turn rather than the system
// prompt: it is turn-specific evidence, and keeping it adjacent to the
// question it answers measurably reduces the model reaching past it.
function composeTurns({ system, dataMessage, history, latestUserMessage }: ModelRequest) {
  const prior = history.filter((turn) => turn.content.trim().length > 0).slice(0, -1);
  const grounded = `${dataMessage}\n\nStudent's message:\n${latestUserMessage}`;
  return { system, prior, grounded };
}

// 429 is deliberately absent: the free tiers this runs on rate-limit by the
// minute, so an immediate retry just burns another request and delays the
// fallback the student is going to see anyway.
// Failure reasons the student is allowed to see. They explain why the answer
// below is the database one, without leaking provider or key detail.
export function describeStatus(status: number) {
  if (status === 429) return "The AI is rate-limited right now";
  if (status === 401 || status === 403) return "The AI is not authorised";
  if (status === 504 || status === 408) return "The AI took too long";
  return "The AI did not respond";
}

function transient(status: number) {
  return status === 408 || status === 409 || status === 502 || status === 503 || status === 504;
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  extract: (json: unknown) => string,
  onToken: (text: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = extract(JSON.parse(payload));
          if (chunk) {
            text += chunk;
            onToken(chunk);
          }
        } catch {
          // Keep-alive frames and partial JSON are expected; skip them.
        }
      }
    }
  }
  return text;
}

type OpenAiChunk = {
  choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
};

// Only `content` is forwarded. `reasoning_content` is the model thinking aloud
// and must never reach the student.
function extractOpenAiDelta(json: unknown) {
  return (json as OpenAiChunk).choices?.[0]?.delta?.content ?? "";
}

type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
};

function extractGeminiDelta(json: unknown) {
  const parts = (json as GeminiChunk).candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
}

async function streamNvidia(request: ModelRequest, onToken: (text: string) => void, signal: AbortSignal): Promise<StreamResult> {
  const model = activeModelName("nvidia");
  const { system, prior, grounded } = composeTurns(request);
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY ?? ""}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        ...prior.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: grounded },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    return { ok: false, message: describeStatus(response.status), status: response.status || 502 };
  }
  const text = await readSse(response.body, extractOpenAiDelta, onToken);
  if (!text.trim()) {
    return { ok: false, message: "Model produced no answer text", status: 502 };
  }
  return { ok: true, model, text };
}

async function streamGemini(request: ModelRequest, onToken: (text: string) => void, signal: AbortSignal): Promise<StreamResult> {
  const model = activeModelName("gemini");
  const { system, prior, grounded } = composeTurns(request);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [
          ...prior.map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.content }],
          })),
          { role: "user", parts: [{ text: grounded }] },
        ],
        generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
    },
  );

  if (!response.ok || !response.body) {
    return { ok: false, message: describeStatus(response.status), status: response.status || 502 };
  }
  const text = await readSse(response.body, extractGeminiDelta, onToken);
  if (!text.trim()) {
    return { ok: false, message: "Model produced no answer text", status: 502 };
  }
  return { ok: true, model, text };
}

// OpenRouter speaks the same OpenAI-compatible SSE dialect as NVIDIA, so the
// shared reader and delta extractor apply. It additionally asks for a referer
// and title identifying the calling app.
async function streamOpenRouter(request: ModelRequest, onToken: (text: string) => void, signal: AbortSignal): Promise<StreamResult> {
  const model = activeModelName("openrouter");
  const { system, prior, grounded } = composeTurns(request);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cutofflens.vercel.app";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
      "HTTP-Referer": siteUrl,
      "X-Title": "Cutoff Lens",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        ...prior.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: grounded },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    return { ok: false, message: describeStatus(response.status), status: response.status || 502 };
  }
  const text = await readSse(response.body, extractOpenAiDelta, onToken);
  if (!text.trim()) {
    return { ok: false, message: "Model produced no answer text", status: 502 };
  }
  return { ok: true, model, text };
}

async function attempt(
  provider: Provider,
  request: ModelRequest,
  onToken: (text: string) => void,
  budgetMs: number,
): Promise<StreamResult> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), Math.min(budgetMs, ATTEMPT_TIMEOUT_MS));
  // A connection that opens but never produces a token is the failure mode
  // that used to hang the request until the platform killed it. Give the
  // first token its own, shorter leash; once text is flowing, only the
  // overall deadline applies.
  let firstToken: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    Math.min(budgetMs, FIRST_TOKEN_TIMEOUT_MS),
  );
  const track = (text: string) => {
    if (firstToken) {
      clearTimeout(firstToken);
      firstToken = null;
    }
    onToken(text);
  };

  try {
    if (provider === "gemini") return await streamGemini(request, track, controller.signal);
    if (provider === "openrouter") return await streamOpenRouter(request, track, controller.signal);
    return await streamNvidia(request, track, controller.signal);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      message: aborted ? "Model timed out" : "Could not reach the model",
      status: aborted ? 504 : 503,
    };
  } finally {
    clearTimeout(deadline);
    if (firstToken) clearTimeout(firstToken);
  }
}

export async function streamModel(
  request: ModelRequest,
  onToken: (text: string) => void,
): Promise<StreamResult> {
  const provider = activeProvider();
  if (!provider) return { ok: false, message: "AI is not configured", status: 503 };

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let emitted = false;
  const track = (text: string) => {
    emitted = true;
    onToken(text);
  };

  const first = await attempt(provider, request, track, remaining());
  if (first.ok) return first;

  // Retrying after partial output would duplicate half an answer, so a retry
  // only happens when nothing reached the student and there is budget left to
  // finish one.
  if (emitted || !transient(first.status) || remaining() < RETRY_MIN_REMAINING_MS) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return attempt(provider, request, track, remaining());
}
