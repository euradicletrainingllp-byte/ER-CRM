export default function KPICard({ label, value, sub, icon, variant = '', how }) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {how && <div className="kpi-how" title={how}>How: {how}</div>}
    </div>
  );
}
