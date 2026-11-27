import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulateV3,RACE_FORMATS,validConditions} from '../functions/race-rules.mjs';
import {buildPlayback,FIRST_ROLL,MOVE,MOVE_END,NOSE} from '../src/broadcast/playback.mjs';

test('new courses require 13 forward spaces or 25 out-and-back spaces, including the cell beyond the wire',()=>{
  for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type)){
    const h=simulateV3(type,condition,33),p=buildPlayback(h,3500,12,3,{},type,condition);
    const returning=['down_back','magic_dice'].includes(type);
    assert.equal(p.sample(0).goal,returning?25:13);
    for(let i=0;i<h.rolls.length;i++){
      const f=p.sample(FIRST_ROLL+i*3.5+MOVE_END+.001);
      if(f.tiebreak)assert.equal(f.goal,4);
      if(f.winner!==null||f.tiePending){
        const winners=f.tiePending?f.tieActive:[f.winner];
        for(const id of winners)assert.equal(h.rolls[i].positions[id],f.tiebreak?4:returning?-1:13);
      }
    }
  }
});

test('a horse on the old last space waits for its matching die before crossing',()=>{
  const h=simulateV3('standard','sunny',33),p=buildPlayback(h,3500,12,3);
  const id=h.winner,last=h.rolls.length-1;
  const waiting=h.rolls.findIndex((r,i)=>i<last&&r.positions[id]===12&&h.rolls[i+1].positions[id]===12);
  assert.ok(waiting>=0,'fixture contains a missed roll while one space away');
  const stop=p.sample(FIRST_ROLL+waiting*3.5+MOVE_END+.001);
  assert.equal(stop.goal-stop.exact[id],1);assert.ok(stop.world[id]+NOSE<stop.finishX);
  for(const offset of [.1,1.6,2.6,3.4]){
    const missed=p.sample(FIRST_ROLL+(waiting+1)*3.5+offset);
    assert.equal(missed.world[id],stop.world[id]);assert.equal(missed.winner,null);
  }
  const moveStart=FIRST_ROLL+last*3.5+MOVE;
  assert.ok(h.rolls[last].dice.includes(id+1));
  assert.ok(p.sample(moveStart).world[id]+NOSE<stop.finishX);
  assert.ok(p.sample(p.end).world[id]-2>stop.finishX);
  assert.deepEqual(p.sample(p.end+3).world,p.sample(p.end).world);
});
