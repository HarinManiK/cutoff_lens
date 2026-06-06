"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AiChatResponse = {
  message?: string;
  error?: string;
  model?: string;
};

export function AiCounsellor() {
  const [isOpen, setIsOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = (await response.json().catch(() => null)) as AiChatResponse | null;
      const message = data?.message ?? data?.error ?? "AI failed to respond.";

      setMessages([...nextMessages, { role: "assistant", content: message }]);
    } catch {
      setMessages([...nextMessages, { role: "assistant", content: "AI failed to respond." }]);
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
        <section className="ai-chat-panel" aria-label="AI chat">
          <div className="ai-chat-head">
            <div>
              <b>Cutoff Lens AI</b>
              <span>Chat</span>
            </div>
            <button className="ai-icon-button" type="button" aria-label="Close AI chat" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="ai-chat-messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="ai-empty-state">
                <p>Ask anything.</p>
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
