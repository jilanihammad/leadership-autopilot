"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/dashboard-context";
import { Sparkline } from "./sparkline";
import { Skeleton } from "@/components/ui/skeleton";

function MetricCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-card border border-border">
      <Skeleton className="h-3 w-12 bg-muted" />
      <Skeleton className="h-7 w-20 bg-muted" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-3 w-16 bg-muted" />
        <Skeleton className="h-3 w-16 bg-muted" />
      </div>
      <Skeleton className="h-7 w-full bg-muted" />
    </div>
  );
}

export function MetricCards() {
  const { metrics } = useDashboard();

  if (!metrics || metrics.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <MetricCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
      {metrics.map((metric) => {
        const isPositiveWow = metric.wow >= 0;
        const isPositiveYoy = metric.yoy >= 0;
        const sparkColor = isPositiveWow
          ? "hsl(142 71% 45%)"
          : "hsl(0 84% 60%)";

        return (
          <div
            key={metric.name}
            className="group flex flex-col gap-2 p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all duration-200"
          >
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {metric.label}
            </span>

            <span className="text-xl font-semibold text-foreground font-mono tracking-tight">
              {metric.value}
            </span>

            <div className="flex items-center gap-3">
              {/* WoW Change */}
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  isPositiveWow ? "text-success" : "text-destructive"
                )}
              >
                {isPositiveWow ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>
                  {isPositiveWow ? "+" : ""}
                  {metric.wow}% WoW
                </span>
              </div>

              {/* YoY Change */}
              <span
                className={cn(
                  "text-xs",
                  isPositiveYoy ? "text-success/70" : "text-destructive/70"
                )}
              >
                {isPositiveYoy ? "+" : ""}
                {metric.yoy}% YoY
              </span>
            </div>

            <div className="mt-1">
              <Sparkline data={metric.sparkline} color={sparkColor} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
