export const RECOVERY_IDENTITY_MISMATCH = 'recovery_identity_mismatch'

interface RecoveryUser {
  id?: string | null
  email?: string | null
}

interface RecoverySession {
  access_token?: string | null
  refresh_token?: string | null
  user?: RecoveryUser | null
}

export interface RecoveryVerification {
  user?: RecoveryUser | null
  session?: RecoverySession | null
}

interface RecoveryAuthClient {
  auth: {
    setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
      data: { user?: RecoveryUser | null; session?: RecoverySession | null }
      error: unknown | null
    }>
    updateUser(attributes: { password: string }): Promise<{
      data: { user?: RecoveryUser | null }
      error: unknown | null
    }>
  }
}

export interface RecoveryPasswordUpdateResult {
  data: { user: RecoveryUser | null }
  error: unknown | null
}

function normalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function identityMatches(user: RecoveryUser | null | undefined, userId: string, email: string): boolean {
  return Boolean(
    user
    && typeof user.id === 'string'
    && user.id === userId
    && normalizedEmail(user.email) === email,
  )
}

function identityMismatch(): Error & { code: string } {
  const error = new Error('The verified recovery identity changed before the password update') as Error & { code: string }
  error.name = 'RecoveryIdentityMismatchError'
  error.code = RECOVERY_IDENTITY_MISMATCH
  return error
}

function mismatchResult(): RecoveryPasswordUpdateResult {
  return { data: { user: null }, error: identityMismatch() }
}

/**
 * Update a password using only the session returned by this recovery OTP.
 *
 * auth-js `updateUser()` intentionally reloads the current client session.
 * The normal app client is persisted and shared between tabs, so both
 * `verifyOtp()` and this helper must use the same newly-created, non-persisted
 * client. The helper reinstalls the captured recovery tokens there and
 * verifies identity at every server-returned boundary before allowing the
 * password mutation.
 */
export async function updateRecoveryPasswordWithBoundSession(
  client: RecoveryAuthClient,
  verification: RecoveryVerification,
  expectedEmailInput: string,
  password: string,
): Promise<RecoveryPasswordUpdateResult> {
  const expectedEmail = normalizedEmail(expectedEmailInput)
  const verifiedUser = verification?.user
  const verifiedSession = verification?.session
  const verifiedUserId = typeof verifiedUser?.id === 'string' ? verifiedUser.id : ''
  const accessToken = typeof verifiedSession?.access_token === 'string'
    ? verifiedSession.access_token
    : ''
  const refreshToken = typeof verifiedSession?.refresh_token === 'string'
    ? verifiedSession.refresh_token
    : ''

  if (
    !expectedEmail
    || !verifiedUserId
    || !accessToken
    || !refreshToken
    || !identityMatches(verifiedUser, verifiedUserId, expectedEmail)
    || !identityMatches(verifiedSession?.user, verifiedUserId, expectedEmail)
  ) return mismatchResult()

  const bound = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (bound.error) return { data: { user: null }, error: bound.error }
  if (
    !identityMatches(bound.data?.user, verifiedUserId, expectedEmail)
    || !identityMatches(bound.data?.session?.user, verifiedUserId, expectedEmail)
  ) return mismatchResult()

  const updated = await client.auth.updateUser({ password })
  if (updated.error) return { data: { user: null }, error: updated.error }
  if (!identityMatches(updated.data?.user, verifiedUserId, expectedEmail)) return mismatchResult()

  return { data: { user: updated.data.user || null }, error: null }
}
