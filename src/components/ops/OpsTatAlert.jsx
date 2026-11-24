/**
 * OpsTatAlert — red HIGH ALERT strip under the TopBar on every page (Ops access only).
 * Shows active programs with a step past its TAT; cannot be dismissed; refreshes every 15 min.
 * Data: opsV2Data.js (same summary Dashboard / Founder's Desk use).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions.js';
import { peekOpsPrograms, getOpsChecklist, onOpsProgramsChange } from '../../services/opsV2Data.js';
import { isOpsV2Ready } from '../../services/opsV2Api.js';
import '../../styles/opsV2.css';

const REFRESH_MS = 15 * 60 * 1000;
const ACTIVE = p => !['Closed', 'Delivered'].includes(p.checklistStatus);

export default function OpsTatAlert() {
  const { canAccess } = usePermissions();
  const allowed = canAccess('ops') && isOpsV2Ready();
  const [rows, setRows] = useState(() => peekOpsPrograms() || []);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!allowed) return undefined;
    const off = onOpsProgramsChange(r => setRows(r || []));
    const pull = () => getOpsChecklist({ force: true }).catch(() => {});
    if (!peekOpsPrograms()) pull();
    const id = setInterval(pull, REFRESH_MS);
    return () => { off(); clearInterval(id); };
  }, [allowed]);

  if (!allowed) return null;
  const late = (rows || []).filter(p => ACTIVE(p) && p.tatMissed).sort((a, b) => (b.maxLate || 0) - (a.maxLate || 0));
  if (!late.length) return null;
  const steps = late.reduce((n, p) => n + (p.lateItems || 0), 0);
  const onPage = pathname === '/ops' && search.includes('alert=tat');

  return (
    <button type="button" className="ops-tat-alert" onClick={() => navigate('/ops?alert=tat')} aria-live="polite"
      title={late.map(p => `${p.company} · ${p.topic} — ${p.lateItems} late, worst ${p.maxLate}d`).join('\n')}>
      <span className="ops-tat-dot" />
      <b>HIGH ALERT</b>
      <span>{late.length} program{late.length > 1 ? 's' : ''} past TAT · {steps} step{steps > 1 ? 's' : ''} late</span>
      <span className="ops-tat-list">{late.slice(0, 3).map(p => `${p.company} (${p.maxLate}d)`).join(' · ')}{late.length > 3 ? ` +${late.length - 3} more` : ''}</span>
      {!onPage && <span className="ops-tat-go">View →</span>}
    </button>
  );
}
