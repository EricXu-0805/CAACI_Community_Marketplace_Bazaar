import test from 'node:test'
import assert from 'node:assert/strict'
import {safeSoakTarget,timingSummary} from './staging-mixed-soak.mjs'
const env={SUPABASE_URL:'https://hygkwxugskijadgfisji.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SMOKE_EXPECTED_SUPABASE_PROJECT_REF:'hygkwxugskijadgfisji',SMOKE_EXPECTED_USER_ID:'11111111-1111-4111-8111-111111111111',SMOKE_EMAIL:'test@example.invalid',SMOKE_PASSWORD:'fixture',SMOKE_ACCOUNT_IS_SYNTHETIC:'true',SMOKE_DATASET_IS_SYNTHETIC:'true'}
test('soak rejects production, non-reviewed targets, privileged keys, missing exact user and real data',()=>{
 assert.equal(safeSoakTarget(env).ref,env.SMOKE_EXPECTED_SUPABASE_PROJECT_REF)
 for(const changes of [{SMOKE_EXPECTED_USER_ID:''},{SMOKE_DATASET_IS_SYNTHETIC:'false'},{SUPABASE_SECRET_KEY:'secret'},{SUPABASE_PUBLISHABLE_KEY:'sb_secret_opaque'},{SUPABASE_PUBLISHABLE_KEY:'e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'},...['lfhvgprfphyfvhidegum','aaaaaaaaaaaaaaaaaaaa'].map(ref=>({SUPABASE_URL:`https://${ref}.supabase.co`,SMOKE_EXPECTED_SUPABASE_PROJECT_REF:ref}))])assert.throws(()=>safeSoakTarget({...env,...changes}))
})
test('p95 includes tail latency and empty samples cannot imply zero latency',()=>{
 assert.deepEqual(timingSummary([]),{count:0,p95Ms:null,maxMs:null})
 assert.deepEqual(timingSummary([...Array(18).fill(10),2000,3000]),{count:20,p95Ms:2000,maxMs:3000})
})
