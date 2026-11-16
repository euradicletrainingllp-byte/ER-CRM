import { useEffect, useState } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';

// Phones only (CSS shows it on tracker pages): the tracker's top panels
// (views, period, KPIs, filters, action buttons) fold into this bar so the list gets the screen.
export default function MobilePanelBar({ path }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle('tp-open', open);
    return () => document.documentElement.classList.remove('tp-open');
  }, [open]);
  return (
    <button type="button" className={`tp-bar${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
      <SlidersHorizontal size={16} strokeWidth={2} />
      <span>{open ? 'Hide views, filters & actions' : 'Views, filters & actions'}</span>
      <ChevronDown size={18} strokeWidth={2} className="tp-chev" />
    </button>
  );
}
