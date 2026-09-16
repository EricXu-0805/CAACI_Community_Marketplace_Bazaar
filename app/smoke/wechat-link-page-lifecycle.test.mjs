import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

let seq=0
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve()}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function platformSource(input,platform){
  const lines=input.split('\n'),enabled=[true],out=[]
  for(const line of lines){
    const directive=line.match(/\/\/ #(ifdef|ifndef) (H5|MP-WEIXIN)/)
    if(directive){enabled.push(enabled.at(-1)&&(directive[1]==='ifdef'?(directive[2]===platform):(directive[2]!==platform)));continue}
    if(line.includes('// #endif')){enabled.pop();continue}
    if(enabled.at(-1))out.push(line)
  }
  return out.join('\n')
}
async function fixture(t,platform='H5'){
  const state={account:'account-a',calls:[],hooks:{},timers:[],unmount:[],authCalls:[]}
  const loggedIn={get value(){return !!state.account}}
  const bindings={
    ref:value=>({value}),computed:fn=>({get value(){return fn()}}),onUnmounted:fn=>state.unmount.push(fn),
    onShow:fn=>state.hooks.show=fn,onHide:fn=>state.hooks.hide=fn,
    useI18n:()=>({t:key=>key}),useAuth:()=>({isLoggedIn:loggedIn,requireAuth:()=>{},signOut:async()=>true,
      signInWithWeChat:async options=>{state.authCalls.push(options);return {error:new Error('test-offline')}}}),
    useSupabase:()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:state.account},access_token:'access-token'}}})}}}),
    onAccountTransition:fn=>{state.transition=fn;return()=>{}},getActiveAccountId:()=>state.account,
    mpChromeVars:()=>({}),mpThemeClass:()=>'',navigateBackOr:()=>{},
    freshWechatCode:async()=>{if(state.wxWait)return state.wxWait.promise;return 'fresh-code'},
    wechatCapabilities:async()=>({login:true,account_link:true}),
    wechatErrorKey:error=>`wechat.${error.message}`,
    wechatAccountRequest:async(action,fields,token)=>{
      state.calls.push({action,fields,token})
      if(action==='link_status')return {linked:false}
      if(action==='link_issue')return state.issueWait?state.issueWait.promise:{link_code:'ABCDEFGHJK',expires_at:new Date(Date.now()+300000).toISOString()}
      if(action==='link_preview')return {nickname:'My account',email_label:'m***@example.test',confirmation:'a'.repeat(64),expires_at:new Date(Date.now()+300000).toISOString()}
      throw new Error('unexpected_action')
    },
    setInterval:fn=>{state.timers.push(fn);return state.timers.length},clearInterval:()=>{},
  }
  const key=`__wechatPageFixture${++seq}`
  globalThis[key]=bindings;t.after(()=>{state.unmount.forEach(fn=>fn());delete globalThis[key]})
  let input=readFileSync(new URL('../src/pages/account-link/index.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  input=platformSource(input,platform).replace(/^import .*$/gm,'')
  input=`const {${Object.keys(bindings).join(',')}}=globalThis.${key};\n`+input+'\nexport {issuedCode,enteredCode,preview,seconds,busy,errorKey,generateCode,previewAccount,confirmAccount,clearPrivateState};'
  const output=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
  state.page=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
  state.hooks.show();await flush();return state
}

test('late website code response cannot render after an account switch or page hide',async t=>{
  for(const boundary of ['switch','hide']){
    const state=await fixture(t),page=state.page;state.issueWait=deferred()
    const request=page.generateCode();await flush()
    assert.equal(state.calls.filter(c=>c.action==='link_issue').length,1)
    if(boundary==='switch'){state.account='account-b';state.transition()}else state.hooks.hide()
    state.issueWait.resolve({link_code:'ABCDEFGHJK',expires_at:new Date(Date.now()+300000).toISOString()})
    await request;assert.equal(page.issuedCode.value,'');assert.equal(page.busy.value,false)
  }
})
test('double-click creates one ticket; expiry clears the displayed secret using wall-clock time',async t=>{
  const state=await fixture(t),page=state.page;state.issueWait=deferred()
  const first=page.generateCode();await flush();await page.generateCode()
  assert.equal(state.calls.filter(c=>c.action==='link_issue').length,1)
  state.issueWait.resolve({link_code:'ABCDEFGHJK',expires_at:new Date(Date.now()+100).toISOString()});await first
  assert.equal(page.issuedCode.value,'ABCDEFGHJK')
  t.mock.method(Date,'now',()=>new Date('2099-01-01').getTime());state.timers.at(-1)()
  assert.equal(page.issuedCode.value,'');assert.equal(page.errorKey.value,'wechat.link_expired')
})
test('leaving the mini-program page during wx.login prevents the preview request',async t=>{
  const state=await fixture(t,'MP-WEIXIN'),page=state.page
  state.account=null;state.transition();page.enteredCode.value='ABCDE FGHJK';state.wxWait=deferred()
  const pending=page.previewAccount();state.hooks.hide();state.wxWait.resolve('late-code');await pending
  assert.equal(state.calls.some(c=>c.action==='link_preview'),false);assert.equal(page.preview.value,null)
})
test('typing a code only previews; explicit confirmation carries the proof and failure clears it',async t=>{
  const state=await fixture(t,'MP-WEIXIN'),page=state.page
  state.account=null;state.transition();page.enteredCode.value='ABCDE FGHJK'
  await page.previewAccount();assert.equal(page.preview.value.nickname,'My account');assert.equal(state.authCalls.length,0)
  await page.confirmAccount();assert.equal(state.authCalls.length,1)
  assert.equal(state.authCalls[0].linkCode,'ABCDEFGHJK');assert.equal(state.authCalls[0].confirmation,'a'.repeat(64))
  assert.equal(page.preview.value,null)
  state.hooks.hide();assert.equal(state.authCalls[0].isCurrent(),false)
})
