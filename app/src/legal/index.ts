/*
 * Single source of truth for the app's legal docs.
 *
 * Bodies live in separate files (terms.*.ts, privacy.*.ts,
 * guidelines.*.ts) so useI18n.ts doesn't get bloated with 2 KB prose
 * strings. The version constants below feed the re-consent trigger:
 * when CURRENT_CONSENT_VERSION is bumped, any logged-in user whose
 * `profile.tos_version` is older gets the re-consent screen on next
 * app open.
 *
 * Bump rule: change a document version only for material changes to Terms,
 * Privacy, or the Community Guidelines. Typo fixes and clarifications should NOT bump
 * this, or users will get re-consent fatigue.
 */
export { TERMS_VERSION, TERMS_EN } from './terms.en'
export { TERMS_ZH } from './terms.zh'
export { PRIVACY_VERSION, PRIVACY_EN } from './privacy.en'
export { PRIVACY_ZH } from './privacy.zh'
export { GUIDELINES_VERSION, GUIDELINES_EN } from './guidelines.en'
export { GUIDELINES_ZH } from './guidelines.zh'

import { TERMS_VERSION as _tv } from './terms.en'
import { PRIVACY_VERSION as _pv } from './privacy.en'
import { GUIDELINES_VERSION as _gv } from './guidelines.en'

/*
 * The effective consent version is the latest document in the bundle shown on
 * the re-consent screen. If any bundled document bumps, we re-consent.
 * Format: YYYY-MM-DD — lexicographic compare works.
 */
export const CURRENT_CONSENT_VERSION = [_tv, _pv, _gv]
  .reduce((latest, version) => version > latest ? version : latest)

export type LegalDocType = 'terms' | 'privacy' | 'guidelines'
