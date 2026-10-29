"use client";

import { useEffect, useState } from "react";
import { act, Chip, fmt, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

function ProofImage({ id }: { id: string }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let url = "";
    (async () => {
      try {
        const r = await fetch("/api/admin/proof-image", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-req": "1", "x-init-data": (window as any).Telegram?.WebApp?.initData || "" },
          body: JSON.stringify({ id }),
        });
        if (!r.ok) throw new Error(`Image unavailable (${r.status})`);
        url = URL.createObjectURL(await r.blob());
        setSrc(url);
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (err) return <p className="a-muted">{err}</p>;
  if (!src) return <p className="a-muted"><span className="a-spin" aria-hidden /> Loading screenshot…</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Proof screenshot" style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 12, border: "1px solid var(--line)" }} />;
}

export default function Disputes() {
  const { data, err, loading, reload } = useLoad<any>(() => q("disputes"), []);
  const run = useRun();
  if (!data) return <Loading err={err} loading={loading} />;
  return (
    <>
      <div className="a-maint" style={{ marginBottom: 12 }}>
        <span className="a-muted">{data.pending} proof(s) are waiting for a promoter. They are approved automatically after the set time.</span>
        <button className="a-btn sm" onClick={reload}>Refresh</button>
      </div>
      {data.disputes.length === 0 ? <div className="a-card"><p className="a-empty">No open disputes.</p></div> : data.disputes.map((d: any) => (
        <div className="a-card" key={d.id}>
          <div className="a-maint">
            <div><strong>{d.title}</strong><div className="a-muted mono" style={{ fontSize: 12 }}>{d.type} · reward {fmt(d.reward)} · sent {when(d.submittedAt)} UTC</div></div>
            <Chip kind="warn">disputed</Chip>
          </div>
          <div className="a-split" style={{ marginTop: 14 }}>
            <ProofImage id={d.id} />
            <div>
              <dl className="a-kv" style={{ gridTemplateColumns: "130px 1fr" }}>
                <dt>Worker</dt><dd className="mono">{d.userId}</dd>
                <dt>Promoter</dt><dd className="mono">{d.ownerId}</dd>
                <dt>Promoter record</dt><dd>{d.owner.approved} approved, <strong>{d.owner.rejected}</strong> rejected</dd>
                <dt>Rejection reason</dt><dd>{d.reason ?? "—"}</dd>
              </dl>
              <div className="a-actions" style={{ marginTop: 16 }}>
                <button className="a-btn primary" onClick={() => confirm("Pay the worker from the promoter's held money?") && run(() => act("proof_decide", { id: d.id, decision: "pay" }), reload)}>Pay the worker</button>
                <button className="a-btn danger" onClick={() => confirm("Keep the rejection? The money returns to the task.") && run(() => act("proof_decide", { id: d.id, decision: "reject" }), reload)}>Keep the rejection</button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
