import {readFileSync} from 'node:fs';
import * as engine from '../../functions/race-engine.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPlayback,worldAt,rootingHint,raceMoment,describeRoll,shotAt,FIRST_ROLL,LAND,MOVE,MOVE_END,NOSE,TRACK_FINISH,RUN_OUT,RUN_OUT_TIME} from './playback.mjs';
const fixture=JSON.parse(readFileSync(new URL('./exhibition.json',import.meta.url),'utf8'));
const voice=JSON.parse(readFileSync(new URL('./voice.json',import.meta.url),'utf8'));
const playback=buildPlayback(fixture,3500,12,3,voice);
const roll=(dice,positions,extra={})=>({dice,positions,phase:'main',...extra});

test('announcer calls finish before the next call and fit the recorded reel',()=>{
  for(const cue of Object.values(voice)){
    assert.ok(cue.offset>=0&&cue.duration>0);
    assert.ok(cue.offset+cue.duration<=63.52,`clip beyond reel: ${cue.text}`);
  }
  for(let seed=0;seed<100;seed++){
    const history=JSON.parse(JSON.stringify(engine.simulateRaceWithHistory('standard','sunny',seed)));
    const run=buildPlayback(history,3500,12,3,voice);
    if(!run)continue;
    const cues=run.cues.toSorted((a,b)=>a.time-b.time);
    for(let i=1;i<cues.length;i++)assert.ok(cues[i-1].time+cues[i-1].duration<=cues[i].time,`${cues[i-1].key} overlaps ${cues[i].key}`);
  }
  assert.ok(playback.cues.some(c=>c.key==='stretch'));
  assert.ok(playback.cues.some(c=>c.key==='chance'));
});

test('the fixed exhibition is exactly the existing engine result',()=>{
  const original=JSON.parse(JSON.stringify(engine.simulateRaceWithHistory('standard','sunny',fixture.seed)));
  assert.deepEqual(fixture.rolls,original.rolls);assert.equal(fixture.winner,original.winner);
  assert.equal(fixture.rolls.length,24);
});
test('horses earning zero spaces stay at the same course coordinate',()=>{
  for(let i=0;i<fixture.rolls.length;i++){
    const previous=i?fixture.rolls[i-1].positions:[0,0,0,0,0,0];
    for(let horse=0;horse<6;horse++)if(previous[horse]===fixture.rolls[i].positions[horse]){
      for(const offset of [.1,.8,1.6,2,2.7,3.4])assert.equal(playback.sample(FIRST_ROLL+i*3.5+offset).world[horse],worldAt(previous[horse]));
    }
  }
});
test('every earned space has a fixed coordinate until the finish run-out',()=>{
  for(let t=0;t<playback.end;t+=.071){const f=playback.sample(t);f.world.forEach((x,id)=>assert.equal(x,worldAt(f.progress[id],f.goal)));}
});
test('doubles have a full first-space beat before the second move',()=>{
  const start=FIRST_ROLL+12*3.5;
  const before=fixture.rolls[11].positions[3];
  for(const p of [.45,.5,.55])assert.equal(playback.sample(start+MOVE+p*(MOVE_END-MOVE)).progress[3],before+1);
  assert.equal(playback.sample(start+MOVE_END+.001).progress[3],before+2);
});
test('the winner is revealed when the winning move reaches the physical wire',()=>{
  const before=playback.sample(playback.end-.02),at=playback.sample(playback.end+.001);
  assert.equal(before.winner,null);assert.equal(before.done,false);assert.ok(before.world[fixture.winner]+NOSE<TRACK_FINISH);
  assert.equal(at.winner,fixture.winner);assert.equal(at.exact[fixture.winner],12);
  assert.ok(at.world[fixture.winner]+NOSE>TRACK_FINISH);
});
test('finishers cross completely while scores and non-finishers stay fixed',()=>{
  const halfway=playback.sample(playback.end+RUN_OUT_TIME/2),after=playback.sample(playback.end+RUN_OUT_TIME+.01);
  assert.equal(halfway.moving[fixture.winner],true);
  assert.equal(after.moving[fixture.winner],false);
  assert.ok(after.world[fixture.winner]-2>TRACK_FINISH,'even the rear of the horse clears the line');
  assert.equal(after.world[fixture.winner],worldAt(12)+RUN_OUT);
  assert.deepEqual(after.exact,fixture.rolls.at(-1).positions);
  assert.deepEqual(after.progress,fixture.rolls.at(-1).positions);
  for(let id=0;id<6;id++)if(id!==fixture.winner)assert.equal(after.world[id],worldAt(after.exact[id]));
  assert.deepEqual(playback.sample(playback.end+RUN_OUT_TIME+.01),after,'replay/late join remains deterministic');
});
test('a late join or replay sample has the same revealed dice and settled positions',()=>{
  fixture.rolls.forEach((r,i)=>{
    const start=FIRST_ROLL+i*3.5;
    assert.equal(playback.sample(start+LAND-.001).roll,null);
    assert.equal(playback.sample(start+LAND-.001).winner,null);
    assert.deepEqual(playback.sample(start+LAND+.001).roll.dice,r.dice);
    assert.deepEqual(playback.sample(start+MOVE_END+.001).exact,r.positions);
    assert.deepEqual(playback.sample(start+.1).exact,i?fixture.rolls[i-1].positions:[0,0,0,0,0,0]);
  });
});
test('saved fog backsteps actually move backward and remain captioned',()=>{
  const history={winner:1,rolls:[roll([1,1],[2,0,0,0,0,0]),roll([1,2],[1,1,0,0,0,0],{fogDieIdx:0}),roll([2,2],[1,3,0,0,0,0])]};
  const p=buildPlayback(history,3500,3,3,voice),start=FIRST_ROLL+3.5;
  assert.ok(p.sample(start+2).world[0]<p.sample(start+1).world[0]);
  assert.equal(p.sample(start+2.6).exact[0],1);
  assert.match(describeRoll(history.rolls[1],history.rolls[0].positions),/Fog reverses die 1.*#1 back 1 space/);
});
test('tied finishers are introduced then reset to the three-space tiebreak',()=>{
  const history={winner:1,rolls:[roll([1,2],[1,1,0,0,0,0]),roll([1,2],[2,2,0,0,0,0]),roll([1,2],[1,1,0,0,0,0],{phase:'tiebreak'}),roll([2,2],[1,3,0,0,0,0],{phase:'tiebreak'})]};
  const p=buildPlayback(history,3500,2,3,voice),tied=p.sample(FIRST_ROLL+3.5+2.7),restart=p.sample(FIRST_ROLL+7+.1);
  assert.equal(tied.tiePending,true);assert.deepEqual(tied.leaders,[0,1]);assert.equal(tied.winner,null);
  assert.deepEqual(restart.active,[0,1]);assert.equal(restart.goal,3);assert.deepEqual(restart.exact,[0,0,0,0,0,0]);
  assert.ok(tied.world[0]+NOSE>TRACK_FINISH);assert.equal(tied.world[0],tied.world[1]);
  assert.ok(p.sample(p.end+RUN_OUT_TIME).world[1]-2>TRACK_FINISH);
});
test('the wire camera follows remaining spaces before the final playback percentage',()=>{
  const frame=playback.sample(FIRST_ROLL+16*3.5+.1);
  assert.equal(frame.shot,'wire');assert.ok(frame.time/playback.end<.75);assert.equal(frame.winner,null);
});
test('home stretch camera holds its position across rolls until a horse actually finishes',()=>{
  const reference=shotAt(playback.sample(FIRST_ROLL+16*3.5+.1),1.8);
  for(let t=FIRST_ROLL+16*3.5;t<playback.end;t+=.043){
    const frame=playback.sample(t);
    assert.equal(frame.runOut,0,'ordinary settled rolls never trigger a finish pan');
    assert.deepEqual(shotAt(frame,1.8),reference);
  }
  assert.ok(shotAt(playback.sample(playback.end+RUN_OUT_TIME),1.8).at[0]>reference.at[0]);
});
test('rooting cues use current positions and respect weather',()=>{
  const frame=playback.sample(FIRST_ROLL+20*3.5+2.7);
  assert.match(rootingHint(frame,3),/A 4 can reach the wire. #5 needs double 5s/);
  assert.match(rootingHint(frame,3,'rain'),/Rain can cancel a die/);
  assert.doesNotMatch(rootingHint(frame,3,'rain'),/can reach/);
});
test('300 archived weather races retain recorded positions and results',()=>{
  for(const condition of ['sunny','rain','fog'])for(let seed=1;seed<=100;seed++){
    const h=JSON.parse(JSON.stringify(engine.simulateRaceWithHistory('standard',condition,seed)));
    const p=buildPlayback(h,3500,12,3,voice);
    if(!p){
      // Existing fog engine can mark a finish before the second die reverses it.
      // Keep the legacy renderer for these histories; never invent a winning space.
      const final=h.rolls.at(-1),goal=final.phase==='tiebreak'?3:12;
      assert.equal(condition,'fog');assert.ok(final.positions[h.winner]<goal,`${condition} ${seed}`);
      continue;
    }
    h.rolls.forEach((r,i)=>assert.deepEqual(p.sample(FIRST_ROLL+i*3.5+2.6).exact,r.positions));
    assert.equal(p.sample(p.end+.01).winner,h.winner);
    p.cues.slice(1).forEach((cue,i)=>assert.ok(p.cues[i].time+p.cues[i].duration<=cue.time+.001,`${condition} ${seed} overlapping ${p.cues[i].key} ${cue.key}`));
  }
});
test('archived fog seed 3 shows its recorded result without inventing a winning space',()=>{
  const h=engine.simulateRaceWithHistory('standard','fog',3);
  assert.equal(h.winner,4);assert.equal(h.rolls.at(-1).positions[4],11);
  const p=buildPlayback(h,3500,12,3,voice);assert.equal(p.sample(p.end+1).historicalResult,true);assert.equal(p.sample(p.end+1).exact[4],11);
});
test('malformed histories fail closed',()=>{
  assert.equal(buildPlayback({winner:0,rolls:[roll([9,2],[12,0,0,0,0,0])]},3500,12,3),null);
  assert.equal(buildPlayback({winner:0,rolls:[]},3500,12,3),null);
});
test('dramatic doubles wait for revealed dice and lead calls wait for the move',()=>{
  const doubleStart=FIRST_ROLL+12*3.5;
  assert.equal(raceMoment(playback.sample(doubleStart+LAND-.01),3).kind,'rolling');
  assert.equal(raceMoment(playback.sample(doubleStart+LAND+.01),3).title,'Double 4');
  for(let i=0;i<fixture.rolls.length;i++){
    const before=playback.sample(FIRST_ROLL+i*3.5+MOVE-.01);
    assert.notEqual(raceMoment(before,3).kind,'lead');
  }
});
test('finish anticipation is based on current spaces and weather, not the eventual winner',()=>{
  const f=playback.sample(FIRST_ROLL+21*3.5+MOVE_END+.01);
  assert.equal(raceMoment(f,3).title,'One 4 to the wire');
  assert.notEqual(raceMoment(f,3,'rain').kind,'chance');
  assert.notEqual(raceMoment(f,3,'fog').kind,'chance');
  assert.equal(raceMoment(playback.sample(playback.end-.01),3).kind==='winner',false);
  assert.equal(raceMoment(playback.sample(playback.end+.01),3).kind,'winner');
});
