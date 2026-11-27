import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulateRaceWithHistory} from '../functions/race-engine.mjs';
import {validConditions} from '../functions/race-rules.mjs';

test('scheduler preserves recorded races, recovers missed starts, and waits for long races',async()=>{
  process.env.GCLOUD_PROJECT='demo-track';
  process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-track'});
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
  const require=createRequire(import.meta.url),admin=require('../functions/node_modules/firebase-admin');
  const {raceScheduler}=require('../functions/index.js'),db=admin.firestore();
  const now=Date.now(),base={name:'Scheduler QA',condition:'fog',type:'down_back',engineVersion:2,seed:1,status:'upcoming'};
  let long=simulateRaceWithHistory(base.type,base.condition,base.seed,2);
  while(long.rolls.length<90){base.seed++;long=simulateRaceWithHistory(base.type,base.condition,base.seed,2);}
  const ongoing={...base,id:'scheduler-long',startTime:now-260000};
  const legacy={...base,id:'scheduler-legacy',type:'standard',engineVersion:1,startTime:now+60000,seed:3};
  const recorded={...base,id:'scheduler-recorded',startTime:now-30000};
  const overdue={...base,id:'scheduler-missed-start',startTime:now-60000};
  const finished={...base,id:'scheduler-finished',startTime:now-900000};
  const original={...simulateRaceWithHistory('standard','sunny',19,1),visualFinishAt:now+50000,computedAt:now};
  try{
    await db.doc('global/schedule').set({races:[ongoing,legacy,recorded,overdue,finished]});
    await db.doc('global/auctionSchedule').set({races:[]});
    await db.doc('raceRolls/'+ongoing.id).set({...long,visualFinishAt:ongoing.startTime+1300+long.rolls.length*3500,computedAt:now});
    await db.doc('raceRolls/'+recorded.id).set(original);
    await db.doc('raceRolls/'+finished.id).set({...long,visualFinishAt:now-60000,computedAt:now});
    await raceScheduler.run({});
    const schedule=(await db.doc('global/schedule').get()).data().races;
    const auctions=(await db.doc('global/auctionSchedule').get()).data().races;
    assert.notEqual(schedule.find(r=>r.id===ongoing.id).status,'finished');
    assert.equal(schedule.find(r=>r.id===finished.id).status,'finished');
    assert.deepEqual((await db.doc('raceRolls/'+recorded.id).get()).data(),original);
    const old=(await db.doc('raceRolls/'+legacy.id).get()).data();
    assert.equal(old.engineVersion,1);assert.deepEqual(old.rolls,simulateRaceWithHistory(legacy.type,legacy.condition,legacy.seed,1).rolls);
    assert.equal((await db.doc('raceRolls/'+overdue.id).get()).data().engineVersion,2);
    const generated=[...schedule.filter(r=>!r.id.startsWith('scheduler-')),...auctions];
    assert.equal(generated.length,128);assert.equal(new Set(auctions.map(r=>r.type)).size,5);
    for(const r of generated){assert.equal(r.engineVersion,2);assert.ok(validConditions(r.type).includes(r.condition));assert.equal(r.horses.length,6);assert.equal(r.seedHash.length,64);}
  }finally{await admin.app().delete();}
});
