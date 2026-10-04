import { OPS_CHECKLIST_ITEMS, parseChecklist, serializeChecklist } from '../config/opsChecklistItems.js';

/**
 * ChecklistPicker — tick the Operations Checklist items that must be arranged.
 * value / onChange use the stored text form ("Participant Manual; Feedback Report").
 */
export default function ChecklistPicker({ value, onChange, readOnly = false, required = false }) {
  const selected = new Set(parseChecklist(value));
  const toggle = key => {
    if (readOnly) return;
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(serializeChecklist([...next]));
  };
  const missing = required && selected.size === 0;

  return (
    <div style={{
      border: `1px solid ${missing ? '#fca5a5' : 'var(--border, #e2e8f0)'}`,
      background: missing ? '#fef2f2' : '#f8fafc', borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
          {selected.size} of {OPS_CHECKLIST_ITEMS.length} selected
        </span>
        {!readOnly && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-outline btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => onChange(serializeChecklist(OPS_CHECKLIST_ITEMS.map(i => i.key)))}>Select all</button>
            <button type="button" className="btn btn-outline btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => onChange('')}>Clear</button>
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '4px 12px' }}>
        {OPS_CHECKLIST_ITEMS.map(it => (
          <label key={it.key} style={{
            display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '3px 2px',
            cursor: readOnly ? 'default' : 'pointer', color: selected.has(it.key) ? '#0f172a' : '#64748b',
            fontWeight: selected.has(it.key) ? 600 : 400,
          }}>
            <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} disabled={readOnly}
              style={{ accentColor: '#e8760a', width: 15, height: 15 }} />
            {it.label}
          </label>
        ))}
      </div>
      {missing && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>
          Tick at least one item so Operations knows what to arrange.
        </div>
      )}
    </div>
  );
}

/** Read-only chips for a stored checklist value. */
export function ChecklistChips({ value, empty = '—' }) {
  const keys = parseChecklist(value);
  if (!keys.length) return <span style={{ color: '#94a3b8' }}>{empty}</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {OPS_CHECKLIST_ITEMS.filter(it => keys.includes(it.key)).map(it => (
        <span key={it.key} style={{ fontSize: 11, fontWeight: 600, background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: 12, padding: '1px 8px' }}>
          {it.label}
        </span>
      ))}
    </div>
  );
}
