const ACCOUNT_GATE_PAGES = new Set([
  'pages/suspended/index',
  'pages/reconsent/index',
  'pages/profile-recovery/index',
  'pages/onboarding/index',
  'pages/welcome/index',
  'pages/login/index',
])

// Keep listeners and unread state live while account flows own the screen.
// Only unsolicited incoming-message and notification prompts use this gate.
export function currentPageAllowsIncomingPrompts(): boolean {
  try {
    const pages = getCurrentPages() as Array<{ route?: string }>
    return !ACCOUNT_GATE_PAGES.has(pages[pages.length - 1]?.route || '')
  } catch {
    return true
  }
}
