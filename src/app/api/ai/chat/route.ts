import { NextRequest, NextResponse } from "next/server";
import {
  buildJeeAdvancedContext,
  buildJeeAdvancedDataMessage,
  buildJeeAdvancedSystemPrompt,
  buildDatabaseOnlyJeeAdvancedAnswer,
  isAllowedJeeAdvancedQuery,
  shouldUseOfficialWebSearch,
  type AiChatMessage,
  type JeeAdvancedPageState,
} from "@/lib/ai/jee-advanced";
import { callOpenRouter } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

type AiChatRequest = {
  exam?: string;
  messages?: AiChatMessage[];
  pageState?: JeeAdvancedPageState;
};

function sanitizeMessages(messages: AiChatMessage[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 3000),
    }))
    .filter((message) => message.content.trim().length > 0)
    .slice(-8);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AiChatRequest | null;
  const exam = body?.exam ?? "jee-advanced";
  const messages = sanitizeMessages(body?.messages ?? []);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content.trim();

  if (exam !== "jee-advanced") {
    return NextResponse.json({ message: "Sorry, can't fetch that info." });
  }

  if (!lastUserMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (!isAllowedJeeAdvancedQuery(lastUserMessage)) {
    return NextResponse.json({ message: "Sorry, can't fetch that info." });
  }

  try {
    const pageState = body?.pageState ?? {};
    const context = await buildJeeAdvancedContext(lastUserMessage, pageState);
    const useOfficialWebSearch = shouldUseOfficialWebSearch(lastUserMessage);
    const result = await callOpenRouter({
      useOfficialWebSearch,
      messages: [
        {
          role: "system",
          content: buildJeeAdvancedSystemPrompt(context, useOfficialWebSearch),
        },
        {
          role: "user",
          content: buildJeeAdvancedDataMessage(context),
        },
        ...messages,
      ],
    });

    if (!result.ok) {
      if (!useOfficialWebSearch) {
        return NextResponse.json({
          message: buildDatabaseOnlyJeeAdvancedAnswer(context),
          model: "database-only-fallback",
          citations: [],
          context: {
            rank: context.rank,
            seatType: context.seatType,
            gender: context.gender,
            totalMatchingRows: context.totalMatchingRows,
            includedRows: context.includedRows.length,
            usedOfficialWebSearch: false,
            fallbackReason: result.message,
          },
        });
      }

      return NextResponse.json(
        {
          error: result.message,
          message:
            result.status === 503
              ? "AI is not configured yet."
              : "Sorry, can't fetch that info.",
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      message: result.answer,
      model: result.model,
      citations: result.citations,
      context: {
        rank: context.rank,
        seatType: context.seatType,
        gender: context.gender,
        totalMatchingRows: context.totalMatchingRows,
        includedRows: context.includedRows.length,
        usedOfficialWebSearch: useOfficialWebSearch,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to answer.",
        message: "Sorry, can't fetch that info.",
      },
      { status: 500 },
    );
  }
}
