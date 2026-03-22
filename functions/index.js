const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest }  = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
admin.initializeApp();
const db = admin.firestore();

// ─── PROVABLY FAIR HELPERS ────────────────────────────────────────────────────
function sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}
function generateFairSeed() {
  // Cryptographically secure random seed
  return crypto.randomBytes(16).toString("hex");
}
function seedToInt(seedHex) {
  // Convert hex seed to integer for mulberry32
  return parseInt(seedHex.slice(0,8), 16) || 1;
}

// ─── CONSTANTS (must match frontend) ─────────────────────────────────────────
const TRACK_SPACES    = 12;
const TIEBREAK_SPACES = 3;
const BET_CLOSE_SECS  = 30;
const ROLL_INTERVAL   = 3500;
const HURDLE_CELL     = 5;

const RACE_TYPES = ["standard","down_back","hurdle","magic_dice","triple_dice"];

// ─── GENERATIVE NAME SYSTEM ──────────────────────────────────────────────────
// Race names: [Adjective] [Location] [Event] → ~15,000+ combos
const RACE_ADJ = [
  "Golden","Silver","Iron","Crystal","Diamond","Emerald","Sapphire","Ruby","Amber","Crimson",
  "Midnight","Sunset","Sunrise","Thunder","Lightning","Storm","Shadow","Neon","Electric","Blazing",
  "Ancient","Royal","Grand","Imperial","Premier","Supreme","Elite","Classic","Legendary","Eternal",
  "Desert","Arctic","Tropical","Coastal","Mountain","Valley","Canyon","Ridge","Summit","Pacific",
  "Atlantic","Gulf","River","Ocean","Prairie","Highland","Lowland","Northern","Southern","Eastern",
];
const RACE_LOC = [
  "Gate","Crown","Cup","Stakes","Park","Downs","Track","Circuit","Oval","Mile",
  "Derby","Meadows","Fields","Pines","Hills","Sands","Coast","Ridge","Glen","Crest",
  "Cross","Point","Pass","Run","Way","Lane","Path","Trail","Road","Course",
];
const RACE_EVENT = [
  "Classic","Invitational","Championship","Sprint","Derby","Stakes","Open","Cup","Challenge","Grand Prix",
  "Showdown","Dash","Run","Race","Prix","Trophy","Bowl","Series","Festival","Finale",
];

// Horse names: [Prefix] + [Suffix] → ~4,000+ combos
const HORSE_PREFIX = [
  "Shadow","Iron","Lady","Thunder","Mystic","Silver","Dark","Golden","Wild","Night",
  "Star","Red","Blue","Desert","Fire","Ice","Lucky","Noble","Ocean","Phantom",
  "Quick","Royal","Speed","Twilight","Valor","Whirl","Blazing","Storm","Crimson","Velvet",
  "Black","White","Ghost","Sacred","Swift","Bold","Brave","Fierce","Regal","Solar",
  "Lunar","Cosmic","Sonic","Neon","Steel","Stone","Jade","Onyx","Pearl","Ember",
  "Frost","Blaze","Drift","Comet","Titan","Atlas","Orion","Nova","Eclipse","Inferno",
];
const HORSE_SUFFIX = [
  "Dancer","Duke","Charm","Bolt","Rose","Arrow","Storm","Boy","Spirit","Rider",
  "Gazer","Baron","Moon","Wind","Starter","Queen","Streak","Quest","Wave","Racer",
  "Flash","Flush","Demon","Dream","Heart","Wing","Blade","Crest","Fire","Force",
  "Star","King","Prince","Glory","Honor","Legend","Fury","Blaze","Spark","Rush",
  "Dash","Drift","Strike","Surge","Drive","Pulse","Flare","Light","Shade","Pride",
  "Grace","Power","Spirit","Valor","Might","Gleam","Glow","Shine","Dawn","Dusk",
  "Dust","Thunder","Shadow","Storm","Flash","Clash","Crash","Smash","Lash","Dash",
];

function seededPick(arr, seed, offset=0) {
  const h = Math.abs((seed * 2654435761 + offset * 1234567891) >>> 0);
  return arr[h % arr.length];
}

function generateRaceName(raceId) {
  const seed = raceId.split("").reduce((a,c,i) => a + c.charCodeAt(0)*(i+17), 0);
  const adj   = seededPick(RACE_ADJ,   seed, 1);
  const loc   = seededPick(RACE_LOC,   seed, 2);
  const event = seededPick(RACE_EVENT, seed, 3);
  return `${adj} ${loc} ${event}`;
}

const HORSE_FUNNY = [
  // Puns
  "Hay Girl Hay","Stable Genius","Neigh Sayer","Hoof Hearted","Gallop Poll",
  "Sir Prance A Lot","Mane Attraction","Furlong John Silver","Trot Luck",
  "Unbridled Chaos","Canter Believe It","Mare-velous","Saddle Up Buttercup",
  "Pasture Prime","Stirrup Trouble","Stable Diffusion","Rein Man","Foal Play",
  "Mane Event","Canter Stop Me Now","Whinny The Pooh","Pony Up","Furlong Goodbye",
  "Mare Force One","Hoof Do You Think You Are","Rein Check","Bit By Bit",
  "Equestrianaire","Jockey Of All Trades","Sir Rides A Lot","Clop Clop Bang Bang",
  "Four Legs McGee","Hoofin It","Bridle Party","Neigh-borhood Watch","Colt Shoulder",
  "Bit Player","Colt Case Scenario","Trot Nixon","Bridle Shower","Horse Of Course",
  // Tech
  "The Algorithm","Dark Web Runner","Final Boss","404 Horse Found",
  "Stack Overflow","Runtime Error","Null Pointer","Git Push","Buffering",
  "Blue Screen","Hard Reboot","Factory Reset","Low Battery","Kernel Panic",
  "Syntax Error","Memory Leak","Sudo Runner","Ctrl Alt Delete","Force Quit",
  "WiFi Password","Bluetooth Pony","Incognito Mode","Cookies Accepted",
  "Cached Results","Server Down","Pending Approval","Two Factor Auth",
  "Password123","Auto Correct","Spam Filter","Pop Up Blocker","Dark Mode",
  "Do Not Disturb","Unsubscribe","Reply All","Out Of Memory","Disk Full",
  "Cloud Storage","Bitcoin Blaze","Crypto Crash","NFT Nightmare","AI Generated",
  "Prompt Engineer","Machine Learning","Neural Network","Deep Fake","Chat Bot",
  "404 Finish Line","HTTP Horse","localhost:3000","yarn install","npm audit fix",
  // Absurd
  "I Am A Horse","Definitely Not A Dog","Surprisingly Fast","Unexpected Visitor",
  "Send Help","Out Of Office","Left On Read","Technically Legal","No Ragrets",
  "Plot Twist","Hidden Fees","Loading Please Wait","Accidental Winner","Who Let Me In",
  "Not My Problem","Fine Print","Read The Room","Main Character Energy",
  "Side Quest","Touch Grass","Skill Issue","Vibe Check","Too Powerful","Big Yikes",
  "That Escalated","Plot Armor","Final Form","It Is What It Is","Understood The Assignment",
  "Rent Free","NPC Runner","Understood The Vibes","Literally Shaking","No Notes",
  "Unhinged","Built Different","Slay Queen","Ate And Left No Crumbs","Bestie",
  "Based And Redpilled","Touch Grass Twice","Chronically Online","Delulu","Rizz",
  "Caught In 4K","No Cap","Lowkey Goated","Sheesh","Bussin","Mid At Best",
  "Sleep Deprived","Caffeine Dependent","Running On Vibes","Zero Preparation",
  "Wrong Tab Open","Autocomplete Champion","Checked The Wiki","Googled It",
  // Pop Culture
  "Fast And Furious","Hay-Z","Taylor Trots","Post Malone-y","Shrek 5",
  "Dobby Is Free","You Shall Not Pass","Winter Is Coming","I Am Iron Horse",
  "Baby Yoda Runs","Seabiscuit 2.0","War Horse Emoji","My Little Nightmare",
  "Oats McKinnon","Bucephalus Jr","Gandalf The Grey","Han Solo Runner",
  "Dwayne The Pony Johnson","Nicolas Cage Rage","Keanu Neighves","Jeff Trots",
  "Elon Tusk","Mark Trotterberg","Beyonce Gallops","Rihanna Runs","Drake Pace",
  "Kanye Westerly","Lil Trot Baby","Bad Bunny Hops","Post Gallone","Ice Trotter",
  "Billie Eilish Runs","Harry Styles Fast","Sabrina Carpenter Canters","Chappell Roan Race",
  "The Weekend Sprint","Weeknd At Bernies","Olivia Rodeo","Doja Cat Nap",
  "Timothee Chalamet Runs","Zendaya Dashes","Tom Holands Horse","Pedro Pascal Pace",
  "Breaking Bad Horse","Better Call Stud","The Wire Trotter","Succession Stakes",
  "White Lotus Legs","Severance Sprint","Beef Runner","The Bear Gallops",
  // Food & Drink
  "Nacho Average Horse","Taco Tuesday","Espresso Yourself","Sir Loin Of Beef",
  "Whiskey Business","Rum Runner","Oat Cuisine","Carrot Top Speed","Apple Turnover",
  "Cold Brew Bullet","Iced Latte Legs","Tiramisu Trots","Ramen Racer","Hot Sauce Hero",
  "Sriracha Splash","Wasabi Warrior","Truffle Shuffle","Kombucha Kick",
  "Matcha Maker","Avocado Toast","Gluten Free Gallop","Charcuterie Board",
  "Cannoli Cannon","Szechuan Blaze","Kimchi Kick","Pulled Pork Pace",
  "Brisket Blaze","Boba Tea Blitz","Croissant Canter","Sourdough Sprint",
  "Flat White Flash","Cortado Charge","Oat Milk Obliterator","Smashed Avo",
  "Wagyu Runner","Omakase Gallop","Birria Blaze","Al Pastor Pace",
  // Mythology & History
  "Pegasus Jr","Sleipnirs Son","Eponas Chosen","Zeus Thunderhoof",
  "Ares War Steed","Apollo Sun Runner","Hermes Sprinter","Poseidons Fury",
  "Achilles Heel","Odyssey Runner","Odins Charger","Freyas Mare","Lokis Trick",
  "Valhalla Bound","Ra Sun Steed","Atlas Shrugged","Prometheus Fire","Icarus Flew",
  "Fenrirs Foal","Bifrost Runner","Cleopatras Charger","Caesar Sprint",
  "Napoleons Retreat","Genghis Khan Gallop","Alexandrias Horse","Spartan 300",
  // Sports & Games
  "First And Ten","Grand Slam Dunk","Hat Trick Pony","Overtime Hero",
  "Sudden Death","Penalty Kick","Blitz Attack","Double Bogey","Eagle Scout",
  "Hole In One","Buzzer Beater","Touch Down","Home Run Hero","Triple Double",
  "Clean Sheet","Corner Kick King","Birdie Putt","Ace Serve","Match Point",
  "Final Whistle","Extra Time","Penalty Shootout","Golden Boot","MVP",
  "Respawn Timer","No Clip Mode","God Mode Activated","Cheat Code","Boss Rush",
  "Speedrun Record","Any Percent","Rage Quit","GG No Re","Try Hard",
  // Vibes & Aesthetic
  "Electric Slide","Velvet Thunder","Disco Inferno","Neon Cowboy","Glitter Cannon",
  "Cosmic Debris","Schrodingers Horse","Dark Matter","Event Horizon",
  "The Dark Horse Knight","Horse With No Name","Velvet Underground",
  "Synthwave Stallion","Lo Fi Legs","Holographic Pony","Laser Show",
  "Vaporwave Trots","Retro Future","Pastel Chaos","Cottagecore Canter",
  "Dark Academia Dash","Goblincore Gallop","Cottagecore Champion","Y2K Runner",
  "Indie Sleeper","Hyperpop Hooves","Dreamcore Derby","Liminal Space Racer",
  "Liminal Finish Line","Backrooms Sprint","Found Footage","Creepypasta",
];

function generateHorseName(raceId, slot) {
  const seed = raceId.split("").reduce((a,c,i) => a + c.charCodeAt(0)*(i+slot*7+3), 0);
  // ~30% chance of funny name, ~70% classic prefix+suffix
  const stylePick = Math.abs((seed * 3141592653 + slot * 2718281828) >>> 0) % 10;
  if(stylePick < 3) {
    // Funny/creative name
    return seededPick(HORSE_FUNNY, seed, slot + 42);
  }
  const prefix = seededPick(HORSE_PREFIX, seed, slot);
  const suffix = seededPick(HORSE_SUFFIX, seed + slot*999983, slot+1);
  return `${prefix} ${suffix}`;
}

const HORSE_COATS = [
  { name:"Chestnut",        filter:"sepia(1) saturate(2) hue-rotate(340deg) brightness(0.85)",   coatIndex:0  },
  { name:"Light Chestnut",  filter:"sepia(1) saturate(1.8) hue-rotate(338deg) brightness(1.1)",  coatIndex:1  },
  { name:"Liver Chestnut",  filter:"sepia(1) saturate(1.5) hue-rotate(335deg) brightness(0.6)",  coatIndex:2  },
  { name:"Flaxen Chestnut", filter:"sepia(0.9) saturate(2) hue-rotate(338deg) brightness(0.9)",  coatIndex:3  },
  { name:"Sorrel",          filter:"sepia(1) saturate(3) hue-rotate(350deg) brightness(1.0)",    coatIndex:4  },
  { name:"Dark Sorrel",     filter:"sepia(1) saturate(2.5) hue-rotate(345deg) brightness(0.75)", coatIndex:5  },
  { name:"Bay",             filter:"sepia(1) saturate(1.5) hue-rotate(330deg) brightness(0.65)", coatIndex:6  },
  { name:"Blood Bay",       filter:"sepia(1) saturate(2) hue-rotate(325deg) brightness(0.55)",   coatIndex:7  },
  { name:"Dark Bay",        filter:"sepia(1) saturate(1.2) hue-rotate(325deg) brightness(0.45)", coatIndex:8  },
  { name:"Light Bay",       filter:"sepia(1) saturate(1.8) hue-rotate(332deg) brightness(0.8)",  coatIndex:9  },
  { name:"Mahogany Bay",    filter:"sepia(1) saturate(1.4) hue-rotate(322deg) brightness(0.5)",  coatIndex:10 },
  { name:"Black",           filter:"brightness(0.15) saturate(0)",                               coatIndex:11 },
  { name:"Seal Brown",      filter:"sepia(1) saturate(0.8) hue-rotate(320deg) brightness(0.3)",  coatIndex:12 },
  { name:"Dark Brown",      filter:"sepia(1) saturate(1) hue-rotate(318deg) brightness(0.4)",    coatIndex:13 },
  { name:"Dapple Grey",     filter:"brightness(1.8) saturate(0)",                                coatIndex:14 },
  { name:"Light Grey",      filter:"brightness(3) saturate(0)",                                  coatIndex:15 },
  { name:"Steel Grey",      filter:"brightness(1.2) saturate(0)",                                coatIndex:16 },
  { name:"Fleabitten Grey", filter:"brightness(1.6) saturate(0.1)",                              coatIndex:17 },
  { name:"Rose Grey",       filter:"brightness(1.5) saturate(0.15) hue-rotate(330deg)",          coatIndex:18 },
  { name:"Palomino",        filter:"sepia(0.8) saturate(2.5) hue-rotate(5deg) brightness(1.4)",  coatIndex:19 },
  { name:"Dark Palomino",   filter:"sepia(0.9) saturate(2) hue-rotate(8deg) brightness(1.1)",    coatIndex:20 },
  { name:"Cremello",        filter:"sepia(0.3) saturate(1.5) hue-rotate(10deg) brightness(2.0)", coatIndex:21 },
  { name:"Perlino",         filter:"sepia(0.4) saturate(1.5) hue-rotate(8deg) brightness(1.8)",  coatIndex:22 },
  { name:"Buckskin",        filter:"sepia(0.6) saturate(2) hue-rotate(15deg) brightness(1.2)",   coatIndex:23 },
  { name:"Classic Dun",     filter:"sepia(0.7) saturate(1.8) hue-rotate(18deg) brightness(1.15)",coatIndex:24 },
  { name:"Red Dun",         filter:"sepia(0.8) saturate(2.2) hue-rotate(12deg) brightness(1.1)", coatIndex:25 },
  { name:"Grullo",          filter:"sepia(0.3) saturate(0.5) brightness(0.9)",                   coatIndex:26 },
  { name:"Blue Roan",       filter:"brightness(1.0) saturate(0.2) hue-rotate(200deg)",           coatIndex:27 },
  { name:"Red Roan",        filter:"sepia(0.6) saturate(1.5) hue-rotate(335deg) brightness(0.9)",coatIndex:28 },
  { name:"Strawberry Roan", filter:"sepia(0.5) saturate(1.8) hue-rotate(340deg) brightness(1.0)",coatIndex:29 },
  { name:"Spotted",         filter:"brightness(2) saturate(0.1)",                                coatIndex:30 },
  { name:"Blanket",         filter:"brightness(2.2) saturate(0.05)",                             coatIndex:31 },
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
  // Generate 6 unique horse names for this race
  const names = [];
  const used  = new Set();
  for(let slot = 0; slot < 6; slot++) {
    let name = generateHorseName(raceId, slot);
    // Ensure no duplicates
    let attempt = 0;
    while(used.has(name) && attempt < 10) { name = generateHorseName(raceId, slot + (++attempt)*100); }
    used.add(name);
    names.push(name);
  }
  return names;
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
function generateSchedule(startCursor, seedsDoc) {
  const races = [];
  let cursor = startCursor;
  for(let i = 0; i < 64; i++) {
    const type      = RACE_TYPES[i % RACE_TYPES.length];
    const raceId    = `r${i}_${now}`;
    const condition = pickCondition(type, raceId);
    const seedHex   = generateFairSeed();
    const seedHash  = sha256(seedHex);
    const seedInt   = seedToInt(seedHex);
    seedsDoc[raceId] = seedHex;
    races.push({
      id: raceId, name: generateRaceName(raceId), type, condition,
      startTime: cursor, status: "upcoming", seedHash, seed: seedInt,
      horses: pickHorseNames(raceId), coats: pickHorseCoats(raceId),
    });
    cursor += (1 + Math.floor(Math.random() * 3)) * 60 * 1000;
  }
  return races;
}

function generateAuctionSchedule(startCursor, seedsDoc) {
  const races = [];
  let cursor = startCursor;
  for(let i = 0; i < 64; i++) {
    const type      = RACE_TYPES[i % RACE_TYPES.length];
    const raceId    = `a${i}_${now}`;
    const condition = pickCondition(type, raceId);
    const seedHex   = generateFairSeed();
    const seedHash  = sha256(seedHex);
    const seedInt   = seedToInt(seedHex);
    const horseOrder = [...Array(6).keys()].sort(() => Math.random() - 0.5);
    seedsDoc[raceId] = seedHex;
    races.push({
      id: raceId, name: generateRaceName(raceId), type, condition,
      startTime: cursor, status: "upcoming", isAuction: true, horseOrder,
      seedHash, seed: seedInt,
      horses: pickHorseNames(raceId), coats: pickHorseCoats(raceId),
    });
    cursor += (1 + Math.floor(Math.random() * 3)) * 60 * 1000;
  }
  return races;
}

// ─── MAIN CRON FUNCTION ───────────────────────────────────────────────────────
// Runs every minute — manages schedule and pre-computes race roll histories
exports.raceScheduler = onSchedule({ schedule:"every 1 minutes", memory:"512MiB" }, async () => {
  const now = Date.now();

  // ── 1. Load schedule + seeds ──────────────────────────────────────────────
  const [schedSnap, auctionSnap, seedsSnap] = await Promise.all([
    db.doc("global/schedule").get(),
    db.doc("global/auctionSchedule").get(),
    db.doc("private/raceSeeds").get(),
  ]);

  let schedule      = schedSnap.exists   ? schedSnap.data().races   : null;
  let auctionSched  = auctionSnap.exists ? auctionSnap.data().races : null;
  const seedsDoc    = seedsSnap.exists   ? seedsSnap.data()         : {};

  // Count unfinished future races
  const futureCount = (races) => !races ? 0 :
    races.filter(r => r.status !== 'finished' && r.startTime > now).length;

  const TOPUP_THRESHOLD = 30;
  const BATCH = 64;

  // Helper: append new races after the last existing race
  const topUpSchedule = (existing, genFn) => {
    const lastTime = existing.reduce((m, r) => Math.max(m, r.startTime), now);
    return [...existing, ...genFn(lastTime + 60000, seedsDoc)];
  };

  // Trim old finished races, keep last 20
  const trimOld = (races) => {
    const finished = races.filter(r => r.status === 'finished');
    const rest = races.filter(r => r.status !== 'finished');
    return [...finished.slice(-5), ...rest];
  };

  // Regenerate or top-up regular schedule
  if(!schedule || schedule.length === 0) {
    schedule = generateSchedule(now + 60000, seedsDoc);
    console.log("Generated fresh schedule:", schedule.length, "races");
  } else if(futureCount(schedule) < TOPUP_THRESHOLD) {
    schedule = topUpSchedule(trimOld(schedule), generateSchedule);
    console.log("Topped up schedule, now:", schedule.length, "races");
  }

  // Regenerate or top-up auction schedule
  if(!auctionSched || auctionSched.length === 0) {
    auctionSched = generateAuctionSchedule(now + 60000, seedsDoc);
    console.log("Generated fresh auction schedule:", auctionSched.length, "races");
  } else if(futureCount(auctionSched) < TOPUP_THRESHOLD) {
    auctionSched = topUpSchedule(trimOld(auctionSched), generateAuctionSchedule);
    console.log("Topped up auction schedule, now:", auctionSched.length, "races");
  }

  // ── 2. Pre-compute roll histories for races starting in the next 2 minutes ──
  const allRaces = [...schedule, ...auctionSched];
  const upcoming = allRaces.filter(r => {
    const fireTime = r.isAuction ? r.startTime + 30000 : r.startTime;
    return fireTime > now && fireTime <= now + 2 * 60 * 1000;
  });

  const rollsSnap = await db.doc("global/raceRolls").get();
  let rollsDoc  = rollsSnap.exists ? rollsSnap.data() : {};

  // Trim old roll entries to prevent doc from growing unboundedly
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const trimmedRolls = {};
  for(const [raceId, data] of Object.entries(rollsDoc)) {
    if(data.computedAt && now - data.computedAt < TWO_HOURS) {
      trimmedRolls[raceId] = data;
    }
  }
  const trimCount = Object.keys(rollsDoc).length - Object.keys(trimmedRolls).length;
  if(trimCount > 0) console.log(`Trimmed ${trimCount} old roll entries`);
  rollsDoc = trimmedRolls;

  let changed = trimCount > 0;
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
    console.log("Saved roll histories, total entries:", Object.keys(rollsDoc).length);
  }

  // ── 3. Mark finished races ────────────────────────────────────────────────
  // Max race = 60 rolls * ROLL_INTERVAL + 40s buffer
  const MAX_RACE_MS = 60 * ROLL_INTERVAL + 40000;

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

  // Reveal seeds for newly finished races
  let seedsChanged = false;
  const revealForSchedule = (races) => races.map(r => {
    if(r.status === "finished" && !r.revealedSeed && seedsDoc[r.id]) {
      seedsChanged = true;
      const revealedSeed = seedsDoc[r.id];
      return { ...r, revealedSeed };
    }
    return r;
  });
  const finalSchedule = revealForSchedule(updatedSchedule);
  const finalAuction  = revealForSchedule(updatedAuction);

  await Promise.all([
    db.doc("global/schedule").set({ races: finalSchedule, generatedAt: now }),
    db.doc("global/auctionSchedule").set({ races: finalAuction, generatedAt: now }),
    db.doc("private/raceSeeds").set(seedsDoc),
  ]);

  return null;
});

// ─── HTTP TRIGGER (for testing / manual top-up) ─────────────────────────────
exports.raceSchedulerHttp = onRequest({ memory:"512MiB" }, async (req, res) => {
  const now = Date.now();
  const [schedSnap, auctionSnap, seedsSnapH] = await Promise.all([
    db.doc("global/schedule").get(),
    db.doc("global/auctionSchedule").get(),
    db.doc("private/raceSeeds").get(),
  ]);
  let schedule     = schedSnap.exists   ? schedSnap.data().races : null;
  let auctionSched = auctionSnap.exists ? auctionSnap.data().races : null;
  const seedsDoc   = seedsSnapH.exists  ? seedsSnapH.data()       : {};

  const futureCountH = (races) => !races ? 0 :
    races.filter(r => r.status !== "finished" && r.startTime > now).length;

  const trimOldH = (races) => {
    const finished = races.filter(r => r.status === "finished");
    const rest     = races.filter(r => r.status !== "finished");
    return [...finished.slice(-5), ...rest];
  };

  const topUpH = (existing, genFn) => {
    const lastTime = existing.reduce((m,r) => Math.max(m, r.startTime), now);
    return [...existing, ...genFn(lastTime + 60000, seedsDoc)];
  };

  if(!schedule || schedule.length === 0) {
    schedule = generateSchedule(now + 60000, seedsDoc);
  } else if(futureCountH(schedule) < TOPUP_THRESHOLD) {
    schedule = topUpH(trimOldH(schedule), generateSchedule);
  }

  if(!auctionSched || auctionSched.length === 0) {
    auctionSched = generateAuctionSchedule(now + 60000, seedsDoc);
  } else if(futureCountH(auctionSched) < TOPUP_THRESHOLD) {
    auctionSched = topUpH(trimOldH(auctionSched), generateAuctionSchedule);
  }

  await Promise.all([
    db.doc("global/schedule").set({ races: schedule, generatedAt: now }),
    db.doc("global/auctionSchedule").set({ races: auctionSched, generatedAt: now }),
    db.doc("private/raceSeeds").set(seedsDoc),
  ]);

  // Pre-compute rolls for next 3 minutes
  const allRaces = [...schedule, ...auctionSched];
  const upcoming = allRaces.filter(r => {
    const ft = r.isAuction ? r.startTime + 30000 : r.startTime;
    return ft > now && ft <= now + 3 * 60 * 1000;
  });
  const rollsSnap = await db.doc("global/raceRolls").get();
  const rollsDoc2  = rollsSnap.exists ? rollsSnap.data() : {};
  let changed = false;
  for(const race of upcoming) {
    if(rollsDoc2[race.id]) continue;
    const { winner, rolls } = simulateRaceWithHistory(race.type, race.condition||"sunny", race.seed);
    const visualFinishAt = (race.isAuction ? race.startTime+30000 : race.startTime) + 1300 + rolls.length * ROLL_INTERVAL;
    rollsDoc2[race.id] = { winner, rolls, visualFinishAt, computedAt: now };
    changed = true;
  }
  if(changed) await db.doc("global/raceRolls").set(rollsDoc2);

  res.json({
    ok: true,
    time: new Date().toISOString(),
    futureRaces: futureCountH(schedule),
    futureAuctions: futureCountH(auctionSched),
    racesPrepped: upcoming.length,
  });
});
