import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateV3,RACE_FORMATS,validConditions,raceDistance} from '../../functions/race-rules.mjs';
import {buildPlayback,FIRST_ROLL,LAND,MOVE_END,VOICE} from './playback.mjs';
import {rollStory} from './race-events.mjs';
const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const voice={...read('./voice.json'),...read('./voice-variety.json')};
const all=[0,1,2,3,4,5];
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('all formats retain their recorded result, timed calls never overlap, and every eligible dice roll is called',()=>{
  const kinds=new Set();
  for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type))for(let seed=0;seed<40;seed++){
    const history=freeze(simulateV3(type,condition,seed)),run=buildPlayback(history,3500,13,4,voice,type,condition);
    assert.ok(run,`${type}/${condition}/${seed}`);
    let end=0;
    for(const cue of run.cues){
      assert.ok(cue.time>=end-1e-8,`${type}/${condition}/${seed}: overlap at ${cue.key}`);end=cue.time+cue.duration;kinds.add(cue.kind);
      assert.ok(cue.offset>=0&&cue.duration>0);
      assert.ok(cue.offset+cue.duration<=(cue.file==='race-calls'?125.9:63.52));
      if(cue.kind==='dice')assert.ok(run.sample(cue.time+.001).revealed,'dice call before reveal');
      if(!['open','dice','winner'].includes(cue.kind))assert.ok(run.sample(cue.time+.001).settled,'race colour before the move finishes');
    }
    const eligible=history.rolls.filter(r=>r.dice.length===2&&(type!=='magic_dice'||r.phase==='tiebreak')).length;
    assert.equal(run.cues.filter(c=>c.kind==='dice').length,eligible,`${type}/${condition}/${seed}: missing basic dice call`);
    assert.equal(run.sample(run.end+.01).winner,history.winner);
    assert.ok(run.cues.at(-1).time>=run.end);
    assert.ok(end<=run.end+run.endHold);
    assert.equal(run.winningRollAt,FIRST_ROLL+(history.rolls.length-1)*3.5);
  }
  for(const kind of ['dice','lead','jump','blocked','turn','rain','fog','miss','level','opensGap','closesGap','stretch','chance','tiebreak','winner'])assert.ok(kinds.has(kind),`No usable ${kind} call`);
});

test('repeated dice combinations alternate phrases; urgent delivery waits for current home-stretch positions',()=>{
  for(let seed=0;seed<30;seed++){
    const history=simulateV3('standard','sunny',seed),run=buildPlayback(history,3500,13,4,voice),last=new Map();
    for(const cue of run.cues.filter(c=>c.kind==='dice')){
      const frame=run.sample(cue.time+.001),pair=[...frame.roll.dice].sort().join('');
      assert.notEqual(cue.key,last.get(pair),'same phrase repeated for a dice combination');last.set(pair,cue.key);
      if(cue.key.startsWith('urgent'))assert.ok(frame.tiebreak||frame.goal-Math.max(...frame.previous)<=3,'urgent take used too early');
    }
  }
});

test('crowd reaction priorities distinguish wins, tied finishes, lead changes and missed winning chances',()=>{
  const base={roll:{dice:[2,3],positions:[12,11,2,0,0,0]},previous:[12,10,1,0,0,0],current:[12,11,2,0,0,0],active:all,goal:13,type:'standard'};
  assert.equal(rollStory(base).reaction,'ooh');
  assert.equal(rollStory({...base,previous:[7,6,1,0,0,0],current:[7,7,2,0,0,0]}).reaction,null);
  assert.equal(rollStory({...base,current:[12,13,2,0,0,0],done:true}).reaction,'finish');
  assert.equal(rollStory({...base,current:[13,13,2,0,0,0],tiePending:true}).reaction,'tie');
  assert.equal(rollStory({...base,previous:[12,11,1,0,0,0],current:[12,12,2,0,0,0]}).reaction,'ooh');
  assert.equal(rollStory({...base,previous:[10,10,1,0,0,0],current:[10,11,2,0,0,0]}).reaction,'cheer');
});

test('hurdle, turn and weather calls are supported by this roll, never by a future outcome',()=>{
  for(const [type,condition] of [['hurdle','sunny'],['hurdle','rain'],['down_back','fog'],['magic_dice','sunny']]){
    const history=simulateV3(type,condition,33),run=buildPlayback(history,3500,13,4,voice,type,condition);
    history.rolls.forEach((roll,index)=>{
      const start=FIRST_ROLL+index*3.5,hidden=run.sample(start+LAND-.01),before=run.sample(start+MOVE_END-.01),settled=run.sample(start+MOVE_END+.01);
      assert.equal(hidden.reaction,null);assert.equal(before.reaction,null);
      assert.deepEqual(settled.exact,roll.positions.map((p,id)=>raceDistance(p,roll.legDone?.[id],type,roll.phase)));
    });
    for(const cue of run.cues){const f=run.sample(cue.time+.001);
      if(cue.kind==='jump')assert.ok(f.jumping.some(Boolean));
      if(cue.kind==='blocked')assert.ok(f.roll.events.some(e=>e.kind==='blocked'));
      if(cue.kind==='turn')assert.ok(f.roll.events.some(e=>e.kind==='turn'));
      if(cue.kind==='rain')assert.notEqual(f.roll.mudDieIdx,null);
      if(cue.kind==='fog')assert.ok(f.exact.some((p,id)=>p<f.previous[id]));
      if(cue.kind==='lead')assert.ok(f.leadChange);
    }
  }
});

test('near-miss reactions have breathing room and never run on consecutive rolls',()=>{
  const h=simulateV3('hurdle','sunny',33),p=buildPlayback(h,3500,13,4,voice,'hurdle');let last=-3;
  h.rolls.forEach((_,i)=>{if(p.sample(FIRST_ROLL+i*3.5+MOVE_END+.01).reaction==='ooh'){assert.ok(i-last>=3);last=i;}});
});
