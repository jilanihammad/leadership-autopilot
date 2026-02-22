"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Database,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/dashboard-context";
import { fetchMovers, fetchAlerts, fetchFreshness } from "@/lib/api";
import type { WindsData } from "@/lib/api";
import type { Mover, Freshness } from "@/lib/types";

function formatValue(value: number, metric: string): string {
  if (!value && value !== 0) return "\u2014";
  if (metric === "GMS") return `$${(value / 1000).toFixed(0)}K`;
  if (metric === "ShippedUnits") return `${(value / 1000).toFixed(1)}K`;
  if (metric === "ASP") return `$${value.toFixed(2)}`;
  return value.toFixed(1);
}

export function RightSidebar() {
  const { selectedGL, selectedWeek, rightSidebarOpen } = useDashboard();
  const [movers, setMovers] = useState<Mover[]>([]);
  const [winds, setWinds] = useState<WindsData>({ tailwinds: [], headwinds: [] });
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  useEffect(() => {
    if (!selectedWeek || !selectedGL) return;
    fetchMovers(selectedWeek, selectedGL).then(setMovers);
    fetchAlerts(selectedWeek, selectedGL).then(setWinds);
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
          Top Movers &mdash; GMS CTC YoY
        </h3>
        <div className="flex flex-col gap-1.5">
          {movers.length === 0 && (
            <span className="text-xs text-muted-foreground">No data available</span>
          )}
          {movers.map((mover, index) => (
            <div
              key={mover.code}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">
                {index + 1}
              </span>
              <div className="flex flex-col gap-0 flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {mover.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatValue(mover.value, mover.metric)}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mover.direction === "up" ? (
                  <ArrowUpRight className="w-3 h-3 text-success" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-destructive" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium font-mono",
                    mover.direction === "up" ? "text-success" : "text-destructive"
                  )}
                >
                  {mover.ctc > 0 ? "+" : ""}
                  {mover.ctc} {mover.ctcUnit}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tailwinds */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="w-3.5 h-3.5 text-success" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tailwinds
          </h3>
        </div>
        <div className="flex flex-col gap-1.5">
          {winds.tailwinds.length === 0 && (
            <span className="text-xs text-muted-foreground">None</span>
          )}
          {winds.tailwinds.map((entry, idx) => (
            <div
              key={`${entry.subcatCode}-${entry.metricKey}-${idx}`}
              className="flex items-start gap-2.5 p-2 rounded-lg bg-success/5 border border-success/15"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {entry.subcat}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {entry.metric}: {entry.ctc > 0 ? "+" : ""}{entry.ctc} {entry.unit} YoY
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Headwinds */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingDown className="w-3.5 h-3.5 text-destructive" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Headwinds
          </h3>
        </div>
        <div className="flex flex-col gap-1.5">
          {winds.headwinds.length === 0 && (
            <span className="text-xs text-muted-foreground">None</span>
          )}
          {winds.headwinds.map((entry, idx) => (
            <div
              key={`${entry.subcatCode}-${entry.metricKey}-${idx}`}
              className="flex items-start gap-2.5 p-2 rounded-lg bg-destructive/5 border border-destructive/15"
            >
              <ArrowDownRight className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {entry.subcat}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {entry.metric}: {entry.ctc > 0 ? "+" : ""}{entry.ctc} {entry.unit} YoY
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
