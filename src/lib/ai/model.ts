// Model caller, provider-pluggable. Prefers NVIDIA Build (Kimi-K3, free
// trial tier) when NVIDIA_API_KEY is set, falls back to Gemini REST when
// GEMINI_API_KEY is set, otherwise returns null so the route serves the
// deterministic database-only answer. No web search here: chat reads only
// our DB.

export type ModelResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; message: string; status: number };

async function callNvidia(system: string, dataMessage: string, userMessage: string): Promise<ModelResult> {
  const apiKey = process.env.NVIDIA_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "moonshotai/kimi-k3";
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${dataMessage}\n\nStudent question:\n${userMessage}` },
        ],
        temperature: 0.4,
        max_tokens: 1200,
      }),
    });
    if (!response.ok) {
      return { ok: false, message: `NVIDIA model error ${response.status}`, status: response.status };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = body.choices?.[0]?.message?.content?.trim();
    if (!answer) return { ok: false, message: "Empty model response", status: 502 };
    return { ok: true, answer, model };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Model call failed", status: 503 };
  }
}

async function callGemini(system: string, dataMessage: string, userMessage: string): Promise<ModelResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "gemini-2.0-flash";
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: `${dataMessage}\n\nStudent question:\n${userMessage}` }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
        }),
      },
    );
    if (!response.ok) {
      return { ok: false, message: `Model error ${response.status}`, status: response.status };
    }
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const answer = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim();
    if (!answer) return { ok: false, message: "Empty model response", status: 502 };
    return { ok: true, answer, model };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Model call failed", status: 503 };
  }
}

// Streaming variant for the NVIDIA OpenAI-compatible endpoint. Forwards
// token deltas to onToken as they arrive; resolves with the model name.
// Anything else (no key, non-OK status, network error) resolves instead of
// throwing so the route can fall back to the database answer.
export async function callNvidiaStream(
  system: string,
  dataMessage: string,
  userMessage: string,
  onToken: (text: string) => void,
): Promise<{ ok: true; model: string } | { ok: false; message: string; status: number }> {
  const apiKey = process.env.NVIDIA_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "moonshotai/kimi-k3";
  if (!apiKey) return { ok: false, message: "AI is not configured.", status: 503 };
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${dataMessage}\n\nStudent question:\n${userMessage}` },
        ],
        temperature: 0.4,
        max_tokens: 1200,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      return { ok: false, message: `NVIDIA model error ${response.status}`, status: response.status };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotText = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const text = json.choices?.[0]?.delta?.content ?? "";
            if (text) {
              gotText = true;
              onToken(text);
            }
          } catch {
            // Ignore keep-alive or partial frames.
          }
        }
      }
    }
    if (!gotText) return { ok: false, message: "Empty model response", status: 502 };
    return { ok: true, model };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Model call failed", status: 503 };
  }
}

export async function callModel(
  system: string,
  dataMessage: string,
  userMessage: string,
): Promise<ModelResult | null> {
  const provider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (provider === "gemini" && process.env.GEMINI_API_KEY) {
    return callGemini(system, dataMessage, userMessage);
  }
  if (provider === "nvidia" && process.env.NVIDIA_API_KEY) {
    return callNvidia(system, dataMessage, userMessage);
  }
  if (process.env.NVIDIA_API_KEY) return callNvidia(system, dataMessage, userMessage);
  if (process.env.GEMINI_API_KEY) return callGemini(system, dataMessage, userMessage);
  return null;
}
