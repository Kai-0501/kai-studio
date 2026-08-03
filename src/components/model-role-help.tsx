"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelRoleDescription } from "@/lib/models/roles";

export function ModelRoleHelp({ role }: { role: ModelRoleDescription }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = pinned || hovered;

  useEffect(() => {
    function close(event: KeyboardEvent | MouseEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setPinned(false);
        return;
      }
      if (!ref.current?.contains(event.target as Node)) setPinned(false);
    }
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("mousedown", close);
    };
  }, []);

  return (
    <span ref={ref} className="relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={`About the ${role.label} model role`}
        aria-expanded={pinned}
        onClick={() => setPinned((current) => !current)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-sky-400/40 text-[10px] font-semibold text-sky-300 transition hover:bg-sky-400/15 focus:outline-none focus:ring-2 focus:ring-sky-400/50"
      >
        ?
      </button>
      {open ? (
        <span role="tooltip" className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-sky-400/25 bg-[#111a27]/95 p-3 text-left text-xs leading-5 text-slate-300 shadow-2xl backdrop-blur">
          <strong className="block text-sm text-white">{role.label}</strong>
          <span className="mt-1 block">{role.description}</span>
          {role.capabilities.length ? <span className="mt-2 block text-[11px] text-sky-200">Needs: {role.capabilities.join(" · ")}</span> : null}
          <span className="mt-2 block text-[11px] text-slate-500">Click to keep this open. Press Escape or click outside to close.</span>
        </span>
      ) : null}
    </span>
  );
}
