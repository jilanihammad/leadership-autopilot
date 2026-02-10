import { DashboardProvider } from "@/lib/dashboard-context";
import { DashboardShell } from "@/components/dashboard-shell";

export default function Page() {
  return (
    <DashboardProvider>
      <DashboardShell />
    </DashboardProvider>
  );
}
