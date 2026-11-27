process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
const admin=require('../functions/node_modules/firebase-admin');
const {simulateV2,RACE_FORMATS,validConditions}=require('../functions/race-rules.mjs');
admin.initializeApp({projectId:'demo-track'});const db=admin.firestore();
(async()=>{
  try{await admin.auth().createUser({uid:'browser-qa',email:'qa@track.test',password:'qa-test-only-2026'});}catch(e){if(e.code!=='auth/uid-already-exists'&&e.code!=='auth/email-already-exists')throw e;}
  const now=Date.now(),names=['Railbird','Night Watch','High Note','Bay Runner','Last Call','Homeward'];
  const races=Object.keys(RACE_FORMATS).flatMap(type=>validConditions(type).map((condition,i)=>({id:'browser-'+type+'-'+condition,name:RACE_FORMATS[type]+' '+condition+' Stakes',type,condition,engineVersion:2,seed:33,startTime:now+600000+i*60000,status:'upcoming',horses:names,coats:[]})));
  const live={...races.find(r=>r.type==='down_back'&&r.condition==='rain'),id:'browser-live',name:'Return in the Rain',startTime:now-18000,status:'racing'};races.unshift(live);
  const countdown={...races.find(r=>r.type==='hurdle'),id:'browser-countdown',name:'Hurdle Countdown',startTime:now+25000};races.unshift(countdown);
  const finished={...races.find(r=>r.type==='triple_dice'),id:'browser-finished',name:'Triple Dice Result',startTime:now-300000,status:'finished'};races.push(finished);
  const auction={...races.find(r=>r.type==='magic_dice'),id:'browser-auction',name:'Magic Dice Auction',startTime:now+165000,isAuction:true,horseOrder:[0,1,2,3,4,5]};
  await Promise.all([
    db.doc('users/browser-qa').set({username:'qa_runner',balance:1000,avatar:'🏇'}),
    db.doc('global/schedule').set({races,generatedAt:now}),db.doc('global/auctionSchedule').set({races:[auction],generatedAt:now}),
    db.doc('bets/browser-qa').set({confirmed:{},pending:{}}),db.doc('history/browser-qa').set({entries:[]}),
    db.doc('bank/browser-qa').set({txs:[]}),db.doc('friends/browser-qa').set({following:[],followers:[]}),
    db.doc('global/privateRaces').set({races:{}}),db.doc('global/auctions').set({data:{}}),db.doc('global/racePots').set({}),
    ...[...races,auction].map(r=>{const h=simulateV2(r.type,r.condition,r.seed);return db.doc('raceRolls/'+r.id).set({...h,computedAt:now,visualFinishAt:r.startTime+(r.isAuction?30000:0)+1300+h.rolls.length*3500});})
  ]);
  console.log('Seeded demo-track emulator only. Browser login: qa@track.test / qa-test-only-2026');
  await admin.app().delete();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
