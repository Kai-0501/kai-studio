import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GeneralIntelligenceRunner } from "@/components/general-intelligence-runner";
import { DashboardBackLink } from "@/components/dashboard-back-link";

export default function GeneralIntelligencePage() {
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
            <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
              Personal
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              General Intelligence
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-slate-400">
              Talk directly to Gemma or create a structured tutoring session for
              anything you want to learn.
            </p>
          </div>

          <GeneralIntelligenceRunner />
        </div>
      </section>
    </AppShell>
  );
}
