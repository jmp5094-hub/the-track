import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {simulateRaceWithHistory} from '../functions/race-engine.mjs';
import {RACE_FORMATS,validConditions,raceDistance,courseRules} from '../functions/race-rules.mjs';
import {buildPlayback,FIRST_ROLL,MOVE,MOVE_END,NOSE,shotAt} from '../src/broadcast/playback.mjs';
const require=createRequire(import.meta.url),cloud=require('../functions/race-engine.mjs');
const voice=JSON.parse(readFileSync(new URL('../src/broadcast/voice.json',import.meta.url),'utf8'));
const fingerprints=JSON.parse(readFileSync(new URL('./fixtures/race-version-fingerprints.json',import.meta.url),'utf8'));
for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type)){
  for(const version of [2,3])test(`${type} / ${condition} / v${version}: 250 races finish, replay, and agree across server/browser`,()=>{
    const rules=courseRules(version),returning=['down_back','magic_dice'].includes(type);
    for(let seed=1;seed<=250;seed++){
      const h=simulateRaceWithHistory(type,condition,seed,version);
      assert.deepEqual(cloud.simulateRaceWithHistory(type,condition,seed,version),h);
      const p=buildPlayback(h,3500,12,3,voice,type,condition);assert.ok(p,`${seed}: missing renderer`);
      for(let i=0;i<h.rolls.length;i++){
        const r=h.rolls[i],f=p.sample(FIRST_ROLL+i*3.5+MOVE_END+.001),prior=i&&h.rolls[i-1].phase===r.phase?h.rolls[i-1].positions:Array(6).fill(0);
        assert.equal(r.dice.length,type==='triple_dice'?3:2);
        assert.ok(r.positions.every(n=>n>=(r.phase!=='tiebreak'&&returning?rules.homeSpace:0)&&n<=(r.phase==='tiebreak'?rules.tieSpaces:returning?rules.turnSpace:rules.spaces)),`invalid positions ${seed}/${i}`);
        assert.deepEqual(f.exact,r.positions.map((n,id)=>raceDistance(n,r.legDone[id],type,r.phase)));
        if(r.phase==='tiebreak')assert.ok(r.moves.every(m=>r.active.includes(m.horse)));
        if(r.phase!=='tiebreak'&&condition==='rain')assert.equal(r.mudDieIdx!==null,(i+1)%3===0);
        if(r.phase!=='tiebreak'&&condition==='fog')assert.equal(r.fogDieIdx!==null,(i+1)%4===0);
        for(const event of r.events)if(event.kind==='jump'){assert.equal(type,'hurdle');assert.equal(prior[event.horse],5);assert.equal(r.positions[event.horse],7);assert.equal(r.isDoubles,true);}
        const moving=p.sample(FIRST_ROLL+i*3.5+MOVE+.6);
        assert.ok(moving.world.every(Number.isFinite));assert.ok(shotAt(moving,16/9).from.every(Number.isFinite));
        const later=p.sample(FIRST_ROLL+i*3.5+3.49);
        assert.deepEqual(later.world,f.world,'no horse drifts after a die-earned move');
        for(const id of f.active)if(f.exact[id]<f.goal&&(!f.roundTrip||r.legDone[id]))assert.ok(f.roundTrip?f.world[id]-NOSE>f.finishX:f.world[id]+NOSE<f.finishX,'unfinished horses stop before the line');
      }
      const finish=p.sample(p.end+1);
      assert.equal(finish.winner,h.winner);assert.equal(finish.historicalResult,false);
      assert.equal(finish.exact[h.winner],finish.goal);
      assert.ok(finish.roundTrip?finish.world[h.winner]+2<finish.finishX:finish.world[h.winner]-2>finish.finishX,'whole winner crosses the correct finish');
      assert.deepEqual(p.sample(p.end+4).world,p.sample(p.end+.001).world,'the final space is earned, never a run-out');
      const cues=p.cues.toSorted((a,b)=>a.time-b.time);for(let i=1;i<cues.length;i++)assert.ok(cues[i-1].time+cues[i-1].duration<=cues[i].time+.001,`${type}/${condition}/${seed}: overlapping calls`);
    }
  });
  for(const version of [1,2])test(`${type} / ${condition} / v${version}: archived rules retain identical rolls and winners`,()=>{
    const hash=createHash('sha256');for(let seed=1;seed<=250;seed++)hash.update(JSON.stringify(simulateRaceWithHistory(type,condition,seed,version)));
    assert.equal(hash.digest('hex'),fingerprints[`${version}/${type}/${condition}`]);
  });
  test(`${type} / ${condition}: 250 archived histories retain official results in the new renderer`,()=>{
    for(let seed=1;seed<=250;seed++){
      const h=simulateRaceWithHistory(type,condition,seed,1),before=JSON.stringify(h);
      const p=buildPlayback(h,3500,12,3,voice,type,condition);assert.ok(p,`archived ${seed}`);assert.equal(p.sample(p.end+2).winner,h.winner);assert.equal(JSON.stringify(h),before);
    }
  });
}
test('weather and format validation rejects unsupported new-race combinations',()=>{
  for(const version of [2,3]){
    for(const weather of ['rain','fog'])assert.throws(()=>simulateRaceWithHistory('magic_dice',weather,1,version),/Unsupported/);
    assert.throws(()=>simulateRaceWithHistory('unknown','sunny',1,version),/Unsupported/);
  }
});
test('fog regression cannot declare a horse short of the wire the new winner',()=>{
  const old=simulateRaceWithHistory('standard','fog',3,1),fresh=simulateRaceWithHistory('standard','fog',3,2);
  assert.equal(old.rolls.at(-1).positions[old.winner],11);
  assert.ok(fresh.rolls.at(-1).positions[fresh.winner]>=3);
  assert.notDeepEqual(fresh.rolls,old.rolls);
});
