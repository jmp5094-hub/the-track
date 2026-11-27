import {makeSeededDie,simulateV2,simulateV3} from './race-rules.mjs';
const TRACK_SPACES=12,TIEBREAK_SPACES=3,HURDLE_CELL=5;
// Frozen version 1 for already scheduled races and historical verification.
function simulateLegacy(raceType, condition, seed) {
  const die = makeSeededDie(seed);
  const SPACES = TRACK_SPACES;
  const HURDLE = HURDLE_CELL + 1; // hurdle position (1-indexed in grid)

  const pos  = Array(6).fill(0);
  const leg  = Array(6).fill(false);
  const skip = Array(6).fill(false);
  let phase = "main";
  let tieHorses = null;
  const rollHistory = [];

  const rollDice = (rc) => {
    const nd = raceType === "triple_dice" ? 3 : 2;
    const dice = Array.from({length:nd}, die);
    const isDoubles = nd === 2 && dice[0] === dice[1];
    let moves = [];
    let mudDieIdx = null;
    let fogDieIdx = null;
    let noDoubles = false;

    if(phase === "tiebreak") {
      dice.forEach(d => {
        const hi = Math.min(d-1,5);
        if(tieHorses.includes(hi)) moves.push({horse:hi, steps:1});
      });
    } else if(raceType === "magic_dice") {
      moves.push({horse: Math.min(dice[0]-1,5), steps: dice[1]});
    } else if(condition === "rain" && (rc+1)%3===0) {
      const si = dice[0] <= dice[1] ? 0 : 1;
      mudDieIdx = si;
      noDoubles = true;
      dice.forEach((d,di) => {
        if(di !== si) moves.push({horse:Math.min(d-1,5), steps:1});
      });
    } else if(condition === "fog" && (rc+1)%4===0) {
      const fi = rc % nd; // deterministic fog die based on roll count
      fogDieIdx = fi;
      noDoubles = true;
      dice.forEach((d,di) => {
        const horse = Math.min(d-1,5);
        moves.push({horse, steps: di===fi ? -1 : 1, fog: di===fi});
      });
    } else if(isDoubles) {
      moves.push({horse: Math.min(dice[0]-1,5), steps: 2});
    } else {
      dice.forEach(d => moves.push({horse:Math.min(d-1,5), steps:1}));
    }
    return {dice, isDoubles: isDoubles && !noDoubles, moves, mudDieIdx, fogDieIdx};
  };

  const applyMoves = (moves, isDoubles) => {
    const finishers = [];
    moves.forEach(({horse, steps}) => {
      if(skip[horse]) { skip[horse] = false; return; }
      if(raceType === "down_back" || raceType === "magic_dice") {
        if(!leg[horse]) {
          const dest = pos[horse] + steps;
          if(dest >= SPACES) { leg[horse]=true; pos[horse]=Math.max(0,SPACES-(dest-SPACES)); if(pos[horse]<=0) finishers.push(horse); }
          else pos[horse] = dest;
        } else { pos[horse]=Math.max(0,pos[horse]-steps); if(pos[horse]<=0) finishers.push(horse); }
      } else if(raceType === "hurdle") {
        const hp = HURDLE;
        if(pos[horse] === hp-1) { if(isDoubles){ pos[horse]=hp+1; skip[horse]="jump"; } }
        else {
          const dest = pos[horse]+steps;
          pos[horse] = dest>=hp && pos[horse]<hp-1 ? hp-1 : dest===hp ? hp-1 : Math.min(SPACES,dest);
          if(pos[horse] >= SPACES) finishers.push(horse);
        }
      } else {
        const limit = phase === "tiebreak" ? TIEBREAK_SPACES : SPACES;
        if(steps < 0) pos[horse] = Math.max(0, pos[horse]+steps);
        else { pos[horse] = Math.min(limit, pos[horse]+steps); if(pos[horse]>=limit) finishers.push(horse); }
      }
    });
    skip.forEach((s,i) => { if(s==="jump") skip[i]=false; });
    return finishers;
  };

  let iters = 0;
  let winner = null;

  while(iters++ < 2000 && winner === null) {
    const rc = rollHistory.length;
    const roll = rollDice(rc);
    const finishers = applyMoves(roll.moves, roll.isDoubles);

    rollHistory.push({
      dice:      roll.dice,
      isDoubles: roll.isDoubles,
      moves:     roll.moves,
      mudDieIdx: roll.mudDieIdx,
      fogDieIdx: roll.fogDieIdx,
      positions: [...pos],
      legDone:   [...leg],
      phase,
    });

    if(finishers.length === 1) {
      winner = finishers[0];
    } else if(finishers.length > 1) {
      // Tie — tiebreak
      phase = "tiebreak";
      tieHorses = [...finishers];
      for(let i=0;i<6;i++) pos[i]=0;
      let tbIters = 0;
      while(tbIters++ < 500) {
        const tr = rollDice(rollHistory.length);
        const tf = applyMoves(tr.moves, tr.isDoubles);
        rollHistory.push({
          dice: tr.dice, isDoubles: tr.isDoubles, moves: tr.moves,
          mudDieIdx: tr.mudDieIdx, fogDieIdx: tr.fogDieIdx,
          positions: [...pos], legDone: [...leg], phase:"tiebreak",
        });
        if(tf.length > 0) { winner = tf[0]; break; }
      }
      if(winner === null) winner = finishers[0];
    }
  }

  return { winner: winner ?? 0, rolls: rollHistory };
}
export function simulateRaceWithHistory(type,condition,seed,version=1){return version>=3?simulateV3(type,condition,seed):version>=2?simulateV2(type,condition,seed):simulateLegacy(type,condition,seed);}
