"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { ChatMessage, GL, MetricData } from "./types";
import { streamAsk, fetchWeeks, fetchGLs } from "./api";

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
}

interface DashboardContextType extends DashboardState {
  setSelectedWeek: (week: string) => void;
  setSelectedGL: (gl: string) => void;
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
  });

  // Initialize: fetch weeks, then GLs for the first week
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

        setState((s) => ({
          ...s,
          weeks,
          gls,
          selectedWeek: firstWeek,
          selectedGL: firstGL,
          metrics: gls[0]?.metrics || [],
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
      setState((s) => {
        // Try to keep the same GL if it exists in the new week
        const currentGLExists = gls.some((g) => g.name === s.selectedGL);
        const newGL = currentGLExists ? s.selectedGL : gls[0]?.name || "";
        const selectedGLData = gls.find((g) => g.name === newGL);
        
        return {
          ...s,
          gls,
          selectedGL: newGL,
          metrics: selectedGLData?.metrics || [],
          isLoading: false,
        };
      });
    } catch (error) {
      console.error("setSelectedWeek error:", error);
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  const setSelectedGL = useCallback((gl: string) => {
    setState((s) => {
      const selectedGLData = s.gls.find((g) => g.name === gl);
      return {
        ...s,
        selectedGL: gl,
        metrics: selectedGLData?.metrics || s.metrics,
      };
    });
  }, []);

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

      try {
        for await (const event of streamAsk(
          question,
          state.sessionId,
          state.selectedWeek,
          state.selectedGL
        )) {
          if (event.type === "content" && event.text) {
            fullContent += event.text;
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: fullContent } : m
              ),
            }));
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

      // Ensure streaming is stopped
      setState((s) => ({
        ...s,
        isStreaming: false,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false, content: fullContent } : m
        ),
      }));
    },
    [state.sessionId, state.selectedWeek, state.selectedGL]
  );

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
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
