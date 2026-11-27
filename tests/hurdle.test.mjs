import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulateRaceWithHistory} from '../functions/race-engine.mjs';
import {buildPlayback,earnedHurdleJump,worldAt,raceMoment,rootingHint,FIRST_ROLL,LAND,MOVE,MOVE_END} from '../src/broadcast/playback.mjs';

test('hurdles: arriving doubles stop at five; only a later matching pair from five jumps',()=>{
  let arrivals=0,jumps=0,weatherPairs=0;
  for(const version of [2,3])for(const condition of ['sunny','rain','fog'])for(let seed=1;seed<=300;seed++){
    const history=simulateRaceWithHistory('hurdle',condition,seed,version);
    for(let i=0;i<history.rolls.length;i++){
      const r=history.rolls[i];if(r.phase==='tiebreak')continue;
      const previous=i?history.rolls[i-1].positions:Array(6).fill(0);
      if(r.dice[0]===r.dice[1]){
        const id=r.dice[0]-1,from=previous[id];
        if(r.isDoubles&&(from===3||from===4)){
          arrivals++;assert.equal(r.positions[id],5);assert.equal(earnedHurdleJump(r,previous,id),false);
        }
        if(from===5&&r.isDoubles){jumps++;assert.equal(r.positions[id],7);assert.equal(earnedHurdleJump(r,previous,id),true);}
        if(from===5&&!r.isDoubles){weatherPairs++;assert.ok(r.positions[id]<=5);assert.equal(earnedHurdleJump(r,previous,id),false);}
      }
      for(const event of r.events.filter(e=>e.kind==='jump')){
        assert.equal(previous[event.horse],5);assert.equal(r.positions[event.horse],7);
        assert.deepEqual(r.dice,[event.horse+1,event.horse+1]);assert.equal(r.mudDieIdx,null);assert.equal(r.fogDieIdx,null);
      }
    }
  }
  assert.ok(arrivals>0&&jumps>0&&weatherPairs>0);
});

test('jump presentation rejects a jump from the wrong space, singles, another horse, weather or tiebreak',()=>{
  const previous=[5,0,0,0,0,0],roll={dice:[1,1],isDoubles:true,positions:[7,0,0,0,0,0],phase:'main'};
  assert.equal(earnedHurdleJump(roll,previous,0),true);
  for(const from of [0,1,2,3,4,6,7])assert.equal(earnedHurdleJump(roll,[from,0,0,0,0,0],0),false);
  for(const change of [{dice:[1,2]},{dice:[2,2]},{isDoubles:false},{mudDieIdx:0},{fogDieIdx:1},{phase:'tiebreak'}])assert.equal(earnedHurdleJump({...roll,...change},previous,0),false);
  assert.equal(earnedHurdleJump(roll,previous,0,'standard'),false);
});

test('an earned jump is a continuous arc centered over the hurdle for both track lengths',()=>{
  for(const version of [2,3]){
    const history=simulateRaceWithHistory('hurdle','sunny',33,version),snapshot=JSON.stringify(history);
    const index=history.rolls.findIndex(r=>r.events.some(e=>e.kind==='jump'));
    const id=history.rolls[index].events.find(e=>e.kind==='jump').horse;
    const playback=buildPlayback(history,3500,12,3,{},'hurdle'),start=FIRST_ROLL+index*3.5;
    const before=playback.sample(start+LAND-.001),takeoff=playback.sample(start+MOVE),peak=playback.sample(start+MOVE+(MOVE_END-MOVE)/2),landing=playback.sample(start+MOVE_END+.001);
    assert.equal(before.jumping[id],false);assert.equal(before.matched[id],false);assert.equal(before.jumps[id],0);
    assert.equal(takeoff.exact[id],5);assert.ok(Math.abs(takeoff.jumps[id])<1e-8);
    assert.ok(Math.abs(peak.world[id]-peak.hurdleX)<1e-8);assert.ok(peak.jumps[id]>.9);
    const left=playback.sample(start+MOVE+(MOVE_END-MOVE)*.45),right=playback.sample(start+MOVE+(MOVE_END-MOVE)*.55);
    assert.ok(right.world[id]>left.world[id],'no midair two-step pause');
    assert.equal(landing.exact[id],7);assert.equal(landing.world[id],worldAt(7,version===3?13:12));assert.equal(landing.jumps[id],0);
    assert.deepEqual(playback.sample(start+3.49).world,landing.world);assert.equal(JSON.stringify(history),snapshot);
  }
});

test('weather does not hide the waiting cue, and a jump is not called cleared before landing',()=>{
  const history=simulateRaceWithHistory('hurdle','sunny',33,3),playback=buildPlayback(history,3500,12,3,{},'hurdle');
  const index=history.rolls.findIndex(r=>r.events.some(e=>e.kind==='jump')),id=history.rolls[index].events.find(e=>e.kind==='jump').horse,start=FIRST_ROLL+index*3.5;
  const waiting=playback.sample(start+.1),revealed=playback.sample(start+LAND+.1),landed=playback.sample(start+MOVE_END+.001);
  for(const weather of ['sunny','rain','fog'])assert.match(rootingHint(waiting,id,weather),new RegExp('double '+(id+1)+'s'));
  assert.match(raceMoment(waiting,id).title,/to jump/);
  assert.equal(waiting.waiting[id],true);assert.equal(revealed.waiting[id],false);
  assert.match(rootingHint(revealed,id),/earned the jump/);
  assert.doesNotMatch(raceMoment(revealed,id).title,/clears/);
  assert.match(raceMoment(landed,id).title,/clears/);
});
