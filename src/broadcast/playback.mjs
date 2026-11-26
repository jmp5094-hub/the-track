export const SILKS = ['#ae4d3e', '#e9dfc8', '#e5aa55', '#53846d', '#88789d', '#6290ad'];
export const PIPS = [[], [4], [0,8], [0,4,8], [0,2,6,8], [0,2,4,6,8], [0,2,3,5,6,8]];
export const TRACK_FINISH = 75;
export const LEADER_START = -172;
export const COURSE_MIN = LEADER_START - 42;
export const COURSE_MAX = TRACK_FINISH + 44;
export const GO = .6;
const NOSE = 1.56;
const SPACE = 1.85;
const FIRST_ROLL = 1.3;
export const LAND = .64;
export const VOICE = LAND + .12;
const MOVE = 1.38;
const MOVE_END = 2.52;
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
  const mainCount = tieStart < 0 ? rolls.length : tieStart;
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
  cues.push(call('win'+(winner+1), end));

  function sample(seconds) {
    const time = Math.max(0, seconds);
    const done = time >= end;
    const index = time < FIRST_ROLL ? -1 : Math.min(rolls.length - 1, Math.floor((time - FIRST_ROLL) / cycle));
    const roll = rolls[index];
    const tiebreak = tieStart >= 0 && index >= tieStart;
    const active = tiebreak && tieActive.length ? tieActive : SEATS;
    const goal = tiebreak ? tieSpaces : raceSpaces;
    const previous = index <= 0 || index === tieStart ? GATE : rolls[index - 1].positions;
    const into = time - FIRST_ROLL - index * cycle;
    const amount = roll ? clamp((into - MOVE) / (MOVE_END - MOVE)) : 0;
    const exact = roll && amount >= 1 ? roll.positions : previous;
    const progress = previous.map((from, id) => {
      const to = roll?.positions[id] ?? from;
      if (to - from !== 2) return mix(from,to,smooth(amount));
      return from + smooth(clamp(amount * 2.2)) + smooth(clamp((amount-.545)*2.2));
    });
    const surge = progress.map((value,id) => Math.min(1, Math.abs(value-previous[id])) * Math.sin(Math.PI*amount));
    const segmentStart = tiebreak ? FIRST_ROLL + tieStart * cycle : GO;
    const segmentEnd = tiebreak ? end : FIRST_ROLL + mainCount * cycle;
    const raceProgress = clamp((time-segmentStart)/(segmentEnd-segmentStart));
    const origin = tiebreak ? TRACK_FINISH-42 : LEADER_START;
    const courseX = mix(origin + goal*SPACE,TRACK_FINISH-NOSE,raceProgress);
    const world = progress.map(position => courseX + (position-goal)*SPACE);
    const leaderX = Math.max(...active.map(id => world[id]));
    const late = raceProgress >= .97;
    const shot = late ? 'wire' : index <= 0 && !tiebreak ? 'gate' : index % 8 >= 4 ? 'stretch' : 'pack';
    const cue = cues.findLast(item => item.time <= time && time < item.time + item.duration);
    return {
      time, sceneTime: tiebreak ? Math.min(time,end)-segmentStart+GO+.22 : Math.min(time,end),
      index, roll, into, rolling: Boolean(roll && into < LAND), done, winner, cue,
      active, progress, exact, surge, leaderX, world, tiebreak, goal, shot,
      launched: time >= GO,
    };
  }
  return { sample, cues, end, endHold: Math.max(2.25,(voice['win'+(winner+1)]?.duration || 0)+.35) };
}

export function shotAt(frame, aspect, reduced) {
  const narrow = aspect < 1.55;
  if (frame.shot === 'wire') return {from:[TRACK_FINISH+.16,narrow?4.1:3.5,narrow?19:15.5],at:[TRACK_FINISH-(narrow?3.7:3.2),1.28,-.25],fov:narrow?52:42};
  if (frame.shot === 'gate' && !reduced) {
    const p=smooth(clamp((frame.time-GO)/2.1));
    return {from:[frame.leaderX+mix(10,7,p),mix(4.6,4.2,p),narrow?13.8:11.3],at:[frame.leaderX-mix(.8,2.6,p),1.06,0],fov:narrow?53:43};
  }
  const low=frame.shot==='stretch'&&!reduced;
  const pack=frame.active.map(id=>frame.progress[id]);
  const behind=(Math.max(...pack)-Math.min(...pack))*SPACE;
  const target=frame.leaderX-Math.max(3.3,behind*.46);
  return {from:[frame.leaderX+(low?5.8:8.2),narrow?7.3:low?3.1:4.75,narrow?18.6:low?15.85:14.35],at:[target,1.14,-.08],fov:narrow?56:low?43:39};
}
