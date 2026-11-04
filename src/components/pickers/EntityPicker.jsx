/**
 * EntityPicker — the one typeahead used by every picker.
 * - Looks and behaves like the plain 44px text box it replaces: typing still sets the field (free text allowed).
 * - Suggestions open on focus / typing; ↑ ↓ Enter pick, Esc closes. A pick calls onChange(text) and onPick(item).
 * - multiple: the field holds "A; B; C". Suggestions match the part being typed; a pick replaces that part.
 * - "＋ Add …" row pinned at the bottom when onAdd is given. Optional footer link (e.g. Open Consultant Directory).
 * - Grey "Not in directory" chip when the text is not a known entry (matched === false).
 * The list is drawn in a fixed layer on <body>, so modal scroll areas never clip it.
 */
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const SEP = /\s*[;\n]\s*/;
const splitParts = v => String(v ?? '').split(SEP);

export default function EntityPicker({
  value, onChange, onPick, options = [], filter, multiple = false, joiner = '; ',
  onAdd, addLabel, footer, matched, chipText = 'Not in directory', placeholder, disabled,
  className = 'form-input', inputType = 'text', maxShown = 30, emptyText, id, title, autoFocus, onBlur, inputMode, style,
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const parts = multiple ? splitParts(value) : [String(value ?? '')];
  const term = parts[parts.length - 1] || '';
  const chosen = multiple ? new Set(parts.slice(0, -1).map(s => s.trim().toLowerCase()).filter(Boolean)) : null;

  const shown = useMemo(() => {
    const list = filter ? filter(term) : options;
    return (chosen ? list.filter(o => !chosen.has(String(o.value).toLowerCase())) : list).slice(0, maxShown);
  }, [filter, options, term, value, multiple, maxShown]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = onAdd && term.trim() && !shown.some(o => String(o.value).trim().toLowerCase() === term.trim().toLowerCase());
  const rows = shown.length + (addRow ? 1 : 0);

  const place = () => { const r = inputRef.current?.getBoundingClientRect(); if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width, bottomSpace: window.innerHeight - r.bottom, topY: r.top }); };
  useLayoutEffect(() => { if (open) place(); }, [open, value]);
  useEffect(() => {
    if (!open) return undefined;
    const h = () => place();
    window.addEventListener('scroll', h, true); window.addEventListener('resize', h);
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h); };
  }, [open]);
  useEffect(() => { setHi(0); }, [term]);
  useEffect(() => { listRef.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const setText = t => onChange?.(t);
  const pick = o => {
    const v = String(o.value ?? '');
    if (multiple) {
      const keep = parts.slice(0, -1).map(s => s.trim()).filter(Boolean);
      setText([...keep, v].join(joiner) + joiner);
    } else { setText(v); setOpen(false); }
    onPick?.(o.item ?? o);
  };
  const add = () => { setOpen(false); onAdd?.(term.trim()); };

  const onKey = e => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); e.preventDefault(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { setHi(h => Math.min(rows - 1, h + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHi(h => Math.max(0, h - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (hi < shown.length && shown[hi]) { pick(shown[hi]); e.preventDefault(); }
      else if (addRow && hi === shown.length) { add(); e.preventDefault(); }
    } else if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const tidy = () => {
    // Trailing "; " left after a multiple pick is removed when leaving the field
    if (multiple) { const t = String(value ?? ''); const c = splitParts(t).map(s => s.trim()).filter(Boolean).join(joiner); if (c !== t) setText(c); }
  };

  const showChip = matched === false && String(value ?? '').trim() !== '' && !open;   // hidden while choosing
  const up = rect && rect.bottomSpace < 260 && rect.topY > 300;
  const layer = open && rect && (rows > 0 || footer || emptyText) && createPortal(
    <div className="ep-pop" ref={listRef} role="listbox"
      style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(Math.max(rect.width, 260), window.innerWidth - 16) - 8)), width: Math.min(Math.max(rect.width, 260), window.innerWidth - 16), ...(up ? { bottom: window.innerHeight - rect.topY + 4 } : { top: rect.top }) }}
      onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
      <div className="ep-rows">
        {shown.map((o, i) => (
          <div key={o.key ?? o.value} role="option" aria-selected={i === hi} data-hi={i === hi ? '1' : undefined}
            className={`ep-row${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
            <div className="ep-name">{o.label ?? o.value}</div>
            {o.sub && <div className="ep-sub">{o.sub}</div>}
          </div>
        ))}
        {!shown.length && emptyText && <div className="ep-empty">{emptyText}</div>}
      </div>
      {addRow && (
        <div className={`ep-add${hi === shown.length ? ' hi' : ''}`} data-hi={hi === shown.length ? '1' : undefined}
          onMouseEnter={() => setHi(shown.length)} onClick={add}>＋ {addLabel ? addLabel(term.trim()) : `Add “${term.trim()}”`}</div>
      )}
      {footer && <div className="ep-foot">{footer}</div>}
    </div>, document.body);

  return (
    <div className="ep-wrap">
      <input ref={inputRef} id={id} title={title} type={inputType} inputMode={inputMode} autoFocus={autoFocus} style={showChip && style ? { ...style, paddingRight: 132 } : style}
        className={`${className}${showChip ? ' ep-has-chip' : ''}`} value={value ?? ''} placeholder={placeholder} disabled={disabled}
        autoComplete="off" role="combobox" aria-expanded={open}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onBlur={e => { setOpen(false); tidy(); onBlur?.(e); }} onKeyDown={onKey} />
      {showChip && <span className="ep-chip" title="This name is not in the directory — it is saved as typed">{chipText}</span>}
      {layer}
    </div>
  );
}
