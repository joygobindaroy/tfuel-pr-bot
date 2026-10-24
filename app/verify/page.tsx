"use client";

import Script from "next/script";
import { useCallback, useState } from "react";

type State =
  | { kind: "intro" }
  | { kind: "checking" }
  | { kind: "done"; country: string }
  | { kind: "failed"; message: string; retry: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { Telegram?: { WebApp: any } }
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: "intro" });

  const run = useCallback(async () => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) {
      setState({ kind: "failed", message: "Open this page with the Verify button inside the bot.", retry: false });
      return;
    }
    setState({ kind: "checking" });
    try {
      const nav = navigator as any;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const raw = [
        nav.userAgent,
        `${screen.width}x${screen.height}x${screen.colorDepth}`,
        tz,
        (nav.languages || []).join(","),
        nav.hardwareConcurrency,
        nav.platform,
        nav.deviceMemory,
      ].join("|");

      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: tg.initData, device: await sha256(raw), tz }),
      });
      const data = await res.json();
      if (data.ok) {
        setState({ kind: "done", country: data.country });
        setTimeout(() => tg.close(), 1800);
      } else {
        setState({
          kind: "failed",
          message: data.message || "Verification failed.",
          retry: data.reason !== "banned" && data.reason !== "start",
        });
      }
    } catch {
      setState({ kind: "failed", message: "Network error. Check your connection and try again.", retry: true });
    }
  }, []);

  return (
    <main className="wrap">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => {
          window.Telegram?.WebApp?.ready();
          window.Telegram?.WebApp?.expand();
        }}
      />

      {state.kind === "intro" && (
        <>
          <h1>Verify your connection</h1>
          <p>
            This keeps rewards fair and stops fake accounts. We check three things:
          </p>
          <ul className="checks">
            <li>Your country, from your IP address</li>
            <li>Whether a VPN or proxy is in use</li>
            <li>A hashed device signature</li>
          </ul>
          <p className="muted">
            We store your country and hashed values, not your raw IP address.
          </p>
          <button onClick={run}>Agree and verify</button>
        </>
      )}

      {state.kind === "checking" && (
        <div className="status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden />
          <span>Checking your connection…</span>
        </div>
      )}

      {state.kind === "done" && (
        <div role="status" aria-live="polite">
          <h1 className="ok">Verified</h1>
          <p>Detected country: {state.country}. Returning to the chat…</p>
        </div>
      )}

      {state.kind === "failed" && (
        <div role="alert">
          <h1>Couldn’t verify</h1>
          <p className="error">{state.message}</p>
          {state.retry && <button onClick={run}>Try again</button>}
        </div>
      )}
    </main>
  );
}
