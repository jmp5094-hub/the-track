export const SILKS = ['#ae4d3e', '#e9dfc8', '#e5aa55', '#53846d', '#88789d', '#6290ad'];
export const PIPS = [[], [4], [0,8], [0,4,8], [0,2,6,8], [0,2,4,6,8], [0,2,3,5,6,8]];
export const TRACK_FINISH = 75;
export const SPACE = 3.3;
export const NOSE = 1.56;
export const BOARD_SPACES = 12;
export const LEADER_START = TRACK_FINISH - NOSE - BOARD_SPACES * SPACE;
export const COURSE_MIN = LEADER_START - 21;
export const COURSE_MAX = TRACK_FINISH + 23;
export const GO = .6;
export const FIRST_ROLL = 1.3;
export const LAND = .64;
export const VOICE = LAND + .12;
export const MOVE = 1.53;
export const MOVE_END = 2.7;
const SEATS = [0,1,2,3,4,5];
const GATE = [0,0,0,0,0,0];

export const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const mix = (a,b,p) => a+(b-a)*p;
export const smooth = p => p*p*(3-2*p);
export const lane = horse => (horse-2.5)*1.56;

function leaderOf(positions, active) {
  const best = Math.max(...active.map(id => positions[id]));
  const leaders = active.filter(id => positions[id] === best);
  return leaders.length === 1 ? leaders[0] : null;
}

export function buildPlayback(history, rollInterval, raceSpaces, tieSpaces, voice) {
  const cycle = rollInterval / 1000;
  const rolls = history?.rolls;
  const winner = history?.winner;
  if (!Array.isArray(rolls) || !rolls.length || !SEATS.includes(winner)) return null;
  if (!rolls.every(roll => Array.isArray(roll.dice) && roll.dice.length === 2 &&
      roll.dice.every(die => Number.isInteger(die) && die >= 1 && die <= 6) &&
      Array.isArray(roll.positions) && roll.positions.length === 6 && roll.positions.every(Number.isFinite))) return null;

  const tieStart = rolls.findIndex(roll => roll.phase === 'tiebreak');
  const end = FIRST_ROLL + rolls.length * cycle;
  const tied = rolls[tieStart - 1]?.positions;
  const tieActive = tied ? SEATS.filter(id => tied[id] >= raceSpaces) : SEATS;
  const call = (key, time) => ({key, time, ...voice[key]});
  const cues = [call('open', GO+.04)];
  let previous = GATE;
  let priorLeader = null;
  rolls.forEach((roll,index) => {
    const start = FIRST_ROLL + index * cycle;
    const inTie = tieStart >= 0 && index >= tieStart;
    const active = inTie && tieActive.length ? tieActive : SEATS;
    const primary = call(roll.dice.join(''), start + VOICE);
    cues.push(primary);
    const lead = leaderOf(roll.positions, active);
    if (index === tieStart - 1) {
      const tie = call('tiebreak', start + Math.max(MOVE_END, VOICE + (primary.duration || 0) + .08));
      // The tie announcement can continue over the start of the first tiebreak roll.
      if (tie.time + tie.duration < start + cycle + VOICE - .06) cues.push(tie);
    } else if (lead !== null && lead !== priorLeader && index > 0 && index < rolls.length-1 && index !== tieStart &&
               roll.positions[lead] > previous[lead]) {
      const reaction = call('lead'+(lead+1), start + Math.max(1.75, VOICE + (primary.duration || 0) + .10));
      if (reaction.time + reaction.duration < start + cycle - .09) cues.push(reaction);
    }
    previous = roll.positions;
    priorLeader = lead;
  });
  const winsAt = FIRST_ROLL + (rolls.length-1)*cycle + MOVE_END;
  const lastCue = cues.at(-1);
  cues.push(call('win'+(winner+1), Math.max(winsAt,lastCue.time+(lastCue.duration || 0)+.08)));

  function sample(seconds) {
    const time = Math.max(0, seconds);
    const done = time >= winsAt;
    const index = time < FIRST_ROLL ? -1 : Math.min(rolls.length - 1, Math.floor((time - FIRST_ROLL) / cycle));
    const roll = rolls[index];
    const tiebreak = tieStart >= 0 && index >= tieStart;
    const active = tiebreak && tieActive.length ? tieActive : SEATS;
    const goal = tiebreak ? tieSpaces : raceSpaces;
    const previous = index <= 0 || index === tieStart ? GATE : rolls[index - 1].positions;
    const into = time - FIRST_ROLL - index * cycle;
    const settled = Boolean(roll && into >= MOVE_END - 1e-7);
    const amount = settled ? 1 : roll ? clamp((into - MOVE) / (MOVE_END - MOVE)) : 0;
    const exact = roll && amount >= 1 ? roll.positions : previous;
    const progress = previous.map((from, id) => {
      const to = roll?.positions[id] ?? from;
      if (to - from !== 2) return mix(from,to,smooth(amount));
      return from + smooth(clamp(amount * 2.2)) + smooth(clamp((amount-.545)*2.2));
    });
    const surge = progress.map((value,id) => Math.min(1, Math.abs(value-previous[id])) * Math.sin(Math.PI*amount));
    const world = progress.map(position => TRACK_FINISH - NOSE + (position-goal)*SPACE);
    const leaderX = Math.max(...active.map(id => world[id]));
    const leadingPosition = Math.max(...active.map(id => exact[id]));
    const leaders = active.filter(id => exact[id] === leadingPosition);
    const previousLeader = leaderOf(previous, active);
    const nextLeader = leaderOf(exact, active);
    const movements = active.map(id => ({id,steps:(roll?.positions[id] ?? 0)-previous[id]})).filter(move => move.steps !== 0);
    const lastIndex = roll && amount >= 1 ? index : index - 1;
    const previousRoll = rolls[lastIndex];
    const prior = lastIndex <= 0 || lastIndex === tieStart ? GATE : rolls[lastIndex-1]?.positions || GATE;
    const lastMove = previousRoll ? SEATS.map(id => ({id,steps:previousRoll.positions[id]-prior[id]})).filter(move => move.steps !== 0) : [];
    const priorDistance = goal - Math.max(...active.map(id => previous[id]));
    const shot = done || priorDistance <= 3 ? 'wire'
      : index < 0 && !tiebreak ? 'gate'
      : amount >= 1 && nextLeader !== null && previousLeader !== nextLeader && index > 0 ? 'lead'
      : 'pack';
    const cue = cues.findLast(item => item.time <= time && time < item.time + item.duration);
    return {
      time, sceneTime: Math.min(time,end),
      index, roll, into, rolling: Boolean(roll && into < LAND), done, winner: done ? winner : null, cue,
      active, progress, exact, surge, leaderX, world, tiebreak, goal, shot, leaders, movements,
      lastMove, previousRoll, amount, launched: time >= GO, winsAt,

    };
  }
  return { sample, cues, end, winsAt, endHold: Math.max(2.25,(voice['win'+(winner+1)]?.duration || 0)+.35) };
}

export function shotAt(frame, aspect, steady) {
  const wide = aspect >= 1.65;
  if (frame.shot === 'wire' && !steady) {
    return {from:[TRACK_FINISH-4,wide ? 12.4 : 15.5,wide ? 21 : 25],at:[TRACK_FINISH-4.5,.5,0],fov:39};
  }
  const last = Math.min(...frame.active.map(id => frame.world[id]));
  const spread = frame.leaderX-last;
  const center = last + spread*.54;
  const gate = frame.shot === 'gate' && !steady;
  const lead = frame.shot === 'lead' && !steady;
  const margin = spread*(wide ? .35 : .52);
  return {
    from:[center+(gate ? 8 : lead ? 6 : 4.2), (wide ? 10 : 12)+margin*.55,
      (wide ? 16 : 20)+margin],
    at:[center+(gate ? .5 : 1.1),.65,0],
    fov:wide ? 43 : 47,
  };
}
