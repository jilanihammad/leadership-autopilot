"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ChatMessage, GL, MetricData } from "./types";
import { streamAsk, fetchWeeks, fetchGLs, fetchMetrics, fetchTrends } from "./api";

interface DashboardState {
  selectedWeek: string;
  selectedGL: string;
  weeks: string[];
  gls: GL[];
  metrics: MetricData[];
  messages: ChatMessage[];
  sessionId: string;
  isStreaming: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  isLoading: boolean;
  formatTemplate: string;
}

interface DashboardContextType extends DashboardState {
  setSelectedWeek: (week: string) => void;
  setSelectedGL: (gl: string) => void;
  setFormatTemplate: (template: string) => void;
  setWeeks: (weeks: string[]) => void;
  setGLs: (gls: GL[]) => void;
  setMetrics: (metrics: MetricData[]) => void;
  sendMessage: (question: string) => Promise<void>;
  resetChat: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>({
    selectedWeek: "",
    selectedGL: "",
    weeks: [],
    gls: [],
    metrics: [],
    messages: [],
    sessionId: generateId(),
    isStreaming: false,
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    isLoading: true,
    formatTemplate: "",
  });

  // Initialize: fetch weeks, then GLs, then real metrics for the first GL
  useEffect(() => {
    async function init() {
      try {
        const weeks = await fetchWeeks();
        if (weeks.length === 0) {
          setState((s) => ({ ...s, isLoading: false }));
          return;
        }

        const firstWeek = weeks[0];
        const gls = await fetchGLs(firstWeek);
        const firstGL = gls[0]?.name || "";

        // Fetch real metric totals + trend sparklines
        let metrics = firstGL
          ? await fetchMetrics(firstWeek, firstGL)
          : [];

        // Merge trend sparklines
        if (firstGL) {
          const trends = await fetchTrends(firstGL);
          if (trends) {
            metrics = metrics.map(m => {
              const trendSeries = trends.trends[m.name];
              if (trendSeries && trendSeries.length > 0) {
                return { ...m, sparkline: trendSeries.map(t => t.rawValue ?? 0) };
              }
              return m;
            });
          }
        }

        setState((s) => ({
          ...s,
          weeks,
          gls,
          selectedWeek: firstWeek,
          selectedGL: firstGL,
          metrics,
          isLoading: false,
        }));
      } catch (error) {
        console.error("Init error:", error);
        setState((s) => ({ ...s, isLoading: false }));
      }
    }
    init();
  }, []);

  const setSelectedWeek = useCallback(async (week: string) => {
    setState((s) => ({ ...s, selectedWeek: week, isLoading: true }));

    try {
      const gls = await fetchGLs(week);
      // Determine which GL to select
      const currentGL = state.selectedGL;
      const currentGLExists = gls.some((g) => g.name === currentGL);
      const newGL = currentGLExists ? currentGL : gls[0]?.name || "";

      // Fetch real metrics + trends for the selected GL
      let metrics = newGL ? await fetchMetrics(week, newGL) : [];

      if (newGL) {
        const trends = await fetchTrends(newGL);
        if (trends) {
          metrics = metrics.map(m => {
            const trendSeries = trends.trends[m.name];
            if (trendSeries && trendSeries.length > 0) {
              return { ...m, sparkline: trendSeries.map(t => t.rawValue ?? 0) };
            }
            return m;
          });
        }
      }

      setState((s) => ({
        ...s,
        gls,
        selectedGL: newGL,
        metrics,
        isLoading: false,
      }));
    } catch (error) {
      console.error("setSelectedWeek error:", error);
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [state.selectedGL]);

  const setSelectedGL = useCallback(async (gl: string) => {
    setState((s) => ({ ...s, selectedGL: gl, isLoading: true }));

    try {
      let metrics = await fetchMetrics(state.selectedWeek, gl);

      // Merge trend sparklines
      const trends = await fetchTrends(gl);
      if (trends) {
        metrics = metrics.map(m => {
          const trendSeries = trends.trends[m.name];
          if (trendSeries && trendSeries.length > 0) {
            return { ...m, sparkline: trendSeries.map(t => t.rawValue ?? 0) };
          }
          return m;
        });
      }

      setState((s) => ({
        ...s,
        selectedGL: gl,
        metrics,
        isLoading: false,
      }));
    } catch (error) {
      console.error("setSelectedGL error:", error);
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [state.selectedWeek]);

  const setWeeks = useCallback((weeks: string[]) => {
    setState((s) => ({ ...s, weeks }));
  }, []);

  const setGLs = useCallback((gls: GL[]) => {
    setState((s) => {
      const selectedGLData = gls.find((g) => g.name === s.selectedGL);
      return {
        ...s,
        gls,
        metrics: selectedGLData?.metrics || gls[0]?.metrics || [],
      };
    });
  }, []);

  const setMetrics = useCallback((metrics: MetricData[]) => {
    setState((s) => ({ ...s, metrics }));
  }, []);

  // Ref for batching SSE content chunks — accumulates text between rAF flushes
  const streamBufferRef = useRef("");
  const rafIdRef = useRef<number | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: question,
        timestamp: new Date(),
      };

      const assistantId = generateId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      };

      setState((s) => ({
        ...s,
        messages: [...s.messages, userMsg, assistantMsg],
        isStreaming: true,
      }));

      let fullContent = "";
      streamBufferRef.current = "";

      // Flush buffered content to state on animation frame
      const scheduleFlush = () => {
        if (rafIdRef.current !== null) return; // already scheduled
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const buffered = streamBufferRef.current;
          if (buffered) {
            streamBufferRef.current = "";
            fullContent += buffered;
            const snapshot = fullContent;
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: snapshot } : m
              ),
            }));
          }
        });
      };

      try {
        for await (const event of streamAsk(
          question,
          state.sessionId,
          state.selectedWeek,
          state.selectedGL,
          state.formatTemplate
        )) {
          if (event.type === "status" && event.text) {
            // Two-pass status updates (Analyzing... / Formatting...)
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: `*${event.text}*` } : m
              ),
            }));
          } else if (event.type === "content" && event.text) {
            // On first content after a status, clear the status message
            if (fullContent === "" && streamBufferRef.current === "") {
              setState((s) => ({
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: "" } : m
                ),
              }));
            }
            // Accumulate in buffer, flush on next animation frame
            streamBufferRef.current += event.text;
            scheduleFlush();
          } else if (event.type === "error") {
            fullContent = `Error: ${event.error || "Something went wrong"}`;
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: fullContent, isStreaming: false } : m
              ),
              isStreaming: false,
            }));
            return;
          } else if (event.type === "done") {
            // Stream complete
          }
        }
      } catch (error) {
        console.error("sendMessage error:", error);
        fullContent = `Error: ${error instanceof Error ? error.message : "Connection failed"}`;
      }

      // Cancel any pending rAF and flush remaining buffer
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (streamBufferRef.current) {
        fullContent += streamBufferRef.current;
        streamBufferRef.current = "";
      }

      // Ensure streaming is stopped
      setState((s) => ({
        ...s,
        isStreaming: false,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false, content: fullContent } : m
        ),
      }));
    },
    [state.sessionId, state.selectedWeek, state.selectedGL, state.formatTemplate]
  );

  const setFormatTemplate = useCallback((template: string) => {
    setState((s) => ({ ...s, formatTemplate: template }));
  }, []);

  const resetChat = useCallback(() => {
    setState((s) => ({
      ...s,
      messages: [],
      sessionId: generateId(),
    }));
  }, []);

  const toggleLeftSidebar = useCallback(() => {
    setState((s) => ({ ...s, leftSidebarOpen: !s.leftSidebarOpen }));
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setState((s) => ({ ...s, rightSidebarOpen: !s.rightSidebarOpen }));
  }, []);

  return (
    <DashboardContext.Provider
      value={{
        ...state,
        setSelectedWeek,
        setSelectedGL,
        setWeeks,
        setGLs,
        setMetrics,
        sendMessage,
        resetChat,
        toggleLeftSidebar,
        toggleRightSidebar,
        setFormatTemplate,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
