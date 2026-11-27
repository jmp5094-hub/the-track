import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bettingClosesAt,raceStartAt,privateStartAt,shortenUpcomingAuction} from '../functions/race-timing.mjs';
import {RACE_FORMATS,validConditions} from '../functions/race-rules.mjs';

test('every format and condition uses 20 seconds for regular, auction and new private starts',()=>{
  for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type)){
    const race={type,condition,startTime:100000,started:true,startedAt:100000,oddsSeconds:20,countdownSeconds:20};
    assert.equal(raceStartAt(race)-bettingClosesAt(race),20000);
    assert.equal(raceStartAt({...race,isAuction:true})-bettingClosesAt({...race,isAuction:true}),20000);
    assert.equal(privateStartAt(race)-race.startedAt,20000);
  }
});
test('unmigrated auction and private races retain their recorded start clocks',()=>{
  assert.equal(raceStartAt({startTime:100000,isAuction:true}),130000);
  assert.equal(privateStartAt({startedAt:100000,started:true}),130000);
});
test('only future auctions change; active presentations, races and archives remain intact',()=>{
  const now=100000,base={isAuction:true,status:'upcoming',seed:12,engineVersion:1};
  for(const startTime of [now-50000,now-20000,now,now+30000]){
    const race={...base,startTime};assert.equal(shortenUpcomingAuction(race,now),race);
  }
  const future={...base,startTime:now+60000};
  assert.deepEqual(shortenUpcomingAuction(future,now),{...future,oddsSeconds:20});
  const archive={...future,status:'finished'};assert.equal(shortenUpcomingAuction(archive,now),archive);
});
