"use client";

import { act, Chip, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function System() {
  const { data, err, loading, reload } = useLoad<any>(() => q("system"), []);
  const run = useRun();
  if (!data) return <Loading err={err} loading={loading} />;
  const t = data.tick;
  const age = t ? Date.now() - t.at : Infinity;

  return (
    <>
      <div className="a-card">
        <div className="a-maint">
          <div><h2 style={{ margin: 0 }}>Scheduler</h2><span className="a-muted">The tick runs timed jobs: retention checks, network posts and bonuses, deletions, broadcasts.</span></div>
          {!t ? <Chip kind="bad">never ran</Chip> : age > 180_000 ? <Chip kind="bad">stalled</Chip> : <Chip kind="good">running</Chip>}
        </div>
        {t ? (
          <dl className="a-kv" style={{ marginTop: 12 }}>
            <dt>Last run</dt><dd>{when(t.at)} UTC <span className="a-muted">({Math.round(age / 1000)}s ago, took {t.ms} ms)</span></dd>
            <dt>More work waiting</dt><dd>{t.more ? "yes" : "no"}</dd>
            <dt>Results</dt><dd className="mono" style={{ fontSize: 12 }}>{JSON.stringify(t.results)}</dd>
          </dl>
        ) : <p className="a-muted">Point cron-job.org at <span className="mono">/api/cron/tick</span> every minute with the header <span className="mono">Authorization: Bearer &lt;CRON_SECRET&gt;</span>.</p>}
      </div>

      <div className="a-card" style={{ padding: 8 }}>
        <div className="a-maint" style={{ padding: "10px 10px 0" }}>
          <h2 style={{ margin: 0 }}>Error log</h2>
          <div className="a-actions"><button className="a-btn sm" onClick={reload}>Refresh</button>
            {data.errors.length > 0 && <button className="a-btn sm danger" onClick={() => confirm("Clear the whole log?") && run(() => act("error_clear"), reload)}>Clear all</button>}</div>
        </div>
        {data.errors.length === 0 ? <p className="a-empty">No errors recorded. 🎉</p> : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr><th>Where</th><th>Message</th><th>Count</th><th>Last (UTC)</th><th /></tr></thead>
            <tbody>{data.errors.map((e: any) => (
              <tr key={e.id}><td className="mono">{e.where}</td><td style={{ maxWidth: 420 }}>{e.message}</td><td className="mono">{e.count}</td><td className="a-muted mono">{when(e.lastAt)}</td>
                <td><button className="a-btn sm" onClick={() => run(() => act("error_clear", { id: e.id }), reload)}>Dismiss</button></td></tr>
            ))}</tbody></table></div>
        )}
      </div>
    </>
  );
}
