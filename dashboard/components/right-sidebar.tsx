"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  Clock,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/dashboard-context";
import { fetchMovers, fetchAlerts } from "@/lib/api";
import type { Mover, Alert } from "@/lib/types";

export function RightSidebar() {
  const { selectedGL, selectedWeek, rightSidebarOpen } = useDashboard();
  const [movers, setMovers] = useState<Mover[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetchMovers().then(setMovers);
    fetchAlerts().then(setAlerts);
  }, [selectedGL, selectedWeek]);

  return (
    <aside
      className={cn(
        "flex flex-col border-l border-border bg-sidebar h-full transition-all duration-300 ease-in-out overflow-y-auto scrollbar-thin",
        rightSidebarOpen ? "w-80" : "w-0 overflow-hidden border-l-0"
      )}
    >
      {/* Context Panel */}
      <div className="px-4 py-4 border-b border-border">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Context
        </h3>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <Database className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Category</span>
              <span className="text-sm font-medium text-foreground">
                {selectedGL.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                Data Freshness
              </span>
              <span className="text-sm font-medium text-foreground">
                {selectedWeek}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-success">Live - Updated 2h ago</span>
          </div>
        </div>
      </div>

      {/* Top 5 Movers */}
      <div className="px-4 py-4 border-b border-border">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Top 5 Movers
        </h3>
        <div className="flex flex-col gap-2">
          {movers.map((mover, index) => (
            <div
              key={mover.asin}
              className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/30 transition-colors group"
            >
              <span className="text-xs text-muted-foreground font-mono mt-0.5 w-4 shrink-0">
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {mover.title}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {mover.asin}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {mover.metric}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mover.change >= 0 ? (
                  <TrendingUp className="w-3 h-3 text-success" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-destructive" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium font-mono",
                    mover.change >= 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {mover.change >= 0 ? "+" : ""}
                  {mover.change}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div className="px-4 py-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Alerts
        </h3>
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-lg border",
                alert.severity === "critical"
                  ? "bg-destructive/5 border-destructive/20"
                  : "bg-chart-4/5 border-chart-4/20"
              )}
            >
              {alert.severity === "critical" ? (
                <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-chart-4 shrink-0 mt-0.5" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-foreground leading-snug">
                  {alert.message}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {alert.metric}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
