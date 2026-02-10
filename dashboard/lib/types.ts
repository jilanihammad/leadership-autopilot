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
  asin: string;
  title: string;
  change: number;
  metric: string;
  value: string;
}

export interface Alert {
  id: string;
  severity: "warning" | "critical";
  message: string;
  metric: string;
}

export interface SessionState {
  currentGL: string;
  currentWeek: string;
  historyLength: number;
}
