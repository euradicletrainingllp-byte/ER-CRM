/**
 * CONSULTANT DIRECTORY
 * ====================
 * One record per consultant / trainer / coach EuRadicle works with: the profile
 * (headline, skills, industries, clients, certifications), contact details,
 * commercials, and the contract (dates, link, NDA) with an expiry reminder.
 * Excel: Consultant_Directory.xlsx → ConsultantTable (flow CONSULTANTS_CRUD). Key: Consultant ID (CN-001…).
 *
 * Commercial rates are shown only to admins and people with Finance view access.
 */
import { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import ExportButton from '../components/ExportButton.jsx';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { LinkButton } from '../components/LinkButton.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import {
  getConsultants, peekConsultants, addConsultant, updateConsultant, deleteConsultant, nextConsultantId,
  consultantsConfigured, splitMulti, joinMulti, MULTI, COMMERCIAL_KEYS, CONSULTANT_COLS,
  daysToExpiry, noticeDays, contractAlert, ALERT_LABEL,
} from '../services/consultantsApi.js';
import { pendingItems, CONSULTANT_RULES } from '../config/pendingFields.js';
import {
  DESIGNATIONS, ENGAGEMENT_MODELS, CONSULTANT_STATUS, PRACTICE_BADGES, CREDENTIALS, DELIVERY_MODES, YES_NO,
  CURRENCIES, TRAVEL_TERMS, CONTRACT_TYPES, CONTRACT_STATUS, RATINGS, DEFAULT_RENEWAL_NOTICE, CURRENCY_SYMBOL,
} from '../config/consultantOptions.js';
import '../styles/leadsVendors.css';
import '../styles/consultants.css';

/* ─── Helpers ─── */
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const addYears = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); if (isNaN(d)) return ''; d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? iso : `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
const money = (v, cur) => (v === '' || v == null || !Number(v) ? '' : `${CURRENCY_SYMBOL[cur] ?? (cur ? cur + ' ' : '₹ ')}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const ALERT_CLS = { expired: 'lv-due-bad', renew: 'lv-due-warn', ok: 'lv-due-ok', none: 'lv-due-none', terminated: 'lv-due-none' };
const STATUS_CLS = { Active: 'lv-st-won', Onboarding: 'lv-st-prog', 'On hold': 'lv-st-hold', Inactive: 'lv-st-lost' };

function expiryText(c) {
  const d = daysToExpiry(c);
  if (d === '') return 'No end date';
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Expires today';
  return `${d} day${d === 1 ? '' : 's'} left`;
}

function Select({ value, options, onChange, blank = '— select —' }) {
  return (
    <select className="form-input" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (old value)</option>}
    </select>
  );
}
const Field = ({ label, full, k, children }) => (
  <div className={`form-field${full ? ' full' : ''}`} data-pf={k}><label className="form-label">{label}</label>{children}</div>
);

function Avatar({ c, size = 40, square = false }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [c.photoLink]);
  const link = String(c.photoLink || '').trim();
  const src = /^(https?:\/\/|\/)\S+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(link) ? link : '';
  return (
    <span className={`cd-avatar${square ? ' sq' : ''}${src && !bad ? ' has-img' : ''}`} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : initials(c.fullName)}
    </span>
  );
}

/* ─── Add / Edit consultant ─── */
const EMPTY = Object.fromEntries(Object.keys(CONSULTANT_COLS).map(k => [k, '']));
const DEFAULTS = {
  designation: 'Senior Consultant', engagementModel: 'Associate (per engagement)', status: 'Active', country: 'India',
  deliveryMode: 'Both', currency: 'INR', contractType: 'Associate Agreement', contractStatus: 'Not started',
  renewalNotice: DEFAULT_RENEWAL_NOTICE,
};

function ConsultantModal({ initial, onSave, onClose, saving, names, me, showMoney }) {
  const isEdit = !!initial;
  const [f, setF] = useState(() => {
    const base = isEdit ? { ...EMPTY, ...initial } : { ...EMPTY, ...DEFAULTS, owner: me, createdBy: me };
    // Multi-value fields are edited one per line
    for (const k of MULTI) if (k !== 'badges') base[k] = splitMulti(base[k]).join('\n');
    return base;
  });
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v };
    if (k === 'contractStart' && v && !x.contractEnd) n.contractEnd = addDays(addYears(v, 1), -1);
    if (k === 'contractLink' && v && ['Not started', 'Draft', ''].includes(x.contractStatus)) n.contractStatus = 'Signed';
    if (k === 'ndaLink' && v && !x.ndaSigned) n.ndaSigned = 'Yes';
    if (k === 'gstRegistered' && v === 'No') n.gstin = '';
    return n;
  });
  const badges = splitMulti(f.badges);
  const toggleBadge = b => set('badges', joinMulti(badges.includes(b) ? badges.filter(x => x !== b) : [...badges, b]));
  const txtIn = (k, props = {}) => <input className="form-input" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} />;
  const numIn = k => <input className="form-input" inputMode="decimal" value={f[k] ?? ''} onChange={e => set(k, e.target.value.replace(/[^0-9.]/g, ''))} />;
  const dateIn = k => <input className="form-input" type="date" value={f[k] || ''} onChange={e => set(k, e.target.value)} />;
  const area = (k, rows = 3, ph = 'One per line') => <textarea className="form-input" rows={rows} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={ph} />;
  const valid = f.fullName.trim() && f.status;
  const endBeforeStart = f.contractStart && f.contractEnd && f.contractEnd < f.contractStart;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 860 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? `Edit Consultant · ${f.consultantId}` : 'Add Consultant'}</div>
        <datalist id="cd-names">{names.map(n => <option key={n} value={n} />)}</datalist>

        <div className="lv-form-section">Identity</div>
        <div className="form-grid lv-grid-4">
          <Field label="Full Name *" k="fullName">{txtIn('fullName')}</Field>
          <Field label="Designation" k="designation"><Select value={f.designation} options={DESIGNATIONS} onChange={v => set('designation', v)} /></Field>
          <Field label="Status *" k="status"><Select value={f.status} options={CONSULTANT_STATUS} onChange={v => set('status', v)} /></Field>
          <Field label="Engagement Model" k="engagementModel"><Select value={f.engagementModel} options={ENGAGEMENT_MODELS} onChange={v => set('engagementModel', v)} /></Field>
          <Field label="Base City" k="city">{txtIn('city')}</Field>
          <Field label="Country" k="country">{txtIn('country')}</Field>
        </div>

        <div className="lv-form-section">Contact</div>
        <div className="form-grid lv-grid-4">
          <Field label="Email" k="email">{txtIn('email', { type: 'email' })}</Field>
          <Field label="Phone" k="phone">{txtIn('phone', { placeholder: '+91 …' })}</Field>
          <Field label="LinkedIn URL" k="linkedin">{txtIn('linkedin', { placeholder: 'https://linkedin.com/in/…' })}</Field>
        </div>

        <div className="lv-form-section">Profile</div>
        <div className="form-grid lv-grid-4">
          <Field label="Profile Headline" full k="headline">{txtIn('headline', { placeholder: 'e.g. Executive Coach and Learning Architect' })}</Field>
          <Field label="About" full k="about">{area('about', 4, 'About paragraph from the profile')}</Field>
          <Field label="Years of Experience" k="yearsExp">{numIn('yearsExp')}</Field>
          <Field label="Professionals Trained" k="trained">{numIn('trained')}</Field>
          <Field label="Coaching Hours" k="coachingHours">{numIn('coachingHours')}</Field>
          <Field label="Profile PDF Link" k="profileLink">{txtIn('profileLink', { placeholder: 'https://… (SharePoint / OneDrive)' })}</Field>
          <Field label="Canva Link" k="canvaLink">{txtIn('canvaLink', { placeholder: 'https://www.canva.com/design/…' })}</Field>
          <Field label="Photo Link" k="photoLink">{txtIn('photoLink', { placeholder: 'Direct image link (optional)' })}</Field>
          <Field label="Profile Last Updated" k="profileUpdated">{dateIn('profileUpdated')}</Field>
        </div>

        <div className="lv-form-section">Expertise</div>
        <div className="form-grid">
          <Field label="Practice Badges" full k="badges">
            <div className="cd-chip-pick">
              {[...new Set([...PRACTICE_BADGES, ...badges])].map(b => (
                <button type="button" key={b} className={badges.includes(b) ? 'on' : ''} onClick={() => toggleBadge(b)}>{b}</button>
              ))}
            </div>
          </Field>
          <Field label="Core Skills" k="skills">{area('skills', 5)}</Field>
          <Field label="Certifications & Qualifications" k="certifications">{area('certifications', 5)}</Field>
          <Field label="Client Industries" k="industries">{area('industries', 4)}</Field>
          <Field label="Notable Clients" k="clients">{area('clients', 4)}</Field>
          <Field label="Geographies" k="geographies">{area('geographies', 2)}</Field>
          <Field label="Psychometric Tools" k="psychometrics">{area('psychometrics', 2)}</Field>
          <Field label="Languages" k="languages">{area('languages', 2)}</Field>
          <Field label="Coaching Credential" k="credential"><Select value={f.credential} options={CREDENTIALS} onChange={v => set('credential', v)} /></Field>
          <Field label="Delivery Mode" k="deliveryMode"><Select value={f.deliveryMode} options={DELIVERY_MODES} onChange={v => set('deliveryMode', v)} /></Field>
          <Field label="Open to Travel" k="travel"><Select value={f.travel} options={YES_NO} onChange={v => set('travel', v)} /></Field>
        </div>

        {showMoney && <>
          <div className="lv-form-section">Commercials</div>
          <div className="form-grid lv-grid-4">
            <Field label="Currency" k="currency"><Select value={f.currency} options={CURRENCIES} onChange={v => set('currency', v)} /></Field>
            <Field label="Full-Day Rate" k="dayRate">{numIn('dayRate')}</Field>
            <Field label="Half-Day Rate" k="halfDayRate">{numIn('halfDayRate')}</Field>
            <Field label="Coaching Rate / Hour" k="coachingRate">{numIn('coachingRate')}</Field>
            <Field label="Travel Terms" k="travelTerms"><Select value={f.travelTerms} options={TRAVEL_TERMS} onChange={v => set('travelTerms', v)} /></Field>
            <Field label="GST Registered" k="gstRegistered"><Select value={f.gstRegistered} options={YES_NO} onChange={v => set('gstRegistered', v)} /></Field>
            {f.gstRegistered === 'Yes' && <Field label="GSTIN" k="gstin">{txtIn('gstin')}</Field>}
            <Field label="Rate Notes" full k="rateNotes">{area('rateNotes', 2, 'Design fee, prep days, discounts, cancellation terms')}</Field>
          </div>
        </>}

        <div className="lv-form-section">Contract</div>
        <div className="form-grid lv-grid-4">
          <Field label="Contract Type" k="contractType"><Select value={f.contractType} options={CONTRACT_TYPES} onChange={v => set('contractType', v)} /></Field>
          <Field label="Contract Status" k="contractStatus"><Select value={f.contractStatus} options={CONTRACT_STATUS} onChange={v => set('contractStatus', v)} /></Field>
          <Field label="Auto-Renew" k="autoRenew"><Select value={f.autoRenew} options={YES_NO} onChange={v => set('autoRenew', v)} /></Field>
          <Field label="Contract Start Date" k="contractStart">{dateIn('contractStart')}</Field>
          <Field label="Contract End Date (expiry)" k="contractEnd">{dateIn('contractEnd')}</Field>
          <Field label="Renewal Notice (days)" k="renewalNotice">{numIn('renewalNotice')}</Field>
          <Field label="Contract Link" full k="contractLink">{txtIn('contractLink', { placeholder: 'https://… signed agreement' })}</Field>
          <Field label="NDA Signed" k="ndaSigned"><Select value={f.ndaSigned} options={YES_NO} onChange={v => set('ndaSigned', v)} /></Field>
          <Field label="NDA Date" k="ndaDate">{dateIn('ndaDate')}</Field>
          <Field label="Last Renewed On" k="lastRenewed">{dateIn('lastRenewed')}</Field>
          <Field label="NDA Link" full k="ndaLink">{txtIn('ndaLink', { placeholder: 'https://…' })}</Field>
          <Field label="Non-Solicit Clause" k="nonSolicit"><Select value={f.nonSolicit} options={YES_NO} onChange={v => set('nonSolicit', v)} /></Field>
          <Field label="IP Clause" k="ipClause"><Select value={f.ipClause} options={YES_NO} onChange={v => set('ipClause', v)} /></Field>
          <Field label="Contract Notes" full k="contractNotes">{area('contractNotes', 2, 'Special terms, exclusivity, notice period')}</Field>
        </div>

        <div className="lv-form-section">Relationship</div>
        <div className="form-grid lv-grid-4">
          <Field label="Relationship Owner" k="owner"><input className="form-input" list="cd-names" value={f.owner} onChange={e => set('owner', e.target.value)} /></Field>
          <Field label="Onboarded On" k="onboardedOn">{dateIn('onboardedOn')}</Field>
          <Field label="Internal Rating (1–5)" k="rating"><Select value={String(f.rating || '')} options={RATINGS} onChange={v => set('rating', v)} /></Field>
          <Field label="Preferred For" full k="preferredFor">{txtIn('preferredFor', { placeholder: 'Program types / clients this consultant fits best' })}</Field>
          <Field label="Remarks" full k="remarks">{area('remarks', 2, '')}</Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-cta" disabled={!valid || saving || endBeforeStart}
            onClick={() => {
              const out = { ...f, lastUpdated: todayIso() };
              for (const k of MULTI) out[k] = joinMulti(out[k]);
              onSave(out);
            }}>{saving ? 'Saving…' : isEdit ? 'Update Consultant' : 'Save Consultant'}</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {!valid && <span className="lv-req">* Full Name and Status are required</span>}
          {endBeforeStart && <span className="lv-req">Contract end date is before the start date</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Profile (EuRadicle profile format) ─── */
const BADGE_ICON = {
  'Artificial Intelligence': '🤖', Leadership: '🛡️', Coaching: '💬', 'Communication & Presentations': '🎤', Sales: '📈',
  'Train the Trainer': '🎓', 'Keynote Speaker': '🎙️', 'HR & Talent Management': '👥',
};
const idNum = c => Number(String(c.consultantId || '').replace(/\D/g, '')) || 1e9;
const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
const place = c => [c.city, c.country].filter(Boolean).join(', ');

function Badge({ name, small }) {
  return (
    <span className={`cd-badge${small ? ' sm' : ''}`} title={name}>
      <span className="cd-badge-ic">{BADGE_ICON[name] || '★'}</span>
      <span className="cd-badge-tx">{name}</span>
    </span>
  );
}

/** Grid card — photo, name, designation, location, badges */
function ProfileCard({ c, onOpen }) {
  const a = contractAlert(c);
  return (
    <button type="button" className="cd-card" onClick={onOpen}>
      <div className="cd-card-top">
        <span className="cd-card-id">{c.consultantId}</span>
        {c.status && c.status !== 'Active' && <span className={`lv-pill ${STATUS_CLS[c.status] || 'lv-st-new'}`}>{c.status}</span>}
        <Avatar c={c} size={96} />
      </div>
      <div className="cd-card-body">
        <div className="cd-card-name">{c.fullName || '(no name)'}</div>
        <div className="cd-card-desig">{c.designation}</div>
        {place(c) && <div className="cd-card-loc">📍 {place(c)}</div>}
        {c.yearsExp !== '' && <div className="cd-card-yrs">{c.yearsExp}+ years</div>}
        <div className="cd-card-badges">{splitMulti(c.badges).map(b => <Badge key={b} name={b} small />)}</div>
      </div>
      <div className="cd-card-foot"><span className={`lv-due ${ALERT_CLS[a]}`}>{a === 'ok' ? `Contract to ${fmtD(c.contractEnd)}` : `Contract: ${ALERT_LABEL[a]}`}</span></div>
    </button>
  );
}

/** Full profile, laid out like the EuRadicle trainer profile PDF */
function ProfileSheet({ c }) {
  const skills = splitMulti(c.skills), inds = splitMulti(c.industries), clients = splitMulti(c.clients), certs = splitMulti(c.certifications);
  const stats = [
    c.yearsExp !== '' && [`${c.yearsExp}+`, 'Years of experience'],
    c.trained !== '' && [`${Number(c.trained).toLocaleString('en-IN')}+`, 'Professionals trained'],
    c.coachingHours !== '' && [`${Number(c.coachingHours).toLocaleString('en-IN')}+`, 'Coaching hours'],
  ].filter(Boolean);
  return (
    <article className="cd-sheet">
      <header className="cd-hero">
        <div className="cd-hero-brand">
          <img src="/ER_Logo.jpg" alt="EuRadicle" onError={e => { e.currentTarget.style.display = 'none'; }} />
          <span>REIMAGINING TALENT<br />FOR A CHANGING WORLD</span>
        </div>
        <div className="cd-hero-main">
          <div className="cd-hero-text">
            <h1 data-pf="fullName">{c.fullName}</h1>
            <div className="cd-hero-desig" data-pf="designation">{c.designation}</div>
            {place(c) && <div className="cd-hero-loc" data-pf="city">📍 {place(c)}</div>}
            {c.headline && <div className="cd-hero-head" data-pf="headline">{c.headline}</div>}
          </div>
          <div className="cd-hero-photo"><Avatar c={c} size={210} square /></div>
        </div>
        {!!splitMulti(c.badges).length && <div className="cd-hero-badges" data-pf="badges">{splitMulti(c.badges).map(b => <Badge key={b} name={b} />)}</div>}
      </header>

      <section className="cd-sec">
        <h2>About <span>{firstName(c.fullName)}</span></h2>
        {c.about ? <p className="cd-about">{c.about}</p> : <p className="lv-muted">No About text yet.</p>}
        {!!stats.length && <div className="cd-stats">{stats.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>}
        {!!skills.length && <>
          <h3 data-pf="skills">Core Skills</h3>
          <ul className="cd-skills">{skills.map(s => <li key={s}>{s}</li>)}</ul>
        </>}
      </section>

      {!!inds.length && (
        <section className="cd-band" data-pf="industries">
          <h3>Client Experience and Exposure</h3>
          <p>{inds.join(' | ')}</p>
        </section>
      )}

      {!!clients.length && (
        <section className="cd-logos" data-pf="clients">
          {clients.map(x => <span key={x} className="cd-logo">{x}</span>)}
        </section>
      )}

      {!!certs.length && (
        <section className="cd-sec cd-certs" data-pf="certifications">
          <h2 className="cd-caps">Certifications &amp; Qualifications</h2>
          <ul>{certs.map(x => <li key={x}>{x}</li>)}</ul>
        </section>
      )}

      {(splitMulti(c.geographies).length || splitMulti(c.languages).length || splitMulti(c.psychometrics).length || (c.credential && c.credential !== 'None')) ? (
        <section className="cd-sec cd-extra">
          {c.credential && c.credential !== 'None' && <div><dt>Coaching credential</dt><dd>{c.credential}</dd></div>}
          {!!splitMulti(c.psychometrics).length && <div><dt>Psychometric tools</dt><dd>{splitMulti(c.psychometrics).join(', ')}</dd></div>}
          {!!splitMulti(c.geographies).length && <div><dt>Geographies</dt><dd>{splitMulti(c.geographies).join(', ')}</dd></div>}
          {!!splitMulti(c.languages).length && <div><dt>Languages</dt><dd>{splitMulti(c.languages).join(', ')}</dd></div>}
        </section>
      ) : null}
      <footer className="cd-sheet-foot">EuRadicle®</footer>
    </article>
  );
}

/** Internal details beside the profile: contract, contact, commercials, relationship */
function InternalPanel({ c, canEdit, onEdit, onDelete, onQuick, saving, showMoney }) {
  const Info = ({ k, label, children, full }) => <div data-pf={k} className={full ? 'lv-info-full' : ''}><dt>{label}</dt><dd>{children || '—'}</dd></div>;
  const alert = contractAlert(c);
  const [newEnd, setNewEnd] = useState('');
  useEffect(() => setNewEnd(c.contractEnd ? addYears(c.contractEnd, 1) : ''), [c.consultantId, c.contractEnd]);
  return (
    <aside className="card cd-internal">
      <div className="cd-int-head">
        <div>
          <span className="lv-id">{c.consultantId}</span>{' '}
          <span className={`lv-pill ${STATUS_CLS[c.status] || 'lv-st-new'}`}>{c.status || 'No status'}</span>
        </div>
        {canEdit && <div style={{ display: 'flex', gap: 6 }}>
          <EditButton onClick={onEdit} title="Edit consultant" />
          {onDelete && <DeleteButton onClick={onDelete} title="Delete consultant" iconOnly />}
        </div>}
      </div>
      <div className="cd-int-links">
        {c.profileLink && <LinkButton url={c.profileLink} label="Profile PDF" compact />}
        {c.canvaLink && <LinkButton url={c.canvaLink} label="Canva" compact />}
        {c.linkedin && <LinkButton url={c.linkedin} label="LinkedIn" compact />}
      </div>

      {canEdit && (alert === 'renew' || alert === 'expired') && (
        <div className="lv-quick-row" data-pf="contractEnd" style={{ marginTop: 10 }}>
          <span>{alert === 'expired' ? 'Contract expired' : 'Due for renewal'} · {fmtD(c.contractEnd)}. Renewed until</span>
          <input className="form-input" type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} />
          <button className="btn btn-cta btn-sm" disabled={saving || !newEnd || newEnd <= (c.contractEnd || '')}
            onClick={() => onQuick({ contractEnd: newEnd, lastRenewed: todayIso(), contractStatus: 'Signed' })}>Mark renewed</button>
        </div>
      )}

      <div className="lv-sub">Contract</div>
      <dl className="lv-info">
        <Info k="contractStatus" label="Status"><span className={`lv-due ${ALERT_CLS[alert]}`}>{c.contractStatus || ALERT_LABEL[alert]}</span></Info>
        <Info k="contractType" label="Type">{c.contractType}</Info>
        <Info k="contractStart" label="Start">{fmtD(c.contractStart)}</Info>
        <Info k="contractEnd" label="End (expiry)">{c.contractEnd && <>{fmtD(c.contractEnd)}<div className="lv-muted">{expiryText(c)}</div></>}</Info>
        <Info k="contractLink" label="Contract">{c.contractLink && <LinkButton url={c.contractLink} label="Open" compact />}</Info>
        <Info k="ndaSigned" label="NDA">{[c.ndaSigned, c.ndaDate && fmtD(c.ndaDate)].filter(Boolean).join(' · ')}{c.ndaLink && <> <LinkButton url={c.ndaLink} label="Open" compact /></>}</Info>
        <Info k="renewalNotice" label="Reminder">{`${noticeDays(c)} days before expiry${c.autoRenew === 'Yes' ? ' · auto-renews' : ''}`}</Info>
        <Info k="lastRenewed" label="Last renewed">{fmtD(c.lastRenewed)}</Info>
        {c.contractNotes && <Info full label="Contract notes">{c.contractNotes}</Info>}
      </dl>

      <div className="lv-sub">Contact</div>
      <dl className="lv-info">
        <Info k="email" label="Email" full>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</Info>
        <Info k="phone" label="Phone">{c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>}</Info>
        <Info k="deliveryMode" label="Delivery">{[c.deliveryMode, c.travel === 'Yes' && 'travels', c.travel === 'No' && 'no travel'].filter(Boolean).join(' · ')}</Info>
        <Info k="engagementModel" label="Engagement" full>{c.engagementModel}</Info>
      </dl>

      {showMoney && <>
        <div className="lv-sub">Commercials</div>
        <dl className="lv-info">
          <Info k="dayRate" label="Full day">{money(c.dayRate, c.currency)}</Info>
          <Info k="halfDayRate" label="Half day">{money(c.halfDayRate, c.currency)}</Info>
          <Info k="coachingRate" label="Coaching / hour">{money(c.coachingRate, c.currency)}</Info>
          <Info k="travelTerms" label="Travel">{c.travelTerms}</Info>
          <Info k="gstRegistered" label="GST" full>{[c.gstRegistered, c.gstin].filter(Boolean).join(' · ')}</Info>
          {c.rateNotes && <Info full label="Rate notes">{c.rateNotes}</Info>}
        </dl>
      </>}

      <div className="lv-sub">Relationship</div>
      <dl className="lv-info">
        <Info k="owner" label="Owner">{c.owner}</Info>
        <Info k="rating" label="Rating">{c.rating && '★'.repeat(Number(c.rating) || 0) + '☆'.repeat(Math.max(0, 5 - (Number(c.rating) || 0)))}</Info>
        <Info k="onboardedOn" label="Onboarded">{fmtD(c.onboardedOn)}</Info>
        <Info k="profileUpdated" label="Profile updated">{fmtD(c.profileUpdated)}</Info>
        {c.preferredFor && <Info full label="Preferred for">{c.preferredFor}</Info>}
        {c.remarks && <Info full label="Remarks">{c.remarks}</Info>}
      </dl>
    </aside>
  );
}

/* ─── Contracts table ─── */
function ContractsTable({ rows, onPick }) {
  const list = [...rows].sort((a, b) => idNum(a) - idNum(b));
  return (
    <div className="table-wrap">
      <table className="lv-table">
        <thead><tr><th>ID</th><th>Consultant</th><th>Type</th><th>Status</th><th>Start</th><th>End (expiry)</th><th>Days left</th><th>Alert</th><th>NDA</th><th>Contract</th></tr></thead>
        <tbody>{list.map(c => {
          const a = contractAlert(c), d = daysToExpiry(c);
          return (
            <tr key={c.consultantId} style={{ cursor: 'pointer' }} onClick={() => onPick(c.consultantId)}>
              <td><span className="lv-id">{c.consultantId}</span></td>
              <td><b>{c.fullName}</b><div className="lv-muted">{c.status}</div></td>
              <td>{c.contractType || '—'}</td>
              <td>{c.contractStatus || '—'}</td>
              <td>{fmtD(c.contractStart) || '—'}</td>
              <td>{fmtD(c.contractEnd) || '—'}</td>
              <td className={a === 'expired' || a === 'renew' ? 'lv-warn-t' : ''}>{d === '' ? '—' : d}</td>
              <td><span className={`lv-due ${ALERT_CLS[a]}`}>{ALERT_LABEL[a]}</span></td>
              <td>{c.ndaSigned || '—'}</td>
              <td>{c.contractLink ? <LinkButton url={c.contractLink} label="Open" compact /> : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

/* ─── Page ─── */
const QUICK = [['all', 'All'], ['renew', 'Renew now'], ['expired', 'Expired'], ['none', 'No contract date'], ['ok', 'Valid']];

export default function ConsultantDirectory({ onRefreshed }) {
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const { permissions } = usePermissionsContext();
  const { isAdmin, canAccess, canEdit, canCreate, canDelete } = usePermissions();
  const editable = canEdit('consultants');
  const showMoney = isAdmin || canAccess('finance');

  const [data, setData] = useState(() => peekConsultants() || []);
  const [loading, setLoading] = useState(() => !peekConsultants() && consultantsConfigured());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState('all');
  const [statusF, setStatusF] = useState('Active+');
  const [badgeF, setBadgeF] = useState('All');
  const [cityF, setCityF] = useState('All');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = m => { setToast(m); setTimeout(() => setToast(''), String(m).startsWith('❌') ? 9000 : 3000); };
  const load = async () => {
    if (!consultantsConfigured()) { setLoading(false); return; }
    if (!peekConsultants()) setLoading(true);
    setRefreshing(true); setError(null);
    try { setData(await getConsultants()); onRefreshed?.(new Date().toLocaleTimeString()); }
    catch (e) { if (peekConsultants()) showToast('⚠ Could not refresh from Excel — showing the last saved copy.'); else setError(e); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { try { document.querySelector('.tracker-scroll')?.scrollTo(0, 0); } catch { /* ignore */ } }, [selected, view]);

  const names = useMemo(() => [...new Set([...Object.values(permissions || {}).map(p => p?.name), ...data.map(c => c.owner)].filter(Boolean))].sort(), [permissions, data]);
  const cities = useMemo(() => [...new Set(data.map(c => c.city).filter(Boolean))].sort(), [data]);
  const badgeList = useMemo(() => [...new Set([...PRACTICE_BADGES, ...data.flatMap(c => splitMulti(c.badges))])], [data]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return data.filter(c => {
      const hay = [c.consultantId, c.fullName, c.designation, c.city, c.country, c.headline, c.badges, c.skills, c.industries,
        c.clients, c.certifications, c.psychometrics, c.languages, c.geographies, c.preferredFor, c.credential].map(norm).join(' | ');
      const mQ = !q || q.split(' ').every(w => hay.includes(w));
      const mStatus = statusF === 'All' || (statusF === 'Active+' ? c.status !== 'Inactive' : c.status === statusF);
      const mBadge = badgeF === 'All' || splitMulti(c.badges).includes(badgeF);
      const mCity = cityF === 'All' || c.city === cityF;
      const mQuick = quick === 'all' || contractAlert(c) === quick;
      return mQ && mStatus && mBadge && mCity && mQuick;
    }).sort((a, b) => idNum(a) - idNum(b));
  }, [data, search, statusF, badgeF, cityF, quick]);

  const sel = selected ? data.find(c => c.consultantId === selected) : null;
  const live = data.filter(c => c.status !== 'Inactive');
  const countAlert = a => live.filter(c => contractAlert(c) === a).length;

  /* writes */
  const save = async (c, isNew) => {
    setSaving(true);
    try {
      if (isNew) {
        const row = { ...c, consultantId: nextConsultantId(data) };
        await addConsultant(row);
        setData(d => [row, ...d]); setSelected(row.consultantId); showToast(`✓ ${row.fullName} added as ${row.consultantId}`);
      } else {
        // People without commercial access never see those fields — keep the saved values
        const prev = data.find(x => x.consultantId === c.consultantId) || {};
        const row = showMoney ? c : { ...c, ...Object.fromEntries(COMMERCIAL_KEYS.map(k => [k, prev[k] ?? ''])) };
        await updateConsultant(row);
        setData(d => d.map(x => (x.consultantId === row.consultantId ? row : x))); showToast('✓ Consultant updated');
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${sel.consultantId} · ${sel.fullName}? This cannot be undone. (To keep the history, set Status to Inactive instead.)`)) return;
    setSaving(true);
    try { await deleteConsultant(sel.consultantId); setData(d => d.filter(c => c.consultantId !== sel.consultantId)); setSelected(null); showToast('✓ Consultant deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  /* Reminders popup: missing details + contract renewals */
  const pendingBar = useMemo(() => pendingItems(filtered, CONSULTANT_RULES, c => ({
    id: c.consultantId, serial: c.consultantId.replace(/^CN-0*/, ''), title: c.fullName || '(no name)', subtitle: [c.designation, c.city].filter(Boolean).join(' · '),
  })), [filtered]);
  const dueBar = useMemo(() => filtered.filter(c => c.status !== 'Inactive' && c.contractEnd && c.contractStatus !== 'Terminated').map(c => ({
    id: c.consultantId, serial: c.consultantId.replace(/^CN-0*/, ''), title: c.fullName, subtitle: [c.contractType, `ends ${fmtD(c.contractEnd)}`].filter(Boolean).join(' · '),
    tasks: [{ key: 'renew', label: 'Renew contract', due: addDays(c.contractEnd, -noticeDays(c)) }], row: c,
  })).filter(it => contractAlert(it.row) === 'renew' || contractAlert(it.row) === 'expired'), [filtered]);
  const openPending = (it, f) => { setSelected(it.row.consultantId); setView('list'); setModal(it.row); revealField(f.key, f.label); };
  const openDue = it => { setSelected(it.row.consultantId); setView('list'); revealField('contractEnd', ''); };

  if (!consultantsConfigured()) return (
    <div className="card lv-placeholder" style={{ margin: 20 }}>
      <div className="lv-big">🧑‍🏫</div><b>Consultant Directory is not connected yet</b>
      <div className="lv-muted">Upload Consultant_Directory.xlsx, create the “CRM Consultants CRUD” flow and paste its URL into src/config/powerAutomate.js → CONSULTANTS_CRUD.</div>
    </div>
  );
  if (loading) return <LoadingState message="Loading Consultant Directory from Excel…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const quickCount = Object.fromEntries(QUICK.map(([k]) => [k, k === 'all' ? live.length : countAlert(k)]));
  const exportCols = Object.entries(CONSULTANT_COLS)
    .filter(([k]) => showMoney || !COMMERCIAL_KEYS.includes(k))
    .map(([key, label]) => ({ label, key }));

  return (
    <div className="tracker-page">
      {toast && <div className="lv-toast">{toast}</div>}
      {modal && <ConsultantModal initial={modal === 'add' ? null : modal} names={names} me={me} showMoney={showMoney}
        saving={saving} onClose={() => setModal(null)} onSave={c => save(c, modal === 'add')} />}

      <div className="kpi-compact">
        <div className="kpi-card"><div className="kpi-label">Active consultants</div><div className="kpi-value">{data.filter(c => c.status === 'Active').length}</div><div className="kpi-sub">{data.length} in the directory</div></div>
        <div className="kpi-card"><div className="kpi-label">Contracts signed</div><div className="kpi-value">{live.filter(c => c.contractStatus === 'Signed' && contractAlert(c) === 'ok').length}</div><div className="kpi-sub">valid, not due for renewal</div></div>
        <div className="kpi-card"><div className="kpi-label">Renew now</div><div className="kpi-value" style={{ color: countAlert('renew') ? 'var(--error)' : undefined }}>{countAlert('renew')}</div><div className="kpi-sub">{countAlert('expired')} already expired</div></div>
        <div className="kpi-card accent"><div className="kpi-label">No contract on file</div><div className="kpi-value">{countAlert('none')}</div><div className="kpi-sub">add start / end dates and link</div></div>
      </div>

      <div className="filter-bar lv-filters" style={{ flexShrink: 0 }}>
        <div className="lv-tabs">
          {[['list', 'Directory'], ['contracts', 'Contracts']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <input className="form-input wide" style={{ width: 230 }} placeholder="🔍 Name, skill, industry, client…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input" value={badgeF} onChange={e => setBadgeF(e.target.value)}>
          <option value="All">All practices</option>{badgeList.map(b => <option key={b}>{b}</option>)}
        </select>
        <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="Active+">All except inactive</option><option value="All">All statuses</option>{CONSULTANT_STATUS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-input" value={cityF} onChange={e => setCityF(e.target.value)}>
          <option value="All">All cities</option>{cities.map(c => <option key={c}>{c}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>{refreshing ? '⟳' : '↺'}</button>
        <ExportButton page="consultants" filename="Consultant Directory" sheetName="Consultants" rows={() => filtered} columns={exportCols} />
        {canCreate('consultants') && <button className="btn btn-primary btn-sm" onClick={() => setModal('add')}>+ Add Consultant</button>}
      </div>

      <div className="lv-quickfilters">
        {QUICK.map(([k, l]) => <button key={k} className={`lv-qf${quick === k ? ' on' : ''}`} onClick={() => setQuick(k)}>{l} <b>{quickCount[k]}</b></button>)}
      </div>

      {view === 'contracts' ? (
        <div className="tracker-scroll"><div className="card" style={{ padding: 16 }}>
          <ContractsTable rows={filtered} onPick={id => { setSelected(id); setView('list'); }} />
        </div></div>
      ) : (
        <div className="tracker-scroll">
          {sel ? (() => {
            const i = filtered.findIndex(c => c.consultantId === sel.consultantId);
            const prev = i > 0 ? filtered[i - 1] : null, next = i >= 0 && i < filtered.length - 1 ? filtered[i + 1] : null;
            return (
              <>
                <div className="cd-nav">
                  <button className="btn btn-outline btn-sm" onClick={() => setSelected(null)}>← All consultants</button>
                  <span className="lv-muted">{i >= 0 ? `${i + 1} of ${filtered.length}` : ''}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-outline btn-sm" disabled={!prev} onClick={() => setSelected(prev.consultantId)}>‹ {prev ? prev.fullName : 'Previous'}</button>
                  <button className="btn btn-outline btn-sm" disabled={!next} onClick={() => setSelected(next.consultantId)}>{next ? next.fullName : 'Next'} ›</button>
                </div>
                <div className="cd-profile-wrap">
                  <ProfileSheet c={sel} />
                  <InternalPanel c={sel} canEdit={editable} saving={saving} showMoney={showMoney} onEdit={() => setModal(sel)}
                    onDelete={canDelete('consultants') ? remove : undefined} onQuick={ch => save({ ...sel, ...ch, lastUpdated: todayIso() }, false)} />
                </div>
              </>
            );
          })() : !filtered.length ? (
            <div className="lv-empty" style={{ margin: 16 }}>No consultants match these filters{data.length ? '' : ' — add the first one with “+ Add Consultant”'}.</div>
          ) : (
            <div className="cd-grid">
              {filtered.map(c => <ProfileCard key={c.consultantId} c={c} onOpen={() => setSelected(c.consultantId)} />)}
            </div>
          )}
        </div>
      )}

      <PendingFieldsBar items={pendingBar} dueItems={dueBar} onPick={openPending} onPickDue={openDue} canEdit={editable} noun="consultant" />
    </div>
  );
}
