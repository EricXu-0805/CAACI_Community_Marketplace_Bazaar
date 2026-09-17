import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
const root=new URL('../',import.meta.url),dir=new URL('output/release-completion-20260916/',root)
const names=['20260917033744_street_location_checks.sql','20260917034051_public_content_english.sql','20260917034644_accept_street_public_translation_privacy.sql']
const manifest=new Map(readFileSync(new URL('supabase/migrations/manifest.sha256',root),'utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(/\s+/).reverse()))
const hash=s=>createHash('sha256').update(s).digest('hex')
const sources=names.map(name=>{const sql=readFileSync(new URL('supabase/migrations/'+name,root),'utf8');if(hash(sql)!==manifest.get(name))throw Error('Checksum mismatch '+name);return{name,sql,sha256:hash(sql)}})
const precheck=`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
DO $$ BEGIN
 IF to_regclass('translation_private.listing_jobs') IS NULL OR to_regprocedure('moderation_private.profile_content_visible(uuid)') IS NULL
 THEN RAISE EXCEPTION 'release_dependencies_missing'; END IF;
 IF to_regclass('private.street_location_checks') IS NOT NULL OR to_regclass('translation_private.public_content_jobs') IS NOT NULL
 THEN RAISE EXCEPTION 'release_already_installed_reconcile_first'; END IF;
 IF md5(pg_get_functiondef('public.record_consent(text,uuid)'::regprocedure))<>'8d89b85754eec0b0c85b47b8263944bc'
 THEN RAISE EXCEPTION 'consent_changed_reconcile_first'; END IF;
END $$;`
const install='BEGIN;\n'+precheck+'\n'+sources.map(s=>'-- '+s.name+'\n'+s.sql.replace(/^(?:BEGIN|COMMIT);\s*$/gm,'')).join('\n')+'\nCOMMIT;\n'
const rollback=readFileSync(new URL('supabase/_ops/ROLLBACK_20260917_street_public_english.sql',root),'utf8')
mkdirSync(dir,{recursive:true});writeFileSync(new URL('INSTALL.sql',dir),install);writeFileSync(new URL('ROLLBACK.sql',dir),rollback)
writeFileSync(new URL('migration-inputs.json',dir),JSON.stringify({sources:sources.map(({name,sha256})=>({name,sha256})),installSha256:hash(install),rollbackSha256:hash(rollback)},null,2)+'\n')
console.log(JSON.stringify({migrations:names.length,installSha256:hash(install),rollbackSha256:hash(rollback)}))
