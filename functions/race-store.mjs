import {simulateRaceWithHistory} from './race-engine.mjs';
import {privateSeed} from './race-rules.mjs';

export const money=value=>Math.round(Number(value)*100)/100;
export function cleanTicket(input) {
  const bets={};
  for(const [key,value] of Object.entries(input||{})) {
    const amount=Number(value);
    if(!Number.isInteger(Number(key))||Number(key)<0||Number(key)>5||!Number.isFinite(amount)||amount<0)throw Error('Invalid ticket');
    if(amount>0)bets[key]=money(amount);
  }
  const pot=money(Object.values(bets).reduce((a,b)=>a+b,0));
  if(!(pot>0))throw Error('Place at least one bet');
  return {bets,pot};
}
export function priceTicket(bets,totalPot,betsPerHorse,winner){
  const odds=Object.fromEntries(Object.entries(betsPerHorse||{}).filter(([,v])=>v>0).map(([id,v])=>[id,totalPot/v]));
  return {bets,totalPot,odds,winner,payout:money((Number(bets?.[winner])||0)*(odds[winner]||0))};
}
const data=s=>(typeof s.exists==='function'?s.exists():s.exists)?s.data():{};
export function createRaceStore({ref,transact},{clock=Date.now}={}) {
  async function confirmTicket(user,race,input){
    const ticket=cleanTicket(input);
    return transact(async tx=>{
      const ur=ref('users',user.uid),br=ref('bets',user.uid),pr=ref('global','racePots');
      const [us,bs,ps]=await Promise.all([tx.get(ur),tx.get(br),tx.get(pr)]);
      if(clock()>=race.startTime-(race.isAuction?0:30000))throw Error('Betting has closed');
      const u=data(us),b=data(bs),pots=data(ps),confirmed={...b.confirmed},previous=confirmed[race.id]?.pot||0;
      if(b.settled?.[race.id])throw Error('This race is already settled');
      const balance=money(u.balance-ticket.pot+previous);
      if(!Number.isFinite(balance)||balance<0)throw Error('Insufficient funds');
      const pool=pots[race.id]||{totalPot:0,betsPerHorse:{},contributors:{}};
      const old=pool.contributors?.[user.uid]||{bets:{},pot:0},totals={...pool.betsPerHorse};
      for(const [id,amount] of Object.entries(old.bets))totals[id]=money((totals[id]||0)-amount);
      for(const [id,amount] of Object.entries(ticket.bets))totals[id]=money((totals[id]||0)+amount);
      confirmed[race.id]={...ticket,raceId:race.id};
      tx.update(ur,{balance});tx.set(br,{...b,confirmed});
      tx.set(pr,{...pots,[race.id]:{totalPot:money(pool.totalPot-old.pot+ticket.pot),betsPerHorse:totals,contributors:{...pool.contributors,[user.uid]:ticket}}});
      return {balance,confirmed,...ticket};
    });
  }
  async function bankTransfer(user,type,value,operationId){
    const amount=money(value);
    if(!['deposit','withdraw'].includes(type)||!Number.isFinite(amount)||amount<=0||amount>1000000)throw Error('Enter a valid amount (max $1,000,000)');
    return transact(async tx=>{
      const ur=ref('users',user.uid),br=ref('bank',user.uid);
      const [us,bs]=await Promise.all([tx.get(ur),tx.get(br)]),u=data(us),b=data(bs),txs=b.txs||[];
      if(txs.some(t=>t.id===operationId))return {balance:u.balance,txs};
      const balance=money(u.balance+(type==='deposit'?amount:-amount));
      if(!Number.isFinite(balance)||balance<0)throw Error('Insufficient funds');
      const next=[{id:operationId,type,amount,balance,ts:clock()},...txs];
      tx.update(ur,{balance});tx.set(br,{...b,txs:next});return {balance,txs:next};
    });
  }
  async function settleTicket(user,race){
    return transact(async tx=>{
      const ur=ref('users',user.uid),br=ref('bets',user.uid),hr=ref('history',user.uid);
      const [us,bs,hs,ps,rs]=await Promise.all([tx.get(ur),tx.get(br),tx.get(hr),tx.get(ref('global','racePots')),tx.get(ref('raceRolls',race.id))]);
      const u=data(us),b=data(bs),h=data(hs),result=data(rs),pool=data(ps)[race.id];
      if(b.settled?.[race.id])return {...b.settled[race.id],balance:u.balance,confirmed:b.confirmed||{}};
      if(!Number.isInteger(result.winner)||clock()<(result.visualFinishAt||Infinity))return null;
      const ticket=b.confirmed?.[race.id]||{bets:{},pot:0};
      const outcome=priceTicket(ticket.bets,pool?.totalPot||ticket.pot,pool?.betsPerHorse||ticket.bets,result.winner);
      const existing=(h.entries||[]).filter(e=>e.raceId===race.id);
      // Older releases used history as the settlement receipt. Never credit those tickets again.
      if(existing.length){outcome.payout=money(existing.reduce((n,e)=>n+(e.payout||0),0));outcome.bets=Object.fromEntries(existing.map(e=>[e.horseId,e.amount]));outcome.odds=Object.fromEntries(existing.filter(e=>e.odds).map(e=>[e.horseId,e.odds]));}
      const balance=money(u.balance+(existing.length?0:outcome.payout)),confirmed={...b.confirmed};delete confirmed[race.id];
      const entries=existing.length?h.entries:[...(h.entries||[]),...Object.entries(ticket.bets).map(([id,amount])=>({user:user.username,raceId:race.id,horseId:Number(id),amount,odds:outcome.odds[id]||null,won:Number(id)===result.winner,payout:Number(id)===result.winner?outcome.payout:0,time:clock(),raceName:race.name,horses:race.horses||null,horseName:race.horses?.[id]||null,raceType:race.type,condition:race.condition||'sunny',seed:race.seed??null,engineVersion:race.engineVersion||1}))];
      tx.update(ur,{balance});tx.set(br,{...b,confirmed,settled:{...b.settled,[race.id]:outcome}});tx.set(hr,{...h,entries});
      // The shared pool remains available for every other bettor's independent settlement.
      return {...outcome,balance,confirmed};
    });
  }
  async function bid(user,race,horse,amount){
    amount=money(amount);
    return transact(async tx=>{
      const ar=ref('global','auctions'),ur=ref('users',user.uid);
      const [as,us]=await Promise.all([tx.get(ar),tx.get(ur)]),all=data(as).data||{},a=all[race.id]||{owners:{},bids:{},pot:0},u=data(us);
      const slot=Math.floor((clock()-(race.startTime-180000))/30000);
      if(slot<0||slot>5||(race.horseOrder?.[slot]??slot)!==horse)throw Error('Bidding for this horse has closed');
      if(Object.values(a.owners||{}).some(o=>o?.username===user.username))throw Error('You already own a horse');
      for(let i=0;i<slot;i++){const id=race.horseOrder?.[i]??i;const top=Object.entries(a.bids?.[id]||{}).sort((a,b)=>b[1]-a[1])[0];if(top?.[0]===user.username)throw Error('You already own a horse');}
      const bids=a.bids?.[horse]||{},top=Object.entries(bids).sort((a,b)=>b[1]-a[1])[0];
      if(!Number.isFinite(amount)||amount<Math.max(5,(top?.[1]||0)+1))throw Error('A higher bid is required');
      const held=a.escrow?.[horse];
      const previousRef=held&&held.uid!==user.uid?ref('users',held.uid):null;
      const previousUser=previousRef?data(await tx.get(previousRef)):null;
      const balance=money(u.balance-amount+(held?.uid===user.uid?held.amount:0));
      if(balance<0)throw Error('Insufficient funds');
      if(previousRef)tx.update(previousRef,{balance:money(previousUser.balance+held.amount)});
      tx.update(ur,{balance});
      tx.set(ar,{data:{...all,[race.id]:{...a,bids:{...a.bids,[horse]:{...bids,[user.username]:amount}},escrow:{...a.escrow,[horse]:{uid:user.uid,username:user.username,amount}}}}});
      return {balance};
    });
  }
  async function finalizeAuction(race){
    return transact(async tx=>{
      const ar=ref('global','auctions'),as=await tx.get(ar),all=data(as).data||{},a=all[race.id]||{owners:{},bids:{},pot:0};
      const owners={...a.owners};let changed=false;
      for(let slot=0;slot<6;slot++){
        if(clock()<race.startTime-180000+(slot+1)*30000)continue;
        const id=race.horseOrder?.[slot]??slot;if(owners[id]!==undefined)continue;
        const top=Object.entries(a.bids?.[id]||{}).sort((a,b)=>b[1]-a[1])[0];
        owners[id]=top?{username:top[0],amount:top[1]}:null;changed=true;
      }
      const next={...a,owners,pot:money(Object.values(owners).reduce((n,o)=>n+(o?.amount||0),0))};
      if(changed)tx.set(ar,{data:{...all,[race.id]:next}});return next;
    });
  }
  async function privateRace(user,code,action,payload={}){
    return transact(async tx=>{
      const pr=ref('global','privateRaces'),ur=ref('users',user.uid),br=ref('bets',user.uid),hr=ref('history',user.uid);
      const [ps,us,bs,hs]=await Promise.all([tx.get(pr),tx.get(ur),tx.get(br),tx.get(hr)]);
      const all=data(ps).races||{},u=data(us),b=data(bs),h=data(hs);let race=all[code],balance=u.balance;
      if(action==='create'){if(race)throw Error('Race code already exists');race={...payload,seed:privateSeed(code),engineVersion:2,members:{[user.username]:{uid:user.uid,bets:{},confirmed:false,joinedAt:clock()}}};}
      else {
        if(!race)throw Error('Race not found');race={...race,members:{...race.members}};
        if(action==='join'){if(race.started||race.finished)throw Error('This race has started');race.members[user.username]??={uid:user.uid,bets:{},confirmed:false,joinedAt:clock()};}
        if(action==='confirm'){
          if(race.started||!race.members[user.username])throw Error('Betting has closed');
          const ticket=cleanTicket(payload),me=race.members[user.username];balance=money(balance-ticket.pot+(me.debited?me.pot||0:0));
          if(balance<0)throw Error('Insufficient funds');race.members[user.username]={...me,...ticket,confirmed:true,debited:true,uid:user.uid};tx.update(ur,{balance});
        }
        if(action==='start'){if(race.hostUsername!==user.username)throw Error('Only the host can start this race');if(!race.started){race.started=true;race.startedAt=clock();}}
        if(action==='settle'){
          if(!race.started)throw Error('Race has not started');
          const result=simulateRaceWithHistory(race.raceType,race.condition||'sunny',race.seed??privateSeed(code),race.engineVersion||1);
          if(clock()<race.startedAt+30000+1300+result.rolls.length*3500)throw Error('Race is still running');
          const totalPot=Object.values(race.members).reduce((n,m)=>n+(m.pot||0),0),totals={};
          for(const m of Object.values(race.members))for(const [id,amount] of Object.entries(m.bets||{}))totals[id]=(totals[id]||0)+amount;
          const memberResults={};for(const [name,m] of Object.entries(race.members)){const o=priceTicket(m.bets||{},totalPot,totals,result.winner);memberResults[name]={...o,pot:m.pot||0,won:o.payout>0};}
          race={...race,finished:true,winner:result.winner,memberResults,finishedAt:clock()};
          const id='private_'+code,outcome=memberResults[user.username];
          if(outcome&&!b.settled?.[id]){balance=money(balance+outcome.payout);tx.update(ur,{balance});tx.set(br,{...b,settled:{...b.settled,[id]:outcome}});tx.set(hr,{...h,entries:[...(h.entries||[]),...Object.entries(outcome.bets).map(([hid,amount])=>({user:user.username,raceId:id,raceName:race.name,horses:race.horses||null,horseName:race.horses?.[hid]||null,raceType:race.raceType,condition:race.condition||'sunny',seed:race.seed??privateSeed(code),engineVersion:race.engineVersion||1,horseId:Number(hid),amount,odds:outcome.odds[hid]||null,won:Number(hid)===result.winner,payout:Number(hid)===result.winner?outcome.payout:0,time:clock()}))]});}
        }
      }
      tx.set(pr,{races:{...all,[code]:race}});return {race,balance};
    });
  }
  return {confirmTicket,bankTransfer,settleTicket,bid,finalizeAuction,privateRace};
}
