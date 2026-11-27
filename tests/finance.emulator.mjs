import {createRequire} from 'node:module';
import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,terminate} from 'firebase/firestore';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRaceStore} from '../src/data/race-store.mjs';
import {simulateV2,simulateV3,RACE_FORMATS,validConditions,privateSeed} from '../functions/race-rules.mjs';

test('isolated Firestore: bank, competing bids, ticket edits, every private format and idempotent payouts',async t=>{
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
  const require=createRequire(import.meta.url),admin=require('../functions/node_modules/firebase-admin');
  const adminApp=admin.initializeApp({projectId:'demo-track'},'test-seed-'+Date.now()),adminDb=adminApp.firestore();
  let now=Date.now();const prefix='qa-'+now,clients=[];
  for(const name of ['alice','bob','carol']){
    const app=initializeApp({projectId:'demo-track',apiKey:'demo-track-key'},prefix+name);
    const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInAnonymously(auth);
    const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8080);connectFunctionsEmulator(getFunctions(app),'127.0.0.1',5001);
    clients.push({app,db,store:createRaceStore(db,{clock:()=>now}),user:{uid:auth.currentUser.uid,username:prefix+'-'+name}});
  }
  const [alice,bob,carol]=clients.map(c=>c.user);
  const store=Object.fromEntries(['confirmTicket','bankTransfer','settleTicket','bid','privateRace'].map(method=>[method,(user,...args)=>clients.find(c=>c.user.uid===user.uid).store[method](user,...args)]));
  store.finalizeAuction=(...args)=>clients[0].store.finalizeAuction(...args);
  const put=(c,id,value)=>adminDb.collection(c).doc(id).set(value),get=async(c,id)=>(await adminDb.collection(c).doc(id).get()).data();
  const reset=async()=>Promise.all([alice,bob,carol].map(u=>put('users',u.uid,{username:u.username,balance:1000})));
  try{
    await reset();
    await t.test('race seed documents stay private to the backend',async()=>{
      const id=prefix+'-private-seed';
      await adminDb.doc('private/raceSeeds/races/'+id).set({seed:'server-only-seed'});
      await assert.rejects(()=>getDoc(doc(clients[0].db,'private/raceSeeds/races/'+id)),e=>e.code==='permission-denied');
      await assert.rejects(()=>setDoc(doc(clients[0].db,'private/raceSeeds/races/'+id),{seed:'changed'}),e=>e.code==='permission-denied');
    });
    await t.test('bank writes ledger and balance together, retries once, and rejects overdrafts',async()=>{
      await Promise.all([store.bankTransfer(alice,'deposit',100,'deposit-1'),store.bankTransfer(alice,'deposit',100,'deposit-1')]);
      assert.equal((await get('users',alice.uid)).balance,1100);assert.equal((await get('bank',alice.uid)).txs.length,1);
      const withdrawals=await Promise.allSettled([store.bankTransfer(alice,'withdraw',700,'withdraw-1'),store.bankTransfer(alice,'withdraw',700,'withdraw-2')]);
      assert.equal(withdrawals.filter(r=>r.status==='fulfilled').length,1);assert.equal((await get('users',alice.uid)).balance,400);
      await assert.rejects(()=>store.bankTransfer(alice,'deposit',NaN,'bad'),/valid/);
      await assert.rejects(()=>store.bankTransfer(alice,'withdraw',-1,'bad'),/valid/);
    });
    await reset();
    const race={id:prefix+'-race',name:'Test Stakes',type:'standard',condition:'sunny',seed:33,engineVersion:2,startTime:now+120000};
    const history=simulateV2(race.type,race.condition,race.seed),winner=history.winner,loser=(winner+1)%6;
    await t.test('confirm/edit/retry changes a ticket and pool by exactly its delta',async()=>{
      await Promise.all([store.confirmTicket(alice,race,{[winner]:10}),store.confirmTicket(alice,race,{[winner]:10})]);
      await store.confirmTicket(bob,race,{[winner]:20});await store.confirmTicket(carol,race,{[loser]:60});
      await store.confirmTicket(alice,race,{[winner]:25});await store.confirmTicket(alice,race,{[winner]:10});
      assert.equal((await get('users',alice.uid)).balance,990);
      const pool=(await get('global','racePots'))[race.id];assert.equal(pool.totalPot,90);assert.equal(pool.betsPerHorse[winner],30);
      await assert.rejects(()=>store.confirmTicket(alice,race,{[winner]:2000}),/Insufficient/);
      await assert.rejects(()=>store.confirmTicket(alice,race,{7:10}),/Invalid/);
      now=race.startTime-25000;await store.confirmTicket(alice,race,{[winner]:10});
      now=race.startTime-20000;await assert.rejects(()=>store.confirmTicket(alice,race,{[winner]:1}),/closed/);
    });
    await t.test('recorded result settles each bettor once without clearing other tickets or pool',async()=>{
      const visualFinishAt=race.startTime+1300+history.rolls.length*3500;
      await put('raceRolls',race.id,{...history,computedAt:now,visualFinishAt});
      assert.equal(await store.settleTicket(alice,race),null);
      now=visualFinishAt+100;
      await Promise.all([store.settleTicket(alice,race),store.settleTicket(alice,race),store.settleTicket(bob,race)]);
      await store.settleTicket(carol,race);await store.settleTicket(alice,race);
      assert.equal((await get('users',alice.uid)).balance,1020);assert.equal((await get('users',bob.uid)).balance,1040);assert.equal((await get('users',carol.uid)).balance,940);
      assert.equal((await get('history',alice.uid)).entries.length,1);assert.equal((await get('global','racePots'))[race.id].totalPot,90);
      assert.equal(Object.keys((await get('bets',bob.uid)).confirmed).length,0);
    });
    await reset();
    await t.test('auction holds funds, refunds outbid players, closes lots once and rejects stale/second-horse bids',async()=>{
      now=Date.now();
      const auction={id:prefix+'-auction',name:'Test Auction',startTime:now+179000,isAuction:true,horseOrder:[2,0,1,3,4,5]};
      await put('global','auctionSchedule',{races:[auction]});
      await store.bid(alice,auction,2,10);await store.bid(bob,auction,2,15);
      assert.equal((await get('users',alice.uid)).balance,1000);assert.equal((await get('users',bob.uid)).balance,985);
      await store.bid(alice,auction,2,20);assert.equal((await get('users',bob.uid)).balance,1000);
      await assert.rejects(()=>store.bid(carol,auction,2,19),/higher/);
      await assert.rejects(()=>store.bankTransfer(alice,'withdraw',990,'auction-overdraft'),/Insufficient/);
      now+=30000;await put('global','auctionSchedule',{races:[{...auction,startTime:Date.now()+149000}]});await Promise.all([store.finalizeAuction(auction),store.finalizeAuction(auction)]);
      assert.equal((await get('global','auctions')).data[auction.id].pot,20);assert.equal((await get('users',alice.uid)).balance,980);
      await assert.rejects(()=>store.bid(alice,auction,0,5),/own/);await assert.rejects(()=>store.bid(carol,auction,2,30),/closed/);
      await store.bid(carol,auction,0,5);now=auction.startTime+1;await store.finalizeAuction(auction);
      const result=(await get('global','auctions')).data[auction.id];assert.equal(result.pot,25);assert.equal(Object.keys(result.owners).length,6);assert.equal(result.owners[1],null);
    });
    await t.test('all 13 private format/condition combinations share a start, debit bets and pay only once',async()=>{
      for(const type of Object.keys(RACE_FORMATS))for(const condition of validConditions(type)){
        await reset();const code=prefix+'-'+type+'-'+condition;
        const result=simulateV3(type,condition,privateSeed(code));
        await store.privateRace(alice,code,'create',{code,name:'Private QA',hostUsername:alice.username,raceType:type,condition,started:false,finished:false});
        await store.privateRace(bob,code,'join');await store.privateRace(alice,code,'confirm',{[result.winner]:10});await store.privateRace(bob,code,'confirm',{[result.winner]:30});
        assert.equal((await get('users',alice.uid)).balance,990);
        await assert.rejects(()=>store.privateRace(bob,code,'start'),/host/);
        const {race}=await store.privateRace(alice,code,'start');assert.equal(race.countdownSeconds,20);assert.equal(race.engineVersion,3);assert.equal(race.condition,condition);assert.equal(race.seed,privateSeed(code));
        await assert.rejects(()=>store.privateRace(bob,code,'confirm',{0:5}),/closed/);
        await assert.rejects(()=>store.privateRace(alice,code,'settle'),/running/);
        now=race.startedAt+20000+1300+result.rolls.length*3500-1;
        await assert.rejects(()=>store.privateRace(alice,code,'settle'),/running/);
        now++;
        await Promise.all([store.privateRace(alice,code,'settle'),store.privateRace(bob,code,'settle')]);await store.privateRace(alice,code,'settle');
        assert.equal((await get('users',alice.uid)).balance,1000);assert.equal((await get('users',bob.uid)).balance,1000);
        assert.equal((await get('global','privateRaces')).races[code].winner,result.winner);
      }
    });
  }finally{for(const client of clients){await terminate(client.db);await deleteApp(client.app);}await adminApp.delete();}
});
