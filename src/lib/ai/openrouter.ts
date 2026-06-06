type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      annotations?: Array<{
        type?: string;
        url_citation?: {
          url?: string;
          title?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export const openRouterCounsellorModels = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "moonshotai/kimi-k2.6:free",
  "z-ai/glm-4.5-air:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "openai/gpt-oss-20b:free",
  "poolside/laguna-m.1:free",
  "poolside/laguna-xs.2:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
];

export const officialJeeAdvancedDomains = [
  "josaa.nic.in",
  "jeeadv.ac.in",
  "education.gov.in",
  "iitsystem.ac.in",
  "nirfindia.org",
  "aicte-india.org",
  "ugc.gov.in",
  "nbaind.org",
  "aishe.gov.in",
  "data.gov.in",
  "swayam.gov.in",
  "nptel.ac.in",
  "iitb.ac.in",
  "iitd.ac.in",
  "iitm.ac.in",
  "iitk.ac.in",
  "iitkgp.ac.in",
  "iitr.ac.in",
  "iitg.ac.in",
  "iith.ac.in",
  "iiti.ac.in",
  "iitbhu.ac.in",
  "iitism.ac.in",
  "iitbbs.ac.in",
  "iitgn.ac.in",
  "iitj.ac.in",
  "iitp.ac.in",
  "iitmandi.ac.in",
  "iitrpr.ac.in",
  "iitpkd.ac.in",
  "iittp.ac.in",
  "iitjammu.ac.in",
  "iitdh.ac.in",
  "iitbhilai.ac.in",
  "iitgoa.ac.in",
  "iitdabudhabi.ac.ae",
];

export function getCounsellorModels() {
  return (process.env.OPENROUTER_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model) => model !== "openai/gpt-oss-120b:free")
    .concat(openRouterCounsellorModels)
    .filter((model, index, models) => models.indexOf(model) === index);
}

export async function callOpenRouter({
  messages,
  useOfficialWebSearch,
}: {
  messages: OpenRouterMessage[];
  useOfficialWebSearch: boolean;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      ok: false as const,
      status: 503,
      message: "AI is not configured yet. Add OPENROUTER_API_KEY in the server environment.",
    };
  }

  const allModels = getCounsellorModels();
  let lastError = { ok: false as const, status: 500, message: "No AI models are configured." };

  for (let index = 0; index < allModels.length; index += 3) {
    const modelBatch = allModels.slice(index, index + 3);

    const body = {
      models: modelBatch,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
      provider: {
        allow_fallbacks: true,
        require_parameters: true,
        sort: {
          by: "throughput",
          partition: "model",
        },
      },
      tools: useOfficialWebSearch
        ? [
            {
              type: "openrouter:web_search",
              parameters: {
                engine: "exa",
                max_results: 5,
                max_total_results: 10,
                search_context_size: "medium",
                allowed_domains: officialJeeAdvancedDomains,
              },
            },
          ]
        : undefined,
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Cutoff Lens",
        ...(process.env.NEXT_PUBLIC_SITE_URL ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json().catch(() => null)) as OpenRouterResponse | null;

    if (!response.ok) {
      lastError = {
        ok: false as const,
        status: response.status,
        message: data?.error?.message ?? "AI request failed.",
      };

      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        return lastError;
      }

      continue;
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      lastError = {
        ok: false as const,
        status: 502,
        message: "AI returned an empty answer.",
      };

      continue;
    }

    const citations =
      data?.choices?.[0]?.message?.annotations
        ?.map((annotation) => annotation.url_citation)
        .filter((citation): citation is { url: string; title?: string } => Boolean(citation?.url)) ?? [];

    return {
      ok: true as const,
      answer,
      model: data?.model ?? "unknown",
      citations,
    };
  }

  return lastError;
}
