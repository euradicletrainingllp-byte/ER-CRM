export default function Pagination({ page, totalPages, total, perPage, onPage }) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * perPage + 1;
  const to   = Math.min(page * perPage, total);

  const pages = [];
  const WINDOW = 3;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= WINDOW) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <div className="pagination">
      <span className="page-info">
        {from}–{to} of {total}
      </span>
      <button className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => onPage(page - 1)}>
        ‹
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--muted)' }}>…</span>
        ) : (
          <button
            key={p}
            className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        )
      )}
      <button className="btn btn-outline btn-sm" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        ›
      </button>
    </div>
  );
}
