import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, type OpenRouterMessage } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

type AiChatRequest = {
  messages?: OpenRouterMessage[];
};

function sanitizeMessages(messages: OpenRouterMessage[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 5000),
    }))
    .filter((message) => message.content.trim().length > 0)
    .slice(-12);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AiChatRequest | null;
  const messages = sanitizeMessages(body?.messages ?? []);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content.trim();

  if (!lastUserMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  try {
    const result = await callOpenRouter({ messages });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.message,
          message: result.status === 503 ? "AI is not configured yet." : "AI failed to respond.",
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      message: result.answer,
      model: result.model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to answer.",
        message: "AI failed to respond.",
      },
      { status: 500 },
    );
  }
}
