"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function api(path: string, body: object = {}) {
  const initData = (window as any).Telegram?.WebApp?.initData || "";
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-req": "1", "x-init-data": initData },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) {
    const e: any = new Error(j?.message || `Request failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return j;
}
export const q = (type: string, extra: object = {}) => api("/api/admin/query", { type, ...extra });
export const act = (action: string, extra: object = {}) => api("/api/admin/act", { action, ...extra });

export const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const when = (ms?: number) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "—");

const PERMS: Record<string, string[] | "*"> = {
  super: "*",
  moderator: ["users.view", "users.ban", "tasks", "tickets", "fraud", "audit"],
  finance: ["users.view", "balance", "stats", "promo", "audit"],
};
export const can = (role: string, perm: string) => PERMS[role] === "*" || (PERMS[role] as string[] | undefined)?.includes(perm) || false;

/* toast */
type ToastFn = (text: string, kind?: "ok" | "err") => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const show = useCallback<ToastFn>((text, kind = "ok") => {
    setT({ text, kind });
    setTimeout(() => setT(null), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite">{t && <div className={`a-toast ${t.kind === "err" ? "err" : ""}`}>{t.text}</div>}</div>
    </ToastCtx.Provider>
  );
}

/** Runs an action, shows the result as a toast, and returns true on success. */
export function useRun() {
  const toast = useToast();
  return useCallback(async (fn: () => Promise<any>, after?: () => void) => {
    try {
      const r = await fn();
      toast(r?.message || "Done.");
      after?.();
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    }
  }, [toast]);
}

export function useLoad<T = any>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setErr(""); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, err, loading, reload: run };
}

export function Loading({ err, loading }: { err?: string; loading?: boolean }) {
  if (err) return <p className="a-neg" role="alert">{err}</p>;
  if (loading) return <p className="a-muted"><span className="a-spin" aria-hidden /> Loading…</p>;
  return null;
}

const ICONS: Record<string, string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  users: "M15.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM4.5 20c0-3.3 3.4-6 7.5-6s7.5 2.7 7.5 6",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6l1.2 1.2L7 5.4M4 12l1.2 1.2L7 11.4M4 18l1.2 1.2L7 17.4",
  tickets: "M4 5h16v11H9l-5 4z",
  promo: "M4 9V6h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM12 6v10",
  broadcast: "M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19",
  team: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  network: "M7.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM21.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM21.5 19a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM7.2 10.8l9.6-4.6M7.2 13.2l9.6 4.6",
  bots: "M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 4v4M9 13.5h.01M15 13.5h.01",
  system: "M3 12h4l3-8 4 16 3-8h4",
};
export const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[name]} /></svg>
);

export const Chip = ({ kind = "", children }: { kind?: "good" | "bad" | "warn" | "info" | ""; children: ReactNode }) => (
  <span className={`a-chip ${kind}`}>{children}</span>
);

export const statusKind = (s: string) =>
  ({ active: "good", paused: "warn", done: "info", cancelled: "", open: "warn", running: "info", pending_approval: "warn", scheduled: "info", released: "good", forfeited: "bad" } as Record<string, any>)[s] ?? "";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="a-field"><span>{label}</span>{children}</label>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="a-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="a-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="a-maint" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="a-btn sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
);
export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
);
