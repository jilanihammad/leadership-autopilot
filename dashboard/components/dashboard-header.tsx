"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-context";
import { Button } from "@/components/ui/button";

export function DashboardHeader() {
  const {
    toggleLeftSidebar,
    toggleRightSidebar,
    leftSidebarOpen,
    rightSidebarOpen,
    selectedGL,
    selectedWeek,
  } = useDashboard();

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-card/50 shrink-0">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={toggleLeftSidebar}
          aria-label={leftSidebarOpen ? "Close left sidebar" : "Open left sidebar"}
        >
          {leftSidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </Button>
        <div className="hidden sm:flex items-center gap-2">
          <h1 className="text-sm font-medium text-foreground">
            Weekly Business Review
          </h1>
          <span className="text-xs text-muted-foreground">
            {selectedGL.toUpperCase()} / {selectedWeek}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 border border-success/20">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-success font-medium">Live</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={toggleRightSidebar}
          aria-label={rightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
        >
          {rightSidebarOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
        </Button>
      </div>
    </header>
  );
}
