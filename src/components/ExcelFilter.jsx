import { useState, useEffect, useRef, useMemo } from 'react';

/* Shared Excel-style column filters for engagement data
   (used by Engagement Calendar and ER Calendar).                          */

/* ─── Excel-style filter configuration ─────────────────────────────────────
   Every categorical column of the Engagement Calendar can be filtered.
   get(e) returns a value or an array of values (e.g. all consultants).   */
const BLANK = '(Blanks)';
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthOf = e => {
  const m = Number(String(e.startDate || '').slice(5, 7));
  return m >= 1 && m <= 12 ? MONTH_NAMES[m - 1] : '';
};

export const FILTER_COLUMNS = [
  { key: 'year',        label: 'Year',         get: e => String(e.startDate || '').slice(0, 4), order: 'desc', sortBy: e => e.startDate || '' },
  { key: 'month',       label: 'Month',        get: monthOf, order: 'month', sortBy: e => String(e.startDate || '').slice(5) },
  { key: 'status',      label: 'Status',       get: e => e.status },
  { key: 'company',     label: 'Company',      get: e => e.company },
  { key: 'topic',       label: 'Topic',        get: e => e.topic },
  { key: 'sector',      label: 'Sector',       get: e => e.sector },
  { key: 'serviceType', label: 'Service Type', get: e => e.serviceType },
  { key: 'offering',    label: 'Offering',     get: e => e.offering },
  { key: 'day',         label: 'Days',         get: e => (e.day ? String(e.day) : ''), sortBy: e => Number(e.day) || 0 },
  { key: 'location',    label: 'Location',     get: e => e.location },
  { key: 'consultant',  label: 'Consultant',   get: e => [e.consultant1, e.consultant2, e.consultant3] },
  { key: 'contract',    label: 'Contract Type',    get: e => e.contract },
  { key: 'poStatus',    label: 'Contract Status',   get: e => e.poStatus },
  { key: 'payment',     label: 'Payment Status',   get: e => e.payment },
  { key: 'nps',         label: 'NPS',          get: e => (e.nps !== '' && e.nps != null ? String(e.nps) : '') },
];

// Normalised list of values for one row + column; blank cells become "(Blanks)"
function cellValues(e, col) {
  const raw = col.get(e);
  const arr = (Array.isArray(raw) ? raw : [raw])
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : [BLANK];
}

function sortFilterValues(vals, col) {
  const cmp = (a, b) => {
    if (a === BLANK) return 1;
    if (b === BLANK) return -1;
    if (col.order === 'month') return MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b);
    const r = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return col.order === 'desc' ? -r : r;
  };
  return [...vals].sort(cmp);
}

/* ─── Excel-style multi-select filter dropdown ──────────────────────────────
   selected: undefined = all values shown; Set = only these values shown.
   options:  [{ value, count }] — values available given the OTHER filters.
   universe: every value this column has in the full data set.              */
export function ExcelFilter({ label, options, universe, selected, onChange, sortDir, onSort }) {
  const [open, setOpen]         = useState(false);
  const [search, setSearch]     = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const active    = !!selected;
  const isChecked = v => !selected || selected.has(v);
  const visible   = options.filter(o => o.value.toLowerCase().includes(search.toLowerCase()));
  const searching = search.trim().length > 0;

  const commit = next => {
    // Everything ticked again → remove the filter (back to "All")
    if (next && universe.every(v => next.has(v))) onChange(undefined);
    else onChange(next);
  };

  const toggle = v => {
    const next = new Set(selected || universe);
    if (next.has(v)) next.delete(v); else next.add(v);
    commit(next);
  };

  // (Select All) — with a search term it behaves like Excel's
  // "(Select All Search Results)": show only the matching values.
  const allVisibleChecked = visible.length > 0 && visible.every(o => isChecked(o.value));
  const someVisibleChecked = visible.some(o => isChecked(o.value));
  const toggleAll = () => {
    if (searching) {
      if (allVisibleChecked) {
        const next = new Set(selected || universe);
        visible.forEach(o => next.delete(o.value));
        commit(next);
      } else {
        commit(new Set(visible.map(o => o.value)));
      }
    } else {
      commit(active ? undefined : new Set());
    }
  };

  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleChecked && !allVisibleChecked;
  });

  const openMenu = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAlignRight(r.left + 300 > window.innerWidth);
    }
    setOpen(o => !o);
    setSearch('');
  };

  const menuBtn = on => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '6px 14px', border: 'none', background: on ? '#eff6ff' : 'transparent',
    color: on ? '#1e40af' : '#1a3a5c', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer',
  });

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={openMenu}
        title={active ? `${label}: ${[...selected].join(', ') || '(none)'}` : `Filter by ${label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 12px',
          border: `1px solid ${active || sortDir ? '#2563eb' : '#e2e8f0'}`,
          borderRadius: 7,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#1e40af' : '#1a3a5c',
          fontWeight: active ? 700 : 600,
          fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {label}
        {sortDir && <span style={{ fontSize: 11, color: '#2563eb' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
        {active && (
          <span style={{ background: '#2563eb', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
            {selected.size}
          </span>
        )}
        <span style={{ fontSize: 10, color: active ? '#2563eb' : '#94a3b8' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', [alignRight ? 'right' : 'left']: 0, marginTop: 4,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 600,
          width: 280, padding: '6px 0 10px',
        }}>
          {/* Sort — like Excel's "Sort A to Z / Z to A" */}
          {onSort && <button style={menuBtn(sortDir === 'asc')}  onClick={() => onSort(sortDir === 'asc'  ? null : 'asc')}>↑ Sort A → Z</button>}
          {onSort && <button style={menuBtn(sortDir === 'desc')} onClick={() => onSort(sortDir === 'desc' ? null : 'desc')}>↓ Sort Z → A</button>}
          <button
            style={{ ...menuBtn(false), color: active ? '#dc2626' : '#cbd5e1', cursor: active ? 'pointer' : 'default' }}
            disabled={!active}
            onClick={() => onChange(undefined)}
          >✕ Clear Filter from “{label}”</button>

          <div style={{ borderTop: '1px solid #f1f5f9', margin: '6px 0 8px' }} />

          {/* Search within filter */}
          <div style={{ padding: '0 10px 8px' }}>
            <input
              autoFocus
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Value list */}
          <div style={{ maxHeight: 240, overflowY: 'auto', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
            {visible.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1a3a5c' }}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleChecked}
                  onChange={toggleAll}
                  style={{ width: 14, height: 14, accentColor: '#2563eb', cursor: 'pointer' }}
                />
                {searching ? '(Select All Search Results)' : '(Select All)'}
              </label>
            )}
            {visible.length === 0 && (
              <div style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8' }}>No matches</div>
            )}
            {visible.map(({ value, count }) => {
              const checked = isChecked(value);
              return (
                <label
                  key={value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '5px 14px', cursor: 'pointer', fontSize: 12,
                    color: count === 0 ? '#94a3b8' : '#1a3a5c',
                    background: checked && active ? '#eff6ff' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(value)}
                    style={{ width: 14, height: 14, accentColor: '#2563eb', cursor: 'pointer' }}
                  />
                  <span title={value} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: value === BLANK ? 'italic' : 'normal' }}>{value}</span>
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>{count}</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px 0' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {active ? `${selected.size} of ${universe.length} selected` : `All ${universe.length} values`}
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{ fontSize: 12, padding: '4px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── useExcelFilters — filter + sort state for a list of engagements ─── */
export function useExcelFilters(data, columns = FILTER_COLUMNS) {
  const [filters, setFilters] = useState({});
  const [sort, setSort]       = useState(null);

  const setColumnFilter = (key, next) =>
    setFilters(prev => {
      const copy = { ...prev };
      if (next) copy[key] = next; else delete copy[key];
      return copy;
    });

  const rowValues = useMemo(() =>
    data.map(e => {
      const m = {};
      columns.forEach(c => { m[c.key] = cellValues(e, c); });
      return m;
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data]);

  const passes = (vals, exceptKey) =>
    Object.entries(filters).every(([k, set]) => k === exceptKey || !vals[k] || vals[k].some(v => set.has(v)));

  const universes = useMemo(() => {
    const u = {};
    columns.forEach(c => {
      const s = new Set();
      rowValues.forEach(v => v[c.key].forEach(x => s.add(x)));
      u[c.key] = sortFilterValues(s, c);
    });
    return u;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowValues]);

  // Values + counts in each dropdown, narrowed by the OTHER active filters (like Excel)
  const filterOptions = useMemo(() => {
    const out = {};
    columns.forEach(c => {
      const counts = new Map();
      rowValues.forEach(v => {
        if (!passes(v, c.key)) return;
        v[c.key].forEach(x => counts.set(x, (counts.get(x) || 0) + 1));
      });
      (filters[c.key] ? [...filters[c.key]] : []).forEach(x => { if (!counts.has(x)) counts.set(x, 0); });
      out[c.key] = sortFilterValues([...counts.keys()], c).map(value => ({ value, count: counts.get(value) }));
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowValues, filters]);

  const filtered = useMemo(() => {
    const rows = data.filter((e, i) => passes(rowValues[i]));
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return rows;
    const keyOf = e => {
      if (col.sortBy) return col.sortBy(e);
      const v = cellValues(e, col)[0];
      return v === BLANK ? '' : v;
    };
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const ka = keyOf(a), kb = keyOf(b);
      if (ka === '' && kb !== '') return 1;   // blanks always last, like Excel
      if (kb === '' && ka !== '') return -1;
      const r = typeof ka === 'number' && typeof kb === 'number'
        ? ka - kb
        : String(ka).localeCompare(String(kb), undefined, { numeric: true, sensitivity: 'base' });
      return r * dir;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rowValues, filters, sort]);

  const activeFilters = Object.keys(filters).length;
  const clearAll = () => { setFilters({}); setSort(null); };

  return { columns, filters, setColumnFilter, filterOptions, universes, filtered, sort, setSort, activeFilters, clearAll };
}

/* ─── ExcelFilterButtons — renders one dropdown per column + "Clear all" ─── */
export function ExcelFilterButtons({ state, sortable = true }) {
  const { columns, filters, setColumnFilter, filterOptions, universes, sort, setSort, activeFilters, clearAll } = state;
  return (
    <>
      {columns.map(c => (
        <ExcelFilter
          key={c.key}
          label={c.label}
          options={filterOptions[c.key] || []}
          universe={universes[c.key] || []}
          selected={filters[c.key]}
          onChange={next => setColumnFilter(c.key, next)}
          sortDir={sortable && sort?.key === c.key ? sort.dir : null}
          onSort={sortable ? (dir => setSort(dir ? { key: c.key, dir } : null)) : undefined}
        />
      ))}
      {(activeFilters > 0 || sort) && (
        <button
          onClick={clearAll}
          style={{ fontSize: 12, padding: '5px 12px', border: '1px solid #dc2626', borderRadius: 7, background: '#fee2e2', color: '#dc2626', fontWeight: 700, cursor: 'pointer', marginLeft: 4 }}
        >
          ✕ Clear all{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
      )}
    </>
  );
}
