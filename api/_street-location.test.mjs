import test from 'node:test'
import assert from 'node:assert/strict'
import { streetCheckInput, streetLabel, verifiedSessionId } from './_street-location.js'
const id='11111111-1111-4111-8111-111111111111', now=Date.now()
test('only a fresh accurate device sample is eligible',()=>{
 const base={item_id:id,accuracy:40,fix_at:now}
 assert.equal(streetCheckInput(base,now).itemId,id)
 for (const extra of [{accuracy:0},{accuracy:101},{accuracy:NaN},{fix_at:now-60001},{fix_at:now+5001},{item_id:'bad'}]) assert.equal(streetCheckInput({...base,...extra},now),null)
})
test('street result excludes doors/units and rejects city-only or distant roads',()=>{
 const response={lat:'40.110',lon:'-88.230',address:{road:'Green Street',city:'Champaign',house_number:'123',building:'Private residence'}}
 assert.equal(streetLabel(response,40.110,-88.230),'Green Street, Champaign')
 for(const change of [{lat:'41.0'}, {lat:null}, {address:{city:'Champaign'}}, {address:{road:'R'.repeat(81),city:'Champaign'}}]) assert.equal(streetLabel({...response,...change},40.110,-88.230),null)
})
test('verified token session must match the authenticated user',()=>{
 const token='Bearer e30.'+Buffer.from(JSON.stringify({sub:id,session_id:id})).toString('base64url')+'.sig'
 assert.equal(verifiedSessionId(token,id),id)
 assert.equal(verifiedSessionId(token,'22222222-2222-4222-8222-222222222222'),null)
 assert.equal(verifiedSessionId('Bearer malformed',id),null)
})
