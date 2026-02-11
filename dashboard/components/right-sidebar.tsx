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
import { fetchMovers, fetchAlerts, fetchFreshness } from "@/lib/api";
import type { Mover, Alert, Freshness } from "@/lib/types";

export function RightSidebar() {
  const { selectedGL, selectedWeek, rightSidebarOpen } = useDashboard();
  const [movers, setMovers] = useState<Mover[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  useEffect(() => {
    if (!selectedWeek || !selectedGL) return;
    fetchMovers(selectedWeek, selectedGL).then(setMovers);
    fetchAlerts(selectedWeek, selectedGL).then(setAlerts);
    fetchFreshness(selectedWeek).then(setFreshness);
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
                {selectedGL === "ALL" ? "All Categories" : selectedGL}
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
            {freshness?.fresh ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-xs text-success">{freshness.label}</span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                <span className="text-xs text-muted-foreground">No data</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Top 5 Movers */}
      <div className="px-4 py-4 border-b border-border">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Top 5 Movers (GMS CTC)
        </h3>
        <div className="flex flex-col gap-2">
          {movers.length === 0 && (
            <span className="text-xs text-muted-foreground">No data available</span>
          )}
          {movers.map((mover, index) => (
            <div
              key={mover.code}
              className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/30 transition-colors group"
            >
              <span className="text-xs text-muted-foreground font-mono mt-0.5 w-4 shrink-0">
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {mover.name}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {mover.code}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mover.direction === "up" ? (
                  <TrendingUp className="w-3 h-3 text-success" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-destructive" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium font-mono",
                    mover.direction === "up" ? "text-success" : "text-destructive"
                  )}
                >
                  {mover.ctc > 0 ? "+" : ""}
                  {mover.ctc} bps
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
          {alerts.length === 0 && (
            <span className="text-xs text-muted-foreground">No alerts</span>
          )}
          {alerts.map((alert, idx) => (
            <div
              key={`${alert.subcat}-${idx}`}
              className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-lg border",
                alert.severity === "high"
                  ? "bg-destructive/5 border-destructive/20"
                  : "bg-chart-4/5 border-chart-4/20"
              )}
            >
              {alert.severity === "high" ? (
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
