/**
 * LinkButton — opens a saved link in a new browser tab.
 * LinkInput  — text input for a URL with an "Open" button beside it.
 *
 * Used for every link the trackers store (proposal links, content assets,
 * pre-work, post-work …).
 */

/** Adds https:// when the link was saved without a scheme (e.g. "drive.google.com/…"). */
export function normaliseUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|file:)/i.test(s)) return s;
  if (/^\\\\/.test(s)) return 'file:' + s.replace(/\\/g, '/');   // \\server\share path
  return 'https://' + s.replace(/^\/+/, '');
}

export function openLink(raw) {
  const url = normaliseUrl(raw);
  if (!url) return;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) w.opener = null;
}

export function LinkButton({ url, label = 'Open', title, compact = false, style }) {
  const href = normaliseUrl(url);
  if (!href) return compact ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span> : null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title || href}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: compact ? '2px 8px' : '4px 10px',
        borderRadius: 6, border: '1px solid #93c5fd', background: '#eff6ff',
        color: '#1d4ed8', fontSize: compact ? 11 : 12, fontWeight: 700,
        textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer', lineHeight: 1.4,
        ...style,
      }}
    >
      🔗 {label} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function LinkInput({ value, onChange, placeholder = 'https://…', inputStyle, className }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
      <input
        className={className}
        style={{ flex: 1, minWidth: 0, ...inputStyle }}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {String(value || '').trim() && <LinkButton url={value} />}
    </div>
  );
}
