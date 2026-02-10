import type { GL, MetricData, Mover, Alert } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3456";

// Default metrics when real data not available
const DEFAULT_METRICS: MetricData[] = [
  {
    name: "gms",
    label: "GMS",
    value: "—",
    wow: 0,
    yoy: 0,
    sparkline: [0, 0, 0, 0],
  },
  {
    name: "units",
    label: "Units",
    value: "—",
    wow: 0,
    yoy: 0,
    sparkline: [0, 0, 0, 0],
  },
  {
    name: "asp",
    label: "ASP",
    value: "—",
    wow: 0,
    yoy: 0,
    sparkline: [0, 0, 0, 0],
  },
  {
    name: "nppm",
    label: "NPPM",
    value: "—",
    wow: 0,
    yoy: 0,
    sparkline: [0, 0, 0, 0],
  },
  {
    name: "cm",
    label: "CM",
    value: "—",
    wow: 0,
    yoy: 0,
    sparkline: [0, 0, 0, 0],
  },
];

// Placeholder movers (will be populated by asking the AI)
const PLACEHOLDER_MOVERS: Mover[] = [
  {
    asin: "—",
    title: "Ask AI for top movers",
    change: 0,
    metric: "GMS",
    value: "—",
  },
];

// Placeholder alerts
const PLACEHOLDER_ALERTS: Alert[] = [];

export async function fetchWeeks(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/api/weeks`);
    if (!res.ok) throw new Error("Failed to fetch weeks");
    const data = await res.json();
    return data.weeks || [];
  } catch (error) {
    console.error("fetchWeeks error:", error);
    return [];
  }
}

export async function fetchGLs(week: string): Promise<GL[]> {
  try {
    const res = await fetch(`${API_BASE}/api/gls/${week}`);
    if (!res.ok) throw new Error("Failed to fetch GLs");
    const data = await res.json();
    
    // Transform API response to our GL type
    // API returns: { gls: [{ name: "pc", metrics: ["GMS", "ShippedUnits", ...] }] }
    // We need: { name, label, metrics: MetricData[] }
    return (data.gls || []).map((gl: { name: string; metrics: string[] }) => ({
      name: gl.name,
      label: gl.name.toUpperCase(),
      // Use default metrics structure - actual values would need a separate endpoint
      metrics: DEFAULT_METRICS.map((m) => ({
        ...m,
        // Mark as available if the GL has this metric
        available: gl.metrics?.some(
          (metric) => metric.toLowerCase().includes(m.name.toLowerCase())
        ),
      })),
    }));
  } catch (error) {
    console.error("fetchGLs error:", error);
    return [];
  }
}

export async function fetchMovers(): Promise<Mover[]> {
  // TODO: Add backend endpoint for top movers
  return PLACEHOLDER_MOVERS;
}

export async function fetchAlerts(): Promise<Alert[]> {
  // TODO: Add backend endpoint for alerts
  return PLACEHOLDER_ALERTS;
}

export async function resetSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/session/${sessionId}/reset`, {
      method: "POST",
    });
  } catch (error) {
    console.error("resetSession error:", error);
  }
}

export async function* streamAsk(
  question: string,
  sessionId: string,
  week: string,
  gl: string
): AsyncGenerator<{ type: string; text?: string; gl?: string; week?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, sessionId, week, gl }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      yield { type: "error", error: errorText || "Request failed" };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: "error", error: "No response stream" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith("data: ")) {
      try {
        const data = JSON.parse(buffer.slice(6));
        yield data;
      } catch {
        // Skip
      }
    }
  } catch (error) {
    console.error("streamAsk error:", error);
    yield { 
      type: "error", 
      error: error instanceof Error ? error.message : "Connection failed" 
    };
  }
}
