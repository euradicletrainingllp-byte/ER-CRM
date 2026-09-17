/**
 * EURADICLE CRM — MICROSOFT SSO (No admin consent required)
 * ==========================================================
 * One-time setup (you do this, not IT admin):
 *
 * 1. Go to https://portal.azure.com — sign in with ANY Microsoft account
 * 2. Search "App registrations" → New Registration
 * 3. Name: EuRadicle CRM
 * 4. Supported account types: ← IMPORTANT
 *      Select "Accounts in any organizational directory
 *      (Any Azure AD directory - Multitenant) and personal Microsoft accounts"
 *    This is what removes the admin consent requirement.
 * 5. Redirect URI → Platform: Single-page application (SPA)
 *      Value: http://localhost:3000
 * 6. Click Register
 * 7. On the Overview page, copy "Application (client) ID" → paste as CLIENT_ID below
 * 8. Leave TENANT_ID as "common" — do NOT change it
 *
 * That's it. No API permissions to add. No admin to contact.
 * Each team member sees a one-time "Allow this app to read your profile?" prompt
 * the very first time they sign in. They click Accept themselves. After that:
 * silent SSO — they're logged in instantly on every visit.
 */

export const CLIENT_ID = "b01b79c3-7d5b-4dbd-a81f-e0d365464352";
// DO NOT change this — "common" allows both work and personal Microsoft accounts
// without requiring admin consent from any organisation
const TENANT_ID = "common";

export const msalConfig = {
  auth: {
    clientId:    CLIENT_ID,
    authority:   `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:          "localStorage",   // persists across tabs/restarts
    storeAuthStateInCookie: true,             // helps with Safari + IE
  },
};

// Basic OIDC scopes only — NO admin consent needed for these
export const loginRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

// After Microsoft verifies identity, we additionally restrict by email domain.
// Anyone not in this list sees "Access Denied" even if they have a Microsoft account.
// Leave [] to allow ALL Microsoft accounts (not recommended).
export const ALLOWED_DOMAINS = [
  "euradicle.com",
  "euradicletrainingllp.com",
  "outlook.com",    // personal Outlook accounts
  "hotmail.com",    // personal Hotmail accounts
  "live.com",       // personal Live accounts
  "gmail.com",      // Gmail-linked Microsoft accounts
];

// Optional: restrict to specific named email addresses only.
// If this array has entries, ONLY these exact emails get access (domains above are ignored).
// Leave [] to allow anyone from the domains above.
export const ALLOWED_EMAILS = [];
