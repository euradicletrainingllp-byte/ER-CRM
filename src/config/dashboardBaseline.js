/**
 * Previous-year figures for the Operations and Solutioning dashboards.
 *
 * Source: "Dashboard Report Data 12th October 2026.xlsx" — Operations and Solutioning sheets.
 * These numbers are fixed. Every financial year from LIVE_FROM_FY onward is calculated live
 * from the Engagement Calendar (Operations) and the Solution Tracker (Solutioning) instead.
 */

/** First financial year (April start) that comes from the live trackers: 2026 = FY 2026-27. */
export const LIVE_FROM_FY = 2026;

/* ─────────────────────────────── OPERATIONS ─────────────────────────────── */

// Financial Year table (FY 2026-27 row is live, so it is not listed here)
export const OPS_FY = [
  { fy: 2023, inPerson: 119, virtual: 29, total: 148, upcoming: 0 },
  { fy: 2024, inPerson: 70,  virtual: 16, total: 86,  upcoming: 0 },
  { fy: 2025, inPerson: 88,  virtual: 67, total: 155, upcoming: 0 },
];

// Consultant Days – Previous Years (one block per FY)
export const OPS_CONSULTANT_PREV = [
  { label: 'FY 2023 - 24', data: [
    ['Avinash Sarma', 53], ['Puneet Gupta', 53], ['Vasanth Bhatt', 39], ['Suchita Banerjee', 31],
    ['Shahnawaz Khan', 25.25], ['Vandana Jain', 12], ['Sarah Jane', 6], ['Vijay Jagannathan', 4.5],
    ['Lavika Mehta', 3], ['Aziz Jowkar', 2], ['Neha Jain', 2],
  ] },
  { label: 'FY 2024 - 25', data: [
    ['Vijay Jagannathan', 32.5], ['Puneet Gupta', 22.5], ['Shahnawaz Khan', 19.63], ['Vasanth Bhatt', 18.5],
    ['Avinash Sarma', 13.63], ['Vandana Jain', 7], ['EuRadicle', 2], ['Arya Pratap Singh', 1.5],
    ['Pushpal Machra', 1], ['Atreye Gupta', 0.75], ['Neha Jain', 2],
  ] },
  { label: 'FY 2025 - 26', data: [
    ['Shahnawaz Khan', 80], ['Vijay Jagannathan', 26], ['Vikram Duggal', 4.75], ['Vandana Jain', 3],
    ['EuRadicle', 2], ['Vasanth Bhatt', 2], ['Abdullah Taher', 1], ['Meera Rawat', 1],
    ['Arya Pratap Singh', 0.5], ['Vivian George', 0.5],
  ] },
];

// Client Status – Historical by FY (projects delivered per client)
export const OPS_CLIENT_PREV = [
  { label: '2023-2024', data: [
    ['Air India', 81], ['CISCO', 13], ['LG', 9], ['Zscaler', 9], ['Ashiana', 5], ['Vendanta', 5],
    ['SocGen', 4], ['Insurance Samadhan', 3], ['BSH', 2], ['CJ Darccl', 2], ['LG Factory', 2],
    ['Pidilite', 2], ['Al Maha', 1], ['Gera', 1], ['Nippon', 1],
  ] },
  { label: '2024-2025', data: [
    ['SocGen', 14], ['Zscaler', 9], ['Arvind Mills', 8], ['Pidilite', 8], ['Welspun', 8], ['Ascensus', 7],
    ['LG Factory', 7], ['Coca Cola', 6], ['We Hub', 5], ['Ashiana', 4], ['LG', 3], ['TDK', 3],
    ['Keller', 1], ['Osteoforge', 1], ['Yokohama', 1],
  ] },
  { label: '2025-2026', data: [
    ['DBS Bank', 32], ['Pidilite', 29], ['Axis Max Life', 24], ['FORD', 17], ['Ascensus', 11],
    ['Arcesium', 9], ['Ashiana', 8], ['Aditya Birla', 6], ['Keller', 5], ['Peepal Co', 2], ['Air India', 1],
    ['Coca Cola', 1], ['OneXtel', 1], ['Tata Cliq', 1], ['We Hub', 1], ['Zscaler', 1],
  ] },
];

// Recent Programs Feedback (scores out of 5) — shown together with live Engagement Calendar scores
export const OPS_FEEDBACK = [
  ['Ignite Your Influuence Batch 7', 4.6],
  ['Ignite Your Influuence Batch 8', 4.6],
  ['Consultative Selling', 5],
  ['The Storytelling Edge', 4.7],
  ['Business Storytelling', 4.7],
  ['Art of Strategic Storytelling Batch 3', 4.7],
  ['Art of Strategic Storytelling Batch 4', 4.8],
];

/* ─────────────────────────────── SOLUTIONING ─────────────────────────────── */
// Each mix: [label, count, value in ₹] for the year

export const SOL_BASELINE = {
  2025: {
    summary: { total: 202, closed: 56, lost: 49, process: 97 },
    industry: [
      ['FinTech', 41, 6757650], ['BFSI', 25, 10780500], ['FMCG', 16, 6554000], ['Engineering', 13, 7642500],
      ['Manufacturing', 13, 1607500], ['ITES', 11, 8758600], ['Real Estate', 9, 680500], ['Visa Services', 6, 986000],
      ['IT', 5, 0], ['Aviation', 1, 150000], ['Conglomerate', 2, 1245000], ['Consulting', 1, 0],
      ['Digital Marketing', 1, 94500], ['E-Commerce', 1, 40000], ['Environment', 1, 0], ['F&B', 1, 0],
      ['Hospitality', 1, 504000], ['Pharma', 1, 0], ['Start Up', 1, 40000],
    ],
    lineOfService: [
      ['Training', 134, 33318950], ['Talent Management', 9, 10550000], ['Coaching', 4, 1822800],
      ['Assessment', 2, 149000], ['HR Services', 1, 0],
    ],
    typeOfService: [
      ['Assessment & Development Centers', 3, 4545000], ['Executive Coaching', 0, 0], ['Facilitation', 140, 36770014],
      ['Facilitation + Creative Solutions', 1, 135000], ['Success Presentation', 23, 709800],
      ['Coaching Connects', 31, 4636936], ['Creative Solutions', 3, 0], ['IDP Creation', 1, 725000],
    ],
    developmentCategory: [
      ['Power Skills Enablement', 66, 13903200], ['Leadership Development', 48, 23973050],
      ['DEI & Culture Building', 5, 2824500], ['Digital & Business Transformation', 11, 984500],
      ['Consulting & Talent Management', 8, 1804000], ['Commercial & Sales Enablement', 9, 1406500],
      ['Creative Solutions', 2, 0], ['Assessment & Development Centers', 1, 945000],
    ],
    engagementType: [['Journey', 54, 30965650], ['Standalone', 91, 14551100]],
    customization: [['Customized', 89, 32045100], ['Standard', 50, 5023050], ['New Creation', 11, 8772600]],
    // Apr → Mar
    monthly: [13, 12, 18, 10, 19, 12, 11, 13, 12, 9, 6, 15],
  },
};

/* ─────────────────────────────── SALES ─────────────────────────────── */

// Revenue Comparison — Quarterly (Rs.), Q1 → Q4. FY 2026-27 onward is live from the Engagement Calendar.
export const SALES_QUARTERLY_REVENUE = {
  2024: [3912817, 1944773, 2868994, 1186216],
  2025: [2214052, 4441055, 4667315, 3579802],
};

// Quarterly revenue targets (Rs.), Q1 → Q4 — "Achieved" is live. null = no target set yet.
export const SALES_TARGETS = {
  2026: [11000000, 11700000, 10200000, null],
};

// Client Engagement by Financial Year (FY 2026-27 onward is live from the Engagement Calendar)
export const SALES_CLIENT_ENGAGEMENT = [
  { fy: 2020, clients: ['Ashiana', 'Karcher'] },
  { fy: 2021, clients: ['CISCO', 'LG'] },
  { fy: 2022, clients: ['AirIndia', 'Ashiana', 'CISCO', 'Commscope', 'LG', 'Nykaa', 'Radio Mirchi', 'Tata International Mumbai', 'Zscaler'] },
  { fy: 2023, clients: ['AirIndia', 'Al Maha', 'Ashiana', 'BSH', 'CISCO', 'CJ Darrcl', 'Gera', 'Insurance Samadhan', 'LG', 'LG Factory', 'Nippon', 'Pidilite', 'Societe Generale', 'Vedanta', 'Zscaler'] },
  { fy: 2024, clients: ['Arvind Mills', 'Ascensus', 'Ashiana', 'Coca Cola', 'Keller', 'LG', 'LG Factory', 'Osteoforge', 'Pidilite', 'Societe Generale', 'TDK', 'We-Hub', 'Welspun', 'Yokohama', 'Zscaler'] },
  { fy: 2025, clients: ['Aditya Birla', 'AirIndia', 'Arcesium', 'Ascensus', 'Ashiana', 'Axis MaxLife Insurance', 'Coca Cola', 'DBS Bank', 'Ford', 'Keller', 'OneXtell', 'PeepalCo', 'Pidilite', 'TataCliq', 'We-Hub', 'Zscaler'] },
];
// New-client counts exactly as recorded in the Excel (the Excel's own figures, kept as-is)
export const SALES_NEW_CLIENTS = { 2020: 2, 2021: 2, 2022: 7, 2023: 10, 2024: 9, 2025: 8 };
