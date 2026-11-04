// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
const listeners = new Set();
vi.mock('../src/services/api.js', () => ({
  peekList: n => store.get(n) ?? null,
  onListChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  getSolutionTracker: async () => store.get('solution') || [],
  _rememberList: (n, rows) => { store.set(n, rows); listeners.forEach(f => f(n)); return rows; },
}));
const calls = [];
let freshClients = [], freshContacts = [];
vi.mock('../src/services/clientsApi.js', async () => {
  const real = await vi.importActual('../src/services/clientsApi.js');
  return {
    ...real,
    clientsConfigured: () => true,
    getClientDirectory: async () => ({}),
    peekClientDirectory: () => store.get('client-dir:clients') || null,
    readTableFresh: async kind => (kind === 'clients' ? freshClients : freshContacts).map(r => ({ ...r })),
    addRecord: async (kind, rec) => { calls.push([kind, rec]); },
  };
});
vi.mock('../src/services/consultantsApi.js', () => ({ getConsultants: async () => [], peekConsultants: () => store.get('consultants'), consultantsConfigured: () => false }));
vi.mock('../src/services/leadsVendorsApi.js', () => ({ getVendorServices: async () => [] }));
vi.mock('../src/config/powerAutomate.js', () => ({ default: {} }));

const C = (id, name, extra = {}) => ({ clientId: id, sno: id, name, legalName: '', parentGroup: '', industry: '', clientType: 'Existing', ...extra });
const dirClients = [C('CL-001', 'Ford', { industry: 'Automotive' }), C('CL-002', 'ArcelorMittal', { legalName: 'ArcelorMittal Nippon Steel India' }),
  C('CL-003', 'CJ Darcl'), C('CL-004', 'Societe Generale'), C('CL-005', 'Avery Dennison'), C('CL-010', 'DBS Bank')];
const dirContacts = [{ contactId: 'CT-0001', clientId: 'CL-001', clientName: 'Ford', fullName: 'Asha Rao', email: 'asha@ford.com', designation: 'L&D Head', primary: 'Yes', status: 'Active' },
  { contactId: 'CT-0002', clientId: '', clientName: 'ford', fullName: 'Ravi K', email: '', designation: '', primary: '', status: 'Former contact' }];

let M;
beforeEach(async () => {
  store.clear(); calls.length = 0;
  store.set('client-dir:clients', dirClients); store.set('client-dir:contacts', dirContacts);
  store.set('solution', [{ proposalId: 'P ID 010', proposalVersion: 'V1', clientName: 'Ford', programTopic: 'Storytelling', proposalV1Link: 'https://x/1' },
    { proposalId: 'P ID 010', proposalVersion: 'V2', clientName: 'Ford', programTopic: 'Storytelling', proposalV1Link: 'https://x/2' }]);
  store.set('vendors', [{ vendorName: 'PrintCo', vendorContact: '99', category: 'Printing' }, { vendorName: 'printco ', vendorContact: '', category: 'Printing' }]);
  freshClients = dirClients; freshContacts = dirContacts;
  vi.resetModules();
  M = await import('../src/services/directoryCache.js');
});

describe('matching', () => {
  it('finds by name, case/spacing, legal name and known variants', () => {
    expect(M.findClient('ford')?.clientId).toBe('CL-001');
    expect(M.findClient(' F O R D ')?.clientId).toBe('CL-001');
    expect(M.findClient('ArcelorMittal Nippon Steel India')?.clientId).toBe('CL-002');
    expect(M.findClient('Arcellor Mittal')?.name).toBe('ArcelorMittal');
    expect(M.findClient('CJ Darrcl')?.name).toBe('CJ Darcl');
    expect(M.findClient('SocGen')?.name).toBe('Societe Generale');
    expect(M.findClient('Avery Dennisen')?.name).toBe('Avery Dennison');
    expect(M.findClient('MoEngage')).toBeNull();
    expect(M.isNotAClient('Open Program')).toBe(true);
  });
  it('suggests by prefix / word and warns about near duplicates', () => {
    expect(M.suggestClients('fo')[0].name).toBe('Ford');
    expect(M.suggestClients('bank')[0].name).toBe('DBS Bank');
    expect(M.nearDuplicates('Ford India Pvt Ltd').map(c => c.name)).toContain('Ford');
    expect(M.nearDuplicates('Avery Denison').map(c => c.name)).toContain('Avery Dennison');
    expect(M.nearDuplicates('Zscaler')).toEqual([]);
  });
  it('lists contacts by Client ID or name, primary first, former last', () => {
    expect(M.contactsOf('Ford').map(c => c.fullName)).toEqual(['Asha Rao', 'Ravi K']);
    expect(M.findContact('Ford', { email: 'ASHA@ford.com' })?.contactId).toBe('CT-0001');
    expect(M.contactsOf('Nobody')).toEqual([]);
  });
  it('proposals keep the latest version; vendors are distinct', () => {
    const d = M.getDirectory();
    expect(d.proposals).toHaveLength(1);
    expect(d.proposals[0].link).toBe('https://x/2');
    expect(d.vendors).toHaveLength(1);
    expect(d.vendors[0]).toMatchObject({ name: 'PrintCo', contact: '99', uses: 2 });
  });
  it('fillNonEmpty never writes empty values', () => {
    expect(M.fillNonEmpty({ a: 'keep', b: 'old' }, { a: '', b: 'new', c: '  ' })).toEqual({ a: 'keep', b: 'new' });
  });
});

describe('quick-add', () => {
  it('creates the next CL- ID from a fresh read and refreshes the list', async () => {
    const { client, created } = await M.quickAddClient({ name: 'MoEngage', industry: 'Technology' }, 'Revanth');
    expect(created).toBe(true);
    expect(client.clientId).toBe('CL-011');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ name: 'MoEngage', clientType: 'Prospect', createdBy: 'Revanth' });
    expect(M.findClient('moengage')?.clientId).toBe('CL-011');
  });
  it('does not create a duplicate (incl. spelling variant) — returns the existing client', async () => {
    const r = await M.quickAddClient({ name: 'Arcellor Mittal' }, 'x');
    expect(r.created).toBe(false);
    expect(r.client.name).toBe('ArcelorMittal');
    expect(calls).toHaveLength(0);
  });
  it('uses the fresh table, not the cached one, for the next ID', async () => {
    freshClients = [...dirClients, C('CL-020', 'Added elsewhere')];
    const { client } = await M.quickAddClient({ name: 'RSPL' }, 'x');
    expect(client.clientId).toBe('CL-021');
  });
  it('adds a contact under the client with the next CT- ID; same email is not duplicated', async () => {
    const a = await M.quickAddContact({ client: 'Ford', fullName: 'New Person', email: 'np@ford.com' }, 'x');
    expect(a).toMatchObject({ created: true, contact: { contactId: 'CT-0003', clientId: 'CL-001', clientName: 'Ford' } });
    const b = await M.quickAddContact({ client: 'Ford', fullName: 'Asha R', email: 'asha@ford.com' }, 'x');
    expect(b.created).toBe(false);
    expect(calls).toHaveLength(1);
    await expect(M.quickAddContact({ client: 'Unknown Co', fullName: 'A' }, 'x')).rejects.toThrow(/Client Directory/);
  });
});
