const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest }  = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// ─── CONSTANTS (must match frontend) ─────────────────────────────────────────
const TRACK_SPACES    = 12;
const TIEBREAK_SPACES = 3;
const BET_CLOSE_SECS  = 30;
const ROLL_INTERVAL   = 3500;
const HURDLE_CELL     = 5;

const RACE_TYPES = ["standard","down_back","hurdle","magic_dice","triple_dice"];

const RACE_NAMES = [
  "Belmont Invitational","Churchill Classic","Saratoga Sprint","Preakness Cup",
  "Ascot Gold Run","Epsom Derby","Dubai Millennium","Kentucky Crown",
  "Arc de Triomphe","Breeders' Showdown","Melbourne Dash","Pegasus Stakes",
  "Santa Anita Gold","Cheltenham Chase","Royal Ascot","Goodwood Festival",
  "Iron Horse Classic","Thunder Ridge Open","Neon City Grand Prix","Crystal Cup",
  "Pacific Rim Stakes","Golden Gate Sprint","Lone Star Derby","Emerald Cup",
  "Midnight Classic","Sunrise Stakes","Thunderdome Open","Apex Invitational",
];

const HORSE_COATS = [
  { name:"White",      filter:"brightness(10) saturate(0)" },
  { name:"Light Gray", filter:"brightness(3) saturate(0)" },
  { name:"Gray",       filter:"brightness(1.8) saturate(0)" },
  { name:"Dark Gray",  filter:"brightness(0.9) saturate(0)" },
  { name:"Black",      filter:"brightness(0.15) saturate(0)" },
  { name:"Chestnut",   filter:"sepia(1) saturate(2) hue-rotate(340deg) brightness(0.85)" },
  { name:"Bay",        filter:"sepia(1) saturate(1.5) hue-rotate(330deg) brightness(0.65)" },
  { name:"Dark Bay",   filter:"sepia(1) saturate(1.2) hue-rotate(325deg) brightness(0.45)" },
  { name:"Palomino",   filter:"sepia(0.8) saturate(2.5) hue-rotate(5deg) brightness(1.4)" },
  { name:"Buckskin",   filter:"sepia(0.6) saturate(2) hue-rotate(15deg) brightness(1.2)" },
  { name:"Sorrel",     filter:"sepia(1) saturate(3) hue-rotate(350deg) brightness(1.0)" },
];

const HORSE_NAME_POOL = [
  "Shadow Dancer","Iron Duke","Lady Luck","Thunderbolt","Mystic Rose","Silver Arrow",
  "Dark Storm","Golden Boy","Wild Spirit","Night Rider","Star Gazer","Red Baron",
  "Blue Moon","Desert Wind","Fire Starter","Ice Queen","Lucky Charm","Noble Quest",
  "Ocean Wave","Phantom Racer","Quick Silver","Royal Flush","Speed Demon","Twilight",
  "Valor","Whirlwind","Xanadu","Yellow Rose","Zephyr","Ace High","Black Diamond",
  "Crown Jewel","Dazzle","Eagle Eye","Fury Road","Ghost Rider","Honorable","Inferno",
];

const TRACK_CONDITIONS = {
  sunny: { weight:6 },
  rain:  { weight:2 },
  fog:   { weight:2 },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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

function pickCondition(raceType, raceId) {
  if(raceType === "magic_dice") return "sunny";
  const seed = raceId.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+11), 0);
  const pool = [];
  Object.entries(TRACK_CONDITIONS).forEach(([k,v]) => { for(let i=0;i<v.weight;i++) pool.push(k); });
  return pool[seed % pool.length];
}

function pickHorseNames(raceId) {
  const seed = raceId.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+1), 0);
  const pool = [...HORSE_NAME_POOL];
  for(let i=pool.length-1;i>0;i--){
    const j = Math.abs(seed*(i+1)*2654435761 >>> 0) % (i+1);
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  return pool.slice(0,6);
}

function pickHorseCoats(raceId) {
  const seed = raceId.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+3)*7, 0);
  const pool = [...HORSE_COATS];
  for(let i=pool.length-1;i>0;i--){
    const j = Math.abs(seed*(i+1)*1234567891 >>> 0) % (i+1);
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  return pool.slice(0,6);
}

// ─── FULL ROLL HISTORY SIMULATION ────────────────────────────────────────────
// Returns { winner, rolls: [{dice, moves, positions, legDone}] }
function simulateRaceWithHistory(raceType, condition, seed) {
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

// ─── SCHEDULE GENERATION ─────────────────────────────────────────────────────
function generateSchedule(now) {
  const races = [];
  const names = [...RACE_NAMES].sort(() => Math.random() - 0.5);
  let cursor = now + 4 * 60 * 1000;
  for(let i = 0; i < 32; i++) {
    const type    = RACE_TYPES[i % RACE_TYPES.length];
    const raceId  = `r${i}_${now}`;
    const condition = pickCondition(type, raceId);
    const seed    = Math.floor(Math.random() * 2147483647) + 1;
    races.push({
      id: raceId, name: names[i % names.length], type, condition,
      startTime: cursor, status: "upcoming",
      horses: pickHorseNames(raceId), coats: pickHorseCoats(raceId), seed,
    });
    cursor += (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
  }
  return races;
}

function generateAuctionSchedule(now) {
  const races = [];
  const names = [...RACE_NAMES].sort(() => Math.random() - 0.5);
  let cursor = now + 5 * 60 * 1000;
  for(let i = 0; i < 32; i++) {
    const type    = RACE_TYPES[i % RACE_TYPES.length];
    const raceId  = `a${i}_${now}`;
    const condition = pickCondition(type, raceId);
    const seed    = Math.floor(Math.random() * 2147483647) + 1;
    const horseOrder = [...Array(6).keys()].sort(() => Math.random() - 0.5);
    races.push({
      id: raceId, name: names[i % names.length], type, condition,
      startTime: cursor, status: "upcoming", isAuction: true, horseOrder,
      horses: pickHorseNames(raceId), coats: pickHorseCoats(raceId), seed,
    });
    cursor += (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
  }
  return races;
}

// ─── MAIN CRON FUNCTION ───────────────────────────────────────────────────────
// Runs every minute — manages schedule and pre-computes race roll histories
exports.raceScheduler = onSchedule("every 1 minutes", async () => {
  const now = Date.now();

  // ── 1. Load or generate schedule ──────────────────────────────────────────
  const [schedSnap, auctionSnap] = await Promise.all([
    db.doc("global/schedule").get(),
    db.doc("global/auctionSchedule").get(),
  ]);

  let schedule      = schedSnap.exists      ? schedSnap.data().races      : null;
  let auctionSched  = auctionSnap.exists     ? auctionSnap.data().races    : null;

  // Regenerate if missing or all races are finished
  // Regenerate when no unfinished races remain in the future
  const hasFuture = (races) => races && races.some(r => r.status !== 'finished' && r.startTime > now - 5 * 60 * 1000);

  if(!hasFuture(schedule)) {
    schedule = generateSchedule(now);
    await db.doc("global/schedule").set({ races: schedule, generatedAt: now });
    console.log("Generated new schedule with", schedule.length, "races");
  }

  if(!hasFuture(auctionSched)) {
    auctionSched = generateAuctionSchedule(now);
    await db.doc("global/auctionSchedule").set({ races: auctionSched, generatedAt: now });
    console.log("Generated new auction schedule");
  }

  // ── 2. Pre-compute roll histories for races starting in the next 2 minutes ──
  const allRaces = [...schedule, ...auctionSched];
  const upcoming = allRaces.filter(r => {
    const fireTime = r.isAuction ? r.startTime + 30000 : r.startTime;
    return fireTime > now && fireTime <= now + 2 * 60 * 1000;
  });

  const rollsSnap = await db.doc("global/raceRolls").get();
  const rollsDoc  = rollsSnap.exists ? rollsSnap.data() : {};

  let changed = false;
  for(const race of upcoming) {
    if(rollsDoc[race.id]) continue; // already computed
    console.log("Pre-computing rolls for", race.id, race.name);
    const { winner, rolls } = simulateRaceWithHistory(race.type, race.condition || "sunny", race.seed);
    const visualFinishAt = (race.isAuction ? race.startTime + 30000 : race.startTime) + 1300 + rolls.length * ROLL_INTERVAL;
    rollsDoc[race.id] = { winner, rolls, visualFinishAt, computedAt: now };
    changed = true;
  }

  if(changed) {
    await db.doc("global/raceRolls").set(rollsDoc);
    console.log("Saved roll histories for", upcoming.length, "races");
  }

  // ── 3. Mark finished races ────────────────────────────────────────────────
  // Max possible race duration: 60 rolls * ROLL_INTERVAL + 10s buffer
  const MAX_RACE_MS = 60 * ROLL_INTERVAL + 10000;

  const shouldBeFinished = (r) => {
    if(r.status === "finished") return false;
    const fireTime = r.isAuction ? r.startTime + 30000 : r.startTime;
    const rollData = rollsDoc[r.id];
    // If we have roll data, use the exact visualFinishAt
    if(rollData && now > rollData.visualFinishAt + 30000) return true;
    // If no roll data but race started long enough ago, mark finished anyway
    if(now > fireTime + MAX_RACE_MS) return true;
    return false;
  };

  let schedChanged = false;
  const updatedSchedule = schedule.map(r => {
    if(shouldBeFinished(r)) { schedChanged = true; return {...r, status:"finished"}; }
    return r;
  });
  const updatedAuction = auctionSched.map(r => {
    if(shouldBeFinished(r)) { schedChanged = true; return {...r, status:"finished"}; }
    return r;
  });

  // Always save — ensures finished status persists even if schedChanged is false
  await Promise.all([
    db.doc("global/schedule").set({ races: updatedSchedule, generatedAt: now }),
    db.doc("global/auctionSchedule").set({ races: updatedAuction, generatedAt: now }),
  ]);

  return null;
});

// ─── HTTP TRIGGER (for testing / manual invoke) ──────────────────────────────
exports.raceSchedulerHttp = onRequest(async (req, res) => {
  const now = Date.now();
  const [schedSnap, auctionSnap] = await Promise.all([
    db.doc("global/schedule").get(),
    db.doc("global/auctionSchedule").get(),
  ]);
  let schedule     = schedSnap.exists     ? schedSnap.data().races : null;
  let auctionSched = auctionSnap.exists   ? auctionSnap.data().races : null;
  const hasFuture  = (races) => races && races.some(r => r.startTime > now - 30*60*1000);
  if(!hasFuture(schedule)) {
    schedule = generateSchedule(now);
    await db.doc("global/schedule").set({ races: schedule, generatedAt: now });
  }
  if(!hasFuture(auctionSched)) {
    auctionSched = generateAuctionSchedule(now);
    await db.doc("global/auctionSchedule").set({ races: auctionSched, generatedAt: now });
  }
  const allRaces = [...schedule, ...auctionSched];
  const upcoming = allRaces.filter(r => {
    const ft = r.isAuction ? r.startTime + 30000 : r.startTime;
    return ft > now && ft <= now + 3 * 60 * 1000;
  });
  const rollsSnap = await db.doc("global/raceRolls").get();
  const rollsDoc  = rollsSnap.exists ? rollsSnap.data() : {};
  let changed = false;
  for(const race of upcoming) {
    if(rollsDoc[race.id]) continue;
    const { winner, rolls } = simulateRaceWithHistory(race.type, race.condition||"sunny", race.seed);
    const visualFinishAt = (race.isAuction ? race.startTime+30000 : race.startTime) + 1300 + rolls.length * ROLL_INTERVAL;
    rollsDoc[race.id] = { winner, rolls, visualFinishAt, computedAt: now };
    changed = true;
  }
  if(changed) await db.doc("global/raceRolls").set(rollsDoc);
  res.json({ ok: true, time: new Date().toISOString(), racesPrepped: upcoming.length });
});
