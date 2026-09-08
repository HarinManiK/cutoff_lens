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
