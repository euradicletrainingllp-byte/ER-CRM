# EuRadicle CRM — Setup Guide

## Overview

This React app reads and writes your Excel files stored on **OneDrive / SharePoint** through **Power Automate instant flows**. No database, no backend server — just your existing Excel files, accessed live.

```
React App  →  Power Automate HTTP Flow  →  Excel on OneDrive
   ↑                                              ↓
   └──────────── JSON response ───────────────────┘
```

---

## STEP 1 — Prepare Your Excel Files

Open each Excel file on OneDrive and format the data as a **Named Table** (not just a plain range). This is required for Power Automate's Excel connector to work.

### In Tracker Sample.xlsx:

**BD Tracker sheet:**
1. Click any cell inside your BD data
2. Press `Ctrl + T` → tick "My table has headers" → OK
3. In the Table Design tab (top ribbon), set the **Table Name** to: `BDTrackerTable`

**Operations checklist sheet:**
1. Same steps → set Table Name to: `OpsChecklistTable`

### In ER Engagement Calender_Master 3.xlsx:

**MASTER SHEET:**
1. Click inside the data (starting from row 2 — the header row)
2. `Ctrl + T` → OK
3. Set Table Name to: `EngagementMasterTable`

---

## STEP 2 — Create Power Automate Flows

Go to **https://make.powerautomate.com** → Sign in with your Microsoft 365 account.

You need to create **8 flows** total. Each follows the same pattern:

```
Trigger: When an HTTP request is received
   ↓
Action: [Excel operation]
   ↓
Action: Response (with CORS headers)
```

---

### HOW TO BUILD ONE FLOW (Template — repeat for each flow)

#### A. Create the flow
1. Click **+ Create** → **Instant cloud flow**
2. Flow name: (e.g., `EUR_GET_BD_TRACKER`)
3. Trigger: **When an HTTP request is received**
4. Click **Create**

#### B. Configure the HTTP trigger
- Click the trigger step
- Set **Method**: `POST`
- Leave URL blank (it generates automatically after first save)
- Optionally paste a sample JSON body to auto-generate the schema

#### C. Add CORS headers to EVERY Response action
In the **Response** action, click **Show advanced options** and add these headers:

| Header | Value |
|--------|-------|
| `Access-Control-Allow-Origin` | `*` |
| `Access-Control-Allow-Methods` | `POST, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type` |

#### D. Save and copy the URL
- Click **Save**
- Click the HTTP trigger step
- Copy the **HTTP POST URL** (it looks like `https://prod-xx.eastus.logic.azure.com:443/workflows/...`)
- Paste it into `src/config/powerAutomate.js`

---

## STEP 3 — Build Each Flow

### Flow 1: `GET_BD_TRACKER`

**Purpose:** Read all rows from BD Tracker and return as JSON

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Method: POST |
| 1 | List rows present in a table | Location: OneDrive for Business, File: `Tracker Sample.xlsx`, Table: `BDTrackerTable` |
| 2 | Response | Status: 200, Body: `@{outputs('List_rows_present_in_a_table')?['body']}`, Headers: (CORS headers above) |

Config key to update: `GET_BD_TRACKER`

---

### Flow 2: `ADD_BD_ROW`

**Purpose:** Add a new row to BD Tracker when a lead is created in the CRM

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Method: POST, Sample body: `{"Client":"Test","Topic":"Test","Status":"Prospect"}` |
| 1 | Parse JSON | Content: `triggerBody()`, Schema: generate from sample |
| 2 | Add a row into a table | File: `Tracker Sample.xlsx`, Table: `BDTrackerTable`, map each column to the parsed JSON field |
| 3 | Response | Status: 200, Body: `{"success": true}`, Headers: (CORS) |

Config key to update: `ADD_BD_ROW`

---

### Flow 3: `UPDATE_BD_ROW`

**Purpose:** Update an existing BD row (e.g., status change)

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Sample body: `{"sno":1,"Status":"Won"}` |
| 1 | Parse JSON | Parse trigger body |
| 2 | List rows present in a table | File: `Tracker Sample.xlsx`, Table: `BDTrackerTable`, Filter Query: `S.No eq @{body('Parse_JSON')?['sno']}` |
| 3 | Update a row | File: `Tracker Sample.xlsx`, Table: `BDTrackerTable`, Key Column: `S.No`, Key Value: `@{body('Parse_JSON')?['sno']}`, update desired columns |
| 4 | Response | Status: 200, Body: `{"success": true}`, Headers: (CORS) |

Config key to update: `UPDATE_BD_ROW`

---

### Flow 4: `GET_ENGAGEMENTS`

**Purpose:** Fetch all rows from Engagement Calendar Master Sheet

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Method: POST |
| 1 | List rows present in a table | File: `ER  Engagement Calender_Master 3.xlsx`, Table: `EngagementMasterTable` |
| 2 | Response | Status: 200, Body: `@{outputs('List_rows_present_in_a_table')?['body']}`, Headers: (CORS) |

Config key to update: `GET_ENGAGEMENTS`

---

### Flow 5: `ADD_ENGAGEMENT_ROW`

**Purpose:** Add a new engagement row (when BD marks deal as Won and creates engagement)

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Sample body: `{"egId":"EG.ID 430","company":"ACME","topic":"Leadership Edge","startDate":"2026-09-01","status":"Scheduled"}` |
| 1 | Parse JSON | Parse trigger body |
| 2 | Add a row into a table | File: `ER  Engagement Calender_Master 3.xlsx`, Table: `EngagementMasterTable`, map columns |
| 3 | Response | Status: 200, Body: `{"success": true}`, Headers: (CORS) |

Config key to update: `ADD_ENGAGEMENT_ROW`

---

### Flow 6: `UPDATE_ENGAGEMENT_ROW`

**Purpose:** Update engagement status/fields by EG.ID

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Sample body: `{"egId":"EG.ID 430","sno":586,"Status":"Delivered"}` |
| 1 | Parse JSON | Parse trigger body |
| 2 | Update a row | File: `ER  Engagement Calender_Master 3.xlsx`, Table: `EngagementMasterTable`, Key Column: `S.No`, Key Value from body |
| 3 | Response | Status: 200, Body: `{"success": true}`, Headers: (CORS) |

Config key to update: `UPDATE_ENGAGEMENT_ROW`

---

### Flow 7: `GET_OPS_CHECKLIST`

**Purpose:** Fetch all rows from the Operations Checklist sheet

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Method: POST |
| 1 | List rows present in a table | File: `Tracker Sample.xlsx`, Table: `OpsChecklistTable` |
| 2 | Response | Status: 200, Body: `@{outputs('List_rows_present_in_a_table')?['body']}`, Headers: (CORS) |

Config key to update: `GET_OPS_CHECKLIST`

---

### Flow 8: `UPDATE_OPS_ROW`

**Purpose:** Tick/update a single checklist item (e.g., mark "Welcome Email" as Yes)

| Step | Action | Settings |
|------|--------|----------|
| Trigger | When an HTTP request is received | Sample body: `{"sno":1,"field":"Welcome Email(Pre Work & Training Program) - Sent","value":"Yes"}` |
| 1 | Parse JSON | Parse trigger body |
| 2 | Update a row | File: `Tracker Sample.xlsx`, Table: `OpsChecklistTable`, Key Column: `S.No`, Key Value: from body, update the field column with the value from body |
| 3 | Response | Status: 200, Body: `{"success": true}`, Headers: (CORS) |

Config key to update: `UPDATE_OPS_ROW`

---

## STEP 4 — Paste URLs into the Config

Open `src/config/powerAutomate.js` and paste each flow's HTTP POST URL:

```js
const FLOW_URLS = {
  GET_BD_TRACKER:     "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  ADD_BD_ROW:         "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  UPDATE_BD_ROW:      "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  GET_ENGAGEMENTS:    "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  ADD_ENGAGEMENT_ROW: "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  UPDATE_ENGAGEMENT_ROW: "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  GET_OPS_CHECKLIST:  "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
  UPDATE_OPS_ROW:     "https://prod-xx.eastus.logic.azure.com:443/workflows/YOUR_URL_HERE...",
};
```

---

## STEP 5 — Run the App

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser
http://localhost:3000
```

---

## STEP 6 — Deploy (Optional)

To make the app accessible to your whole team on a URL:

### Option A — Vercel (Free, easiest)
```bash
npm install -g vercel
vercel
```

### Option B — Azure Static Web Apps
```bash
npm run build
# Upload the dist/ folder to Azure Static Web Apps
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "FLOW_NOT_CONFIGURED" error | Paste the PA flow URL in `src/config/powerAutomate.js` |
| CORS error in browser console | Add CORS headers to the Response action in your PA flow (see Step 2C) |
| "List rows" returns empty | Verify the table name matches exactly (`BDTrackerTable`, etc.) |
| PA flow returns 400 error | Check that the Excel file path matches exactly as it appears in OneDrive |
| Data not updating | Click "↺ Refresh" button in the app — it re-fetches from Excel |
| Date column shows wrong value | Power Automate may return dates as Excel serial numbers — the `api.js` service handles this automatically |

---

## Project Structure

```
euradicle-crm/
├── src/
│   ├── config/
│   │   └── powerAutomate.js   ← PASTE YOUR FLOW URLS HERE
│   ├── services/
│   │   └── api.js             ← All PA HTTP calls (do not edit unless adding new flows)
│   ├── pages/
│   │   ├── Dashboard.jsx      ← Overview + KPIs
│   │   ├── BDPipeline.jsx     ← BD Tracker
│   │   ├── EngagementCalendar.jsx ← Engagement Calendar
│   │   └── OpsChecklist.jsx   ← Operations Checklist
│   ├── components/            ← Shared UI components
│   └── styles/index.css
├── package.json
├── vite.config.js
└── README.md                  ← This file
```
