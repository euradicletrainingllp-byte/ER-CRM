/**
 * Client Directory — drop-down lists (same values as the "Lists" sheet in
 * Client_Directory.xlsx). Add a value here AND in the workbook's Lists sheet.
 */
export const CLIENT_TYPES = ['Existing', 'Prospect', 'Dormant', 'Lost', 'To confirm'];
export const ACCOUNT_TIERS = ['Strategic', 'Key', 'Growth', 'Standard'];
export const INDUSTRIES = ['Automotive', 'Aviation', 'BFSI – Banking', 'BFSI – Financial Services', 'BFSI – Insurance',
  'Business Services', 'Chemicals', 'Conglomerate', 'Construction & Engineering', 'Consumer Durables & Electronics',
  'E-commerce & Retail', 'Education', 'Energy & Utilities', 'FMCG & Food', 'Government & Non-profit', 'Logistics',
  'Manufacturing', 'Media & Entertainment', 'Metals & Mining', 'Pharma & Healthcare', 'Professional Services',
  'QSR & Hospitality', 'Real Estate', 'Technology & IT Services', 'Telecom', 'Textiles & Apparel', 'Travel & Visa Services', 'Other'];
export const ORG_TYPES = ['GCC', 'MNC (India entity)', 'Indian Enterprise', 'Startup / Scale-up', 'PSU', 'Government', 'Non-profit', 'SME'];
export const EMPLOYEE_SIZES = ['< 200', '200 – 1,000', '1,000 – 5,000', '5,000 – 20,000', '20,000+'];
export const GEOGRAPHIES = ['India', 'International', 'India + International'];
export const REL_STATUS = ['Active', 'In discussion', 'Dormant', 'Lost', 'To confirm'];
export const HEALTH = ['Green', 'Amber', 'Red'];
export const LEAD_SOURCES = ['Referral', 'Existing relationship', 'Inbound enquiry', 'LinkedIn', 'Outbound / cold outreach',
  'RFP / Tender', 'Event', 'Partner', 'Consultant network', 'Other'];
export const CONTRACT_BASIS = ['PO', 'SOW', 'MSA + SOW', 'Email confirmation', 'RFP / Tender', 'Agreement', 'To confirm'];
export const CONTRACT_STATUS = ['Not started', 'In process', 'Active', 'Expiring', 'Expired', 'Not required', 'To confirm'];
export const YES_NO = ['Yes', 'No'];
export const VENDOR_REG = ['Done', 'In process', 'Not required', 'To confirm'];
export const TS_POLICY = ['Client books', 'At actuals', 'Fixed per batch', 'All-in fixed', 'Included in fee', 'To confirm'];
export const PAY_BASIS = ['From invoice date', 'From invoice upload', 'From invoice receipt', 'To confirm'];
export const PO_REQUIRED = ['Yes', 'No', 'Email confirmation'];
export const PORTALS = ['Ariba', 'Coupa', 'Email', 'Client portal (other)', 'To confirm'];
export const PAY_STATUS = ['No dues', 'Pending', 'Partly received', 'Overdue', 'Not applicable', 'To confirm'];
export const DELIVERY_MODES = ['Virtual', 'In-person', 'Hybrid', 'Mostly virtual', 'Mostly in-person'];
export const PLATFORMS = ['Microsoft Teams', 'Zoom', 'Webex', 'Google Meet', 'Client decides'];

export const CONTACT_ROLES = ['Leadership / Sponsor', 'Business POC', 'L&D / HR', 'Procurement', 'Finance / Invoice', 'Delivery / Admin', 'Commercial POC', 'Other'];
export const DECISION_ROLES = ['Decision maker', 'Approver', 'Influencer', 'Coordinator', 'End user', 'Gatekeeper'];
export const CONTACT_STATUS = ['Active', 'On leave', 'Moved role', 'Left organisation', 'Former contact'];
export const REL_STRENGTH = ['Strong', 'Moderate', 'New', 'Weak'];

export const PROGRAM_TYPES = ['Workshop', 'Learning journey', 'Coaching', 'Group coaching', 'Assessment / AC-DC', 'Keynote', 'Consulting', 'Content / Manuals', 'Other'];
export const PROGRAM_STATUS = ['Pipeline', 'Proposal shared', 'In negotiation', 'PO / SOW received', 'In delivery', 'Delivered', 'Closed', 'On hold', 'Lost', 'To confirm'];
export const FEE_BASIS = ['Per batch', 'Per day', 'Per half-day', 'Per participant', 'Fixed project', 'To confirm'];

export const ACTION_STATUS = ['Open', 'In progress', 'Done', 'Recurring', 'Dropped'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const INTERACTION_TYPES = ['Call', 'Meeting – virtual', 'Meeting – in person', 'Email', 'WhatsApp', 'Proposal presentation', 'Business review', 'Delivery visit', 'Event'];

/** Reminders: a contract ending within this many days shows as "Renew contract". */
export const CONTRACT_WARN_DAYS = 60;
