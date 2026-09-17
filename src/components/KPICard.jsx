export default function KPICard({ label, value, sub, icon, variant = '' }) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
