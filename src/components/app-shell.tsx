"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navigation = [
  { label: "Dashboard", icon: "⌂", href: "/" },
  { label: "Chat", icon: "✦", href: "/chat" },
  { label: "GitHub", icon: "⌘", href: "/github" },
  { label: "New app", icon: "+", href: "/greenfield" },
  { label: "Library", icon: "▦", href: "/library" },
  { label: "Kai Agent", icon: "✦", href: "/kai-agent" },
  { label: "History", icon: "↺", href: "/history" },
  { label: "Settings", icon: "⚙", href: "/settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [activeBuildHref, setActiveBuildHref] = useState("");
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!isChatRoute) return;

    const restoreTimer = window.setTimeout(() => {
      try {
        setChatSidebarCollapsed(window.localStorage.getItem("kai-chat-sidebar-collapsed") === "true");
      } catch {
        // A restricted storage context should not prevent Chat from opening.
      }
    }, 0);

    const toggle = () => setChatSidebarCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem("kai-chat-sidebar-collapsed", String(next)); } catch { /* best effort */ }
      return next;
    });
    const onToggle = () => toggle();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("kai:toggle-chat-sidebar", onToggle);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("kai:toggle-chat-sidebar", onToggle);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isChatRoute]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/github/build/active", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ active?: { href?: string } | null }>)
      .then((body) => { if (!cancelled) setActiveBuildHref(body.active?.href ?? ""); })
      .catch(() => { if (!cancelled) setActiveBuildHref(""); });
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pathname]);

  return (
    <main className="flex min-h-screen bg-[#080b12] text-white">
      <aside
        aria-hidden={isChatRoute && chatSidebarCollapsed}
        inert={isChatRoute && chatSidebarCollapsed ? true : undefined}
        className={`hidden w-64 shrink-0 border-r border-white/10 bg-[#0b0f18] p-5 transition-[width,opacity,transform] duration-[var(--kai-sidebar-transition)] md:flex md:flex-col ${isChatRoute && chatSidebarCollapsed ? "pointer-events-none -translate-x-3 overflow-hidden opacity-0 md:w-0 md:border-r-0 md:p-0" : ""}`}
      >
        <Link href="/" className="flex items-center gap-3 px-2 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500 font-bold">
            K
          </span>
          <div>
            <p className="font-semibold">Kai Studio</p>
            <p className="text-xs text-slate-500">Private local AI workspace</p>
          </div>
        </Link>

        <nav className="mt-8 space-y-1">
          {navigation.map((item) => {
            const href = item.label === "Chat" && activeBuildHref ? activeBuildHref : item.href;
            const active =
              pathname === item.href ||
              (item.label === "Kai Agent" && (pathname.startsWith("/workflows/") || pathname.startsWith("/kai-agent"))) ||
              (item.label === "History" && pathname.startsWith("/history/"));
            const isActive = active || (item.label === "GitHub" && pathname.startsWith("/github/"));

            return (
              <Link
                key={item.label}
                href={href}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-sky-500/15 text-sky-300"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Local mode
          </div>
          <p className="mt-1 text-xs text-slate-500">
            AI inference stays on this Mac.
          </p>
        </div>
      </aside>

      <div className={`relative flex min-w-0 flex-1 ${isChatRoute && chatSidebarCollapsed ? "kai-chat-shell-collapsed" : ""}`}>
        {children}
        {isChatRoute && chatSidebarCollapsed ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("kai:toggle-chat-sidebar"))}
            className="fixed left-4 top-14 z-30 flex h-9 w-9 items-center justify-center rounded-xl border border-sky-300/25 bg-[#101a29]/90 text-sky-200 shadow-lg shadow-black/30 backdrop-blur-md transition hover:border-sky-200/50 hover:bg-sky-400/15 focus:outline-none focus:ring-2 focus:ring-sky-300/70"
            aria-label="Show Chat sidebar"
            title="Show Chat sidebar (⌘\\)"
          >
            ☰
          </button>
        ) : null}
      </div>
    </main>
  );
}
