"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  RotateCcw,
  Zap,
  Save,
  Trash2,
  X,
  FileText,
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
import { resetSession, fetchFormats, saveFormat, deleteFormat } from "@/lib/api";
import type { FormatPreset } from "@/lib/api";

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

  const [presets, setPresets] = useState<FormatPreset[]>([]);
  const [activePreset, setActivePreset] = useState<string>("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");

  // Load presets on mount
  useEffect(() => {
    fetchFormats().then(setPresets);
  }, []);

  const handleReset = async () => {
    await resetSession(sessionId);
    resetChat();
  };

  const handleSelectPreset = useCallback((name: string) => {
    if (name === "__none__") {
      setActivePreset("");
      setFormatTemplate("");
      return;
    }
    const preset = presets.find(p => p.name === name);
    if (preset) {
      setActivePreset(name);
      setFormatTemplate(preset.template);
    }
  }, [presets, setFormatTemplate]);

  const handleSavePreset = useCallback(async () => {
    const name = saveName.trim();
    if (!name || !formatTemplate.trim()) return;
    const result = await saveFormat(name, formatTemplate);
    if (result) {
      const updated = await fetchFormats();
      setPresets(updated);
      setActivePreset(name);
      setShowSaveDialog(false);
      setSaveName("");
    }
  }, [saveName, formatTemplate]);

  const handleDeletePreset = useCallback(async (name: string) => {
    const ok = await deleteFormat(name);
    if (ok) {
      const updated = await fetchFormats();
      setPresets(updated);
      if (activePreset === name) {
        setActivePreset("");
        setFormatTemplate("");
      }
    }
  }, [activePreset, setFormatTemplate]);

  const handleClearFormat = useCallback(() => {
    setActivePreset("");
    setFormatTemplate("");
  }, [setFormatTemplate]);

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

      {/* Response Format */}
      <div className="flex flex-col gap-2 px-3 py-4">
        <label className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Response Format
        </label>

        {/* Preset selector */}
        {presets.length > 0 && (
          <Select value={activePreset || "__none__"} onValueChange={handleSelectPreset}>
            <SelectTrigger className="bg-sidebar-accent border-border text-foreground h-8 text-xs">
              <SelectValue placeholder="Select preset..." />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="__none__">
                <span className="text-muted-foreground">No preset</span>
              </SelectItem>
              {presets.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Template textarea */}
        <textarea
          value={formatTemplate}
          onChange={(e) => {
            setFormatTemplate(e.target.value);
            // If editing, mark as unsaved (clear active preset name)
            if (activePreset) {
              const preset = presets.find(p => p.name === activePreset);
              if (preset && e.target.value !== preset.template) {
                setActivePreset("");
              }
            }
          }}
          placeholder="Paste an example of your preferred response format..."
          rows={4}
          className="px-3 py-2 text-xs text-foreground bg-sidebar-accent border border-border rounded-md resize-y min-h-[60px] max-h-[200px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 scrollbar-thin"
        />

        {/* Action buttons */}
        {formatTemplate.trim() && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[10px] text-primary flex-1">
                {activePreset ? `Using: ${activePreset}` : "Custom format active"}
              </span>
              <button
                type="button"
                onClick={handleClearFormat}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                title="Clear format"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Save as preset */}
            {!showSaveDialog ? (
              <button
                type="button"
                onClick={() => {
                  setSaveName(activePreset || "");
                  setShowSaveDialog(true);
                }}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted/30"
              >
                <Save className="w-3 h-3" />
                {activePreset ? "Update preset" : "Save as preset"}
              </button>
            ) : (
              <div className="flex items-center gap-1 px-1">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSavePreset();
                    if (e.key === "Escape") setShowSaveDialog(false);
                  }}
                  placeholder="Preset name..."
                  autoFocus
                  className="flex-1 px-2 py-1 text-xs bg-sidebar-accent border border-border rounded text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!saveName.trim()}
                  className="p-1 text-primary hover:text-primary/80 disabled:text-muted-foreground transition-colors"
                  title="Save"
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaveDialog(false)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Preset management: delete */}
        {activePreset && (
          <button
            type="button"
            onClick={() => handleDeletePreset(activePreset)}
            className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-destructive/70 hover:text-destructive transition-colors rounded hover:bg-destructive/5"
          >
            <Trash2 className="w-3 h-3" />
            Delete "{activePreset}"
          </button>
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
