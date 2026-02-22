export interface MetricData {
  name: string;
  label: string;
  value: string;
  wow: number;
  yoy: number;
  sparkline: number[];
  wowUnit?: string;  // "%" or "bps"
  yoyUnit?: string;  // "%" or "bps"
  available?: boolean;
}

export interface GL {
  name: string;
  label: string;
  metrics: MetricData[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface Mover {
  name: string;
  code: string;
  value: number;
  ctc: number;
  yoy_pct: number;
  direction: "up" | "down";
  metric: string;
  ctcUnit: string;
}

export interface WindEntry {
  subcat: string;
  subcatCode: string;
  metric: string;
  metricKey: string;
  ctc: number;
  unit: string;
  magnitude: "high" | "medium";
}

// Legacy Alert type kept for compatibility
export interface Alert {
  severity: "high" | "medium";
  message: string;
  metric: string;
  subcat: string;
}

export interface Freshness {
  fresh: boolean;
  updatedAt: string;
  ageMinutes: number;
  label: string;
  week: string;
}

export interface SessionState {
  currentGL: string;
  currentWeek: string;
  historyLength: number;
}
