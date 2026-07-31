import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MeetingIntelligenceRunner } from "@/components/meeting-intelligence-runner";
import { DashboardBackLink } from "@/components/dashboard-back-link";

export default function MeetingIntelligencePage() {
  return (
    <AppShell>
      <section className="flex-1 px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <DashboardBackLink />
          <Link
            href="/library"
            className="text-sm text-slate-400 transition hover:text-white"
          >
            ← Back to Library
          </Link>
          </div>

          <div className="mt-8">
            <span className="rounded-lg bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300">
              Meetings
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Meeting Intelligence
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-400">
              Supply the meeting details below. Kai Studio will use them to
              construct a clear, structured prompt for Gemma.
            </p>
          </div>

          <MeetingIntelligenceRunner />
        </div>
      </section>
    </AppShell>
  );
}
