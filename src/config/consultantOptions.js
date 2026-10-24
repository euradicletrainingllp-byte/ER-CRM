/**
 * CONSULTANT DIRECTORY — drop-down lists
 * Same values as the drop-downs in Consultant_Directory.xlsx. Values already saved in
 * Excel that are not in a list still show (marked "old value"), so lists can change safely.
 */
export const DESIGNATIONS = ['Founder & Managing Partner', 'Partner Consultant', 'Senior Consultant', 'Senior Consultant / Coach', 'Consultant', 'Associate Consultant', 'Executive Coach', 'Facilitator', 'Subject Matter Expert'];
export const ENGAGEMENT_MODELS = ['Founder', 'Associate (per engagement)', 'Retainer', 'Full-time', 'Partner firm'];
export const CONSULTANT_STATUS = ['Active', 'Onboarding', 'On hold', 'Inactive'];
export const PRACTICE_BADGES = ['Artificial Intelligence', 'Leadership', 'Coaching', 'Communication & Presentations', 'Sales', 'Train the Trainer', 'Keynote Speaker', 'HR & Talent Management'];
export const CREDENTIALS = ['ICF ACC', 'ICF PCC', 'ICF MCC', 'EMCC', 'Other', 'None'];
export const DELIVERY_MODES = ['In-person', 'Virtual', 'Both'];
export const YES_NO = ['Yes', 'No'];
export const CURRENCIES = ['INR', 'AED', 'USD', 'GBP'];
export const TRAVEL_TERMS = ['Client-billed at actuals', 'Borne by EuRadicle', 'Included in day rate', 'Case by case'];
export const CONTRACT_TYPES = ['Associate Agreement', 'Freelance / Per-engagement SOW', 'Retainer Agreement', 'Employment', 'Partner Agreement'];
export const CONTRACT_STATUS = ['Not started', 'Draft', 'Sent for signature', 'Signed', 'Expired', 'Terminated'];
export const RATINGS = ['5', '4', '3', '2', '1'];

/** Default reminder window before contract expiry (days), when the row has none. */
export const DEFAULT_RENEWAL_NOTICE = 30;

export const CURRENCY_SYMBOL = { INR: '₹', AED: 'AED ', USD: '$', GBP: '£' };
