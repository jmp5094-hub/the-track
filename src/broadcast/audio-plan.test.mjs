import {test} from 'node:test';
import assert from 'node:assert/strict';
import {raceAudioPlan} from './audio-plan.mjs';
const frame={launched:true,goal:12,active:[0,1,2,3,4,5],exact:[1,2,3,4,5,6],rolling:false,done:false,into:2.6};
test('mix intensity uses current positions, not a future result or elapsed percentage',()=>{
  assert.deepEqual(raceAudioPlan(frame),raceAudioPlan({...frame,winner:4,time:900}));
  assert.ok(raceAudioPlan({...frame,exact:[11,2,3,4,5,6]}).crowd>raceAudioPlan(frame).crowd);
});
test('voice and decisive dice rolls create room in the music',()=>{
  const close={...frame,exact:[11,2,3,4,5,6]};
  assert.ok(raceAudioPlan({...close,rolling:true}).music<raceAudioPlan(close).music);
  assert.ok(raceAudioPlan({...close,cue:{key:'lead1'}}).crowd<raceAudioPlan(close).crowd);
});
test('pause, mute and audio preferences are respected',()=>{
  for(const options of [{paused:true},{enabled:false}]){
    const plan=raceAudioPlan(frame,options);assert.equal(plan.active,false);assert.equal(plan.music,0);assert.equal(plan.crowd,0);assert.equal(plan.effects,false);
  }
  assert.equal(raceAudioPlan(frame,{mix:'trackside'}).music,0);
  assert.equal(raceAudioPlan(frame,{mix:'caller'}).crowd,0);
  assert.equal(raceAudioPlan(frame,{mix:'caller'}).effects,false);
  assert.equal(raceAudioPlan(frame,{musicAllowed:false}).music,0);
  assert.equal(raceAudioPlan({...frame,launched:false}).active,false);
});
test('the music resolves after the finish while the crowd remains',()=>{
  const plan=raceAudioPlan({...frame,done:true,into:5});assert.equal(plan.music,0);assert.ok(plan.crowd>0);
});
test('waiting at a hurdle creates space for the dice without changing the underlying race mix',()=>{
  const waiting={...frame,type:'hurdle',waiting:[true,false,false,false,false,false]};
  assert.ok(raceAudioPlan({...waiting,rolling:true}).music<raceAudioPlan(waiting).music);
  assert.equal(raceAudioPlan({...waiting,rolling:true,tiebreak:true}).music,raceAudioPlan({...frame,rolling:true}).music);
  assert.equal(raceAudioPlan({...waiting,rolling:true},{mix:'caller'}).effects,false);
});
