import { useState } from 'react';
import KpiListModal from './KpiListModal.jsx';

export default function KPICard({ label, value, sub, icon, variant = '', how, list, listSub, onClick, style }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`kpi-card ${variant}`} onClick={list ? () => setOpen(true) : onClick} style={list ? { cursor: 'pointer', ...style } : style} title={list ? 'Click to see the list' : undefined}>
      {open && <div onClick={e => e.stopPropagation()}><KpiListModal title={label} sub={listSub} items={list} onClose={() => setOpen(false)} /></div>}
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {how && <div className="kpi-how" title={how}>How: {how}</div>}
    </div>
  );
}
