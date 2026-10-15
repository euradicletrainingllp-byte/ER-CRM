/**
 * Shared Chart.js setup for the Operations and Solutioning dashboards.
 * Charts, colours and label styles match the standalone "EuRadicle Dashboard" HTML report.
 * Chart.js + the datalabels plugin are loaded once from cdnjs (same versions as the HTML report).
 */
import { useEffect, useRef, useState } from 'react';
import './erdDashboard.css';

const SCRIPTS = [
  ['Chart', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'],
  ['ChartDataLabels', 'https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js'],
];
let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not download ' + src.split('/').pop()));
    document.head.appendChild(s);
  });
}

export function loadChartJs() {
  if (!loading) {
    loading = (async () => {
      for (const [g, src] of SCRIPTS) if (!window[g]) await loadScript(src);
      const Chart = window.Chart;
      if (!Chart.__erdConfigured) {
        Chart.defaults.font.family = "'Segoe UI',system-ui,sans-serif";
        Chart.defaults.font.size = 13;
        Chart.defaults.color = '#374151';
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
        Chart.defaults.plugins.legend.labels.boxHeight = 9;
        Chart.defaults.plugins.legend.labels.font = { size: 13 };
        Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: '700' };
        Chart.defaults.plugins.tooltip.bodyFont = { size: 13 };
        Chart.defaults.datasets.bar.categoryPercentage = 0.55;
        Chart.defaults.datasets.bar.barPercentage = 0.8;
        Chart.defaults.datasets.bar.maxBarThickness = 46;
        Chart.register(window.ChartDataLabels);
        Chart.defaults.plugins.datalabels = { display: false };
        Chart.__erdConfigured = true;
      }
      return Chart;
    })().catch(e => { loading = null; throw e; });
  }
  return loading;
}

/** One Chart.js chart. `config` must be memoised — a new object redraws the chart. */
export function ChartBox({ config, className = 'ch-wrap', height }) {
  const canvas = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let chart = null, dead = false;
    loadChartJs()
      .then(Chart => { if (!dead && canvas.current) chart = new Chart(canvas.current.getContext('2d'), config); })
      .catch(e => setErr(e.message));
    return () => { dead = true; chart?.destroy(); };
  }, [config]);
  return (
    <div className={className} style={height ? { height } : undefined}>
      {err ? <div className="erd-err">Charts could not load ({err}). Check the internet connection and refresh.</div>
           : <canvas ref={canvas} />}
    </div>
  );
}

/* ─── Palette (same as the HTML report) ─── */
export const NV = '#1B2A4A', TL = '#00808C', GD = '#E8A020', GN = '#2DBD7E', PU = '#7C5CBF', RD = '#E05252';
const DL = '#374151';
const GRID = '#EDF0F5';

/* ─── Formatting ─── */
export const fmtNum = n => (Number.isInteger(n) ? String(n) : Number(n || 0).toFixed(2));
export function fmtInr(v) {
  v = Math.abs(v || 0);
  if (v >= 1e7) return 'Rs.' + (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return 'Rs.' + (v / 1e5).toFixed(2) + 'L';
  if (v >= 1e3) return 'Rs.' + (v / 1e3).toFixed(1) + 'K';
  return 'Rs.' + Math.round(v);
}
// rows get extra room so 12–13px labels never overlap
/** Compact ₹ for axes and labels inside bars: 2.40Cr, 51.0L, 94.5K */
export function fmtShort(v) {
  v = Math.abs(v || 0);
  if (v >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
/** Show a ₹ axis as 1Cr / 50L instead of 10,000,000. */
export function inrAxis(opts, axis) {
  opts.scales[axis] = { ...opts.scales[axis], ticks: { ...(opts.scales[axis].ticks || {}), callback: v => fmtShort(v) } };
  return opts;
}
export const heightFor = (n, per = 22, min = 220) => Math.max(min + 40, Math.round(n * per * 1.25));

/* ─── Datalabel styles ─── */
export const dlNum   = () => ({ display: true, anchor: 'end', align: 'end', formatter: v => (v > 0 ? v : ''), font: { size: 13, weight: '600' }, color: DL, padding: 2 });
export const dlInr   = () => ({ display: true, anchor: 'end', align: 'end', formatter: v => (v > 0 ? fmtInr(v) : ''), font: { size: 12, weight: '600' }, color: DL, padding: 2 });
export const dlStack = () => ({ display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'center', align: 'center', formatter: v => (v > 0 ? v : ''), font: { size: 13, weight: '700' }, color: '#fff' });
export const dlStackInr = () => ({ display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'center', align: 'center', formatter: v => (v > 0 ? fmtShort(v) : ''), font: { size: 11, weight: '700' }, color: '#fff' });
export const dlH     = () => ({ display: true, anchor: 'end', align: 'right', formatter: v => (v > 0 ? fmtNum(v) : ''), font: { size: 13, weight: '600' }, color: DL, clamp: true, padding: { left: 4 } });
export const dlInrH  = () => ({ display: true, anchor: 'end', align: 'right', formatter: v => (v > 0 ? fmtInr(v) : ''), font: { size: 12, weight: '600' }, color: DL, clamp: true, padding: { left: 4 } });

/* ─── Axis options ─── */
export function bOpts(stacked, horiz) {
  return {
    responsive: true, maintainAspectRatio: false,
    layout: { padding: { right: horiz ? 44 : 0 } },
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { stacked, grid: { display: !!horiz, color: GRID }, ticks: { font: { size: 12 } } },
      y: { stacked, grid: { color: GRID, display: !horiz }, ticks: { font: { size: 12 } } },
    },
  };
}

/* ─── Date / FY helpers ─── */
export const pad2 = n => String(n).padStart(2, '0');
export const todayISO = (() => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; })();
export const fyStartOf = iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; };
export const CURRENT_FY = fyStartOf(todayISO);
export const fyShort = y => `${y}-${pad2((y + 1) % 100)}`;          // 2026-27
export const fyLong  = y => `FY ${y}-${pad2((y + 1) % 100)}`;       // FY 2026-27
export const fyTiny  = y => `FY ${pad2(y % 100)}-${pad2((y + 1) % 100)}`; // FY 26-27
export const clean = v => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
export const keyOf = v => clean(v).toLowerCase();

/** Small KPI tile, same look as the HTML report. */
export function Kpi({ tone, label, value, sub, tag, tagTone = 'info' }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="lb">{label}</div>
      <div className="vl">{value}</div>
      <div className="sb">{sub}</div>
      {tag && <span className={`tg ${tagTone}`}>{tag}</span>}
    </div>
  );
}

/** Note under the page header saying which years are live. */
export function SourceNote({ live, fixed }) {
  return (
    <div className="erd-src">
      <span className="erd-live-dot" /> <strong>Live:</strong> {live}
      <span className="erd-src-sep">·</span>
      <strong>Fixed:</strong> {fixed}
    </div>
  );
}
