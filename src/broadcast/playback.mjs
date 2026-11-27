// Presentation consumes settled engine history. It never rolls dice or changes results.
export const SILKS = ['#00f5ff','#ff2d55','#ffd700','#97bd88','#bf5fff','#ff8c00'];
export const PIPS = [[],[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];
export const SPACE = 6;
export const NOSE = 1.56;
export const TRACK_FINISH = 72;
export const LEADER_START = -NOSE;
export const COURSE_MIN = -12;
export const COURSE_MAX = 88;
export const GO = .6;
export const FIRST_ROLL = 1.3;
export const LAND = .64;
export const VOICE = .76;
export const MOVE = 1.38;
export const MOVE_END = 2.52;
// Scoring ends at the wire. Finishers then run out beyond it without earning spaces.
export const RUN_OUT = 6;
export const RUN_OUT_TIME = .8;
const SEATS = [0,1,2,3,4,5];
const GATE = [0,0,0,0,0,0];
export const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
export const mix=(a,b,p)=>a+(b-a)*p;
export const smooth=p=>p*p*(3-2*p);
export const lane=horse=>(horse-2.5)*1.56;
export function leadersOf(positions,active=SEATS){
  const best=Math.max(...active.map(id=>positions[id]));
  return active.filter(id=>positions[id]===best);
}
export function worldAt(position,goal=12){
  return TRACK_FINISH-goal*SPACE+position*SPACE-NOSE;
}
export function buildPlayback(history,rollInterval,raceSpaces,tieSpaces,voice={}){
  const rolls=history?.rolls, winner=history?.winner, cycle=rollInterval/1000;
  if(!Array.isArray(rolls)||!rolls.length||!SEATS.includes(winner)||cycle<MOVE_END)return null;
  if(!rolls.every(r=>Array.isArray(r.dice)&&r.dice.length===2&&r.dice.every(d=>Number.isInteger(d)&&d>=1&&d<=6)&&
    Array.isArray(r.positions)&&r.positions.length===6&&r.positions.every(p=>Number.isFinite(p)&&p>=0&&p<=(r.phase==='tiebreak'?tieSpaces:raceSpaces))))return null;
  const tieStart=rolls.findIndex(r=>r.phase==='tiebreak');
  if(tieStart===0)return null;
  const tieActive=tieStart>0?SEATS.filter(id=>rolls[tieStart-1].positions[id]>=raceSpaces):[];
  if(tieStart>0&&tieActive.length<2)return null;
  const finalGoal=tieStart>0?tieSpaces:raceSpaces;
  if(rolls.at(-1).positions[winner]<finalGoal)return null;
  const end=FIRST_ROLL+(rolls.length-1)*cycle+MOVE_END;
  const call=(key,time)=>voice[key]?{key,time,...voice[key]}:null;
  const cues=[call('open',GO+.04)].filter(Boolean);
  let previous=GATE,priorLeaders=SEATS;
  rolls.forEach((roll,index)=>{
    const start=FIRST_ROLL+index*cycle;
    const active=index>=tieStart&&tieStart>0?tieActive:SEATS;
    const primary=call(roll.dice.join(''),start+VOICE);
    if(primary)cues.push(primary);
    const leaders=leadersOf(roll.positions,active);
    if(index===tieStart-1){
      const cue=call('tiebreak',start+MOVE_END);
      if(cue&&cue.time+cue.duration<start+cycle+VOICE-.06)cues.push(cue);
    }else if(leaders.length===1&&(priorLeaders.length>1||!priorLeaders.includes(leaders[0]))&&index>0&&index<rolls.length-1&&index!==tieStart&&roll.positions[leaders[0]]>previous[leaders[0]]){
      const cue=call('lead'+(leaders[0]+1),start+Math.max(MOVE_END,VOICE+(primary?.duration||0)+.08));
      if(cue&&cue.time+cue.duration<start+cycle+VOICE-.08)cues.push(cue);
    }
    previous=roll.positions;priorLeaders=leaders;
  });
  const lastCall=voice[rolls.at(-1).dice.join('')];
  const winAt=Math.max(end+.15,FIRST_ROLL+(rolls.length-1)*cycle+VOICE+(lastCall?.duration||0)+.08);
  const win=call('win'+(winner+1),winAt);if(win)cues.push(win);
  function sample(seconds){
    const time=Math.max(0,seconds),done=time>=end;
    const index=time<FIRST_ROLL?-1:Math.min(rolls.length-1,Math.floor((time-FIRST_ROLL)/cycle));
    const source=rolls[index];
    const tiebreak=tieStart>0&&index>=tieStart;
    const active=tiebreak?tieActive:SEATS;
    const goal=tiebreak?tieSpaces:raceSpaces;
    const previous=index<=0||index===tieStart?GATE:rolls[index-1].positions;
    const into=time-FIRST_ROLL-index*cycle;
    const amount=source?clamp((into-MOVE)/(MOVE_END-MOVE)):0;
    const settled=Boolean(source&&into>=MOVE_END-1e-8);
    const exact=settled?source.positions:previous;
    const progress=previous.map((from,id)=>{
      const to=source?.positions[id]??from;
      if(to-from!==2)return mix(from,to,smooth(amount));
      return from+smooth(clamp(amount/.43))+smooth(clamp((amount-.56)/.44));
    });
    const runOut=source&&settled?smooth(clamp((into-MOVE_END)/RUN_OUT_TIME)):0;
    const finishers=source?active.filter(id=>source.positions[id]>=goal):[];
    const world=progress.map((p,id)=>worldAt(p,goal)+(finishers.includes(id)?RUN_OUT*runOut:0));
    const leaders=leadersOf(exact,active);
    const moving=progress.map((p,id)=>Boolean(source&&into>=MOVE&&into<MOVE_END&&source.positions[id]!==previous[id])||Boolean(finishers.includes(id)&&settled&&runOut<1));
    const surge=moving.map((yes,id)=>yes?Math.sin(Math.PI*amount)*Math.min(1,Math.abs((source?.positions[id]??0)-previous[id])):0);
    const revealed=Boolean(source&&into>=LAND);
    const nextLeaders=source?leadersOf(source.positions,active):leaders;
    const prior=leadersOf(previous,active);
    const leadChange=revealed&&nextLeaders.length===1&&(prior.length>1||!prior.includes(nextLeaders[0]));
    const atWire=goal-Math.max(...active.map(id=>previous[id]))<=3||goal-Math.max(...active.map(id=>exact[id]))<=3;
    const shot=index<0?'gate':atWire?'wire':leadChange?'contest':'pack';
    const tiePending=Boolean(tieStart>0&&index===tieStart-1&&settled);
    const lastIndex=settled?index:index-1;
    const lastRoll=lastIndex>=0?rolls[lastIndex]:null;
    const cue=cues.findLast(c=>c.time<=time&&time<c.time+c.duration);
    return {time,sceneTime:time,index,into,rolling:Boolean(source&&into<LAND),revealed,
      roll:revealed?source:null,lastRoll,lastIndex,previous,exact,progress,world,surge,moving,
      active,leaders,goal,tiebreak,tiePending,tieActive,shot,leadChange,settled,runOut,
      done,winner:done?winner:null,leaderX:Math.max(...active.map(id=>world[id])),
      launched:time>=GO,cue};
  }
  return {sample,cues,end,endHold:Math.max(3.4,winAt-end+(win?.duration||0)+.6),cycle};
}
export function describeRoll(roll,previous){
  if(!roll)return 'Every matching die moves its numbered horse one space.';
  const prefix=roll.dice.join(' and ')+'.';
  const changes=roll.positions.map((p,i)=>({id:i,delta:p-(previous?.[i]??0)})).filter(x=>x.delta!==0);
  const movement=changes.map(({id,delta})=>`#${id+1} ${delta<0?'back':'advances'} ${Math.abs(delta)}${Math.abs(delta)===1?' space':' spaces'}`).join(' · ');
  const effect=roll.mudDieIdx!=null?`Rain cancels die ${roll.mudDieIdx+1} (${roll.dice[roll.mudDieIdx]}). `:
    roll.fogDieIdx!=null?`Fog reverses die ${roll.fogDieIdx+1} (${roll.dice[roll.fogDieIdx]}). `:'';
  return `${prefix} ${effect}${movement||'No net change in position.'}`;
}
export function rootingHint(frame,follow,condition='sunny'){
  if(!frame)return 'Choose a horse to follow.';
  if(frame.done)return frame.winner===follow?'Your horse crossed first.':`#${frame.winner+1} crossed first. You followed #${follow+1}.`;
  if(frame.tiePending)return `Tied at the wire: ${frame.tieActive.map(i=>'#'+(i+1)).join(' + ')}. Three-space tiebreak next.`;
  if(!frame.active.includes(follow))return 'Your horse is out of the tiebreak. Follow one of the remaining runners.';
  const left=frame.goal-frame.exact[follow];
  if(condition!=='sunny'&&!frame.tiebreak)return `Root for ${follow+1}. ${condition==='rain'?'Rain can cancel a die.':'Fog can reverse a die.'}`;
  if(left<=1){
    const rivals=frame.active.filter(i=>i!==follow&&frame.goal-frame.exact[i]<=2);
    const threat=rivals.find(i=>frame.goal-frame.exact[i]===2);
    return `A ${follow+1} can reach the wire.${threat!=null?` #${threat+1} needs double ${threat+1}s.`:rivals.length?` ${rivals.map(i=>'#'+(i+1)).join(' + ')} can also finish.`:''}`;
  }
  return left===2?`Double ${follow+1}s can reach the wire.`:`Root for ${follow+1}. Each matching die moves your horse one space.`;
}
// Story beats read only revealed dice and current positions, never a future result.
export function raceMoment(frame,follow,condition='sunny'){
  if(!frame)return {kind:'ready',title:'Pick your runner',detail:'Every matching die moves one space.'};
  if(frame.done)return {kind:'winner',horse:frame.winner,title:`#${frame.winner+1} takes it`,detail:'Across the wire'};
  if(frame.tiePending)return {kind:'tie',title:'Tied at the wire',detail:'Three-space tiebreak next'};
  if(frame.rolling)return {kind:'rolling',horse:follow,title:`Come on, ${follow+1}`,detail:'The dice are in the air'};
  if(frame.revealed&&frame.roll){
    const double=frame.roll.positions.findIndex((p,id)=>p-frame.previous[id]===2&&frame.roll.dice.every(d=>d===id+1));
    if(double>=0)return {kind:'double',horse:double,title:`Double ${double+1}`,detail:'Two dice. Two spaces.'};
    if(frame.settled&&frame.leadChange)return {kind:'lead',horse:frame.leaders[0],title:`#${frame.leaders[0]+1} takes the lead`,detail:'The race changes here'};
  }
  const left=frame.goal-frame.exact[follow];
  if(frame.active.includes(follow)&&(condition==='sunny'||frame.tiebreak)&&left===1)return {kind:'chance',horse:follow,title:`One ${follow+1} to the wire`,detail:'Watch for your number'};
  if(frame.active.includes(follow)&&(condition==='sunny'||frame.tiebreak)&&left===2)return {kind:'chance',horse:follow,title:`Double ${follow+1}s can finish`,detail:'Two spaces to go'};
  return {kind:'quiet',horse:follow,title:`Root for ${follow+1}`,detail:frame.index<0?'Choose your runner below':'Every roll can change the lead'};
}
export function shotAt(frame,aspect,reduced=false){
  const narrow=aspect<1.5;
  if(frame.shot==='wire'&&!frame.steady){
    const center=TRACK_FINISH-8+4*(frame.runOut||0);
    return {from:[center,10,narrow?22:18],at:[center,.5,0],fov:narrow?51:44};
  }
  const xs=frame.active.map(id=>frame.world[id]);
  const lo=Math.min(...xs),hi=Math.max(...xs),span=Math.max(15,hi-lo+9);
  const center=(lo+hi)/2+2.5;
  const distance=Math.max(17,span/(2*Math.tan(24*Math.PI/180)*aspect));
  return {from:[center-1,Math.max(11,distance*.62),distance],at:[center,0,0],fov:48};
}
