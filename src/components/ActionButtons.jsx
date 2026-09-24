import { Pencil, Trash2 } from 'lucide-react';

/**
 * Shared Edit / Delete action buttons used across all trackers.
 * Clear colour-coding (blue = edit, red = delete) + recognisable icons + label.
 *
 * Props:
 *   onClick   — click handler
 *   label     — button text (defaults to "Edit" / "Delete"); pass iconOnly to hide
 *   iconOnly  — render the icon without text (tooltip still shows the label)
 *   title     — tooltip text (defaults to label)
 *   size      — 'sm' (default) | 'md'
 *   style     — extra inline styles
 *   disabled  — disables the button
 */
const SIZES = {
  sm: { pad: '4px 10px', padIcon: '5px 7px', font: 12, icon: 14 },
  md: { pad: '6px 14px', padIcon: '7px 9px', font: 13, icon: 16 },
};

function ActionButton({ Icon, palette, onClick, label, iconOnly, title, size = 'sm', style, disabled }) {
  const s = SIZES[size] || SIZES.sm;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: iconOnly ? s.padIcon : s.pad,
        borderRadius: 6,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontSize: s.font, fontWeight: 600, lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s',
        ...style,
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = palette.hoverBg; e.currentTarget.style.borderColor = palette.color; } }}
      onMouseLeave={e => { e.currentTarget.style.background = palette.bg; e.currentTarget.style.borderColor = palette.border; }}
    >
      <Icon size={s.icon} strokeWidth={2.2} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

const EDIT_PALETTE   = { bg: '#eff6ff', hoverBg: '#dbeafe', border: '#bfdbfe', color: '#1d4ed8' };
const DELETE_PALETTE = { bg: '#fef2f2', hoverBg: '#fee2e2', border: '#fecaca', color: '#dc2626' };

export function EditButton({ label = 'Edit', ...props }) {
  return <ActionButton Icon={Pencil} palette={EDIT_PALETTE} label={label} {...props} />;
}

export function DeleteButton({ label = 'Delete', ...props }) {
  return <ActionButton Icon={Trash2} palette={DELETE_PALETTE} label={label} {...props} />;
}
