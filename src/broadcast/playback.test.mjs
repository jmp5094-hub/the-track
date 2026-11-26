import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPlayback,LAND,VOICE,TRACK_FINISH,NOSE,SPACE,FIRST_ROLL,MOVE_END} from './playback.mjs';
import {exhibitionHistory,exhibitionInterval} from './exhibition.mjs';

const voice = JSON.parse(readFileSync(new URL('./voice.json',import.meta.url),'utf8'));
const roll = (dice,positions,extra={}) => ({dice,positions,phase:'main',...extra});
const cycle = 3.5;
const first = 1.3;
const origin = [0,0,0,0,0,0];
const standard = {
  winner:2,
  rolls:[
    roll([1,2],[1,1,0,0,0,0]),
    roll([3,3],[1,1,2,0,0,0]),
    roll([3,3],[1,1,4,0,0,0]),
  ],
};

test('every ordered pair has a complete call before the next spin', () => {
  for (let first=1;first<=6;first++) for (let second=1;second<=6;second++) {
    const clip = voice[String(first)+second];
    assert.ok(clip?.text);
    assert.ok(VOICE + clip.duration + .1 < cycle, clip.text);
  }
});

test('a late join sees the same settled faces and authoritative movement', () => {
  const shot = buildPlayback(standard,3500,4,3,voice);
  assert.equal(shot.sample(first+LAND-.01).rolling,true);
  assert.deepEqual(shot.sample(first+LAND+.01).roll.dice,[1,2]);
  assert.deepEqual(shot.sample(first+LAND+.01).exact,origin);
  assert.deepEqual(shot.sample(first+cycle+2.9).exact,standard.rolls[1].positions);
  assert.equal(shot.sample(shot.winsAt-.01).done,false);
  assert.equal(shot.sample(shot.winsAt-.01).winner,null);
  assert.equal(shot.sample(shot.end).winner,2);
  assert.equal(shot.sample(shot.winsAt).world[2]+NOSE,TRACK_FINISH);
  const cues = shot.cues;
  cues.slice(1).forEach((cue,i) => assert.ok(cues[i].time+cues[i].duration < cue.time));
  const firstWorld=shot.sample(0).world;
  for(let t=0;t<=shot.end;t+=.1) assert.equal(shot.sample(t).world[5],firstWorld[5]);
  assert.ok(Math.abs(shot.sample(shot.winsAt).world[2]-firstWorld[2]-4*SPACE)<1e-7);
});

test('saved fog backsteps and tiebreak positions play without rewriting results', () => {
  const tie = {winner:1,rolls:[
    roll([1,1],[2,0,0,0,0,0]),
    roll([1,2],[1,1,0,0,0,0],{fogDieIdx:0}),
    roll([1,2],[2,2,0,0,0,0]),
    roll([1,2],[1,1,0,0,0,0],{phase:'tiebreak'}),
    roll([2,2],[1,3,0,0,0,0],{phase:'tiebreak'}),
  ]};
  const playback=buildPlayback(tie,3500,2,3,voice);
  assert.equal(playback.sample(first+cycle+1).roll.fogDieIdx,0);
  assert.equal(playback.sample(first+cycle+2.9).exact[0],1);
  const before=playback.sample(first+cycle).world[0];
  assert.equal(Math.round((before-playback.sample(first+cycle+2.9).world[0])*100),Math.round(SPACE*100));
  const restart=playback.sample(first+3*cycle+.1);
  assert.deepEqual(restart.active,[0,1]);
  assert.deepEqual(restart.exact,origin);
  assert.equal(restart.tiebreak,true);
  assert.equal(playback.sample(playback.end).winner,tie.winner);
});

test('an invalid stored history uses the existing race screen instead', () => {
  assert.equal(buildPlayback({winner:0,rolls:[roll([9,2],origin)]},3500,12,3,voice),null);
  assert.equal(buildPlayback({winner:null,rolls:standard.rolls},3500,12,3,voice),null);
});

test('exhibition advances only the horses shown by the dice and saves the decisive finish', () => {
  const positions=[...origin];
  for (const round of exhibitionHistory.rolls.slice(0,-1)) {
    round.dice.forEach(die=>positions[die-1]++);
    assert.deepEqual(round.positions,positions);
    assert.ok(positions.every(position=>position<12));
  }
  assert.equal(positions[3],11);
  assert.equal(positions[1],10);
  const playback=buildPlayback(exhibitionHistory,exhibitionInterval,12,3,voice);
  const decisive=FIRST_ROLL+(exhibitionHistory.rolls.length-1)*cycle;
  assert.equal(playback.sample(decisive).shot,'wire');
  assert.deepEqual(playback.sample(decisive).leaders,[3]);
  const finish=playback.sample(decisive+MOVE_END);
  assert.equal(finish.winner,1);
  assert.equal(finish.exact[1],12);
  assert.equal(finish.world[1]+NOSE,TRACK_FINISH);
  assert.deepEqual(finish.lastMove,[{id:1,steps:2}]);
});
