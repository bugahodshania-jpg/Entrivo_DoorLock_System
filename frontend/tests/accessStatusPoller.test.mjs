import test from 'node:test'; import assert from 'node:assert/strict';
import { createAccessStatusPoller, describeAccessEvent, isFailedAttemptAlert, FAILED_ATTEMPT_ALERT_AT } from '../src/utils/accessStatusPoller.js';
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
test('describe schedules of the day', () => {
  const schedules=[{schedule_id:2,time_start:'08:00:00',time_end:'10:00:00',kind:'regular'},{schedule_id:3,time_start:'13:30:00',time_end:'17:00:00',kind:'override'}];
  assert.deepEqual(describeAccessEvent({status:'granted',userId:4,userName:'Shan',scheduleId:2,schedules}).schedules,
    ['8:00 AM – 10:00 AM · Regular (used)','1:30 PM – 5:00 PM · Override']);
  assert.deepEqual(describeAccessEvent({status:'denied',denialReason:'expired_schedule',userId:4,userName:'Shan',schedules}).schedules,
    ['8:00 AM – 10:00 AM · Regular','1:30 PM – 5:00 PM · Override']);
  assert.deepEqual(describeAccessEvent({status:'denied',denialReason:'no_schedule',userId:4,userName:'Shan',schedules:[]}).schedules,['No approved schedule this day']);
  assert.deepEqual(describeAccessEvent({status:'denied',denialReason:'not_registered',method:'Fingerprint',userId:null}).schedules,[]);
  assert.deepEqual(describeAccessEvent({status:'granted',userId:4,userName:'Shan',scheduleId:9,schedules:[{schedule_id:9,time_start:'00:00:00',time_end:'12:00:00',kind:'regular'}]}).schedules,
    ['12:00 AM – 12:00 PM · Regular (used)']);
});
test('describe unregistered attempts', () => {
  const finger=describeAccessEvent({status:'denied',denialReason:'not_registered',method:'Fingerprint',direction:'entry',userId:null,userName:null});
  assert.equal(finger.person,'Unregistered person'); assert.equal(finger.credential,'Fingerprint not registered');
  assert.equal(finger.title,'Access Denied'); assert.match(finger.reason,/not registered/);
  const card=describeAccessEvent({status:'denied',denialReason:'not_registered',method:'RFID',rfidUid:'4300C46DDF',userId:null,userName:null});
  assert.equal(card.person,'Unregistered person'); assert.equal(card.credential,'Card UID 4300C46DDF (not registered)');
});
test('describe a student refused before the instructor enters', () => {
  const v=describeAccessEvent({status:'denied',denialReason:'unauthorized',method:'RFID',direction:'entry',userId:9,userName:'Ana',userRole:'student'});
  assert.match(v.reason,/only after a faculty member/);
  assert.equal(describeAccessEvent({status:'denied',denialReason:'unauthorized',method:'RFID',userId:3,userName:'Prof',userRole:'faculty'}).reason,
    'The user is not authorized to use this door.');
});

test('a Security Warning starts at the 3rd failed attempt in a row', () => {
  assert.equal(FAILED_ATTEMPT_ALERT_AT, 3);
  const attempt = (failedAttempts, status = 'denied') => ({ id: 1, status, denialReason: 'no_schedule', method: 'RFID', userId: 4, userName: 'Shan', failedAttempts });
  assert.equal(isFailedAttemptAlert(attempt(2)), false);
  assert.equal(isFailedAttemptAlert(attempt(3)), true);
  assert.equal(isFailedAttemptAlert(attempt(4)), true);
  assert.equal(isFailedAttemptAlert(attempt(5, 'granted')), false);
  assert.equal(isFailedAttemptAlert({ id: 1, status: 'denied' }), false, 'an older backend without the count never warns');
  const third = describeAccessEvent(attempt(3));
  assert.equal(third.tone, 'alert');
  assert.equal(third.eyebrow, 'Security Warning');
  assert.equal(third.title, '3 Failed Attempts in a Row');
  assert.match(third.warning, /failed 3 door access attempts in a row/);
  assert.equal(describeAccessEvent(attempt(4)).title, '4 Failed Attempts in a Row');
  const second = describeAccessEvent(attempt(2));
  assert.equal(second.tone, 'denied');
  assert.equal(second.eyebrow, 'Door Access Status');
  assert.equal(second.warning, '');
});
