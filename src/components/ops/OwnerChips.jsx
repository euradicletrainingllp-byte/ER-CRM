/** Owner chips + "+ Add owner" (Admin Panel department members, grouped by department). */
export default function OwnerChips({ emails, departments, members, onChange, disabled, emptyText = 'No owner' }) {
  const nameOf = e => members.find(m => m.email === e)?.name || e.split('@')[0];
  const byDept = departments.map(d => ({ d, list: members.filter(m => m.deptId === d.id && !emails.includes(m.email)) })).filter(x => x.list.length);
  return (
    <div className="ov2-owners">
      {emails.map(e => (
        <span key={e} className="ov2-chip" title={e}>{nameOf(e)}
          {!disabled && <button type="button" onClick={() => onChange(emails.filter(x => x !== e), nameOf)} aria-label="Remove owner">×</button>}
        </span>
      ))}
      {!emails.length && <span className="ov2-muted">{emptyText}</span>}
      {!disabled && !!byDept.length && (
        <select className="form-input ov2-mini" value="" onChange={e => e.target.value && onChange([...emails, e.target.value], nameOf)}>
          <option value="">+ Add owner</option>
          {byDept.map(({ d, list }) => <optgroup key={d.id} label={d.name}>{list.map(m => <option key={m.id} value={m.email}>{m.name || m.email}</option>)}</optgroup>)}
        </select>
      )}
    </div>
  );
}

/** Several departments per step: chips + "+ Dept" picker. Value/onChange use "A; B" text. */
export function DeptChips({ value, departments, onChange, disabled }) {
  const list = String(value ?? '').split(';').map(x => x.trim()).filter(Boolean);
  const free = departments.filter(d => d.active !== false && !list.some(x => x.toLowerCase() === d.name.toLowerCase()));
  const set = l => onChange([...new Set(l)].join('; '));
  return (
    <div className="ov2-owners">
      {list.map(d => (
        <span key={d} className="ov2-chip dept">{d}
          {!disabled && list.length > 1 && <button type="button" onClick={() => set(list.filter(x => x !== d))} aria-label={`Remove ${d}`}>×</button>}
        </span>
      ))}
      {!list.length && <span className="ov2-muted">No department</span>}
      {!disabled && !!free.length && (
        <select className="form-input ov2-mini" value="" onChange={e => e.target.value && set([...list, e.target.value])}>
          <option value="">+ Dept</option>
          {free.map(d => <option key={d.id}>{d.name}</option>)}
        </select>
      )}
    </div>
  );
}
