/**
 * Known spelling variants of client names used in the trackers → the name in the Client Directory.
 * Keys are compared ignoring case, spaces and punctuation. Add a line when a new variant turns up.
 * Used by the pickers (a variant counts as "in the directory") and by the clean-up panel.
 */
export const CLIENT_ALIASES = {
  'Arcellor Mittal': 'ArcelorMittal',
  'Arcelor Mittal': 'ArcelorMittal',
  'CJ Darrcl': 'CJ Darcl',
  'SocGen': 'Societe Generale',
  'Société Générale': 'Societe Generale',
  'Avery Dennisen': 'Avery Dennison',
};

/** Names in the trackers that are not clients — never offered for the directory or flagged. */
export const NOT_A_CLIENT = ['Open Program', 'EuRadicle', 'Internal', 'TBD', 'NA', 'N/A'];

/** Extra names allowed in consultant fields besides the Consultant Directory and the team. */
export const CONSULTANT_EXTRAS = ['EuRadicle', 'ER PMO Team', 'TBD'];
