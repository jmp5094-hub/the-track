import {test} from 'node:test';
import assert from 'node:assert/strict';
import {introCues,introFrame,canStartIntroCue} from './intro-plan.mjs';
import {RACE_FORMATS,validConditions} from '../../functions/race-rules.mjs';
test('all 13 race setups get the matching weather and finish their introduction before the gate',()=>{
  let count=0;
  for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type)){
    count++;const cues=introCues(condition);
    assert.equal(cues[1].key,condition);
    for(let i=0;i<cues.length;i++){
      assert.ok(cues[i].offset+cues[i].duration<=18.32);
      assert.ok(cues[i].time+cues[i].duration<(cues[i+1]?.time??0));
    }
  }
  assert.equal(count,13);
});
test('a late arrival skips past calls, and a completed call cannot repeat after mute or rerender',()=>{
  const seen=new Set(),cue=introCues('rain')[0];
  assert.equal(canStartIntroCue(cue,-17,seen),true);
  assert.equal(canStartIntroCue(cue,-16,seen),false);
  seen.add(cue.key);assert.equal(canStartIntroCue(cue,-16.9,seen),false);
  assert.equal(introFrame(-8,'rain').cue.key,'rain');
  assert.equal(introFrame(-2,'fog').cue.key,'gate');
  assert.equal(introFrame(0,'sunny').active,false);
  assert.equal(introFrame(-20,'sunny').seconds,20);
});
