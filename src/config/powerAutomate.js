/**
 * EURADICLE CRM — POWER AUTOMATE FLOW URLS
 * ==========================================
 * Each module uses ONE flow that handles all 4 operations
 * (get / create / update / delete) via an internal Switch on "action".
 *
 * HOW TO FILL IN A URL
 * 1. Open Power Automate → your CRUD Router flow → HTTP trigger.
 * 2. Click "Copy POST URL".
 * 3. Paste it inside the quotes "" below.
 * 4. Save this file and restart the dev server (npm run dev).
 *
 * Leave a URL as empty string "" if that flow is not yet created.
 */

const FLOW_URLS = {

  // ── BD TRACKER ────────────────────────────────────────────────────────────
  // Excel: "BD Tracker.xlsx" → Sheet: "BD Tracker"
  // Payload: { action, rowId, ...fields }
  BD_TRACKER_CRUD: "https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/22/workflows/67417bdf45e242659c90e212711c1ba8/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=HcA0yPnJB-IXZcPlWJcAQ7EDZKSvNYlJOsGbgj_SZcs",

  // ── ENGAGEMENT CALENDAR ───────────────────────────────────────────────────
  // Excel: "ER  Engagement Calender_Master.xlsx" → Sheet: "MASTER SHEET"
  // Payload: { action, egId, sno, ...fields }
  ENGAGEMENT_CRUD: "https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/c4f9f9c1048b43d7838e6348eba4a132/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=HcGyJqHpsXrf7lniAh-t63Zr3Oi6E0qSKBOZkxSvLOc",

  // ── OPERATIONS CHECKLIST ──────────────────────────────────────────────────
  // Excel: "Operations Checklist.xlsx" → Sheet: "Operations checklist"
  // Payload: { action, sno, ...fields }
  OPS_CHECKLIST_CRUD: "https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/26/workflows/296a358d06c1454daa905a9b7a9295e9/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=Nhxc9n3Ge8eiHJMLHUMNWwlbGz73Qj1w9x_zTs0k7EU",

  // ── CONTENT DEVELOPMENT TRACKER ───────────────────────────────────────────
  // Excel: "Content_Development_Tracker.xlsx" → Sheet: "Sheet1"
  // Payload: { action, sno, Client, Program Start Date, End Date, Program Type,
  //            EV Required, POC, Due Date, Completion Date, PM Required }
  CONTENT_DEV_CRUD: "https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/20/workflows/3e6afbc6f0374d6d9f364836c96b2d05/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=BQHiFrCAMkMQI7mwStkZ88OUFgoQ3r5qZbbSjgBIADc",   // ← paste your PA CRUD Router URL here

  // ── SOLUTION TRACKER ──────────────────────────────────────────────────────
  // Excel: "Solutioning_Tracker.xlsx" → Sheet: "Solution Tracker"
  // Payload: { action, sno, Proposal ID, BD S No, Sol S No, Client Name, ... }
  SOLUTION_CRUD: "https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/e512fd82e2e3425d9dbba7d231588e76/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=pD3X9t1IvsUzmgTgJ33jtJtYE4lwco3j7g6Lut77LFY",      // ← paste your PA CRUD Router URL here

};

export default FLOW_URLS;

/**
 * EXCEL FILE NAMES  (must match exactly as stored in OneDrive)
 */
export const EXCEL_FILES = {
  BD_TRACKER:          "BD Tracker.xlsx",
  ENGAGEMENT:          "ER  Engagement Calender_Master.xlsx",
  OPS_CHECKLIST:       "Operations Checklist.xlsx",
  CONTENT_DEV_TRACKER: "Content_Development_Tracker.xlsx",
  SOLUTION_TRACKER:    "Solutioning_Tracker.xlsx",
};

/**
 * TABLE NAMES  (must be named Excel Tables, not plain ranges)
 * Select data → Insert → Table → rename to exactly these values
 */
export const TABLE_NAMES = {
  BD_TRACKER:       "BDTrackerTable",
  OPS_CHECKLIST:    "OpsChecklistTable",
  ENGAGEMENT:       "EngagementMasterTable",
  CONTENT_DEV:      "ContentDevTable",
  SOLUTION_TRACKER: "Table1",
};
