"use client";

import { useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import type { PageState } from "@/lib/ai/jee-advanced-context";

type Citation = {
  ref: number;
  institute: string;
  topic: string;
  claim: string;
  url: string;
  title: string;
  publisher: string;
  publishedAy: string;
  coverage: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string; citations?: Citation[] };

export function AiChatbot({ pageState }: { pageState: PageState }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: "jee-advanced",
          messages: next.map(({ role, content }) => ({ role, content })),
          pageState,
        }),
      });
      const body = (await response.json()) as { message?: string; citations?: Citation[] };
      setMessages([...next, { role: "assistant", content: body.message ?? "Sorry, can't fetch that info.", citations: body.citations ?? [] }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Sorry, can't fetch that info." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close AI counsellor" : "Open AI counsellor"}
        className="ai-chat-fab"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
      {open ? (
        <section className="ai-chat-panel" aria-label="AI counsellor">
          <header className="ai-chat-head">
            <div>
              <b>Cutoff Lens AI</b>
              <span>Grounded in JoSAA data + verified sources. A better guess, not a prediction.</span>
            </div>
          </header>
          <div className="ai-chat-messages">
            {messages.length === 0 ? (
              <div className="ai-chat-empty">Ask e.g. “SC 2807, what are my best IIT options in 2025 R5?” or “IIT Guwahati CSE placements vs fees?”</div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ai-msg ai-msg--user" : "ai-msg ai-msg--ai"}>
                <p>{m.content}</p>
                {m.citations && m.citations.length > 0 ? (
                  <div className="ai-citations">
                    {m.citations.slice(0, 6).map((c) => (
                      <a key={c.ref} href={c.url} target="_blank" rel="noreferrer" className="ai-cite-chip" title={`${c.claim} (${c.coverage})`}>
                        [{c.ref}] {c.institute} · {c.topic}{c.publishedAy ? ` · ${c.publishedAy}` : ""} · {c.coverage}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {loading ? <div className="ai-msg ai-msg--ai"><p>Thinking…</p></div> : null}
          </div>
          <div className="ai-chat-input">
            <input
              placeholder="Ask about ranks, branches, placements, fees…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button type="button" aria-label="Send" onClick={send} disabled={loading}>
              <Send size={16} />
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
