import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const PAGE_URL = new URL('../src/pages/admin/index.vue', import.meta.url)

test('admin read failures remain visible and never masquerade as empty data', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /type AdminReadPhase = 'idle' \| 'ready' \| 'error'/)
  assert.match(source, /function failTabRead\(tab: TabId\)/)
  assert.match(source, /stale: previous\.phase === 'ready'/)
  assert.match(source, /activeReadState\.phase === 'error' \|\| activeReadState\.stale/)
  assert.match(source, /activeReadState\.phase === 'ready' && reportGroups\.length === 0/)
  assert.match(source, /activeReadState\.phase === 'ready' && adminTokens\.length === 0/)
  assert.match(source, /if \(!tabReadIsAuthoritative\(activeTab\.value\)\) throw new Error\('admin_read_stale'\)/)
})

test('admin search, detail, and token governance fail closed with retryable UI', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /@input="onUserQueryInput"/)
  assert.match(source, /function onUserQueryInput\(\)[\s\S]*?invalidateAdminRequest\('search-users'\)[\s\S]*?userSearching\.value = false[\s\S]*?userResults\.value = \[\][\s\S]*?userSearched\.value = false/)
  assert.match(source, /userSearchError\.value = true/)
  assert.match(source, /v-else-if="detailError"[\s\S]*?@click="retryDetail"/)
  assert.match(source, /v-if="canReadTokens && tokenInventoryUnavailable"/)
  assert.match(source, /tokenMutationIds\.includes\(token\.id\) \|\| !tokenActionsReady/)
  assert.match(source, /:aria-expanded="tokenRevokeTarget\?\.id === token\.id \? 'true' : 'false'"/)
  assert.match(source, /function restoreTokenRevokeFocus\(opener: HTMLElement \| null\)/)
  assert.match(source, /@click="openTokenRevoke\(token, \$event\)"/)
  assert.match(source, /if \(!row \|\| typeof row !== 'object'\) throw new Error\('admin_detail_not_found'\)/)
})

test('long admin collections expose deterministic pagination instead of silent caps', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /const ADMIN_LIST_PAGE = 50/)
  assert.match(source, /limit: String\(ADMIN_LIST_PAGE \+ 1\)/)
  assert.match(source, /offset: String\(reset \? 0 : listOffsets\.value\[tab\]\)/)
  assert.match(source, /appendUniqueBy\(current, visible, row => adminListKey\(tab, row\)\)/)
  assert.match(source, /const busyEpoch = \+\+listLoadingMoreEpoch/)
  assert.match(source, /if \(listLoadingMoreEpoch === busyEpoch\) listLoadingMore\.value = false/)
  for (const tab of ['suspensions', 'appeals', 'warnings', 'audit']) {
    assert.match(source, new RegExp(`loadMoreAdminList\\('${tab}'\\)`))
  }
  assert.match(source, /const PLAZA_PAGE = 20/)
  assert.match(source, /loadMorePlaza\('banners'\)/)
  assert.match(source, /loadMorePlaza\('posts'\)/)
  assert.match(source, /offset: String\(plazaOffsets\.value\.banners\)/)
  assert.match(source, /appendUniqueBy\(banners\.value, visible, row => row\.id\)/)
  assert.match(source, /const busyEpoch = \+\+plazaLoadingMoreEpoch/)
  assert.match(source, /if \(plazaLoadingMoreEpoch === busyEpoch\) plazaLoadingMore\.value = false/)
  assert.match(source, /reportOffset\.value = offset \+ visible\.length/)
  assert.match(source, /appendUniqueBy\(reportGroups\.value, visible, row => `\$\{row\.target_type\}:\$\{row\.target_id\}`\)/)
})
