import test from 'node:test'; import assert from 'node:assert/strict';
import { createAccessStatusPoller, describeAccessEvent } from '../src/utils/accessStatusPoller.js';
test('baseline then only new events, once each', async () => {
  const responses=[{success:true,latest_id:40,events:[],doors:[]},
    {success:true,latest_id:42,events:[{id:41,status:'granted'},{id:42,status:'denied'}],doors:[]},
    {success:true,latest_id:42,events:[{id:42,status:'denied'}],doors:[]}];
  const seen=[]; const params=[];
  const p=createAccessStatusPoller({actorId:1,client:{get:async(u,o)=>{params.push(o.params.after_id);return {data:responses.shift()}}},onEvents:e=>seen.push(...e.map(x=>x.id))});
  await p.poll(); await p.poll(); await p.poll();
  assert.deepEqual(seen,[41,42]); assert.deepEqual(params,[0,40,42]);
});
test('describe', () => {
  const v=describeAccessEvent({status:'denied',denialReason:'no_schedule',method:'RFID',rfidUid:'AB12',direction:'exit',userName:'Juan Cruz',userRole:'student'});
  assert.equal(v.title,'Exit Denied'); assert.match(v.reason,/no schedule/); assert.equal(v.credential,'Card UID AB12'); assert.equal(v.role,'Student');
  assert.equal(describeAccessEvent({status:'granted',method:'Fingerprint',matchedSlot:3,matchConfidence:120}).credential,'Sensor slot 3 · confidence 120');
});
test('describe unregistered attempts', () => {
  const finger=describeAccessEvent({status:'denied',denialReason:'not_registered',method:'Fingerprint',direction:'entry',userId:null,userName:null});
  assert.equal(finger.person,'Unregistered person'); assert.equal(finger.credential,'Fingerprint not registered');
  assert.equal(finger.title,'Access Denied'); assert.match(finger.reason,/not registered/);
  const card=describeAccessEvent({status:'denied',denialReason:'not_registered',method:'RFID',rfidUid:'4300C46DDF',userId:null,userName:null});
  assert.equal(card.person,'Unregistered person'); assert.equal(card.credential,'Card UID 4300C46DDF (not registered)');
});
