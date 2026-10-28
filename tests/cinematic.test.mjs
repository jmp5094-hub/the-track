import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulateRaceWithHistory } from '../src/cinematic/rules.mjs';
import { progressFor, raceOrder, poolReturns, rollCaption } from '../src/cinematic/presentation.mjs';

// Frozen against the original simulator on main at 492cffec, before extraction.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/original-race-digests.json', import.meta.url)));
for (const f of fixtures) test(`Original race histories: ${f.type} / ${f.condition}`, () => {
  const hash = createHash('sha256');
  for (let seed = 0; seed < f.seeds; seed++) hash.update(JSON.stringify(simulateRaceWithHistory(f.type, f.condition, seed)));
  assert.equal(hash.digest('hex'), f.sha256);
});

test('Pool returns remain completely unavailable before close', () => {
  assert.equal(poolReturns([100, 20, 10, 0, 0, 0], false), null);
  assert.deepEqual(poolReturns([100, 20, 10, 0, 0, 0], true), [1.3, 6.5, 13, null, null, null]);
  assert.deepEqual(poolReturns([], true), Array(6).fill(null));
});

test('Running order respects return legs and tiebreak participants', () => {
  for (const type of ['down_back','magic_dice']) {
    assert.equal(progressFor(12, true, type), .5);
    assert.equal(progressFor(0, true, type), 1);
    assert.deepEqual(raceOrder([11,8,3,0,0,0], [false,true,true,false,false,false],type,'main').slice(0,3).map(h=>h.id),[2,1,0]);
  }
  assert.deepEqual(raceOrder([0,2,3,0,1,0],[], 'standard','tiebreak',[1,4]).map(h=>h.id),[1,4]);
  assert.equal(progressFor(2,false,'magic_dice','tiebreak'),2/3);
});

test('Commentary does not claim dice allocations bypass a hurdle', () => {
  assert.equal(rollCaption({diceResult:{moves:[{horse:0,steps:1}]}, names:['Copper'], rollCount:1, winner:null}), 'Copper: +1 on the dice');
  assert.equal(rollCaption({winner:0,names:['Copper']}),'Copper wins the race.');
});
