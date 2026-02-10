"use client";

import { useDashboard } from "@/lib/dashboard-context";
import { LeftSidebar } from "./left-sidebar";
import { RightSidebar } from "./right-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { MetricCards } from "./metric-cards";
import { ChatInterface } from "./chat-interface";
import { Loader2 } from "lucide-react";

export function DashboardShell() {
  const { isLoading, weeks } = useDashboard();

  // Show loading state while initializing
  if (isLoading && weeks.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Show error state if no weeks available
  if (!isLoading && weeks.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Unable to connect</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Could not connect to the Leadership Autopilot backend.
            Make sure the server is running at <code className="px-1 py-0.5 bg-muted rounded text-xs">localhost:3456</code>
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar />

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0">
        <DashboardHeader />
        <MetricCards />
        <ChatInterface />
      </div>

      {/* Right Sidebar */}
      <div className="hidden lg:flex">
        <RightSidebar />
      </div>
    </div>
  );
}
