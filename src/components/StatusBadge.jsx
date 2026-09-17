const MAP = {
  Delivered:      'badge-green',
  Scheduled:      'badge-blue',
  Confirmed:      'badge-blue',
  Won:            'badge-green',
  Received:       'badge-green',
  Tentative:      'badge-yellow',
  'Proposal Sent':'badge-orange',
  'In Process':   'badge-orange',
  'In Progress':  'badge-orange',
  Pending:        'badge-yellow',
  Cancelled:      'badge-red',
  Lost:           'badge-red',
  'Re-Schedule':  'badge-purple',
  Postponed:      'badge-gray',
  PO:             'badge-blue',
  SOW:            'badge-purple',
  NA:             'badge-gray',
  Yes:            'badge-green',
};

export default function StatusBadge({ value }) {
  if (!value) return <span className="badge badge-gray">—</span>;
  const cls = MAP[value] ?? 'badge-gray';
  return <span className={`badge ${cls}`}>{value}</span>;
}
