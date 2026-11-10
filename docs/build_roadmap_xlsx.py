from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import CellIsRule
from datetime import date

NAVY="2D3047"; PURPLE="3E3264"; MAUVE="AA78A6"; LIGHT="F2F2F2"; BORDER="E5E7EB"
F="Calibri"
hdr_font=Font(name=F,bold=True,color="FFFFFF",size=11)
hdr_fill=PatternFill("solid",fgColor=NAVY)
thin=Side(style="thin",color=BORDER)
box=Border(left=thin,right=thin,top=thin,bottom=thin)
wrap=Alignment(wrap_text=True,vertical="top")
wb=Workbook()

def sheet(name,headers,rows,widths,tname,enums=None):
    ws=wb.create_sheet(name)
    ws.append(headers)
    for r in rows: ws.append(list(r))
    for i,w in enumerate(widths,1): ws.column_dimensions[ws.cell(1,i).column_letter].width=w
    for c in ws[1]: c.font=hdr_font; c.fill=hdr_fill; c.alignment=Alignment(vertical="center",wrap_text=True)
    ws.row_dimensions[1].height=24
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment=wrap; c.border=box; c.font=Font(name=F,size=10)
            if isinstance(c.value,date): c.number_format="DD-MMM-YYYY"
    ref=f"A1:{ws.cell(1,len(headers)).column_letter}{max(2,len(rows)+1)}"
    t=Table(displayName=tname,ref=ref); t.tableStyleInfo=TableStyleInfo(name="TableStyleLight1",showRowStripes=False)
    ws.add_table(t); ws.freeze_panes="A2"
    for col,opts in (enums or {}).items():
        dv=DataValidation(type="list",formula1='"'+",".join(opts)+'"',allow_blank=True)
        ws.add_data_validation(dv); dv.add(f"{col}2:{col}500")
    return ws

def status_colors(ws,col):
    rng=f"{col}2:{col}500"
    for val,fg,bg in [("Done","0AC44B","F0FFF4"),("In progress",MAUVE,"F7F0F7"),("Not started","6B7280","F2F2F2"),("Blocked","E98272","FFF5F5"),("Open","D0A616","FFFBEA"),("Decided","0AC44B","F0FFF4")]:
        ws.conditional_formatting.add(rng,CellIsRule(operator="equal",formula=[f'"{val}"'],font=Font(color=fg,bold=True),fill=PatternFill("solid",fgColor=bg)))

# ---- Overview
ov=wb.active; ov.title="Overview"
ov.column_dimensions["A"].width=28; ov.column_dimensions["B"].width=90
ov["A1"]="EUradicle CRM — PRODUCT HISTORY & ROADMAP".replace("EUradicle","EURADICLE")
ov["A1"].font=Font(name=F,bold=True,size=18,color=NAVY)
info=[("Product","EuRadicle CRM (ER CRM) — live at crm.euradicle.com"),
("Purpose","Single register of what was built, current state and the roadmap. Update monthly with the leadership activity review."),
("Document owner","Operations & Product/Tech Support"),
("Last updated",date(2026,11,10)),
("Detailed change log","ER CRM\\docs\\CHANGELOG.md"),
("Stack","Vite + React SPA on Vercel · MSAL (Microsoft 365) login · Excel tables on OneDrive via Power Automate CRUD flows · SharePoint 'CRM ACTIVITY LOG' · 'CRM Notify' email flow"),
("Running cost","₹0 incremental (Microsoft 365, Power Automate, Vercel free tier)"),
(None,None),
("PHASE","PERIOD · SUMMARY"),
("1 · Pre-launch","19 Aug – 5 Oct 2026 · Blueprint, stack decision, core trackers, SSO, permissions"),
("2 · Launch & stabilisation","6 – 24 Oct 2026 · Index key, sync removed, Finance Tracker, notifications, Reminders, Founder's Desk v1, Leads, Vendors, Projects, Consultants"),
("3 · Post-launch","25 Oct – 10 Nov 2026 · Client Directory, Admin redesign, counting rules, GST/TDS, Founder's Desk v2, PO Tracker, pickers, dashboard overhaul"),
("4 · Go-live hardening","Nov – Dec 2026 (proposed) · Pending setup, training, data clean-up · Gate: all users trained"),
("5 · Security & reliability","Dec 2026 – Jan 2027 (proposed) · Token-verifying proxy, server-side audit, build checks · Gate: no flow URLs in browser"),
("6 · Data platform","Jan – Mar 2027 (proposed) · Excel vs Supabase decision and migration · Gate: Founder sign-off"),
("7 · Intelligence & automation","FY 2027-28 (proposed) · Daily brief, auto-tasks, lead-to-delivery conversion · Gate: adoption measured"),
(None,None),
("SHEETS","Milestones · Modules · Pending Setup · Roadmap · Risks · Decisions · Update Log"),
]
for i,(a,b) in enumerate(info,start=3):
    ov.cell(i,1,a); ov.cell(i,2,b)
    ov.cell(i,1).font=Font(name=F,bold=True,color=NAVY,size=10); ov.cell(i,2).font=Font(name=F,size=10)
    ov.cell(i,2).alignment=Alignment(wrap_text=True,vertical="top")
    if isinstance(b,date): ov.cell(i,2).number_format="DD-MMM-YYYY"; ov.cell(i,2).alignment=Alignment(horizontal="left")
for r in (11,20):
    for c in (1,2): ov.cell(r,c).font=Font(name=F,bold=True,color="FFFFFF"); ov.cell(r,c).fill=PatternFill("solid",fgColor=PURPLE)
ov.sheet_view.showGridLines=False

# ---- Milestones
P1,P2,P3="1 · Pre-launch","2 · Launch & stabilisation","3 · Post-launch"
d=lambda m,dd: date(2026,m,dd)
ms=[
(d(8,19),P1,"Architecture blueprint","Platform","10-stage customer journey, 8 screens, 9 flows, 4-phase ~128 h plan"),
(d(9,15),P1,"Stack decision","Platform","Vite + React on Vercel; Excel tables via Power Automate CRUD flows (date approximate)"),
(d(9,30),P1,"Core trackers live","Trackers","BD/Solution, Engagement Calendar, Ops Checklist, Content Dev, Admin permissions, MSAL login (date approximate)"),
(d(9,28),P1,"Activity & Audit Log plan","Control","22-column schema, event catalogue, SharePoint list storage"),
(d(10,4),P1,"Proposal links, BD Won checklist, CDT work items","Trackers","Won proposals need checklist ticks; CDT asset/pre/post-work lists; open-link buttons"),
(d(10,6),P2,"Index rollout","Data","EC Index (1–594) becomes permanent cross-tracker key"),
(d(10,7),P2,"Bulk sync removed","Data","Per-engagement 'Add to Ops / CDT' buttons; fixed 1,143-row Ops flood"),
(d(10,13),P2,"Index guard on 'Add to …'","Data","Read-back confirms Index on new Ops/CDT rows"),
(d(10,14),P2,"Finance Tracker v2","Finance","EC as finance master; all-or-nothing save with Ops copy"),
(d(10,14),P2,"BD date fixes","Trackers","Date of Discussion/Submission mandatory; flow mapping gaps found"),
(d(10,19),P2,"Email notifications + 30-min digest","Control","CRM Notify flow to tracker viewers; digest from Activity Log"),
(d(10,23),P2,"Notifications: Create & Delete only","Control","Updates stay in Activity Log"),
(d(10,23),P2,"Reminders popup","UX","Overdue / Due soon / Missing on every tracker"),
(d(10,23),P2,"Founder's Desk v1","Insight","Pulse, attention, deliveries, pipeline, cash, readiness, team load, data health"),
(d(10,23),P2,"Lead Tracker + Vendor Service Tracker","Trackers","Lead actions timeline; vendor billing and payment"),
(d(10,24),P2,"Project Management + My Tasks","People","Projects/tasks, floating panel, assignee emails"),
(d(10,24),P2,"Consultant Directory","People","37 consultants, profile pages, contract alerts"),
(d(10,25),P3,"Client Directory","Trackers","73 clients, 5 linked tables, profile pages"),
(d(10,25),P3,"Admin Panel redesign","Control","Draft + save, verify after save, role presets, access matrix"),
(d(10,26),P3,"Proposal counting rule","Insight","Line = Proposal ID + version; BD vs Solution values separate"),
(d(10,26),P3,"KPI cards follow filters","Insight","Cards match lists; Dashboard live refresh"),
(d(10,26),P3,"BD S No per version","Trackers","BD lines ordered by BD month; SocGen P.ID split"),
(d(10,30),P3,"GST 18% / TDS 10% + money parsing","Finance","Auto receivables; inflated collection figure fixed; period picker"),
(d(10,30),P3,"Revenue basis switch + 'How' lines","Insight","Delivery vs invoice month; calculation note on every card"),
(d(10,30),P3,"Founder's Desk v2","Insight","Risk Radar, Revenue Outlook, Cash Forecast, Client Concentration"),
(d(10,31),P3,"Engagement Calendar load-once","Platform","Full table loaded once, filtered in memory; All years view"),
(d(11,2),P3,"Finance Tracker FY/month filters + Invoice No","Finance","Multi-number invoice cells counted; TDS card; EC sort fix"),
(d(11,4),P3,"PO Tracker + credit notes / cancelled invoices","Finance","/po page; Order Book from live POs"),
(d(11,4),P3,"Typeahead pickers + Directory clean-up","UX","6 pickers across 10 trackers (branch feature/pickers)"),
(d(11,5),P3,"Old PO tracker merged","Data","10 POs, 49 invoice lines"),
(d(11,5),P3,"Finance reconciliation fixes","Finance","'Unpaid' bug, no-GST clients, raised/to-be-raised definitions"),
(d(11,7),P3,"Dashboard overhaul","Insight","Sales, Finance, Solutioning, Operations rebuilt; 3-year history; tap/double-tap drill"),
(d(11,8),P3,"Ops & Solutioning dashboard refinements","Insight","Turnaround removed; upcoming/delivered lists; Feedback N/A"),
(d(11,9),P3,"Finance dashboard invoice counts","Finance","Revenue = Price; invoices = raised − credit notes − cancelled"),
]
ms.sort(key=lambda r:r[0])
ws=sheet("Milestones",["Date","Phase","Milestone","Area","Outcome"],ms,[13,24,40,12,70],"Milestones",
 {"B":[P1,P2,P3,"4 · Go-live hardening","5 · Security & reliability","6 · Data platform","7 · Intelligence & automation"],
  "D":["Platform","Trackers","Data","Finance","Insight","Control","UX","People"]})

# ---- Modules
mods=[("Sales","Lead Tracker","/leads","Lead_Tracker.xlsx · LeadTable","CRM Leads CRUD","Live"),
("Sales","BD Tracker / Solution Tracker","/bd-tracker, /solution","Solutioning_Tracker.xlsx · Table1","SOLUTION_CRUD","Live"),
("Sales","Client Directory","/clients","Client_Directory.xlsx · 5 tables","CRM Clients CRUD","Live – flow on test file"),
("Delivery","Engagement Calendar","/engagement","Engagement Calendar (Index key)","ENGAGEMENT_CRUD","Live"),
("Delivery","Ops Checklist","/ops","Ops Checklist workbook","OPS_CHECKLIST_CRUD","Live"),
("Delivery","Content Dev Tracker","/content-dev","Content Dev workbook","CONTENT_DEV_CRUD","Live"),
("Delivery","Consultant Directory","/consultants","Consultant_Directory.xlsx · ConsultantTable","CRM Consultants CRUD","Live"),
("Finance","Finance Tracker","/finance","EC finance columns","ENGAGEMENT_CRUD","Live"),
("Finance","PO Tracker","/po","POTable","PO flow","Live"),
("Finance","Vendor Service Tracker","/vendors","Vendor_Service_Tracker.xlsx","CRM Vendor CRUD","Live"),
("People","Project Management + My Tasks","/tasks","Project_Management_Tracker.xlsx · TaskTable","TASKS_CRUD","Live"),
("Insight","Dashboard (5 tabs)","/dashboard","All trackers + baselines","—","Live"),
("Insight","Founder's Desk","/founder","All trackers","—","Live"),
("Control","Admin Panel","/admin","Admin Panel.xlsx · PermissionsTable","Permissions flows","Live"),
("Control","Activity Log","—","SharePoint CRM ACTIVITY LOG","CRM Audit Log","Live"),
("Control","Notifications","—","—","CRM Notify / CRM Change Digest","Live")]
ws=sheet("Modules",["Area","Module","Route","Data source","Flow","Status"],mods,[11,32,22,40,28,22],"Modules")

# ---- Pending
pend=[("Merge feature/pickers to main after local testing","Code",4,"Not started"),
("Point CLIENTS_CRUD at production Client_Directory.xlsx","Flow",4,"Not started"),
("Add Skip/Top Count paging to ENGAGEMENT_CRUD GET","Flow",4,"Not started"),
("Permission columns for Lead, Vendor, Task, Consultant, Client pages + Save Permissions flow mapping","Excel / Flow",4,"Not started"),
("Map 'Date of submission ER Team4' in SOLUTION_CRUD","Flow",4,"Not started"),
("CONTENT_DEV_CRUD: write Index on create","Flow",4,"Not started"),
("Clean Ops Checklist duplicates / wrong Index links","Data",4,"Not started"),
("Give MoEngage a new P.ID (65 shared with Ford)","Data",4,"Not started"),
("Correct Amount Received: Ashiana S No 269, Ford S No 521","Data",4,"Not started"),
("Set Date of Discussion on SocGen P.ID 18/19 V2","Data",4,"Not started"),
("Refresh crm-architecture.md to the live stack","Docs",4,"Not started")]
rows=[(i+1,a,b,"Revanth",None,s,"") for i,(a,b,_,s) in enumerate(pend)]
ws=sheet("Pending Setup",["#","Item","Type","Owner","Target date","Status","Notes"],rows,[5,62,14,14,13,14,40],"PendingSetup",
 {"C":["Code","Flow","Excel / Flow","Data","Docs"],"F":["Not started","In progress","Blocked","Done"]})
status_colors(ws,"F")
for r in range(2,200): ws.cell(r,5).number_format="DD-MMM-YYYY"

# ---- Roadmap
R4,R5,R6,R7="4 · Go-live hardening","5 · Security & reliability","6 · Data platform","7 · Intelligence & automation"
rm=[(R4,"Complete all Pending Setup items","Nov 2026","Not started"),
(R4,"CRM Orientation Module: onboarding deck + role walkthroughs","Nov 2026","In progress"),
(R4,"Data clean-up sprint (Index, BD dates, P.IDs, client names)","Nov–Dec 2026","Not started"),
(R4,"Founder's Desk: tune risk thresholds; cut-off for old Ops items","Dec 2026","Not started"),
(R4,"Old Excel trackers become read-only archive","Dec 2026","Not started"),
(R5,"Vercel serverless proxy verifying Microsoft ID token","Dec 2026","Not started"),
(R5,"Server-side audit step in every CRUD flow","Dec 2026","Not started"),
(R5,"Build check + automated tests before deploy; staging environment","Jan 2027","Not started"),
(R5,"Audit log retention: 24 months + yearly archive","Jan 2027","Not started"),
(R6,"Decision paper: Excel + Power Automate vs Supabase","Jan 2027","Not started"),
(R6,"Migrate tracker by tracker behind callFlow()","Feb–Mar 2027","Not started"),
(R6,"Shared settings (Founder's Desk layouts) in database","Mar 2027","Not started"),
(R7,"Daily brief email + owner-based routing + digest preferences","Q1 FY27-28","Not started"),
(R7,"Auto-generated tasks from trackers","Q1 FY27-28","Not started"),
(R7,"Lead → BD → Project → Engagement conversion","Q1 FY27-28","Not started"),
(R7,"Consultant picker / trainer allocation in Engagement Calendar","Q2 FY27-28","Not started"),
(R7,"Vendor margin, per-client credit periods, GST exemption flag","Q2 FY27-28","Not started"),
(R7,"PDF profiles, drag-and-drop board, recurring tasks","Q2 FY27-28","Not started")]
gates={R4:"All trackers saving via CRM; 0 setup items; users trained",R5:"No flow URL in browser; all writes logged server-side",R6:"Founder sign-off; zero data loss by row counts",R7:"Adoption measured on CRM prompts"}
rows=[(i+1,p,it,t,gates[p],"Revanth",s,0 if s!="Done" else 1,"") for i,(p,it,t,s) in enumerate(rm)]
ws=sheet("Roadmap",["#","Phase","Deliverable","Target window","Phase gate","Owner","Status","% done","Notes"],rows,[5,26,56,15,40,12,14,9,30],"Roadmap",
 {"G":["Not started","In progress","Blocked","Done"]})
status_colors(ws,"G")
for r in range(2,200): ws.cell(r,8).number_format="0%"

# ---- Risks
rk=[("Excel throttling and flow time-outs (502/504)","High","Slow/failed saves and loads","Load-once, paging, read-back; database move","4, 6","Open"),
("Flow URLs visible in browser bundle","High","Logging/permissions could be bypassed","Token-verifying Vercel proxy; server-side audit","5","Open"),
("Single developer / knowledge concentration","Medium","Delivery stalls if unavailable","This register, CHANGELOG, feature notes; second maintainer","4","Open"),
("Data quality in legacy rows","Medium","Wrong dashboards and alerts","Reminders Missing tab, Data Health, clean-up panel","4","Open"),
("Unpushed or untested changes","Medium","Live site breaks on deploy","Feature branches, local build, staging","5","Open")]
ws=sheet("Risks",["Risk","Severity","Impact","Mitigation","Phase","Status"],rk,[42,10,32,48,8,10],"Risks",
 {"B":["High","Medium","Low"],"F":["Open","Closed"]})
for val,col in [("High","E98272"),("Medium","D0A616"),("Low","0AC44B")]:
    ws.conditional_formatting.add("B2:B500",CellIsRule(operator="equal",formula=[f'"{val}"'],font=Font(color=col,bold=True)))

# ---- Decisions
dc=[(d(9,15),"Use Excel + Power Automate + Vercel instead of SharePoint Lists + Azure","Decided","No migration risk, ₹0 cost"),
(d(10,6),"EC Index is the permanent cross-tracker key","Decided","S No is display only"),
(d(10,7),"Remove bulk Sync with EC","Decided","Caused Ops flood and 502s"),
(d(10,23),"Emails on Create and Delete only","Decided","Updates in Activity Log"),
(d(10,26),"BD and Solution values kept separate (no fallback)","Decided","User decision"),
(d(11,9),"Total Revenue = Price only (GST, travel excluded)","Decided","Matches Revenue by FY chart"),
(None,"Approve Phase 4–7 timing","Open","Founder"),
(None,"Excel + Power Automate vs Supabase","Open","Decision paper in Phase 6"),
(None,"Who can see Activity Log and Founder's Desk beyond admin","Open",""),
(None,"Notification policy: instant, 30-min digest or daily brief","Open","")]
ws=sheet("Decisions",["Date","Decision","Status","Notes"],dc,[13,62,12,40],"Decisions",{"C":["Open","Decided"]})
status_colors(ws,"C")

# ---- Update log
ws=sheet("Update Log",["Date","Updated by","What changed"],[(date(2026,11,10),"Revanth","v1.0 — register created from project history (19 Aug – 10 Nov 2026) and roadmap")],[13,16,80],"UpdateLog")

for s in wb.worksheets: s.sheet_properties.tabColor=NAVY if s.title=="Overview" else MAUVE
wb.save("/tmp/out.xlsx")
