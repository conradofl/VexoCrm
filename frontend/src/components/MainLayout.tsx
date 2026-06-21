import { AppSidebar } from "@/components/AppSidebar";
import { CrmClientProvider } from "@/contexts/CrmClientContext";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    <div className="relative h-screen overflow-hidden bg-transparent px-2 py-2 lg:px-3 lg:py-3">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(14,165,233,0.10),transparent_22%),radial-gradient(circle_at_84%_14%,rgba(99,102,241,0.10),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(34,197,94,0.08),transparent_30%),linear-gradient(180deg,rgba(247,249,255,0.96),rgba(236,242,252,0.98))] dark:bg-[radial-gradient(circle_at_14%_12%,rgba(168,85,247,0.18),transparent_22%),radial-gradient(circle_at_84%_14%,rgba(34,211,238,0.16),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(59,130,246,0.16),transparent_30%),linear-gradient(180deg,rgba(2,3,24,0.96),rgba(4,6,30,0.98))]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.028)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:radial-gradient(circle_at_center,black_38%,transparent_82%)] dark:bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)]" />
      </div>
      <CrmClientProvider>
        <div className="relative mx-auto flex h-[calc(100vh-1rem)] w-full max-w-none overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(242,246,255,0.96))] shadow-[0_30px_90px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/60 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(10,12,40,0.9),rgba(5,6,28,0.96))] dark:shadow-[0_30px_90px_rgba(0,0,0,0.40)] dark:ring-white/5 lg:h-[calc(100vh-1.5rem)]">
          <AppSidebar />
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </CrmClientProvider>
    </div>
  );
}
