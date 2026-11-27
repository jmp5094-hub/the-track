// Versioned race rules shared by scheduled races, private races and the browser.
// Existing races keep their recorded history/version; version 2 is for new races.
export const ENGINE_VERSION = 2;
export const RACE_FORMATS = Object.freeze({standard:'Standard',down_back:'Down & Back',hurdle:'Hurdles',magic_dice:'Magic Dice',triple_dice:'Triple Dice'});
export const validConditions = type => type === 'magic_dice' ? ['sunny'] : ['sunny','rain','fog'];
export function makeSeededDie(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * 6) + 1; };
}
export function privateSeed(code) { return Array.from(code).reduce((seed,c)=>Math.imul(seed^c.charCodeAt(0),16777619)>>>0,2166136261); }
export function raceDistance(position,returning,type,phase='main') {
  return phase !== 'tiebreak' && ['down_back','magic_dice'].includes(type) && returning ? 24-position : position;
}
export function simulateV2(type,condition='sunny',seed=0) {
  if(!RACE_FORMATS[type] || !validConditions(type).includes(condition)) throw new Error('Unsupported race format or condition');
  const die=makeSeededDie(seed),positions=Array(6).fill(0),legDone=Array(6).fill(false),rolls=[];
  const returning=['down_back','magic_dice'].includes(type);
  let phase='main',active=[0,1,2,3,4,5];
  for(let rc=0;rc<5000;rc++) {
    const dice=Array.from({length:type==='triple_dice'?3:2},die);
    let mudDieIdx=null,fogDieIdx=null,moves=[],isDoubles=dice.length===2&&dice[0]===dice[1];
    if(phase==='tiebreak') moves=dice.filter(d=>active.includes(d-1)).map(d=>({horse:d-1,steps:1}));
    else if(type==='magic_dice') {moves=[{horse:dice[0]-1,steps:dice[1]}];isDoubles=false;}
    else {
      if(condition==='rain'&&(rc+1)%3===0){mudDieIdx=dice[0]<=dice[1]?0:1;isDoubles=false;}
      if(condition==='fog'&&(rc+1)%4===0){fogDieIdx=rc%dice.length;isDoubles=false;}
      moves=isDoubles?[{horse:dice[0]-1,steps:2}]:dice.flatMap((d,i)=>i===mudDieIdx?[]:[{horse:d-1,steps:i===fogDieIdx?-1:1,...(i===fogDieIdx?{fog:true}:{})}]);
    }
    const events=[],crossingOrder=[];
    for(const {horse,steps} of moves) {
      const from=positions[horse];
      if(phase==='tiebreak') {positions[horse]=Math.min(3,from+steps);if(from<3&&positions[horse]>=3)crossingOrder.push(horse);}
      else if(returning) {
        if(!legDone[horse]) {
          const dest=Math.max(0,from+steps);
          if(dest>=12){legDone[horse]=true;positions[horse]=Math.max(0,24-dest);events.push({horse,kind:'turn'});}
          else positions[horse]=dest;
        } else positions[horse]=Math.min(12,Math.max(0,from-steps));
      } else if(type==='hurdle') {
        if(steps<0) positions[horse]=Math.max(0,from+steps);
        else if(from===5) {
          if(isDoubles){positions[horse]=7;events.push({horse,kind:'jump'});}
          else events.push({horse,kind:'blocked'});
        } else positions[horse]=from<5&&from+steps>=5?5:Math.min(12,from+steps);
      } else positions[horse]=Math.max(0,Math.min(12,from+steps));
    }
    // Evaluate once after all dice, so a fog reversal cannot produce a false winner.
    const finishers=active.filter(id=>phase==='tiebreak'?positions[id]>=3:returning?legDone[id]&&positions[id]===0:positions[id]>=12);
    rolls.push({dice,isDoubles,moves,mudDieIdx,fogDieIdx,positions:[...positions],legDone:[...legDone],phase,active:[...active],events});
    if(finishers.length===1 || (phase==='tiebreak'&&finishers.length>0)) {
      // Preserve the documented sudden-death tiebreak: first matching die wins a simultaneous finish.
      const winner=phase==='tiebreak'?crossingOrder[0]:finishers[0];
      return {winner,rolls,engineVersion:ENGINE_VERSION};
    }
    if(finishers.length>1){phase='tiebreak';active=finishers;positions.fill(0);legDone.fill(false);}
  }
  throw new Error('Race did not finish within the roll limit');
}
