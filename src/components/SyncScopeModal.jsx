import { useState } from 'react';
import { syncScopeFrom, hasInterruptedSync } from '../services/syncEngine.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Asks which Engagement Calendar rows to sync before a manual sync starts.
 *   'recent' → from the 1st of last month onward (last month, this month, all upcoming)
 *   'all'    → every engagement in the calendar (slower)
 */
export default function SyncScopeModal({ target, onConfirm, onClose }) {
  const [scope, setScope] = useState('recent');
  const from = syncScopeFrom();
  const fromLabel = `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const interrupted = hasInterruptedSync();

  const option = (value, title, desc) => (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
      border: `1.5px solid ${scope === value ? 'var(--accent, #e8760a)' : '#e2e8f0'}`,
      background: scope === value ? '#fff7ed' : '#fff',
      borderRadius: 8, padding: '10px 12px', marginBottom: 10,
    }}>
      <input type="radio" name="sync-scope" value={value} checked={scope === value}
             onChange={() => setScope(value)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: '#1a3a5c' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>{desc}</span>
      </span>
    </label>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">🔄 Sync {target} with Engagement Calendar</div>

        {option('recent', 'Recent changes (recommended)',
          `Engagements from ${fromLabel} onward — last month, this month and all upcoming months. Fast.`)}
        {option('all', 'Whole Engagement Calendar',
          'Every engagement in the calendar, including past years. Slower — use after bulk edits to old rows.')}

        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 14px' }}>
          Only rows that are missing or different are written. If any step fails,
          every change from this sync is undone, so {target} stays exactly as it was.
        </p>
        {interrupted && (
          <p style={{ fontSize: 12, color: '#9a3412', background: '#ffedd5', borderRadius: 6, padding: '8px 10px', margin: '0 0 14px' }}>
            ↩ An earlier sync was interrupted. Its partial changes will be undone first, then this sync runs.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => onConfirm(scope)}>Start sync</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
