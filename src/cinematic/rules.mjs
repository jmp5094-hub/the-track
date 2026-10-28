// Existing race simulator, extracted without changing its rules.
const TRACK_SPACES = 12;
const TIEBREAK_SPACES = 3;
const HURDLE_CELL = 5;

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeSeededDie(seed) {
  const r = mulberry32(seed);
  return () => Math.floor(r() * 6) + 1;
}

export function simulateRaceWithHistory(raceType, condition, seed) {
  const die = makeSeededDie(seed);
  const SPACES = TRACK_SPACES;
  const HURDLE = HURDLE_CELL + 1;
  const pos = Array(6).fill(0);
  const leg = Array(6).fill(false);
  const skip = Array(6).fill(false);
  let phase = "main", tieHorses = null;
  const rollHistory = [];

  const rollDice = (rc) => {
    const nd = raceType==="triple_dice" ? 3 : 2;
    const dice = Array.from({length:nd}, die);
    const isDoubles = nd===2 && dice[0]===dice[1];
    let moves=[], mudDieIdx=null, fogDieIdx=null, noDoubles=false;
    if(phase==="tiebreak") {
      dice.forEach(d=>{ const hi=Math.min(d-1,5); if(tieHorses.includes(hi)) moves.push({horse:hi,steps:1}); });
    } else if(raceType==="magic_dice") {
      moves.push({horse:Math.min(dice[0]-1,5), steps:dice[1]});
    } else if(condition==="rain"&&(rc+1)%3===0) {
      const si=dice[0]<=dice[1]?0:1; mudDieIdx=si; noDoubles=true;
      dice.forEach((d,di)=>{ if(di!==si) moves.push({horse:Math.min(d-1,5),steps:1}); });
    } else if(condition==="fog"&&(rc+1)%4===0) {
      const fi=rc%nd; fogDieIdx=fi; noDoubles=true;
      dice.forEach((d,di)=>{ const h=Math.min(d-1,5); moves.push({horse:h,steps:di===fi?-1:1,fog:di===fi}); });
    } else if(isDoubles) {
      moves.push({horse:Math.min(dice[0]-1,5),steps:2});
    } else {
      dice.forEach(d=>moves.push({horse:Math.min(d-1,5),steps:1}));
    }
    return {dice,isDoubles:isDoubles&&!noDoubles,moves,mudDieIdx,fogDieIdx};
  };

  const applyMv = (moves, isDoubles) => {
    const fin=[];
    moves.forEach(({horse,steps})=>{
      if(skip[horse]){skip[horse]=false;return;}
      // In tiebreak, only tieHorses run and track is TIEBREAK_SPACES long
      if(phase==="tiebreak") {
        if(!tieHorses.includes(horse)) return;
        pos[horse]=Math.min(TIEBREAK_SPACES, pos[horse]+Math.abs(steps));
        if(pos[horse]>=TIEBREAK_SPACES) fin.push(horse);
        return;
      }
      if(raceType==="down_back"||raceType==="magic_dice") {
        if(!leg[horse]){const dest=pos[horse]+steps;if(dest>=SPACES){leg[horse]=true;pos[horse]=Math.max(0,SPACES-(dest-SPACES));if(pos[horse]<=0)fin.push(horse);}else pos[horse]=dest;}
        else{pos[horse]=Math.max(0,pos[horse]-steps);if(pos[horse]<=0)fin.push(horse);}
      } else if(raceType==="hurdle") {
        const hp=HURDLE;
        if(pos[horse]===hp-1){if(isDoubles){pos[horse]=hp+1;skip[horse]="jump";}}
        else{const dest=pos[horse]+steps;pos[horse]=dest>=hp&&pos[horse]<hp-1?hp-1:dest===hp?hp-1:Math.min(SPACES,dest);if(pos[horse]>=SPACES)fin.push(horse);}
      } else {
        if(steps<0)pos[horse]=Math.max(0,pos[horse]+steps);
        else{pos[horse]=Math.min(SPACES,pos[horse]+steps);if(pos[horse]>=SPACES)fin.push(horse);}
      }
    });
    skip.forEach((s,i)=>{if(s==="jump")skip[i]=false;});
    return fin;
  };

  let iters=0, winner=null;
  while(iters++<2000&&winner===null) {
    const rc=rollHistory.length;
    const roll=rollDice(rc);
    const fin=applyMv(roll.moves,roll.isDoubles);
    rollHistory.push({dice:roll.dice,isDoubles:roll.isDoubles,moves:roll.moves,mudDieIdx:roll.mudDieIdx,fogDieIdx:roll.fogDieIdx,positions:[...pos],legDone:[...leg],phase});
    if(fin.length===1){winner=fin[0];}
    else if(fin.length>1){
      phase="tiebreak"; tieHorses=[...fin];
      for(let i=0;i<6;i++) pos[i]=0; // reset all — only tieHorses will move in applyMv
      let tb=0;
      while(tb++<500){const tr=rollDice(rollHistory.length);const tf=applyMv(tr.moves,tr.isDoubles);
        rollHistory.push({dice:tr.dice,isDoubles:tr.isDoubles,moves:tr.moves,mudDieIdx:tr.mudDieIdx,fogDieIdx:tr.fogDieIdx,positions:[...pos],legDone:[...leg],phase:"tiebreak"});
        if(tf.length>0){winner=tf[0];break;}}
      if(winner===null)winner=fin[0];
    }
  }
  return {winner:winner??0, rolls:rollHistory};
}
