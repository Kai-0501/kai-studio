import Link from "next/link";

export function DashboardBackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-sky-200"
    >
      <span aria-hidden="true">←</span>
      Dashboard
    </Link>
  );
}
