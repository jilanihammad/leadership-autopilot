import type { GL, MetricData, Mover, Alert, WindEntry, Freshness } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3456";

const DEFAULT_METRICS: MetricData[] = [
  { name: "gms", label: "GMS", value: "—", wow: 0, yoy: 0, sparkline: [0] },
  { name: "units", label: "Units", value: "—", wow: 0, yoy: 0, sparkline: [0] },
  { name: "asp", label: "ASP", value: "—", wow: 0, yoy: 0, sparkline: [0] },
  { name: "nppm", label: "Net PPM", value: "—", wow: 0, yoy: 0, sparkline: [0] },
  { name: "cm", label: "CM", value: "—", wow: 0, yoy: 0, sparkline: [0] },
];

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
      // Start with defaults; real metrics loaded via fetchMetrics
      metrics: DEFAULT_METRICS,
    }));
  } catch (error) {
    console.error("fetchGLs error:", error);
    return [];
  }
}

export async function fetchMetrics(week: string, gl: string): Promise<MetricData[]> {
  try {
    const res = await fetch(`${API_BASE}/api/metrics/${week}/${gl}`);
    if (!res.ok) throw new Error("Failed to fetch metrics");
    const data = await res.json();
    return data.metrics || DEFAULT_METRICS;
  } catch (error) {
    console.error("fetchMetrics error:", error);
    return DEFAULT_METRICS;
  }
}

export async function fetchMovers(week: string, gl: string, metric = "GMS"): Promise<Mover[]> {
  try {
    const res = await fetch(`${API_BASE}/api/movers/${week}/${gl}?metric=${metric}&limit=5`);
    if (!res.ok) throw new Error("Failed to fetch movers");
    const data = await res.json();
    return data.movers || [];
  } catch (error) {
    console.error("fetchMovers error:", error);
    return [];
  }
}

export interface WindsData {
  tailwinds: WindEntry[];
  headwinds: WindEntry[];
}

export async function fetchAlerts(week: string, gl: string): Promise<WindsData> {
  try {
    const res = await fetch(`${API_BASE}/api/alerts/${week}/${gl}`);
    if (!res.ok) throw new Error("Failed to fetch alerts");
    const data = await res.json();
    return {
      tailwinds: data.tailwinds || [],
      headwinds: data.headwinds || [],
    };
  } catch (error) {
    console.error("fetchAlerts error:", error);
    return { tailwinds: [], headwinds: [] };
  }
}

export interface TrendPoint {
  week: string;
  value: string;
  rawValue: number | null;
  wow: number;
  wowUnit: string;
  yoy: number;
  yoyUnit: string;
  computedWow?: number;
}

export interface TrendsData {
  gl: string;
  weeks: string[];
  trends: Record<string, TrendPoint[]>;
}

export async function fetchTrends(gl: string): Promise<TrendsData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/trends/${gl}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchFreshness(week: string): Promise<Freshness | null> {
  try {
    const res = await fetch(`${API_BASE}/api/freshness/${week}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function exportSession(sessionId: string): Promise<{ markdown: string; gl: string; week: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/export`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateBridge(sessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/bridge`, {
      method: "POST",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.bridge || null;
  } catch {
    return null;
  }
}

export async function saveSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/save`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface FormatPreset {
  name: string;
  template: string;
  updatedAt: string;
}

export async function fetchFormats(): Promise<FormatPreset[]> {
  try {
    const res = await fetch(`${API_BASE}/api/formats`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.formats || [];
  } catch {
    return [];
  }
}

export async function saveFormat(name: string, template: string): Promise<FormatPreset | null> {
  try {
    const res = await fetch(`${API_BASE}/api/formats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, template }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.format;
  } catch {
    return null;
  }
}

export async function deleteFormat(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/formats/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
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
  gl: string,
  formatTemplate?: string
): AsyncGenerator<{ type: string; text?: string; gl?: string; week?: string; error?: string }> {
  try {
    const body: Record<string, string> = { question, sessionId, week, gl };
    if (formatTemplate?.trim()) body.formatTemplate = formatTemplate.trim();
    
    const res = await fetch(`${API_BASE}/api/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
