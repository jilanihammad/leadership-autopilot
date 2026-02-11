"use client";

import {
  LayoutDashboard,
  History,
  Settings,
  RotateCcw,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/dashboard-context";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resetSession } from "@/lib/api";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
];

export function LeftSidebar() {
  const {
    selectedWeek,
    selectedGL,
    weeks,
    gls,
    sessionId,
    formatTemplate,
    setSelectedWeek,
    setSelectedGL,
    setFormatTemplate,
    resetChat,
    leftSidebarOpen,
  } = useDashboard();

  const handleReset = async () => {
    await resetSession(sessionId);
    resetChat();
  };

  // Use real GL data from API, or show loading state
  const glOptions = gls.length > 0 
    ? gls.map(gl => ({ value: gl.name, label: gl.label || gl.name.toUpperCase() }))
    : [];

  // Use real weeks from API
  const weekOptions = weeks.length > 0 ? weeks : [];

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar h-full transition-all duration-300 ease-in-out",
        leftSidebarOpen ? "w-60" : "w-0 overflow-hidden border-r-0"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground leading-none">
            Leadership
          </span>
          <span className="text-xs text-muted-foreground leading-tight mt-0.5">
            Autopilot
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              item.active
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-5 border-t border-border" />

      {/* Selectors */}
      <div className="flex flex-col gap-3 px-3 py-4">
        <div className="flex flex-col gap-1.5">
          <label className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            GL Category
          </label>
          {glOptions.length > 0 ? (
            <Select value={selectedGL} onValueChange={setSelectedGL}>
              <SelectTrigger className="bg-sidebar-accent border-border text-foreground h-9">
                <SelectValue placeholder="Select GL..." />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {glOptions.map((gl) => (
                  <SelectItem key={gl.value} value={gl.value}>
                    {gl.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="h-9 px-3 flex items-center text-sm text-muted-foreground bg-sidebar-accent border border-border rounded-md">
              Loading...
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Week
          </label>
          {weekOptions.length > 0 ? (
            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
              <SelectTrigger className="bg-sidebar-accent border-border text-foreground h-9">
                <SelectValue placeholder="Select week..." />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {weekOptions.map((week) => (
                  <SelectItem key={week} value={week}>
                    {week}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="h-9 px-3 flex items-center text-sm text-muted-foreground bg-sidebar-accent border border-border rounded-md">
              Loading...
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-border" />

      {/* Format Template */}
      <div className="flex flex-col gap-1.5 px-3 py-4">
        <label className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Response Format
        </label>
        <textarea
          value={formatTemplate}
          onChange={(e) => setFormatTemplate(e.target.value)}
          placeholder="Paste an example of your preferred writing style..."
          rows={4}
          className="px-3 py-2 text-xs text-foreground bg-sidebar-accent border border-border rounded-md resize-y min-h-[60px] max-h-[200px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 scrollbar-thin"
        />
        {formatTemplate.trim() && (
          <div className="flex items-center gap-1.5 px-3">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[10px] text-primary">Format active — responses will be restyled</span>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Session Info */}
      <div className="px-5 py-2 text-xs text-muted-foreground/60 font-mono">
        Session: {sessionId.slice(0, 8)}
      </div>

      {/* Reset Session */}
      <div className="px-3 py-4 border-t border-border">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground border-border bg-transparent"
          onClick={handleReset}
        >
          <RotateCcw className="w-4 h-4" />
          Reset Session
        </Button>
      </div>
    </aside>
  );
}
