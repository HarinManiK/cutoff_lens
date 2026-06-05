"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import type { CutoffResult, GenderFilter } from "@/lib/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AiCounsellorProps = {
  exam: "jee-advanced";
  rank: string;
  seatType: string;
  gender: GenderFilter;
  selectedInstitutes: string[];
  selectedPrograms: string[];
  selectedDegrees: string[];
  selectedDurations: string[];
  selectedProgramTypes: string[];
  tableSearch: string;
  matchingRows: CutoffResult[];
};

type AiChatResponse = {
  message?: string;
  error?: string;
  model?: string;
  citations?: Array<{
    url: string;
    title?: string;
  }>;
};

const promptChips = [
  "Best picks for my rank",
  "Best IITs I can get",
  "Best branches I can get",
  "Compare my options",
];

export function AiCounsellor({
  exam,
  rank,
  seatType,
  gender,
  selectedInstitutes,
  selectedPrograms,
  selectedDegrees,
  selectedDurations,
  selectedProgramTypes,
  tableSearch,
  matchingRows,
}: AiCounsellorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pageState = useMemo(
    () => ({
      rank,
      seatType,
      gender,
      selectedInstitutes,
      selectedPrograms,
      selectedDegrees,
      selectedDurations,
      selectedProgramTypes,
      tableSearch,
      visibleResultCount: matchingRows.length,
    }),
    [
      gender,
      matchingRows.length,
      rank,
      seatType,
      selectedDegrees,
      selectedDurations,
      selectedInstitutes,
      selectedProgramTypes,
      selectedPrograms,
      tableSearch,
    ],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!isOpen) {
        setBubbleVisible(true);
        window.setTimeout(() => setBubbleVisible(false), 5200);
      }
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage(nextContent: string) {
    const trimmed = nextContent.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setBubbleVisible(false);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam,
          pageState,
          messages: nextMessages,
        }),
      });
      const data = (await response.json().catch(() => null)) as AiChatResponse | null;
      const citations = data?.citations ?? [];
      const sourceText =
        citations.length > 0
          ? `\n\nSources:\n${citations
              .slice(0, 4)
              .map((citation) => `- ${citation.title ? `${citation.title}: ` : ""}${citation.url}`)
              .join("\n")}`
          : "";
      const message = `${data?.message ?? data?.error ?? "Sorry, can't fetch that info."}${sourceText}`;

      setMessages([...nextMessages, { role: "assistant", content: message }]);
    } catch {
      setMessages([...nextMessages, { role: "assistant", content: "Sorry, can't fetch that info." }]);
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <>
      {isOpen ? (
        <section className="ai-chat-panel" aria-label="AI counsellor">
          <div className="ai-chat-head">
            <div>
              <b>Cutoff Lens AI</b>
              <span>JEE Advanced</span>
            </div>
            <button className="ai-icon-button" type="button" aria-label="Close AI chat" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="ai-chat-messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="ai-empty">
                Ask about your current options, or enter rank/category directly here.
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div className={message.role === "user" ? "ai-message ai-message--user" : "ai-message"} key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ))}

            {loading ? (
              <div className="ai-message ai-message--loading">
                <Loader2 className="animate-spin" size={16} />
                Thinking
              </div>
            ) : null}
          </div>

          <div className="ai-prompt-row">
            {promptChips.map((prompt) => (
              <button className="ai-prompt-chip" key={prompt} type="button" onClick={() => sendMessage(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <form className="ai-chat-form" onSubmit={submit}>
            <input
              aria-label="Ask AI"
              placeholder="Ask AI"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="ai-send-button" type="submit" aria-label="Send AI message" disabled={loading || input.trim().length === 0}>
              <Send size={16} />
            </button>
          </form>
        </section>
      ) : null}

      <button
        className="ai-floating-button"
        type="button"
        aria-label="Open AI chat"
        onClick={() => {
          setIsOpen(true);
          setBubbleVisible(false);
        }}
      >
        {bubbleVisible ? <span className="ai-bubble">Ask AI</span> : null}
        <Bot size={22} />
      </button>
    </>
  );
}
