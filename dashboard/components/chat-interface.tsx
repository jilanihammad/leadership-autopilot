"use client";

import React from "react"

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Download, FileText, Save, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/dashboard-context";
import { ChatMessageComponent } from "./chat-message";
import { Button } from "@/components/ui/button";
import { exportSession, generateBridge, saveSession } from "@/lib/api";
import ReactMarkdown from "react-markdown";

const QUICK_ACTIONS = [
  "Why did GMS grow?",
  "Top movers",
  "Margin deep dive",
  "Compare to last week",
  "Risk factors",
];

export function ChatInterface() {
  const { messages, sendMessage, isStreaming, selectedGL, selectedWeek, sessionId } =
    useDashboard();
  const [input, setInput] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [bridgeContent, setBridgeContent] = useState<string | null>(null);
  const [isBridgeLoading, setIsBridgeLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (question?: string) => {
    const q = question || input.trim();
    if (!q || isStreaming) return;
    setInput("");
    await sendMessage(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                />
              </svg>
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-base font-medium text-foreground">
                Ask about your business metrics
              </h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Ask natural language questions about{" "}
                <span className="text-foreground font-medium">
                  {selectedGL.toUpperCase()}
                </span>{" "}
                performance for{" "}
                <span className="text-foreground font-medium">
                  {selectedWeek}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-w-3xl mx-auto">
            {messages.map((msg) => (
              <ChatMessageComponent key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick actions */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 justify-center">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => handleSubmit(action)}
              disabled={isStreaming}
              className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-card border border-border rounded-full hover:text-foreground hover:border-primary/30 hover:bg-card/80 transition-all duration-200 disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      {/* Export actions — shown when conversation has messages */}
      {messages.length > 0 && !isStreaming && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={async () => {
              const data = await exportSession(sessionId);
              if (data?.markdown) {
                await navigator.clipboard.writeText(data.markdown);
                setExportStatus("copied");
                setTimeout(() => setExportStatus(null), 2000);
              }
            }}
          >
            {exportStatus === "copied" ? <Check className="w-3 h-3" /> : <Download className="w-3 h-3" />}
            {exportStatus === "copied" ? "Copied to clipboard" : "Export markdown"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            disabled={isBridgeLoading}
            onClick={async () => {
              setIsBridgeLoading(true);
              setBridgeContent(null);
              const bridge = await generateBridge(sessionId);
              setBridgeContent(bridge);
              setIsBridgeLoading(false);
            }}
          >
            {isBridgeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Generate WBR bridge
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={async () => {
              const ok = await saveSession(sessionId);
              setExportStatus(ok ? "saved" : null);
              setTimeout(() => setExportStatus(null), 2000);
            }}
          >
            {exportStatus === "saved" ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {exportStatus === "saved" ? "Saved" : "Save session"}
          </Button>
        </div>
      )}

      {/* Bridge output */}
      {bridgeContent && (
        <div className="mx-4 mb-3 p-4 rounded-lg border border-primary/20 bg-primary/5 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-primary uppercase tracking-wider">WBR Bridge Document</h4>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(bridgeContent);
                  setExportStatus("copied");
                  setTimeout(() => setExportStatus(null), 2000);
                }}
              >
                <Download className="w-3 h-3 mr-1" />
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground"
                onClick={() => setBridgeContent(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
          <div className="prose prose-sm prose-invert max-w-none text-foreground/90 text-xs">
            <ReactMarkdown>{bridgeContent}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-4">
        <div className="relative max-w-3xl mx-auto">
          <div className="flex items-end gap-2 p-2 bg-card border border-border rounded-xl focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your business metrics..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-2 py-1.5 max-h-32 min-h-[36px] disabled:opacity-50"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <Button
              size="icon"
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isStreaming}
              className={cn(
                "h-8 w-8 rounded-lg shrink-0 transition-all duration-200",
                input.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground/50 mt-2">
            AI-generated analysis. Always verify critical business decisions with
            source data.
          </p>
        </div>
      </div>
    </div>
  );
}
