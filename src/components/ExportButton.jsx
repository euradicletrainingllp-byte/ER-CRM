import { Download } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions.js';
import { downloadXlsx } from '../utils/exportExcel.js';
import { logEvent } from '../services/auditLogger.js';

/**
 * ExportButton — downloads the rows currently shown (filters + search applied) as .xlsx.
 * Only visible to users with Edit (Update) access on that page. Admins always see it.
 *
 * Props:
 *   page      — permission key ('bd', 'solution', 'engagement', 'ops', 'content-dev')
 *   filename  — file name without date / extension (e.g. 'BD Tracker')
 *   columns   — [{ label, get: row => value }] or [{ label, key }]
 *   rows      — rows to export (pass a function to build them lazily)
 */
export default function ExportButton({ page, filename, sheetName, columns, rows, disabled, style }) {
  const { canUpdate } = usePermissions();
  if (!canUpdate(page)) return null;

  function handleExport() {
    try {
      const data = typeof rows === 'function' ? rows() : (rows || []);
      const cols = typeof columns === 'function' ? columns(data) : columns;
      if (!data.length) { alert('There are no rows to export with the current filters.'); return; }
      downloadXlsx({ filename, sheetName, columns: cols, rows: data });
      try { logEvent({ Category: 'DATA', Action: 'EXPORT', Module: page, RecordLabel: `${filename} (${data.length} rows)` }); } catch { /* ignore */ }
    } catch (e) {
      alert('Export failed: ' + (e?.message || e));
    }
  }

  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      onClick={handleExport}
      disabled={disabled}
      title="Export the rows shown (with current filters) to Excel"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', ...style }}
    >
      <Download size={14} /> Export
    </button>
  );
}
