/**
 * Sales dashboard — Clients section (6 Nov 2026).
 *   Tiles          unique clients, active this FY (vs last FY), new this FY, top-client share
 *   Revenue by client   EC Price this FY, Delivered vs Scheduled, ranked; tap → month strip
 *   Client mix     doughnut, top 6 + Others
 *   Client growth  Returning + New per FY (stacked) with total line
 *   Roster         clients per FY as tiles (tabs)
 * Revenue = Engagement Calendar Price (INR) of sessions not Cancelled / Lost / Dropped / Postponed / On hold.
 */
import { useMemo, useState } from 'react';
import { ChartBox, NV, TL, GD, GN, PU, RD, CURRENT_FY, fyTiny, clean } from './erdCharts.jsx';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const slot = iso => (+iso.slice(5, 7) + 8) % 12;
const L = v => { const n = Number(v) || 0; return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`; };
const isDelivered = e => /^delivered$/i.test(clean(e.status));
const MIX = [NV, TL, GD, PU, GN, RD];

export default function SalesClients({ sessions, clientYears, clientKey }) {
  const [openC, setOpenC] = useState(null);
  const years = clientYears.rows;
  const [tabFy, setTabFy] = useState(CURRENT_FY);

  /* Revenue per client per FY (EC) */
  const byFy = useMemo(() => {
    const out = new Map();
    sessions.forEach(e => {
      const name = clean(e.company); const k = clientKey(name);
      if (!k) return;
      if (!out.has(e.fy)) out.set(e.fy, new Map());
      const m = out.get(e.fy);
      if (!m.has(k)) m.set(k, { key: k, name, del: 0, sch: 0, n: 0, months: Array(12).fill(0) });
      const c = m.get(k);
      if (isDelivered(e)) c.del += e.price; else c.sch += e.price;
      c.n += 1; c.months[slot(e.startDate)] += e.price;
    });
    return out;
  }, [sessions, clientKey]);

  const cur = useMemo(() => [...(byFy.get(CURRENT_FY)?.values() || [])].map(c => ({ ...c, tot: c.del + c.sch })).filter(c => c.tot > 0)
    .sort((a, b) => b.tot - a.tot), [byFy]);
  const curTot = cur.reduce((t, c) => t + c.tot, 0);
  const maxTot = Math.max(1, ...cur.map(c => c.tot));

  const yCur = years.find(r => r.fy === CURRENT_FY) || { total: 0, newC: 0 };
  const yPrev = years.find(r => r.fy === CURRENT_FY - 1);
  const delta = yPrev ? yCur.total - yPrev.total : null;
  const topShare = curTot ? cur[0].tot / curTot : 0;

  /* Doughnut — top 6 + Others */
  const mixCfg = useMemo(() => {
    const top = cur.slice(0, 6), rest = cur.slice(6).reduce((t, c) => t + c.tot, 0);
    const labels = [...top.map(c => c.name), ...(rest > 0 ? ['Others'] : [])];
    const data = [...top.map(c => c.tot), ...(rest > 0 ? [rest] : [])];
    const colors = [...MIX.slice(0, top.length), ...(rest > 0 ? ['#CBD5E1'] : [])];
    const centre = { id: 'centre', afterDraw(ch) {
      const { ctx, chartArea: a } = ch; if (!a) return;
      const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#0D1B35';
      ctx.font = '800 18px Segoe UI, system-ui, sans-serif'; ctx.fillText(L(curTot), x, y + 2);
      ctx.font = '600 11px Segoe UI, system-ui, sans-serif'; ctx.fillStyle = '#6B7A99'; ctx.fillText(`${cur.length} clients`, x, y + 18);
      ctx.restore();
    } };
    return { legend: labels.map((l, i) => ({ l, v: data[i], c: colors[i] })), cfg: { type: 'doughnut', plugins: [centre],
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '66%', layout: { padding: 6 },
        plugins: { legend: { display: false }, datalabels: { display: false },
          tooltip: { callbacks: { label: c => `${c.label}: ${L(c.raw)} (${curTot ? Math.round((c.raw / curTot) * 100) : 0}%)` } } } } } };
  }, [cur, curTot]);

  /* Growth — returning + new (stacked) with total line */
  const growthCfg = useMemo(() => ({ type: 'bar',
    data: { labels: years.map(r => fyTiny(r.fy) + (r.live ? ' ●' : '')), datasets: [
      { type: 'line', label: 'Total clients', data: years.map(r => r.total), borderColor: TL, backgroundColor: TL, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderWidth: 2, tension: 0.3, cubicInterpolationMode: 'monotone', order: 0,
        datalabels: { display: true, align: 'top', anchor: 'end', color: TL, font: { size: 12, weight: '800' }, formatter: v => v } },
      { label: 'Returning', data: years.map(r => Math.max(0, r.total - r.newC)), backgroundColor: NV, stack: 'c', borderRadius: 3, order: 1, maxBarThickness: 46,
        datalabels: { display: c => c.dataset.data[c.dataIndex] > 0, color: '#fff', font: { size: 11, weight: '700' } } },
      { label: 'New', data: years.map(r => r.newC), backgroundColor: GD, stack: 'c', borderRadius: 3, order: 1, maxBarThickness: 46,
        datalabels: { display: c => c.dataset.data[c.dataIndex] > 0, color: '#fff', font: { size: 11, weight: '700' } } },
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: '#EDF0F5' }, ticks: { precision: 0 } } } },
  }), [years]);

  /* Roster for the selected FY */
  const roster = useMemo(() => {
    const r = years.find(y => y.fy === tabFy); if (!r) return [];
    const rev = byFy.get(tabFy);
    return r.names.map(n => { const c = rev?.get(clientKey(n)); return { name: n, isNew: !!r.newNames?.has(n), n: c?.n || 0, tot: c ? c.del + c.sch : 0 }; })
      .sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name));
  }, [years, tabFy, byFy, clientKey]);
  const tabRow = years.find(y => y.fy === tabFy);

  return (
    <>
      <div className="sc-tiles">
        <div className="sc-tile nv"><div className="sc-lb">Unique Clients</div><div className="sc-vl">{clientYears.unique}</div><div className="sc-sb">since inception · name variants merged</div></div>
        <div className="sc-tile tl"><div className="sc-lb">Active · {fyTiny(CURRENT_FY)}</div><div className="sc-vl">{yCur.total}
          {delta != null && <span className={`sc-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}</span>}</div>
          <div className="sc-sb">{yPrev ? `vs ${yPrev.total} in ${fyTiny(yPrev.fy)}` : 'clients with a session this FY'}</div></div>
        <div className="sc-tile gd"><div className="sc-lb">New · {fyTiny(CURRENT_FY)}</div><div className="sc-vl">{yCur.newC}</div><div className="sc-sb">{yCur.total ? `${Math.round((yCur.newC / yCur.total) * 100)}% of active clients` : 'first engagement this FY'}</div></div>
        <div className={`sc-tile ${topShare > 0.35 ? 'rd' : 'pu'}`}><div className="sc-lb">Top Client Share</div><div className="sc-vl">{curTot ? `${Math.round(topShare * 100)}%` : '--'}</div>
          <div className="sc-sb">{cur[0] ? `${cur[0].name} · ${L(cur[0].tot)}` : 'no revenue this FY yet'}{topShare > 0.35 ? ' · high concentration' : ''}</div></div>
      </div>

      <div className="cg c32">
        <div className="card flex-card"><h3>Revenue by Client — {fyTiny(CURRENT_FY)}</h3>
          <div className="cs">{L(curTot)} across {cur.length} clients · delivered vs scheduled (Price INR) · tap a client for its month-by-month view</div>
          {cur.length === 0 ? <div className="erd-empty">No revenue this FY yet</div> : (
            <div className="s-scroll" style={{ maxHeight: 420 }}>
              {cur.map((c, i) => {
                const isOpen = openC === c.key, mMax = Math.max(1, ...c.months);
                return (
                  <div key={c.key} className={`sc-row${isOpen ? ' open' : ''}`}>
                    <button type="button" className="sc-line" onClick={() => setOpenC(isOpen ? null : c.key)} aria-expanded={isOpen}>
                      <span className="sc-rank">{i + 1}</span>
                      <span className="sc-name" title={c.name}>{c.name}<em>{c.n} session{c.n === 1 ? '' : 's'}</em></span>
                      <span className="sc-track"><span className="sc-fill" style={{ width: `${(c.tot / maxTot) * 100}%` }}>
                        {c.del > 0 && <span className="del" style={{ flexGrow: c.del }} title={`Delivered ${L(c.del)}`} />}
                        {c.sch > 0 && <span className="sch" style={{ flexGrow: c.sch }} title={`Scheduled ${L(c.sch)}`} />}
                      </span></span>
                      <span className="sc-amt">{L(c.tot)}<em>{curTot ? Math.round((c.tot / curTot) * 100) : 0}%</em></span>
                    </button>
                    {isOpen && (
                      <div className="sc-months">
                        {c.months.map((v, m) => (
                          <div key={m} className="sc-m" title={`${MONTHS[m]}: ${L(v)}`}>
                            <div className="sc-m-bar"><span style={{ height: `${(v / mMax) * 100}%` }} className={v ? '' : 'zero'} /></div>
                            <div className="sc-m-lb">{MONTHS[m]}</div><div className="sc-m-vl">{v ? L(v).replace('₹', '') : '—'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="fr-legend sc-legend"><span><i style={{ background: TL }} />Delivered</span><span><i style={{ background: 'rgba(0,128,140,.35)' }} />Scheduled</span></div>
        </div>

        <div className="card flex-card"><h3>Client Mix — {fyTiny(CURRENT_FY)}</h3><div className="cs">Share of this FY's revenue · top 6 clients + others</div>
          {curTot ? <>
            <ChartBox config={mixCfg.cfg} className="ch-wrap" height={240} />
            <div className="sc-mix-legend">
              {mixCfg.legend.map(x => (
                <div key={x.l}><i style={{ background: x.c }} /><span title={x.l}>{x.l}</span><b>{L(x.v)}</b><em>{Math.round((x.v / curTot) * 100)}%</em></div>
              ))}
            </div>
          </> : <div className="erd-empty">No revenue this FY yet</div>}
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Client Growth by Financial Year</h3><div className="cs">Returning vs new clients per FY, total on the line · ● = live from the Engagement Calendar · earlier years from the baseline report</div>
          <ChartBox config={growthCfg} className="ch-wrap tall" />
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Client Roster</h3>
          <div className="sc-tabs">
            {years.slice().reverse().map(r => (
              <button key={r.fy} type="button" className={tabFy === r.fy ? 'on' : ''} onClick={() => setTabFy(r.fy)}>{fyTiny(r.fy)}<span>{r.total}</span></button>
            ))}
          </div>
          <div className="cs" style={{ marginTop: 8 }}>{tabRow ? `${tabRow.total} clients · ${tabRow.newC} new${tabRow.live ? ' · revenue and sessions from the Engagement Calendar' : ' · as recorded in the baseline report'}` : ''}</div>
          <div className="s-scroll" style={{ maxHeight: 300 }}>
            <div className="sc-roster">
              {roster.map(c => (
                <div key={c.name} className={`sc-client${c.isNew ? ' new' : ''}`}>
                  <div className="sc-client-top"><b title={c.name}>{c.name}</b>{c.isNew && <span className="sc-new">New</span>}</div>
                  {tabRow?.live && <div className="sc-client-sb">{c.n ? `${c.n} session${c.n === 1 ? '' : 's'} · ${L(c.tot)}` : 'no priced sessions'}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
