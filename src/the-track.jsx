import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import LottieHorse, { OutlineFilters, getCoatIndex, getCoatName } from "./LottieHorse";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs, onSnapshot, serverTimestamp, orderBy, limit, runTransaction, increment } from "firebase/firestore";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCCmWWDZvUgOvQz9fLhxQjd7y64DYSEcw8",
  authDomain: "the-track-c8138.firebaseapp.com",
  projectId: "the-track-c8138",
  storageBucket: "the-track-c8138.firebasestorage.app",
  messagingSenderId: "870178393224",
  appId: "1:870178393224:web:eda929bd3d3ae2f8e2e33d",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
// User profile
const fbGetUser    = async (uid) => { const d = await getDoc(doc(db,"users",uid)); return d.exists() ? d.data() : null; };
const fbSaveUser   = async (uid, data) => setDoc(doc(db,"users",uid), data, {merge:true});
const fbUpdateUser = async (uid, data) => updateDoc(doc(db,"users",uid), data);

// Race schedule (shared across all users)
const fbGetSchedule      = async () => { const d = await getDoc(doc(db,"global","schedule")); return d.exists() ? d.data() : null; };
const fbSaveSchedule     = async (data) => setDoc(doc(db,"global","schedule"), data);
const fbGetAuctionSchedule = async () => { const d = await getDoc(doc(db,"global","auctionSchedule")); return d.exists() ? d.data() : null; };
const fbSaveAuctionSchedule = async (data) => setDoc(doc(db,"global","auctionSchedule"), data);

// Race results (legacy — kept for payout tracking)
const fbGetRaceResults  = async () => { const d = await getDoc(doc(db,"global","raceResults")); return d.exists() ? d.data().results || {} : {}; };
const fbSaveRaceResults = async (r) => setDoc(doc(db,"global","raceResults"), {results:r});
// Roll histories — pre-computed by Cloud Function, read by all clients for replay
const fbGetRaceRolls    = async () => { const d = await getDoc(doc(db,"global","raceRolls")); return d.exists() ? d.data() : {}; };

// Per-user bets
const fbGetConfirmed  = async (uid) => { const d = await getDoc(doc(db,"bets",uid)); return d.exists() ? d.data().confirmed || {} : {}; };
const fbSaveConfirmed = async (uid, c) => setDoc(doc(db,"bets",uid), {confirmed:c});
const fbGetPending    = async (uid) => { const d = await getDoc(doc(db,"bets",uid)); return d.exists() ? d.data().pending || {} : {}; };
const fbSavePending   = async (uid, p) => setDoc(doc(db,"bets",uid), {pending:p}, {merge:true});

// Per-user bet history
const fbGetHistory  = async (uid) => { const d = await getDoc(doc(db,"history",uid)); return d.exists() ? d.data().entries || [] : []; };
const fbSaveHistory = async (uid, h) => setDoc(doc(db,"history",uid), {entries:h});

// Auctions
const fbGetAuctions  = async () => { const d = await getDoc(doc(db,"global","auctions")); return d.exists() ? d.data().data || {} : {}; };
const fbSaveAuctions = async (a) => setDoc(doc(db,"global","auctions"), {data:a});

// Private races
const fbGetPrivateRaces  = async () => { const d = await getDoc(doc(db,"global","privateRaces")); return d.exists() ? d.data().races || {} : {}; };
const fbSavePrivateRaces = async (r) => setDoc(doc(db,"global","privateRaces"), {races:r});

// Bank transactions
const fbGetBankTx  = async (uid) => { const d = await getDoc(doc(db,"bank",uid)); return d.exists() ? d.data().txs || [] : []; };
const fbSaveBankTx = async (uid, txs) => setDoc(doc(db,"bank",uid), {txs});

// ─── FRIENDS SYSTEM ──────────────────────────────────────────────────────────
// friends/{uid} → { following:[uid...], followers:[uid...] }
// userindex/{username} → { uid, username, avatar, balance } (public lookup)
const fbGetFriends      = async (uid) => { const d = await getDoc(doc(db,"friends",uid)); return d.exists() ? d.data() : {following:[],followers:[]}; };
const fbSaveFriends     = async (uid, data) => setDoc(doc(db,"friends",uid), data);
const fbGetUserIndex    = async (username) => { const d = await getDoc(doc(db,"userindex",username.toLowerCase())); return d.exists() ? d.data() : null; };
const fbSaveUserIndex   = async (username, uid, avatar, balance) => setDoc(doc(db,"userindex",username.toLowerCase()), {uid, username, avatar, balance});
const fbGetUserByUid    = async (uid) => { const d = await getDoc(doc(db,"users",uid)); return d.exists() ? d.data() : null; };
const fbGetConfirmedForUser = async (uid) => { const d = await getDoc(doc(db,"bets",uid)); return d.exists() ? d.data().confirmed || {} : {}; };

const fbFollow = async (myUid, theirUid) => {
  // Add theirUid to my following, add myUid to their followers
  const [myFriends, theirFriends] = await Promise.all([fbGetFriends(myUid), fbGetFriends(theirUid)]);
  const myFollowing   = [...new Set([...(myFriends.following||[]),    theirUid])];
  const theirFollowers= [...new Set([...(theirFriends.followers||[]), myUid])];
  await Promise.all([
    fbSaveFriends(myUid,    {...myFriends,    following:myFollowing}),
    fbSaveFriends(theirUid, {...theirFriends, followers:theirFollowers}),
  ]);
};

const fbUnfollow = async (myUid, theirUid) => {
  const [myFriends, theirFriends] = await Promise.all([fbGetFriends(myUid), fbGetFriends(theirUid)]);
  const myFollowing   = (myFriends.following||[]).filter(u=>u!==theirUid);
  const theirFollowers= (theirFriends.followers||[]).filter(u=>u!==myUid);
  await Promise.all([
    fbSaveFriends(myUid,    {...myFriends,    following:myFollowing}),
    fbSaveFriends(theirUid, {...theirFriends, followers:theirFollowers}),
  ]);
};


// ── Shared race pots — all users contribute and read the same pot ──────────
const fbGetRacePot = async (raceId) => {
  const d = await getDoc(doc(db,"global","racePots"));
  return d.exists() ? (d.data()[raceId] || null) : null;
};
// Atomically add/update a user's bet contribution to the shared pot
const fbContributeToRacePot = async (raceId, uid, betsByHorse, pot, prevPot=0) => {
  const potRef = doc(db,"global","racePots");
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(potRef);
    const allPots = snap.exists() ? snap.data() : {};
    const existing = allPots[raceId] || { totalPot:0, betsPerHorse:{}, contributors:{} };
    // Remove previous contribution from this user
    const prev = existing.contributors[uid] || { pot:0, bets:{} };
    const newBetsPerHorse = {...existing.betsPerHorse};
    Object.entries(prev.bets).forEach(([hid,amt]) => {
      newBetsPerHorse[hid] = Math.max(0, (newBetsPerHorse[hid]||0) - amt);
    });
    // Add new contribution
    Object.entries(betsByHorse).forEach(([hid,amt]) => {
      newBetsPerHorse[hid] = (newBetsPerHorse[hid]||0) + (parseFloat(amt)||0);
    });
    const newTotalPot = (existing.totalPot - (prev.pot||0)) + pot;
    const newContributors = {...existing.contributors, [uid]: {pot, bets:betsByHorse}};
    tx.set(potRef, {
      ...allPots,
      [raceId]: { totalPot: newTotalPot, betsPerHorse: newBetsPerHorse, contributors: newContributors }
    });
  });
};
const fbClearRacePot = async (raceId) => {
  const potRef = doc(db,"global","racePots");
  const snap = await getDoc(potRef);
  if(!snap.exists()) return;
  const data = snap.data();
  delete data[raceId];
  await setDoc(potRef, data);
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TRACK_SPACES   = 12;
const BET_CLOSE_SECS = 30;          // betting closes 30s before race
const BET_OPEN_HOURS = 3;           // betting opens 3 hours before race
const ROLL_INTERVAL    = 3500;  // ms between roll starts — must match cloud function
const DICE_FLASH_DUR   = 600;   // ms dice spin
const DICE_HOLD_DUR    = 900;   // ms dice fully visible and readable
const DICE_FADE_DUR    = 300;   // ms CSS fade (must match transition below)
const HORSE_MOVE_DUR   = 300;   // ms horse slide anim
const NEXT_ROLL_PAUSE  = 250;   // ms after horse lands before dice reappear
const DICE_ANIM        = DICE_FLASH_DUR;
const TIEBREAK_SPACES  = 3;

const HORSES = [
  { id:0, name:"Neon Phantom",   color:"#00f5ff" },
  { id:1, name:"Crimson Blaze",  color:"#ff2d55" },
  { id:2, name:"Golden Thunder", color:"#ffd700" },
  { id:3, name:"Volt Streak",    color:"#39ff14" },
  { id:4, name:"Purple Haze",    color:"#bf5fff" },
  { id:5, name:"Solar Flare",    color:"#ff6b00" },
];

// Get the display name for a horse — race-specific if generated, fallback to default
const horseName  = (race, horseId) => race?.horses?.[horseId] ?? HORSES[horseId].name;
const horseNameLoading = (race, horseId) => !race?.horses?.[horseId];

// Renders horse name or shimmer placeholder while AI generates
function HorseName({ race, horseId, style={}, firstOnly=false }) {
  if(horseNameLoading(race, horseId)) {
    return <span style={{display:"inline-block",width:80,height:11,borderRadius:6,
      background:"linear-gradient(90deg,#ffffff0a 25%,#ffffff22 50%,#ffffff0a 75%)",
      backgroundSize:"400px 100%",
      animation:"nameShimmer 1.2s ease-in-out infinite",
      verticalAlign:"middle",...style}}/>;
  }
  const name = horseName(race, horseId);
  return <span style={style}>{firstOnly ? name.split(" ")[0] : name}</span>;
}
const horseCoat     = (race, horseId) => race?.coats?.[horseId]?.filter ?? "sepia(1) saturate(1.5) hue-rotate(330deg) brightness(0.65)";
const horseCoatName = (race, horseId) => race?.coats?.[horseId]?.name ?? "Bay";
const horseLottieCoat = (race, horseId) => getCoatIndex(race?.id || "default", horseId);

const RACE_TYPES = {
  standard:    { label:"Standard",     icon:"🏇", color:"#00f5ff", dice:2, desc:"2 dice per roll — each die moves a horse. Doubles = bonus move!" },
  down_back:   { label:"Down & Back",  icon:"🔄", color:"#bf5fff", dice:2, desc:"Race out 12 spaces, then race back home. First to return wins!" },
  hurdle:      { label:"Hurdles",      icon:"🚧", color:"#ff6b00", dice:2, desc:"One hurdle in the center — you're blocked until you roll doubles to jump over!" },
  magic_dice:  { label:"Magic Dice",   icon:"✨", color:"#39ff14", dice:2, desc:"Die 1 picks the horse, Die 2 picks the spaces. Race out and back — first home wins!" },
  triple_dice: { label:"Triple Dice",  icon:"🎲", color:"#ff2d55", dice:3, desc:"3 dice rolled each turn — 3 horses move simultaneously. Pure chaos!" },
};

const RACE_NAMES = [
  "Belmont Invitational","Churchill Classic","Saratoga Sprint","Preakness Cup",
  "Ascot Gold Run","Epsom Derby","Dubai Millennium","Kentucky Crown",
  "Arc de Triomphe","Breeders' Showdown","Melbourne Dash","Pegasus Stakes",
  "Santa Anita Gold","Cheltenham Chase","Royal Ascot","Goodwood Festival",
  "Iron Horse Classic","Thunder Ridge Open","Neon City Grand Prix","Crystal Cup",
  "Pacific Rim Stakes","Golden Gate Sprint","Lone Star Derby","Emerald Cup",
  "Midnight Classic","Sunrise Stakes","Thunderdome Open","Apex Invitational",
];


// ─── GENERATIVE RACE NAME SYSTEM ─────────────────────────────────────────────
const RACE_NAME_ADJ = [
  "Golden","Silver","Iron","Crystal","Diamond","Emerald","Sapphire","Ruby","Amber","Crimson",
  "Midnight","Sunset","Sunrise","Thunder","Lightning","Storm","Shadow","Neon","Electric","Blazing",
  "Ancient","Royal","Grand","Imperial","Premier","Supreme","Elite","Classic","Legendary","Eternal",
  "Desert","Arctic","Tropical","Coastal","Mountain","Valley","Canyon","Ridge","Summit","Pacific",
  "Atlantic","Gulf","River","Ocean","Prairie","Highland","Northern","Southern","Eastern","Western",
  "Velvet","Obsidian","Cobalt","Scarlet","Ivory","Onyx","Jade","Pearl","Copper","Bronze",
];
const RACE_NAME_LOC = [
  "Gate","Crown","Cup","Stakes","Park","Downs","Track","Circuit","Oval","Mile",
  "Derby","Meadows","Fields","Pines","Hills","Sands","Coast","Ridge","Glen","Crest",
  "Cross","Point","Pass","Run","Way","Lane","Trail","Course","Chase","Straight",
  "Bend","Turn","Furlong","Stretch","Paddock","Finish","Turf","Rail","Infield","Outfield",
];
const RACE_NAME_EVENT = [
  "Classic","Invitational","Championship","Sprint","Derby","Stakes","Open","Cup","Challenge","Grand Prix",
  "Showdown","Dash","Run","Race","Trophy","Bowl","Series","Festival","Finale","Qualifier",
  "Masters","Premier","Elite","Pro","Open","Invitational","Shootout","Clash","Duel","Rumble",
];

function seededPick(arr, seed, offset) {
  const h = Math.abs(((seed * 2654435761) + (offset * 1234567891)) >>> 0);
  return arr[h % arr.length];
}

function generateRaceName(raceId) {
  const seed = raceId.split("").reduce((a,c,i) => a + c.charCodeAt(0)*(i+17), 0);
  const adj   = seededPick(RACE_NAME_ADJ,   seed, 1);
  const loc   = seededPick(RACE_NAME_LOC,   seed, 2);
  const event = seededPick(RACE_NAME_EVENT, seed, 3);
  return `${adj} ${loc} ${event}`;
}

const HURDLE_CELL  = 5; // 0-indexed center cell — single hurdle at position 6

// ─── TRACK CONDITIONS ─────────────────────────────────────────────────────────
const TRACK_CONDITIONS = {
  sunny: {
    label:"Sunny",      icon:"☀️",  color:"#ffd700",
    desc:"Fast, firm ground. No surprises.",
    bgTint:null, // no tint
    weight:6, // relative frequency — sunny is most common
  },
  rain: {
    label:"Heavy Rain", icon:"🌧️", color:"#5b8dd9",
    desc:"Muddy track — every 3rd roll one die gets swamped and skips.",
    bgTint:"rgba(30,50,90,0.18)",
    weight:2,
  },
  fog: {
    label:"Foggy",      icon:"☁️", color:"#aaaacc",
    desc:"Eerie fog — every 4th roll one die sends its horse the wrong way.",
    bgTint:"rgba(180,180,220,0.10)",
    weight:2,
  },
};

// Weighted random condition picker (magic_dice always sunny)
function pickCondition(raceType, raceId) {
  if(raceType==="magic_dice") return "sunny";
  const seed = raceId.split('').reduce((a,c,i)=>a+c.charCodeAt(0)*(i+11),0);
  const pool = [];
  Object.entries(TRACK_CONDITIONS).forEach(([k,v])=>{ for(let i=0;i<v.weight;i++) pool.push(k); });
  return pool[seed % pool.length];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const rng  = () => Math.floor(Math.random() * 6) + 1;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Seeded RNG — mulberry32. Same seed = same dice sequence every time.
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
const fmt2 = (n,d=2) => n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtTime = d => d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtCD = secs => {
  if(secs<=0) return "Now";
  const t=Math.floor(secs);
  const h=Math.floor(t/3600), m=Math.floor((t%3600)/60), s=t%60;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${s}s`;
  return `${s}s`;
};
// SVG die face with white dots
const DICE_FACE = (n) => {
  const dots = {
    1:[[50,50]],
    2:[[25,25],[75,75]],
    3:[[25,25],[50,50],[75,75]],
    4:[[25,25],[75,25],[25,75],[75,75]],
    5:[[25,25],[75,25],[50,50],[25,75],[75,75]],
    6:[[25,22],[75,22],[25,50],[75,50],[25,78],[75,78]],
  }[n]||[];
  return (
    <svg width="44" height="44" viewBox="0 0 100 100" style={{display:"block"}}>
      {dots.map(([cx,cy],i)=>(
        <circle key={i} cx={cx} cy={cy} r="10" fill="white"/>
      ))}
    </svg>
  );
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
// Legacy sync stubs — kept for compatibility, Firebase is source of truth
const getUsers   = () => { try { return JSON.parse(localStorage.getItem("tt_users")||"{}"); } catch { return {}; } };
const saveUsers  = u  => localStorage.setItem("tt_users", JSON.stringify(u));
const getHistory = () => { try { return JSON.parse(localStorage.getItem("tt_history")||"[]"); } catch { return []; } };
const saveHistory= h  => localStorage.setItem("tt_history", JSON.stringify(h));
// Draft bets (editable pre-confirm): { raceId: { horseId: amount } }
const getPending  = () => { try { return JSON.parse(localStorage.getItem("tt_pending")||"{}"); } catch { return {}; } };
const savePending = p  => localStorage.setItem("tt_pending", JSON.stringify(p));

// Confirmed bets (locked, balance deducted): { raceId: { bets:{horseId:amount}, pot:number } }
const getConfirmed  = () => { try { return JSON.parse(localStorage.getItem("tt_confirmed")||"{}"); } catch { return {}; } };
const saveConfirmed = c  => localStorage.setItem("tt_confirmed", JSON.stringify(c));
const clearConfirmedRace = raceId => { const c=getConfirmed(); delete c[raceId]; saveConfirmed(c); };

// ── Auction storage ────────────────────────────────────────────────────────────
// Auctions are now fully Firestore-backed — these are no-ops kept for safety
const getAuctions  = () => ({});
const saveAuctions = () => {};

// ─── HORSE NAME GENERATOR ────────────────────────────────────────────────────
// Calls Claude API to generate 6 unique funny/creative horse names for a race
// ─── HORSE NAME POOL ──────────────────────────────────────────────────────────
const HORSE_NAME_POOL = [
  // Puns
  "Hay Girl Hay","Stable Genius","Neigh Sayer","Hoof Hearted","Gallop Poll",
  "Sir Prance A Lot","Mane Attraction","Furlong John Silver","Trot Luck",
  "Unbridled Chaos","Canter Believe It","Mare-velous","Saddle Up Buttercup",
  "Pasture Prime","Bit Player","Stirrup Trouble","Bridle Party","Stable Diffusion",
  "Neigh-borhood Watch","Rein Man","Colt Shoulder","Four Legs McGee",
  "Clop Clop Bang Bang","Sir Rides A Lot","Jockey Of All Trades","Foal Play",
  "Mane Event","Hoofin It","Canter Stop Me Now","Whinny The Pooh",
  "Horse Of Course","Hay Fever Dream","Pony Up","Bridle Shower",
  "Furlong Goodbye","Trot Nixon","Mare Force One","Hoof Do You Think You Are",
  "Bit By Bit","Rein Check","Colt Case Scenario","Stirrup Some Trouble",
  // Dramatic
  "Thundering Silence","Midnight Reckoning","Storm Born","Iron Hooves",
  "Shadow Dancer","Crimson Tide Runner","Apex Predator","Obsidian Fury",
  "Lightning Sovereign","Thunder Titan","Storm Chaser","Blaze Of Glory",
  "Dark Sovereign","Phantom Racer","Crimson Storm","Steel Thunder",
  "Night Fury","Volcanic Rage","Arctic Blaze","Inferno King","War Drum",
  "Savage Storm","Eternal Thunder","Blood Moon Runner","Eclipse Warrior",
  "Shadow Titan","Iron Tempest","Golden Sovereign","Midnight Fury",
  "Thunderstruck","Relentless Force","Titan Rising","Scorched Earth",
  "Silent Fury","Apex Thunder","Rogue Wave","Final Thunder",
  // Tech
  "The Algorithm","Dark Web Runner","Final Boss","End Credits","404 Horse Found",
  "Infinite Recursion","Stack Overflow","Runtime Error","Null Pointer","Git Push",
  "WiFi Password","Bluetooth Pony","5G Conspiracy","Incognito Mode","Cookies Accepted",
  "Buffering","Cached Results","Server Down","Pending Approval",
  "Blue Screen","Hard Reboot","Factory Reset","Low Battery","Airplane Mode",
  "Two Factor Auth","Password123","Ctrl Alt Delete","Force Quit","Kernel Panic",
  "Syntax Error","Memory Leak","Sudo Runner","Bitcoin Blaze","Crypto Crash",
  "Cloud Storage","Auto Correct","Spam Filter","Pop Up Blocker","Dark Mode",
  "Do Not Disturb","Unsubscribe","Reply All","Out Of Memory","Disk Full",
  // Absurd
  "I Am A Horse","Definitely Not A Dog","Surprisingly Fast","Unexpected Visitor",
  "Wrong Neighborhood","Send Help","Out Of Office","Left On Read","Technically Legal",
  "No Ragrets","Plot Twist","Hidden Fees","Terms And Conditions","Loading Please Wait",
  "My Other Horse","Just Here For Food","Accidental Winner","Who Let Me In",
  "Not My Problem","Fine Print","Read The Room","Main Character Energy",
  "Side Quest","NPC Runner","Touch Grass","Skill Issue","Vibe Check",
  "Understood The Assignment","Rent Free","That Escalated","Plot Armor",
  "Too Powerful","Final Form","Big Yikes","It Is What It Is",
  // Pop Culture
  "Fast And Furious","Hay-Z","Taylor Trots","Kanye Westerly Wind","Drake Passage",
  "Post Malone-y","Doja Cat Nap","Bad Bunny Hops","Lil Trot Baby","Shrek 5",
  "Dobby Is Free","You Shall Not Pass","Winter Is Coming","That Is No Moon",
  "I Am Iron Horse","Thanos Demands","Groot Trots","Beyonce Gallops",
  "Harry Styles Fast","Billie Eilish Runs","Lil Neigh-Z","Oats McKinnon",
  "Bucephalus Jr","Seabiscuit 2.0","War Horse Emoji","My Little Nightmare",
  "The Mandalorian","Baby Yoda Runs","Stark Raving Fast","Dumbledores Steed",
  "Gandalf The Grey","Frodos Pony","Daenerys Gallops","Jon Snow Trots",
  "Tony Steed","Cap America Runs","Thors Thunder","Han Solo Runner",
  // Mythological
  "Pegasus Jr","Sleipnirs Son","Eponas Chosen","Zeus Thunderhoof",
  "Ares War Steed","Apollo Sun Runner","Hermes Sprinter","Poseidons Fury",
  "Achilles Heel","Odyssey Runner","Troy Burner","Odins Charger",
  "Freyas Mare","Lokis Trick","Valhalla Bound","Ra Sun Steed",
  "Osiris Rising","Atlas Shrugged","Prometheus Fire","Icarus Flew","Midas Touch",
  "Fenrirs Foal","Bifrost Runner","Mjolnir Trots",
  // Food
  "Galloping Gourmet","Nacho Average Horse","Taco Tuesday","Espresso Yourself",
  "Sir Loin Of Beef","Whiskey Business","Rum Runner","Gin And Bear It",
  "Oat Cuisine","Carrot Top Speed","Apple Turnover","Biscuits And Gravy",
  "Sriracha Splash","Wasabi Warrior","Truffle Shuffle","Kombucha Kick",
  "Matcha Maker","Avocado Toast","Gluten Free Gallop","Cold Brew Bullet",
  "Iced Latte Legs","Charcuterie Board","Tiramisu Trots","Cannoli Cannon",
  "Szechuan Blaze","Kimchi Kick","Ramen Racer","Pulled Pork Pace",
  "Brisket Blaze","Hot Sauce Hero",
  // Sports
  "First And Ten","Grand Slam Dunk","Hat Trick Pony","Overtime Hero",
  "Sudden Death","Penalty Kick","Full Court Press","Blitz Attack",
  "Double Bogey","Eagle Scout","Hole In One","Cloud Nine",
  "Buzzer Beater","Slam Dunker","Touch Down","Home Run Hero",
  "Triple Double","Clean Sheet","Corner Kick King","Birdie Putt",
  // Vibes
  "Electric Slide","Velvet Thunder","Disco Inferno","Neon Cowboy","Glitter Cannon",
  "Sparkle Motion","Cosmic Debris","Quantum Entangled","Schrodingers Horse",
  "Higgs Boson","Dark Matter","Event Horizon","Neighing In The Rain",
  "The Dark Horse Knight","Horse With No Name","Old Town Trots",
  "Country Roads Canter","Mr Ed Hardy","Limited Edition","Final Sale",
  "Rear Window","Jurassic Trots","Bridal Party Animal","Jockeys Wild",
  "Velvet Underground","Neon Genesis","Midnight Cowboy","Cosmic Raycer",
  "Astral Projection","Vaporwave Trots","Synthwave Stallion","Lo Fi Legs",
  "Retro Future","Pastel Chaos","Holographic Pony","Laser Show",
];

// Pick 6 unique names from pool using raceId as seed — deterministic per race
function pickHorseNames(raceId) {
  const seed = raceId.split('').reduce((a,c,i)=>a + c.charCodeAt(0)*(i+1), 0);
  const pool = [...HORSE_NAME_POOL];
  // Fisher-Yates shuffle seeded by raceId
  for(let i=pool.length-1;i>0;i--){
    const j = Math.abs(seed*(i+1)*2654435761 >>> 0) % (i+1);
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  return pool.slice(0,6);
}


// ─── AI HORSE NAME GENERATOR ─────────────────────────────────────────────────
// Fires API call per race, updates race.horses when resolved
async function generateAIHorseNames(raceId, onNames) {
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:300,
        system:"You generate creative racehorse names. Always respond with ONLY a valid JSON array of exactly 6 strings. No markdown, no explanation, no backticks. Just the raw JSON array.",
        messages:[{role:"user",content:`Generate 6 racehorse names for race ID "${raceId}". Make each name a COMPLETELY different style — one dramatic/powerful, one funny pun, one pop culture twist, one mythological, one tech/internet reference, one food/drink themed. All 6 should feel totally distinct from each other. Each name 1-4 words. Return ONLY a JSON array of 6 strings.`}]
      })
    });
    const data = await resp.json();
    const raw = data?.content?.[0]?.text?.trim();
    const names = JSON.parse(raw);
    if(Array.isArray(names) && names.length===6 && names.every(n=>typeof n==="string")) {
      onNames(names);
    }
  } catch(e) {
    // silently fall back to static names — no visible error
  }
}

// ─── HORSE COATS ──────────────────────────────────────────────────────────────
const HORSE_COATS = [
  { name:"White",       filter:"brightness(10) saturate(0)" },
  { name:"Light Gray",  filter:"brightness(3) saturate(0)" },
  { name:"Gray",        filter:"brightness(1.8) saturate(0)" },
  { name:"Dark Gray",   filter:"brightness(0.9) saturate(0)" },
  { name:"Black",       filter:"brightness(0.15) saturate(0)" },
  { name:"Chestnut",    filter:"sepia(1) saturate(2) hue-rotate(340deg) brightness(0.85)" },
  { name:"Bay",         filter:"sepia(1) saturate(1.5) hue-rotate(330deg) brightness(0.65)" },
  { name:"Dark Bay",    filter:"sepia(1) saturate(1.2) hue-rotate(325deg) brightness(0.45)" },
  { name:"Palomino",    filter:"sepia(0.8) saturate(2.5) hue-rotate(5deg) brightness(1.4)" },
  { name:"Buckskin",    filter:"sepia(0.6) saturate(2) hue-rotate(15deg) brightness(1.2)" },
  { name:"Sorrel",      filter:"sepia(1) saturate(3) hue-rotate(350deg) brightness(1.0)" },
];

function pickHorseCoats(raceId) {
  const seed = raceId.split('').reduce((a,c,i)=>a + c.charCodeAt(0)*(i+3)*7, 0);
  const pool = [...HORSE_COATS];
  for(let i=pool.length-1;i>0;i--){
    const j = Math.abs(seed*(i+1)*1234567891 >>> 0) % (i+1);
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  return pool.slice(0,6);
}

// ─── SOUND ENGINE ─────────────────────────────────────────────────────────────
// All sounds generated via Web Audio API — no files needed
let _audioCtx = null;
const getAudioCtx = () => {
  if(!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
};

// Global mute stored in localStorage

// ── Background race results storage ──────────────────────────────────────────
const getRaceResults  = () => { try { return JSON.parse(localStorage.getItem("tt_race_results")||"{}"); } catch { return {}; } };
const saveRaceResults = r  => localStorage.setItem("tt_race_results", JSON.stringify(r));
const getSoundEnabled = () => { try { return localStorage.getItem("tt_sound")==="1"; } catch { return false; } };
const setSoundEnabled = (v) => { try { localStorage.setItem("tt_sound", v?"1":"0"); } catch {} };

// ── Global game clock (respects dev 4x speed) ────────────────────────────────
let _gameTimeOffset = 0;
const gameNow = () => Date.now() + _gameTimeOffset;



const playSound = (fn) => {
  if(!getSoundEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if(ctx.state==="suspended") {
      ctx.resume().then(()=>fn(ctx)).catch(()=>{});
    } else {
      fn(ctx);
    }
  } catch(e) {}
};

// Unlock audio context on first user gesture anywhere in the app
const unlockAudio = () => {
  const ctx = getAudioCtx();
  if(ctx.state==="suspended") ctx.resume().catch(()=>{});
};
if(typeof window !== "undefined") {
  ["touchstart","mousedown","keydown"].forEach(evt =>
    window.addEventListener(evt, unlockAudio, {once:true, passive:true})
  );
}

// ── Individual sound effects ──────────────────────────────────────────────────

const sfx = {
  // Rapid click while dice are spinning
  diceRoll: () => playSound(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(180 + Math.random()*80, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.04);
  }),

  // Tick when dice settle and reveal result
  diceSettle: () => playSound(ctx => {
    [0, 0.05, 0.1].forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320 + t*400, ctx.currentTime + t);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.08);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.08);
    });
  }),

  // Short hop sound when a horse moves
  horseMove: (steps=1) => playSound(ctx => {
    Array.from({length:steps}).forEach((_,i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(260 + i*40, ctx.currentTime + i*0.07);
      osc.frequency.exponentialRampToValueAtTime(320 + i*40, ctx.currentTime + i*0.07 + 0.06);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i*0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.07 + 0.09);
      osc.start(ctx.currentTime + i*0.07); osc.stop(ctx.currentTime + i*0.07 + 0.09);
    });
  }),

  // Doubles — rising triumphant chord
  doubles: () => playSound(ctx => {
    [261.6, 329.6, 392, 523.2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i*0.06);
      gain.gain.setValueAtTime(0.14, ctx.currentTime + i*0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.06 + 0.3);
      osc.start(ctx.currentTime + i*0.06); osc.stop(ctx.currentTime + i*0.06 + 0.3);
    });
  }),

  // Hurdle jump — whoosh up + thud down
  hurdleJump: () => playSound(ctx => {
    // whoosh up
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1); gain1.connect(ctx.destination);
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(200, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.25);
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.25);
    // thud landing
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(120, ctx.currentTime + 0.3);
    osc2.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.5);
    gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.3);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc2.start(ctx.currentTime + 0.3); osc2.stop(ctx.currentTime + 0.5);
  }),

  // Horse turns around — descending bwong
  turnAround: () => playSound(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
  }),

  // Race winner fanfare
  win: () => playSound(ctx => {
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    const times  = [0, 0.12, 0.24, 0.36, 0.52, 0.64, 0.76];
    melody.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + times[i]);
      gain.gain.setValueAtTime(0.18, ctx.currentTime + times[i]);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + times[i] + 0.2);
      osc.start(ctx.currentTime + times[i]);
      osc.stop(ctx.currentTime + times[i] + 0.2);
    });
  }),

  // Bet confirmed — soft ascending chime
  betConfirm: () => playSound(ctx => {
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i*0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i*0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.1 + 0.25);
      osc.start(ctx.currentTime + i*0.1); osc.stop(ctx.currentTime + i*0.1 + 0.25);
    });
  }),

  // Countdown beep — pitch rises on final beep
  countdownBeep: (isFinal=false) => playSound(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(isFinal ? 880 : 440, ctx.currentTime);
    gain.gain.setValueAtTime(isFinal ? 0.15 : 0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isFinal ? 0.4 : 0.1));
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + (isFinal ? 0.4 : 0.1));
  }),

  // Error / denied
  error: () => playSound(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
  }),

  // Bank deposit ka-ching
  deposit: () => playSound(ctx => {
    [1047, 1319, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i*0.07);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + i*0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.07 + 0.3);
      osc.start(ctx.currentTime + i*0.07); osc.stop(ctx.currentTime + i*0.07 + 0.3);
    });
  }),

  // Horse crosses the finish line — punchy brass hit + crowd roar
  finishLine: () => playSound(ctx => {
    // Quick ascending brass hit
    [{f:523,t:0,d:0.08},{f:659,t:0.07,d:0.08},{f:784,t:0.14,d:0.08},{f:1047,t:0.21,d:0.35}].forEach(({f,t,d})=>{
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type="sawtooth"; osc.frequency.value=f;
      gain.gain.setValueAtTime(0,ctx.currentTime+t);
      gain.gain.linearRampToValueAtTime(0.2,ctx.currentTime+t+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+d);
      osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+d+0.05);
    });
    // Crowd noise — filtered white noise burst
    const bufSize=ctx.sampleRate*0.6;
    const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<bufSize;i++) data[i]=(Math.random()*2-1)*0.12;
    const noise=ctx.createBufferSource();
    noise.buffer=buf;
    const filter=ctx.createBiquadFilter(); filter.type="bandpass"; filter.frequency.value=800; filter.Q.value=0.5;
    const ngain=ctx.createGain();
    noise.connect(filter); filter.connect(ngain); ngain.connect(ctx.destination);
    ngain.gain.setValueAtTime(0,ctx.currentTime+0.2);
    ngain.gain.linearRampToValueAtTime(0.3,ctx.currentTime+0.3);
    ngain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.8);
    noise.start(ctx.currentTime+0.2); noise.stop(ctx.currentTime+0.85);
  }),

  // Classic "Call to the Post" bugle melody
  oddsSwipe: () => playSound(ctx => {
    const buf = ctx.createBuffer(1, ctx.sampleRate*0.12, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.2);
    const src = ctx.createBufferSource(); src.buffer=buf;
    const lp = ctx.createBiquadFilter(); lp.type="bandpass"; lp.frequency.value=1800; lp.Q.value=0.8;
    const g = ctx.createGain();
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.12);
    src.start(); src.stop(ctx.currentTime+0.14);
  }),

  gunshot: () => playSound(ctx => {
    // Starter blank — classic race gun with reverb tail
    const bufSize = ctx.sampleRate * 0.06;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufSize;i++) data[i] = (Math.random()*2-1) * Math.exp(-i/(bufSize*0.2));
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "peaking"; f.frequency.value = 3000; f.gain.value = 8;
    noise.connect(f); f.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(1.0, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.22);
    noise.start(ctx.currentTime); noise.stop(ctx.currentTime+0.25);
    // Reverb tail
    const bufR = ctx.createBuffer(1, ctx.sampleRate*0.4, ctx.sampleRate);
    const dataR = bufR.getChannelData(0);
    for(let i=0;i<dataR.length;i++) dataR[i] = (Math.random()*2-1) * Math.exp(-i/(ctx.sampleRate*0.08));
    const rev = ctx.createBufferSource();
    rev.buffer = bufR;
    const rg = ctx.createGain();
    rev.connect(rg); rg.connect(ctx.destination);
    rg.gain.setValueAtTime(0.15, ctx.currentTime+0.05);
    rg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.4);
    rev.start(ctx.currentTime+0.05); rev.stop(ctx.currentTime+0.45);
  }),

  bugle: () => playSound(ctx => {
    const notes = [
      {f:392,t:0.00,d:0.14},{f:523,t:0.15,d:0.14},{f:659,t:0.30,d:0.14},
      {f:784,t:0.45,d:0.22},{f:784,t:0.69,d:0.09},{f:659,t:0.80,d:0.09},
      {f:784,t:0.91,d:0.30},{f:880,t:1.23,d:0.14},{f:784,t:1.39,d:0.14},
      {f:659,t:1.55,d:0.14},{f:523,t:1.71,d:0.14},{f:659,t:1.87,d:0.22},
      {f:784,t:2.11,d:0.09},{f:659,t:2.22,d:0.09},{f:523,t:2.33,d:0.14},
      {f:392,t:2.49,d:0.14},{f:523,t:2.65,d:0.50},
    ];
    notes.forEach(({f,t,d})=>{
      [1,2,3,4,5,6].forEach((h,i)=>{
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        const dist = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for(let j=0;j<256;j++){ const x=j*2/256-1; curve[j]=x*(1+0.3*Math.abs(x)); }
        dist.curve = curve;
        osc.connect(dist); dist.connect(g); g.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.value = f * h;
        const w = [1,0.55,0.38,0.22,0.12,0.07][i] * 0.15;
        g.gain.setValueAtTime(0, ctx.currentTime+t);
        g.gain.linearRampToValueAtTime(w*1.4, ctx.currentTime+t+0.008);
        g.gain.linearRampToValueAtTime(w, ctx.currentTime+t+0.04);
        g.gain.setValueAtTime(w, ctx.currentTime+t+d-0.04);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime+t+d);
        osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+d+0.05);
      });
    });
  }),
};

// Profile: { bio, avatar (emoji), joinedDate }
const getProfile  = (u) => { try { return JSON.parse(localStorage.getItem(`tt_profile_${u}`)||"{}"); } catch { return {}; } };
const saveProfile = (u,p) => localStorage.setItem(`tt_profile_${u}`, JSON.stringify(p));

// Private races: { [code]: { code, name, hostUsername, horses:[6 names], created, started, startedAt, finished, winner, members:{username:{bets:{},confirmed}}, raceType } }
const getPrivateRaces  = () => { try { return JSON.parse(localStorage.getItem("tt_private_races")||"{}"); } catch { return {}; } };
const savePrivateRaces = (r) => localStorage.setItem("tt_private_races", JSON.stringify(r));

// Bank transactions: [{ type:"deposit"|"withdraw", amount, balance, ts }]
const getBankTx  = (u) => { try { return JSON.parse(localStorage.getItem(`tt_bank_${u}`)||"[]"); } catch { return []; } };
const saveBankTx = (u,txs) => localStorage.setItem(`tt_bank_${u}`, JSON.stringify(txs));
const addBankTx  = (u, type, amount, newBalance) => {
  const txs = getBankTx(u);
  txs.unshift({ type, amount, balance: newBalance, ts: Date.now() });
  saveBankTx(u, txs.slice(0, 100)); // keep last 100
};

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────
function generateSchedule() {
  const types = Object.keys(RACE_TYPES);
  const now   = Date.now();
  const races  = [];
  // Dense schedule: 3-8 races per hour, staggered irregularly
  let cursor = now + 4*60*1000; // first race 4 min from now
  for(let i=0; i<32; i++){
    const type = types[i % types.length];
    const raceId = `r${i}_${now}`;
    const condition = pickCondition(type, raceId);
    races.push({
      id:        raceId,
      name:      generateRaceName(raceId),
      type,
      condition,
      startTime: cursor,
      status:    "upcoming",
      horses:    pickHorseNames(raceId),
      coats:     pickHorseCoats(raceId),
      seed:      Math.floor(Math.random() * 2147483647) + 1,
    });
    cursor += (1 + Math.floor(Math.random()*5)) * 60*1000;
  }
  return races;
}

function generateAuctionSchedule() {
  const types = Object.keys(RACE_TYPES);
  const now   = Date.now();
  const races  = [];
  // First auction race starts 5 min from now
  let cursor = now + 5*60*1000;
  for(let i=0; i<32; i++){
    const type = types[i % types.length];
    const raceId = `a${i}_${now}`;
    const condition = pickCondition(type, raceId);
    // Randomize horse auction order
    const horseOrder = [...Array(6).keys()].sort(()=>Math.random()-0.5);
    races.push({
      id:        raceId,
      name:      generateRaceName(raceId),
      type,
      condition,
      startTime: cursor,
      status:    "upcoming",
      horses:    pickHorseNames(raceId),
      coats:     pickHorseCoats(raceId),
      isAuction: true,
      horseOrder,
      seed:      Math.floor(Math.random() * 2147483647) + 1,
    });
    cursor += (1 + Math.floor(Math.random()*5)) * 60*1000;
  }
  return races;
}

function raceStatus(race, now) {
  const secsToStart = (race.startTime - now) / 1000;
  if(race.status==="finished") return "finished";
  // Auto-finish: max race = 60 rolls * 3.5s + 40s buffer = 250s after fire time
  const fireTime = race.isAuction ? race.startTime + 30000 : race.startTime;
  if(now > fireTime + 250000) return "finished";
  if(secsToStart <= 0)                    return "racing";
  if(secsToStart <= BET_CLOSE_SECS)       return "locked";
  if(secsToStart <= BET_OPEN_HOURS*3600)  return "betting";
  return "upcoming";
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=Orbitron:wght@700;900&display=swap');
  @keyframes tieFlash {
    0%   { opacity:0; transform:scale(0.8); }
    15%  { opacity:1; transform:scale(1.08); }
    30%  { transform:scale(0.97); }
    45%  { transform:scale(1.04); }
    60%  { transform:scale(1); }
    80%  { opacity:1; }
    100% { opacity:0; transform:scale(1.1); }
  }
  @keyframes tieShake {
    0%,100% { transform:translateX(0); }
    15%     { transform:translateX(-6px); }
    30%     { transform:translateX(6px); }
    45%     { transform:translateX(-4px); }
    60%     { transform:translateX(4px); }
    75%     { transform:translateX(-2px); }
    90%     { transform:translateX(2px); }
  }
  @keyframes oddsSwipeAcross {
    0%   { transform: translateX(110%); opacity: 0; }
    25%  { transform: translateX(0%); opacity: 1; }
    75%  { transform: translateX(0%); opacity: 1; }
    100% { transform: translateX(0%); opacity: 1; }
  }
  @keyframes oddsDropDown {
    0%   { max-height: 0; opacity: 0; transform: scaleY(0.85); }
    100% { max-height: 80px; opacity: 1; transform: scaleY(1); }
  }
  @keyframes gateBurst {
    0%   { transform: scaleX(-1) translateX(0px) rotate(0deg); }
    15%  { transform: scaleX(-1) translateX(-4px) rotate(-8deg); }
    30%  { transform: scaleX(-1) translateX(6px) rotate(6deg); }
    50%  { transform: scaleX(-1) translateX(-3px) rotate(-4deg); }
    70%  { transform: scaleX(-1) translateX(4px) rotate(3deg); }
    85%  { transform: scaleX(-1) translateX(-2px) rotate(-1deg); }
    100% { transform: scaleX(-1) translateX(0px) rotate(0deg); }
  }
  @keyframes gateBurstPortrait {
    0%   { transform: translateY(0px) rotate(0deg); }
    15%  { transform: translateY(4px) rotate(-8deg); }
    30%  { transform: translateY(-6px) rotate(6deg); }
    50%  { transform: translateY(3px) rotate(-4deg); }
    70%  { transform: translateY(-4px) rotate(3deg); }
    85%  { transform: translateY(2px) rotate(-1deg); }
    100% { transform: translateY(0px) rotate(0deg); }
  }
  @keyframes slideHorse {
    0%   { transform: scaleX(-1) translateX(8px); }
    100% { transform: scaleX(-1) translateX(0px); }
  }
  @keyframes slideHorseReturn {
    0%   { transform: translateX(-8px); }
    100% { transform: translateX(0px); }
  }
  @keyframes speedLine {
    0%   { transform: translateX(-100%); opacity: 0; }
    20%  { opacity: 0.7; }
    100% { transform: translateX(300%); opacity: 0; }
  }
  @keyframes speedLine2 {
    0%   { transform: translateX(-100%); opacity: 0; }
    30%  { opacity: 0.5; }
    100% { transform: translateX(400%); opacity: 0; }
  }
  @keyframes speedLineUp {
    0%   { transform: translateY(100%); opacity: 0; }
    20%  { opacity: 0.7; }
    100% { transform: translateY(-300%); opacity: 0; }
  }
  @keyframes speedLineUp2 {
    0%   { transform: translateY(100%); opacity: 0; }
    30%  { opacity: 0.5; }
    100% { transform: translateY(-400%); opacity: 0; }
  }
  @keyframes flameA {
    0%,100% { transform: scaleX(1)    scaleY(1)    translateY(0px);  opacity: 0.9; }
    33%     { transform: scaleX(0.85) scaleY(1.12) translateY(-3px); opacity: 1; }
    66%     { transform: scaleX(1.1)  scaleY(0.95) translateY(2px);  opacity: 0.8; }
  }
  @keyframes flameB {
    0%,100% { transform: scaleX(1)    scaleY(1)    translateY(0px);  opacity: 0.7; }
    40%     { transform: scaleX(0.8)  scaleY(1.18) translateY(-5px); opacity: 1; }
    70%     { transform: scaleX(1.15) scaleY(0.9)  translateY(3px);  opacity: 0.6; }
  }
  @keyframes flameC {
    0%,100% { transform: scaleX(1)   scaleY(1)    translateY(0px);  opacity: 0.5; }
    50%     { transform: scaleX(0.9) scaleY(1.25) translateY(-6px); opacity: 0.85; }
  }
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { background:#08081a; overflow-x:hidden; font-family:'Rajdhani','Segoe UI',sans-serif; }
  ::-webkit-scrollbar { width:6px; background:#0a0a22; }
  ::-webkit-scrollbar-thumb { background:#00f5ff33; border-radius:3px; }
  input { font-family:inherit; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
  @keyframes confettiFall { 0%{transform:translateY(0) rotate(0deg);opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:0} }
  @keyframes racingBlink  { 0%,100%{opacity:1} 50%{opacity:0.5} }
  @keyframes diceWiggle   { 0%,100%{transform:rotate(-15deg) scale(1.08)} 50%{transform:rotate(15deg) scale(0.93)} }
  @keyframes nameShimmer  { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
  @keyframes betPulse     { 0%,100%{box-shadow:var(--bet-glow)} 50%{box-shadow:var(--bet-glow-bright)} }
  @keyframes winPulse     { 0%,100%{opacity:0.8;transform:scale(1)} 50%{opacity:1;transform:scale(1.06)} }
  @keyframes hurdlePulse  { 0%,100%{opacity:0.4} 50%{opacity:0.9} }
  @keyframes hurdleJump   { 0%{transform:translateY(0) scaleX(-1)} 25%{transform:translateY(-18px) scaleX(-1)} 50%{transform:translateY(-22px) scaleX(-1)} 75%{transform:translateY(-6px) scaleX(-1)} 100%{transform:translateY(0) scaleX(-1)} }
  @keyframes mudSplat     { 0%{transform:scale(1) rotate(0deg);opacity:1} 40%{transform:scale(1.4) rotate(-8deg);opacity:0.8} 100%{transform:scale(0.9) rotate(4deg);opacity:0.5} }
  @keyframes fogDrift     { 0%{opacity:0;transform:translateX(-4px)} 30%{opacity:1} 70%{opacity:0.8} 100%{opacity:0;transform:translateX(6px)} }
  @keyframes slideBack    { 0%{transform:scaleX(-1) translateX(0)} 40%{transform:scaleX(-1) translateX(12px)} 100%{transform:scaleX(-1) translateX(0)} }
  @keyframes rainDrop     { 0%{opacity:0;transform:translateY(-8px)} 50%{opacity:0.7} 100%{opacity:0;transform:translateY(8px)} }
  @keyframes fogPulse     { 0%,100%{opacity:0.15} 50%{opacity:0.35} }
  @keyframes slideIn      { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
`;

// ─── CONFETTI ─────────────────────────────────────────────────────────────────
function Confetti() {
  const pieces = useMemo(()=>Array.from({length:80},(_,i)=>({
    id:i, x:Math.random()*100, delay:Math.random()*2.5, dur:2+Math.random()*3,
    color:["#00f5ff","#39ff14","#ffd700","#ff2d55","#bf5fff","#ff6b00"][i%6],
    size:6+Math.random()*12,
  })),[]);
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {pieces.map(p=>(
        <div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:"-20px",width:p.size,height:p.size,background:p.color,borderRadius:p.id%3===0?"50%":"2px",animation:`confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,boxShadow:`0 0 6px ${p.color}`}}/>
      ))}
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode,setMode]=useState("login");
  const [username,setUsername]=useState("");
  const [email,setEmail]=useState("");
  const [p,setP]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);

  const go=async()=>{
    setErr(""); setLoading(true);
    if(!email.trim()||!p.trim()||(mode==="register"&&!username.trim())){
      setErr("Fill in all fields."); setLoading(false); return;
    }
    try {
      if(mode==="register"){
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), p);
        const uid = cred.user.uid;
        await fbSaveUser(uid, { username: username.trim(), email: email.trim(), balance: 1000, joined: Date.now() });
        await fbSaveUserIndex(username.trim(), uid, "🏇", 1000);
        onLogin({ uid, username: username.trim(), balance: 1000, email: email.trim() });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), p);
        const uid = cred.user.uid;
        const userData = await fbGetUser(uid);
        if(!userData){ setErr("Account not found."); setLoading(false); return; }
        onLogin({ uid, username: userData.username, balance: userData.balance, email: email.trim() });
      }
    } catch(e) {
      console.error("Firebase auth error:", e.code, e.message);
      const msg = e.code==="auth/email-already-in-use" ? "Email already registered."
        : e.code==="auth/wrong-password"||e.code==="auth/invalid-credential" ? "Invalid email or password."
        : e.code==="auth/user-not-found" ? "No account with that email."
        : e.code==="auth/weak-password" ? "Password must be at least 6 characters."
        : e.code==="auth/invalid-email" ? "Invalid email address."
        : e.code==="auth/unauthorized-domain" ? "Domain not authorized. Check Firebase settings."
        : e.code==="auth/operation-not-allowed" ? "Email auth not enabled in Firebase."
        : e.code==="auth/network-request-failed" ? "Network error. Check connection."
        : `Error: ${e.code}`;
      setErr(msg);
    }
    setLoading(false);
  };
  return (
    <div style={{minHeight:"100vh",background:"#08081a",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{GS}</style>
      <div style={{width:"100%",maxWidth:420,background:"rgba(255,255,255,0.03)",border:"1px solid #00f5ff33",borderRadius:16,padding:"40px 32px",boxShadow:"0 0 80px #00f5ff0a"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:54}}>🏇</div>
          <h1 style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:34,letterSpacing:5,textShadow:"0 0 24px #00f5ff",marginTop:6}}>THE TRACK</h1>
          <p style={{color:"#ffffff33",fontSize:12,marginTop:6,letterSpacing:3}}>VIRTUAL HORSE RACING</p>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          {["login","register"].map(m=>(
            <button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,padding:"10px",borderRadius:8,border:"none",cursor:"pointer",background:mode===m?"#00f5ff":"rgba(255,255,255,0.04)",color:mode===m?"#08081a":"#ffffff55",fontWeight:700,fontSize:13,letterSpacing:2,textTransform:"uppercase",transition:"all 0.2s"}}>{m==="login"?"Sign In":"Register"}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {mode==="register" && (
            <div>
              <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2,textTransform:"uppercase"}}>Username</label>
              <input type="text" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}
                style={{width:"100%",marginTop:4,padding:"12px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid #ffffff1a",borderRadius:8,color:"#fff",fontSize:16,outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#00f5ff"} onBlur={e=>e.target.style.borderColor="#ffffff1a"}/>
            </div>
          )}
          <div>
            <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2,textTransform:"uppercase"}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}
              style={{width:"100%",marginTop:4,padding:"12px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid #ffffff1a",borderRadius:8,color:"#fff",fontSize:16,outline:"none"}}
              onFocus={e=>e.target.style.borderColor="#00f5ff"} onBlur={e=>e.target.style.borderColor="#ffffff1a"}/>
          </div>
          <div>
            <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2,textTransform:"uppercase"}}>Password</label>
            <input type="password" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}
              style={{width:"100%",marginTop:4,padding:"12px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid #ffffff1a",borderRadius:8,color:"#fff",fontSize:16,outline:"none"}}
              onFocus={e=>e.target.style.borderColor="#00f5ff"} onBlur={e=>e.target.style.borderColor="#ffffff1a"}/>
          </div>
        </div>
        {err&&<p style={{color:"#ff2d55",marginTop:10,fontSize:13,textAlign:"center"}}>{err}</p>}
        <button onClick={go} disabled={loading} style={{width:"100%",marginTop:20,padding:"14px",borderRadius:10,border:"none",cursor:loading?"not-allowed":"pointer",background:"linear-gradient(135deg,#00f5ff,#0080ff)",color:"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:14,letterSpacing:3,boxShadow:"0 0 24px #00f5ff44",opacity:loading?0.7:1}}>
          {loading?"...":(mode==="login"?"Enter The Track":"Create Account")}
        </button>
        <p style={{color:"#ffffff22",fontSize:11,textAlign:"center",marginTop:12,letterSpacing:1}}>New accounts start with $1,000 demo currency</p>
      </div>
    </div>
  );
}



// ─── PROFILE PANEL ────────────────────────────────────────────────────────────
const AVATAR_OPTIONS = ["🏇","🐴","🏆","🎲","⚡","🔥","💎","👑","🦅","🐉","🌟","💀","🎯","🏅","🤑","🦁","🐎","🌊","⚔️","🎪"];


// ─── USER PROFILE MODAL (view another user's profile) ────────────────────────
function UserProfileModal({ uid, username, myUid, schedule, auctionSchedule, now, onClose, onGoToRace }) {
  const [userData,    setUserData]    = useState(null);
  const [friendsData, setFriendsData] = useState(null);
  const [myFriends,   setMyFriends]   = useState(null);
  const [activeBets,  setActiveBets]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [acting,      setActing]      = useState(false);

  useEffect(()=>{
    if(!uid) return;
    const load = async () => {
      try {
        const [userData, friends, mine] = await Promise.all([
          fbGetUserByUid(uid),
          fbGetFriends(uid),
          fbGetFriends(myUid),
        ]);
        setUserData(userData);
        setFriendsData(friends);
        setMyFriends(mine);

        // Load confirmed bets separately — may fail due to permissions
        let confirmed = {};
        try { confirmed = await fbGetConfirmedForUser(uid); } catch(e) {
          console.warn("Could not read bets for", uid, e);
        }

        console.log("Confirmed bets for", uid, ":", Object.keys(confirmed));
        console.log("Schedule IDs (first 5):", schedule.slice(0,5).map(r=>r.id));

        const safeSchedule = schedule || [];
        const safeAuction  = auctionSchedule || [];
        const bets = Object.entries(confirmed).map(([raceId, data])=>{
          const race = safeSchedule.find(r=>r.id===raceId) || safeAuction.find(r=>r.id===raceId);
          if(!race) {
            console.log("Race not found in schedule:", raceId);
            // Still show it even if not in schedule — create a minimal race object
            return null;
          }
          const st = raceStatus(race, now);
          console.log("Race", raceId, "status:", st);
          if(st==="finished") return null;
          return { race, st };
        }).filter(Boolean).sort((a,b)=>a.race.startTime-b.race.startTime);
        setActiveBets(bets);
      } catch(e) {
        console.error("UserProfileModal load error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  },[uid]);

  const isFollowing = myFriends?.following?.includes(uid);
  const followerCount = friendsData?.followers?.length || 0;
  const followingCount = friendsData?.following?.length || 0;

  const handleFollow = async () => {
    setActing(true);
    if(isFollowing) {
      await fbUnfollow(myUid, uid);
      setMyFriends(f=>({...f, following:(f.following||[]).filter(u=>u!==uid)}));
      setFriendsData(f=>({...f, followers:(f.followers||[]).filter(u=>u!==myUid)}));
    } else {
      await fbFollow(myUid, uid);
      setMyFriends(f=>({...f, following:[...(f.following||[]),uid]}));
      setFriendsData(f=>({...f, followers:[...(f.followers||[]),myUid]}));
    }
    setActing(false);
  };

  const avatar = userData?.avatar || "🏇";
  const bio    = userData?.bio || "";

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:420,background:"#0d0d1f",border:"1px solid rgba(0,245,255,0.15)",borderRadius:20,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.8)",animation:"slideIn 0.15s ease-out"}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:"20px 20px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:56,height:56,borderRadius:14,background:"rgba(0,245,255,0.08)",border:"2px solid #00f5ff33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30}}>{avatar}</div>
              <div>
                <div style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:16,letterSpacing:2}}>{username}</div>
                <div style={{display:"flex",gap:16,marginTop:4}}>
                  <span style={{color:"#ffffff55",fontSize:11}}><span style={{color:"#fff",fontWeight:700}}>{followerCount}</span> followers</span>
                  <span style={{color:"#ffffff55",fontSize:11}}><span style={{color:"#fff",fontWeight:700}}>{followingCount}</span> following</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#ffffff66",cursor:"pointer",width:32,height:32,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          {uid !== myUid && (
            <button onClick={handleFollow} disabled={acting} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",cursor:acting?"not-allowed":"pointer",background:isFollowing?"rgba(255,255,255,0.07)":"rgba(0,245,255,0.15)",color:isFollowing?"#ffffff88":"#00f5ff",fontFamily:"'Orbitron',monospace",fontSize:12,letterSpacing:2,fontWeight:700,transition:"all 0.15s"}}>
              {acting?"...":(isFollowing?"✓ FOLLOWING":"+ FOLLOW")}
            </button>
          )}
        </div>

        {/* Bio */}
        {bio && (
          <div style={{padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
            <p style={{color:"#ffffffbb",fontSize:13,lineHeight:1.5,margin:0}}>{bio}</p>
          </div>
        )}

        {/* Active Bets */}
        <div style={{padding:"16px 20px 20px",maxHeight:"50vh",overflowY:"auto"}}>
          <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:12}}>ACTIVE RACES</div>
          {loading && <div style={{color:"#ffffff33",textAlign:"center",padding:20}}>Loading...</div>}
          {!loading && activeBets.length===0 && <div style={{color:"#ffffff33",textAlign:"center",padding:20,fontSize:13}}>No active bets right now</div>}
          {activeBets.map(({race,st})=>{
            const rt = RACE_TYPES[race.type];
            const secs = Math.floor((race.startTime-now)/1000);
            return (
              <div key={race.id} onClick={()=>{onClose();onGoToRace(race);}} style={{marginBottom:8,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:`1px solid ${rt.color}33`,borderRadius:10,cursor:"pointer",transition:"all 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{color:"#fff",fontWeight:700,fontSize:13}}>{rt.icon} {race.name}</div>
                    <div style={{color:rt.color,fontSize:11,marginTop:2}}>{rt.label}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {st==="racing" && <div style={{color:"#ff2d55",fontSize:11,fontFamily:"'Orbitron',monospace",animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                    {st==="locked" && <div style={{color:"#ffd700",fontSize:11,fontFamily:"'Orbitron',monospace"}}>LOCKED 🔒</div>}
                    {st==="betting"&& <div style={{color:"#39ff14",fontSize:11,fontFamily:"'Orbitron',monospace"}}>{fmtCD(secs)}</div>}
                    <div style={{color:"#00f5ff66",fontSize:10,marginTop:2}}>tap to view →</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── FRIENDS TAB (inside ProfilePanel) ────────────────────────────────────────
function FriendsTab({ user, schedule, auctionSchedule, now, onGoToRace, onClose }) {
  const [myFriends,   setMyFriends]   = useState(null);
  const [searchQ,     setSearchQ]     = useState("");
  const [searchResult,setSearchResult]= useState(null); // null|"loading"|"notfound"|{uid,username,avatar}
  const [viewProfile, setViewProfile] = useState(null); // {uid,username}
  const [followingDetails, setFollowingDetails] = useState([]); // [{uid,username,avatar,activeBetCount}]
  const [loadingFollowing, setLoadingFollowing] = useState(false);

  useEffect(()=>{
    if(!user?.uid) return;
    fbGetFriends(user.uid).then(async f => {
      setMyFriends(f);
      if((f.following||[]).length > 0) {
        setLoadingFollowing(true);
        const details = await Promise.all((f.following||[]).map(async uid => {
          const udata = await fbGetUserByUid(uid);
          if(!udata) return null;
          let activeBetCount = 0;
          try {
            const confirmed = await fbGetConfirmedForUser(uid);
            activeBetCount = Object.entries(confirmed).filter(([raceId])=>{
              const race = schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
              if(!race) return false;
              return raceStatus(race,now) !== "finished";
            }).length;
          } catch(e) { /* bets unreadable — still show user */ }
          return { uid, username:udata.username, avatar:udata.avatar||"🏇", bio:udata.bio||"", activeBetCount };
        }));
        setFollowingDetails(details.filter(Boolean));
        setLoadingFollowing(false);
      }
    });
  },[user?.uid]);

  const handleSearch = async () => {
    if(!searchQ.trim()) return;
    setSearchResult("loading");
    const found = await fbGetUserIndex(searchQ.trim());
    if(!found || found.uid === user.uid) { setSearchResult("notfound"); return; }
    // Get their avatar from users collection
    const udata = await fbGetUserByUid(found.uid);
    setSearchResult({ uid:found.uid, username:found.username, avatar:udata?.avatar||"🏇" });
  };

  const handleUnfollow = async (uid) => {
    await fbUnfollow(user.uid, uid);
    setMyFriends(f=>({...f, following:(f.following||[]).filter(u=>u!==uid)}));
    setFollowingDetails(d=>d.filter(u=>u.uid!==uid));
  };

  const followerCount  = myFriends?.followers?.length  || 0;
  const followingCount = myFriends?.following?.length || 0;

  return (
    <div>
      {/* Stats row */}
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        <div style={{flex:1,padding:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,textAlign:"center"}}>
          <div style={{color:"#ffffff33",fontSize:10,letterSpacing:1,marginBottom:4}}>FOLLOWING</div>
          <div style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:22,fontWeight:700}}>{followingCount}</div>
        </div>
        <div style={{flex:1,padding:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,textAlign:"center"}}>
          <div style={{color:"#ffffff33",fontSize:10,letterSpacing:1,marginBottom:4}}>FOLLOWERS</div>
          <div style={{fontFamily:"'Orbitron',monospace",color:"#bf5fff",fontSize:22,fontWeight:700}}>{followerCount}</div>
        </div>
      </div>

      {/* Search */}
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:8}}>FIND PLAYERS</div>
        <div style={{display:"flex",gap:6}}>
          <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setSearchResult(null);}}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
            placeholder="Search by username..."
            style={{flex:1,padding:"9px 12px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#fff",fontSize:13,outline:"none"}}/>
          <button onClick={handleSearch} style={{padding:"9px 16px",background:"rgba(0,245,255,0.1)",border:"1px solid #00f5ff33",borderRadius:8,color:"#00f5ff",cursor:"pointer",fontSize:13,fontWeight:700}}>Search</button>
        </div>
        {searchResult==="loading" && <div style={{color:"#ffffff44",fontSize:12,marginTop:8}}>Searching...</div>}
        {searchResult==="notfound" && <div style={{color:"#ff2d5588",fontSize:12,marginTop:8}}>No player found with that username</div>}
        {searchResult && searchResult !== "loading" && searchResult !== "notfound" && (
          <div style={{marginTop:10,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid #00f5ff22",borderRadius:10,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>{searchResult.avatar}</span>
            <span style={{color:"#fff",fontWeight:700,flex:1,fontSize:14}}>{searchResult.username}</span>
            <button onClick={()=>setViewProfile({uid:searchResult.uid,username:searchResult.username})} style={{padding:"6px 12px",background:"rgba(0,245,255,0.08)",border:"1px solid #00f5ff33",borderRadius:7,color:"#00f5ff",cursor:"pointer",fontSize:12}}>View</button>
          </div>
        )}
      </div>

      {/* Following list */}
      <div>
        <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:8}}>FOLLOWING</div>
        {myFriends===null && <div style={{color:"#ffffff33",fontSize:13,textAlign:"center",padding:20}}>Loading...</div>}
        {myFriends!==null && followingCount===0 && <div style={{color:"#ffffff33",fontSize:13,textAlign:"center",padding:"20px 0"}}>Not following anyone yet. Search for players above.</div>}
        {loadingFollowing && <div style={{color:"#ffffff44",fontSize:12,textAlign:"center",padding:"16px 0"}}>Loading followers...</div>}
        {followingDetails.map(f=>(
          <div key={f.uid} onClick={()=>setViewProfile({uid:f.uid,username:f.username})}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,marginBottom:8,cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
            <div style={{width:44,height:44,borderRadius:12,background:"rgba(0,245,255,0.08)",border:"2px solid #00f5ff22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{f.avatar}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{f.username}</div>
              {f.activeBetCount>0
                ? <div style={{color:"#39ff14",fontSize:12,marginTop:2}}>🎫 {f.activeBetCount} active bet{f.activeBetCount>1?"s":""} · tap to view</div>
                : <div style={{color:"#ffffff33",fontSize:12,marginTop:2}}>No active bets</div>
              }
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
              <button onClick={e=>{e.stopPropagation();setViewProfile({uid:f.uid,username:f.username});}} style={{padding:"5px 12px",background:"rgba(0,245,255,0.08)",border:"1px solid #00f5ff33",borderRadius:7,color:"#00f5ff",cursor:"pointer",fontSize:11,fontWeight:700}}>View →</button>
              <button onClick={e=>{e.stopPropagation();handleUnfollow(f.uid);}} style={{padding:"5px 12px",background:"rgba(255,45,85,0.06)",border:"1px solid #ff2d5522",borderRadius:7,color:"#ff2d5566",cursor:"pointer",fontSize:11}}>Unfollow</button>
            </div>
          </div>
        ))}
      </div>

      {viewProfile && (
        <UserProfileModal
          uid={viewProfile.uid}
          username={viewProfile.username}
          myUid={user.uid}
          schedule={schedule}
          auctionSchedule={auctionSchedule}
          now={now}
          onClose={()=>setViewProfile(null)}
          onGoToRace={(race)=>{ setViewProfile(null); onClose(); onGoToRace(race); }}
        />
      )}
    </div>
  );
}

function ProfilePanel({ user, schedule, auctionSchedule, now, onClose, onGoToRace, onBalanceChange }) {
  const [profile, setProfile] = useState(()=>getProfile(user.username));
  const [editBio,  setEditBio]  = useState(false);
  const [bioText,  setBioText]  = useState(profile.bio||"");
  const [tab,      setTab]      = useState("stats");
  const [showProfileReplay, setShowProfileReplay] = useState(null);
  const hist = getHistory().filter(h=>h.user===user.username);
  const totalRaces=hist.length, wins=hist.filter(h=>h.won).length;
  const totalWagered=hist.reduce((s,h)=>s+h.amount,0);
  const totalWon=hist.filter(h=>h.won).reduce((s,h)=>s+h.payout,0);
  const netPnL=totalWon-totalWagered;
  const winRate=totalRaces>0?((wins/totalRaces)*100).toFixed(1):0;
  const bestWin=hist.filter(h=>h.won).reduce((b,h)=>h.payout>b?h.payout:b,0);
  const confirmedAll=getConfirmed();
  const activeBets=Object.entries(confirmedAll).map(([raceId,data])=>{
    const race=schedule.find(r=>r.id===raceId); if(!race) return null;
    const st=raceStatus(race,now); if(st==="finished") return null;
    return {race,data,st};
  }).filter(Boolean).sort((a,b)=>a.race.startTime-b.race.startTime);

  const saveAvatar=(av)=>{ const p={...profile,avatar:av}; setProfile(p); saveProfile(user.username,p); setTab("stats"); fbSaveUser(user.uid,{avatar:av}); fbSaveUserIndex(user.username, user.uid, av, user.balance); };
  const saveBio=()=>{ const p={...profile,bio:bioText}; setProfile(p); saveProfile(user.username,p); setEditBio(false); fbSaveUser(user.uid,{bio:bioText}); };
  const tabS=(id,lbl,icon)=>(
    <button onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",borderRadius:7,border:"none",cursor:"pointer",
      background:tab===id?"#00f5ff":"rgba(255,255,255,0.05)",color:tab===id?"#08081a":"#ffffff55",
      fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:10,letterSpacing:1,transition:"all 0.2s"
    }}>{icon} {lbl}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(8,8,26,0.97)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflowY:"auto"}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:580,background:"rgba(10,10,30,0.99)",border:"1px solid #00f5ff22",borderRadius:20,padding:28,maxHeight:"90vh",overflow:"auto",animation:"slideIn 0.2s ease-out"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <button onClick={()=>setTab("avatar")} style={{width:64,height:64,borderRadius:16,background:"rgba(0,245,255,0.08)",border:"2px solid #00f5ff33",fontSize:34,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} title="Change avatar">
              {profile.avatar||"🏇"}
            </button>
            <div>
              <h2 style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:20,letterSpacing:2}}>{user.username}</h2>
              <div style={{color:"#ffffff33",fontSize:11,marginTop:2}}>Member since {new Date(user?.joined||Date.now()).toLocaleDateString()}</div>
              <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:13,marginTop:3}}>${fmt2(user.balance)}</div>
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#ffffff44",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{marginBottom:20,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10}}>
          {editBio?(
            <div>
              <textarea value={bioText} onChange={e=>setBioText(e.target.value)} maxLength={160} rows={3}
                style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid #00f5ff33",borderRadius:7,color:"#fff",fontSize:16,padding:"8px 10px",outline:"none",resize:"none",fontFamily:"inherit"}}
                placeholder="Write something about yourself..."/>
              <div style={{display:"flex",gap:8,marginTop:6,justifyContent:"flex-end"}}>
                <button onClick={()=>{setEditBio(false);setBioText(profile.bio||"");}} style={{padding:"5px 14px",borderRadius:6,border:"1px solid #ffffff22",background:"transparent",color:"#ffffff55",cursor:"pointer",fontSize:12}}>Cancel</button>
                <button onClick={saveBio} style={{padding:"5px 14px",borderRadius:6,border:"none",background:"#00f5ff",color:"#08081a",cursor:"pointer",fontSize:12,fontWeight:700}}>Save</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
              <p style={{color:profile.bio?"#ffffffbb":"#ffffff33",fontSize:13,lineHeight:1.5,flex:1}}>{profile.bio||"No bio yet. Click edit to add one."}</p>
              <button onClick={()=>setEditBio(true)} style={{background:"none",border:"1px solid #ffffff22",borderRadius:6,color:"#ffffff44",padding:"4px 10px",cursor:"pointer",fontSize:11,flexShrink:0}}>✏️ Edit</button>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:5,marginBottom:18}}>
          {tabS("stats","Stats","📊")}{tabS("bets","Active Bets","🎫")}{tabS("history","History","📋")}{tabS("friends","Friends","👥")}{tabS("avatar","Avatar","🎨")}
        </div>
        {tab==="stats"&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {[["Races",totalRaces,"#00f5ff"],["Wins",wins,"#39ff14"],["Win Rate",winRate+"%","#ffd700"],["Wagered","$"+fmt2(totalWagered),"#bf5fff"],["Total Won","$"+fmt2(totalWon),"#39ff14"],["Net P&L",(netPnL>=0?"+$":"−$")+fmt2(Math.abs(netPnL)),netPnL>=0?"#39ff14":"#ff2d55"],["Best Win","$"+fmt2(bestWin),"#ffd700"],["Balance","$"+fmt2(user.balance),"#00f5ff"]].map(([lbl,val,col])=>(
              <div key={lbl} style={{flex:"1 1 calc(50% - 8px)",padding:"14px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,textAlign:"center"}}>
                <div style={{color:"#ffffff33",fontSize:10,letterSpacing:1,marginBottom:5}}>{lbl.toUpperCase()}</div>
                <div style={{fontFamily:"'Orbitron',monospace",color:col,fontSize:18,fontWeight:700}}>{val}</div>
              </div>
            ))}
          </div>
        )}
        {tab==="bets"&&(
          <div>
            {activeBets.length===0&&<p style={{color:"#ffffff33",textAlign:"center",padding:"30px 0"}}>No active bets right now.</p>}
            {activeBets.map(({race,data,st})=>{
              const rt=RACE_TYPES[race.type]; const secs=Math.floor((race.startTime-now)/1000);
              return (
                <div key={race.id} style={{marginBottom:10,padding:"14px",background:"rgba(255,255,255,0.03)",border:`1px solid ${rt.color}33`,borderRadius:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div><div style={{color:"#fff",fontWeight:700}}>{rt.icon} {race.name}{race.condition&&race.condition!=="sunny"?<span style={{marginLeft:6,fontSize:12}}>{TRACK_CONDITIONS[race.condition].icon}</span>:null}</div><div style={{color:rt.color,fontSize:11}}>{rt.label}{race.condition&&race.condition!=="sunny"?<span style={{color:TRACK_CONDITIONS[race.condition].color,marginLeft:6,fontSize:10}}>{TRACK_CONDITIONS[race.condition].label}</span>:null}</div></div>
                    <div style={{textAlign:"right"}}>
                      {st==="locked"&&<div style={{color:"#ff2d55",fontFamily:"'Orbitron',monospace",fontSize:13}}>{secs}s</div>}
                      {st==="betting"&&<div style={{color:"#39ff14",fontSize:12}}>{fmtCD(secs-BET_CLOSE_SECS)} to close</div>}
                      {st==="racing"&&<div style={{color:"#ff2d55",fontSize:12,animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                      <div style={{color:"#ffffff33",fontSize:10}}>{fmtTime(new Date(race.startTime))}</div>
                    </div>
                  </div>
                  {Object.entries(data.bets||{}).map(([hid,amt])=>{
                    const h=HORSES[parseInt(hid)];
                    return <div key={hid} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:`${h.color}0a`,border:`1px solid ${h.color}22`,borderRadius:7,marginBottom:4}}>
                      <HorseName race={race} horseId={h.id} style={{color:h.color,fontWeight:700,flex:1,fontSize:13}}/>
                      <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:13}}>${fmt2(parseFloat(amt))}</span>
                    </div>;
                  })}
                  <div style={{textAlign:"right",marginTop:4}}><span style={{color:"#00f5ff",fontSize:11}}>Total locked: ${fmt2(data.pot)}</span></div>
                </div>
              );
            })}
          </div>
        )}
        {tab==="history"&&(
          <div>
            {hist.length===0&&<p style={{color:"#ffffff33",textAlign:"center",padding:"30px 0"}}>No races yet!</p>}
            {showProfileReplay && <RaceReplayScreen race={showProfileReplay} onClose={()=>setShowProfileReplay(null)}/>}
            {[...hist].reverse().map((h,i)=>{
              const horse=HORSES[h.horseId]; const rt=RACE_TYPES[h.raceType];
              return <div key={i} style={{marginBottom:6,padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${h.won?"#39ff1422":"#ff2d5511"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:4,marginBottom:4,alignItems:"center"}}>
                  <span style={{color:"#00f5ff",fontSize:12,fontWeight:600}}>{rt?.icon} {h.raceName||"Race"}</span>
                  {h.raceId && <button onClick={()=>{
  const found = schedule.find(r=>r.id===h.raceId)||auctionSchedule.find(r=>r.id===h.raceId);
  setShowProfileReplay(found || {id:h.raceId,name:h.raceName,type:h.raceType||"standard",condition:"sunny",seed:1,startTime:h.time||Date.now()});
}} style={{padding:"2px 8px",background:"rgba(191,95,255,0.1)",border:"1px solid #bf5fff33",borderRadius:6,color:"#bf5fff",cursor:"pointer",fontSize:10,fontWeight:700}}>📼</button>}
                  <span style={{color:"#ffffff33",fontSize:10}}>{new Date(h.time).toLocaleString()}</span>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{color:horse.color,fontWeight:700,fontSize:13}}>🐴 {horse.name}</span>
                  <span style={{color:"#ffffff44",fontSize:12}}>Bet: <span style={{color:"#ffd700"}}>${h.amount}</span></span>
                  {h.won?<span style={{color:"#39ff14",fontWeight:700,fontSize:13}}>✓ +${fmt2(h.payout)}</span>:<span style={{color:"#ff2d55",fontSize:13}}>✗ Lost</span>}
                </div>
              </div>;
            })}
          </div>
        )}
        {tab==="friends"&&(
          <FriendsTab user={user} schedule={schedule} auctionSchedule={auctionSchedule} now={now} onGoToRace={onGoToRace} onClose={onClose}/>
        )}
        {tab==="avatar"&&(
          <div>
            <p style={{color:"#ffffff44",fontSize:12,marginBottom:14,textAlign:"center"}}>Choose your avatar</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center"}}>
              {AVATAR_OPTIONS.map(av=>(
                <button key={av} onClick={()=>saveAvatar(av)} style={{width:52,height:52,borderRadius:12,fontSize:26,cursor:"pointer",
                  background:(profile.avatar||"🏇")===av?"rgba(0,245,255,0.15)":"rgba(255,255,255,0.05)",
                  border:`2px solid ${(profile.avatar||"🏇")===av?"#00f5ff":"rgba(255,255,255,0.1)"}`,
                  transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center"}}>{av}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── PRIVATE RACES ────────────────────────────────────────────────────────────
function genRaceCode() {
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

function PrivateRacesPanel({ user, onClose, onLaunchPrivateRace }) {
  const [tab,      setTab]    = useState("browse"); // browse | create | join
  const [code,     setCode]   = useState("");
  const [joinCode, setJoinCode]= useState("");
  const [raceName, setRaceName]= useState("");
  const [raceType, setRaceType]= useState("standard");
  const [selCond,  setSelCond]  = useState("sunny");
  const [flash,    setFlash]  = useState(null);
  const [refresh,  setRefresh]= useState(0);

  const allRaces = getPrivateRaces();
  // My races = hosted or member
  const myRaces = Object.values(allRaces).filter(r=>r.hostUsername===user.username||r.members?.[user.username]);
  const tick = ()=>setRefresh(r=>r+1);

  const showFlash=(msg,ok=true)=>{setFlash({msg,ok});setTimeout(()=>setFlash(null),3000);};

  const createRace=()=>{
    if(!raceName.trim()){showFlash("Enter a race name",false);return;}
    const newCode=genRaceCode();
    const horses=pickHorseNames(newCode);
    const coats=pickHorseCoats(newCode);
    const condition = raceType==="magic_dice" ? "sunny" : selCond;
    const race={
      code:newCode, name:raceName.trim(), hostUsername:user.username,
      raceType, horses, coats, condition, created:Date.now(),
      started:false, startedAt:null, finished:false, winner:null,
      members:{ [user.username]:{ bets:{}, confirmed:false, joinedAt:Date.now() } }
    };
    const all=getPrivateRaces(); all[newCode]=race; savePrivateRaces(all);
    setCode(newCode); setRaceName(""); setTab("browse"); tick();
    showFlash(`Race created! Code: ${newCode}`);
  };

  const joinRace=()=>{
    const c=joinCode.trim().toUpperCase();
    if(!c){showFlash("Enter a race code",false);return;}
    const all=getPrivateRaces();
    if(!all[c]){showFlash("Race not found",false);return;}
    if(all[c].finished){showFlash("That race already finished",false);return;}
    if(!all[c].members[user.username]){
      all[c].members[user.username]={bets:{},confirmed:false,joinedAt:Date.now()};
      savePrivateRaces(all);
    }
    setJoinCode(""); tick();
    showFlash(`Joined "${all[c].name}"!`);
  };

  const tabS=(id,lbl,icon)=>(
    <button onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",borderRadius:7,border:"none",cursor:"pointer",
      background:tab===id?"#bf5fff":"rgba(255,255,255,0.05)",color:tab===id?"#fff":"#ffffff55",
      fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:10,letterSpacing:1,transition:"all 0.2s"}}>{icon} {lbl}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(8,8,26,0.97)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflowY:"auto"}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:600,background:"rgba(10,10,30,0.99)",border:"1px solid #bf5fff33",borderRadius:20,padding:28,maxHeight:"90vh",overflow:"auto",animation:"slideIn 0.2s ease-out",boxShadow:"0 0 60px #bf5fff0a"}} onClick={e=>e.stopPropagation()}>
        
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div>
            <h2 style={{fontFamily:"'Orbitron',monospace",color:"#bf5fff",fontSize:18,letterSpacing:3,textShadow:"0 0 16px #bf5fff66"}}>🔒 PRIVATE RACES</h2>
            <div style={{color:"#ffffff33",fontSize:11,marginTop:2}}>Host or join a private race with friends</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#ffffff44",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>

        {flash&&<div style={{padding:"10px 16px",borderRadius:9,marginBottom:14,textAlign:"center",background:flash.ok?"rgba(57,255,20,0.1)":"rgba(255,45,85,0.1)",border:`1px solid ${flash.ok?"#39ff1444":"#ff2d5544"}`,color:flash.ok?"#39ff14":"#ff2d55",fontWeight:700,fontSize:13,animation:"slideIn 0.2s ease-out"}}>{flash.ok?"✅":"⚠️"} {flash.msg}</div>}

        <div style={{display:"flex",gap:5,marginBottom:20}}>
          {tabS("browse","My Races","🏇")}
          {tabS("create","Create","➕")}
          {tabS("join","Join","🔑")}
        </div>

        {/* BROWSE — my races */}
        {tab==="browse"&&(
          <div>
            {myRaces.length===0&&(
              <div style={{textAlign:"center",padding:"40px 0"}}>
                <div style={{fontSize:40,marginBottom:12}}>🔒</div>
                <p style={{color:"#ffffff33",fontSize:13,marginBottom:16}}>No private races yet.</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>setTab("create")} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#bf5fff",color:"#fff",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12}}>➕ Create Race</button>
                  <button onClick={()=>setTab("join")} style={{padding:"10px 20px",borderRadius:10,border:"1px solid #bf5fff44",background:"rgba(191,95,255,0.08)",color:"#bf5fff",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12}}>🔑 Join Race</button>
                </div>
              </div>
            )}
            {myRaces.map(race=>(
              <PrivateRaceCard key={race.code} race={race} user={user} onUpdate={tick} onLaunch={onLaunchPrivateRace} onClose={onClose}/>
            ))}
          </div>
        )}

        {/* CREATE */}
        {tab==="create"&&(
          <div>
            <div style={{marginBottom:14}}>
              <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2}}>RACE NAME</label>
              <input value={raceName} onChange={e=>setRaceName(e.target.value)} placeholder="e.g. Friday Night Showdown"
                style={{width:"100%",marginTop:6,padding:"12px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid #bf5fff33",borderRadius:8,color:"#fff",fontSize:15,outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#bf5fff"} onBlur={e=>e.target.style.borderColor="#bf5fff33"}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2}}>RACE TYPE</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                {Object.entries(RACE_TYPES).map(([k,rt])=>(
                  <button key={k} onClick={()=>setRaceType(k)} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${raceType===k?rt.color+"88":rt.color+"22"}`,background:raceType===k?`${rt.color}18`:"rgba(255,255,255,0.03)",color:raceType===k?rt.color:"#ffffff44",cursor:"pointer",fontSize:12,fontWeight:700,transition:"all 0.15s"}}>
                    {rt.icon} {rt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2}}>TRACK CONDITION</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                {Object.entries(TRACK_CONDITIONS).map(([k,cd])=>(
                  <button key={k} onClick={()=>setSelCond(k)} disabled={raceType==="magic_dice"}
                    style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${selCond===k?cd.color+"88":cd.color+"22"}`,background:selCond===k?`${cd.color}18`:"rgba(255,255,255,0.03)",color:selCond===k?cd.color:"#ffffff44",cursor:raceType==="magic_dice"?"not-allowed":"pointer",fontSize:12,fontWeight:700,opacity:raceType==="magic_dice"?0.4:1,transition:"all 0.15s"}}>
                    {cd.icon} {cd.label}
                  </button>
                ))}
              </div>
              {raceType==="magic_dice"&&<div style={{color:"#ffffff33",fontSize:10,marginTop:4}}>Magic Dice races are always Sunny</div>}
            </div>
            <div style={{padding:"12px 16px",background:"rgba(191,95,255,0.06)",border:"1px solid #bf5fff22",borderRadius:10,marginBottom:20,fontSize:12,color:"#ffffff55",lineHeight:1.7}}>
              <div>• You become the <span style={{color:"#bf5fff",fontWeight:700}}>race admin</span> — only you can start the race</div>
              <div>• Share the generated <span style={{color:"#ffd700",fontWeight:700}}>6-character code</span> with players</div>
              <div>• Everyone places bets, then you hit Start when ready</div>
            </div>
            <button onClick={createRace} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#bf5fff,#7b2fff)",color:"#fff",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:14,letterSpacing:2,boxShadow:"0 0 24px #bf5fff33"}}>
              🔒 CREATE PRIVATE RACE
            </button>
          </div>
        )}

        {/* JOIN */}
        {tab==="join"&&(
          <div>
            <label style={{color:"#ffffff44",fontSize:11,letterSpacing:2}}>ENTER RACE CODE</label>
            <div style={{display:"flex",gap:8,marginTop:8,marginBottom:16}}>
              <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                style={{flex:1,padding:"13px 16px",background:"rgba(255,255,255,0.05)",border:"1px solid #bf5fff33",borderRadius:8,color:"#fff",fontSize:20,outline:"none",fontFamily:"'Orbitron',monospace",letterSpacing:4,textAlign:"center"}}
                onFocus={e=>e.target.style.borderColor="#bf5fff"} onBlur={e=>e.target.style.borderColor="#bf5fff33"}
                onKeyDown={e=>e.key==="Enter"&&joinRace()}/>
              <button onClick={joinRace} style={{padding:"13px 22px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#bf5fff,#7b2fff)",color:"#fff",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>JOIN</button>
            </div>
            <p style={{color:"#ffffff33",fontSize:12,textAlign:"center"}}>Ask the race host for their 6-character code</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── PRIVATE RACE CARD ────────────────────────────────────────────────────────
const PRIVATE_COUNTDOWN_SECS = 30;

function PrivateRaceCard({ race, user, onUpdate, onLaunch, onClose }) {
  const isHost   = race.hostUsername===user.username;
  const me       = race.members?.[user.username]||{};
  const myBets   = me.bets||{};
  const confirmed= me.confirmed||false;
  const members  = Object.entries(race.members||{});
  const [betting,   setBetting]   = useState(false);
  const [localBets, setLocalBets] = useState({...myBets});
  const [flash,     setFlash]     = useState(null);
  const [countdown, setCountdown] = useState(null); // null = not started, number = ticking

  const rt = RACE_TYPES[race.raceType]||RACE_TYPES.standard;
  const showFlash=(msg,ok=true)=>{setFlash({msg,ok});setTimeout(()=>setFlash(null),2500);};

  // Build live odds from all members' confirmed bets
  const liveOdds = useMemo(()=>{
    const totalPool = Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.pot)||0),0);
    if(totalPool<=0) return HORSES.map((h,i)=>({ h, name: race.horses?.[i]||h.name, odds: null, totalOnHorse: 0 }));
    return HORSES.map((h,i)=>{
      const totalOnHorse = Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.bets?.[h.id]||0)),0);
      return { h, name: race.horses?.[i]||h.name, odds: totalOnHorse>0 ? parseFloat((totalPool/totalOnHorse).toFixed(2)) : null, totalOnHorse };
    }).sort((a,b)=>(a.odds||999)-(b.odds||999)); // favourite first
  },[race.members, race.horses]);

  // Countdown ticker — starts when race.started becomes true
  useEffect(()=>{
    if(!race.started || race.finished) return;
    const elapsed = Math.floor((Date.now() - race.startedAt)/1000);
    const remaining = Math.max(0, PRIVATE_COUNTDOWN_SECS - elapsed);
    setCountdown(remaining);
    if(remaining<=0){ onLaunch(race); onClose(); return; }
    const t = setInterval(()=>{
      const el2 = Math.floor((Date.now() - race.startedAt)/1000);
      const rem2 = Math.max(0, PRIVATE_COUNTDOWN_SECS - el2);
      setCountdown(rem2);
      if(rem2<=10 && rem2>0) sfx.countdownBeep(rem2<=3);
      if(rem2<=0){ clearInterval(t); onLaunch(race); onClose(); }
    },1000);
    return ()=>clearInterval(t);
  },[race.started, race.startedAt]);

  const saveBet=(hid,val)=>{
    const n=parseFloat(val); const b={...localBets};
    if(!val||isNaN(n)||n<=0) delete b[hid]; else b[hid]=n;
    setLocalBets(b);
  };

  const confirmBets=()=>{
    // Re-read from storage to catch if host started race while we were editing
    const freshRaces=getPrivateRaces();
    if(freshRaces[race.code]?.started){sfx.error(); showFlash("Bets are closed — race has started",false);setBetting(false);return;}
    const totalBet=Object.values(localBets).reduce((s,v)=>s+(parseFloat(v)||0),0);
    if(totalBet<=0){showFlash("Place at least one bet first",false);return;}
    const all=getPrivateRaces();
    if(!all[race.code]){showFlash("Race not found",false);return;}
    all[race.code].members[user.username]={...me,bets:localBets,confirmed:true,pot:totalBet};
    savePrivateRaces(all);
    setBetting(false); onUpdate();
    showFlash(`Bets confirmed! $${fmt2(totalBet)} locked in ✓`);
  };

  const startRace=()=>{
    const all=getPrivateRaces();
    if(!all[race.code]) return;
    all[race.code].started=true;
    all[race.code].startedAt=Date.now();
    savePrivateRaces(all);
    onUpdate(); // triggers re-render → useEffect picks up race.started
  };

  const totalMembers=members.length;
  const confirmedCount=members.filter(([,m])=>m.confirmed).length;
  const timerColor = countdown<=10?"#ff2d55":countdown<=20?"#ffd700":"#00f5ff";

  // ── COUNTDOWN SCREEN — shown to everyone once race.started=true ──────────────
  if(race.started && !race.finished && countdown !== null) {
    const ringPct = (countdown / PRIVATE_COUNTDOWN_SECS) * 100;
    const totalPool = Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.pot)||0),0);
    return (
      <div style={{padding:"20px",background:"rgba(191,95,255,0.08)",border:"2px solid #bf5fff44",borderRadius:16,animation:"slideIn 0.2s ease-out"}}>
        {/* Header */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:24,marginBottom:4}}>{rt.icon}</div>
          <div style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:15,letterSpacing:2}}>{race.name}</div>
          <div style={{color:"#bf5fff",fontSize:11,letterSpacing:2,marginTop:2}}>PRIVATE RACE · BETS CLOSED</div>
        </div>

        {/* Countdown ring */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
          <div style={{position:"relative",width:120,height:120}}>
            <svg width="120" height="120" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke={timerColor} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*52}`}
                strokeDashoffset={`${2*Math.PI*52*(1-ringPct/100)}`}
                style={{transition:"stroke-dashoffset 1s linear, stroke 0.5s",filter:`drop-shadow(0 0 6px ${timerColor})`}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <div style={{fontFamily:"'Orbitron',monospace",color:timerColor,fontSize:34,fontWeight:900,lineHeight:1,textShadow:`0 0 16px ${timerColor}77`}}>{countdown}</div>
              <div style={{color:"#ffffff44",fontSize:9,letterSpacing:2,marginTop:2}}>SECS</div>
            </div>
          </div>
        </div>

        <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff44",fontSize:10,letterSpacing:3,textAlign:"center",marginBottom:16,animation:"racingBlink 1s infinite"}}>
          RACE STARTING SOON
        </div>

        {/* Odds — admin sees full live odds, others see blurred until ≤10s */}
        <div style={{width:"100%"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{color:"#ffffff33",fontSize:10,letterSpacing:2}}>RACE ODDS</span>
            {isHost
              ? <span style={{color:"#ffd70088",fontSize:10}}>👑 ADMIN VIEW</span>
              : countdown>10
                ? <span style={{color:"#ffffff22",fontSize:10}}>reveals at 10s</span>
                : <span style={{color:"#00f5ff88",fontSize:10}}>final odds</span>
            }
          </div>
          <div style={{filter: !isHost && countdown>10 ? "blur(6px)" : "none", transition:"filter 0.8s", userSelect: !isHost && countdown>10 ? "none":"auto"}}>
            {liveOdds.map(({h,name,odds,totalOnHorse},i)=>{
              const rank=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
              const myBetAmt = parseFloat(myBets[h.id]||0);
              return (
                <div key={h.id} style={{marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:`${h.color}0d`,border:`1px solid ${h.color}44`,borderRadius:10}}>
                    <div style={{width:30,height:30,borderRadius:"50%",background:`${h.color}18`,border:`2px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
                    <div style={{flex:1}}>
                      <div style={{color:h.color,fontWeight:700,fontSize:13}}>{rank} {name}</div>
                      {isHost&&<div style={{color:"#ffffff33",fontSize:10,marginTop:1}}>${fmt2(totalOnHorse)} bet total</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:16,fontWeight:900,textShadow:"0 0 8px #ffd70055"}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                      {myBetAmt>0&&<div style={{color:"#00f5ff",fontSize:10,marginTop:1}}>you: ${fmt2(myBetAmt)}</div>}
                    </div>
                  </div>
                  <div style={{height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,marginTop:2,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:2,background:h.color,width:odds?`${Math.min(100,100/odds*6)}%`:"0%",transition:"width 0.6s ease",boxShadow:`0 0 4px ${h.color}`}}/>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Pool total */}
          <div style={{marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:8,display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"#ffffff44",fontSize:11}}>Total pool</span>
            <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:13}}>${fmt2(totalPool)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{marginBottom:14,padding:"16px",background:"rgba(191,95,255,0.05)",border:`1px solid ${isHost?"#bf5fff44":"#ffffff18"}`,borderRadius:14,animation:"slideIn 0.2s ease-out"}}>
      {flash&&<div style={{padding:"8px 12px",borderRadius:7,marginBottom:8,textAlign:"center",background:flash.ok?"rgba(57,255,20,0.1)":"rgba(255,45,85,0.1)",border:`1px solid ${flash.ok?"#39ff1444":"#ff2d5544"}`,color:flash.ok?"#39ff14":"#ff2d55",fontSize:12}}>{flash.msg}</div>}
      
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{color:"#fff",fontWeight:700,fontSize:16}}>{rt.icon} {race.name}</div>
          <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
            <span style={{color:rt.color,fontSize:12,fontWeight:600}}>{rt.label}</span>
            <span style={{color:"#ffffff33"}}>·</span>
            <span style={{color:"#bf5fff",fontFamily:"'Orbitron',monospace",fontSize:13,letterSpacing:2}}>{race.code}</span>
            {isHost&&<span style={{background:"rgba(255,215,0,0.12)",border:"1px solid #ffd70033",borderRadius:8,padding:"1px 8px",color:"#ffd700",fontSize:10,fontWeight:700}}>ADMIN</span>}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          {race.finished&&<span style={{color:"#ffffff44",fontSize:12}}>FINISHED</span>}
          {race.started&&!race.finished&&<span style={{color:"#ff2d55",fontSize:12,animation:"racingBlink 1s infinite"}}>LIVE 🔴</span>}
          {!race.started&&<span style={{color:"#39ff14",fontSize:12}}>WAITING</span>}
        </div>
      </div>

      {/* Race code display */}
      <div style={{padding:"8px 12px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70022",borderRadius:8,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#ffffff55",fontSize:11}}>Share code:</span>
        <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:20,letterSpacing:6,fontWeight:900}}>{race.code}</span>
        <button onClick={()=>{navigator.clipboard?.writeText(race.code);showFlash("Code copied!");}} style={{background:"rgba(255,215,0,0.1)",border:"1px solid #ffd70033",borderRadius:6,color:"#ffd700",padding:"4px 10px",cursor:"pointer",fontSize:11}}>Copy</button>
      </div>

      {/* Members */}
      <div style={{marginBottom:12}}>
        <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:6}}>{totalMembers} MEMBER{totalMembers!==1?"S":""} · {confirmedCount} CONFIRMED</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {members.map(([uname,m])=>(
            <div key={uname} style={{padding:"4px 10px",borderRadius:20,background:m.confirmed?"rgba(57,255,20,0.1)":"rgba(255,255,255,0.05)",border:`1px solid ${m.confirmed?"#39ff1433":"#ffffff18"}`,display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:11}}>{getProfile(uname).avatar||"🏇"}</span>
              <span style={{color:m.confirmed?"#39ff14":"#ffffff66",fontSize:11,fontWeight:600}}>{uname}</span>
              {uname===race.hostUsername&&<span style={{color:"#ffd70066",fontSize:9}}>★</span>}
              {m.confirmed&&<span style={{color:"#39ff1066",fontSize:9}}>✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Horses */}
      <div style={{marginBottom:12}}>
        <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:6}}>HORSES IN THIS RACE</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {HORSES.map((h,i)=>(
            <div key={h.id} style={{padding:"3px 10px",borderRadius:20,background:`${h.color}0d`,border:`1px solid ${h.color}33`,display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:10,filter:horseCoat(race,i)}}>🐴</span>
              <span style={{color:h.color,fontSize:11,fontWeight:600}}>{race.horses?.[i]||h.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Admin live odds — visible only to host before race starts */}
      {isHost && !race.started && (
        <div style={{marginBottom:12,padding:"12px",background:"rgba(255,215,0,0.04)",border:"1px solid #ffd70022",borderRadius:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{color:"#ffd70088",fontSize:10,letterSpacing:2}}>👑 LIVE ODDS</span>
            <span style={{color:"#ffffff22",fontSize:10}}>${fmt2(Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.pot)||0),0))} pool</span>
          </div>
          {liveOdds.map(({h,name,odds,totalOnHorse},i)=>{
            const rank=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
            return (
              <div key={h.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",marginBottom:4,background:`${h.color}0a`,border:`1px solid ${h.color}22`,borderRadius:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:h.color,flexShrink:0}}/>
                <span style={{flex:1,color:h.color,fontWeight:700,fontSize:12}}>{rank} {name}</span>
                <span style={{color:"#ffffff33",fontSize:11,marginRight:8}}>${fmt2(totalOnHorse)} on</span>
                <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:14,fontWeight:900}}>{odds?`${odds.toFixed(2)}x`:"—"}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* My bets */}
      {!race.started&&(
        <div>
          {!betting&&(
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!confirmed?(
                <button onClick={()=>setBetting(true)} style={{flex:1,padding:"10px",borderRadius:9,border:"1px solid #bf5fff44",background:"rgba(191,95,255,0.08)",color:"#bf5fff",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12}}>
                  🎫 Place Bets
                </button>
              ):(
                <div style={{flex:1,padding:"10px",borderRadius:9,background:"rgba(57,255,20,0.07)",border:"1px solid #39ff1433",textAlign:"center"}}>
                  <span style={{color:"#39ff14",fontWeight:700,fontSize:12}}>✓ Bets Confirmed — ${fmt2(Object.values(myBets).reduce((s,v)=>s+(parseFloat(v)||0),0))}</span>
                  <button onClick={()=>{setBetting(true);}} style={{marginLeft:10,background:"none",border:"1px solid #ffffff22",borderRadius:5,color:"#ffffff44",padding:"2px 8px",cursor:"pointer",fontSize:10}}>Edit</button>
                </div>
              )}
              {isHost&&!race.started&&(
                <button onClick={startRace} style={{padding:"10px 18px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#ff2d55,#ff6b00)",color:"#fff",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12,boxShadow:"0 0 20px #ff2d5533"}}>
                  🏁 START RACE
                </button>
              )}
            </div>
          )}
          {betting&&(
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,padding:"12px"}}>
              <div style={{color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:8}}>PLACE YOUR BETS {race.started?"(RACE STARTED — BETS CLOSED)":""}</div>
              {HORSES.map((h,i)=>{
                const name=race.horses?.[i]||h.name;
                const val=localBets[h.id]||"";
                return (
                  <div key={h.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:h.color,flexShrink:0}}/>
                    <span style={{flex:1,color:h.color,fontWeight:600,fontSize:13}}>{name}</span>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#ffd70066",fontSize:12,pointerEvents:"none"}}>$</span>
                      <input type="number" min="0" placeholder="0" value={val} onChange={e=>saveBet(h.id,e.target.value)}
                        style={{width:80,padding:"6px 6px 6px 18px",background:"rgba(255,255,255,0.07)",border:"1px solid #ffffff18",borderRadius:6,color:"#fff",fontSize:16,outline:"none"}}/>
                    </div>
                  </div>
                );
              })}
              <div style={{display:"flex",gap:8,marginTop:10}}>
                <button onClick={()=>setBetting(false)} style={{flex:1,padding:"9px",borderRadius:7,border:"1px solid #ffffff22",background:"transparent",color:"#ffffff55",cursor:"pointer",fontSize:12}}>Cancel</button>
                <button onClick={confirmBets} style={{flex:2,padding:"9px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#00f5ff,#39ff14)",color:"#08081a",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12,letterSpacing:1}}>🔒 CONFIRM BETS</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BANK ─────────────────────────────────────────────────────────────────────
function BankPanel({ user, onClose, onBalanceChange }) {
  const [tab,    setTab]    = useState("summary"); // summary | deposit | withdraw
  const [amount, setAmount] = useState("");
  const [flash,  setFlash]  = useState(null); // {msg, ok}
  const [txs, setTxs] = useState([]); useEffect(()=>{ if(user?.uid) fbGetBankTx(user.uid).then(setTxs); },[user?.uid]);

  // Stats derived from transaction history
  const totalDeposited  = txs.filter(t=>t.type==="deposit" ).reduce((s,t)=>s+t.amount,0);
  const totalWithdrawn  = txs.filter(t=>t.type==="withdraw").reduce((s,t)=>s+t.amount,0);
  const startingBalance = 1000; // new accounts get $1000
  const netPnL = user.balance - startingBalance - totalDeposited + totalWithdrawn;

  const showFlash = (msg, ok=true) => {
    setFlash({msg,ok});
    setTimeout(()=>setFlash(null), 2500);
  };

  const doDeposit = (amt) => {
    const n = parseFloat(amt);
    if(!n || n <= 0 || n > 1000000) { showFlash("Enter a valid amount (max $1,000,000)", false); return; }
    const newBal = user.balance + n;
    addBankTx(user.username, "deposit", n, newBal);
    onBalanceChange(newBal);
    setAmount("");
    sfx.deposit();
    showFlash(`$${fmt2(n)} deposited successfully!`);
  };

  const doWithdraw = (amt) => {
    const n = parseFloat(amt);
    if(!n || n <= 0) { showFlash("Enter a valid amount", false); return; }
    if(n > user.balance) { showFlash("Insufficient funds", false); return; }
    const newBal = user.balance - n;
    addBankTx(user.username, "withdraw", n, newBal);
    onBalanceChange(newBal);
    setAmount("");
    sfx.betConfirm();
    showFlash(`$${fmt2(n)} withdrawn successfully!`);
  };

  const DEPOSIT_PRESETS  = [100, 250, 500, 1000, 2500, 5000];
  const WITHDRAW_PRESETS = [50, 100, 250, 500, "All"];

  const tabBtn = (id, label, icon) => (
    <button onClick={()=>{setTab(id);setAmount("");setFlash(null);}} style={{
      flex:1, padding:"10px 8px", borderRadius:8, border:"none", cursor:"pointer",
      background: tab===id ? "#00f5ff" : "rgba(255,255,255,0.05)",
      color: tab===id ? "#08081a" : "#ffffff55",
      fontFamily:"'Orbitron',monospace", fontWeight:700, fontSize:11, letterSpacing:1,
      transition:"all 0.2s",
    }}>{icon} {label}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(8,8,26,0.97)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:520,background:"rgba(10,10,30,0.99)",border:"1px solid #ffd70033",borderRadius:20,padding:28,maxHeight:"88vh",overflow:"auto",animation:"slideIn 0.2s ease-out",boxShadow:"0 0 80px #ffd70010"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div>
            <h2 style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:18,letterSpacing:3,textShadow:"0 0 16px #ffd70066"}}>🏦 MY BANK</h2>
            <div style={{color:"#ffffff33",fontSize:11,marginTop:3,letterSpacing:1}}>{user.username.toUpperCase()} · DEMO ACCOUNT</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#ffffff44",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>

        {/* Big balance */}
        <div style={{textAlign:"center",marginBottom:24,padding:"20px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:14}}>
          <div style={{color:"#ffffff44",fontSize:11,letterSpacing:3,marginBottom:4}}>AVAILABLE BALANCE</div>
          <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:42,fontWeight:900,textShadow:"0 0 30px #ffd70055",lineHeight:1}}>${fmt2(user.balance)}</div>
          <div style={{marginTop:8,display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
            <span style={{color:"#39ff1488",fontSize:12}}>▲ ${fmt2(totalDeposited)} deposited</span>
            <span style={{color:"#ff2d5588",fontSize:12}}>▼ ${fmt2(totalWithdrawn)} withdrawn</span>
            <span style={{color:netPnL>=0?"#39ff14":"#ff2d55",fontSize:12,fontWeight:700}}>{netPnL>=0?"▲":"▼"} ${fmt2(Math.abs(netPnL))} betting P&L</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:6,marginBottom:20}}>
          {tabBtn("summary","History","📋")}
          {tabBtn("deposit","Deposit","💳")}
          {tabBtn("withdraw","Withdraw","💸")}
        </div>

        {/* Flash message */}
        {flash && (
          <div style={{padding:"10px 16px",borderRadius:9,marginBottom:14,textAlign:"center",
            background:flash.ok?"rgba(57,255,20,0.1)":"rgba(255,45,85,0.1)",
            border:`1px solid ${flash.ok?"#39ff1444":"#ff2d5544"}`,
            color:flash.ok?"#39ff14":"#ff2d55",fontWeight:700,fontSize:13,
            animation:"slideIn 0.2s ease-out"
          }}>{flash.ok?"✅":"⚠️"} {flash.msg}</div>
        )}

        {/* ── SUMMARY TAB ── */}
        {tab==="summary" && (
          <div>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              {[
                ["Starting Balance","$"+fmt2(startingBalance),"#00f5ff"],
                ["Total Deposited","$"+fmt2(totalDeposited),"#39ff14"],
                ["Total Withdrawn","$"+fmt2(totalWithdrawn),"#ff2d55"],
                ["Betting P&L",(netPnL>=0?"+":"-")+"$"+fmt2(Math.abs(netPnL)),netPnL>=0?"#39ff14":"#ff2d55"],
              ].map(([lbl,val,col])=>(
                <div key={lbl} style={{flex:"1 1 45%",padding:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,textAlign:"center"}}>
                  <div style={{color:"#ffffff33",fontSize:10,letterSpacing:1,marginBottom:4}}>{lbl}</div>
                  <div style={{fontFamily:"'Orbitron',monospace",color:col,fontSize:16,fontWeight:700}}>{val}</div>
                </div>
              ))}
            </div>
            {txs.length===0 ? (
              <p style={{color:"#ffffff22",textAlign:"center",padding:"30px 0",fontSize:13}}>No transactions yet.</p>
            ) : (
              <div>
                <div style={{color:"#ffffff22",fontSize:10,letterSpacing:2,marginBottom:8}}>RECENT TRANSACTIONS</div>
                {txs.map((tx,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:5,background:"rgba(255,255,255,0.02)",border:"1px solid #ffffff08",borderRadius:9}}>
                    <span style={{fontSize:18}}>{tx.type==="deposit"?"💳":"💸"}</span>
                    <div style={{flex:1}}>
                      <div style={{color:"#fff",fontWeight:600,fontSize:13,textTransform:"capitalize"}}>{tx.type}</div>
                      <div style={{color:"#ffffff33",fontSize:11}}>{new Date(tx.ts).toLocaleString()}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Orbitron',monospace",color:tx.type==="deposit"?"#39ff14":"#ff2d55",fontSize:14,fontWeight:700}}>{tx.type==="deposit"?"+":"-"}${fmt2(tx.amount)}</div>
                      <div style={{color:"#ffffff33",fontSize:11}}>bal: ${fmt2(tx.balance)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DEPOSIT TAB ── */}
        {tab==="deposit" && (
          <div>
            <div style={{color:"#ffffff44",fontSize:11,letterSpacing:2,marginBottom:12}}>QUICK DEPOSIT</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {DEPOSIT_PRESETS.map(amt=>(
                <button key={amt} onClick={()=>doDeposit(amt)} style={{flex:"1 1 calc(33% - 8px)",padding:"12px 8px",borderRadius:10,border:"1px solid #ffd70033",background:"rgba(255,215,0,0.07)",color:"#ffd700",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,215,0,0.15)";e.currentTarget.style.borderColor="#ffd70066";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,215,0,0.07)";e.currentTarget.style.borderColor="#ffd70033";}}
                >+${fmt2(amt)}</button>
              ))}
            </div>
            <div style={{color:"#ffffff44",fontSize:11,letterSpacing:2,marginBottom:8}}>CUSTOM AMOUNT</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#ffd70077",fontSize:16,pointerEvents:"none"}}>$</span>
                <input type="number" min="1" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doDeposit(amount)}
                  style={{width:"100%",padding:"13px 12px 13px 28px",background:"rgba(255,255,255,0.05)",border:"1px solid #ffd70033",borderRadius:10,color:"#fff",fontSize:16,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="#ffd700"} onBlur={e=>e.target.style.borderColor="#ffd70033"}/>
              </div>
              <button onClick={()=>doDeposit(amount)} style={{padding:"13px 22px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#ffd700,#ff9500)",color:"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,letterSpacing:2,whiteSpace:"nowrap"}}>DEPOSIT</button>
            </div>
            <p style={{color:"#ffffff22",fontSize:11,marginTop:10,textAlign:"center"}}>Demo currency only — no real money involved</p>
          </div>
        )}

        {/* ── WITHDRAW TAB ── */}
        {tab==="withdraw" && (
          <div>
            <div style={{color:"#ffffff44",fontSize:11,letterSpacing:2,marginBottom:12}}>QUICK WITHDRAW</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {WITHDRAW_PRESETS.map(amt=>(
                <button key={amt} onClick={()=>doWithdraw(amt==="All"?user.balance:amt)} style={{flex:"1 1 calc(33% - 8px)",padding:"12px 8px",borderRadius:10,border:"1px solid #ff2d5533",background:"rgba(255,45,85,0.07)",color:"#ff2d55",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,45,85,0.15)";e.currentTarget.style.borderColor="#ff2d5566";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,45,85,0.07)";e.currentTarget.style.borderColor="#ff2d5533";}}
                >{amt==="All"?"ALL":"-$"+fmt2(amt)}</button>
              ))}
            </div>
            <div style={{color:"#ffffff44",fontSize:11,letterSpacing:2,marginBottom:8}}>CUSTOM AMOUNT</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#ff2d5577",fontSize:16,pointerEvents:"none"}}>$</span>
                <input type="number" min="1" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doWithdraw(amount)}
                  style={{width:"100%",padding:"13px 12px 13px 28px",background:"rgba(255,255,255,0.05)",border:"1px solid #ff2d5533",borderRadius:10,color:"#fff",fontSize:16,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="#ff2d55"} onBlur={e=>e.target.style.borderColor="#ff2d5533"}/>
              </div>
              <button onClick={()=>doWithdraw(amount)} style={{padding:"13px 22px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#ff2d55,#ff6b00)",color:"#fff",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,letterSpacing:2,whiteSpace:"nowrap"}}>WITHDRAW</button>
            </div>
            <div style={{marginTop:14,padding:"10px 14px",background:"rgba(255,45,85,0.05)",border:"1px solid #ff2d5522",borderRadius:9,display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#ffffff44",fontSize:12}}>Available to withdraw</span>
              <span style={{fontFamily:"'Orbitron',monospace",color:"#ff2d55",fontSize:14}}>${fmt2(user.balance)}</span>
            </div>
            <p style={{color:"#ffffff22",fontSize:11,marginTop:10,textAlign:"center"}}>Demo currency only — no real money involved</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── MUTE BUTTON ──────────────────────────────────────────────────────────────
function MuteButton({ size=28 }) {
  const [on, setOn] = useState(getSoundEnabled());
  const toggle = () => {
    const v = !on; setOn(v); setSoundEnabled(v);

    if(v) sfx.betConfirm();
  };
  return (
    <button onClick={toggle} title={on?"Mute sounds":"Unmute sounds"} style={{
      width:size, height:size, borderRadius:7, border:"1px solid rgba(255,255,255,0.12)",
      background:"rgba(255,255,255,0.06)", cursor:"pointer", fontSize:size*0.5,
      display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s",
    }}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.12)"}
      onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
    >{on ? "🔊" : "🔇"}</button>
  );
}

// ─── NAVBAR ───────────────────────────────────────────────────────────────────
function UserMenu({ avatar, user, onProfile, onBank, onHowTo, onPrivateRaces, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(()=>{
    const handler = (e) => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  },[]);

  const items = [
    { icon:"👤", label:"Profile",       fn: onProfile },
    { icon:"🏦", label:"Bank",          fn: onBank    },
    { icon:"🔒", label:"Private Races", fn: onPrivateRaces },
    { icon:"❓",  label:"How It Works",  fn: onHowTo },
    { icon:"🚪", label:"Sign Out",      fn: onLogout, danger: true },
  ];

  return (
    <div ref={ref} style={{position:"relative",flexShrink:0}}>
      <button onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:open?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,cursor:"pointer",transition:"all 0.15s"}}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}
        onMouseLeave={e=>{ if(!open) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}>
        <span style={{fontSize:15}}>{avatar}</span>
        <span style={{color:"#fff",fontSize:12,fontWeight:600,letterSpacing:1,maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.username}</span>
        <span style={{color:"#ffffff44",fontSize:9,marginLeft:2}}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,minWidth:160,background:"rgba(8,8,26,0.98)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:400,animation:"slideIn 0.12s ease-out"}}>
          {items.map(({icon,label,fn,danger})=>(
            <button key={label} onClick={()=>{ setOpen(false); fn(); }} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.05)",cursor:"pointer",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.07)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:14}}>{icon}</span>
              <span style={{color:danger?"#ff2d55":"#ffffffcc",fontSize:13,fontWeight:600}}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavBar({ user, onLobby, onMyBets, onProfile, onPrivateRaces, onAuctions, onLogout, onBank, onHowTo, pendingCount }) {
  const profile  = getProfile(user.username);
  const avatar   = profile.avatar || "🏇";
  const [menuOpen, setMenuOpen] = useState(false);
  const [winWidth, setWinWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 800);
  useEffect(()=>{
    const handler = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const isMobile = winWidth < 600;

  const navItems = [
    ["🏠","Lobby",         onLobby,         null],
    ["🔨","Auction Races",  onAuctions,      null],
    ["🔒","Private Races",  onPrivateRaces,  null],
    ["🎫","Active Bets",    onMyBets,        pendingCount>0?pendingCount:null],
    ["👤","Profile",        onProfile,       null],
    ["🏦","Bank",           onBank,          null],
    ["❓","How It Works",   onHowTo,         null],
    ["⬡", "Sign Out",   onLogout,         null],
  ];
  const [soundOn, setSoundOn] = useState(getSoundEnabled());
  const toggleSound = () => { const v=!soundOn; setSoundOn(v); setSoundEnabled(v); if(v) sfx.betConfirm(); };

  const closeMenu = (fn) => { setMenuOpen(false); fn && fn(); };

  if(isMobile) {
    return (
      <>
        {/* Mobile bar: logo left, balance + burger right */}
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:300,background:"rgba(8,8,26,0.97)",backdropFilter:"blur(16px)",borderBottom:"1px solid #00f5ff18",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",height:52}}>
          <button onClick={onLobby} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:14,letterSpacing:2,textShadow:"0 0 12px #00f5ff"}}>🏇 THE TRACK</button>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {/* Balance pill */}
            <button onClick={onBank} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",background:"rgba(255,215,0,0.08)",border:"1px solid #ffd70033",borderRadius:20,cursor:"pointer"}}>
              <span style={{fontSize:12}}>🏦</span>
              <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:12}}>${fmt2(user.balance)}</span>
            </button>
            {/* Sound toggle */}
            <button onClick={()=>{ const v=!getSoundEnabled(); setSoundEnabled(v); setSoundOn(v); if(v) sfx.betConfirm(); }} style={{width:32,height:32,borderRadius:8,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {soundOn?"🔊":"🔇"}
            </button>
            {/* Burger */}
            <button onClick={()=>setMenuOpen(o=>!o)} style={{position:"relative",width:36,height:36,borderRadius:8,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:16,height:2,borderRadius:1,background:"#fff",transition:"all 0.2s",
                  transform: menuOpen ? (i===0?"rotate(45deg) translate(4px,4px)":i===2?"rotate(-45deg) translate(4px,-4px)":"scaleX(0)") : "none",
                  opacity: menuOpen && i===1 ? 0 : 1,
                }}/>
              ))}
              {pendingCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#ff2d55",color:"#fff",borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700}}>{pendingCount}</span>}
            </button>
          </div>
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <div style={{position:"fixed",top:52,left:0,right:0,zIndex:299,background:"rgba(8,8,26,0.98)",backdropFilter:"blur(20px)",borderBottom:"1px solid #00f5ff18",padding:"8px 0",animation:"slideIn 0.15s ease-out"}}>
            {/* Profile header */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:"1px solid #ffffff08",marginBottom:4}}>
              <span style={{fontSize:22}}>{avatar}</span>
              <div>
                <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{user.username}</div>
                <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:11}}>${fmt2(user.balance)}</div>
              </div>
            </div>
            {navItems.map(([icon,lbl,fn,badge])=>(
              <button key={lbl} onClick={()=>closeMenu(fn)} style={{
                width:"100%",display:"flex",alignItems:"center",gap:12,padding:"13px 16px",
                background:"transparent",border:"none",cursor:"pointer",
                borderBottom:"1px solid #ffffff06",textAlign:"left",
              }}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <span style={{fontSize:16,width:22,textAlign:"center"}}>{icon}</span>
                <span style={{color:lbl==="Sign Out"?"#ff2d55":"#ffffffcc",fontSize:14,fontWeight:600,flex:1}}>{lbl}</span>
                {badge&&<span style={{background:"#ff2d55",color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700}}>{badge}</span>}
              </button>
            ))}
          </div>
        )}
        {/* Dim backdrop */}
        {menuOpen&&<div style={{position:"fixed",inset:0,top:52,zIndex:298,background:"rgba(0,0,0,0.4)"}} onClick={()=>setMenuOpen(false)}/>}
      </>
    );
  }

  // ── Desktop / landscape ────────────────────────────────────────────────────
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"rgba(8,8,26,0.96)",backdropFilter:"blur(16px)",borderBottom:"1px solid #00f5ff18",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",height:56,flexShrink:0,gap:8}}>
      <button onClick={onLobby} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:15,letterSpacing:3,textShadow:"0 0 14px #00f5ff",whiteSpace:"nowrap",flexShrink:0}}>🏇 THE TRACK</button>
      <div style={{display:"flex",alignItems:"center",gap:4,flex:1,justifyContent:"center"}}>
        {[
          ["🏠","Lobby",onLobby,null],
          ["🔨","Auction Races",onAuctions,null],
          ["🎫","Active Bets",onMyBets,pendingCount>0?pendingCount:null],
        ].map(([icon,lbl,fn,badge])=>(
          <button key={lbl} onClick={fn} style={{position:"relative",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:6,color:"#ffffff66",padding:"5px 10px",cursor:"pointer",fontSize:12,letterSpacing:1,transition:"all 0.15s",whiteSpace:"nowrap"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.1)";e.currentTarget.style.color="#fff";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.color="#ffffff66";}}
          >
            {icon} {lbl}
            {badge&&<span style={{position:"absolute",top:-6,right:-6,background:"#ff2d55",color:"#fff",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{badge}</span>}
          </button>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        {/* Balance — display only */}
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70022",borderRadius:8}}>
          <span style={{fontSize:13}}>🏦</span>
          <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:13}}>${fmt2(user.balance)}</span>
        </div>
        <UserMenu avatar={avatar} user={user} onProfile={onProfile} onBank={onBank} onHowTo={onHowTo} onPrivateRaces={onPrivateRaces} onLogout={onLogout}/>
        <MuteButton/>
      </div>
    </div>
  );
}

// ─── MODAL WRAPPER ────────────────────────────────────────────────────────────
function Modal({ title, accent="#00f5ff", onClose, children, wide }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(8,8,26,0.95)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:wide?680:500,background:"rgba(12,12,36,0.98)",border:`1px solid ${accent}33`,borderRadius:16,padding:28,maxHeight:"85vh",overflow:"auto",animation:"slideIn 0.2s ease-out"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{fontFamily:"'Orbitron',monospace",color:accent,fontSize:17,letterSpacing:3,textShadow:`0 0 12px ${accent}`}}>{title}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#ffffff44",fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── MY BETS PANEL ────────────────────────────────────────────────────────────
function MyBetsPanel({ username, uid, schedule, auctionSchedule, now, onClose, onGoToRace, userBalance, onBalanceChange }) {
  const [tab, setTab] = useState("active");
  const [pending, setPending] = useState(getPending());
  const [history, setHistory] = useState(null);
  const [replayRace, setReplayRace] = useState(null);

  // Load history when History tab opened
  useEffect(()=>{
    if(tab === "history" && history === null && uid) {
      fbGetHistory(uid).then(h => setHistory([...h].reverse())); // newest first
    }
  }, [tab, uid]);

  const myRaces = useMemo(()=>{
    const result=[];
    const confirmed=getConfirmed();
    Object.entries(pending).forEach(([raceId,horseBets])=>{
      const race=schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
      if(!race) return;
      const st=raceStatus(race,now);
      if(st==="finished") return;
      const totalBet=Object.values(horseBets).reduce((s,v)=>s+(parseFloat(v)||0),0);
      result.push({race,horseBets,totalBet,st,isConfirmed:false});
    });
    Object.entries(confirmed).forEach(([raceId,data])=>{
      if(result.find(r=>r.race.id===raceId)) return;
      const race=schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
      if(!race) return;
      const st=raceStatus(race,now);
      if(st==="finished") return;
      result.push({race,horseBets:data.bets,totalBet:data.pot,st,isConfirmed:true});
    });
    return result.sort((a,b)=>a.race.startTime-b.race.startTime);
  },[pending,schedule,now]);

  const updateBet=(raceId,horseId,val)=>{
    const p=getPending();
    if(!p[raceId]) p[raceId]={};
    if(!val||parseFloat(val)<=0) { delete p[raceId][horseId]; if(!Object.keys(p[raceId]).length) delete p[raceId]; }
    else p[raceId][horseId]=parseFloat(val);
    savePending(p); setPending({...p});
  };

  const removeBet=(raceId)=>{
    const p=getPending(); delete p[raceId]; savePending(p); setPending({...p});
  };

  const totalLockedOut = useMemo(()=>{
    let t=0;
    Object.entries(pending).forEach(([raceId,hb])=>{
      const race=schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
      if(!race) return;
      const st=raceStatus(race,now);
      if(st==="betting"||st==="locked"||st==="racing") t+=Object.values(hb).reduce((s,v)=>s+(parseFloat(v)||0),0);
    });
    return t;
  },[pending,schedule,now]);

  // Group history by race for display
  const historyByRace = useMemo(()=>{
    if(!history) return [];
    const map = {};
    const seen = new Set(); // deduplicate by raceId+horseId
    history.forEach(h => {
      const key = h.raceId || (h.raceName + "_" + Math.floor((h.time||0)/60000));
      const entryKey = key + "_" + h.horseId;
      if(seen.has(entryKey)) return; // skip duplicate
      seen.add(entryKey);
      if(!map[key]) map[key] = { raceName:h.raceName, raceType:h.raceType, time:h.time, bets:[], won:false, totalPayout:0, totalBet:0 };
      map[key].bets.push(h);
      map[key].totalBet += parseFloat(h.amount)||0;
      if(h.won) { map[key].won = true; map[key].totalPayout += parseFloat(h.payout)||0; }
    });
    return Object.values(map).sort((a,b)=>(b.time||0)-(a.time||0));
  }, [history]);

  return (
    <Modal title="🎫 BETS" accent="#00f5ff" onClose={onClose} wide>
      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:18,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:12}}>
        {[["active","Active Bets"],["history","History"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 18px",borderRadius:8,border:"none",cursor:"pointer",background:tab===id?"rgba(0,245,255,0.15)":"rgba(255,255,255,0.04)",color:tab===id?"#00f5ff":"#ffffff55",fontFamily:"'Orbitron',monospace",fontSize:11,letterSpacing:1,fontWeight:700,borderBottom:tab===id?"2px solid #00f5ff":"2px solid transparent",transition:"all 0.15s"}}>
            {lbl}{id==="active"&&myRaces.length>0?<span style={{marginLeft:6,background:"#ff2d55",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:9}}>{myRaces.length}</span>:null}
          </button>
        ))}
      </div>

      {/* Balance */}
      <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(255,215,0,0.05)",border:"1px solid #ffd70022",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#ffffff55",fontSize:13}}>Balance</span>
        <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:16}}>${fmt2(userBalance)}</span>
      </div>

      {/* ── ACTIVE BETS TAB ── */}
      {tab==="active" && <>
        {myRaces.length===0 && <p style={{color:"#ffffff33",textAlign:"center",padding:40}}>No active bets. Head to the lobby to place some!</p>}
        {myRaces.map(({race,horseBets,totalBet,st,isConfirmed})=>{
          const rt=RACE_TYPES[race.type];
          const secsToStart=Math.floor((race.startTime-now)/1000);
          const canEdit=st==="betting" && !isConfirmed;
          return (
            <div key={race.id} style={{marginBottom:16,padding:"14px 16px",background:"rgba(255,255,255,0.03)",border:`1px solid ${rt.color}33`,borderRadius:12,animation:"slideIn 0.2s ease-out"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8,flexWrap:"wrap"}}>
                <div>
                  <div style={{color:"#fff",fontWeight:700,fontSize:15}}>{rt.icon} {race.name}</div>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginTop:3,flexWrap:"wrap"}}>
                    <span style={{color:rt.color,fontSize:12,fontWeight:600}}>{rt.label}</span>
                    {isConfirmed
                      ? <span style={{background:"rgba(0,245,255,0.12)",border:"1px solid #00f5ff33",borderRadius:10,padding:"1px 8px",color:"#00f5ff",fontSize:10,fontWeight:700,letterSpacing:1}}>✓ LOCKED IN</span>
                      : <span style={{background:"rgba(255,215,0,0.1)",border:"1px solid #ffd70033",borderRadius:10,padding:"1px 8px",color:"#ffd700",fontSize:10,fontWeight:700,letterSpacing:1}}>DRAFT</span>
                    }
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  {st==="betting" && <div style={{color:"#39ff14",fontSize:12,fontFamily:"'Orbitron',monospace"}}>OPEN — {fmtCD(secsToStart)}</div>}
                  {st==="locked"  && <div style={{color:"#ffd700",fontSize:12,fontFamily:"'Orbitron',monospace"}}>LOCKED 🔒</div>}
                  {st==="racing"  && <div style={{color:"#ff2d55",fontSize:12,fontFamily:"'Orbitron',monospace",animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                  {st==="upcoming"&& <div style={{color:"#ffffff55",fontSize:12,fontFamily:"'Orbitron',monospace"}}>{fmtCD(secsToStart)}</div>}
                  <div style={{color:"#ffffff44",fontSize:11,marginTop:2}}>🕐 {fmtTime(new Date(race.startTime))}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                {Object.entries(horseBets).map(([hid,amt])=>{
                  const h=HORSES[parseInt(hid)];
                  return (
                    <div key={hid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:`1px solid ${h.color}33`}}>
                      <div style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:`${h.color}18`,border:`1.5px solid ${h.color}`,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
                      <HorseName race={race} horseId={h.id} style={{flex:1,color:h.color,fontWeight:600,fontSize:13}}/>
                      {canEdit ? (
                        <>
                          <div style={{position:"relative"}}>
                            <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#ffd70077",fontSize:13,pointerEvents:"none"}}>$</span>
                            <input type="number" min="1" value={amt} onChange={e=>updateBet(race.id,hid,e.target.value)}
                              style={{width:80,padding:"6px 6px 6px 20px",background:"rgba(255,255,255,0.07)",border:"1px solid #ffffff18",borderRadius:6,color:"#fff",fontSize:14,outline:"none"}}/>
                          </div>
                          <button onClick={()=>updateBet(race.id,hid,"")} style={{background:"rgba(255,45,85,0.15)",border:"1px solid #ff2d5533",borderRadius:6,color:"#ff2d55",padding:"5px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                        </>
                      ) : (
                        <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:14}}>${fmt2(parseFloat(amt))}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <span style={{color:"#ffffff55",fontSize:12}}>Total: <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace"}}>${fmt2(totalBet)}</span></span>
                <div style={{display:"flex",gap:8}}>
                  {canEdit && !isConfirmed && <button onClick={()=>removeBet(race.id)} style={{background:"rgba(255,45,85,0.1)",border:"1px solid #ff2d5533",borderRadius:7,color:"#ff2d55",padding:"6px 12px",cursor:"pointer",fontSize:12,letterSpacing:1}}>✕ Remove</button>}
                  <button onClick={()=>{onClose();onGoToRace(race);}} style={{background:`${rt.color}18`,border:`1px solid ${rt.color}44`,borderRadius:7,color:rt.color,padding:"6px 12px",cursor:"pointer",fontSize:12,letterSpacing:1}}>View Race →</button>
                </div>
              </div>
            </div>
          );
        })}
      </>}

      {/* ── HISTORY TAB ── */}
      {tab==="history" && <>
        {history===null && <div style={{textAlign:"center",padding:40,color:"#ffffff33"}}>Loading...</div>}
        {history!==null && historyByRace.length===0 && <div style={{textAlign:"center",padding:40,color:"#ffffff33"}}>No race history yet.</div>}
        {history!==null && historyByRace.map((race,i)=>{
          const rt = RACE_TYPES[race.raceType] || RACE_TYPES.standard;
          const net = race.totalPayout - race.totalBet;
          return (
            <div key={i} style={{marginBottom:12,padding:"13px 16px",background:"rgba(255,255,255,0.03)",border:`1px solid ${race.won?"#39ff1433":"#ff2d5522"}`,borderRadius:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{rt.icon} {race.raceName||"Race"}</div>
                  <div style={{color:rt.color,fontSize:11,fontWeight:600,marginTop:2}}>{rt.label}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'Orbitron',monospace",fontSize:14,fontWeight:900,color:race.won?"#39ff14":"#ff2d55"}}>{race.won?`+$${fmt2(race.totalPayout)}`:"Lost"}</div>
                  <div style={{color:"#ffffff33",fontSize:10,marginTop:2}}>{race.time ? new Date(race.time).toLocaleDateString()+' '+new Date(race.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : ""}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {race.bets.map((b,bi)=>{
                  const h=HORSES[b.horseId]||HORSES[0];
                  return (
                    <div key={bi} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:"rgba(255,255,255,0.02)",borderRadius:6,border:`1px solid ${h.color}22`}}>
                      <span style={{color:h.color,fontSize:11,fontWeight:700,flex:1}}>{h.name}</span>
                      <span style={{color:"#ffffff55",fontSize:11}}>Bet ${fmt2(b.amount)}</span>
                      {b.odds&&<span style={{color:"#ffffff33",fontSize:10}}>{b.odds}x</span>}
                      {b.won
                        ? <span style={{color:"#39ff14",fontSize:11,fontWeight:700}}>✓ +${fmt2(b.payout)}</span>
                        : <span style={{color:"#ff2d5566",fontSize:11}}>✗</span>
                      }
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <span style={{color:"#ffffff44",fontSize:11}}>Total bet: <span style={{color:"#ffd700"}}>${fmt2(race.totalBet)}</span></span>
                  <span style={{color:"#ffffff44",fontSize:11,marginLeft:12}}>Net: <span style={{color:net>=0?"#39ff14":"#ff2d55",fontWeight:700}}>{net>=0?"+":""}${fmt2(net)}</span></span>
                </div>
                {race.bets[0]?.raceId && (
                  <button onClick={()=>{
                    const raceId = race.bets[0].raceId;
                    const found = schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
                    setReplayRace(found || { id:raceId, name:race.raceName, type:race.raceType||"standard", condition:"sunny", seed:1, startTime:race.time||Date.now() });
                  }} style={{padding:"4px 10px",background:"rgba(191,95,255,0.1)",border:"1px solid #bf5fff33",borderRadius:7,color:"#bf5fff",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0}}>
                    📼 Replay
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </>}
      {replayRace && <RaceReplayScreen race={replayRace} onClose={()=>setReplayRace(null)}/>}
    </Modal>
  );
}

// ─── LOBBY ────────────────────────────────────────────────────────────────────
// ─── AUCTION RACE SCREEN ──────────────────────────────────────────────────────
const AUCTION_OPEN_SECS = 3 * 60;   // auction opens 3 min before race
const AUCTION_BID_SECS  = 30;       // 30s per horse
const AUCTION_SOLD_SECS = 2.5;      // sold animation hold
const AUCTION_MIN_BID   = 5;        // $5 starting bid

function AuctionRaceScreen({ race, user, now, onBack, onRaceStart, confirmedBets, confirmedPot, onConfirmBets }) {
  const rt = RACE_TYPES[race.type]||RACE_TYPES.standard;

  // ── Pure timing derived from race.startTime ─────────────────────────────────
  // race.startTime = auction END. Auction opens 180s before that.
  // Presentation window: startTime → startTime+30s
  // Race fires: startTime+30s
  const TOTAL_AUCTION  = AUCTION_BID_SECS * 6; // 180s
  const PRESENT_SECS   = 30;
  const auctionOpenAt  = race.startTime - TOTAL_AUCTION * 1000;
  const raceFiresAt    = race.startTime + PRESENT_SECS * 1000;
  const elapsedSecs    = (now - auctionOpenAt) / 1000;
  const secsToAuctionEnd = (race.startTime - now) / 1000;
  const secsToRaceFire   = (raceFiresAt - now) / 1000;

  const preAuction  = elapsedSecs < 0;
  const inAuction   = elapsedSecs >= 0 && secsToAuctionEnd > 0;
  const inOdds      = secsToAuctionEnd <= 0 && secsToRaceFire > 0;
  const raceStarted = secsToRaceFire <= 0;

  const currentSlot    = inAuction ? Math.min(5, Math.floor(elapsedSecs / AUCTION_BID_SECS)) : 6;
  const slotElapsed    = inAuction ? elapsedSecs % AUCTION_BID_SECS : 0;
  const slotTimeLeft   = Math.max(0, AUCTION_BID_SECS - slotElapsed);
  const currentHorseId = race.horseOrder?.[currentSlot] ?? currentSlot;
  const currentHorse   = HORSES[currentHorseId] || HORSES[0];

  // ── Auction data — real-time from Firestore ──────────────────────────────
  const [aData, setAData] = useState({owners:{},bids:{},pot:0});
  const [tab, setTab]     = useState("auction");
  const [bidAmount, setBidAmount] = useState("");
  const [soldAnim, setSoldAnim]   = useState(null);
  const soldAnimTimer   = useRef(null);

  const getLiveSlot = () => {
    const auctOpen = race.startTime - TOTAL_AUCTION * 1000;
    const elapsed  = (Date.now() - auctOpen) / 1000;
    const toEnd    = (race.startTime - Date.now()) / 1000;
    const live     = elapsed >= 0 && toEnd > 0;
    return live ? Math.min(5, Math.floor(elapsed / AUCTION_BID_SECS)) : (elapsed < 0 ? -1 : 6);
  };

  const shownUpToSlot = useRef(getLiveSlot());

  // Real-time Firestore listener for auction data
  useEffect(() => {
    const auctRef = doc(db, "global", "auctions");
    const unsub = onSnapshot(auctRef, (snap) => {
      if(snap.exists()) {
        const allAuctions = snap.data().data || {};
        const d = allAuctions[race.id] || {owners:{},bids:{},pot:0};
        setAData({...d});
      }
    });
    return () => unsub();
  }, [race.id]);

  // Slot transition timer — fires SOLD anim when slot ends
  useEffect(()=>{
    const fireAnim = (animSlot, currentData)=>{
      const hid = race.horseOrder?.[animSlot] ?? animSlot;
      const bids = currentData.bids?.[hid]||{};
      const entries = Object.entries(bids).sort((x,y)=>y[1]-x[1]);
      const winner = entries[0]?.[0]||null;
      const winAmt = entries[0]?.[1]||0;
      if(soldAnimTimer.current) clearTimeout(soldAnimTimer.current);
      setSoldAnim({hi:hid, winner, winAmt, noSale:!winner});
      soldAnimTimer.current = setTimeout(()=>setSoldAnim(null), 2800);
      setBidAmount("");
      // Finalize owner in Firestore (only if not already set)
      fbGetAuctions().then(allA => {
        const d = {...(allA[race.id]||{})};
        if(d.owners?.[hid] !== undefined) return; // already finalized
        if(!d.owners) d.owners = {};
        d.owners[hid] = winner ? {username:winner, amount:winAmt} : null;
        if(winner) d.pot = (d.pot||0) + winAmt;
        allA[race.id] = d;
        fbSaveAuctions(allA);
      });
    };

    const tick = ()=>{
      const liveSlot = getLiveSlot();
      while(shownUpToSlot.current < liveSlot && shownUpToSlot.current < 6){
        const ended = shownUpToSlot.current;
        shownUpToSlot.current = ended + 1;
        fireAnim(ended, aData);
      }
    };

    const t = setInterval(tick, 500);
    return ()=>clearInterval(t);
  },[race.id, race.startTime, race.horseOrder, aData]);

  // Finalize all owners at auction end
  useEffect(()=>{
    if(inOdds || raceStarted) {
      fbGetAuctions().then(allA => {
        const d = {...(allA[race.id]||{})};
        let changed = false;
        for(let s=0;s<6;s++){
          const hid = race.horseOrder?.[s]??s;
          if(d.owners?.[hid] === undefined) {
            const horseBids = d.bids?.[hid]||{};
            const entries = Object.entries(horseBids).sort((a,b)=>b[1]-a[1]);
            if(!d.owners) d.owners={};
            d.owners[hid] = entries[0] ? {username:entries[0][0],amount:entries[0][1]} : null;
            if(entries[0]) d.pot=(d.pot||0)+entries[0][1];
            changed=true;
          }
        }
        if(changed){ allA[race.id]=d; fbSaveAuctions(allA); }
      });
    }
  },[inOdds, raceStarted]);

  const horseBids    = aData.bids?.[currentHorseId]||{};
  const bidEntries   = Object.entries(horseBids).sort((a,b)=>b[1]-a[1]);
  const topBid       = bidEntries[0];
  // Check ownership — both finalized owners AND if user is leading bid on any PAST slot
  const iOwn = Object.values(aData.owners||{}).find(o=>o?.username===user.username) ||
    (()=>{
      for(let s=0;s<currentSlot;s++){
        const hid=race.horseOrder?.[s]??s;
        const bids=aData.bids?.[hid]||{};
        const top=Object.entries(bids).sort((a,b)=>b[1]-a[1])[0];
        if(top?.[0]===user.username) return {username:user.username,amount:top[1]};
      }
      return null;
    })();
  const auctionPot   = aData.pot||0;
  const myMinBid     = Math.max(AUCTION_MIN_BID, (topBid?.[1]||0)+1);
  const canBid       = inAuction && !iOwn && topBid?.[0]!==user.username && currentSlot < 6;
  const timerPct     = slotTimeLeft / AUCTION_BID_SECS;
  const timerColor   = slotTimeLeft<=5?"#ff2d55":slotTimeLeft<=10?"#ffd700":"#00f5ff";

  const doBid = async () => {
    const amt = parseFloat(bidAmount);
    if(isNaN(amt)||amt<myMinBid){ sfx.error(); return; }
    if(amt>user.balance){ sfx.error(); return; }
    setBidAmount(""); sfx.betConfirm();
    // Atomic bid write to Firestore
    const auctRef = doc(db, "global", "auctions");
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(auctRef);
      const allA = snap.exists() ? (snap.data().data || {}) : {};
      const d = {...(allA[race.id]||{owners:{},bids:{},pot:0})};
      const horseBids = {...(d.bids?.[currentHorseId]||{})};
      // Only allow if still in correct slot and bid is still highest
      const topBidNow = Math.max(0, ...Object.values(horseBids).map(Number));
      if(amt <= topBidNow) return; // outbid already, skip
      horseBids[user.username] = amt;
      d.bids = {...(d.bids||{}), [currentHorseId]: horseBids};
      allA[race.id] = d;
      tx.set(auctRef, {data: allA});
    });
  };

  // Regular bets — restore from confirmed store if already placed
  const [localBets, setLocalBets] = useState(()=>{
    // Use Firestore-backed confirmedBets prop first, fall back to localStorage
    if(confirmedBets && Object.keys(confirmedBets).length > 0) return {...confirmedBets};
    const c = getConfirmed()[race.id];
    return c?.bets || {};
  });
  const [betsConfirmed, setBetsConfirmed] = useState(()=>{
    return (confirmedBets && Object.keys(confirmedBets).length > 0) || !!getConfirmed()[race.id];
  });
  const saveBet=(hid,val)=>setLocalBets(b=>({...b,[hid]:val}));
  const confirmBets=()=>{
    const cleaned={}; let pot=0;
    Object.entries(localBets).forEach(([hid,v])=>{const n=parseFloat(v);if(n>0){cleaned[hid]=n;pot+=n;}});
    if(pot===0){sfx.error();return;}
    if(pot>user.balance){sfx.error();return;}
    onConfirmBets(cleaned,pot,confirmedPot||0);
    setBetsConfirmed(true);
    sfx.betConfirm();
  };

  // ── Odds/owners reveal (same 30s window as regular races) ───────────────────
  // oddsRevealSecs: 0 when auction ends, grows to PRESENT_SECS as race approaches
  const oddsRevealSecs = Math.min(PRESENT_SECS, Math.max(0, -secsToAuctionEnd));
  const timerColorOdds = oddsRevealSecs>20?"#ff2d55":oddsRevealSecs>10?"#ffd700":"#00f5ff";
  const revealCount    = Math.min(6, Math.floor(oddsRevealSecs/5)+1);

  // Auto-fire race — only once, guarded by ref
  const firedRaceRef = useRef(false);
  useEffect(()=>{
    if(raceStarted && !firedRaceRef.current){
      firedRaceRef.current = true;
      onRaceStart();
    }
  },[raceStarted]);

  return (
    <div style={{minHeight:"100vh",background:"#08081a",paddingTop:68,paddingBottom:40}}>
      <div style={{maxWidth:600,margin:"0 auto",padding:"0 16px"}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#ffffff44",cursor:"pointer",fontSize:13,margin:"12px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>

        {/* Header */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:28}}>{rt.icon}</div>
          <h2 style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:16,letterSpacing:3,marginBottom:2}}>{race.name}</h2>
          <div style={{color:"#ffd700",fontSize:11,letterSpacing:2,fontWeight:700}}>🔨 AUCTION RACE</div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {["auction","bets"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${tab===t?"#ffd70066":"#ffffff15"}`,background:tab===t?"rgba(255,215,0,0.08)":"transparent",color:tab===t?"#ffd700":"#ffffff55",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontSize:10,letterSpacing:0,fontWeight:700}}>
              {t==="auction"?"🔨 AUCTION":"💰 BETTING"}
            </button>
          ))}
        </div>

        {/* ── ODDS/OWNERS REVEAL after auction ends ── */}
        {(inOdds||raceStarted) && (
          <div style={{padding:"20px 0 28px"}}>
            <div style={{position:"relative",width:120,height:120,margin:"0 auto 16px",textAlign:"center"}}>
              <svg width="120" height="120" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
                <circle cx="60" cy="60" r="52" fill="none" stroke={timerColorOdds} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${2*Math.PI*52}`}
                  strokeDashoffset={`${2*Math.PI*52*(Math.max(0,secsToRaceFire)/PRESENT_SECS)}`}
                  style={{transition:"stroke-dashoffset 1s linear",filter:`drop-shadow(0 0 6px ${timerColorOdds})`}}/>
              </svg>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontFamily:"'Orbitron',monospace",color:timerColorOdds,fontSize:32,fontWeight:900,lineHeight:1}}>{Math.max(0,Math.ceil(secsToRaceFire))}</div>
                <div style={{color:"#ffffff44",fontSize:9,letterSpacing:2,marginTop:2}}>SECONDS</div>
              </div>
            </div>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff55",fontSize:11,letterSpacing:3,marginBottom:20,animation:"racingBlink 1s infinite",textAlign:"center"}}>RACE STARTING</div>
            {/* Both pots */}
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10}}>
                <span style={{color:"#ffffff66",fontSize:10,letterSpacing:1}}>🔨 AUCTION</span>
                <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:15,fontWeight:900}}>${fmt2(auctionPot)}</span>
              </div>
              {confirmedPot>0&&(
                <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(0,245,255,0.06)",border:"1px solid #00f5ff33",borderRadius:10}}>
                  <span style={{color:"#ffffff66",fontSize:10,letterSpacing:1}}>💰 BETS</span>
                  <span style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:15,fontWeight:900}}>${fmt2(confirmedPot)}</span>
                </div>
              )}
            </div>

            {/* Owners reveal — stage swipe then drop into list */}
            <div style={{width:"100%"}}>
              <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:10,textAlign:"left"}}>HORSE OWNERS</div>
              {/* Stage — newest card swipes in */}
              <div style={{position:"relative",height:60,marginBottom:8,overflow:"hidden"}}>
                {HORSES.map((h,hi)=>{
                  const isNewest = hi === revealCount - 1;
                  const owner = aData.owners?.[hi];
                  if(!isNewest || revealCount===0) return null;
                  return (
                    <div key={hi+"-stage"} style={{position:"absolute",inset:0,animation:"oddsSwipeAcross 1.4s cubic-bezier(0.22,1,0.36,1) forwards"}}>
                      {(()=>{
                        const confirmedData=getConfirmed()[race.id];
                        const pot=confirmedData?.pot||0;
                        const horseBets=confirmedData?.bets||{};
                        const betAmt=parseFloat(horseBets[h.id]||0);
                        const odds=betAmt>0&&pot>0?parseFloat((pot/betAmt).toFixed(2)):null;
                        return (
                          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:`${h.color}12`,border:`1px solid ${h.color}88`,borderRadius:10,boxShadow:`0 0 16px ${h.color}33`}}>
                            <div style={{width:28,height:28,borderRadius:"50%",background:`${h.color}18`,border:`1.5px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>🐴</div>
                            <div style={{flex:1}}>
                              <div style={{color:h.color,fontWeight:700,fontSize:13}}>{race.horses?.[hi]||h.name}</div>
                              {owner
                                ? <div style={{color:owner.username===user.username?"#39ff14":"#ffffff66",fontSize:11,marginTop:1}}>🔨 {owner.username} · <span style={{color:"#ffd700"}}>${fmt2(owner.amount)}</span></div>
                                : <div style={{color:"#ff2d55",fontSize:11,marginTop:1}}>🏚 HOUSE</div>
                              }
                            </div>
                            {odds&&<div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:16,fontWeight:900}}>{odds.toFixed(2)}x</div>
                              <div style={{color:"#00f5ff",fontSize:10,marginTop:1}}>💰${fmt2(betAmt)}</div>
                            </div>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
              {/* List — previous cards dropped in */}
              {HORSES.map((h,hi)=>{
                const inList = hi < revealCount - 1;
                const owner = aData.owners?.[hi];
                if(!inList) return null;
                return (
                  <div key={hi+"-list"} style={{marginBottom:5,animation:"oddsDropDown 0.4s ease-out forwards"}}>
                    {(()=>{
                      const confirmedData=getConfirmed()[race.id];
                      const pot=confirmedData?.pot||0;
                      const horseBets=confirmedData?.bets||{};
                      const betAmt=parseFloat(horseBets[h.id]||0);
                      const odds=betAmt>0&&pot>0?parseFloat((pot/betAmt).toFixed(2)):null;
                      return (
                        <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:`${h.color}0d`,border:`1px solid ${h.color}22`,borderRadius:8}}>
                          <div style={{width:20,height:20,borderRadius:"50%",background:`${h.color}18`,border:`1.5px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>🐴</div>
                          <div style={{flex:1}}>
                            <div style={{color:h.color,fontWeight:700,fontSize:11}}>{race.horses?.[hi]||h.name}</div>
                            {owner
                              ? <div style={{color:owner.username===user.username?"#39ff14":"#ffffff44",fontSize:10}}>🔨 {owner.username}</div>
                              : <div style={{color:"#ff2d5544",fontSize:10}}>🏚 HOUSE</div>
                            }
                          </div>
                          {odds&&<span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:12,fontWeight:900}}>{odds.toFixed(2)}x</span>}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AUCTION TAB ── */}
        {tab==="auction" && !inOdds && !raceStarted && (
          <div>
            {/* Pot */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10,marginBottom:16}}>
              <span style={{color:"#ffffff66",fontSize:11,letterSpacing:2}}>AUCTION POT</span>
              <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:18,fontWeight:900}}>${fmt2(auctionPot)}</span>
            </div>

            {/* Pre-auction countdown */}
            {preAuction && (
              <div style={{textAlign:"center",padding:"40px 20px"}}>
                <div style={{fontSize:40,marginBottom:12}}>🔨</div>
                <div style={{fontFamily:"'Orbitron',monospace",fontSize:12,letterSpacing:2,color:"#ffffff55",marginBottom:8}}>AUCTION OPENS IN</div>
                <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:36,fontWeight:900}}>{fmtCD(Math.abs(elapsedSecs))}</div>
                <div style={{color:"#ffffff33",fontSize:11,marginTop:12}}>6 horses · $5 starting bid · 30s each</div>
                <div style={{marginTop:24}}>
                  <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:8}}>AUCTION ORDER</div>
                  {(race.horseOrder||[0,1,2,3,4,5]).map((hi,i)=>{
                    const h=HORSES[hi];
                    return (
                      <div key={hi} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid #ffffff08",borderRadius:7,marginBottom:4}}>
                        <span style={{color:"#ffffff22",fontSize:11,width:14}}>{i+1}</span>
                        <div style={{width:8,height:8,borderRadius:"50%",background:h.color}}/>
                        <span style={{color:"#ffffff66",fontSize:12,flex:1}}>{race.horses?.[hi]||h.name}</span>
                        <span style={{color:"#ffffff33",fontSize:11}}>min ${AUCTION_MIN_BID}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SOLD animation */}
            {soldAnim && (
              <div style={{textAlign:"center",padding:"20px",marginBottom:16,background:"rgba(0,0,0,0.7)",borderRadius:16,border:`1px solid ${soldAnim.winner?"#ffd70044":"#ff2d5544"}`,animation:"tieFlash 2.5s ease-out forwards"}}>
                <div style={{fontSize:44,marginBottom:4}}>{soldAnim.winner?"🔨":"🏚"}</div>
                <div style={{fontFamily:"'Orbitron',monospace",fontSize:32,fontWeight:900,letterSpacing:4,color:soldAnim.winner?"#ffd700":"#ff2d55",textShadow:soldAnim.winner?"0 0 30px #ffd700":"0 0 20px #ff2d55",marginBottom:8}}>
                  {soldAnim.winner?"SOLD!":"NO SALE"}
                </div>
                {soldAnim.winner?(
                  <>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:HORSES[soldAnim.hi]?.color,boxShadow:`0 0 10px ${HORSES[soldAnim.hi]?.color}`}}/>
                      <span style={{color:"#fff",fontSize:14}}>{race.horses?.[soldAnim.hi]||HORSES[soldAnim.hi]?.name}</span>
                    </div>
                    <div style={{color:"#ffffff88",fontSize:13,marginBottom:4}}>🏇 {soldAnim.winner}</div>
                    <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:24,fontWeight:900}}>${fmt2(soldAnim.winAmt)}</div>
                  </>
                ):(
                  <div style={{color:"#ffffff44",fontSize:12}}>Goes to the house if this horse wins</div>
                )}
              </div>
            )}

            {/* Active bidding */}
            {inAuction && currentSlot < 6 && !soldAnim && (
              <div>
                {/* Progress bar */}
                <div style={{display:"flex",gap:3,marginBottom:14}}>
                  {Array.from({length:6}).map((_,i)=>{
                    const hid=race.horseOrder?.[i]??i;
                    const owned=aData.owners?.[hid];
                    return <div key={i} style={{flex:1,height:4,borderRadius:2,background:
                      i<currentSlot?(owned?"#39ff14":"#ff2d5544"):
                      i===currentSlot?currentHorse.color:"#ffffff11"}}/>;
                  })}
                </div>
                <div style={{textAlign:"center",color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:12}}>HORSE {currentSlot+1} OF 6</div>

                {/* Horse card */}
                <div style={{padding:"20px",background:`${currentHorse.color}0d`,border:`2px solid ${currentHorse.color}55`,borderRadius:16,marginBottom:14,textAlign:"center",position:"relative"}}>
                  {/* Timer */}
                  <div style={{position:"absolute",top:12,right:12}}>
                    <svg width="44" height="44" style={{transform:"rotate(-90deg)"}}>
                      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
                      <circle cx="22" cy="22" r="18" fill="none" stroke={timerColor} strokeWidth="4"
                        strokeDasharray={`${2*Math.PI*18}`}
                        strokeDashoffset={`${2*Math.PI*18*(1-timerPct)}`}
                        style={{transition:"stroke-dashoffset 0.5s linear",filter:`drop-shadow(0 0 4px ${timerColor})`}}/>
                    </svg>
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Orbitron',monospace",color:timerColor,fontSize:12,fontWeight:900}}>{Math.ceil(slotTimeLeft)}</div>
                  </div>

                  <div style={{fontSize:44,marginBottom:8}}>🐴</div>
                  <div style={{color:currentHorse.color,fontWeight:700,fontSize:18,marginBottom:12}}>{race.horses?.[currentHorseId]||currentHorse.name}</div>

                  {/* High bid */}
                  {topBid?(
                    <>
                      <div style={{color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:2}}>CURRENT BID</div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:28,fontWeight:900,textShadow:"0 0 16px #ffd70066"}}>${fmt2(topBid[1])}</div>
                      <div style={{color:topBid[0]===user.username?"#39ff14":"#ffffff66",fontSize:12,marginTop:2,marginBottom:12}}>
                        {topBid[0]===user.username?"✓ YOU — HIGH BIDDER":topBid[0]}
                      </div>
                    </>
                  ):(
                    <>
                      <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:2}}>STARTING BID</div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff44",fontSize:28,fontWeight:900,marginBottom:12}}>${fmt2(AUCTION_MIN_BID)}</div>
                    </>
                  )}

                  {/* Bid input */}
                  {canBid&&(
                    <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1,position:"relative"}}>
                        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#ffd70066",fontSize:14,pointerEvents:"none"}}>$</span>
                        <input type="number" min={myMinBid} placeholder={`min $${myMinBid}`} value={bidAmount}
                          onChange={e=>setBidAmount(e.target.value)}
                          onKeyDown={e=>e.key==="Enter"&&doBid()}
                          style={{width:"100%",padding:"10px 10px 10px 24px",background:"rgba(255,255,255,0.07)",border:"1px solid #ffd70033",borderRadius:8,color:"#fff",fontSize:16,outline:"none",boxSizing:"border-box"}}/>
                      </div>
                      <button onClick={doBid} style={{padding:"10px 18px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ffd700,#ff6b00)",color:"#000",fontFamily:"'Orbitron',monospace",fontWeight:900,fontSize:13,cursor:"pointer"}}>BID</button>
                    </div>
                  )}
                  {iOwn&&<div style={{color:"#39ff14",fontSize:13,fontWeight:700,marginTop:8}}>✓ You own a horse — watching only</div>}
                  {!canBid&&!iOwn&&topBid?.[0]===user.username&&<div style={{color:"#ffd700",fontSize:12,marginTop:8}}>You are the high bidder</div>}
                </div>

                {/* Bids list */}
                {bidEntries.length>0&&(
                  <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                    <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:8}}>ALL BIDS</div>
                    {bidEntries.map(([uname,amt],i)=>(
                      <div key={uname} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<bidEntries.length-1?"1px solid #ffffff08":"none"}}>
                        <span style={{color:uname===user.username?"#39ff14":"#ffffff88",fontSize:13}}>{i===0?"👑 ":""}{uname}</span>
                        <span style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:13}}>${fmt2(amt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BETTING TAB ── */}
        {tab==="bets" && !inOdds && !raceStarted && (()=>{
          const totalBetAmt = Object.values(localBets).reduce((s,v)=>s+(parseFloat(v)||0),0);
          const overBalance = totalBetAmt > user.balance;
          // Bets close when race starts (secsToAuctionEnd counts down to 0 at race startTime)
          const betsCloseIn = Math.max(0, secsToAuctionEnd);
          const bettingPct  = Math.min(100, (betsCloseIn / (30*60)) * 100);
          return (
            <div>
              {/* BETS CLOSE timer bar */}
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{color:"#ffffff44",fontSize:12,letterSpacing:2}}>BETS CLOSE IN</span>
                  <span style={{fontFamily:"'Orbitron',monospace",color:betsCloseIn<120?"#ff2d55":"#ffd700",fontSize:15,textShadow:betsCloseIn<120?"0 0 12px #ff2d55":"none"}}>{fmtCD(betsCloseIn)}</span>
                </div>
                <div style={{height:7,background:"rgba(255,255,255,0.07)",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:4,width:`${bettingPct}%`,background:betsCloseIn<120?"linear-gradient(90deg,#ff2d55,#ff6b00)":"linear-gradient(90deg,#00f5ff,#39ff14)",boxShadow:`0 0 8px ${betsCloseIn<120?"#ff2d55":"#00f5ff"}`,transition:"width 1s linear"}}/>
                </div>
              </div>

              {/* Total bet */}
              <div style={{textAlign:"center",marginBottom:14,padding:"10px",background:"rgba(255,215,0,0.05)",border:"1px solid #ffd70022",borderRadius:10}}>
                <span style={{color:"#ffffff44",fontSize:12,letterSpacing:2}}>TOTAL BET </span>
                <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:20}}>${fmt2(totalBetAmt)}</span>
              </div>

              {/* Horse cards */}
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {HORSES.map((h,i)=>{
                  const val = localBets[h.id]||"";
                  const betNum = parseFloat(val)||0;
                  return (
                    <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:`1px solid ${betNum>0?h.color+"55":"rgba(255,255,255,0.06)"}`,boxShadow:betNum>0?`0 0 16px ${h.color}14`:"none",transition:"all 0.2s"}}>
                      <div style={{width:38,height:38,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,background:`${h.color}15`,border:`2px solid ${h.color}`,boxShadow:`0 0 8px ${h.color}44`,flexShrink:0}}>🐴</div>
                      <div style={{flex:1}}>
                        <div style={{color:h.color,fontWeight:700,fontSize:14,letterSpacing:1}}>{race.horses?.[i]||h.name}</div>
                      </div>
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <div style={{position:"relative"}}>
                          <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#ffd70066",fontSize:13,pointerEvents:"none"}}>$</span>
                          <input type="number" min="0" placeholder="0" value={val}
                            onChange={e=>{ saveBet(h.id,e.target.value); setBetsConfirmed(false); }}
                            style={{width:86,padding:"7px 7px 7px 20px",background:"rgba(255,255,255,0.06)",border:`1px solid ${betNum>0?h.color+"55":"#ffffff15"}`,borderRadius:7,color:"#fff",fontSize:16,outline:"none"}}/>
                        </div>
                        <button onClick={()=>saveBet(h.id, val?"":"50")} style={{padding:"7px 11px",borderRadius:7,border:`1px solid ${h.color}44`,background:betNum>0?`${h.color}18`:"transparent",color:betNum>0?h.color:"#ffffff33",cursor:"pointer",fontSize:11,fontWeight:700}}>{betNum>0?"✓":"+"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Confirm / confirmed state */}
              {overBalance && <p style={{color:"#ff2d55",marginBottom:8,fontSize:13,textAlign:"center"}}>⚠ Exceeds available balance (${fmt2(user.balance)})</p>}
              {betsConfirmed ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                  <div style={{display:"inline-flex",alignItems:"center",gap:10,padding:"10px 22px",background:"rgba(0,245,255,0.07)",border:"1px solid #00f5ff44",borderRadius:10}}>
                    <span style={{fontSize:18}}>✅</span>
                    <div style={{textAlign:"left"}}>
                      <div style={{color:"#00f5ff",fontWeight:700,fontSize:13}}>Bets Confirmed!</div>
                      <div style={{color:"#ffffff44",fontSize:11,marginTop:2}}>${fmt2(totalBetAmt)} reserved</div>
                    </div>
                  </div>
                  <button onClick={()=>setBetsConfirmed(false)} style={{padding:"8px 24px",borderRadius:8,border:"1px solid #ffffff22",background:"transparent",color:"#ffffff55",cursor:"pointer",fontSize:12}}>✏️ Edit Bets</button>
                </div>
              ) : (
                <button onClick={confirmBets} disabled={overBalance||totalBetAmt===0}
                  style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:overBalance||totalBetAmt===0?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#00f5ff,#39ff14)",color:overBalance||totalBetAmt===0?"#ffffff33":"#08081a",cursor:overBalance||totalBetAmt===0?"not-allowed":"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,letterSpacing:1}}>
                  🔒 CONFIRM BETS
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function AuctionLobbyScreen({ schedule, now, onEnterRace, sharedPot={} }) {
  const AUCTION_OPEN_SECS = 3 * 60; // auction opens 3 min before race
  const withStatus = schedule.map(r=>({...r, _st:raceStatus(r,now)})).filter(r=>r._st!=="finished");

  return (
    <div style={{minHeight:"100vh",background:"#08081a",paddingTop:72,paddingBottom:40}}>
      <div style={{maxWidth:700,margin:"0 auto",padding:"16px"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:36,marginBottom:6}}>🔨</div>
          <h2 style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:20,letterSpacing:3,marginBottom:4}}>AUCTION RACES</h2>
          <div style={{color:"#ffffff44",fontSize:12,letterSpacing:2}}>BID ON HORSES — WIN THE POT</div>
        </div>
        {withStatus.map(race=>{
          const rt = RACE_TYPES[race.type]||RACE_TYPES.standard;
          const cond = TRACK_CONDITIONS[race.condition]||TRACK_CONDITIONS.sunny;
          const secs = (race.startTime - now)/1000;
          const auctionSecs = secs - AUCTION_OPEN_SECS;
          const isAuctionLive = auctionSecs <= 0 && secs > 0;
          const isRacing = secs <= 0;
          const auctions = getAuctions();
          const aData = auctions[race.id]||{};
          const ownedCount = Object.values(aData.owners||{}).filter(Boolean).length;

          return (
            <div key={race.id} onClick={()=>onEnterRace(race)}
              style={{marginBottom:10,padding:"13px 18px",background:"rgba(255,255,255,0.03)",border:`1px solid ${isAuctionLive?"#ffd70055":"#ffffff0d"}`,borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:14,transition:"all 0.15s",boxShadow:isAuctionLive?"0 0 16px #ffd70018":"none"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
            >
              <div style={{width:44,height:44,borderRadius:10,background:`${rt.color}15`,border:`2px solid ${rt.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,position:"relative"}}>
                {rt.icon}
                {race.condition&&race.condition!=="sunny"&&(
                  <span style={{position:"absolute",bottom:-6,right:-6,fontSize:14,filter:"drop-shadow(0 0 3px rgba(0,0,0,0.8))"}}>
                    {cond.icon}
                  </span>
                )}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{color:"#fff",fontWeight:700,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{race.name}</span>
                  {isAuctionLive && <span style={{background:"#ffd70022",border:"1px solid #ffd70066",borderRadius:20,padding:"1px 8px",color:"#ffd700",fontSize:10,fontWeight:700,letterSpacing:1,animation:"racingBlink 0.8s infinite"}}>🔨 LIVE</span>}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{color:rt.color,fontSize:12,fontWeight:600}}>{rt.label}</span>
                  {race.condition&&race.condition!=="sunny"&&(
                    <span style={{color:cond.color,fontSize:11,fontWeight:600,background:`${cond.color}18`,border:`1px solid ${cond.color}44`,borderRadius:10,padding:"1px 7px"}}>{cond.icon} {cond.label}</span>
                  )}
                  <span style={{color:"#ffffff33"}}>·</span>
                  <span style={{color:"#ffffff44",fontSize:11}}>{ownedCount}/6 sold</span>
{(sharedPot[race.id]?.totalPot||0)>0&&<><span style={{color:"#ffffff33"}}>·</span><span style={{background:"rgba(57,255,20,0.08)",border:"1px solid #39ff1433",borderRadius:10,padding:"1px 8px",color:"#39ff14",fontSize:11,fontFamily:"'Orbitron',monospace"}}>🌐 ${fmt2(sharedPot[race.id]?.totalPot||0)}</span></>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,display:"flex",flexDirection:"column",gap:5,alignItems:"flex-end"}}>
                {isRacing ? (
                  <div style={{color:"#ff2d5588",fontSize:11,fontWeight:700,fontFamily:"'Orbitron',monospace"}}>RACING</div>
                ) : isAuctionLive ? (
                  <>
                    <div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:14,fontWeight:900,lineHeight:1,animation:"racingBlink 0.8s infinite"}}>🔨 LIVE</div>
                      <div style={{color:"#ffd70066",fontSize:10,letterSpacing:1,marginTop:2}}>AUCTION</div>
                    </div>
                    <div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:13,fontWeight:700,lineHeight:1}}>{fmtCD(secs)}</div>
                      <div style={{color:"#39ff1466",fontSize:10,letterSpacing:1,marginTop:2}}>RACE STARTS</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:auctionSecs<120?"#ffd700":"#ffffff55",fontSize:13,fontWeight:700,lineHeight:1}}>{fmtCD(auctionSecs)}</div>
                      <div style={{color:auctionSecs<120?"#ffd70066":"#ffffff22",fontSize:10,letterSpacing:1,marginTop:2}}>🔨 AUCTION OPENS</div>
                    </div>
                    <div>
                      <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:13,fontWeight:700,lineHeight:1}}>{fmtCD(secs)}</div>
                      <div style={{color:"#39ff1466",fontSize:10,letterSpacing:1,marginTop:2}}>BETS CLOSE</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LobbyScreen({ schedule, now, onEnterRace, userBets, friendRaces={}, sharedPot={} }) {
  const withStatus = useMemo(()=>schedule.map(r=>({...r,_st:raceStatus(r,now)})).filter(r=>r._st!=="finished"),[schedule,now]);
  const sections=[
    {title:"🔴 LIVE NOW",   filter:r=>r._st==="racing"||r._st==="locked", accent:"#ff2d55"},
    {title:"🟢 BETTING OPEN",filter:r=>r._st==="betting",                  accent:"#39ff14"},
    {title:"⏳ UP NEXT",    filter:r=>r._st==="upcoming"&&r.startTime-now<60*60*1000, accent:"#ffd700"},
    {title:"📅 SCHEDULE",   filter:r=>r._st==="upcoming"&&r.startTime-now>=60*60*1000,accent:"#00f5ff"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#08081a",paddingTop:72,paddingBottom:60}}>
      <div style={{maxWidth:880,margin:"0 auto",padding:"20px 16px 0"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <h1 style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:26,letterSpacing:5,textShadow:"0 0 24px #00f5ff"}}>RACE LOBBY</h1>
          <p style={{color:"#ffffff33",fontSize:13,marginTop:4}}>Betting opens up to 3 hours early — pick your race and place your bets.</p>
        </div>
        {sections.map(sec=>{
          const races=withStatus.filter(sec.filter);
          if(!races.length) return null;
          return (
            <div key={sec.title} style={{marginBottom:32}}>
              <h2 style={{color:sec.accent,fontFamily:"'Orbitron',monospace",fontSize:12,letterSpacing:3,marginBottom:10,textShadow:`0 0 8px ${sec.accent}`}}>{sec.title}</h2>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {races.map(race=>{
                  const rt=RACE_TYPES[race.type];
                  const st=race._st;
                  const secs=Math.floor((race.startTime-now)/1000);
                  const draftBet=userBets[race.id]&&Object.keys(userBets[race.id]).length>0;
                  const confirmedBetData=getConfirmed()[race.id];
                  const hasBet=draftBet||!!confirmedBetData;
                  const myAmt=confirmedBetData?confirmedBetData.pot:draftBet?Object.values(userBets[race.id]).reduce((s,v)=>s+(parseFloat(v)||0),0):0;
                  const betIsConfirmed=!!confirmedBetData;
                  return (
                    <div key={race.id} onClick={()=>onEnterRace(race)} style={{display:"flex",alignItems:"center",gap:14,padding:"13px 18px",background:"rgba(255,255,255,0.03)",borderRadius:12,cursor:"pointer",border:`1px solid ${hasBet?rt.color+"66":st==="racing"||st==="locked"?"#ff2d5522":st==="betting"?"#39ff1422":rt.color+"18"}`,boxShadow:hasBet?`0 0 16px ${rt.color}18`:"none",transition:"all 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                    >
                      <div style={{width:44,height:44,borderRadius:10,background:`${rt.color}15`,border:`2px solid ${rt.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,position:"relative"}}>
                        {rt.icon}
                        {race.condition&&race.condition!=="sunny"&&(
                          <span style={{position:"absolute",bottom:-6,right:-6,fontSize:14,filter:"drop-shadow(0 0 3px rgba(0,0,0,0.8))"}}>
                            {TRACK_CONDITIONS[race.condition].icon}
                          </span>
                        )}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:"#fff",fontWeight:700,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{race.name}</div>
                        <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
                          <span style={{color:rt.color,fontSize:12,fontWeight:600}}>{rt.label}</span>
                          {race.condition&&race.condition!=="sunny"&&(
                            <span style={{color:TRACK_CONDITIONS[race.condition].color,fontSize:11,fontWeight:600,background:`${TRACK_CONDITIONS[race.condition].color}18`,border:`1px solid ${TRACK_CONDITIONS[race.condition].color}44`,borderRadius:10,padding:"1px 7px"}}>
                              {TRACK_CONDITIONS[race.condition].icon} {TRACK_CONDITIONS[race.condition].label}
                            </span>
                          )}
                          {hasBet&&<span style={{background:betIsConfirmed?"rgba(0,245,255,0.1)":"rgba(255,215,0,0.1)",border:`1px solid ${betIsConfirmed?"#00f5ff33":"#ffd70033"}`,borderRadius:10,padding:"1px 8px",color:betIsConfirmed?"#00f5ff":"#ffd700",fontSize:11}}>{betIsConfirmed?"✓":"🎫"} ${fmt2(myAmt)}</span>}
                          {friendRaces[race.id]>0&&<span style={{background:"rgba(191,95,255,0.12)",border:"1px solid #bf5fff33",borderRadius:10,padding:"1px 8px",color:"#bf5fff",fontSize:11}}>👥 {friendRaces[race.id]}</span>}
{(sharedPot[race.id]?.totalPot||0)>0&&<span style={{background:"rgba(57,255,20,0.08)",border:"1px solid #39ff1433",borderRadius:10,padding:"1px 8px",color:"#39ff14",fontSize:11,fontFamily:"'Orbitron',monospace"}}>🌐 ${fmt2(sharedPot[race.id]?.totalPot||0)}</span>}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,minWidth:100}}>
                        {st==="racing"&&(
                          <div style={{background:"#ff2d55",color:"#fff",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,letterSpacing:1,animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>
                        )}
                        {st==="locked"&&(
                          <div>
                            <div style={{fontFamily:"'Orbitron',monospace",color:"#ff2d55",fontSize:16,fontWeight:900,textShadow:"0 0 12px #ff2d55",lineHeight:1}}>{secs}s</div>
                            <div style={{color:"#ff2d5577",fontSize:10,letterSpacing:1,marginTop:2}}>RACE STARTS</div>
                          </div>
                        )}
                        {st==="betting"&&(
                          <div>
                            <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:15,fontWeight:700,lineHeight:1}}>{fmtCD(secs-BET_CLOSE_SECS)}</div>
                            <div style={{color:"#39ff1466",fontSize:10,letterSpacing:1,marginTop:2}}>BETS CLOSE</div>
                          </div>
                        )}
                        {st==="upcoming"&&(
                          <div>
                            <div style={{fontFamily:"'Orbitron',monospace",color:secs<600?"#ffd700":"#ffffff44",fontSize:13,lineHeight:1}}>{fmtCD(secs)}</div>
                            <div style={{color:"#ffffff22",fontSize:10,letterSpacing:1,marginTop:2}}>TO POST</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RACE DETAIL / BETTING ────────────────────────────────────────────────────
// confirmedBets: bets that have been locked in (balance already deducted)
// onConfirmBets: called once when user locks bets — just saves, no race start
// onRaceStart: called when clock hits zero
function RaceDetailScreen({ race, user, now, onBack, onConfirmBets, confirmedBets, confirmedPot, sharedPot, onRaceStart, devForceStart, onDevForceStart, chatMsgs, setChatMsgs, chatOpen, setChatOpen, chatUnread, setChatUnread }) {
  const rt = RACE_TYPES[race.type];

  // live clock — re-render every second
  const [tick, setTick] = useState(0);
  useEffect(()=>{ const t=setInterval(()=>setTick(n=>n+1),500); return()=>clearInterval(t); },[]);

  const liveSecs         = Math.floor((race.startTime - gameNow()) / 1000);
  const _naturalSt       = raceStatus(race, gameNow());
  // 🛠 DEV: force locked state for testing
  const st               = devForceStart ? "locked" : _naturalSt;
  const canBet           = st === "betting";
  const isLocked         = st === "locked";
  const isRacing         = st === "racing" || (!devForceStart && liveSecs <= 0);
  const betsAlreadyIn    = confirmedBets && Object.keys(confirmedBets).length > 0;
  const bettingSecsLeft  = Math.max(0, liveSecs - BET_CLOSE_SECS);
  const pct              = Math.min(100, Math.max(0, (1 - bettingSecsLeft/(BET_OPEN_HOURS*3600))*100));

  // Load from confirmed store first, fall back to draft
  const getConfirmedForRace = () => getConfirmed()[race.id];
  const confirmedStore = getConfirmedForRace();

  const [localBets, setLocalBets] = useState(()=>{
    if(confirmedStore) return confirmedStore.bets||{};
    const p=getPending(); return p[race.id]||{};
  });
  // confirmed = bets have been submitted at least once (but can still be edited)
  const [confirmed, setConfirmed] = useState(!!confirmedStore || betsAlreadyIn);
  // previouslyConfirmedPot tracks what was already deducted from balance for this race
  const [prevPot, setPrevPot] = useState(confirmedStore?.pot || (betsAlreadyIn ? confirmedPot : 0));

  const totalBet = useMemo(()=>Object.values(localBets).reduce((s,v)=>s+(parseFloat(v)||0),0),[localBets]);
  // Available balance = current balance + what's already reserved for THIS race
  // so editing this race's bets doesn't show false "exceeds balance"
  const availableBalance = user.balance + prevPot;
  const overBalance = totalBet > availableBalance;

  const saveBet=(hid,val)=>{
    // Update localBets state directly — spread existing bets, only touch the one horse
    setLocalBets(prev=>{
      const updated = {...prev};
      const n = parseFloat(val);
      if(!val||isNaN(n)||n<=0) delete updated[hid];
      else updated[hid]=n;
      return updated;
    });
    if(confirmed) setConfirmed(false);
  };

  const handleConfirm=()=>{
    if(overBalance||totalBet<=0||!canBet) return;
    // Calculate the delta vs what was previously reserved
    const delta = totalBet - prevPot;
    // Only adjust balance by the difference (can be negative = refund)
    onConfirmBets(localBets, totalBet, prevPot);
    setConfirmed(true);
    setPrevPot(totalBet);
    // Write to confirmed store
    const c=getConfirmed();
    c[race.id]={ bets:localBets, pot:totalBet, raceId:race.id };
    saveConfirmed(c);
    // Clear draft
    const p=getPending(); delete p[race.id]; savePending(p);
  };

  const handleEditBets=()=>{
    // Revert to editable mode — bets still saved in confirmed store
    setConfirmed(false);
  };

  // 🛠 DEV: local countdown when force-started (real race is far away)
  const [devCountdown, setDevCountdown] = useState(BET_CLOSE_SECS);
  useEffect(()=>{
    if(!devForceStart) return;
    setDevCountdown(BET_CLOSE_SECS);
    const t = setInterval(()=>{
      setDevCountdown(c=>{
        if(c<=1){ clearInterval(t); onRaceStart(); return 0; }
        return c-1;
      });
    },1000);
    return()=>clearInterval(t);
  },[devForceStart]);

  // Track whether user entered during the full animation window (hook must be at top level)
  const enteredEarlyRef = useRef(null);
  const bugleFiredRef   = useRef(false);
  const swipedCountRef  = useRef(0);

  // Fire swipe sound for each newly revealed odds card
  const countdown_cur = devForceStart ? devCountdown : Math.max(0, liveSecs);
  const secsPerHorse_cur = Math.floor(BET_CLOSE_SECS / HORSES.length);
  const elapsed_cur = BET_CLOSE_SECS - countdown_cur;
  const revealCount_cur = (enteredEarlyRef.current && (isLocked||isRacing))
    ? Math.min(HORSES.length, Math.floor(elapsed_cur / secsPerHorse_cur) + 1)
    : 0;
  useEffect(()=>{
    if(revealCount_cur > swipedCountRef.current) {
      sfx.oddsSwipe();
      swipedCountRef.current = revealCount_cur;
    }
  },[revealCount_cur]);

  // Fire bugle exactly once when countdown hits 4 or below
  useEffect(()=>{
    const countdown = devForceStart ? devCountdown : Math.max(0, liveSecs);
    if(countdown <= 4 && countdown > 0 && !bugleFiredRef.current) {
      bugleFiredRef.current = true;
      sfx.bugle();
    }
    if(countdown === 0) bugleFiredRef.current = false;
  }, [liveSecs, devCountdown, devForceStart]);
  if(enteredEarlyRef.current === null) {
    enteredEarlyRef.current = devForceStart ? true : liveSecs > BET_CLOSE_SECS * 0.75;
  }

  // Auto-fire race when clock hits zero
  useEffect(()=>{
    if(isRacing) onRaceStart();
  },[isRacing]);

  // ── LOCKED COUNTDOWN (60s window) — animated odds reveal ─────────────────
  if(isLocked || isRacing) {
    const countdown    = devForceStart ? devCountdown : Math.max(0, liveSecs);
    const ringPct      = (countdown / BET_CLOSE_SECS) * 100;
    const displayBets  = betsAlreadyIn ? confirmedBets : (confirmed ? localBets : {});
    const enteredEarly = enteredEarlyRef.current;

    // Build odds from shared pot — reflects ALL users' bets combined
    const spTotal = sharedPot?.totalPot || 0;
    const spBets  = sharedPot?.betsPerHorse || {};
    const oddsData = HORSES.map(h=>{
      const totalOnHorse = parseFloat(spBets[h.id]||0);
      // Show actual odds if bets exist, otherwise show "—" placeholder
      return { h, odds: totalOnHorse > 0 && spTotal > 0 ? parseFloat((spTotal / totalOnHorse).toFixed(2)) : null };
    });
    // Sort ascending = favourite first (lowest odds = most bet on)
    const sortedOdds = [...oddsData].sort((a,b)=>{ if(a.odds===null) return 1; if(b.odds===null) return -1; return a.odds-b.odds; });

    const secsPerHorse = Math.floor(BET_CLOSE_SECS / HORSES.length); // ~5s each
    const elapsed      = BET_CLOSE_SECS - countdown;
    const revealCount  = enteredEarly
      ? Math.min(HORSES.length, Math.floor(elapsed / secsPerHorse) + 1)
      : HORSES.length; // joined late — show all immediately

    // Bugle is fired via useEffect below — not inline

    const timerColor = countdown<=10?"#ff2d55":countdown<=20?"#ffd700":"#00f5ff";

    return (
      <div style={{minHeight:"100vh",background:"#08081a",display:"flex",flexDirection:"column",alignItems:"center",padding:"72px 16px 40px",overflowY:"auto"}}>
        {/* Race header */}
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:32,marginBottom:4}}>{rt.icon}</div>
          <h2 style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:18,letterSpacing:3,marginBottom:2}}>{race.name}</h2>
          <span style={{color:rt.color,fontSize:11,fontWeight:700,letterSpacing:2}}>{rt.label.toUpperCase()}</span>
        </div>

        <ProvablyFairBadge race={race}/>
        {/* Countdown ring */}
        <div style={{position:"relative",width:140,height:140,marginBottom:16,flexShrink:0}}>
          <svg width="140" height="140" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
            <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
            <circle cx="70" cy="70" r="60" fill="none"
              stroke={timerColor} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${2*Math.PI*60}`}
              strokeDashoffset={`${2*Math.PI*60*(1-ringPct/100)}`}
              style={{transition:"stroke-dashoffset 1s linear, stroke 0.5s",filter:`drop-shadow(0 0 6px ${timerColor})`}}
            />
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontFamily:"'Orbitron',monospace",color:timerColor,fontSize:38,fontWeight:900,lineHeight:1,textShadow:`0 0 20px ${timerColor}77`,transition:"color 0.5s"}}>{countdown}</div>
            <div style={{color:"#ffffff44",fontSize:9,letterSpacing:2,marginTop:2}}>SECONDS</div>
          </div>
        </div>

        <div style={{fontFamily:"'Orbitron',monospace",color:"#ffffff55",fontSize:11,letterSpacing:3,marginBottom:12,animation:"racingBlink 1s infinite"}}>
          {countdown<=0?"LOADING RACE…":"BETS CLOSED — RACE STARTING"}
        </div>

        {/* Live pot display */}
        <div style={{marginBottom:20,padding:"10px 28px",background:"rgba(255,215,0,0.07)",border:"1px solid #ffd70033",borderRadius:12,textAlign:"center"}}>
          <div style={{color:"#ffffff44",fontSize:10,letterSpacing:3,marginBottom:3}}>🌐 LIVE POT</div>
          <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:28,fontWeight:900,textShadow:"0 0 20px #ffd70066"}}>${fmt2(spTotal||0)}</div>
        </div>

        {/* Odds reveal — stage card swipes in from right at fixed height, hangs, then list grows below */}
        <div style={{width:"100%",maxWidth:480,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{color:"#ffffff33",fontSize:11,letterSpacing:2}}>RACE ODDS</span>
            <span style={{color:"#ffffff22",fontSize:10}}>{enteredEarly?"revealing…":"final odds"}</span>
          </div>

          {/* Stage — fixed height slot where newest card swipes in and hangs */}
          <div style={{position:"relative",height:72,marginBottom:8,overflow:"hidden"}}>
            {sortedOdds.map(({h,odds},i)=>{
              const isNewest = i === revealCount - 1;
              const myBet = displayBets[h.id];
              const rank = i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
              if(!isNewest || revealCount === 0) return null;
              return (
                <div key={h.id+"-stage"} style={{
                  position:"absolute", inset:0,
                  animation:"oddsSwipeAcross 1.4s cubic-bezier(0.22,1,0.36,1) forwards",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",background:`${h.color}12`,border:`1px solid ${h.color}88`,borderRadius:12,boxShadow:`0 0 18px ${h.color}33`}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:`${h.color}18`,border:`2px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
                    <div style={{flex:1}}>
                      <div style={{color:h.color,fontWeight:700,fontSize:14}}>{rank} {horseName(race,h.id)}</div>
                      <div style={{color:"#ffffff33",fontSize:11,marginTop:1}}>{i===0?"FAVOURITE":i===HORSES.length-1?"LONG SHOT":""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Orbitron',monospace",color:odds?"#ffd700":"#ffffff33",fontSize:18,fontWeight:900,textShadow:odds?"0 0 10px #ffd70066":"none"}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                      {myBet>0&&<div style={{color:"#00f5ff",fontSize:11,marginTop:1}}>your bet: ${fmt2(parseFloat(myBet))}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* List — previously revealed cards drop in below the stage */}
          {sortedOdds.map(({h,odds},i)=>{
            const isInList = i < revealCount - 1; // all except the newest (it's in stage)
            const myBet = displayBets[h.id];
            const rank = i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
            if(!isInList) return null;
            return (
              <div key={h.id+"-list"} style={{
                marginBottom:6,
                animation:"oddsDropDown 0.4s ease-out forwards",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",background:`${h.color}0d`,border:`1px solid ${h.color}44`,borderRadius:10}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:`${h.color}18`,border:`1.5px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
                  <div style={{flex:1}}>
                    <div style={{color:h.color,fontWeight:700,fontSize:12}}>{rank} {horseName(race,h.id)}</div>
                  </div>
                  <div style={{fontFamily:"'Orbitron',monospace",color:odds?"#ffd700":"#ffffff33",fontSize:15,fontWeight:900}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                  {myBet>0&&<div style={{color:"#00f5ff",fontSize:10}}>💰${fmt2(parseFloat(myBet))}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* User bets summary */}
        {Object.keys(displayBets).length>0&&(
          <div style={{width:"100%",maxWidth:480,marginTop:16,padding:"12px 16px",background:"rgba(0,245,255,0.05)",border:"1px solid #00f5ff22",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:"#00f5ff",fontSize:12,fontWeight:600}}>✓ Your total bet</span>
            <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:15}}>${fmt2(Object.values(displayBets).reduce((s,v)=>s+(parseFloat(v)||0),0))}</span>
          </div>
        )}

        {/* Chat — available during countdown */}
        <RaceChat raceId={race.id} user={user} msgs={chatMsgs} setMsgs={setChatMsgs} open={chatOpen} setOpen={setChatOpen} unread={chatUnread} setUnread={setChatUnread}/>
      </div>
    );
  }

  // ── BETTING OPEN or TOO EARLY ──────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#08081a",paddingTop:72,paddingBottom:40}}>
      <div style={{maxWidth:700,margin:"0 auto",padding:"16px 16px 0"}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#ffffff44",cursor:"pointer",fontSize:13,marginBottom:14,display:"flex",alignItems:"center",gap:6}}>← Back to Lobby</button>

        {/* Race header */}
        <div style={{padding:"18px 22px",background:`${rt.color}0a`,border:`1px solid ${rt.color}44`,borderRadius:14,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{fontSize:38}}>{rt.icon}</div>
            <div style={{flex:1}}>
              <h1 style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:20,letterSpacing:2}}>{race.name}</h1>
              <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{color:rt.color,fontWeight:700,fontSize:13}}>{rt.label}</span>
                <span style={{color:"#ffffff33"}}>·</span>
                <span style={{color:"#ffffff55",fontSize:13}}>🕐 {fmtTime(new Date(race.startTime))}</span>
                <span style={{color:"#ffffff33"}}>·</span>
                <span style={{color:"#ffffff44",fontSize:13}}>{rt.dice} dice per roll</span>
              </div>
            </div>
            {canBet&&!confirmed&&<div style={{background:"rgba(57,255,20,0.15)",border:"1px solid #39ff1444",color:"#39ff14",padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:700,letterSpacing:1}}>BETTING OPEN</div>}
            {confirmed&&<div style={{background:"rgba(0,245,255,0.15)",border:"1px solid #00f5ff44",color:"#00f5ff",padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:700,letterSpacing:1}}>✓ BETS CONFIRMED</div>}
            {st==="upcoming"&&<div style={{color:"#ffffff44",fontFamily:"'Orbitron',monospace",fontSize:13}}>{fmtCD(liveSecs)}</div>}
          </div>
          <p style={{color:"#ffffff55",fontSize:13,marginTop:12,lineHeight:1.6}}>{rt.desc}</p>
        </div>

        {/* Too early — betting not open yet */}
        {st==="upcoming"&&(
          <div style={{textAlign:"center",padding:"32px 20px",background:"rgba(255,255,255,0.02)",borderRadius:12,marginBottom:20}}>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:16,marginBottom:8}}>BETTING OPENS IN</div>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:44,textShadow:"0 0 20px #ffd700"}}>{fmtCD(liveSecs - BET_OPEN_HOURS*3600)}</div>
            <p style={{color:"#ffffff33",marginTop:12,fontSize:12}}>Opens {BET_OPEN_HOURS}h before post · Closes 30s before start</p>
          </div>
        )}

        {/* Betting open — timer bar */}
        {canBet&&(
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{color:"#ffffff44",fontSize:12,letterSpacing:2}}>BETTING CLOSES IN</span>
              <span style={{fontFamily:"'Orbitron',monospace",color:bettingSecsLeft<120?"#ff2d55":"#ffd700",fontSize:15,textShadow:bettingSecsLeft<120?"0 0 12px #ff2d55":"none"}}>{fmtCD(bettingSecsLeft)}</span>
            </div>
            <div style={{height:7,background:"rgba(255,255,255,0.07)",borderRadius:4,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:4,width:`${pct}%`,background:bettingSecsLeft<120?"linear-gradient(90deg,#ff2d55,#ff6b00)":"linear-gradient(90deg,#00f5ff,#39ff14)",boxShadow:`0 0 8px ${bettingSecsLeft<120?"#ff2d55":"#00f5ff"}`,transition:"width 1s linear"}}/>
            </div>
          </div>
        )}

        {/* Confirmed banner */}
        {confirmed&&canBet&&(
          <div style={{background:"rgba(0,245,255,0.06)",border:"1px solid #00f5ff33",borderRadius:10,padding:"12px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>✅</span>
            <div>
              <div style={{color:"#00f5ff",fontWeight:700,fontSize:14}}>Bets Confirmed!</div>
              <div style={{color:"#ffffff44",fontSize:12,marginTop:2}}>Your bets are locked in. Race fires at post time. Sit tight!</div>
            </div>
          </div>
        )}

        {/* Horse bet cards */}
        {canBet&&(
          <>
            <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(255,215,0,0.05)",border:"1px solid #ffd70022",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
              <div style={{textAlign:"left"}}>
                <div style={{color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:2}}>YOUR BET</div>
                <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:18}}>${fmt2(totalBet)}</div>
              </div>
              <div style={{width:1,height:32,background:"rgba(255,255,255,0.08)"}}/>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:2}}>🌐 LIVE POT</div>
                <div style={{color:"#00f5ff",fontFamily:"'Orbitron',monospace",fontSize:18,textShadow:"0 0 10px #00f5ff66"}}>${fmt2(sharedPot?.totalPot||0)}</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {HORSES.map(h=>{
                const betVal=localBets[h.id]||"";
                const betNum=parseFloat(betVal)||0;
                return (
                  <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:`1px solid ${betNum>0?h.color+"55":"rgba(255,255,255,0.06)"}`,boxShadow:betNum>0?`0 0 16px ${h.color}14`:"none",transition:"all 0.2s"}}>
                    <div style={{width:38,height:38,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,background:`${h.color}15`,border:`2px solid ${h.color}`,boxShadow:`0 0 8px ${h.color}44`,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
                    <div style={{flex:1}}><div style={{color:h.color,fontWeight:700,fontSize:14,letterSpacing:1}}>{horseName(race, h.id)}</div></div>
                    {/* Always editable while betting window is open */}
                    <div style={{display:"flex",gap:7,alignItems:"center"}}>
                      <div style={{position:"relative"}}>
                        <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#ffd70066",fontSize:13,pointerEvents:"none"}}>$</span>
                        <input type="number" min="0" placeholder="0" value={betVal}
                          onChange={e=>saveBet(h.id,e.target.value)}
                          style={{width:86,padding:"7px 7px 7px 20px",background:"rgba(255,255,255,0.06)",border:`1px solid ${betNum>0?h.color+"55":"#ffffff15"}`,borderRadius:7,color:"#fff",fontSize:16,outline:"none"}}/>
                      </div>
                      <button onClick={()=>saveBet(h.id,betVal?"":"50")} style={{padding:"7px 11px",borderRadius:7,border:`1px solid ${h.color}44`,background:betNum>0?`${h.color}18`:"transparent",color:betNum>0?h.color:"#ffffff33",cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:1}}>{betNum>0?"✓":"+"}</button>
                    </div>
                  </div>
                );
              })}
            </div>


            {/* Always show action area while betting is open */}
            <div style={{textAlign:"center"}}>
              {overBalance&&<p style={{color:"#ff2d55",marginBottom:8,fontSize:13}}>⚠ Exceeds available balance (${fmt2(availableBalance)})</p>}
              {confirmed ? (
                <div>
                  {/* Confirmed state — show green banner + Edit button */}
                  <div style={{display:"inline-flex",alignItems:"center",gap:10,padding:"10px 22px",background:"rgba(0,245,255,0.07)",border:"1px solid #00f5ff44",borderRadius:10,marginBottom:12}}>
                    <span style={{fontSize:18}}>✅</span>
                    <div style={{textAlign:"left"}}>
                      <div style={{color:"#00f5ff",fontWeight:700,fontSize:13}}>Bets Confirmed — ${fmt2(totalBet)} locked</div>
                      <div style={{color:"#ffffff44",fontSize:11,marginTop:2}}>Race fires at post time. You can still edit until bets close.</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                    <button onClick={handleEditBets} style={{padding:"11px 26px",borderRadius:10,border:"1px solid #ffd70044",background:"rgba(255,215,0,0.08)",color:"#ffd700",cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12,letterSpacing:2}}>
                      ✏️ EDIT BETS
                    </button>
                    <button onClick={handleConfirm} disabled={overBalance||totalBet<=0} style={{padding:"11px 26px",borderRadius:10,border:"none",cursor:overBalance||totalBet<=0?"not-allowed":"pointer",background:overBalance||totalBet<=0?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#00f5ff,#39ff14)",color:overBalance||totalBet<=0?"#ffffff33":"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:12,letterSpacing:2,boxShadow:overBalance||totalBet<=0?"none":"0 0 20px #00f5ff55"}}>
                      🔒 UPDATE BETS
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button onClick={handleConfirm} disabled={overBalance||totalBet<=0} style={{padding:"14px 44px",borderRadius:12,border:"none",cursor:overBalance||totalBet<=0?"not-allowed":"pointer",background:overBalance||totalBet<=0?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#00f5ff,#39ff14)",color:overBalance||totalBet<=0?"#ffffff33":"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,letterSpacing:3,boxShadow:overBalance||totalBet<=0?"none":"0 0 28px #00f5ff66"}}>
                    🔒 CONFIRM BETS
                  </button>
                  <p style={{color:"#ffffff22",fontSize:11,marginTop:8}}>Race fires at post time · Available: ${fmt2(availableBalance)}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>


    </div>
  );
}

// ─── ODDS REVEAL ──────────────────────────────────────────────────────────────
function OddsRevealScreen({ race, bets, totalPot, odds }) {
  const [count,setCount]=useState(3);
  const rt=RACE_TYPES[race.type];
  useEffect(()=>{const t=setInterval(()=>setCount(c=>Math.max(0,c-1)),1000);return()=>clearInterval(t);},[]);
  return (
    <div style={{minHeight:"100vh",background:"#08081a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px 40px"}}>
      <div style={{fontSize:44,marginBottom:10}}>{rt.icon}</div>
      <h1 style={{fontFamily:"'Orbitron',monospace",color:"#ffd700",fontSize:22,letterSpacing:4,textShadow:"0 0 20px #ffd700",marginBottom:4}}>{race.name}</h1>
      <p style={{color:rt.color,letterSpacing:2,marginBottom:6,fontSize:13,fontWeight:700}}>{rt.label.toUpperCase()}</p>
      <p style={{color:"#ffffff44",marginBottom:28,letterSpacing:2,fontFamily:"'Orbitron',monospace",fontSize:16}}>RACE STARTS IN {count}…</p>
      <div style={{width:"100%",maxWidth:460}}>
        <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10,padding:"12px 18px",marginBottom:16,textAlign:"center"}}>
          <span style={{color:"#ffffff55",fontSize:12,letterSpacing:2}}>🌐 LIVE POT </span>
          <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:26,textShadow:"0 0 16px #ffd70066"}}>${fmt2(sharedPot?.totalPot||totalPot)}</span>
        </div>
        {HORSES.map(h=>(
          <div key={h.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",marginBottom:6,background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${h.color}33`}}>
            <div style={{width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:`${h.color}15`,border:`1.5px solid ${h.color}`}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
            <span style={{flex:1,color:h.color,fontWeight:700,fontSize:14}}><HorseName race={race} horseId={h.id}/> <span style={{color:"#ffffff33",fontSize:10,fontWeight:400}}>({getCoatName(horseLottieCoat(race,h.id))})</span></span>
            <span style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:16}}>{odds[h.id]?`${odds[h.id].toFixed(2)}x`:"—"}</span>
            {bets[h.id]>0&&<span style={{color:"#ffd70088",fontSize:12}}>your: ${bets[h.id]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DICE DISPLAY ─────────────────────────────────────────────────────────────
function DiceDisplay({ diceResult, rolling, raceType, race, mudDie=null, fogDie=null }) {
  if(!diceResult) return null;
  const { dice, moves, isDoubles, wildMove } = diceResult;
  const isMagic = raceType==="magic_dice";

  // For magic_dice: die0=horse selector, die1=spaces
  const magicHorseIdx  = isMagic ? Math.min(dice[0]-1, 5) : null;
  const magicHorseColor= isMagic ? HORSES[magicHorseIdx].color : null;

  return (
    <div style={{background:"rgba(10,10,32,0.96)",border:"1px solid #ffffff18",borderRadius:16,padding:"16px 20px",margin:"0 auto",maxWidth:560,width:"100%"}}>

      {/* Magic dice legend */}
      {isMagic && (
        <div style={{display:"flex",justifyContent:"center",gap:24,marginBottom:10}}>
          <span style={{color:"#ffffff44",fontSize:10,letterSpacing:2}}>🎯 DIE 1 = HORSE</span>
          <span style={{color:"#ffffff44",fontSize:10,letterSpacing:2}}>📏 DIE 2 = SPACES</span>
        </div>
      )}

      {/* Dice row */}
      <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:12,flexWrap:"wrap"}}>
        {dice.map((dv,di)=>{
          const isMudDie = di===mudDie;
          const isFogDie = di===fogDie;
          let borderCol, bgColor, label, dieOverride;
          if(isMudDie) {
            const mudHorseIdx = Math.min(dv-1, 5);
            const mudHorseCol = HORSES[mudHorseIdx].color;
            borderCol   = mudHorseCol;
            bgColor     = `${mudHorseCol}18`;
            label       = <span style={{color:mudHorseCol,fontSize:10,fontWeight:700,letterSpacing:1}}>🟫 {horseName(race,mudHorseIdx).split(" ")[0]} — MUD SKIP</span>;
            dieOverride = <span style={{fontSize:28,animation:"mudSplat 0.5s ease-out"}}>🟫</span>;
          } else if(isFogDie) {
            const fogHorseIdx = Math.min(dv-1, 5);
            const fogHorseCol = HORSES[fogHorseIdx].color;
            borderCol   = fogHorseCol;
            bgColor     = `${fogHorseCol}18`;
            label       = <span style={{color:fogHorseCol,fontSize:10,fontWeight:700,letterSpacing:1}}>☁️ {horseName(race,fogHorseIdx).split(" ")[0]} — BACK</span>;
            dieOverride = <span style={{fontSize:28,animation:"fogDrift 0.8s ease-in-out"}}>☁️</span>;
          } else if(isMagic) {
            if(di===0) {
              borderCol = magicHorseColor;
              bgColor   = `${magicHorseColor}18`;
              label     = <span style={{color:magicHorseColor,fontSize:11,fontWeight:700}}><span style={{filter:horseCoat(race,magicHorseIdx)}}>🐴</span> {horseName(race,magicHorseIdx).split(" ")[0]}</span>;
            } else {
              borderCol = "#00f5ff";
              bgColor   = "rgba(0,245,255,0.08)";
              label     = <span style={{color:"#00f5ff",fontSize:11,fontWeight:700}}>+{dv} spaces</span>;
            }
          } else {
            const horseIdx   = dv > 0 ? Math.min(dv-1, 5) : 0;
            const horseColor = HORSES[horseIdx].color;
            const isWild     = di === dice.length-1 && wildMove;
            borderCol = isWild ? "#39ff14" : horseColor;
            bgColor   = isWild ? "rgba(57,255,20,0.1)" : "rgba(255,255,255,0.06)";
            label     = isWild
              ? <span style={{color:"#39ff14",fontSize:10,letterSpacing:1,fontWeight:700}}>✨ WILD</span>
              : <span style={{color:horseColor,fontSize:11,fontWeight:700}}>{horseName(race,horseIdx).split(" ")[0]}</span>;
          }
          return (
            <div key={di} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{
                width:64, height:64, borderRadius:14,
                background: bgColor,
                border:`2.5px solid ${borderCol}`,
                boxShadow:`0 0 20px ${borderCol}88`,
                display:"flex", alignItems:"center", justifyContent:"center",
                animation: rolling ? "diceWiggle 0.1s linear infinite" : "none",
              }}>
                {dieOverride || (dv ? DICE_FACE(dv) : <span style={{fontSize:36}}>🎲</span>)}
              </div>
              <div style={{textAlign:"center"}}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* Move summary */}
      <div style={{display:"flex",justifyContent:"center",gap:10,flexWrap:"wrap",marginBottom:8}}>
        {moves.map((m,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:`${HORSES[m.horse].color}14`,border:`1px solid ${HORSES[m.horse].color}44`,borderRadius:20}}>
            <span style={{color:HORSES[m.horse].color,fontWeight:700,fontSize:13}}>{horseName(race,m.horse).split(" ")[0]}</span>
            <span style={{color:"#ffffff66",fontSize:12}}>+{m.steps}</span>
          </div>
        ))}
        {!isMagic&&isDoubles&&raceType==="hurdle"&&<div style={{padding:"5px 14px",background:"rgba(57,255,20,0.15)",border:"1px solid #39ff1466",borderRadius:20,color:"#39ff14",fontSize:13,fontWeight:700,animation:"winPulse 0.6s ease-in-out 3"}}>🌟 DOUBLES — JUMP THE HURDLE!</div>}
        {!isMagic&&isDoubles&&raceType!=="hurdle"&&<div style={{padding:"5px 12px",background:"rgba(255,215,0,0.12)",border:"1px solid #ffd70044",borderRadius:20,color:"#ffd700",fontSize:12,fontWeight:700}}>⚡ DOUBLES</div>}
        {!isMagic&&wildMove&&<div style={{padding:"5px 12px",background:"rgba(57,255,20,0.12)",border:"1px solid #39ff1444",borderRadius:20,color:"#39ff14",fontSize:12,fontWeight:700}}>✨ WILD +{wildMove.steps}</div>}
      </div>

    </div>
  );
}

// ─── DICE OVERLAY (landscape compact) ────────────────────────────────────────
function DiceOverlay({ diceResult, rolling, raceType, race, mudDie, fogDie }) {
  if(!diceResult) return null;
  const { dice=[], isDoubles, wildMove, moves=[] } = diceResult;
  const isMagic = raceType==="magic_dice";
  const magicHorseIdx = isMagic ? Math.min(dice[0]-1,5) : null;

  return (
    <div style={{
      background:"rgba(6,6,20,0.90)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      border:"1px solid rgba(255,255,255,0.10)", borderRadius:18,
      padding:"10px 18px",
      boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
      display:"flex", alignItems:"center", gap:14,
    }}>
      {/* Dice */}
      <div style={{display:"flex",gap:8}}>
        {dice.map((dv,di)=>{
          const isMud = di===mudDie;
          const isFog = di===fogDie;
          let col, content;
          if(isMud){
            const mhi = Math.min(dv-1,5);
            col = HORSES[mhi].color;
            content=<span style={{fontSize:20,animation:"mudSplat 0.5s ease-out"}}>🟫</span>;
          } else if(isFog){
            const fhi = Math.min(dv-1,5);
            col = HORSES[fhi].color;
            content=<span style={{fontSize:20,animation:"fogDrift 0.8s ease-in-out"}}>☁️</span>;
          } else if(isMagic){
            col = di===0 ? HORSES[magicHorseIdx].color : "#00f5ff";
            content = DICE_FACE(dv);
          } else {
            col = HORSES[Math.min(dv-1,5)].color;
            content = DICE_FACE(dv);
          }
          return (
            <div key={di} style={{
              width:48, height:48, borderRadius:10,
              border:`2px solid ${col}`,
              background:`color-mix(in srgb, ${col} 10%, #06061a)`,
              boxShadow:`0 0 16px ${col}66`,
              display:"flex", alignItems:"center", justifyContent:"center",
              animation: rolling ? "diceWiggle 0.1s linear infinite" : "none",
              fontSize:24,
            }}>{content}</div>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{width:1,height:40,background:"rgba(255,255,255,0.08)"}}/>

      {/* Result info */}
      <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:100}}>
        {isMagic && dice.length>=2 && (
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{filter:horseCoat(race,magicHorseIdx),fontSize:14}}>🐴</span>
            <span style={{color:HORSES[magicHorseIdx].color,fontWeight:700,fontSize:12}}>{horseName(race,magicHorseIdx).split(" ")[0]}</span>
            <span style={{color:"#00f5ff",fontSize:11}}>+{dice[1]}</span>
          </div>
        )}
        {!isMagic && moves.filter(m=>m.steps>0).map((m,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:HORSES[m.horse].color,flexShrink:0}}/>
            <span style={{color:HORSES[m.horse].color,fontWeight:700,fontSize:11}}>{horseName(race,m.horse).split(" ")[0]}</span>
            <span style={{color:"rgba(255,255,255,0.4)",fontSize:10}}>+{m.steps}</span>
          </div>
        ))}
        {moves.filter(m=>m.fog).map((m,i)=>(
          <div key={"fog"+i} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:HORSES[m.horse].color,flexShrink:0}}/>
            <span style={{color:HORSES[m.horse].color,fontWeight:700,fontSize:11}}>{horseName(race,m.horse).split(" ")[0]}</span>
            <span style={{color:HORSES[m.horse].color,fontSize:10,opacity:0.7}}>☁️ back</span>
          </div>
        ))}
        {!isMagic && isDoubles && (
          <div style={{background:"rgba(255,215,0,0.1)",border:"1px solid rgba(255,215,0,0.3)",borderRadius:8,padding:"2px 8px",color:"#ffd700",fontSize:10,fontWeight:700,alignSelf:"flex-start"}}>
            {raceType==="hurdle"?"🌟 JUMP!":"⚡ DOUBLES"}
          </div>
        )}
        {mudDie!==null && (
          <div style={{background:"rgba(80,40,10,0.4)",border:"1px solid #8B5E3C55",borderRadius:8,padding:"2px 8px",color:"#a0724a",fontSize:10,fontWeight:700,alignSelf:"flex-start"}}>🟫 MUD</div>
        )}
      </div>
    </div>
  );
}



// ─── MINI TRACK OVERLAY ───────────────────────────────────────────────────────
function MiniTrack({ positions, legDone, winner, raceType }) {
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const W=150, H=50;
  const cornerR=9, trackW=8;
  const lx=cornerR+3, rx=W-cornerR-3, ty=cornerR+3, by=H-cornerR-3;
  const isDownBack = raceType==="down_back"||raceType==="magic_dice";

  function trackPath(ctx, inset=0) {
    const r=Math.max(1,cornerR-inset), l=lx+inset, r2=rx-inset, t=ty+inset, b=by-inset;
    ctx.beginPath();
    ctx.moveTo(l+r,t); ctx.lineTo(r2-r,t);
    ctx.arc(r2-r,t+r,r,-Math.PI/2,0);
    ctx.lineTo(r2,b-r); ctx.arc(r2-r,b-r,r,0,Math.PI/2);
    ctx.lineTo(l+r,b); ctx.arc(l+r,b-r,r,Math.PI/2,Math.PI);
    ctx.lineTo(l,t+r); ctx.arc(l+r,t+r,r,Math.PI,-Math.PI/2);
    ctx.closePath();
  }

  function pt(t, inset=0) {
    const r=Math.max(1,cornerR-inset), l=lx+inset, r2=rx-inset, top=ty+inset, bot=by-inset;
    const sw=(r2-r)-(l+r), arc=Math.PI/2*r, total=sw*2+arc*4;
    const d=((t%1)+1)%1*total;
    if(d<sw) return {x:l+r+d, y:top};
    let dd=d-sw;
    if(dd<arc){const a=-Math.PI/2+(dd/arc)*Math.PI/2; return {x:r2-r+r*Math.cos(a),y:top+r+r*Math.sin(a)};}
    dd-=arc;
    if(dd<arc){const a=(dd/arc)*Math.PI/2; return {x:r2-r+r*Math.cos(a),y:bot-r+r*Math.sin(a)};}
    dd-=arc;
    if(dd<sw) return {x:r2-r-dd, y:bot};
    dd-=sw;
    if(dd<arc){const a=Math.PI/2+(dd/arc)*Math.PI/2; return {x:l+r+r*Math.cos(a),y:bot-r+r*Math.sin(a)};}
    dd-=arc;
    const a=Math.PI+(dd/arc)*Math.PI/2;
    return {x:l+r+r*Math.cos(a),y:top+r+r*Math.sin(a)};
  }

  useEffect(()=>{
    if(!visible) return;
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    // outer grass
    trackPath(ctx,-2); ctx.fillStyle="rgba(18,42,16,0.85)"; ctx.fill();
    // dirt
    trackPath(ctx,0); ctx.fillStyle="rgba(40,33,16,0.85)"; ctx.fill();
    // inner grass
    trackPath(ctx,trackW); ctx.fillStyle="rgba(18,42,16,0.85)"; ctx.fill();
    // edges
    trackPath(ctx,0); ctx.strokeStyle="rgba(255,255,255,0.13)"; ctx.lineWidth=0.7; ctx.stroke();
    trackPath(ctx,trackW); ctx.strokeStyle="rgba(255,255,255,0.08)"; ctx.lineWidth=0.7; ctx.stroke();
    // finish line — bottom-left straight start
    const fa=pt(0.01,0), fb=pt(0.01,trackW);
    ctx.beginPath(); ctx.moveTo(fa.x,fa.y); ctx.lineTo(fb.x,fb.y);
    ctx.strokeStyle="rgba(255,215,0,0.85)"; ctx.lineWidth=1.5; ctx.stroke();

    // Dot position logic:
    // Standard race: gate→finish = bottom-straight (left→right) only = t 0→0.5
    //   so pos/TRACK_SPACES maps to t 0→0.5
    // Down/back & magic: full loop = t 0→1
    //   going: pos/TRACK_SPACES maps to t 0→0.5
    //   returning: (TRACK_SPACES-pos)/TRACK_SPACES maps to t 0.5→1
    HORSES.forEach((h,hi)=>{
      const pos=positions[hi], ret=isDownBack&&legDone[hi];
      let t;
      if(!isDownBack) {
        // Standard: only uses bottom straight + right turn + top straight = t 0→0.5
        t = (pos / TRACK_SPACES) * 0.5;
      } else {
        if(!ret) t = (pos / TRACK_SPACES) * 0.5;
        else     t = 0.5 + ((TRACK_SPACES - pos) / TRACK_SPACES) * 0.5;
      }
      const m=pt(t, trackW/2);
      const g=ctx.createRadialGradient(m.x,m.y,0,m.x,m.y,5);
      g.addColorStop(0,h.color+"99"); g.addColorStop(1,h.color+"00");
      ctx.beginPath(); ctx.arc(m.x,m.y,5,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x,m.y,winner===hi?3.5:2.2,0,Math.PI*2);
      ctx.fillStyle=winner===hi?"#ffd700":h.color; ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.45)"; ctx.lineWidth=0.5; ctx.stroke();
    });
  },[positions,legDone,winner,visible]);

  return (
    <div style={{position:"fixed",bottom:16,left:12,zIndex:30,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:5}}>
      {/* Toggle button — matches chat button style */}
      <button onClick={()=>setVisible(v=>!v)} style={{
        width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.15)",
        background:"rgba(10,10,30,0.85)",backdropFilter:"blur(8px)",
        color:"#ffffff99",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow:"0 2px 10px rgba(0,0,0,0.4)",
      }}>🏟</button>
      {/* Track panel */}
      {visible && (
        <div style={{
          borderRadius:8,overflow:"hidden",
          border:"1px solid rgba(255,255,255,0.07)",
          boxShadow:"0 2px 14px rgba(0,0,0,0.5)",
          background:"transparent",
        }}>
          <canvas ref={canvasRef} width={W} height={H} style={{display:"block",width:W,height:H}}/>
        </div>
      )}
    </div>
  );
}


// Fast-forward race state: runs rollCount rolls silently using the seeded die,
// returns {positions, legDone, skipped, phase, tieHorses, rollCount, winner}
function fastForwardRace(raceType, condition, die) {
  const SPACES = TRACK_SPACES, TB = TIEBREAK_SPACES;
  const pos  = Array(6).fill(0);
  const leg  = Array(6).fill(false);
  const skip = Array(6).fill(false);
  let phase = "main", tieHorses = null, winner = null, rc = 0;

  const rollOnce = () => {
    const nd = raceType === "triple_dice" ? 3 : 2;
    const dice = Array.from({length:nd}, die);
    const isDoubles = nd === 2 && dice[0] === dice[1];
    let moves = [];

    if(phase === "tiebreak") {
      dice.forEach(d => { const hi=Math.min(d-1,5); if(tieHorses.includes(hi)) moves.push({horse:hi,steps:1}); });
    } else if(raceType === "magic_dice") {
      moves.push({horse:Math.min(dice[0]-1,5), steps:dice[1]});
    } else if(condition === "rain" && (rc+1)%3===0) {
      const si = dice[0]<=dice[1]?0:1;
      dice.forEach((d,di)=>{ if(di!==si) moves.push({horse:Math.min(d-1,5),steps:1}); });
    } else if(condition === "fog" && (rc+1)%4===0) {
      const fi = 0; // deterministic fog index for ff
      dice.forEach((d,di)=>moves.push({horse:Math.min(d-1,5),steps:di===fi?-1:1,fog:di===fi}));
    } else if(isDoubles) {
      moves.push({horse:Math.min(dice[0]-1,5), steps:2});
    } else {
      dice.forEach(d=>moves.push({horse:Math.min(d-1,5),steps:1}));
    }

    const finishers = [];
    moves.forEach(({horse,steps})=>{
      if(skip[horse]){ skip[horse]=false; return; }
      if(raceType==="down_back"||raceType==="magic_dice"){
        if(!leg[horse]){
          const dest=pos[horse]+steps;
          if(dest>=SPACES){ leg[horse]=true; pos[horse]=Math.max(0,SPACES-(dest-SPACES)); if(pos[horse]<=0) finishers.push(horse); }
          else pos[horse]=dest;
        } else { pos[horse]=Math.max(0,pos[horse]-steps); if(pos[horse]<=0&&leg[horse]) finishers.push(horse); }
      } else if(raceType==="hurdle"){
        const hp=HURDLE_CELL+1;
        if(pos[horse]===hp-1){ if(isDoubles){ pos[horse]=hp+1; skip[horse]="jump"; } }
        else {
          const dest=pos[horse]+steps;
          pos[horse]=dest>=hp&&pos[horse]<hp-1?hp-1:dest===hp?hp-1:Math.min(SPACES,dest);
          if(pos[horse]>=SPACES) finishers.push(horse);
        }
      } else {
        if(steps<0) pos[horse]=Math.max(0,pos[horse]+steps);
        else { pos[horse]=Math.min(SPACES,pos[horse]+steps); if(pos[horse]>=SPACES) finishers.push(horse); }
      }
    });
    skip.forEach((s,i)=>{ if(s==="jump") skip[i]=false; });
    rc++;

    if(finishers.length===1 && phase!=="tiebreak") { winner=finishers[0]; return true; }
    if(finishers.length>1 && phase!=="tiebreak") {
      phase="tiebreak"; tieHorses=[...finishers];
      for(let i=0;i<6;i++) pos[i]=0; rc=0;
    }
    if(finishers.length>=1 && phase==="tiebreak") { winner=finishers[0]; return true; }
    return false;
  };

  return { rollOnce, getState: ()=>({positions:[...pos],legDone:[...leg],skipped:[...skip],phase,tieHorses,rollCount:rc,winner}) };
}

// ─── RACE ENGINE HOOK ─────────────────────────────────────────────────────────
function useRaceEngine(raceType, onWinner, condition="sunny", onGunshot=null, seed=null, raceStartTime=null, nowMs=null) {
  // ── Fast-forward to current race position if joining mid-race ──────────────
  const initState = useMemo(()=>{
    if(!seed || !raceStartTime) return null;
    // Use the passed-in nowMs if available (respects dev speed offset), else Date.now()
    const elapsed = ((typeof nowMs === "number" ? nowMs : Date.now()) - raceStartTime) / 1000;
    if(elapsed <= 1.5) return null; // race just started, no need to FF
    // How many rolls have completed? First roll fires at ~1.3s, then every ROLL_INTERVAL ms
    const rollsCompleted = Math.max(0, Math.floor((elapsed - 1.3) / (ROLL_INTERVAL / 1000)));
    if(rollsCompleted <= 0) return null;
    const die = makeSeededDie(seed);
    const ff = fastForwardRace(raceType, condition, die);
    let finished = false;
    for(let i = 0; i < rollsCompleted && !finished; i++) {
      finished = ff.rollOnce();
    }
    const state = ff.getState();
    return { ...state, die }; // return die so engine continues from correct point
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [positions,   setPositions]   = useState(initState?.positions || HORSES.map(()=>0));
  const [legDone,     setLegDone]     = useState(initState?.legDone   || HORSES.map(()=>false));
  const [skipped,     setSkipped]     = useState(initState?.skipped   || HORSES.map(()=>false));
  const [activeHorses,setActiveHorses]= useState([]);
  const [diceResult,  setDiceResult]  = useState(null);
  const [rolling,     setRolling]     = useState(false);
  const [rollCount,   setRollCount]   = useState(initState?.rollCount || 0);
  const [winner,      setWinner]      = useState(initState?.winner ?? null);
  const [tieHorses,   setTieHorses]   = useState(initState?.tieHorses || null);
  const [phase,       setPhase]       = useState(initState?.phase     || "main");
  const [jumpingHorses,  setJumpingHorses]  = useState([]);
  const [slidingHorses,  setSlidingHorses]  = useState([]);
  const [mudDie,         setMudDie]         = useState(null);
  const [fogDie,         setFogDie]         = useState(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [onFire,         setOnFire]         = useState(HORSES.map(()=>false));
  const [movedHorses,    setMovedHorses]    = useState([]);

  const ref = useRef({
    running: initState?.winner == null, // stop if already finished during FF
    positions: initState?.positions || HORSES.map(()=>0),
    legDone:   initState?.legDone   || HORSES.map(()=>false),
    skipped:   initState?.skipped   || HORSES.map(()=>false),
    rollCount: initState?.rollCount || 0,
    winner:    initState?.winner ?? null,
    phase:     initState?.phase  || "main",
    tieHorses: initState?.tieHorses || null,
    tiePositions: null,
    fireHistory: HORSES.map(()=>[]),
    onFire: HORSES.map(()=>false),
  });
  // Use the die that was fast-forwarded to the right point in sequence
  const dieRef = useRef(initState?.die || (seed ? makeSeededDie(seed) : rng));

  // ── build dice result ──────────────────────────────────────────────────────
  const buildRoll = useCallback((raceType, rc, positions, legDone, skipped, phase, tieHorses, condition="sunny") => {
    const numDice = raceType==="triple_dice" ? 3 : 2;
    const dice    = Array.from({length:numDice},()=>dieRef.current());
    const isDoubles = numDice===2 && dice[0]===dice[1];

    let moves = [];
    let wildMove = null;

    if(phase==="tiebreak") {
      // Same as normal — die face maps to horse index (d-1), but only tiebreak horses move
      dice.forEach(d=>{
        const hi = Math.min(d-1, 5);
        if(tieHorses.includes(hi)) moves.push({horse:hi, steps:1});
      });
    } else if(raceType==="magic_dice") {
      // die 0 = which horse (1-6 → horse 0-5), die 1 = how many spaces
      const horse = Math.min(dice[0]-1, 5);
      const steps = dice[1];
      moves.push({horse, steps});
    } else if(condition==="rain" && (rc+1)%3===0) {
      // Every 3rd roll: one die is mud-swamped — not a valid doubles roll
      const skipIdx = dice[0]<=dice[1] ? 0 : 1;
      dice.forEach((d,di)=>{
        if(di===skipIdx) return; // this die is mud — skip it
        moves.push({horse:Math.min(d-1,5), steps:1});
      });
      moves._mudDie = skipIdx;
      moves._noDoubles = true; // mud cancels doubles
    } else if(condition==="fog" && (rc+1)%4===0) {
      // Every 4th roll: one die sends horse backwards — not a valid doubles roll
      const fogIdx = Math.floor(Math.random()*dice.length);
      dice.forEach((d,di)=>{
        const horse = Math.min(d-1,5);
        if(di===fogIdx) moves.push({horse, steps:-1, fog:true});
        else moves.push({horse, steps:1});
      });
      moves._fogDie = fogIdx;
      moves._noDoubles = true; // fog cancels doubles
    } else if(isDoubles) {
      // doubles: that horse moves +2
      moves.push({horse:Math.min(dice[0]-1,5), steps:2});
    } else {
      dice.forEach(d=>{moves.push({horse:Math.min(d-1,5), steps:1});});
    }

    // preserve condition markers before merging (array properties get lost in finalMoves)
    const mudDieIdx  = moves._mudDie ?? null;
    const fogDieIdx  = moves._fogDie ?? null;
    const noDoubles  = moves._noDoubles ?? false;

    // merge steps for same horse, preserve fog flag
    const merged = {};
    moves.forEach(({horse,steps,fog})=>{
      merged[horse] = (merged[horse]||0) + steps;
      if(fog) merged["_fog_"+horse] = true;
    });
    const finalMoves = Object.entries(merged)
      .filter(([h])=>!h.startsWith("_fog_"))
      .map(([h,s])=>({horse:parseInt(h), steps:s, fog:!!merged["_fog_"+h]}));

    return {dice, isDoubles: isDoubles && !noDoubles, wildMove, moves:finalMoves, mudDieIdx, fogDieIdx, rollCount:rc};
  },[]);

  // ── apply moves ────────────────────────────────────────────────────────────
  const applyMoves = useCallback((moves, positions, legDone, skipped, raceType, phase, tieHorses, isDoubles=false) => {
    const newPos  = [...positions];
    const newLeg  = [...legDone];
    const newSkip = [...skipped];
    let winner    = null;

    if(phase==="tiebreak") {
      moves.forEach(({horse,steps})=>{
        newPos[horse]=Math.min(TIEBREAK_SPACES, newPos[horse]+steps);
        if(newPos[horse]>=TIEBREAK_SPACES && winner===null) winner=horse;
      });
      return {newPos,newLeg,newSkip,winner};
    }

    const finishers = []; // collect ALL horses that finish this roll

    moves.forEach(({horse,steps})=>{
      if(newSkip[horse]){ newSkip[horse]=false; return; }

      if(raceType==="down_back" || raceType==="magic_dice") {
        if(!newLeg[horse]){
          const dest = newPos[horse] + steps;
          if(dest >= TRACK_SPACES){
            const overshoot = dest - TRACK_SPACES;
            newLeg[horse] = true;
            newPos[horse] = Math.max(0, TRACK_SPACES - overshoot);
            if(newPos[horse] <= 0) finishers.push(horse);
          } else {
            newPos[horse] = dest;
          }
        } else {
          newPos[horse]=Math.max(0,newPos[horse]-steps);
          if(newPos[horse]<=0 && newLeg[horse]) finishers.push(horse);
        }
      } else if(raceType==="hurdle") {
        const hurdlePos = HURDLE_CELL + 1;
        const atHurdle  = newPos[horse] === hurdlePos - 1;
        if(atHurdle) {
          if(isDoubles) {
            newPos[horse] = hurdlePos + 1;
            newSkip[horse] = "jump";
          }
        } else {
          const dest = newPos[horse] + steps;
          if(dest >= hurdlePos && newPos[horse] < hurdlePos - 1) {
            newPos[horse] = hurdlePos - 1;
          } else if(dest === hurdlePos) {
            newPos[horse] = hurdlePos - 1;
          } else {
            newPos[horse] = Math.min(TRACK_SPACES, dest);
          }
          if(newPos[horse]>=TRACK_SPACES) finishers.push(horse);
        }
      } else {
        if(steps < 0) {
          newPos[horse] = Math.max(0, newPos[horse] + steps);
        } else {
          newPos[horse]=Math.min(TRACK_SPACES,newPos[horse]+steps);
          if(newPos[horse]>=TRACK_SPACES) finishers.push(horse);
        }
      }
    });

    // If exactly one finisher — winner. If multiple — tie handled upstream.
    winner = finishers.length === 1 ? finishers[0] : finishers.length > 1 ? finishers[0] : null;
    return {newPos,newLeg,newSkip,winner,finishers};
  },[]);

  useEffect(()=>{
    // ── Timing layout (one full cycle = ROLL_INTERVAL ms) ────────────────────
    // [0ms]       doRoll called → dice start flashing
    // [DICE_FLASH_DUR]  dice settle → show final values + active horses
    // [+HORSE_MOVE_DELAY]  dice overlay fades, horses slide
    // [+HORSE_MOVE_DUR]  horses landed, dice stay visible a bit longer
    // [+NEXT_ROLL_PAUSE]  dice clear, brief pause
    // [= ROLL_INTERVAL]  next doRoll fires
    //
    // DICE_FLASH_DUR(900) + HORSE_MOVE_DELAY(300) + HORSE_MOVE_DUR(600) + NEXT_ROLL_PAUSE(900)
    //   = 2700ms of animation — leaves 2500ms of total cycle as slack/display time
    // Total cycle ROLL_INTERVAL = 5200ms

    let timeout;
    const timeouts = []; // track all timeouts for cleanup
    const T = (fn, ms) => { const id = setTimeout(fn, ms); timeouts.push(id); return id; };

    const doRoll = () => {
      if(!ref.current.running) return;
      const rc  = ref.current.rollCount;
      const ph  = ref.current.phase;
      const tieH = ref.current.tieHorses || null;

      const dr = buildRoll(raceType, rc, ref.current.positions, ref.current.legDone, ref.current.skipped, ph, tieH, condition);

      // ── Phase 1: Dice flash ─────────────────────────────────────────────────
      setRolling(true);
      setOverlayVisible(true);
      setActiveHorses([]);
      setDiceResult({...dr, rollCount:rc, moves:[], isDoubles:false, wildMove:null});

      const flashCount = 8;
      const flashEvery = Math.floor(DICE_FLASH_DUR / flashCount);
      let flashes = 0;
      const flashInt = setInterval(()=>{
        const fakeDice = Array.from({length:dr.dice.length}, ()=>rng());
        setDiceResult(d=>({...d, dice:fakeDice}));
        sfx.diceRoll();
        flashes++;
        if(flashes >= flashCount) {
          clearInterval(flashInt);

          // ── Phase 2: Dice settle — show final values ──────────────────────
          setDiceResult({...dr, rollCount:rc});
          setActiveHorses(dr.moves.filter(m=>m.steps>0).map(m=>m.horse));
          setRolling(false);
          setMudDie(dr.mudDieIdx ?? null);
          setFogDie(dr.fogDieIdx ?? null);
          setOverlayVisible(true);
          sfx.diceSettle();
          if(dr.isDoubles && raceType!=="magic_dice") sfx.doubles();

          // ── Phase 3: Horses move (after short hold so you read the dice) ──
          T(()=>{
            setOverlayVisible(false); // dice start fading as horses move

            const applyResult = applyMoves(dr.moves, ref.current.positions, ref.current.legDone, ref.current.skipped, raceType, ph, tieH, dr.isDoubles);
            const {newPos,newLeg,newSkip,winner:w} = applyResult;
            const jumpers   = newSkip.map((s,i)=>s==="jump"?i:-1).filter(i=>i>=0);
            const cleanSkip = newSkip.map(s=>s==="jump"?false:s);

            ref.current.positions = newPos;
            ref.current.legDone   = newLeg;
            ref.current.skipped   = cleanSkip;
            ref.current.rollCount = rc + 1;
            setPositions([...newPos]);
            setLegDone([...newLeg]);
            setSkipped([...cleanSkip]);
            setRollCount(rc + 1);

            // Fire tracking
            const rawDice = dr.dice;
            const newFireHistory = ref.current.fireHistory.map((hist, hi) => {
              const appeared = rawDice.includes(hi + 1);
              return [...hist, appeared].slice(-3);
            });
            const newOnFire = newFireHistory.map((hist, hi) => {
              if(hist.length < 3) return ref.current.onFire[hi];
              if(hist.every(v=>v===true))  return true;
              if(hist.every(v=>v===false)) return false;
              return ref.current.onFire[hi];
            });
            ref.current.fireHistory = newFireHistory;
            ref.current.onFire      = newOnFire;
            setOnFire([...newOnFire]);

            // Speed lines
            const moved = dr.moves.filter(m=>m.steps>0).map(m=>m.horse);
            setMovedHorses(moved);
            T(()=>setMovedHorses([]), HORSE_MOVE_DUR + 100);

            // Sounds
            if(jumpers.length > 0) {
              setJumpingHorses(jumpers);
              sfx.hurdleJump();
              T(()=>setJumpingHorses([]), 900);
            } else {
              const totalSteps = dr.moves.reduce((s,m)=>s+(m.steps>0?m.steps:0), 0);
              if(totalSteps > 0) T(()=>sfx.horseMove(Math.min(totalSteps,3)), 80);
            }

            // Fog slides
            const sliders = dr.moves.filter(m=>m.fog&&m.steps<0).map(m=>m.horse);
            if(sliders.length > 0) {
              setSlidingHorses(sliders);
              T(()=>setSlidingHorses([]), 800);
            }

            // Clear weather die markers
            T(()=>{ setMudDie(null); setFogDie(null); }, HORSE_MOVE_DUR + 200);

            // Turn-around sound
            const newTurners = newLeg.filter((l,i)=>l && !ref.current.legDone[i]);
            if(newTurners.length > 0) T(()=>sfx.turnAround(), 100);

            // ── Phase 4: After horses land — schedule next roll or end ──────
            T(()=>{
              if(w !== null && ref.current.winner === null) {
                if(ph === "tiebreak") {
                  ref.current.winner = w;
                  ref.current.running = false;
                  setWinner(w);
                  sfx.finishLine();
                  sfx.win();
                  T(()=>onWinner(w), 2600);
                } else {
                  const potentialWinners = [w];
                  newPos.forEach((p,hi)=>{
                    if(hi !== w) {
                      const goalMet = raceType==="down_back" ? (p<=0 && newLeg[hi]) : (p>=TRACK_SPACES);
                      if(goalMet) potentialWinners.push(hi);
                    }
                  });
                  if(potentialWinners.length > 1) {
                    const tbPos = HORSES.map(()=>0);
                    ref.current.positions  = tbPos;
                    ref.current.phase      = "tiebreak";
                    ref.current.tieHorses  = potentialWinners;
                    ref.current.rollCount  = 0;
                    setPositions([...tbPos]);
                    setPhase("tiebreak");
                    setTieHorses(potentialWinners);
                    setRollCount(0);
                    T(doRoll, 2400);
                  } else {
                    ref.current.winner  = w;
                    ref.current.running = false;
                    setWinner(w);
                    sfx.finishLine();
                    T(()=>onWinner(w), 2600);
                  }
                }
              } else {
                // Next roll — fire at the top of the next ROLL_INTERVAL cycle
                T(doRoll, NEXT_ROLL_PAUSE);
              }
            }, HORSE_MOVE_DUR);

          }, HORSE_MOVE_DELAY);
        }
      }, flashEvery);
    };

    // If already fast-forwarded to a winner, fire immediately
    if(ref.current.winner !== null) {
      timeout = setTimeout(()=>onWinner(ref.current.winner), 100);
      return ()=>{ clearTimeout(timeout); };
    }

    // If joining mid-race: compute how far into the current roll cycle we are
    // and delay first doRoll to align with the next roll boundary
    if(ref.current.rollCount > 0 && raceStartTime) {
      const elapsed   = Date.now() - raceStartTime;
      const firstRollAt = 1300; // ~1.3s after race start
      const intoRace  = Math.max(0, elapsed - firstRollAt);
      const cyclePos  = intoRace % ROLL_INTERVAL; // ms into current roll cycle
      const msUntilNextRoll = ROLL_INTERVAL - cyclePos;
      // If we're already most of the way through a cycle (>80%), just wait for next
      // If we're early in a cycle (<30%), fire immediately so user sees something
      const delay = cyclePos < ROLL_INTERVAL * 0.3 ? 200 : msUntilNextRoll;
      timeout = setTimeout(doRoll, Math.max(200, delay));
    } else if(ref.current.rollCount > 0) {
      timeout = setTimeout(doRoll, 200);
    } else {
      // Fresh start: suspense pause → gunshot → first roll
      timeout = setTimeout(()=>{
        sfx.gunshot();
        if(onGunshot) onGunshot();
        timeout = setTimeout(doRoll, 600);
      }, 700);
    }

    return ()=>{
      ref.current.running = false;
      clearTimeout(timeout);
      timeouts.forEach(clearTimeout);
    };
  },[raceType, onWinner, buildRoll, applyMoves, raceStartTime]);

  return {positions,legDone,skipped,activeHorses,diceResult,rolling,rollCount,winner,tieHorses,phase,jumpingHorses,slidingHorses,mudDie,fogDie,overlayVisible,onFire,movedHorses};
}


// ─── RACE CHAT ────────────────────────────────────────────────────────────────
function RaceChat({ raceId, user, msgs, setMsgs, open, setOpen, unread, setUnread }) {
  const [input,   setInput]   = useState("");
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Subscribe to Firestore chat in real time ──────────────────────────────
  useEffect(() => {
    if(!raceId) return;
    const chatRef = doc(db, "chat", raceId);
    const unsub = onSnapshot(chatRef, (snap) => {
      if(snap.exists()) {
        const msgs2 = snap.data().msgs || [];
        setMsgs(msgs2);
      }
    });
    return () => unsub();
  }, [raceId]);

  // Auto-scroll on new messages
  useEffect(()=>{
    if(open) {
      bottomRef.current?.scrollIntoView({behavior:"smooth"});
      setUnread(0);
    } else if(msgs.length>0) {
      setUnread(u=>u+1);
    }
  },[msgs]);

  useEffect(()=>{
    if(open) {
      setUnread(0);
      bottomRef.current?.scrollIntoView({behavior:"instant"});
      setTimeout(()=>inputRef.current?.focus(), 100);
    }
  },[open]);

  const send = async () => {
    const text = input.trim();
    if(!text) return;
    setInput("");
    const chatRef = doc(db, "chat", raceId);
    const msg = { id: Date.now(), user: user?.username||"Guest", text, ts: Date.now() };
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(chatRef);
      const existing = snap.exists() ? (snap.data().msgs || []) : [];
      // Keep last 100 messages
      const updated = [...existing, msg].slice(-100);
      tx.set(chatRef, { msgs: updated });
    });
  };

  const fmt = (ts) => {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0");
  };

  return (
    <>
      {/* Chat bubble toggle button — position fixed but safe-area aware */}
      <div style={{position:"fixed",bottom:"max(20px, env(safe-area-inset-bottom, 20px))",right:20,zIndex:200,transform:"translateZ(0)",willChange:"transform"}}>
        {open && (
          <div style={{
            position:"absolute",bottom:52,right:0,
            width:280,height:"30vh",minHeight:180,maxHeight:320,
            background:"rgba(6,6,20,0.95)",
            backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
            border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:16,
            display:"flex",flexDirection:"column",
            boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
            overflow:"hidden",
          }}>
            {/* Header */}
            <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <span style={{fontFamily:"'Orbitron',monospace",fontSize:10,letterSpacing:2,color:"#00f5ff88"}}>RACE CHAT</span>
              <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#ffffff33",fontSize:14,padding:"0 2px",lineHeight:1}}>✕</button>
            </div>

            {/* Messages */}
            <div style={{flex:1,overflowY:"auto",padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
              {msgs.length===0 && (
                <div style={{color:"#ffffff22",fontSize:11,textAlign:"center",marginTop:20,letterSpacing:1}}>No messages yet</div>
              )}
              {msgs.map(m=>{
                const isMe = m.user===(user?.username||"Guest");
                return (
                  <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start"}}>
                    <div style={{fontSize:9,color:"#ffffff33",marginBottom:2,letterSpacing:0.5}}>
                      {isMe?"You":m.user} · {fmt(m.ts)}
                    </div>
                    <div style={{
                      maxWidth:"85%",padding:"5px 10px",borderRadius:isMe?"12px 12px 3px 12px":"12px 12px 12px 3px",
                      background:isMe?"rgba(0,245,255,0.15)":"rgba(255,255,255,0.07)",
                      border:isMe?"1px solid rgba(0,245,255,0.25)":"1px solid rgba(255,255,255,0.08)",
                      color:isMe?"#00f5ff":"#ffffffcc",fontSize:12,lineHeight:1.4,wordBreak:"break-word",
                    }}>{m.text}</div>
                  </div>
                );
              })}
              <div ref={bottomRef}/>
            </div>

            {/* Input */}
            <div style={{padding:"6px 8px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:6,flexShrink:0}}>
              <input
                ref={inputRef}
                value={input}
                onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); send(); }}}
                onBlur={()=>{ window.scrollTo(0,0); }}
                placeholder="Say something..."
                maxLength={120}
                style={{
                  flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:16,outline:"none",
                  fontFamily:"'Rajdhani',sans-serif",
                }}
              />
              <button
                onClick={send}
                style={{
                  background:"rgba(0,245,255,0.15)",border:"1px solid rgba(0,245,255,0.3)",
                  borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"#00f5ff",
                  fontSize:13,fontWeight:700,flexShrink:0,
                }}
              >↑</button>
            </div>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={()=>setOpen(o=>!o)}
          style={{
            width:44,height:44,borderRadius:"50%",
            background:open?"rgba(0,245,255,0.2)":"rgba(255,255,255,0.08)",
            border:open?"1px solid rgba(0,245,255,0.5)":"1px solid rgba(255,255,255,0.15)",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:18,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
            transition:"all 0.2s",position:"relative",
          }}
        >
          💬
          {!open && unread>0 && (
            <div style={{
              position:"absolute",top:-3,right:-3,
              width:16,height:16,borderRadius:"50%",
              background:"#ff2d55",border:"2px solid #06060f",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:8,fontWeight:700,color:"#fff",fontFamily:"'Orbitron',monospace",
            }}>{unread>9?"9+":unread}</div>
          )}
        </button>
      </div>
    </>
  );
}

// ─── RACE SCREEN ──────────────────────────────────────────────────────────────
function RaceScreen({ race, bets, totalPot, onRaceEnd, user, chatMsgs, setChatMsgs, chatOpen, setChatOpen, chatUnread, setChatUnread, auctionOwners, replayRolls=null, replayWinner=null, replaySpeed=1, replaySpeedRef=null, isReplay=false }) {
  const rt = RACE_TYPES[race.type];
  const [gateBurst, setGateBurst] = useState(false);
  const [showTie, setShowTie] = useState(false);

  // ── Roll-replay engine — clock-driven, self-correcting ──────────────────
  const [positions,      setPositions]      = useState(Array(6).fill(0));
  const [legDone,        setLegDone]        = useState(Array(6).fill(false));
  const [activeHorses,   setActiveHorses]   = useState([]);
  const [diceResult,     setDiceResult]     = useState(null);
  const [rolling,        setRolling]        = useState(false);
  const [rollCount,      setRollCount]      = useState(0);
  const [winner,         setWinner]         = useState(null);
  const [tieHorses,      setTieHorses]      = useState(null);
  const [phase,          setPhase]          = useState("main");
  const [jumpingHorses,  setJumpingHorses]  = useState([]);
  const [slidingHorses,  setSlidingHorses]  = useState([]);
  const [mudDie,         setMudDie]         = useState(null);
  const [fogDie,         setFogDie]         = useState(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [onFire,         setOnFire]         = useState(Array(6).fill(false));
  const [movedHorses,    setMovedHorses]    = useState([]);

  const skipped = Array(6).fill(false); // hurdle skip state (visual only)

  // All mutable race state in one ref — no state deps in the loop
  const engineRef = useRef({
    rolls: null, winner: null, lastRollIdx: -1,
    animating: false, winnerFired: false,
    fireHistory: Array(6).fill([]), onFire: Array(6).fill(false), gunFired: false,
  });

  // Load roll history — use replayRolls if provided, else fetch from Firestore
  useEffect(() => {
    if(replayRolls) {
      engineRef.current.rolls  = replayRolls;
      engineRef.current.winner = replayWinner;
      return;
    }
    let cancelled = false;
    const tryLoad = async () => {
      const allRolls = await fbGetRaceRolls();
      if(cancelled) return;
      const rd = allRolls[race.id];
      if(rd) {
        engineRef.current.rolls  = rd.rolls;
        engineRef.current.winner = rd.winner;
      } else {
        const { winner: w, rolls: r } = simulateRaceWithHistory(race.type, race.condition||"sunny", race.seed);
        if(!cancelled){ engineRef.current.rolls = r; engineRef.current.winner = w; }
      }
    };
    tryLoad();
    const poll = setInterval(async () => {
      if(engineRef.current.rolls || cancelled){ clearInterval(poll); return; }
      await tryLoad();
    }, 1500);
    return () => { cancelled = true; clearInterval(poll); };
  }, [race.id]);

  // Master clock — ticks every 200ms, drives all animation
  useEffect(() => {
    const FIRE_OFFSET = 1300;
    // In replay mode, use a virtual start time from now so engine fires immediately
    const fireTime = isReplay
      ? Date.now() - FIRE_OFFSET - 10  // already past fire offset
      : (race.isAuction ? race.startTime + 30000 : race.startTime);

    const tick = () => {
      const eng = engineRef.current;
      if(!eng.rolls || eng.winnerFired) return;
      const now2 = Date.now();
      const elapsed = now2 - fireTime;

      // Gunshot
      if(!eng.gunFired && (elapsed >= 600 || isReplay)) {
        eng.gunFired = true;
        sfx.gunshot();
        setGateBurst(true);
        setTimeout(() => setGateBurst(false), 700);
      }
      if(elapsed < FIRE_OFFSET && !isReplay) return;

      // In replay mode, targetIdx is simply lastRollIdx + 1 (always ready for next roll)
      const targetIdx = isReplay
        ? Math.min(eng.lastRollIdx + 1, eng.rolls.length - 1)
        : Math.min(Math.floor((elapsed - FIRE_OFFSET) / ROLL_INTERVAL), eng.rolls.length - 1);

      // Catch up silently if we're behind — jump positions without animation
      if(targetIdx > eng.lastRollIdx + 1) {
        const fr = eng.rolls[targetIdx - 1];
        if(fr){ setPositions([...fr.positions]); setLegDone([...fr.legDone]); setPhase(fr.phase||"main"); setRollCount(targetIdx); }
        eng.lastRollIdx = targetIdx - 1;
        // If catch-up lands on last roll, trigger winner immediately
        if(targetIdx >= eng.rolls.length - 1 && !eng.winnerFired) {
          eng.winnerFired = true;
          eng.lastRollIdx = eng.rolls.length - 1;
          const w = eng.winner ?? 0;
          const lastFr = eng.rolls[eng.rolls.length - 1];
          if(lastFr){ setPositions([...lastFr.positions]); setLegDone([...lastFr.legDone]); }
          setWinner(w); sfx.finishLine(); sfx.win();
          setTimeout(()=>onRaceEnd(w), 2000);
          return;
        }
      }

      // Animate next roll
      if(targetIdx > eng.lastRollIdx && !eng.animating) {
        const rollIdx = eng.lastRollIdx + 1;
        const roll = eng.rolls[rollIdx];
        if(!roll) return;
        eng.animating  = true;
        eng.lastRollIdx = rollIdx;

        setRolling(true); setOverlayVisible(true); setActiveHorses([]);
        setDiceResult({...roll, moves:[], isDoubles:false});

        // Sequence: flash(600) → hold(900) → dice fade(300) → horse moves → pause(250) → next roll
        const _spd = replaySpeedRef ? replaySpeedRef.current : 1;
        const FLASH_DUR  = 600  / _spd;
        const HOLD_DUR   = 900  / _spd;
        const FADE_DUR   = 300  / _spd;
        const MOVE_DUR   = 300  / _spd;
        const DONE_PAUSE = 450  / _spd;

        let flashes = 0;
        const nd = roll.dice.length;
        const flashEvery = Math.floor(FLASH_DUR / 8);
        const flashInt = setInterval(() => {
          setDiceResult(d => ({...d, dice: Array.from({length:nd}, ()=>Math.floor(Math.random()*6)+1)}));
          sfx.diceRoll();
          if(++flashes >= 8) {
            clearInterval(flashInt);
            setDiceResult({...roll});
            setActiveHorses(roll.moves.filter(m=>m.steps>0).map(m=>m.horse));
            setRolling(false);
            setMudDie(roll.mudDieIdx??null); setFogDie(roll.fogDieIdx??null);
            sfx.diceSettle();
            if(roll.isDoubles && race.type!=="magic_dice") sfx.doubles();

            // After dice settle: hold so user reads → fade → horse moves → tiny gap → unlock
            setTimeout(() => {
              // Dice start fading now
              setOverlayVisible(false);

              // Horse moves AFTER fade completes
              setTimeout(() => {
                setPositions([...roll.positions]); setLegDone([...roll.legDone]);
                setPhase(roll.phase||"main"); setRollCount(rollIdx+1);
                if(roll.phase==="tiebreak"&&roll.tieHorses) setTieHorses(roll.tieHorses);

                const jumpers=roll.moves.filter(m=>m.steps>0&&m.jump).map(m=>m.horse);
                if(jumpers.length>0){setJumpingHorses(jumpers);sfx.hurdleJump();setTimeout(()=>setJumpingHorses([]),900);}
                else{const ts=roll.moves.reduce((s,m)=>s+(m.steps>0?m.steps:0),0);if(ts>0)sfx.horseMove(Math.min(ts,3));}
                const sliders=roll.moves.filter(m=>m.fog&&m.steps<0).map(m=>m.horse);
                if(sliders.length>0){setSlidingHorses(sliders);setTimeout(()=>setSlidingHorses([]),600);}
                setTimeout(()=>{setMudDie(null);setFogDie(null);},400);

                const newFH=eng.fireHistory.map((h,hi)=>[...h,roll.dice.includes(hi+1)].slice(-3));
                const newOF=newFH.map((h,hi)=>{if(h.length<3)return eng.onFire[hi];if(h.every(v=>v))return true;if(h.every(v=>!v))return false;return eng.onFire[hi];});
                eng.fireHistory=newFH; eng.onFire=newOF; setOnFire([...newOF]);

                const moved=roll.moves.filter(m=>m.steps>0).map(m=>m.horse);
                setMovedHorses(moved); setTimeout(()=>setMovedHorses([]),400);

                // Unlock after horse lands + tiny pause
                setTimeout(()=>{
                  if(rollIdx===eng.rolls.length-1 && !eng.winnerFired){
                    eng.winnerFired=true;
                    const w=eng.winner??0;
                    setWinner(w); sfx.finishLine(); sfx.win();
                    setTimeout(()=>onRaceEnd(w), 2000);
                  }
                  eng.animating=false;
                }, MOVE_DUR + DONE_PAUSE);

              }, FADE_DUR); // wait for dice to fully disappear

            }, HOLD_DUR);
          }
        }, flashEvery);
      }
    };

    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [race.id, race.startTime, race.isAuction, race.type, race.condition, race.seed, onRaceEnd]);


  // Re-render on orientation change only — ignore keyboard-triggered resize events
  const [, forceUpdate] = useState(0);
  useEffect(()=>{
    let lastAngle = screen.orientation?.angle ?? (window.innerWidth > window.innerHeight ? 90 : 0);
    const onResize = () => {
      const angle = screen.orientation?.angle ?? (window.innerWidth > window.innerHeight ? 90 : 0);
      if(angle !== lastAngle) { lastAngle = angle; forceUpdate(n=>n+1); }
    };
    const onOrient = () => { lastAngle = screen.orientation?.angle ?? 0; forceUpdate(n=>n+1); };
    window.addEventListener("resize", onResize);
    screen.orientation?.addEventListener("change", onOrient);
    return () => {
      window.removeEventListener("resize", onResize);
      screen.orientation?.removeEventListener("change", onOrient);
    };
  },[]);

  const vw=window.innerWidth, vh=window.innerHeight;
  const isLandscape=vw>vh, isMobile=vw<768;
  const topBarH    = 32;
  const sideLabelW = isLandscape ? 56 : isMobile ? 62 : 94;
  const trackPadX  = isLandscape ? 10 : 24;
  const trackPadY  = isLandscape ? 6  : 12;
  const availH     = isLandscape ? vh - topBarH - trackPadY*2 : vh;
  const cellH      = isLandscape
    ? Math.floor((availH - 16) / (HORSES.length + 0.5)) // fill height evenly
    : isMobile ? 28 : 38;
  const availW     = isLandscape
    ? vw - trackPadX*2 - sideLabelW - 4
    : Math.min(vw - trackPadX*2 - sideLabelW, isMobile ? vw-sideLabelW-16 : 860-sideLabelW);
  const cellSize   = Math.floor(availW / (TRACK_SPACES + 1));
  // Scale UI elements proportionally to cell size (base cell ~52px on mobile)
  const cellScale  = Math.max(1, cellSize / 52);
  const emojiSize  = Math.round(14 * cellScale);
  const labelSize  = Math.max(9, Math.round(9 * cellScale));
  const subLabelSize = Math.max(7, Math.round(7 * cellScale));
  const colNumSize = Math.max(9, Math.round(9 * cellScale));

  // Which horses the user has money on
  const betOnHorses = new Set(Object.keys(bets||{}).map(Number).filter(k=>parseFloat(bets[k]||0)>0));

  // For down_back + magic_dice, horse visually returns
  const isDownBack = race.type==="down_back" || race.type==="magic_dice";
  const visualCell = (hi) => {
    const pos = positions[hi];
    if(phase==="tiebreak") return pos > 0 ? pos-1 : -1;
    if(isDownBack && legDone[hi]){
      return TRACK_SPACES - 1 - (TRACK_SPACES - pos);
    }
    return pos > 0 ? pos-1 : -1;
  };

  const cond = TRACK_CONDITIONS[race.condition||"sunny"];

  return (
    <div style={{height:"100vh",background:"#08081a",paddingTop:isLandscape?0:(isReplay?0:56),display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
      {winner!==null&&<Confetti/>}

      {/* TIE dramatic overlay */}
      {showTie&&(
        <div style={{position:"fixed",inset:0,zIndex:100,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.55)",animation:"tieFlash 2.2s ease-out forwards"}}>
          <div style={{textAlign:"center",animation:"tieShake 0.5s ease-in-out 0.1s"}}>
            <div style={{fontFamily:"'Orbitron',monospace",fontSize:52,fontWeight:900,letterSpacing:6,
              color:"#ffd700",textShadow:"0 0 40px #ffd700, 0 0 80px #ffd70088, 0 0 120px #ff6b0044",
              lineHeight:1}}>TIE!</div>
            <div style={{fontFamily:"'Orbitron',monospace",fontSize:14,letterSpacing:4,color:"#ffffff99",marginTop:12}}>
              TIEBREAKER RACE
            </div>
            <div style={{display:"flex",justifyContent:"center",gap:10,marginTop:16}}>
              {tieHorses&&tieHorses.map(hi=>(
                <div key={hi} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <span style={{fontSize:22}}>🐴</span>
                  <div style={{width:8,height:8,borderRadius:"50%",background:HORSES[hi].color,boxShadow:`0 0 10px ${HORSES[hi].color}`}}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}



      {/* Condition atmosphere overlay */}
      {race.condition==="rain" && (
        <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:1,overflow:"hidden"}}>
          {/* Tint */}
          <div style={{position:"absolute",inset:0,background:"rgba(30,50,100,0.22)"}}/>
          {/* Rain streaks */}
          {Array.from({length:28}).map((_,i)=>(
            <div key={i} style={{
              position:"absolute", width:1.5, background:"rgba(120,160,255,0.35)",
              left:`${(i*37+11)%100}%`, top:`${(i*19)%80}%`,
              height:`${12+i%8}px`,
              animation:`rainDrop ${0.7+i%4*0.15}s linear ${i*0.08}s infinite`,
              transform:"rotate(10deg)",
            }}/>
          ))}
        </div>
      )}
      {race.condition==="fog" && (
        <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:1}}>
          <div style={{position:"absolute",inset:0,background:"rgba(160,160,200,0.12)"}}/>
          {/* Fog wisps */}
          {Array.from({length:5}).map((_,i)=>(
            <div key={i} style={{
              position:"absolute",
              left:`${i*22}%`, top:`${30+i*8}%`,
              width:"35%", height:40,
              background:"rgba(200,200,230,0.18)",
              borderRadius:20,
              filter:"blur(18px)",
              animation:`fogPulse ${2.5+i*0.5}s ease-in-out ${i*0.4}s infinite`,
            }}/>
          ))}
        </div>
      )}

      {/* Top info bar */}
      <div style={{background:"rgba(10,10,28,0.9)",borderBottom:"1px solid #ffffff0d",padding:isLandscape?"4px 14px":"6px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,flexShrink:0,minHeight:isLandscape?topBarH:undefined}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>{rt.icon}</span>
          <span style={{color:"#ffffff88",fontFamily:"'Orbitron',monospace",fontSize:isMobile?11:14,letterSpacing:1}}>{race.name}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {phase==="tiebreak" && <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:12,letterSpacing:1,animation:"racingBlink 0.6s infinite"}}>🔥 TIE-BREAKER!</span>}
          {race.condition&&race.condition!=="sunny"&&<span style={{background:`${cond.color}22`,border:`1px solid ${cond.color}55`,borderRadius:20,padding:"2px 10px",color:cond.color,fontSize:11,fontWeight:700,letterSpacing:1}}>{cond.icon} {cond.label.toUpperCase()}</span>}
          <span style={{color:totalPot>0?"#ffd700":"#ffffff44",fontFamily:"'Orbitron',monospace",fontSize:isMobile?13:17,textShadow:totalPot>0?"0 0 12px #ffd70066":"none"}}>🌐 POT ${fmt2(totalPot)}</span>
        </div>
      </div>

      {/* ── LANDSCAPE: horizontal rows ── */}
      {isLandscape && (
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:`${trackPadY}px ${trackPadX}px`,overflow:"hidden",position:"relative",zIndex:2}}>
          <div style={{display:"flex",marginBottom:2,marginLeft:sideLabelW+6}}>
            {Array.from({length:phase==="tiebreak"?TIEBREAK_SPACES:TRACK_SPACES}).map((_,ci)=>(
              <div key={ci} style={{width:cellSize,flexShrink:0,textAlign:"center",fontSize:colNumSize,color:
                race.type==="hurdle"&&ci===HURDLE_CELL?"#ff6b0077":
                phase!=="tiebreak"&&race.type!=="down_back"&&race.type!=="magic_dice"&&ci===TRACK_SPACES-1?"#ffd70055":"#ffffff18",
                fontWeight:race.type==="hurdle"&&ci===HURDLE_CELL?700:400
              }}>{ci+1}</div>
            ))}
          </div>
          {HORSES.map((h,hi)=>{
            const pos=positions[hi], isActive=activeHorses.includes(hi), isWinner=winner===hi;
            const isSkip=skipped[hi], isJumping=jumpingHorses.includes(hi), isSliding=slidingHorses.includes(hi);
            const returning=(race.type==="down_back"||race.type==="magic_dice")&&legDone[hi];
            const vc=visualCell(hi), inTie=tieHorses?.includes(hi), dimmed=tieHorses&&!inTie;
            const coat=horseCoat(race,hi);
            const lottieCoat=horseLottieCoat(race,hi);
            const isBet=betOnHorses.has(hi)&&winner===null;
            const isHot=onFire[hi];
            const isMoved=movedHorses.includes(hi);
            const flameLayers = isHot ? <>
              <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-23*cellScale),width:Math.round(46*cellScale),height:Math.round(58*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ff4500dd 0%, #ff6b00aa 40%, transparent 72%)",animation:"flameA 0.45s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
              <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-15*cellScale),width:Math.round(30*cellScale),height:Math.round(46*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ffd700cc 0%, #ff450099 45%, transparent 72%)",animation:"flameB 0.38s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
              <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-8*cellScale),width:Math.round(16*cellScale),height:Math.round(32*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ffffffcc 0%, #ffd700aa 50%, transparent 78%)",animation:"flameC 0.3s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
            </> : null;
            const burstAnim = gateBurst ? "gateBurst 0.5s ease-out" : undefined;
            const slideAnim = isMoved ? (returning ? "horseSlideInReturn 0.32s cubic-bezier(0.25,0.8,0.35,1)" : "horseSlideIn 0.32s cubic-bezier(0.25,0.8,0.35,1)") : undefined;
            const horseEmoji=isWinner?"🏆":<div style={{"--cell-w":`${cellSize}px`,animation:slideAnim,display:"inline-block"}}><LottieHorse coatIndex={lottieCoat} neonColor={h.color} moving={isMoved} flipX={returning} size={Math.round(cellH*0.85)} speed={isJumping?2:isSliding?0.5:1.6} style={{animation:isJumping?"hurdleJump 0.7s ease-in-out":isSliding?"slideBack 0.7s ease-in-out":undefined}}/></div>;
            return (
              <div key={h.id} style={{display:"flex",alignItems:"center",marginBottom:3,opacity:dimmed?0.3:1,background:isActive?`${h.color}0c`:"transparent",borderRadius:6,transition:"all 0.3s"}}>
                <div style={{width:sideLabelW,flexShrink:0,paddingRight:4,display:"flex",flexDirection:"column"}}>
                  <span style={{color:isActive?h.color:"#ffffff44",fontWeight:700,fontSize:labelSize,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",transition:"color 0.2s",textShadow:isActive?`0 0 8px ${h.color}`:""}}>
                    {horseName(race,h.id).split(" ")[0]}
                  </span>
                  {auctionOwners?.[hi] && <span style={{fontSize:subLabelSize,color:"#ffd70099",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>🔨{auctionOwners[hi].username}</span>}
                  <span style={{fontSize:Math.max(8,Math.round(8*cellScale)),color:isJumping?"#39ff14":isSkip?"#ff6b00":returning?"#bf5fff":isActive&&!winner?"#00f5ff33":"transparent"}}>
                    {isJumping?"🌟":isSkip?"🚧":returning?"◀":""}
                  </span>
                </div>
                <div style={{display:"flex",gap:2,alignItems:"center"}}>
                  {(()=>{
                    const isHomeFinish=(race.type==="down_back"||race.type==="magic_dice")&&returning;
                    const horseHere=pos===0;
                    return <div style={{width:cellSize,height:cellH,borderRadius:4,flexShrink:0,background:horseHere?"rgba(255,255,255,0.06)":isHomeFinish?"rgba(255,215,0,0.06)":"rgba(255,255,255,0.02)",border:isHomeFinish?"1px solid #ffd70033":"1px solid #ffffff0a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:emojiSize,marginRight:2}}>
                      {horseHere?<LottieHorse coatIndex={horseLottieCoat(race,hi)} neonColor={h.color} moving={false} size={Math.round(cellSize*0.7)}/>:isHomeFinish?"🏁":""}
                    </div>;
                  })()}
                  {Array.from({length:phase==="tiebreak"?TIEBREAK_SPACES:TRACK_SPACES}).map((_,ci)=>{
                    const hasHorse=pos>0&&vc===ci, passed=!returning&&pos>0&&ci<vc;
                    const isHurdle=race.type==="hurdle"&&ci===HURDLE_CELL;
                    const isFinish=phase==="tiebreak"?ci===TIEBREAK_SPACES-1:(race.type==="down_back"||race.type==="magic_dice")?false:ci===TRACK_SPACES-1;
                    const betGlow = isBet && hasHorse ? `0 0 20px ${h.color}, 0 0 40px ${h.color}88` : hasHorse ? `0 0 14px ${h.color},0 0 28px ${h.color}55` : isHurdle?"0 0 10px #ff6b0066":"none";
                    return <div key={ci} style={{width:cellSize,height:cellH,borderRadius:4,flexShrink:0,position:"relative",background:hasHorse?`${h.color}1e`:passed?"rgba(255,255,255,0.015)":ci%2===0?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.018)",border:hasHorse&&isBet?`2px solid ${h.color}`:hasHorse?`2px solid ${h.color}`:isHurdle?"2px solid #ff6b00":isFinish?"1px solid #ffd70033":"1px solid rgba(255,255,255,0.05)",boxShadow:betGlow,display:"flex",alignItems:"center",justifyContent:"center",fontSize:emojiSize,transition:"box-shadow 0.15s",animation:isHurdle&&!hasHorse?"hurdlePulse 1.2s ease-in-out infinite":isBet&&hasHorse?"betPulse 1.4s ease-in-out infinite":"none","--bet-glow":`0 0 16px ${h.color}, 0 0 32px ${h.color}66`,"--bet-glow-bright":`0 0 28px ${h.color}, 0 0 56px ${h.color}aa`}}>
                      {hasHorse?horseEmoji:isHurdle?"🚧":isFinish?"🏁":""}
                      {hasHorse&&isBet&&<span style={{position:"absolute",top:1,right:2,fontSize:Math.max(7,Math.round(7*cellScale)),opacity:0.55,lineHeight:1}}>💰</span>}
                      {hasHorse&&isMoved&&<>
                        <div style={{position:"absolute",inset:0,overflow:"hidden",borderRadius:4,pointerEvents:"none",zIndex:3}}>
                          <div style={{position:"absolute",top:"30%",left:0,width:"60%",height:1.5,background:`linear-gradient(90deg,transparent,${h.color}cc,transparent)`,animation:"speedLine 0.35s ease-out forwards"}}/>
                          <div style={{position:"absolute",top:"55%",left:0,width:"40%",height:1,background:`linear-gradient(90deg,transparent,${h.color}88,transparent)`,animation:"speedLine2 0.35s ease-out 0.04s forwards"}}/>
                          <div style={{position:"absolute",top:"72%",left:0,width:"50%",height:1,background:`linear-gradient(90deg,transparent,${h.color}66,transparent)`,animation:"speedLine 0.35s ease-out 0.02s forwards"}}/>
                        </div>
                      </>}
                      {hasHorse&&flameLayers}
                    </div>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PORTRAIT: vertical columns, horses race upward ── */}
      {!isLandscape && (()=>{
        const startGateExtra = 18; // start gate is taller to fit name
        const usableH    = vh - 56 - 8 - 44 - startGateExtra; // safe area + start gate overflow
        const pCellH     = Math.max(14, Math.floor((usableH - 4) / (TRACK_SPACES + 1)));
        const pFontSize  = 14;
        return (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative",zIndex:2}}>
            {/* Dice overlay — fixed on top of track, no layout space */}
            <div style={{position:"fixed",top:64,left:0,right:0,display:"flex",justifyContent:"center",zIndex:40,pointerEvents:"none",opacity:overlayVisible?1:0,transition:"opacity 0.3s ease-out"}}>
              {winner!==null?(
                <div style={{background:"rgba(6,6,20,0.92)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${HORSES[winner].color}55`,borderRadius:16,padding:"8px 24px",textAlign:"center",boxShadow:`0 0 28px ${HORSES[winner].color}44`,alignSelf:"center"}}>
                  <div style={{fontFamily:"'Orbitron',monospace",color:HORSES[winner].color,fontSize:15,letterSpacing:3,textShadow:`0 0 14px ${HORSES[winner].color}`}}>🏆 {horseName(race,winner).split(" ")[0].toUpperCase()} WINS!</div>
                </div>
              ):diceResult&&(
                <DiceOverlay diceResult={diceResult} rolling={rolling} raceType={race.type} race={race} mudDie={mudDie} fogDie={fogDie}/>
              )}
            </div>
            {/* Track grid */}
            <div style={{flex:1,display:"flex",padding:"0 12px",gap:3,minHeight:0}}>
              {HORSES.map((h,hi)=>{
                const pos=positions[hi], isWinner=winner===hi;
                const isJumping=jumpingHorses.includes(hi), isSliding=slidingHorses.includes(hi);
                const isBet=betOnHorses.has(hi)&&winner===null;
                const returning=(race.type==="down_back"||race.type==="magic_dice")&&legDone[hi];
                const isActive=activeHorses.includes(hi);
                const inTie=tieHorses?.includes(hi), dimmed=tieHorses&&!inTie;
                const coat=horseCoat(race,hi);
                const vc=visualCell(hi);
                const isHot=onFire[hi];
                const isMoved=movedHorses.includes(hi);
                const flameLayers = isHot ? <>
                  <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-23*cellScale),width:Math.round(46*cellScale),height:Math.round(58*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ff4500dd 0%, #ff6b00aa 40%, transparent 72%)",animation:"flameA 0.45s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
                  <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-15*cellScale),width:Math.round(30*cellScale),height:Math.round(46*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ffd700cc 0%, #ff450099 45%, transparent 72%)",animation:"flameB 0.38s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
                  <div style={{position:"absolute",bottom:2,left:"50%",marginLeft:Math.round(-8*cellScale),width:Math.round(16*cellScale),height:Math.round(32*cellScale),borderRadius:"50% 50% 25% 25% / 60% 60% 40% 40%",transformOrigin:"bottom center",background:"radial-gradient(ellipse at 50% 85%, #ffffffcc 0%, #ffd700aa 50%, transparent 78%)",animation:"flameC 0.3s ease-in-out infinite",pointerEvents:"none",zIndex:1}}/>
                </> : null;
                const burstAnim = gateBurst ? "gateBurstPortrait 0.5s ease-out" : undefined;
                const lottieCoat2=horseLottieCoat(race,hi);
const slideAnimP = isMoved ? (returning ? "horseSlideInReturn 0.32s cubic-bezier(0.25,0.8,0.35,1)" : "horseSlideIn 0.32s cubic-bezier(0.25,0.8,0.35,1)") : undefined;
const horseEmoji=isWinner?"🏆":<div style={{"--cell-w":`${pCellH}px`,animation:slideAnimP,display:"inline-block"}}><LottieHorse coatIndex={lottieCoat2} neonColor={h.color} moving={isMoved} flipX={returning} size={Math.round(pCellH*0.85)} speed={isJumping?2:isSliding?0.5:1.6} style={{animation:isJumping?"hurdleJump 0.7s ease-in-out":isSliding?"slideBack 0.7s ease-in-out":undefined}}/></div>;
                const isDownBackType=(race.type==="down_back"||race.type==="magic_dice");
                const atFinish=phase==="tiebreak"?pos>=TIEBREAK_SPACES:isDownBackType?returning&&pos<=0:pos>=TRACK_SPACES;
                const atTurnaround=phase!=="tiebreak"&&isDownBackType&&pos>=TRACK_SPACES;
                return (
                  <div key={h.id} style={{flex:1,display:"flex",flexDirection:"column",opacity:dimmed?0.3:1,gap:2,background:isActive?`${h.color}08`:"transparent",borderRadius:6,padding:"2px",transition:"background 0.3s"}}>
                    {/* Top cell — turnaround marker for down_back, finish line for standard */}
                    <div style={{height:pCellH,borderRadius:4,flexShrink:0,background:atTurnaround?`${h.color}1e`:"rgba(255,255,255,0.02)",border:atTurnaround?`2px solid ${h.color}`:isDownBackType?"1px solid rgba(255,255,255,0.04)":"1px solid rgba(255,215,0,0.18)",boxShadow:atTurnaround?`0 0 12px ${h.color}`:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:pFontSize}}>
                      {atTurnaround?horseEmoji:isDownBackType?"🔄":"🏁"}
                    </div>
                    {/* Track cells top→bottom (ri=10 at top, ri=0 at bottom) — 11 cells to match landscape */}
                    {Array.from({length:phase==="tiebreak"?TIEBREAK_SPACES:(TRACK_SPACES-1)}).map((_,ci)=>{
                      const ri=(phase==="tiebreak"?TIEBREAK_SPACES:(TRACK_SPACES-1))-1-ci;
                      const hasHorse=pos>0&&vc===ri;
                      const passed=returning?(ri>vc&&pos>0):(pos>0&&ri<vc);
                      const isHurdle=race.type==="hurdle"&&ri===HURDLE_CELL;
                      return (
                        <div key={ri} style={{height:pCellH,borderRadius:4,flexShrink:0,position:"relative",overflow:"visible",background:hasHorse?`${h.color}1e`:passed?"rgba(255,255,255,0.01)":ri%2===0?"rgba(255,255,255,0.036)":"rgba(255,255,255,0.018)",border:hasHorse?`2px solid ${h.color}`:isHurdle?"2px solid #ff6b00":"1px solid rgba(255,255,255,0.04)",boxShadow:isBet&&hasHorse?`0 0 20px ${h.color},0 0 40px ${h.color}88`:hasHorse?`0 0 12px ${h.color},0 0 24px ${h.color}55`:isHurdle?"0 0 8px #ff6b0066":"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:pFontSize,transition:"box-shadow 0.15s",animation:isHurdle&&!hasHorse?"hurdlePulse 1.2s ease-in-out infinite":isBet&&hasHorse?"betPulse 1.4s ease-in-out infinite":"none","--bet-glow":`0 0 16px ${h.color},0 0 32px ${h.color}66`,"--bet-glow-bright":`0 0 28px ${h.color},0 0 56px ${h.color}aa`}}>
                          {hasHorse?horseEmoji:isHurdle?"🚧":""}
                          {hasHorse&&isBet&&<span style={{position:"absolute",top:0,right:1,fontSize:6,opacity:0.5,lineHeight:1}}>💰</span>}
                          {hasHorse&&isMoved&&<>
                            <div style={{position:"absolute",inset:0,overflow:"hidden",borderRadius:4,pointerEvents:"none",zIndex:3}}>
                              <div style={{position:"absolute",left:"25%",bottom:0,height:"70%",width:1.5,background:`linear-gradient(0deg,transparent,${h.color}cc,transparent)`,animation:"speedLineUp 0.35s ease-out forwards"}}/>
                              <div style={{position:"absolute",left:"55%",bottom:0,height:"50%",width:1,background:`linear-gradient(0deg,transparent,${h.color}88,transparent)`,animation:"speedLineUp2 0.35s ease-out 0.04s forwards"}}/>
                              <div style={{position:"absolute",left:"75%",bottom:0,height:"60%",width:1,background:`linear-gradient(0deg,transparent,${h.color}66,transparent)`,animation:"speedLineUp 0.35s ease-out 0.02s forwards"}}/>
                            </div>
                          </>}
                          {hasHorse&&flameLayers}
                        </div>
                      );
                    })}
                    {/* Start gate / Finish line — bottom */}
                    {(() => {
                      const isFinishHere = isDownBackType && returning;
                      const horseAtBottom = pos===0 || atFinish;
                      const bg = horseAtBottom ? `${h.color}1e` : isFinishHere ? "rgba(255,215,0,0.04)" : "rgba(255,255,255,0.02)";
                      const border = horseAtBottom ? `2px solid ${h.color}` : isFinishHere ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.06)";
                      const shadow = horseAtBottom ? `0 0 12px ${h.color}` : "none";
                      return (
                        <div style={{height:pCellH+18,borderRadius:4,flexShrink:0,background:bg,border,boxShadow:shadow,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,padding:"2px 1px"}}>
                          <div style={{fontSize:pFontSize,lineHeight:1}}>
                            {horseAtBottom ? horseEmoji : isFinishHere ? "🏁" : ""}
                          </div>
                          <div style={{width:7,height:7,borderRadius:"50%",background:h.color,flexShrink:0,boxShadow:`0 0 5px ${h.color}`}}/>
                          <div style={{fontSize:7,fontWeight:700,color:activeHorses.includes(hi)?h.color:"#ffffff55",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",textAlign:"center",lineHeight:1,padding:"0 2px"}}>
                            {horseNameLoading(race,hi)?<span style={{display:"inline-block",width:24,height:6,borderRadius:3,background:"linear-gradient(90deg,#ffffff0a 25%,#ffffff22 50%,#ffffff0a 75%)",backgroundSize:"200px 100%",animation:"nameShimmer 1.2s ease-in-out infinite"}}/>:horseName(race,hi).split(" ")[0]}
                            {auctionOwners?.[hi]&&<span style={{display:"block",fontSize:6,color:"#ffd70088"}}>🔨{auctionOwners[hi].username}</span>}
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                );
              })}
            </div>

          </div>
        );
      })()}

      {/* DICE OVERLAY — landscape only */}
      {isLandscape && (
        <div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:40,pointerEvents:"none",opacity:overlayVisible?1:0,transition:"opacity 0.3s ease-out"}}>
          {winner!==null?(
            <div style={{background:"rgba(6,6,20,0.92)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${HORSES[winner].color}55`,borderRadius:16,padding:"10px 28px",textAlign:"center",boxShadow:`0 0 32px ${HORSES[winner].color}44`}}>
              <div style={{fontFamily:"'Orbitron',monospace",color:HORSES[winner].color,fontSize:16,letterSpacing:3,textShadow:`0 0 16px ${HORSES[winner].color}`}}>
                🏆 {horseName(race,winner).toUpperCase()} WINS!
              </div>
            </div>
          ):diceResult&&(
            <DiceOverlay diceResult={diceResult} rolling={rolling} raceType={race.type} race={race} mudDie={mudDie} fogDie={fogDie}/>
          )}
        </div>
      )}

      {/* Chat */}
      {winner===null && <RaceChat raceId={race.id} user={user} msgs={chatMsgs} setMsgs={setChatMsgs} open={chatOpen} setOpen={setChatOpen} unread={chatUnread} setUnread={setChatUnread}/>}


    </div>
  );
}


// ─── PRIVATE RACE PAYOUT SCREEN ──────────────────────────────────────────────
function PrivatePayoutScreen({ race, winner, user, onLobby }) {
  const pr = getPrivateRaces()[race?._privateCode];
  if(!pr) return <div style={{color:"#fff",padding:40,textAlign:"center"}}>Race data not found.<br/><button onClick={onLobby} style={{marginTop:20,padding:"10px 20px",background:"#00f5ff",border:"none",borderRadius:8,cursor:"pointer",fontFamily:"'Orbitron',monospace",fontWeight:700}}>LOBBY</button></div>;

  const rt       = RACE_TYPES[pr.raceType]||RACE_TYPES.standard;
  const winnerH  = HORSES[winner];
  const wName    = pr.horses?.[winner]||winnerH.name;
  const results  = pr.memberResults||{};
  const members  = Object.entries(results).sort((a,b)=>(b[1].payout||0)-(a[1].payout||0));
  const totalPool= Object.values(results).reduce((s,m)=>s+(m.pot||0),0);
  const myResult = results[user?.username]||{};

  return (
    <div style={{minHeight:"100vh",background:"#08081a",display:"flex",flexDirection:"column",alignItems:"center",padding:"72px 16px 60px",overflowY:"auto"}}>
      <Confetti/>
      {/* Race label */}
      <div style={{color:"#ffffff33",fontSize:11,letterSpacing:3,marginBottom:8}}>{rt.icon} {pr.name.toUpperCase()} · PRIVATE RACE</div>

      {/* Winner banner */}
      <div style={{textAlign:"center",marginBottom:28,padding:"24px 40px",borderRadius:18,background:`${winnerH.color}0c`,border:`2px solid ${winnerH.color}55`,boxShadow:`0 0 60px ${winnerH.color}33`,width:"100%",maxWidth:480}}>
        <div style={{fontSize:52,marginBottom:6}}>🏆</div>
        <div style={{fontFamily:"'Orbitron',monospace",color:winnerH.color,fontSize:26,letterSpacing:3,textShadow:`0 0 24px ${winnerH.color}`}}>{wName}</div>
        <div style={{color:"#ffffff33",letterSpacing:3,marginTop:4,fontSize:11}}>WINS THE RACE</div>
        <div style={{marginTop:10,color:"#ffffff44",fontSize:12}}>Total pool: <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace"}}>${fmt2(totalPool)}</span></div>
      </div>

      {/* My result */}
      <div style={{width:"100%",maxWidth:480,marginBottom:20,padding:"18px",borderRadius:14,textAlign:"center",
        background:myResult.payout>0?"rgba(57,255,20,0.07)":"rgba(255,45,85,0.07)",
        border:`1px solid ${myResult.payout>0?"#39ff1433":"#ff2d5533"}`}}>
        {myResult.payout>0?(
          <>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:22,textShadow:"0 0 20px #39ff14"}}>YOU WON!</div>
            <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:28,marginTop:6}}>+${fmt2(myResult.payout)}</div>
            <div style={{color:"#ffffff44",marginTop:4,fontSize:13}}>from ${fmt2(myResult.pot||0)} wagered</div>
          </>
        ):(
          <>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#ff2d55",fontSize:18}}>{Object.keys(myResult.bets||{}).length===0?"NO BETS PLACED":"BETTER LUCK NEXT RACE"}</div>
            {myResult.pot>0&&<div style={{color:"#ffffff33",marginTop:6,fontSize:13}}>${fmt2(myResult.pot)} wagered · no return</div>}
          </>
        )}
      </div>

      {/* Full member breakdown */}
      <div style={{width:"100%",maxWidth:480,marginBottom:24}}>
        <div style={{color:"#ffffff33",fontSize:10,letterSpacing:2,marginBottom:10}}>ALL PLAYERS</div>
        {members.map(([uname,mdata],i)=>{
          const isMe = uname===user?.username;
          const prof = getProfile(uname);
          const won  = mdata.payout>0;
          return (
            <div key={uname} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:6,
              background: isMe?"rgba(0,245,255,0.06)":won?"rgba(57,255,20,0.04)":"rgba(255,255,255,0.02)",
              border:`1px solid ${isMe?"#00f5ff33":won?"#39ff1422":"#ffffff0d"}`,borderRadius:11}}>
              <div style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid #ffffff18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{prof.avatar||"🏇"}</div>
              <div style={{flex:1}}>
                <div style={{color:isMe?"#00f5ff":"#fff",fontWeight:700,fontSize:13}}>{uname}{isMe?" (you)":""}{uname===pr.hostUsername?" ★":""}</div>
                <div style={{color:"#ffffff44",fontSize:11,marginTop:1}}>
                  Wagered: <span style={{color:"#ffd700"}}>${fmt2(mdata.pot||0)}</span>
                  {Object.entries(mdata.bets||{}).length>0&&(
                    <span> · Backed: {Object.entries(mdata.bets||{}).map(([hid])=>pr.horses?.[parseInt(hid)]||HORSES[parseInt(hid)].name).join(", ")}</span>
                  )}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {won?(
                  <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:15,fontWeight:700}}>+${fmt2(mdata.payout)}</div>
                ):(
                  <div style={{color:"#ff2d5566",fontSize:13}}>—</div>
                )}
                <div style={{color:"#ffffff22",fontSize:10,marginTop:1}}>#{i+1}</div>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={onLobby} style={{padding:"14px 40px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#00f5ff,#0080ff)",color:"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:14,letterSpacing:3,boxShadow:"0 0 24px #00f5ff44"}}>
        BACK TO LOBBY
      </button>
    </div>
  );
}

// ─── CONFETTI PIECES (winner screen) ─────────────────────────────────────────
function ConfettiPieces({ color }) {
  const colors = [color,'#ffd700','#ff2d55','#00f5ff','#39ff14','#bf5fff','#ff6b00','#ffffff'];
  const pieces = useMemo(()=>Array.from({length:70},(_,i)=>({
    id:i,
    col: colors[i % colors.length],
    left: 15 + Math.random()*70,
    isLong: Math.random()>0.5,
    dur: 1.2 + Math.random()*1.4,
    delay: 2.6 + Math.random()*0.9,
    dx: -80 + Math.random()*160,
    rot: Math.random()*45,
  })),[]);
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:0}}>
      {pieces.map(p=>(
        <div key={p.id} style={{
          position:"absolute", top:-10, left:`${p.left}%`,
          width: p.isLong?3:7, height: p.isLong?14:7,
          background: p.col, borderRadius: p.isLong?2:"50%",
          transform:`rotate(${p.rot}deg)`,
          ["--dx"]: `${p.dx}px`,
          animation:`pw_confetti ${p.dur}s ease-in ${p.delay}s both`,
        }}/>
      ))}
    </div>
  );
}

// ─── PAYOUT SCREEN ────────────────────────────────────────────────────────────
function PayoutScreen({ race, bets, totalPot, odds, winner, userBalance, onPlayAgain, onLobby }) {
  const horse=HORSES[winner], rt=RACE_TYPES[race.type];
  const wName = horseName(race, winner);
  const coat  = horseCoat(race, winner);
  const userBetAmt=bets[winner]||0;
  const payout=userBetAmt>0&&odds[winner]?userBetAmt*odds[winner]:0;

  // ── Cinematic winner CSS ─────────────────────────────────────────────────────
  const winCSS = `
    @keyframes pw_gallopIn {
      0%   { transform: scaleX(-1) translateX(700px); }
      65%  { transform: scaleX(-1) translateX(-22px); }
      82%  { transform: scaleX(-1) translateX(10px); }
      100% { transform: scaleX(-1) translateX(0); }
    }
    @keyframes pw_bounce {
      0%,100% { transform: scaleX(-1) translateY(0); }
      50%     { transform: scaleX(-1) translateY(-9px); }
    }
    @keyframes pw_glow {
      0%,100% { filter: ${coat} drop-shadow(0 0 10px ${horse.color}88); }
      50%     { filter: ${coat} drop-shadow(0 0 32px ${horse.color}) drop-shadow(0 0 60px ${horse.color}66); }
    }
    @keyframes pw_crownDrop {
      0%   { transform: translateX(-50%) translateY(-90px); opacity:0; }
      100% { transform: translateX(-50%) translateY(-8px);  opacity:1; }
    }
    @keyframes pw_crownGlow {
      0%,100% { filter: drop-shadow(0 0 14px #ffd700) drop-shadow(0 0 36px #ffd70077); }
      50%     { filter: drop-shadow(0 0 28px #ffd700) drop-shadow(0 0 60px #ffd700aa); }
    }
    @keyframes pw_sash {
      0%   { opacity:1; clip-path: inset(0 100% 0 0); }
      100% { opacity:1; clip-path: inset(0 0% 0 0); }
    }
    @keyframes pw_ringBurst {
      0%   { transform: translate(-50%,-50%) scale(0.2); opacity:0.9; }
      100% { transform: translate(-50%,-50%) scale(4);   opacity:0; }
    }
    @keyframes pw_starBurst {
      0%   { opacity:1; transform: translate(-50%,-50%) rotate(var(--a)) translateY(0); }
      60%  { opacity:1; transform: translate(-50%,-50%) rotate(var(--a)) translateY(var(--d)); }
      100% { opacity:0; transform: translate(-50%,-50%) rotate(var(--a)) translateY(calc(var(--d) * 1.4)); }
    }
    @keyframes pw_dust {
      0%   { opacity:0.7; transform: scale(0.4); }
      100% { opacity:0;   transform: scale(2.4) translateX(28px); }
    }
    @keyframes pw_nameReveal {
      0%   { opacity:0; transform: scale(0.82) translateY(10px); letter-spacing:10px; }
      100% { opacity:1; transform: scale(1)    translateY(0);    letter-spacing:3px; }
    }
    @keyframes pw_fadeUp {
      from { opacity:0; transform: translateY(10px); }
      to   { opacity:1; transform: translateY(0); }
    }
    @keyframes pw_spot {
      0%,100% { opacity:0.5; } 50% { opacity:1; }
    }
    @keyframes pw_confetti {
      0%   { opacity:1; transform: translateY(0)    rotate(0deg)   translateX(0); }
      50%  { opacity:1; transform: translateY(42vh) rotate(420deg) translateX(var(--dx)); }
      100% { opacity:0; transform: translateY(100vh) rotate(840deg) translateX(calc(var(--dx)*1.6)); }
    }
  `;

  return (
    <div style={{minHeight:"100vh",background:"#08081a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px 40px",overflowY:"auto",position:"relative",overflow:"hidden"}}>
      <style>{winCSS}</style>

      {/* Spotlight */}
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:480,height:"100vh",background:`radial-gradient(ellipse 55% 100% at 50% 0%, ${horse.color}18 0%, transparent 65%)`,pointerEvents:"none",animation:"pw_spot 2s ease-in-out infinite"}}/>

      {/* Confetti */}
      <ConfettiPieces color={horse.color}/>

      <div style={{color:"#ffffff33",fontSize:11,letterSpacing:3,marginBottom:16,animation:"pw_fadeUp 0.5s ease-out 0.1s both"}}>{rt.icon} {race.name.toUpperCase()}</div>

      {/* ── Horse cinematic ── */}
      <div style={{position:"relative",marginBottom:0,height:130,width:260,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>

        {/* Burst rings on skid stop */}
        {[horse.color,"#ff8c00","#ffffff44"].map((col,i)=>(
          <div key={i} style={{position:"absolute",top:"50%",left:"50%",width:90,height:90,border:`2px solid ${col}`,borderRadius:"50%",animation:`pw_ringBurst 0.65s ease-out ${0.74+i*0.1}s both`}}/>
        ))}

        {/* Star burst */}
        {["⭐","✨","⭐","✨","⭐","✨","⭐"].map((s,i)=>(
          <div key={i} style={{position:"absolute",top:"50%",left:"50%",fontSize:18,opacity:0,
            ["--a"]: `${i*51}deg`, ["--d"]: `-${82+i%2*14}px`,
            animation:`pw_starBurst 0.75s ease-out ${1.65+i*0.04}s both`}}>{s}</div>
        ))}

        {/* Crown */}
        <div style={{position:"absolute",top:0,left:"50%",fontSize:48,opacity:0,
          animation:`pw_crownDrop 0.5s cubic-bezier(0.34,1.56,0.64,1) 1.6s forwards, pw_crownGlow 1.2s ease-in-out 2.1s infinite`,
          filter:"drop-shadow(0 0 16px #ffd700) drop-shadow(0 0 40px #ffd70077)",zIndex:10}}>👑</div>

        {/* Sash */}
        <div style={{position:"absolute",top:"44%",left:"50%",transform:"translateX(-50%) rotate(-15deg)",
          background:"linear-gradient(135deg,#ffd700,#ff8c00,#ffd700)",
          color:"#08081a",fontSize:12,fontWeight:900,letterSpacing:3,padding:"5px 24px",
          whiteSpace:"nowrap",opacity:0,clipPath:"inset(0 100% 0 0)",
          animation:"pw_sash 0.45s ease-out 2.1s forwards",
          boxShadow:"0 2px 20px #ffd70066",borderTop:"1px solid rgba(255,255,255,0.4)",zIndex:5}}>
          🏆 &nbsp;WINNER&nbsp; 🏆
        </div>

        {/* Horse */}
        <div style={{fontSize:100,lineHeight:1,
          filter:coat,
          animation:`pw_gallopIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s forwards, pw_bounce 0.22s ease-in-out 0.82s 4, pw_glow 1.5s ease-in-out 2.0s infinite`}}>🐴</div>

        {/* Dust puff */}
        <div style={{position:"absolute",right:10,bottom:0,fontSize:36,opacity:0,
          animation:"pw_dust 0.65s ease-out 0.76s forwards"}}>💨</div>
      </div>

      {/* Winner name */}
      <div style={{color:"#ffffff33",fontSize:10,letterSpacing:5,marginTop:20,opacity:0,animation:"pw_fadeUp 0.5s ease-out 2.5s forwards"}}>RACE WINNER</div>
      <div style={{fontFamily:"'Orbitron',monospace",fontSize:26,fontWeight:900,letterSpacing:3,
        color:horse.color,textShadow:`0 0 30px ${horse.color}, 0 0 60px ${horse.color}66`,
        textAlign:"center",opacity:0,animation:"pw_nameReveal 0.6s cubic-bezier(0.22,1,0.36,1) 2.7s forwards",marginTop:6}}>{wName}</div>
      <div style={{color:"#ffffff33",letterSpacing:5,fontSize:10,marginTop:8,opacity:0,animation:"pw_fadeUp 0.4s ease-out 3.0s forwards"}}>WINS THE RACE</div>
      <div style={{width:"100%",maxWidth:440,marginTop:20,marginBottom:20,padding:"18px",borderRadius:14,textAlign:"center",background:payout>0?"rgba(57,255,20,0.07)":"rgba(255,45,85,0.07)",border:`1px solid ${payout>0?"#39ff1433":"#ff2d5533"}`,opacity:0,animation:"pw_fadeUp 0.5s ease-out 3.2s forwards"}}>
        {payout>0?(
          <>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#39ff14",fontSize:24,textShadow:"0 0 20px #39ff14"}}>YOU WON!</div>
            <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:22,marginTop:6}}>+${fmt2(payout)}</div>
            <div style={{color:"#ffffff44",marginTop:4,fontSize:13}}>at {(odds[winner]||1).toFixed(2)}x · bet ${userBetAmt}</div>
          </>
        ):(
          <>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#ff2d55",fontSize:20}}>BETTER LUCK NEXT RACE</div>
            <div style={{color:"#ffffff33",marginTop:6,fontSize:13}}>{Object.keys(bets).length===0?"No bets placed.":"Your horses didn't finish first."}</div>
          </>
        )}
      </div>
      <div style={{color:"#ffffff44",marginBottom:6,fontSize:13,opacity:0,animation:"pw_fadeUp 0.4s ease-out 3.4s forwards"}}>Balance: <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace"}}>${fmt2(userBalance)}</span></div>
      <div style={{width:"100%",maxWidth:440,marginBottom:24}}>
        <div style={{color:"#ffffff22",fontSize:11,letterSpacing:2,marginBottom:8,textAlign:"center"}}>FINAL ODDS</div>
        {HORSES.map(h=>(
          <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",marginBottom:4,borderRadius:9,background:"rgba(255,255,255,0.03)",border:`1px solid ${h.id===winner?h.color+"44":"rgba(255,255,255,0.06)"}`}}>
            <div style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:`${h.color}15`,border:`1.5px solid ${h.color}`,flexShrink:0}}><span style={{filter:horseCoat(race,h.id)}}>🐴</span></div>
            <HorseName race={race} horseId={h.id} style={{flex:1,color:h.id===winner?h.color:"#ffffff66",fontWeight:700,fontSize:13}}/>
            {h.id===winner&&<span style={{color:"#ffd700",fontSize:10,letterSpacing:1}}>WINNER</span>}
            <span style={{color:"#00f5ff",fontFamily:"'Orbitron',monospace",fontSize:12}}>{odds[h.id]?`${odds[h.id].toFixed(2)}x`:"—"}</span>
            {bets[h.id]>0&&<span style={{color:"#ffd70055",fontSize:11}}>${bets[h.id]}</span>}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",opacity:0,animation:"pw_fadeUp 0.4s ease-out 3.5s forwards"}}>
        <button onClick={onLobby} style={{padding:"13px 40px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#00f5ff,#39ff14)",color:"#08081a",fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,letterSpacing:2,boxShadow:"0 0 28px #00f5ff66"}}>🏠 BACK TO LOBBY</button>
      </div>
    </div>
  );
}



// ─── PROVABLY FAIR ────────────────────────────────────────────────────────────
function ProvablyFairBadge({ race, expanded=false }) {
  const [open, setOpen] = useState(expanded);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyResult, setVerifyResult] = useState(null); // null | true | false

  const seedHash     = race?.seedHash;
  const revealedSeed = race?.revealedSeed;
  const isRevealed   = !!revealedSeed;

  // SHA-256 in browser
  const sha256 = async (str) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
  };

  const verify = async () => {
    const seed = verifyInput.trim() || revealedSeed;
    if(!seed || !seedHash) return;
    const hash = await sha256(seed);
    setVerifyResult(hash === seedHash);
  };

  if(!seedHash) return null;

  return (
    <div style={{margin:"12px 0",borderRadius:10,border:"1px solid rgba(0,245,255,0.2)",background:"rgba(0,245,255,0.04)",overflow:"hidden"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"none",border:"none",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:14}}>🔐</span>
          <span style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:10,letterSpacing:2,fontWeight:700}}>PROVABLY FAIR</span>
          {isRevealed && <span style={{background:"rgba(57,255,20,0.15)",border:"1px solid #39ff1433",borderRadius:10,padding:"1px 7px",color:"#39ff14",fontSize:9,fontWeight:700,letterSpacing:1}}>REVEALED</span>}
        </div>
        <span style={{color:"#00f5ff66",fontSize:11}}>{open?"▲":"▼"}</span>
      </button>

      {open && (
        <div style={{padding:"0 14px 14px"}}>
          <div style={{color:"#ffffff55",fontSize:11,lineHeight:1.6,marginBottom:10}}>
            The outcome of this race was locked in before betting opened. The seed hash below was published before any bets were placed — proving the result was never changed.
          </div>

          {/* Seed Hash — always visible */}
          <div style={{marginBottom:10}}>
            <div style={{color:"#ffffff33",fontSize:9,letterSpacing:2,marginBottom:4}}>SEED HASH (SHA-256) — published before betting</div>
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:6,padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#00f5ff",wordBreak:"break-all",letterSpacing:0.5}}>
              {seedHash}
            </div>
          </div>

          {/* Revealed Seed — only after race */}
          {isRevealed ? (
            <div style={{marginBottom:12}}>
              <div style={{color:"#ffffff33",fontSize:9,letterSpacing:2,marginBottom:4}}>REVEALED SEED — published after race finished</div>
              <div style={{background:"rgba(0,0,0,0.3)",borderRadius:6,padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#39ff14",wordBreak:"break-all",letterSpacing:0.5}}>
                {revealedSeed}
              </div>
            </div>
          ) : (
            <div style={{marginBottom:12,padding:"8px 10px",background:"rgba(255,215,0,0.05)",border:"1px solid #ffd70022",borderRadius:6}}>
              <span style={{color:"#ffd70077",fontSize:11}}>🔒 Seed will be revealed after the race finishes</span>
            </div>
          )}

          {/* Verify section */}
          {isRevealed && (
            <div>
              <div style={{color:"#ffffff33",fontSize:9,letterSpacing:2,marginBottom:6}}>VERIFY — SHA-256(seed) should equal the hash above</div>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <input
                  value={verifyInput||revealedSeed}
                  onChange={e=>{setVerifyInput(e.target.value);setVerifyResult(null);}}
                  placeholder="Paste seed to verify..."
                  style={{flex:1,padding:"6px 10px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,color:"#fff",fontSize:11,fontFamily:"monospace",outline:"none"}}
                />
                <button onClick={verify} style={{padding:"6px 14px",background:"rgba(0,245,255,0.1)",border:"1px solid #00f5ff33",borderRadius:6,color:"#00f5ff",cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
                  Verify ✓
                </button>
              </div>
              {verifyResult === true  && <div style={{color:"#39ff14",fontSize:12,fontWeight:700}}>✓ Verified — this race was provably fair</div>}
              {verifyResult === false && <div style={{color:"#ff2d55",fontSize:12,fontWeight:700}}>✗ Hash mismatch — seed does not match</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── RACE REPLAY SCREEN ───────────────────────────────────────────────────────
function RaceReplayScreen({ race, onClose }) {
  const [rolls,    setRolls]    = useState(null);
  const [winner,   setWinner]   = useState(null);
  const [speed,    setSpeed]    = useState(1);
  const [finished, setFinished] = useState(false);
  const speedRef = useRef(1);

  useEffect(()=>{
    fbGetRaceRolls().then(allRolls => {
      const rd = allRolls[race.id];
      if(rd){ setRolls(rd.rolls); setWinner(rd.winner); }
      else {
        const { winner:w, rolls:r } = simulateRaceWithHistory(race.type, race.condition||"sunny", race.seed);
        setRolls(r); setWinner(w);
      }
    });
  },[race.id]);

  const toggleSpeed = () => {
    const s = speed===1?2:1;
    setSpeed(s); speedRef.current=s;
  };

  const rt = RACE_TYPES[race.type]||RACE_TYPES.standard;

  return (
    <div style={{position:"fixed",inset:0,zIndex:600,background:"#08081a",display:"flex",flexDirection:"column"}}>
      {/* Replay header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",background:"rgba(8,8,26,0.98)",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <span style={{fontSize:18}}>{rt.icon}</span>
          <div style={{minWidth:0}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>{race.name}</div>
            <div style={{color:"#bf5fff",fontSize:9,letterSpacing:2,fontFamily:"'Orbitron',monospace"}}>📼 REPLAY</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          {!finished && rolls && (
            <button onClick={toggleSpeed} style={{padding:"5px 12px",background:speed===2?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.07)",border:`1px solid ${speed===2?"#ffd70044":"rgba(255,255,255,0.12)"}`,borderRadius:8,color:speed===2?"#ffd700":"#ffffff88",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Orbitron',monospace",letterSpacing:1}}>
              {speed===1?"1×":"2× ⚡"}
            </button>
          )}
          {finished && <span style={{color:"#39ff14",fontFamily:"'Orbitron',monospace",fontSize:10,letterSpacing:2}}>✓ FINISHED</span>}
          {!rolls && <span style={{color:"#ffffff33",fontSize:12}}>Loading...</span>}
          <button onClick={onClose} style={{width:32,height:32,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#ffffff66",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>

      {/* Embed RaceScreen in replay mode */}
      {rolls && (
        <div style={{flex:1,overflow:"hidden",marginTop:0}}>
          <RaceScreen
            race={{...race, startTime: Date.now() + 1200, nowMs: Date.now()}}
            bets={{}} totalPot={0}
            onRaceEnd={()=>setFinished(true)}
            user={null} chatMsgs={[]} setChatMsgs={()=>{}} chatOpen={false}
            setChatOpen={()=>{}} chatUnread={0} setChatUnread={()=>{}}
            auctionOwners={null}
            replayRolls={rolls} replayWinner={winner} replaySpeed={speed} replaySpeedRef={speedRef}
            isReplay={true}
          />
        </div>
      )}
    </div>
  );
}

// ─── HOW IT WORKS PANEL ───────────────────────────────────────────────────────
function HowItWorksPanel({ onClose }) {
  const [tab, setTab] = useState("basics");

  const TABS = [
    { id:"basics",    icon:"🏇", label:"The Basics"  },
    { id:"racetypes", icon:"🎲", label:"Race Types"  },
    { id:"weather",   icon:"🌦", label:"Weather"     },
    { id:"auctions",  icon:"🔨", label:"Auctions"    },
    { id:"bank",      icon:"🏦", label:"Bank"        },
  ];

  const Section = ({icon, title, children}) => (
    <div style={{marginBottom:24,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{fontSize:22}}>{icon}</span>
        <span style={{fontFamily:"'Orbitron',monospace",color:"#fff",fontSize:14,letterSpacing:2,fontWeight:700}}>{title}</span>
      </div>
      {children}
    </div>
  );

  const Row = ({label, value, color="#ffffffbb"}) => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <span style={{color:"#ffffff55",fontSize:13,flex:1}}>{label}</span>
      <span style={{color,fontSize:13,fontWeight:600,textAlign:"right",maxWidth:"55%"}}>{value}</span>
    </div>
  );

  const Tag = ({color, label}) => (
    <span style={{display:"inline-block",background:`${color}22`,border:`1px solid ${color}55`,borderRadius:20,padding:"2px 10px",color,fontSize:11,fontWeight:700,letterSpacing:1,marginRight:6,marginBottom:6}}>{label}</span>
  );

  const OddsExample = () => {
    const [bets, setBets] = useState({0:100, 1:50, 2:200});
    const total = Object.values(bets).reduce((s,v)=>s+v,0);
    const horses = [{id:0,name:"War Horse Emoji",color:"#ff6b6b"},{id:1,name:"Velvet Underground",color:"#a78bfa"},{id:2,name:"Double Bogey",color:"#34d399"}];
    return (
      <div style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"12px 14px",marginTop:10}}>
        <div style={{color:"#ffffff44",fontSize:10,letterSpacing:2,marginBottom:8}}>LIVE EXAMPLE — adjust bets to see odds change</div>
        {horses.map(h => {
          const myBet = bets[h.id]||0;
          const odds = myBet > 0 ? (total/myBet).toFixed(2) : "—";
          return (
            <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <span style={{color:h.color,fontSize:12,fontWeight:700,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{color:"#ffffff44",fontSize:11}}>$</span>
                <input type="number" min="0" value={myBet}
                  onChange={e=>setBets(b=>({...b,[h.id]:Math.max(0,parseInt(e.target.value)||0)}))}
                  style={{width:60,padding:"3px 6px",background:"rgba(255,255,255,0.07)",border:`1px solid ${h.color}44`,borderRadius:6,color:"#fff",fontSize:13,outline:"none",textAlign:"right"}}/>
              </div>
              <span style={{fontFamily:"'Orbitron',monospace",color:myBet>0?"#ffd700":"#ffffff22",fontSize:14,fontWeight:900,minWidth:48,textAlign:"right"}}>{myBet>0?`${odds}x`:"—"}</span>
            </div>
          );
        })}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",marginTop:8,paddingTop:8,display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#ffffff44",fontSize:12}}>Total pot</span>
          <span style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:14,fontWeight:900}}>${total}</span>
        </div>
        <div style={{color:"#ffffff33",fontSize:11,marginTop:8}}>If you bet $100 on War Horse and win → ${(total/(bets[0]||1)).toFixed(2)} × $100 = <span style={{color:"#39ff14",fontWeight:700}}>${((total/(bets[0]||1))*100).toFixed(2)}</span></div>
      </div>
    );
  };

  const RaceTypeCard = ({icon, name, color, tag, desc, mechanics}) => (
    <div style={{marginBottom:14,background:`${color}08`,border:`1px solid ${color}22`,borderRadius:12,padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{fontSize:24}}>{icon}</span>
        <div>
          <div style={{color,fontFamily:"'Orbitron',monospace",fontSize:13,fontWeight:700,letterSpacing:1}}>{name}</div>
          <div style={{color:`${color}88`,fontSize:11,marginTop:1}}>{tag}</div>
        </div>
      </div>
      <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.5,marginBottom:8}}>{desc}</div>
      <div style={{color:"#ffffff55",fontSize:12,lineHeight:1.6,fontStyle:"italic"}}>{mechanics}</div>
    </div>
  );

  const WeatherCard = ({icon, name, color, effect, tip}) => (
    <div style={{marginBottom:12,display:"flex",gap:12,background:`${color}08`,border:`1px solid ${color}22`,borderRadius:12,padding:"12px 14px"}}>
      <span style={{fontSize:28,flexShrink:0}}>{icon}</span>
      <div>
        <div style={{color,fontFamily:"'Orbitron',monospace",fontSize:12,fontWeight:700,letterSpacing:1,marginBottom:4}}>{name}</div>
        <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.5,marginBottom:4}}>{effect}</div>
        <div style={{color:"#ffffff44",fontSize:11,fontStyle:"italic"}}>💡 {tip}</div>
      </div>
    </div>
  );

  const renderTab = () => {
    if(tab === "basics") return (
      <div>
        <Section icon="🏁" title="HOW A RACE WORKS">
          <Row label="Track length" value="20 spaces — first to reach the end wins"/>
          <Row label="Race interval" value="Races fire every 1–5 minutes"/>
          <Row label="Betting window" value="Open until the countdown hits zero"/>
          <Row label="Race duration" value="~3–5 minutes depending on dice rolls"/>
          <Row label="Payout" value="Credited instantly after the winner crosses the line"/>
        </Section>
        <Section icon="💰" title="BETTING">
          <Row label="How to bet" value="Pick any horse(s), enter a dollar amount, hit CONFIRM"/>
          <Row label="Multiple bets" value="You can bet on multiple horses in the same race"/>
          <Row label="Minimum bet" value="$1 per horse"/>
          <Row label="Editing" value="You can edit bets anytime until the window closes"/>
          <Row label="Pot" value="All users' bets combine into one shared pot"/>
        </Section>
        <Section icon="📊" title="ODDS & PAYOUTS">
          <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.6,marginBottom:10}}>
            Odds are <span style={{color:"#00f5ff",fontWeight:700}}>pari-mutuel</span> — the more money bet on a horse, the lower the payout. The pot is shared proportionally among winning bettors.
          </div>
          <div style={{background:"rgba(0,245,255,0.06)",border:"1px solid #00f5ff22",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{color:"#00f5ff",fontFamily:"'Orbitron',monospace",fontSize:11,letterSpacing:2,marginBottom:4}}>THE FORMULA</div>
            <div style={{color:"#ffd700",fontFamily:"'Orbitron',monospace",fontSize:14}}>Odds = Total Pot ÷ Amount Bet on Winner</div>
            <div style={{color:"#ffffff44",fontSize:12,marginTop:4}}>Payout = Your Bet × Odds</div>
          </div>
          <OddsExample/>
        </Section>
      </div>
    );

    if(tab === "racetypes") return (
      <div>
        <RaceTypeCard icon="🎲" name="STANDARD" color="#00f5ff" tag="2 dice · classic"
          desc="Two dice are rolled each turn. Each die moves the matching horse one space. Doubles moves that horse two spaces."
          mechanics="Dice 1–6 = Horses 1–6. Roll a 3 and a 5 → Horse 3 and Horse 5 each move 1 space. Roll double 4s → Horse 4 moves 2 spaces."/>
        <RaceTypeCard icon="🎯" name="TRIPLE DICE" color="#a78bfa" tag="3 dice · more action"
          desc="Three dice rolled every turn — more movement, faster races, more horses in play each roll."
          mechanics="Same as Standard but with 3 dice. No doubles bonus — just 3 independent moves per roll."/>
        <RaceTypeCard icon="✨" name="MAGIC DICE" color="#ffd700" tag="2 dice · wild card"
          desc="Die 1 picks the horse. Die 2 decides how many spaces it moves. One horse could leap forward 6 spaces in a single roll."
          mechanics="Die 1 (1–6) = which horse. Die 2 (1–6) = spaces moved. Huge swings possible — any horse can bolt from last to first."/>
        <RaceTypeCard icon="↩️" name="DOWN & BACK" color="#ff6b6b" tag="2 dice · two legs"
          desc="Horses race to the far end, then turn around and race back. First to return to start wins. Strategy shifts at the halfway point."
          mechanics="Horses advance to space 20, then reverse direction. Once a horse turns, it heads back toward 0. First to reach 0 on the return wins."/>
        <RaceTypeCard icon="🚧" name="HURDLES" color="#39ff14" tag="2 dice · obstacles"
          desc="A hurdle sits at space 10. Horses must clear it with doubles — otherwise they stop in front and wait. A well-timed doubles roll can leap over the field."
          mechanics="Any horse reaching the hurdle stops unless doubles were rolled. On doubles, the horse clears the hurdle and lands 2 ahead. Horses pile up, then burst through."/>
      </div>
    );

    if(tab === "weather") return (
      <div>
        <div style={{color:"#ffffff44",fontSize:13,marginBottom:16,lineHeight:1.6}}>
          Weather conditions are assigned randomly when the schedule generates. They affect how dice moves work — same race, different chaos.
        </div>
        <WeatherCard icon="☀️" name="SUNNY" color="#ffd700"
          effect="Standard conditions. No modifiers. Dice rolls apply normally."
          tip="Baseline race — pure luck and odds. Great for learning the game."/>
        <WeatherCard icon="🌧️" name="RAIN (MUD)" color="#60a5fa"
          effect="Every 3rd roll, one die becomes the MUD DIE. That horse slips and doesn't move — only the other horse advances."
          tip="Mud slows the field unpredictably. Favourites can stall. Long shots love the rain."/>
        <WeatherCard icon="🌫️" name="FOG" color="#94a3b8"
          effect="Every 4th roll, one die becomes the FOG DIE. That horse slides BACKWARD one space instead of forward."
          tip="Fog can erase a lead instantly. Bet spreads work well here — one horse sliding back can flip the race."/>
      </div>
    );

    if(tab === "auctions") return (
      <div>
        <Section icon="🔨" title="HOW AUCTIONS WORK">
          <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.6,marginBottom:12}}>
            Auction races let you <span style={{color:"#ffd700",fontWeight:700}}>own a horse</span> by outbidding other players. Winning bidders become the horse's owner — their name appears on the track during the race.
          </div>
          <Row label="Auction format" value="6 horses auctioned one at a time, 30 seconds each"/>
          <Row label="Bidding" value="Place a bid higher than the current top bid to take the lead"/>
          <Row label="One owner per horse" value="Once you own a horse you can't bid on others"/>
          <Row label="No sale" value="If nobody bids on a horse, it runs unowned"/>
          <Row label="After auction" value="30-second presentation showing owners + odds"/>
        </Section>
        <Section icon="💵" title="AUCTION BETTING">
          <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.6,marginBottom:10}}>
            Owning a horse doesn't automatically mean you win money. You still need to <span style={{color:"#00f5ff",fontWeight:700}}>place a bet</span> on it (or any horse) in the bets tab during the auction.
          </div>
          <Row label="Ownership" value="Bragging rights + name on the track"/>
          <Row label="Winning bid cost" value="Deducted from your balance when you win the auction"/>
          <Row label="Payout" value="Same pari-mutuel odds as regular races"/>
          <Row label="Strategy" value="Bid high to own a horse, bet smart to profit"/>
        </Section>
      </div>
    );

    if(tab === "bank") return (
      <div>
        <Section icon="🏦" title="YOUR BANK">
          <Row label="Starting balance" value="$1,000 when you create your account"/>
          <Row label="Deposits" value="Add funds to your betting balance anytime"/>
          <Row label="Withdrawals" value="Move winnings out to your bank"/>
          <Row label="Transaction history" value="Full log of all deposits, withdrawals, and transfers"/>
        </Section>
        <Section icon="💡" title="TIPS">
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              ["Spread your bets","Betting on multiple horses in the same race hedges your risk — especially in weather races."],
              ["Watch the pot","A growing pot means competition. More bettors = bigger payouts if you pick right."],
              ["Long shots pay","A horse nobody else bet on pays massive odds if it wins. High risk, huge reward."],
              ["Auction early","First horses auctioned often go cheap — later horses get more competition."],
              ["Weather changes odds","Rain and fog shake up favourites. Reconsider your picks when conditions are rough."],
            ].map(([title,desc])=>(
              <div key={title} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 14px",borderLeft:"3px solid #00f5ff44"}}>
                <div style={{color:"#00f5ff",fontWeight:700,fontSize:13,marginBottom:3}}>{title}</div>
                <div style={{color:"#ffffff66",fontSize:12,lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"60px 12px 12px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:560,background:"#0d0d1f",border:"1px solid rgba(0,245,255,0.15)",borderRadius:20,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.8)"}}>
        {/* Header */}
        <div style={{padding:"20px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"'Orbitron',monospace",color:"#00f5ff",fontSize:18,letterSpacing:3,textShadow:"0 0 16px #00f5ff66"}}>HOW IT WORKS</div>
            <div style={{color:"#ffffff33",fontSize:12,marginTop:2,letterSpacing:1}}>The Track — Player Guide</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#ffffff66",cursor:"pointer",width:32,height:32,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:4,padding:"14px 16px 0",overflowX:"auto",scrollbarWidth:"none"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flexShrink:0,padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",
              background:tab===t.id?"rgba(0,245,255,0.15)":"rgba(255,255,255,0.04)",
              color:tab===t.id?"#00f5ff":"#ffffff55",
              fontFamily:"'Orbitron',monospace",fontSize:10,letterSpacing:1,fontWeight:700,
              borderBottom:tab===t.id?"2px solid #00f5ff":"2px solid transparent",
              transition:"all 0.15s",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{padding:"16px 16px 24px",maxHeight:"70vh",overflowY:"auto"}}>
          {renderTab()}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ── Pure background race simulator (no React, no animations) ─────────────────
function simRace(raceType, condition, seed) {
  const SPACES = 12, TB = 3, HURDLE = 5;
  const pos = Array(6).fill(0);
  const leg = Array(6).fill(false);
  const skip = Array(6).fill(false);
  let phase = "main", tieHorses = null;

  const rng = seed ? makeSeededDie(seed) : () => Math.floor(Math.random() * 6) + 1;

  const roll = () => {
    const nd = raceType === "triple_dice" ? 3 : 2;
    const dice = Array.from({length:nd}, rng);
    const isDoubles = nd === 2 && dice[0] === dice[1];
    let moves = [];

    if(phase === "tiebreak") {
      dice.forEach(d => { const hi = Math.min(d-1,5); if(tieHorses.includes(hi)) moves.push({horse:hi,steps:1}); });
    } else if(raceType === "magic_dice") {
      moves.push({horse:Math.min(dice[0]-1,5), steps:dice[1]});
    } else if(condition === "rain" && Math.random() < 0.33) {
      const si = dice[0] <= dice[1] ? 0 : 1;
      dice.forEach((d,di) => { if(di !== si) moves.push({horse:Math.min(d-1,5),steps:1}); });
    } else if(condition === "fog" && Math.random() < 0.25) {
      const fi = Math.floor(Math.random()*nd);
      dice.forEach((d,di) => { moves.push({horse:Math.min(d-1,5),steps:di===fi?-1:1,fog:di===fi}); });
    } else if(isDoubles) {
      moves.push({horse:Math.min(dice[0]-1,5), steps:2});
    } else {
      dice.forEach(d => moves.push({horse:Math.min(d-1,5), steps:1}));
    }
    return {dice, isDoubles, moves};
  };

  const apply = (moves, isDoubles) => {
    const finishers = [];
    moves.forEach(({horse,steps}) => {
      if(skip[horse]) { skip[horse]=false; return; }
      if(raceType==="down_back"||raceType==="magic_dice") {
        if(!leg[horse]) {
          const dest = pos[horse]+steps;
          if(dest >= SPACES) { leg[horse]=true; pos[horse]=Math.max(0,SPACES-(dest-SPACES)); if(pos[horse]<=0) finishers.push(horse); }
          else pos[horse]=dest;
        } else { pos[horse]=Math.max(0,pos[horse]-steps); if(pos[horse]<=0) finishers.push(horse); }
      } else if(raceType==="hurdle") {
        const hp = HURDLE+1;
        if(pos[horse]===hp-1) { if(isDoubles){ pos[horse]=hp+1; skip[horse]="jump"; } }
        else {
          const dest=pos[horse]+steps;
          pos[horse]=dest>=hp&&pos[horse]<hp-1?hp-1:dest===hp?hp-1:Math.min(SPACES,dest);
          if(pos[horse]>=SPACES) finishers.push(horse);
        }
      } else {
        if(steps<0) pos[horse]=Math.max(0,pos[horse]+steps);
        else { pos[horse]=Math.min(SPACES,pos[horse]+steps); if(pos[horse]>=SPACES) finishers.push(horse); }
      }
    });
    // clean jump markers
    skip.forEach((s,i)=>{ if(s==="jump") skip[i]=false; });
    return finishers;
  };

  let iters = 0, totalRolls = 0;
  while(iters++ < 2000) {
    const {dice,isDoubles,moves} = roll();
    totalRolls++;
    const finishers = apply(moves, isDoubles);
    if(finishers.length===1) {
      if(phase==="tiebreak") return { winner: finishers[0], rolls: totalRolls };
      return { winner: finishers[0], rolls: totalRolls };
    }
    if(finishers.length>1) {
      // tie → tiebreak
      phase="tiebreak"; tieHorses=[...finishers];
      for(let i=0;i<6;i++) pos[i]=0;
      let tbIters=0;
      while(tbIters++<500) {
        const tr = roll();
        const tf = apply(tr.moves, tr.isDoubles);
        if(tf.length>0) return tf[0];
      }
      return finishers[0]; // fallback
    }
  }
  return { winner: 0, rolls: iters }; // fallback
}
// ─── LOCAL RACE SIMULATOR (fallback if cloud function hasn't run yet) ────────
function simulateRaceWithHistory(raceType, condition, seed) {
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

function App() {
  // Prevent iOS auto-zoom on input focus by ensuring viewport doesn't scale
  useEffect(()=>{
    let meta = document.querySelector("meta[name=viewport]");
    if(!meta){ meta = document.createElement("meta"); meta.name="viewport"; document.head.appendChild(meta); }
    meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
  },[]);

  const [user,          setUser]          = useState(null);
  const [screen,        setScreen]        = useState("lobby");
  const [schedule,      setSchedule]      = useState([]);
  const [auctionSchedule, setAuctionSchedule] = useState([]);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [selectedRace,  setSelectedRace]  = useState(null);
  const [bets,          setBets]          = useState({});
  const [totalPot,      setTotalPot]      = useState(0);
  const [sharedPot,     setSharedPot]     = useState({}); // { [raceId]: {totalPot, betsPerHorse} }
  const [odds,          setOdds]          = useState({});
  const [winner,        setWinner]        = useState(null);
  const [showMyBets,    setShowMyBets]    = useState(false);
  const [showBank,      setShowBank]      = useState(false);
  const [showHowTo,     setShowHowTo]     = useState(false);
  const [friendRaces,   setFriendRaces]   = useState({}); // {raceId: count of friends betting}
  const [showProfile,   setShowProfile]   = useState(false);
  const [showPrivate,   setShowPrivate]   = useState(false);
  const [showAuction,   setShowAuction]   = useState(false);
  const [auctionOwners, setAuctionOwners] = useState(null);
  const [selectedAuctionRace, setSelectedAuctionRace] = useState(null);

  const [activePrivateRace, setActivePrivateRace] = useState(null); // private race code when racing privately
  const [now,           setNow]           = useState(Date.now());
  const [userBets,      setUserBets]      = useState({});
  const [chatMsgs,      setChatMsgs]      = useState([]); // lifted so msgs persist countdown→race
  const [chatOpen,      setChatOpen]      = useState(false);
  const [chatUnread,    setChatUnread]    = useState(0);
  const timeOffsetRef   = useRef(0);
  const lastTickRef     = useRef(Date.now());
  const _cachedRaceResultsRef = useRef({});

  // Load friend active races
  useEffect(()=>{
    if(!user?.uid) return;
    fbGetFriends(user.uid).then(async f => {
      const following = f.following || [];
      if(!following.length) return;
      const allConfirmed = await Promise.all(following.map(uid => fbGetConfirmedForUser(uid)));
      const raceCounts = {};
      allConfirmed.forEach(confirmed => {
        Object.keys(confirmed).forEach(raceId => {
          raceCounts[raceId] = (raceCounts[raceId]||0) + 1;
        });
      });
      setFriendRaces(raceCounts);
    });
  },[user?.uid, schedule]);

  // Keep race results cache fresh — use a ref so clock interval always sees latest value
  useEffect(()=>{
    const refresh = async () => {
      const r = await fbGetRaceRolls();
      const results = {};
      Object.entries(r).forEach(([id,data])=>{
        results[id] = { winner: data.winner, visualFinishAt: data.visualFinishAt, finishedAt: data.computedAt };
      });
      _cachedRaceResultsRef.current = results;
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return ()=>clearInterval(t);
  },[]);

  // Clock tick — also mark finished races based on bg results
  useEffect(()=>{
    const t=setInterval(()=>{
      lastTickRef.current = Date.now();
      _gameTimeOffset = 0;
      setNow(gameNow());
      const results = _cachedRaceResultsRef.current;
      const t2 = gameNow();
      const dropRace = (r) => {
        if(r.status === "finished") return r;
        const res = results[r.id];
        if(!res) return r;
        const visualDone = res.visualFinishAt || res.finishedAt || 0;
        if(visualDone > 0 && t2 > visualDone + 30000) return {...r, status:"finished"};
        return r;
      };
      setSchedule(s=>s.map(dropRace));
      setAuctionSchedule(s=>s.map(dropRace));
    },1000);
    return()=>clearInterval(t);
  },[]);




  // ── Background race runner ────────────────────────────────────────────────
  // Runs all scheduled races silently at their start time, stores results
  useEffect(()=>{
    const runPending = async () => {
      const results = await fbGetRaceResults();
      const now2 = gameNow();
      const allRaces = [...schedule, ...auctionSchedule];
      let changed = false;
      for(const race of allRaces) {
        if(results[race.id] !== undefined) continue;
        const actualFireTime = race.isAuction ? race.startTime + 30000 : race.startTime;
        if(actualFireTime > now2) continue;
        const { winner, rolls } = simRace(race.type, race.condition||"sunny", race.seed);
        const visualFinishAt = actualFireTime + 1300 + rolls * ROLL_INTERVAL;
        results[race.id] = { winner: winner ?? 0, rolls, finishedAt: now2, visualFinishAt, raceId: race.id };
        changed = true;
        // Auto-payout confirmed bets
        if(user?.uid) {
          const [confirmed, sharedPotData] = await Promise.all([
            fbGetConfirmed(user.uid),
            fbGetRacePot(race.id),
          ]);
          const saved = confirmed[race.id];
          if(saved) {
            const activeBets  = saved.bets || {};
            // Use shared pot if available, fall back to personal pot
            const sharedTotal = sharedPotData?.totalPot || 0;
            const sharedBets  = sharedPotData?.betsPerHorse || {};
            const activePot   = sharedTotal > 0 ? sharedTotal : (saved.pot || 0);
            const myBet       = parseFloat(activeBets[winner] || 0);
            // totalOnWinner = all users' bets on winning horse from shared pot
            const totalOnWinner = sharedTotal > 0
              ? (sharedBets[winner] || 0)
              : Object.entries(activeBets).reduce((s,[hid,v])=>parseInt(hid)===winner?s+(parseFloat(v)||0):s, 0);
            const payout = myBet > 0 && totalOnWinner > 0 ? (activePot / totalOnWinner) * myBet : 0;
            results[race.id].confirmedBets  = activeBets;
            results[race.id].confirmedPot   = activePot;
            results[race.id].totalOnWinner  = totalOnWinner;
            results[race.id].payout         = parseFloat(payout.toFixed(2));
          }
        }
      }
      if(changed) {
        await fbSaveRaceResults(results);
        _cachedRaceResultsRef.current = results;
      }
    };

    runPending(); // run immediately
    const t = setInterval(runPending, 5000); // check every 5s
    return () => clearInterval(t);
  }, [schedule, auctionSchedule]);

  // Fire AI name generation for auction races too
  useEffect(()=>{
    auctionSchedule.forEach(race=>{
      generateAIHorseNames(race.id, (names)=>{
        setAuctionSchedule(s=>s.map(r=>r.id===race.id ? {...r, horses:names} : r));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Fire AI name generation for all races on mount — updates schedule as names arrive
  useEffect(()=>{
    schedule.forEach(race=>{
      generateAIHorseNames(race.id, (names)=>{
        setSchedule(s=>s.map(r=>r.id===race.id ? {...r, horses:names} : r));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Firebase auth state listener — handles session restore automatically
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if(firebaseUser) {
        const userData = await fbGetUser(firebaseUser.uid);
        if(userData) {
          setUser({ uid: firebaseUser.uid, username: userData.username, balance: userData.balance, email: firebaseUser.email });
          const confirmed = await fbGetConfirmed(firebaseUser.uid);
          setUserBets(confirmed);
          // Sync Firestore profile fields (avatar, bio) to localStorage
          const localProfile = getProfile(userData.username);
          const mergedAvatar = userData.avatar || localProfile?.avatar || "🏇";
          const mergedBio    = userData.bio    || localProfile?.bio    || "";
          if(mergedAvatar !== localProfile?.avatar || mergedBio !== localProfile?.bio) {
            saveProfile(userData.username, {...localProfile, avatar:mergedAvatar, bio:mergedBio});
          }
          // Upsert userindex with latest avatar
          fbSaveUserIndex(userData.username, firebaseUser.uid, mergedAvatar, userData.balance);
        }
      } else {
        setUser(null);
        setUserBets({});
      }
    });
    return () => unsub();
  },[]);

  // Real-time schedule listener — all users see the same races instantly
  useEffect(()=>{
    const now2 = gameNow();
    // Subscribe to schedule changes in real-time
    const unsubSched = onSnapshot(doc(db,"global","schedule"), async (snap) => {
      if(snap.exists()) {
        const data = snap.data();
        const hasValid = data.races?.some(r => r.startTime > now2 - 60*60*1000);
        if(hasValid) { setSchedule(data.races); setScheduleLoaded(true); return; }
      }
      // Generate new schedule if missing/expired
      const newSched = generateSchedule();
      setSchedule(newSched);
      await fbSaveSchedule({ races: newSched, generatedAt: now2 });
      setScheduleLoaded(true);
    });
    const unsubAuction = onSnapshot(doc(db,"global","auctionSchedule"), async (snap) => {
      if(snap.exists()) {
        const data = snap.data();
        const hasValid = data.races?.some(r => r.startTime > now2 - 60*60*1000);
        if(hasValid) { setAuctionSchedule(data.races); return; }
      }
      const newAuction = generateAuctionSchedule();
      setAuctionSchedule(newAuction);
      await fbSaveAuctionSchedule({ races: newAuction, generatedAt: now2 });
    });
    // Real-time shared pot listener
    const unsubPots = onSnapshot(doc(db,"global","racePots"), (snap) => {
      if(snap.exists()) setSharedPot(snap.data());
      else setSharedPot({});
    });

    return () => { unsubSched(); unsubAuction(); unsubPots(); };
  },[]);

  // Sync pending bets to state so navbar badge updates
  const refreshPending=async()=>{
    if(!user?.uid) return;
    const c = await fbGetConfirmed(user.uid);
    setUserBets(c);
  };

  const updateBalance=useCallback((nb)=>{
    if(user?.uid) fbUpdateUser(user.uid, {balance: nb});
    setUser(u=>u?{...u,balance:nb}:u);
  },[user]);

  const handleLogin=u=>{ setUser(u); };
  const handleLogout=()=>{ signOut(auth); setUser(null); setScreen("lobby"); };

  const handleEnterRace=async(race)=>{ // async only needed for payout path
    const st = raceStatus(race, gameNow());
    const results = _cachedRaceResultsRef.current;
    const bgResult = results[race.id];

    if(bgResult !== undefined && st === "finished") {
      setSelectedRace(race);
      setBets({});
      setTotalPot(0);
      const activeBets = bgResult.confirmedBets || {};
      const activePot  = bgResult.confirmedPot  || 0;
      const calcOdds = {};
      if(activePot > 0) Object.entries(activeBets).forEach(([hid,v])=>{
        if(parseFloat(v)>0) calcOdds[parseInt(hid)] = activePot / parseFloat(v);
      });
      setOdds(calcOdds);
      setBets(activeBets);
      setTotalPot(activePot);
      if(bgResult.payout > 0 && !bgResult.paid) {
        updateBalance((user?.balance||0) + bgResult.payout);
        const updatedResults = {...results, [race.id]: {...results[race.id], paid: true}};
        await fbSaveRaceResults(updatedResults);
        _cachedRaceResultsRef.current = updatedResults;
        if(user?.uid) {
          const hist = await fbGetHistory(user.uid);
          Object.entries(activeBets).forEach(([hid,a])=>{
            hist.push({user:user?.username,raceId:race.id,horseId:parseInt(hid),amount:parseFloat(a)||0,odds:calcOdds[parseInt(hid)]||null,won:parseInt(hid)===bgResult.winner,payout:parseInt(hid)===bgResult.winner?bgResult.payout:0,time:Date.now(),raceName:race.name,raceType:race.type});
          });
          await fbSaveHistory(user.uid, hist);
        }
      }
      setWinner(bgResult.winner);
      setScreen("payout");
      return;
    }

    // Still going — clear stale bets then load confirmed for this race
    setBets({});
    setTotalPot(0);
    const c = getConfirmed();
    const saved = c[race.id];
    if(saved){ setBets(saved.bets); setTotalPot(saved.pot); }
    setSelectedRace(race);
    setWinner(null);

    setChatMsgs([]);
    setChatOpen(false);
    setChatUnread(0);

    // Racing = mid-race, join live. Locked = 30s presentation, go to detail.
    if(st==="racing") {
      setScreen("race");
    } else {
      setScreen("detail");
    }
  };

  // Confirms/locks bets — saves to persistent store, race fires at post time
  // prevPot = amount already deducted for this race on a prior confirm (for edits)
  const handleAuctionBetsConfirm=async(finalBets, pot, prevPot=0)=>{
    const raceId = selectedAuctionRace?.id;
    if(!raceId) return;
    const delta = pot - prevPot;
    updateBalance(user.balance - delta);
    // Save to Firestore confirmed bets
    const c = await fbGetConfirmed(user.uid);
    c[raceId] = { bets:finalBets, pot, raceId };
    await fbSaveConfirmed(user.uid, c);
    // Also write to shared pot so bets appear in lobby and active bets
    await fbContributeToRacePot(raceId, user.uid, finalBets, pot, prevPot);
    // Mirror to localStorage so AuctionRaceScreen can read it on remount
    const local = getConfirmed();
    local[raceId] = { bets:finalBets, pot, raceId };
    saveConfirmed(local);
    sfx.betConfirm();
    setBets(finalBets); setTotalPot(pot);
    setUserBets(c);
  };

  const handleBetsConfirm=async(finalBets, pot, prevPot=0)=>{
    const delta = pot - prevPot;
    updateBalance(user.balance - delta);
    // Save user's private bet record
    const c = await fbGetConfirmed(user.uid);
    c[selectedRace.id]={ bets:finalBets, pot, raceId:selectedRace.id };
    await fbSaveConfirmed(user.uid, c);
    // Write to shared pot so all users see combined pot + odds
    await fbContributeToRacePot(selectedRace.id, user.uid, finalBets, pot, prevPot);
    sfx.betConfirm();
    setUserBets(c);
    setBets(finalBets); setTotalPot(pot);
  };

  // Called when race clock hits zero
  const handleRaceStart=useCallback(()=>{
    // userBets is already loaded and kept in sync — no need to await Firebase here
    const saved = userBets[selectedRace?.id];
    if(saved){ setBets(saved.bets); setTotalPot(saved.pot); }
    setScreen("race");
  },[selectedRace?.id, userBets]);

  const handleRaceEnd=useCallback(async(winnerIdx)=>{
    setWinner(winnerIdx);

    // ── PRIVATE RACE PATH ──
    if(activePrivateRace) {
      const allPR = await fbGetPrivateRaces();
      const pr    = allPR[activePrivateRace];
      if(pr) {
        const members = pr.members || {};
        const totalPool = Object.values(members).reduce((s,m)=>s+(parseFloat(m.pot)||0),0);
        const memberResults = {};
        Object.entries(members).forEach(([uname,mdata])=>{
          const memberBets = mdata.bets || {};
          const myBetAmt   = parseFloat(memberBets[winnerIdx]||0);
          const totalOnWinner = Object.values(members).reduce((s,m)=>s+(parseFloat(m.bets?.[winnerIdx]||0)),0);
          const payout = totalOnWinner > 0 && myBetAmt > 0 ? (totalPool / totalOnWinner) * myBetAmt : 0;
          memberResults[uname] = { bets: memberBets, pot: mdata.pot||0, payout: parseFloat(payout.toFixed(2)), won: myBetAmt > 0 };
        });
        allPR[activePrivateRace] = { ...pr, finished:true, winner:winnerIdx, memberResults, finishedAt:Date.now() };
        await fbSavePrivateRaces(allPR);
        const myResult = memberResults[user?.username];
        if(myResult?.payout > 0) updateBalance((user?.balance||0) + myResult.payout);
        const calcOdds = {};
        const totalOnWinnerGlobal = Object.values(members).reduce((s,m)=>s+(parseFloat(m.bets?.[winnerIdx]||0)),0);
        if(totalOnWinnerGlobal > 0) calcOdds[winnerIdx] = parseFloat((totalPool / totalOnWinnerGlobal).toFixed(2));
        setOdds(calcOdds);
        setBets(memberResults[user?.username]?.bets || bets);
        setTotalPot(totalPool);
      }
      setScreen("private-payout");
      return;
    }

    // ── NORMAL RACE PATH ──
    const c = user?.uid ? await fbGetConfirmed(user.uid) : {};
    const saved = c[selectedRace?.id];
    const activeBets = saved?.bets || bets;

    // Fetch shared pot fresh from Firestore — don't rely on stale local state
    const freshSharedPot = await fbGetRacePot(selectedRace?.id);
    const sp = freshSharedPot?.totalPot > 0 ? freshSharedPot : sharedPot[selectedRace?.id];
    const sharedTotalPot     = sp?.totalPot     || saved?.pot || totalPot;
    const sharedBetsPerHorse = sp?.betsPerHorse || {};

    const calcOdds = {};
    HORSES.forEach(h => {
      const totalOnHorse = sharedBetsPerHorse[h.id] || 0;
      if(totalOnHorse > 0) calcOdds[h.id] = parseFloat((sharedTotalPot / totalOnHorse).toFixed(2));
    });
    setOdds(calcOdds);

    const activePot  = sharedTotalPot;
    const myBetAmt   = parseFloat(activeBets[winnerIdx] || 0);
    const payout     = myBetAmt > 0 && calcOdds[winnerIdx] ? parseFloat((myBetAmt * calcOdds[winnerIdx]).toFixed(2)) : 0;

    const bgResults = _cachedRaceResultsRef.current;
    const bgResult  = bgResults[selectedRace?.id];

    // ─── BUG 3 FIX: Mark paid BEFORE calling updateBalance to prevent double-pay ─
    const alreadyPaid = bgResult?.paid === true;
    if(!alreadyPaid && user?.uid) {
      // Mark paid immediately to prevent race condition with background runner
      if(bgResult) {
        const updatedBg = {...bgResults, [selectedRace?.id]:{...bgResult, paid:true}};
        _cachedRaceResultsRef.current = updatedBg;
        await fbSaveRaceResults(updatedBg);
      }
      updateBalance((user?.balance||0) + payout);
      const hist = await fbGetHistory(user.uid);
      Object.entries(activeBets).forEach(([hid,a])=>{
        hist.push({user:user?.username,raceId:selectedRace?.id,horseId:parseInt(hid),amount:parseFloat(a)||0,odds:calcOdds[hid]?parseFloat(calcOdds[hid].toFixed(2)):null,won:parseInt(hid)===winnerIdx,payout:parseInt(hid)===winnerIdx?parseFloat(payout.toFixed(2)):0,time:Date.now(),raceName:selectedRace?.name,raceType:selectedRace?.type});
      });
      await fbSaveHistory(user.uid, hist);
    }
    // Remove from confirmed and clear shared pot
    if(user?.uid) {
      const newC = {...c}; delete newC[selectedRace?.id];
      await fbSaveConfirmed(user.uid, newC);
      setUserBets(newC);
    }
    await fbClearRacePot(selectedRace?.id);
    setBets(activeBets); setTotalPot(activePot);
    setSchedule(s=>s.map(r=>r.id===selectedRace?.id?{...r,status:"finished"}:r));
    setScreen("payout");
  },[bets,totalPot,odds,user,selectedRace,activePrivateRace,updateBalance,]);

  // Launch a private race — build a synthetic race object and go straight to RaceScreen
  const handleLaunchPrivateRace = (privateRace) => {
    const syntheticRace = {
      id:        `private_${privateRace.code}`,
      name:      privateRace.name,
      type:      privateRace.raceType || "standard",
      startTime: Date.now(),
      status:    "racing",
      horses:    privateRace.horses,
      coats:     privateRace.coats||[],
      _privateCode: privateRace.code,
    };
    // Collect my bets from the private race member data
    const myData = privateRace.members?.[user?.username] || {};
    const myBets  = myData.bets || {};
    const myPot   = myData.pot  || Object.values(myBets).reduce((s,v)=>s+(parseFloat(v)||0),0);
    setSelectedRace(syntheticRace);
    setBets(myBets);
    setTotalPot(myPot);
    setActivePrivateRace(privateRace.code);
    setWinner(null);
    setShowPrivate(false);
    setScreen("race");
  };

  const goLobby=()=>{
    setScreen("lobby");
    setWinner(null);
    setSelectedRace(null);
    setBets({});
    setTotalPot(0);
    setActivePrivateRace(null);

    setShowAuction(false);
    setSelectedAuctionRace(null);
    setShowPrivate(false);
    setShowMyBets(false);
    refreshPending();
  };

  const pendingCount=useMemo(()=>{
    const allSchedule=[...schedule,...auctionSchedule];
    const pending=Object.keys(getPending()).filter(raceId=>{
      const race=allSchedule.find(r=>r.id===raceId);
      if(!race) return false;
      return raceStatus(race,now)!=="finished";
    });
    const confirmed=Object.keys(getConfirmed()).filter(raceId=>{
      const race=allSchedule.find(r=>r.id===raceId);
      if(!race) return false;
      return raceStatus(race,now)!=="finished";
    });
    return new Set([...pending,...confirmed]).size;
  },[userBets,schedule,auctionSchedule,now]);

  if(!user) return <AuthScreen onLogin={handleLogin}/>;

  // Always derive the live race from schedule so horse names (and status) stay fresh
  const liveSelectedRace = selectedRace
    ? (schedule.find(r=>r.id===selectedRace.id) || selectedRace)
    : null;

  return (
    <div style={{minHeight:"100vh",background:"#08081a"}}>
      <style>{GS}</style>
      <NavBar user={user} onLobby={goLobby} onMyBets={()=>{refreshPending();setShowMyBets(true);}} onProfile={()=>setShowProfile(true)} onPrivateRaces={()=>setShowPrivate(true)} onAuctions={()=>{setSelectedAuctionRace(null);setShowAuction(true);}} onBank={()=>setShowBank(true)} onHowTo={()=>setShowHowTo(true)} onLogout={handleLogout} pendingCount={pendingCount}/>

      {showBank    && <BankPanel user={user} onClose={()=>setShowBank(false)} onBalanceChange={updateBalance}/>}
      {showHowTo   && <HowItWorksPanel onClose={()=>setShowHowTo(false)}/>}
      {showProfile && <ProfilePanel user={user} schedule={schedule} auctionSchedule={auctionSchedule} now={now} onClose={()=>setShowProfile(false)} onGoToRace={handleEnterRace} onBalanceChange={updateBalance}/>}
      {showPrivate && <PrivateRacesPanel user={user} onClose={()=>setShowPrivate(false)} onLaunchPrivateRace={handleLaunchPrivateRace}/>}
      {showMyBets&& (
        <MyBetsPanel
          username={user.username} uid={user.uid} schedule={schedule} auctionSchedule={auctionSchedule} now={now}
          onClose={()=>setShowMyBets(false)}
          onGoToRace={race=>{setShowMyBets(false);setSelectedRace(race);setScreen("detail");}}
          userBalance={user.balance}
          onBalanceChange={updateBalance}
        />
      )}
      {showAuction && !selectedAuctionRace && (
        <div style={{position:"fixed",inset:0,zIndex:50,background:"#08081a",overflowY:"auto"}}>
          <AuctionLobbyScreen schedule={auctionSchedule} now={now} onEnterRace={race=>{setSelectedAuctionRace(race);}} sharedPot={sharedPot}/>
          <button onClick={()=>setShowAuction(false)} style={{position:"fixed",top:16,left:16,zIndex:60,background:"none",border:"none",color:"#ffffff44",cursor:"pointer",fontSize:13}}>← Close</button>
        </div>
      )}
      {showAuction && selectedAuctionRace && screen!=="race" && (
        <div style={{position:"fixed",inset:0,zIndex:50,background:"#08081a",overflowY:"auto"}}>
          <AuctionRaceScreen
            race={auctionSchedule.find(r=>r.id===selectedAuctionRace.id)||selectedAuctionRace}
            user={user} now={now}
            onBack={()=>setSelectedAuctionRace(null)}
            onRaceStart={()=>{
              const r=auctionSchedule.find(x=>x.id===selectedAuctionRace.id)||selectedAuctionRace;
              // For auction races, the visual race starts at startTime+30s (after presentation)
              const raceWithStart = {...r, startTime: r.startTime + 30000};
              setSelectedRace(raceWithStart);
              fbGetAuctions().then(allA => setAuctionOwners((allA[r.id]||{}).owners||null));
              setWinner(null);
              setShowAuction(false);
              setScreen("race");
            }}
            confirmedBets={(userBets[selectedAuctionRace?.id]||{}).bets||bets}
            confirmedPot={(userBets[selectedAuctionRace?.id]||{}).pot||totalPot}
            onConfirmBets={handleAuctionBetsConfirm}
          />
        </div>
      )}
      {screen==="lobby"  && <LobbyScreen schedule={schedule} now={now} onEnterRace={handleEnterRace} userBets={userBets} friendRaces={friendRaces} sharedPot={sharedPot}/>}
      {screen==="detail" && liveSelectedRace && <RaceDetailScreen race={liveSelectedRace} user={user} now={now} onBack={goLobby} onConfirmBets={handleBetsConfirm} confirmedBets={bets} confirmedPot={totalPot} sharedPot={sharedPot[liveSelectedRace?.id]||null} onRaceStart={handleRaceStart} devForceStart={false} onDevForceStart={()=>{}} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs} chatOpen={chatOpen} setChatOpen={setChatOpen} chatUnread={chatUnread} setChatUnread={setChatUnread}/>}
      {screen==="race"   && liveSelectedRace && <RaceScreen race={{...liveSelectedRace, nowMs:now}} bets={bets} totalPot={sharedPot[liveSelectedRace?.id]?.totalPot||totalPot} onRaceEnd={handleRaceEnd} user={user} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs} chatOpen={chatOpen} setChatOpen={setChatOpen} chatUnread={chatUnread} setChatUnread={setChatUnread} auctionOwners={auctionOwners}/>}
      {screen==="payout"         && liveSelectedRace && winner!==null && <PayoutScreen race={liveSelectedRace} bets={bets} totalPot={totalPot} odds={odds} winner={winner} userBalance={user.balance} onPlayAgain={()=>handleEnterRace(liveSelectedRace)} onLobby={goLobby}/>}
      {screen==="private-payout"  && liveSelectedRace && winner!==null && <PrivatePayoutScreen race={liveSelectedRace} winner={winner} user={user} onLobby={goLobby}/>}
    </div>
  );
}

export default App;
