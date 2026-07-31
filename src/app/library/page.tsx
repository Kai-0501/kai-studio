"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { DashboardBackLink } from "@/components/dashboard-back-link";

const workflows = [
  {
    name: "Meeting Intelligence",
    category: "Meetings",
    description:
      "Turn a meeting transcript into a structured summary, CRM notes, action items, and a follow-up email.",
    detail: "3 inputs",
    href: "/workflows/meeting-intelligence",
    keywords: ["transcript", "crm", "summary", "email", "action items", "sales"],
    badge: "bg-violet-500/15 text-violet-300",
    hover: "hover:border-violet-400/40",
    link: "text-violet-300",
  },
  {
    name: "Editorial Intelligence",
    category: "Writing",
    description:
      "Refine essays, emails, and reports while preserving your meaning, evidence, and natural voice.",
    detail: "Text or PDF · Gemma 12B",
    href: "/workflows/editorial-intelligence",
    keywords: [
      "essay",
      "rewrite",
      "edit",
      "pdf",
      "report",
      "grammar",
      "university",
    ],
    badge: "bg-sky-500/15 text-sky-300",
    hover: "hover:border-sky-400/40",
    link: "text-sky-300",
  },
  {
    name: "Account Intelligence",
    category: "Sales",
    description:
      "Turn supplied company research into grounded priorities, pain hypotheses, discovery questions, and outreach angles.",
    detail: "Research or PDF · 26B/31B",
    href: "/workflows/account-intelligence",
    keywords: [
      "company",
      "account",
      "research",
      "prospecting",
      "discovery",
      "outreach",
      "stakeholder",
    ],
    badge: "bg-amber-500/15 text-amber-300",
    hover: "hover:border-amber-400/40",
    link: "text-amber-300",
  },
  {
    name: "General Intelligence",
    category: "Personal",
    description:
      "Talk directly to Gemma or build a structured learning session around anything you want to understand.",
    detail: "Chat · Learn · 26B/31B",
    href: "/workflows/general-intelligence",
    keywords: [
      "chat",
      "learn",
      "tutor",
      "conversation",
      "question",
      "study",
      "general",
    ],
    badge: "bg-emerald-500/15 text-emerald-300",
    hover: "hover:border-emerald-400/40",
    link: "text-emerald-300",
  },
];

export default function LibraryPage() {
  const [query, setQuery] = useState("");

  const filteredWorkflows = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) return workflows;

    return workflows.filter((workflow) =>
      [
        workflow.name,
        workflow.category,
        workflow.description,
        workflow.detail,
        ...workflow.keywords,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalisedQuery),
    );
  }, [query]);

  return (
    <AppShell>
      <section className="flex-1 px-6 py-12 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">
          <DashboardBackLink />
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-400">
            Workflow Library
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Choose a workflow
          </h1>
          <p className="mt-3 text-slate-400">
            Purpose-built local AI workflows for creating, researching,
            learning, and getting real work done.
          </p>

          <div className="mt-8">
            <label className="relative block">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-500">
                ⌕
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workflows, categories, or capabilities..."
                className="w-full rounded-2xl border border-white/10 bg-white/[0.025] py-4 pl-11 pr-12 text-sm outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 focus:bg-white/[0.04]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute inset-y-0 right-4 text-sm text-slate-500 transition hover:text-white"
                >
                  ×
                </button>
              )}
            </label>
            <p className="mt-3 text-xs text-slate-600">
              {query.trim()
                ? `${filteredWorkflows.length} of ${workflows.length} workflows found`
                : `${workflows.length} workflows available`}
            </p>
          </div>

          {filteredWorkflows.length > 0 ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {filteredWorkflows.map((workflow) => (
                <Link
                  key={workflow.href}
                  href={workflow.href}
                  className={`block rounded-2xl border border-white/10 bg-white/[0.035] p-6 transition hover:bg-white/[0.055] ${workflow.hover}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${workflow.badge}`}
                    >
                      {workflow.category}
                    </span>
                    <span className="text-slate-600">☆</span>
                  </div>

                  <h2 className="mt-6 text-xl font-semibold">{workflow.name}</h2>
                  <p className="mt-2 leading-6 text-slate-400">
                    {workflow.description}
                  </p>

                  <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
                    <span className="text-slate-500">{workflow.detail}</span>
                    <span className={`font-medium ${workflow.link}`}>
                      View workflow →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-slate-500">
                ⌕
              </div>
              <p className="mt-4 font-medium text-slate-300">
                No workflows found
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Try a broader term such as writing, sales, chat, PDF, or meeting.
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-5 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:border-sky-400/40 hover:text-white"
              >
                Clear search
              </button>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
