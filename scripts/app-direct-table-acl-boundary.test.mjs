import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP_SRC = path.join(ROOT, 'app/src')
const migrationUrl = new URL(
  '../supabase/migrations/20260718280000_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return /\.(?:ts|vue)$/.test(entry.name) ? [absolute] : []
  }))
  return nested.flat()
}

test('migration inventory covers every shipped direct relation plus view dependencies', async () => {
  const files = await sourceFiles(APP_SRC)
  const relations = new Set()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)) {
      relations.add(match[1])
    }
  }

  // item-images is the Storage bucket, whose object-table contract belongs to
  // migration 230. Everything else is a direct public-schema Data API path.
  assert.equal(relations.delete('item-images'), true)
  assert.deepEqual([...relations].sort(), [
    'banners_live',
    'blocks',
    'community_event_sync_state',
    'community_events',
    'conversation_archives',
    'conversations',
    'favorites',
    'follows',
    'hidden_items',
    'items',
    'meetups',
    'messages',
    'notifications',
    'offers',
    'post_bookmarks',
    'post_comment_likes',
    'post_comments',
    'post_follows',
    'post_items',
    'post_likes',
    'posts',
    'profiles',
    'ratings',
    'reports',
    'saved_searches',
    'suspensions',
  ])

  // post_follows and post_bookmarks are created, with their grants and policies, by the P3 migration;
  // community_events, read for a topic's event card, by the events migration.
  const migration = (await readFile(migrationUrl, 'utf8')) + (await readFile(new URL('../supabase/migrations/20260916195510_discovery_preferences.sql', import.meta.url), 'utf8'))
    + (await readFile(new URL('../supabase/migrations/20261120100354_community_watch_save_activity.sql', import.meta.url), 'utf8'))
    + (await readFile(new URL('../supabase/migrations/20261120122054_community_events.sql', import.meta.url), 'utf8'))
  for (const relation of relations) {
    assert.match(migration, new RegExp(`public\\.${relation}\\b`), relation)
  }
  assert.match(migration, /public\.banners\b/)
  assert.match(migration, /security_invoker=true/)
})

test('ACL reset removes table and column drift before exact role grants', async () => {
  const [migration, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  assert.match(migration, /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)/)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO service_role/)
  assert.match(
    migration,
    /GRANT INSERT \(id, nickname, avatar_url, bio, location, status_text, status_emoji\)\s+ON TABLE public\.profiles TO authenticated/,
  )
  assert.match(
    verify,
    /'profiles', 'INSERT', ARRAY\[\s*'id','nickname','avatar_url','bio','location','status_text','status_emoji'/,
  )
  assert.match(verify, /aclexplode\(relation\.relacl\)/)
  assert.match(verify, /aclexplode\(attribute\.attacl\)/)
  assert.match(verify, /SELECT \* FROM expected EXCEPT SELECT \* FROM actual/)
  assert.match(verify, /SELECT \* FROM actual EXCEPT SELECT \* FROM expected/)
  assert.match(verify, /permissive RLS policy inventory drift/)
})

test('public profile projection excludes identity, contact and moderation state', async () => {
  const migration = (await readFile(migrationUrl, 'utf8')) + (await readFile(new URL('../supabase/migrations/20260916195510_discovery_preferences.sql', import.meta.url), 'utf8'))
  const match = migration.match(
    /GRANT SELECT \(\s*id, nickname,[\s\S]*?\) ON TABLE public\.profiles TO anon, authenticated;/,
  )
  assert.ok(match, 'explicit public profiles column grant missing')
  for (const privateColumn of [
    'phone',
    'email',
    'wechat_openid',
    'wechat_unionid',
    'trust_score',
    'shadow_banned',
    'suspension_level',
    'suspended_until',
    'last_fp_hash',
    'last_fp_seen_at',
    'warning_count',
    'verified_illini_email',
    'unsubscribe_token',
  ]) {
    assert.doesNotMatch(match[0], new RegExp(`\\b${privateColumn}\\b`), privateColumn)
  }
})

test('count and suspension filters use explicitly granted columns', async () => {
  const [follow, notifications, suspended, migration] = await Promise.all([
    readFile(new URL('../app/src/composables/useFollow.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/composables/useNotifications.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/pages/suspended/index.vue', import.meta.url), 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])
  const allClientSource = `${follow}\n${notifications}\n${suspended}`

  assert.doesNotMatch(allClientSource, /\.select\(['"]\*['"]\s*,\s*\{\s*count:/)
  assert.match(follow, /\.select\('followee_id', \{ count: 'estimated', head: true \}\)/)
  assert.match(notifications, /\.select\('id', \{ count: 'exact', head: true \}\)/)
  assert.match(suspended, /\.eq\('profile_id', userId\)/)
  assert.match(suspended, /\.is\('lifted_at', null\)/)
  assert.match(migration, /id, profile_id, level, reason, category, started_at, ends_at, lifted_at,[\s\S]*appeal_note[\s\S]*ON TABLE public\.suspensions TO authenticated/)
})

test('comment status remains selectable only through active-row RLS for report snapshots', async () => {
  const [migration, precheck, verify, regression] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(migration, /id, post_id, user_id, content, parent_comment_id, created_at, like_count,\s+status\s+\) ON TABLE public\.post_comments TO anon, authenticated/)
  assert.match(precheck, /\('post_comments', 'status'\)/)
  assert.match(verify, /'post_comments', 'SELECT',[\s\S]*?'like_count','status'/)
  assert.match(regression, /\$comment_report_contract\$/)
  assert.match(regression, /authenticated saw hidden comment/)
  assert.match(regression, /ACL active comment report/)
  assert.match(regression, /hidden comment was reportable/)
})

/*
 * 20261120100354 gives post_comments a column no API role may read
 * (reply_to_comment_id). PostgREST reads every column for `select=*`, and
 * supabase-js sends exactly that for a bare `.select()`, so either one is now
 * answered with 42501 for anon and authenticated. Every read of post_comments
 * has to name its columns, and that column cannot be one of them.
 */
const SHIPPED_SOURCES = [[path.join(ROOT, 'app/src'), /\.(?:ts|vue|js)$/], [path.join(ROOT, 'api'), /\.(?:js|mjs|ts)$/]]

async function shippedSources() {
  const walk = async (directory, pattern) => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(absolute, pattern)
    return pattern.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name) ? [absolute] : []
  }))).flat()
  const files = (await Promise.all(SHIPPED_SOURCES.map(([directory, pattern]) => walk(directory, pattern)))).flat()
  return Promise.all(files.map(async file => ({ file: path.relative(ROOT, file), source: await readFile(file, 'utf8') })))
}

// The index just past the string or template literal that opens at `start`.
function skipLiteral(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') i += 2
    else if (source[i] === quote) return i + 1
    else if (quote === '`' && source.startsWith('${', i)) i = skipBalanced(source, i + 2, '}')
    else i += 1
  }
  return i
}

// The index just past the bracket that closes the one opened right before `start`.
function skipBalanced(source, start, close) {
  const open = { ')': '(', '}': '{' }[close]
  let depth = 1
  let i = start
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') i = skipLiteral(source, i)
    else if (source.startsWith('//', i)) i = (source.indexOf('\n', i) + 1) || source.length
    else if (source.startsWith('/*', i)) i = (source.indexOf('*/', i + 2) + 2) || source.length
    else if (ch === close && --depth === 0) return i + 1
    else { if (ch === open) depth += 1; i += 1 }
  }
  return i
}

// The index just past the `>` that closes the type arguments opened right before `start`.
function skipTypeArguments(source, start) {
  let depth = 1
  let i = start
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') i = skipLiteral(source, i)
    else if (source.startsWith('=>', i)) i += 2
    else { depth += ch === '<' ? 1 : ch === '>' ? -1 : 0; i += 1 }
  }
  return i
}

// The method call that starts at `index`, in any of the ways one is written: .name(…), ?.name(…)
// or ['name'](…), with or without type arguments. White space and comments may come before it.
// Null when no call starts there.
function callAt(source, index) {
  const head = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(?:\??\.\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\s*\[\s*(['"`])([A-Za-z_$][\w$]*)\2\s*\])\s*/.exec(source.slice(index))
  if (!head) return null
  let open = index + head[0].length
  if (source[open] === '<') open = skipTypeArguments(source, open + 1)
  while (/\s/.test(source[open] ?? '')) open += 1
  if (source[open] !== '(') return null
  const end = skipBalanced(source, open + 1, ')')
  return { name: head[1] ?? head[3], args: source.slice(open + 1, end - 1), end }
}

// Every call chained straight onto the expression that ends at `index`, across
// lines and comments: [name, the text between its parentheses].
function chainedCalls(source, index) {
  const calls = []
  for (let i = index; ;) {
    const call = callAt(source, i)
    if (!call) return calls
    calls.push([call.name, call.args])
    i = call.end
  }
}

// Every from-call in the source, however it is written: where it starts, where it ends and the
// text of its first argument.
function fromCalls(source) {
  const calls = []
  for (const hit of source.matchAll(/\??\.\s*from\b|\[\s*(['"`])from\1\s*\]/g)) {
    const call = callAt(source, hit.index)
    if (call?.name === 'from') calls.push({ index: hit.index, end: call.end, table: topLevelParts(call.args)[0] })
  }
  return calls
}

// The parts of `list` between commas that are not inside brackets or literals.
function topLevelParts(list) {
  const parts = []
  let from = 0
  for (let i = 0; i < list.length;) {
    const ch = list[i]
    if (ch === '"' || ch === "'" || ch === '`') i = skipLiteral(list, i)
    else if (ch === '(') i = skipBalanced(list, i + 1, ')')
    else if (ch === '{') i = skipBalanced(list, i + 1, '}')
    else { if (ch === ',') { parts.push(list.slice(from, i)); from = i + 1 } i += 1 }
  }
  return [...parts, list.slice(from)].map(part => part.trim())
}

// An argument without the cast that may follow it ('a' as any, NAME as never): the literal or the
// name it starts with. Null when there is more to it than that.
function castFree(argument) {
  const text = argument.trim()
  const literal = /^['"`]/.test(text)
  const head = literal ? skipLiteral(text, 0) : (/^[A-Za-z_$][\w$]*/.exec(text) ?? [''])[0].length
  if (!head || (literal && (head < 2 || text[head - 1] !== text[0]))) return null
  return /^(?:\s+(?:as|satisfies)\s[\s\S]*)?$/.test(text.slice(head)) ? text.slice(0, head) : null
}

// The text an argument stands for, or null when the source does not spell it out: a literal, a
// template, or a constant of the same file.
function spelledOut(source, argument) {
  const expression = castFree(argument)
  if (expression === null) return null
  const constant = name => {
    const literal = new RegExp(`\\bconst ${name.replace(/\$/g, '\\$')}\\s*(?::[^=]*)?=\\s*(['"\`])`).exec(source)
    if (!literal) return null
    const start = literal.index + literal[0].length - 1
    return spelledOut(source, source.slice(start, skipLiteral(source, start)))
  }
  if (!/^['"`]/.test(expression)) return constant(expression)
  let text = expression.slice(1, -1)
  if (expression[0] !== '`') return text
  for (const [placeholder, name] of text.matchAll(/\$\{\s*([^{}]*?)\s*\}/g)) {
    const value = /^[A-Za-z_$][\w$]*$/.test(name) ? constant(name) : null
    if (value === null) return null
    text = text.replace(placeholder, value)
  }
  return text
}

// The names of the constants that hold the table's name. A from-call given one of them reads the
// table as well, whichever shipped file the constant is in.
const tableConstants = source => [...source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(['"`])post_comments\2/g)].map(match => match[1])

// What a column list asks of post_comments that no API role is granted, if anything.
function columnProblem(columns) {
  if (!columns.trim() || topLevelParts(columns).includes('*')) return 'reads every column'
  return /\breply_to_comment_id\b/.test(columns) ? 'names reply_to_comment_id, which no API role may read' : null
}

// What is left of a URL from `start` on: up to the white space or the quote that ends it, with
// the placeholders of a template taken whole.
function urlTail(source, start) {
  let i = start
  while (i < source.length && !/[\s'"`]/.test(source[i])) i = source.startsWith('${', i) ? skipBalanced(source, i + 2, '}') : i + 1
  return source.slice(start, i)
}

// What is wrong with the way one source reads post_comments, and how many reads it names in full.
// `constants` are the names that stand for the table, in this file or in another shipped one.
function postCommentReads(source, constants = tableConstants(source)) {
  const problems = []
  let named = 0
  const lineOf = index => source.slice(0, index).split('\n').length
  // The table is named by a literal, with or without a cast, or by a constant.
  for (const from of fromCalls(source)) {
    const table = spelledOut(source, from.table)
    if (table !== 'post_comments' && !(table === null && constants.includes(castFree(from.table)))) continue
    const line = lineOf(from.index)
    const calls = chainedCalls(source, from.end)
    if (!calls.length) problems.push(`line ${line}: nothing is chained onto .from('post_comments'), so what it reads cannot be checked`)
    for (const [name, args] of calls) {
      if (name !== 'select') continue
      const columns = args.trim() ? spelledOut(source, topLevelParts(args)[0]) : ''
      const problem = columns === null ? null : columnProblem(columns)
      if (columns === null) problems.push(`line ${line}: the columns of .select(${args.trim()}) are not spelled out in this file`)
      else if (problem) problems.push(`line ${line}: .select(${args.trim()}) ${problem}`)
      else named += 1
    }
  }
  // The same read, embedded in another table's column list…
  for (const embedded of source.matchAll(/\bpost_comments(?:!\w+)?\s*\(/g)) {
    const end = skipBalanced(source, embedded.index + embedded[0].length, ')')
    const columns = source.slice(embedded.index + embedded[0].length, end - 1)
    if (topLevelParts(columns).includes('*')) problems.push(`line ${lineOf(embedded.index)}: post_comments(*) reads every column`)
    else if (columnProblem(columns)?.startsWith('names')) problems.push(`line ${lineOf(embedded.index)}: post_comments(${columns.trim()}) ${columnProblem(columns)}`)
  }
  // …or written as a REST request: the path, and whatever the same literal puts after it.
  for (const rest of source.matchAll(/\/rest\/v1\/post_comments\b|\bpost_comments(?=\?[\w$])/g)) {
    const line = lineOf(rest.index)
    const select = /[?&]select=([^&]*)/.exec(urlTail(source, rest.index + rest[0].length))
    if (!select) { problems.push(`line ${line}: a request for post_comments without select= reads every column`); continue }
    const columns = spelledOut(source, `\`${select[1]}\``)
    const problem = columns === null ? null : columnProblem(columns)
    if (columns === null) problems.push(`line ${line}: the columns of post_comments?select=${select[1]} are not spelled out in this file`)
    else if (problem) problems.push(`line ${line}: post_comments?select=${select[1]} ${problem}`)
  }
  return { problems, named }
}

test('no shipped read of post_comments asks for every column', async () => {
  // What the scan must refuse, and what it must accept, before it is trusted with the real sources.
  const fields = "const FIELDS = 'id, content'\n"
  for (const [sample, expected] of [
    ["supabase\n  .from('post_comments')\n  .select('*')\n  .eq('post_id', id)", 'reads every column'],
    ["supabase.from('post_comments').select()", 'reads every column'],
    ["supabase.from('post_comments').select('id, *')", 'reads every column'],
    ["supabase\n  .from(\"post_comments\")\n  // returns the row\n  .insert({ content: 'a (b' })\n  .select()\n  .single()", 'reads every column'],
    [`${fields}supabase.from('post_comments').select(\`\${FIELDS}, *\`)`, 'reads every column'],
    ["supabase.from('post_comments').select(columns)", 'not spelled out'],
    ["const query = supabase.from('post_comments')\nquery.select('*')", 'cannot be checked'],
    ["supabase.from('posts').select('id, post_comments(*)')", 'post_comments(*) reads every column'],
    ["supabase.from('posts').select('id, replies:post_comments!post_comments_post_id_fkey(id, *)')", 'post_comments(*) reads every column'],
    ['fetch(`${base}/rest/v1/post_comments?post_id=eq.${id}&select=*`)', 'post_comments?select=* reads every column'],
    // The table named another way: through a constant, under a cast, with type arguments, by a
    // bracketed call. A call chained onto it may be written in the last two ways as well.
    ["const REPLIES = 'post_comments'\nsupabase.from(REPLIES).select('*')", 'reads every column'],
    ["supabase.from('post_comments' as any).select('*')", 'reads every column'],
    ["supabase.from<any>('post_comments').select('*')", 'reads every column'],
    ["supabase['from']('post_comments').select('*')", 'reads every column'],
    ["supabase.from('post_comments')['select']<any>('*')", 'reads every column'],
    // A REST request that leaves select= out reads every column too.
    ['fetch(`${base}/rest/v1/post_comments?post_id=eq.${id}`)', 'without select='],
    ['call(`post_comments?post_id=eq.${id}&order=created_at`)', 'without select='],
    ["fetch(new URL('/rest/v1/post_comments', base))", 'without select='],
    // The column no API role is granted cannot be read by name either.
    ["supabase.from('post_comments').select('id, reply_to_comment_id')", 'names reply_to_comment_id'],
    ["supabase.from('posts').select('id, post_comments(id, reply_to_comment_id)')", 'names reply_to_comment_id'],
    ['fetch(`${base}/rest/v1/post_comments?select=id,reply_to_comment_id`)', 'names reply_to_comment_id'],
  ]) {
    const { problems } = postCommentReads(sample)
    assert.equal(problems.length, 1, sample)
    assert.ok(problems[0].includes(expected), `${sample}: ${problems[0]}`)
  }
  for (const sample of [
    "supabase.from('post_comments').select('post_id, user_id').in('post_id', busy)",
    `${fields}supabase\n  .from('post_comments')\n  .insert(row)\n  .select(\`\${FIELDS}, profile:profiles!post_comments_user_id_fkey(*)\` as any)\n  .single()`,
    "supabase.from('post_comments').select('id', { count: 'exact', head: true })",
    "supabase.from('posts').select('id, post_comments(id, content)')",
  ]) {
    assert.deepEqual(postCommentReads(sample), { problems: [], named: sample.includes('.from(\'post_comments\')') ? 1 : 0 }, sample)
  }
  assert.deepEqual(postCommentReads("supabase.from('post_comments').delete().eq('id', id)"), { problems: [], named: 0 })
  // The other ways of naming the table are reads like any other once their columns are named.
  for (const [sample, named] of [
    ["const REPLIES = 'post_comments'\nsupabase.from(REPLIES).select('id, content')", 1],
    ["supabase.from('post_comments' as any).select('id, content')", 1],
    ["supabase.from<any>('post_comments').select('id')", 1],
    ["supabase['from']('post_comments').select('id')", 1],
    // Writing the column is granted; reading it back is what is not.
    ["supabase.from('post_comments').insert({ reply_to_comment_id: answered }).select('id')", 1],
    ['fetch(`${base}/rest/v1/post_comments?post_id=eq.${id}&select=id,content`)', 0],
    // Not the table: a constant that holds another name, and a member of a type.
    ["const REPLIES = 'posts'\nsupabase.from(REPLIES).select('*')", 0],
    ['interface Topic { post_comments?: Reply[] }', 0],
  ]) assert.deepEqual(postCommentReads(sample), { problems: [], named }, sample)
  // A constant that holds the table's name in one shipped file stands for it in the others too,
  // unless a file has a constant of its own by that name.
  const imported = "import { REPLIES } from './tables'\nsupabase.from(REPLIES).select('*')"
  assert.deepEqual(postCommentReads(imported), { problems: [], named: 0 })
  assert.match(postCommentReads(imported, ['REPLIES']).problems.join(), /^line 2: \.select\('\*'\) reads every column$/)
  assert.deepEqual(postCommentReads("const REPLIES = 'posts'\nsupabase.from(REPLIES).select('*')", ['REPLIES']), { problems: [], named: 0 })

  const found = []
  let named = 0
  const sources = await shippedSources()
  const constants = sources.flatMap(({ source }) => tableConstants(source))
  for (const { file, source } of sources) {
    const read = postCommentReads(source, constants)
    named += read.named
    found.push(...read.problems.map(problem => `${file} ${problem}`))
  }
  assert.deepEqual(found, [])
  // The scan has to have seen the reads it vouches for: the topic page's list, its insert, the home's and the notices'.
  assert.ok(named >= 4, `only ${named} reads of post_comments were recognised`)
})

test('ops cover read-only precheck, exact verify and real multi-role behavior', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /anon_profiles_email_before/)
  assert.match(verify, /profile private-column ACL reopened/)
  assert.match(verify, /RLS disabled on app relation/)
  for (const marker of [
    'anon_contract',
    'account_a_contract',
    'account_b_private_columns',
    'comment_report_contract',
    'nonparticipant_contract',
    'suspended_write_denied',
    'suspension_filter_columns',
    'service_contract',
  ]) {
    assert.match(regression, new RegExp(`\\$${marker}\\$`), marker)
  }
  assert.match(regression, /ALTER ROLE service_role BYPASSRLS/)
  assert.match(regression, /ROLLBACK;\s*$/)
})

test('every selected PL/pgSQL or DO body closes with an explicit END semicolon', async () => {
  const sources = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  for (const source of sources) {
    const bodies = [...source.matchAll(/\$([a-z_]+)\$([\s\S]*?)\$\1\$;/g)]
    assert.ok(bodies.length > 0)
    for (const [, , body] of bodies) assert.match(body.trim(), /END;$/)
  }
})
