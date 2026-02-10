"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/lib/types";
import ReactMarkdown from "react-markdown";

function StreamingDot() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
    </span>
  );
}

// Parse WHAT/WHY sections from the response
function parseWhatWhy(content: string): { whatContent: string; whyContent: string } {
  // Try multiple formats:
  // 1. **WHAT:** ... **WHY:** ...
  // 2. **WHAT** ... **WHY** ...
  // 3. ||| delimiter (V0 mock format)
  
  // Check for ||| delimiter first (mock format)
  if (content.includes("|||")) {
    const parts = content.split("|||");
    return {
      whatContent: parts[0]?.trim() || content,
      whyContent: parts[1]?.trim() || "",
    };
  }
  
  // Check for **WHAT:**/**WHY:** format (real API)
  const whatWhyRegex = /\*\*WHAT:\*\*([\s\S]*?)\*\*WHY:\*\*([\s\S]*)/i;
  const match = content.match(whatWhyRegex);
  
  if (match) {
    return {
      whatContent: match[1]?.trim() || "",
      whyContent: match[2]?.trim() || "",
    };
  }
  
  // Check for **WHAT**/**WHY** format (without colons)
  const altRegex = /\*\*WHAT\*\*([\s\S]*?)\*\*WHY\*\*([\s\S]*)/i;
  const altMatch = content.match(altRegex);
  
  if (altMatch) {
    return {
      whatContent: altMatch[1]?.trim() || "",
      whyContent: altMatch[2]?.trim() || "",
    };
  }
  
  // No WHAT/WHY structure found - return all as whatContent
  return {
    whatContent: content,
    whyContent: "",
  };
}

// Common markdown components
const markdownComponents = {
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-border">
      <table className="w-full text-xs" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-muted/50" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td
      className="px-3 py-2 text-xs text-foreground/80 border-b border-border/50"
      {...props}
    >
      {children}
    </td>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-sm leading-relaxed mb-2 text-foreground/90" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="text-foreground font-semibold" {...props}>
      {children}
    </strong>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-none space-y-1.5 my-2" {...props}>
      {children}
    </ul>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li
      className="text-sm text-foreground/90 flex items-start gap-2 before:content-[''] before:w-1 before:h-1 before:rounded-full before:bg-primary before:mt-2 before:shrink-0"
      {...props}
    >
      <span>{children}</span>
    </li>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-base font-semibold text-foreground mt-4 mb-2" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-sm font-semibold text-foreground mt-3 mb-1.5" {...props}>
      {children}
    </h3>
  ),
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic" {...props}>
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-muted/50 rounded-lg p-3 overflow-x-auto my-2 text-xs" {...props}>
      {children}
    </pre>
  ),
};

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessageComponent({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end py-2">
        <div className="flex items-start gap-3 max-w-[80%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-tr-md bg-primary text-primary-foreground text-sm leading-relaxed">
            {message.content}
          </div>
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted shrink-0 mt-0.5">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  // Parse WHAT/WHY sections
  const { whatContent, whyContent } = parseWhatWhy(message.content);

  return (
    <div className="flex py-2">
      <div className="flex items-start gap-3 max-w-[85%]">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="prose prose-sm prose-invert max-w-none text-foreground/90">
            <ReactMarkdown components={markdownComponents}>
              {whatContent}
            </ReactMarkdown>
          </div>

          {/* Collapsible WHY section */}
          {whyContent && !message.isStreaming && (
            <div className="border border-border rounded-lg overflow-hidden mt-1">
              <button
                type="button"
                onClick={() => setWhyOpen(!whyOpen)}
                className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                <span>Deep Dive Analysis</span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200",
                    whyOpen && "rotate-180"
                  )}
                />
              </button>
              <div
                className={cn(
                  "overflow-hidden transition-all duration-300 ease-in-out",
                  whyOpen ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
                )}
              >
                <div className="px-3 py-3 border-t border-border/50 prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown components={markdownComponents}>
                    {whyContent}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {message.isStreaming && <StreamingDot />}

          {/* Actions */}
          {!message.isStreaming && message.content && (
            <div className="flex items-center gap-1 mt-1">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
