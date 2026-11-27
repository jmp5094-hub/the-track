import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
import {RunnerSilk} from './site/RunnerSilk';
import {createRaceStore} from './data/race-store.mjs';
import {simulateRaceWithHistory} from '../functions/race-engine.mjs';
import {privateSeed,ENGINE_VERSION} from '../functions/race-rules.mjs';
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Broadcast } from "./broadcast/Broadcast";
import { buildPlayback } from "./broadcast/playback.mjs";
import broadcastVoice from "./broadcast/voice.json";
import "./track-theme.css";
import {LobbyView,RaceEntryView,RaceResultView} from "./site/RaceViews";
import {AuctionView} from "./site/AuctionView";
import { getCoatIndex, getCoatName } from "./data/horse-coats.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs, onSnapshot, serverTimestamp, orderBy, limit, runTransaction, increment } from "firebase/firestore";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCCmWWDZvUgOvQz9fLhxQjd7y64DYSEcw8",
  authDomain: "the-track-c8138.firebaseapp.com",
  projectId: "the-track-c8138",
  storageBucket: "the-track-c8138.firebasestorage.app",
  messagingSenderId: "870178393224",
  appId: "1:870178393224:web:eda929bd3d3ae2f8e2e33d",
};

const isolatedQA=import.meta.env.DEV && ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('qa')==='1';
const firebaseApp = initializeApp(isolatedQA?{...firebaseConfig,apiKey:'demo-track-key',projectId:'demo-track',authDomain:'localhost'}:firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
if(isolatedQA&&!auth.emulatorConfig){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);connectFunctionsEmulator(getFunctions(firebaseApp),'127.0.0.1',5001);}
const raceStore=createRaceStore(db);

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
// User profile
const fbGetUser    = async (uid) => { const d = await getDoc(doc(db,"users",uid)); return d.exists() ? d.data() : null; };
const fbSaveUser   = async (uid, data) => setDoc(doc(db,"users",uid), data, {merge:true});
const fbUpdateUser = async (uid, data) => updateDoc(doc(db,"users",uid), data);

// Race schedule (shared across all users)
const fbGetSchedule      = async () => { const d = await getDoc(doc(db,"global","schedule")); return d.exists() ? d.data() : null; };
const fbGetAuctionSchedule = async () => { const d = await getDoc(doc(db,"global","auctionSchedule")); return d.exists() ? d.data() : null; };

// Race results (legacy — kept for payout tracking)
const fbGetRaceResults  = async () => { const d = await getDoc(doc(db,"global","raceResults")); return d.exists() ? d.data().results || {} : {}; };
const fbSaveRaceResults = async (r) => setDoc(doc(db,"global","raceResults"), {results:r});
// Roll histories — pre-computed by Cloud Function, read by all clients for replay
const fbGetRaceRoll = async id => {const snap=await getDoc(doc(db,'raceRolls',id));return snap.exists()?snap.data():null;};

// Per-user bets
const fbGetConfirmed  = async (uid) => { const d = await getDoc(doc(db,"bets",uid)); return d.exists() ? d.data().confirmed || {} : {}; };
const fbSaveConfirmed = async (uid, c) => setDoc(doc(db,"bets",uid), {confirmed:c}, {merge:true});
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
  { id:3, name:"Volt Streak",    color:"#97bd88" },
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
const horseCoatName = (race, horseId) => race?.coats?.[horseId]?.name ?? getCoatName(horseCoatIndex(race, horseId));
const horseCoatIndex = (race, horseId) => {
  // Use coatIndex stored in race by cloud function if available
  const stored = race?.coats?.[horseId]?.coatIndex;
  if(stored !== undefined && stored !== null) return stored;
  // Fall back to deterministic derivation for old races
  return getCoatIndex(race?.id || "default", horseId);
};

const RACE_TYPES = {
  standard:    { label:"Standard",     icon:"🏇", color:"#e5b678", dice:2, desc:"2 dice per roll — each die moves a horse. Doubles = bonus move!" },
  down_back:   { label:"Down & Back",  icon:"🔄", color:"#adbba2", dice:2, desc:"Race to the turn, then roll across the home line into the final space." },
  hurdle:      { label:"Hurdles",      icon:"🚧", color:"#b77d58", dice:2, desc:"One hurdle in the center — you're blocked until you roll doubles to jump over!" },
  magic_dice:  { label:"Magic Dice",   icon:"✨", color:"#97bd88", dice:2, desc:"Die 1 picks the horse, Die 2 picks the spaces. Race out and back — first home wins!" },
  triple_dice: { label:"Triple Dice",  icon:"🎲", color:"#d48d80", dice:3, desc:"3 dice rolled each turn — 3 horses move simultaneously. Pure chaos!" },
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
    label:"Sunny",      icon:"☀️",  color:"#e4c48b",
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
const setSoundEnabled = (v) => { try { localStorage.setItem("tt_sound", v?"1":"0"); } catch {} window.dispatchEvent(new Event("track-sound")); };
const getMusicEnabled = () => { try { return localStorage.getItem("tt_music")==="1"; } catch { return false; } };
const setMusicEnabled = (v) => { try { localStorage.setItem("tt_music", v?"1":"0"); } catch {} };

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

// Master audio unlock — fires on EVERY gesture until confirmed unlocked
// Handles both Web Audio API (sfx) and HTML Audio (music/bugle/commentary)
let _masterUnlocked = false;
const _masterUnlock = () => {
  // 1. Resume Web Audio context for sfx (always needed)
  if(_audioCtx && _audioCtx.state==="suspended") _audioCtx.resume().catch(()=>{});
  // Retry pending commentary on every gesture
  if(pendingAudio) { pendingAudio.play().catch(()=>{}); pendingAudio=null; }
  if(!_masterUnlocked) {
    _masterUnlocked = true;
    // 2. Unlock music tracks — use muted:true so no audible blip on iOS
    Object.keys(MUSIC_TRACKS||{}).forEach(name=>{
      const a=_aud[name]; if(!a) return;
      a.muted=true;
      a.play().then(()=>{
        if(a._shouldPlay){ a.muted=false; }
        else { a.pause(); a.currentTime=0; a.muted=false; }
      }).catch(()=>{ a.muted=false; });
    });

  }
};
if(typeof window !== "undefined") {
  ["touchstart","mousedown","click","keydown"].forEach(evt=>
    window.addEventListener(evt, _masterUnlock, {passive:true})
  );
}
const unlockAudio = _masterUnlock; // keep old name working

// ── Individual sound effects ──────────────────────────────────────────────────


// Bugle audio — created lazily on first use, not at module load
let _bugleAudio = null;
function _getBugle() {
  if(!_bugleAudio) {
    _bugleAudio = new Audio("/Bugle.mp3");
    _bugleAudio.preload = "none";
  }
  return _bugleAudio;
}

// ─── BACKGROUND MUSIC — iOS-safe unified audio manager ───────────────────────
// iOS requires all Audio elements to be .play()'d synchronously inside a user
// gesture before async playback is allowed. We pre-create all tracks and unlock
// them all together on the first user tap.

const MUSIC_TRACKS = {
  lobby:     { src:"/broadcast/audio/pulse.mp3", targetVol:0.06 },
  countdown: { src:"/broadcast/audio/pulse.mp3", targetVol:0.10 },
  race:      { src:"/broadcast/audio/pulse.mp3", targetVol:0.12 },
};
const _aud = {};       // name → Audio element
let _audUnlocked = false;
let _currentTrack = null;

function _getTrack(name) {
  if(!_aud[name]) {
    const a = new Audio(MUSIC_TRACKS[name].src);
    a.loop = true; a.volume = 0; a.preload = "auto";
    _aud[name] = a;
  }
  return _aud[name];
}

function fadeAudio(audio, targetVol, durationMs, onDone) {
  if(!audio) { if(onDone) onDone?.(); return; }
  if(audio._fadeIv) { clearInterval(audio._fadeIv); audio._fadeIv=null; }
  const startVol = audio.volume;
  const diff = targetVol - startVol;
  if(Math.abs(diff)<0.001) { if(onDone) onDone?.(); return; }
  const steps = Math.max(1, Math.round(durationMs/50));
  let step = 0;
  audio._fadeIv = setInterval(()=>{
    step++;
    audio.volume = Math.max(0, Math.min(1, startVol+diff*(step/steps)));
    if(step>=steps){ clearInterval(audio._fadeIv); audio._fadeIv=null; if(onDone) onDone?.(); }
  }, durationMs/steps);
}

// _desiredTrack = what SHOULD be playing regardless of mute state
// musicEnabled   = whether audio is actually audible
// These are completely separate concerns.
let _desiredTrack = null;

function _applyTrack(name) {
  // Transition to new track — fade out others, fade in new one
  Object.keys(MUSIC_TRACKS).forEach(n=>{
    const a=_aud[n]; if(!a) return;
    if(n!==name) {
      if(!a.paused) fadeAudio(a, 0, 800, ()=>{ a.pause(); a.currentTime=0; });
    }
  });
  const a = _getTrack(name);
  const targetVol = musicEnabled ? MUSIC_TRACKS[name].targetVol : 0;
  setTimeout(()=>{
    if(_desiredTrack !== name) return; // already changed
    if(a.paused) {
      a.volume = 0;
      a.play().catch(()=>{
        ['touchstart','click'].forEach(e=>window.addEventListener(e,()=>{
          if(_desiredTrack===name) { a.play().catch(()=>{}); }
        },{once:true,passive:true}));
      });
    }
    fadeAudio(a, targetVol, 1500);
  }, 600);
}

// Public: set which track should play (ignores mute — music flows naturally)
function startLobbyMusic()   { if(_desiredTrack==="lobby") return; _desiredTrack="lobby";     _applyTrack("lobby");     }
function startBgMusic()      { if(_desiredTrack==="countdown") return; _desiredTrack="countdown"; _applyTrack("countdown"); }
function startRaceMusic()    { _desiredTrack="race";     _applyTrack("race");      }
function stopLobbyMusic(ms)  { if(_desiredTrack!=="lobby") return; _desiredTrack=null; const a=_aud.lobby; if(a&&!a.paused) fadeAudio(a,0,ms||1500,()=>{a.pause();a.currentTime=0;}); }
function fadeBgMusic(v,ms,cb){ const a=_aud.countdown; if(a) fadeAudio(a,v,ms||1500,cb); }
function stopBgMusic(ms=2000){ ["countdown","race"].forEach(n=>{ _desiredTrack=null; const a=_aud[n]; if(a&&!a.paused) fadeAudio(a,0,ms,()=>{a.pause();a.currentTime=0;}); }); }
function stopAllMusic(ms=1500){ Object.keys(MUSIC_TRACKS).forEach(n=>{ const a=_aud[n]; if(a&&!a.paused) fadeAudio(a,0,ms,()=>{a.pause();a.currentTime=0;}); }); _desiredTrack=null; }
function initBgMusic()   {}
function initRaceMusic() {}
function initLobbyMusic(){}

// ─── ELEVENLABS RACE COMMENTARY ──────────────────────────────────────────────
// Reset commentary state when race changes
let _lastRaceId = null;
const EL_URL = "/api/commentary"; // Vercel serverless proxy — keeps API key server-side

let commentaryQueue   = [];
let commentaryPlaying = false;
let commentaryEnabled = getSoundEnabled(); // off by default until user enables
let lastCommentaryTime = 0;   // timestamp of last commentary start
const COMMENTARY_COOLDOWN = 3000; // ms minimum between tier-2/3 lines
const firedCommentaryKeys = new Set(); // track all fired keys

// Pre-create commentary audio element once — iOS requires unlock before async use
let _commentaryAudio = null;
function _getCommentaryAudio() {
  if(!_commentaryAudio) {
    _commentaryAudio = new Audio();
    _commentaryAudio.preload = "none";
    // Register for master unlock
    if(!window._commentaryPool) window._commentaryPool = [];
    window._commentaryPool.push(_commentaryAudio);
  }
  return _commentaryAudio;
}

async function speakLine(text) {
  if(!commentaryEnabled) return;
  lastCommentaryTime = Date.now();
  try {
    const res = await fetch(EL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if(!res.ok) { commentaryPlaying=false; drainQueue(); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    // Reuse pre-unlocked audio element
    const audio = _getCommentaryAudio();
    audio.src = url;
    audio.volume = 0.85;
    commentaryPlaying = true;
    audio.onended = () => {
      commentaryPlaying = false;
      URL.revokeObjectURL(url);
      drainQueue();
    };
    audio.onerror = () => { commentaryPlaying=false; drainQueue(); };
    audio.load(); // iOS requires load() after src change
    audio.play().catch(() => {
      // Still blocked — queue for next gesture
      pendingAudio = audio;
      commentaryPlaying = false;
      const retry = () => {
        if(pendingAudio){ pendingAudio.play().catch(()=>{}); pendingAudio=null; }
      };
      window.addEventListener("touchstart", retry, {once:true, passive:true});
      window.addEventListener("click",      retry, {once:true, passive:true});
    });
  } catch(e) {
    commentaryPlaying = false;
    drainQueue();
  }
}

// Pending audio for autoplay unlock
let pendingAudio = null;

function drainQueue() {
  if(commentaryQueue.length === 0) { commentaryPlaying=false; return; }
  const next = commentaryQueue.shift();
  speakLine(next);
}

function resetCommentaryForRace(raceId) {
  if(_lastRaceId !== raceId) {
    _lastRaceId = raceId;
    firedCommentaryKeys.clear();
    commentaryQueue = [];
    commentaryPlaying = false;
  }
}

// tier 1 = always plays (winner, upset, tiebreak, final stretch)
// tier 2 = plays only if nothing playing + cooldown elapsed (doubles, big lead, weather)
// tier 3 = plays only if completely silent + cooldown elapsed (early leader, midrace)
function queueCommentary(text, tier=2) {
  if(!commentaryEnabled) return;
  const now = Date.now();

  if(tier === 1) {
    // Always plays — clear queue, wait for current line to finish then play
    commentaryQueue = [text];
    if(!commentaryPlaying) drainQueue();
    // If playing, it will drain after current line ends
  } else if(tier === 2) {
    // Only if nothing playing and cooldown elapsed
    if(!commentaryPlaying && now - lastCommentaryTime > COMMENTARY_COOLDOWN) {
      commentaryQueue = [text];
      drainQueue();
    }
    // Otherwise drop it — stale commentary is worse than no commentary
  } else {
    // tier 3 — only if completely silent and cooldown elapsed
    if(!commentaryPlaying && commentaryQueue.length === 0 && now - lastCommentaryTime > COMMENTARY_COOLDOWN) {
      commentaryQueue = [text];
      drainQueue();
    }
  }
}


// Commentary line generators
const COMMENTARY = {
  gatesOpen: (horses) => pick([
    `AND THEY ARE OFF — ${horses[0]} and ${horses[1]} break from the gate!`,
    `The gates fly open and six horses thunder down the track!`,
    `They are racing! A clean break for the entire field!`,
    `Off and running at The Track — and what a start it is!`,
    `The starter's gun fires — and they are away!`,
  ]),
  earlyLeader: (name) => pick([
    `${name} grabs the early lead and is setting the pace!`,
    `It is ${name} out front after those opening exchanges!`,
    `${name} has broken well and already commands the field!`,
    `Watch out for ${name} — already clear of the field!`,
    `Early doors and ${name} means business — right to the front!`,
  ]),
  bigLead: (name) => pick([
    `${name} is pulling away — opening up a significant lead!`,
    `Look at ${name} go — leaving the field behind!`,
    `This could be over early — ${name} is flying out in front!`,
    `${name} is in a different race right now — absolutely dominant!`,
    `Three lengths clear — ${name} is in control of this race!`,
  ]),
  midraceClose: (a, b) => pick([
    `${a} and ${b} are inseparable at the halfway mark — this is a real race!`,
    `Neck and neck — ${a} leads by a whisker over ${b}!`,
    `Too close to call at the midpoint — ${a} and ${b} refusing to yield!`,
    `What a battle — ${a}, ${b}, and the field are bunched together!`,
    `Halfway home and the lead keeps changing — this one is far from over!`,
  ]),
  doubles: (name) => pick([
    `Doubles! ${name} rolls a pair and surges forward — what a roll!`,
    `${name} hits the double — a huge moment in this race!`,
    `Doubles for ${name}! That is two spaces in one throw — gaining ground fast!`,
    `${name} with the doubles — a big move right through the field!`,
    `The dice show doubles — and ${name} takes full advantage!`,
  ]),
  hurdle: (name) => pick([
    `${name} clears the hurdle without breaking stride — beautiful!`,
    `Over the obstacle goes ${name} — clean as a whistle!`,
    `${name} sails over the hurdle and stays right in contention!`,
    `The hurdle is no problem for ${name} — not missing a beat!`,
    `${name} takes the hurdle in stride — class showing there!`,
  ]),
  raceWelcome: (name) => pick([
    `Welcome to the ${name} — bets are now locked, thirty seconds to post!`,
    `The ${name} is up next — bets are closed, let's see who's in contention!`,
    `Ladies and gentlemen, the ${name} — final odds are now on the board!`,
    `We're thirty seconds from the off in the ${name} — this one looks wide open!`,
    `The field is set for the ${name} — thirty seconds and counting!`,
  ]),
  betsClosing: () => pick([
    `Bets are closing — five seconds to get your money down!`,
    `Final five seconds — place your bets now or forever hold your peace!`,
    `The window is closing — five, four, three, two, one — bets are locked!`,
    `Last chance to bet — five seconds on the clock!`,
    `Five seconds to betting close — make your move!`,
  ]),
  hurdleDoubles: (name) => pick([
    `Doubles AND the hurdle — ${name} clears it in one spectacular move!`,
    `${name} rolls doubles right at the hurdle — flies straight over!`,
    `What timing — doubles for ${name} and straight over the obstacle!`,
    `${name} hits doubles at exactly the right moment — clears the hurdle with ease!`,
  ]),
  finalStretch: (name) => pick([
    `Down the stretch they come — ${name} in front with the line approaching!`,
    `Into the final stages — ${name} leads but nothing is settled yet!`,
    `Here they come for home — ${name} out front but the field is closing!`,
    `This is where it counts — ${name} digging deep in the final stretch!`,
    `The finish line is in sight — ${name} is fighting for glory!`,
  ]),
  turnaround: (name) => pick([
    `${name} makes the turn — heading for home now!`,
    `${name} rounds the bend and starts the journey back — still in this!`,
    `The turnaround — ${name} is first to start the return leg!`,
    `${name} hits the top of the track and wheels for home — great position!`,
  ]),
  photoFinish: (a, b) => pick([
    `${a} and ${b} — we are going to need a photo finish!`,
    `Too close to call at the wire — ${a} and ${b} in a dead heat!`,
    `The stewards will be reviewing this one — ${a} and ${b} together!`,
    `I cannot separate them — ${a} and ${b} hit the line as one!`,
  ]),
  winner: (name, odds) => pick([
    `${name} wins it! Paying ${odds} to one — a fantastic performance!`,
    `And the winner is ${name}! ${odds} to one — what a race that was!`,
    `${name} takes The Track! Paying ${odds} to one — congratulations!`,
    `${name} crosses first at ${odds} to one — the bettors who backed that horse are celebrating!`,
    `It is all over — ${name} wins! ${odds} to one pays out — superb!`,
  ]),
  upset: (name, odds) => pick([
    `Unbelievable — ${name} at ${odds} to one wins this race! What an upset!`,
    `The longshot lands! ${name} at ${odds} to one — nobody saw that coming!`,
    `${name} with a massive upset at ${odds} to one — extraordinary scenes!`,
    `The form book is torn up — ${name} at ${odds} to one takes it all!`,
    `A shock result — ${name} at ${odds} to one! The crowd cannot believe it!`,
  ]),
  weather: (condition, name) => condition==="fog" ? pick([
    `${name} loses footing in the fog — slides back!`,
    `The fog claims ${name} — slipping on the track!`,
    `Treacherous conditions — ${name} slides backwards!`,
    `${name} caught out by the fog — loses a space!`,
  ]) : pick([
    `The rain is causing havoc — ${name} splashes through the mud!`,
    `Heavy going out there — ${name} battling the conditions!`,
    `Rain affects ${name} — this weather is changing everything!`,
    `Mud and rain — ${name} is struggling in these conditions!`,
  ]),
  tiebreak: () => pick([
    `We have a dead heat — the tiebreaker is on! Everything to play for!`,
    `The judges call for a tiebreaker — neither horse will give way!`,
    `A tie at the line — back they go for the tiebreaker race!`,
    `We cannot be separated — into extra time we go!`,
  ]),
  wireToWire: (name) => pick([
    `${name} was never headed — wire to wire, an absolutely dominant performance!`,
    `From start to finish — ${name} led every step of the way. Magnificent!`,
    `Wire to wire — ${name} made this look easy from the opening gate!`,
    `Unchallenged from flag to finish — ${name} wins it wire to wire!`,
  ]),
  comeback: (name) => pick([
    `What a story — ${name} was at the back of the pack and has come through to win it!`,
    `From last to first — ${name} with an extraordinary comeback victory!`,
    `They said it couldn't be done — ${name} proves everyone wrong with a stunning finish!`,
    `The comeback is complete — ${name} from the rear of the field to the winner's enclosure!`,
  ]),
  onFire: (name) => pick([
    `${name} is on fire — three straight rolls hitting that number — this horse is HOT!`,
    `Watch out for ${name} — rolling hot, three in a row — absolutely on fire!`,
    `${name} cannot be stopped right now — on fire and eating up the ground!`,
    `The dice are falling perfectly for ${name} — three consecutive hits — on fire!`,
  ]),
  fogSlide: (name) => pick([
    `The fog costs ${name} — slides back a space in these treacherous conditions!`,
    `Visibility is zero and ${name} pays the price — slipping back in the fog!`,
    `${name} loses ground to the fog — a cruel blow in this weather!`,
    `The fog rolls in and ${name} is the victim — slides backwards!`,
  ]),
  mudStuck: (name) => pick([
    `${name} is stuck in the mud — cannot find any footing on this heavy ground!`,
    `Heavy going for ${name} — the rain has made this track a real test!`,
    `${name} struggles in the conditions — the mud is taking its toll!`,
    `No movement for ${name} — the rain-soaked track is holding them back!`,
  ]),
  doubleDoubles: (name) => pick([
    `Doubles again for ${name} — this horse is rolling hot today!`,
    `Another doubles! ${name} cannot stop rolling pairs — extraordinary luck!`,
    `${name} hits doubles for the second time — the dice gods are smiling!`,
    `Back to back doubles for ${name} — this is remarkable!`,
  ]),
  lastToFirst: (name) => pick([
    `Extraordinary — ${name} has gone from last to first in a single throw!`,
    `From the back to the front in one roll — ${name} with a stunning move!`,
    `One roll changes everything — ${name} rockets from last to lead!`,
    `${name} was stone last and now leads — what a dramatic swing!`,
  ]),
  tightField: () => pick([
    `You couldn't throw a rug over this field — all six horses blanketed together!`,
    `The entire field is inseparable — this race is truly anyone's to win!`,
    `Six horses, barely a length between them — what a race this is turning out to be!`,
    `Blanketed — every horse in contention, nothing to choose between them!`,
  ]),
  slowPace: () => pick([
    `A cautious early pace — nobody wants to show their hand just yet!`,
    `Tactical early stages — the field is taking its time through these opening rolls!`,
    `Slow early fractions — this race is being set up for a sprint finish!`,
    `No one wants to commit early — a patient race developing here!`,
  ]),
  magicDice: (name) => pick([
    `The magic dice strike — ${name} gets a wild move and shakes up this race!`,
    `Wild card! The magic dice change everything for ${name}!`,
    `${name} benefits from the magic dice — a dramatic twist in this race!`,
    `The unpredictable magic dice — and ${name} takes full advantage!`,
  ]),
  halfwayLead: (name) => pick([
    `${name} is starting to boss this race — one horse is taking control at halfway!`,
    `Halfway home and ${name} is in command — can anyone reel them in?`,
    `${name} has this race in their pocket at the halfway mark — impressive!`,
    `One horse is pulling clear — ${name} is asserting dominance at the midpoint!`,
  ]),
  tiebreakWinner: (name) => pick([
    `${name} wins the tiebreaker — settling it in extra time!`,
    `After the dead heat decider — ${name} claims the glory!`,
    `The tiebreaker goes to ${name} — what a way to settle it!`,
    `${name} holds their nerve in the tiebreaker — takes the win!`,
  ]),
};

function setCommentaryEnabled(v) {
  commentaryEnabled = v;
  setSoundEnabled(v); // keep localStorage in sync
  if(!v) { commentaryQueue=[]; commentaryPlaying=false; }
}
let musicEnabled = getMusicEnabled(); // sync with localStorage on startup
function setMusicEnabledGlobal(v) {
  musicEnabled = v;
  setMusicEnabled(v);
  window.dispatchEvent(new Event("track-music"));
  if(!v) {
    // Mute — fade all playing tracks to 0 but keep them running
    Object.keys(MUSIC_TRACKS).forEach(n=>{
      const a=_aud[n]; if(!a||a.paused) return;
      fadeAudio(a, 0, 500);
    });
  } else {
    // Unmute — restore volume of the desired track
    if(_desiredTrack) {
      const a=_aud[_desiredTrack];
      if(a && !a.paused) fadeAudio(a, MUSIC_TRACKS[_desiredTrack].targetVol, 500);
      else if(a && a.paused) { a.play().catch(()=>{}); fadeAudio(a, MUSIC_TRACKS[_desiredTrack].targetVol, 800); }
    }
  }
}

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

  bugle: () => {
    const audio = _getBugle();
    audio.currentTime = 0;
    audio.volume = 0.9;
    audio.play().catch(()=>{
      ['touchstart','click'].forEach(e=>window.addEventListener(e,()=>{
        audio.currentTime=0; audio.play().catch(()=>{});
      },{once:true,passive:true}));
    });
  },
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
function raceStatus(race, now) {
  const secsToStart = (race.startTime - now) / 1000;
  if(race.status==="finished") return "finished";
  // Completion follows the recorded history; long hurdle races must not end on a timer.
  if(secsToStart <= 0)                    return "racing";
  if(secsToStart <= BET_CLOSE_SECS)       return "locked";
  if(secsToStart <= BET_OPEN_HOURS*3600)  return "betting";
  return "upcoming";
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = `
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
  body { background:var(--track-bg); overflow-x:hidden; font-family:var(--track-ui); }
  ::-webkit-scrollbar { width:6px; background:#181a17; }
  ::-webkit-scrollbar-thumb { background:#e5b67833; border-radius:3px; }
  input { font-family:inherit; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
  @keyframes confettiFall { 0%{transform:translateY(0) rotate(0deg);opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:0} }
  @keyframes racingBlink  { 0%,100%{opacity:1} 50%{opacity:0.5} }
  @keyframes diceWiggle   { 0%,100%{transform:rotate(-15deg) scale(1.08)} 50%{transform:rotate(15deg) scale(0.93)} }
  @keyframes nameShimmer  { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
  @keyframes betPulse { 0%,100%{opacity:1} 50%{opacity:.85} }
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
    color:["#e5b678","#97bd88","#e4c48b","#d48d80","#adbba2","#b77d58"][i%6],
    size:6+Math.random()*12,
  })),[]);
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {pieces.map(p=>(
        <div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:"-20px",width:p.size,height:p.size,background:p.color,borderRadius:p.id%3===0?"50%":"2px",animation:`confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,boxShadow:"none"}}/>
      ))}
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function TrackWordmark() {
  return <span className="track-wordmark"><span className="track-mark" aria-hidden="true"><i/><i/><i/></span>The Track</span>;
}

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
    <main className="track-auth">
      <style>{GS}</style>
      <div className="track-auth-story">
        <div className="track-auth-brand"><TrackWordmark /></div>
        <div className="track-auth-title">
          <p className="track-kicker">Virtual horse racing</p>
          <h1>Every roll changes the race.</h1>
          <p>Pick your horse, watch the dice settle, and follow the field to the wire.</p>
          <a className="track-primary track-demo-link" href="?demo=1">Watch a demo race</a>
        </div>
        <p className="track-image-credit">Racehorse model by <a href="https://vinish.dev/free-3d-models/horses">vinish.dev</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · Recolored</p>
      </div>
      <div className="track-auth-form">
        <form onSubmit={e=>{e.preventDefault();go();}}>
          <div className="track-auth-tabs" aria-label="Account action">
            {[["login","Sign in"],["register","Register"]].map(([value,label])=>
              <button key={value} type="button" aria-pressed={mode===value} onClick={()=>{setMode(value);setErr("");}}>{label}</button>)}
          </div>
          <h2>{mode==="login"?"Welcome back":"Create an account"}</h2>
          {mode==="register" && <label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label>}
          <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/></label>
          <label>Password<input type="password" value={p} onChange={e=>setP(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"} required/></label>
          {err && <p className="track-auth-error" role="alert">{err}</p>}
          <button type="submit" className="track-primary" disabled={loading}>{loading?"Please wait…":mode==="login"?"Enter The Track":"Create account"}</button>
          <p className="track-auth-note">New accounts start with $1,000 in demo currency.</p>
        </form>
      </div>
    </main>
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
      <div style={{width:"100%",maxWidth:420,background:"#1a2c22",border:"1px solid rgba(229,182,120,0.15)",borderRadius:20,overflow:"hidden",boxShadow:"none",animation:"slideIn 0.15s ease-out"}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:"20px 20px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:56,height:56,borderRadius:14,background:"rgba(229,182,120,0.08)",border:"2px solid #e5b67833",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30}}>{avatar}</div>
              <div>
                <div style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:16,letterSpacing:2}}>{username}</div>
                <div style={{display:"flex",gap:16,marginTop:4}}>
                  <span style={{color:"#c4cbb7",fontSize:11}}><span style={{color:"#fff",fontWeight:700}}>{followerCount}</span> followers</span>
                  <span style={{color:"#c4cbb7",fontSize:11}}><span style={{color:"#fff",fontWeight:700}}>{followingCount}</span> following</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#c4cbb7",cursor:"pointer",width:32,height:32,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          {uid !== myUid && (
            <button onClick={handleFollow} disabled={acting} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",cursor:acting?"not-allowed":"pointer",background:isFollowing?"rgba(255,255,255,0.07)":"rgba(229,182,120,0.15)",color:isFollowing?"#c4cbb7":"#e5b678",fontFamily:"var(--track-label)",fontSize:12,letterSpacing:2,fontWeight:700,transition:"all 0.15s"}}>
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
          <div style={{fontFamily:"var(--track-label)",color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:12}}>ACTIVE RACES</div>
          {loading && <div style={{color:"#c4cbb7",textAlign:"center",padding:20}}>Loading...</div>}
          {!loading && activeBets.length===0 && <div style={{color:"#c4cbb7",textAlign:"center",padding:20,fontSize:13}}>No active bets right now</div>}
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
                    {st==="racing" && <div style={{color:"#d48d80",fontSize:11,fontFamily:"var(--track-label)",animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                    {st==="locked" && <div style={{color:"#e4c48b",fontSize:11,fontFamily:"var(--track-label)"}}>LOCKED 🔒</div>}
                    {st==="betting"&& <div style={{color:"#97bd88",fontSize:11,fontFamily:"var(--track-label)"}}>{fmtCD(secs)}</div>}
                    <div style={{color:"#e5b678",fontSize:10,marginTop:2}}>tap to view →</div>
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
          <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:1,marginBottom:4}}>FOLLOWING</div>
          <div style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:22,fontWeight:700}}>{followingCount}</div>
        </div>
        <div style={{flex:1,padding:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,textAlign:"center"}}>
          <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:1,marginBottom:4}}>FOLLOWERS</div>
          <div style={{fontFamily:"var(--track-label)",color:"#adbba2",fontSize:22,fontWeight:700}}>{followerCount}</div>
        </div>
      </div>

      {/* Search */}
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:"var(--track-label)",color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:8}}>FIND PLAYERS</div>
        <div style={{display:"flex",gap:6}}>
          <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setSearchResult(null);}}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
            placeholder="Search by username..."
            style={{flex:1,padding:"9px 12px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#fff",fontSize:13,outline:"none"}}/>
          <button onClick={handleSearch} style={{padding:"9px 16px",background:"rgba(229,182,120,0.1)",border:"1px solid #e5b67833",borderRadius:8,color:"#e5b678",cursor:"pointer",fontSize:13,fontWeight:700}}>Search</button>
        </div>
        {searchResult==="loading" && <div style={{color:"#c4cbb7",fontSize:12,marginTop:8}}>Searching...</div>}
        {searchResult==="notfound" && <div style={{color:"#d48d80",fontSize:12,marginTop:8}}>No player found with that username</div>}
        {searchResult && searchResult !== "loading" && searchResult !== "notfound" && (
          <div style={{marginTop:10,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid #e5b67822",borderRadius:10,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>{searchResult.avatar}</span>
            <span style={{color:"#fff",fontWeight:700,flex:1,fontSize:14}}>{searchResult.username}</span>
            <button onClick={()=>setViewProfile({uid:searchResult.uid,username:searchResult.username})} style={{padding:"6px 12px",background:"rgba(229,182,120,0.08)",border:"1px solid #e5b67833",borderRadius:7,color:"#e5b678",cursor:"pointer",fontSize:12}}>View</button>
          </div>
        )}
      </div>

      {/* Following list */}
      <div>
        <div style={{fontFamily:"var(--track-label)",color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:8}}>FOLLOWING</div>
        {myFriends===null && <div style={{color:"#c4cbb7",fontSize:13,textAlign:"center",padding:20}}>Loading...</div>}
        {myFriends!==null && followingCount===0 && <div style={{color:"#c4cbb7",fontSize:13,textAlign:"center",padding:"20px 0"}}>Not following anyone yet. Search for players above.</div>}
        {loadingFollowing && <div style={{color:"#c4cbb7",fontSize:12,textAlign:"center",padding:"16px 0"}}>Loading followers...</div>}
        {followingDetails.map(f=>(
          <div key={f.uid} onClick={()=>setViewProfile({uid:f.uid,username:f.username})}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,marginBottom:8,cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
            <div style={{width:44,height:44,borderRadius:12,background:"rgba(229,182,120,0.08)",border:"2px solid #e5b67822",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{f.avatar}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{f.username}</div>
              {f.activeBetCount>0
                ? <div style={{color:"#97bd88",fontSize:12,marginTop:2}}>🎫 {f.activeBetCount} active bet{f.activeBetCount>1?"s":""} · tap to view</div>
                : <div style={{color:"#c4cbb7",fontSize:12,marginTop:2}}>No active bets</div>
              }
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
              <button onClick={e=>{e.stopPropagation();setViewProfile({uid:f.uid,username:f.username});}} style={{padding:"5px 12px",background:"rgba(229,182,120,0.08)",border:"1px solid #e5b67833",borderRadius:7,color:"#e5b678",cursor:"pointer",fontSize:11,fontWeight:700}}>View →</button>
              <button onClick={e=>{e.stopPropagation();handleUnfollow(f.uid);}} style={{padding:"5px 12px",background:"rgba(212,141,128,0.06)",border:"1px solid #d48d8022",borderRadius:7,color:"#d48d80",cursor:"pointer",fontSize:11}}>Unfollow</button>
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
  const [hist,setHist] = useState(()=>getHistory().filter(h=>h.user===user.username));
  useEffect(()=>onSnapshot(doc(db,'history',user.uid),snap=>setHist(snap.exists()?snap.data().entries||[]:[])),[user.uid]);
  const totalRaces=new Set(hist.map(h=>h.raceId||h.time)).size, wins=new Set(hist.filter(h=>h.won).map(h=>h.raceId||h.time)).size;
  const totalWagered=hist.reduce((s,h)=>s+h.amount,0);
  const totalWon=hist.filter(h=>h.won).reduce((s,h)=>s+h.payout,0);
  const netPnL=totalWon-totalWagered;
  const winRate=totalRaces>0?((wins/totalRaces)*100).toFixed(1):0;
  const bestWin=hist.filter(h=>h.won).reduce((b,h)=>h.payout>b?h.payout:b,0);
  const confirmedAll=getConfirmed();
  const activeBets=Object.entries(confirmedAll).map(([raceId,data])=>{
    const race=schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId); if(!race) return null;
    const st=raceStatus(race,now); if(st==="finished") return null;
    return {race,data,st};
  }).filter(Boolean).sort((a,b)=>a.race.startTime-b.race.startTime);

  const saveAvatar=(av)=>{ const p={...profile,avatar:av}; setProfile(p); saveProfile(user.username,p); setTab("stats"); fbSaveUser(user.uid,{avatar:av}); fbSaveUserIndex(user.username, user.uid, av, user.balance); };
  const saveBio=()=>{ const p={...profile,bio:bioText}; setProfile(p); saveProfile(user.username,p); setEditBio(false); fbSaveUser(user.uid,{bio:bioText}); };
  const tabS=(id,lbl,icon)=>(
    <button onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",borderRadius:7,border:"none",cursor:"pointer",
      background:tab===id?"#e5b678":"rgba(255,255,255,0.05)",color:tab===id?"#141614":"#c4cbb7",
      fontFamily:"var(--track-label)",fontWeight:700,fontSize:10,letterSpacing:1,transition:"all 0.2s"
    }}>{icon} {lbl}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"#14251ff7",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflowY:"auto"}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:580,background:"var(--track-surface)",border:"1px solid #e5b67822",borderRadius:20,padding:28,maxHeight:"90vh",overflow:"auto",animation:"slideIn 0.2s ease-out"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <button onClick={()=>setTab("avatar")} style={{width:64,height:64,borderRadius:16,background:"rgba(229,182,120,0.08)",border:"2px solid #e5b67833",fontSize:34,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} title="Change avatar">
              {profile.avatar||"🏇"}
            </button>
            <div>
              <h2 style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:20,letterSpacing:2}}>{user.username}</h2>
              <div style={{color:"#c4cbb7",fontSize:11,marginTop:2}}>Member since {new Date(user?.joined||Date.now()).toLocaleDateString()}</div>
              <div style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:13,marginTop:3}}>${fmt2(user.balance)}</div>
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#c4cbb7",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{marginBottom:20,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10}}>
          {editBio?(
            <div>
              <textarea value={bioText} onChange={e=>setBioText(e.target.value)} maxLength={160} rows={3}
                style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid #e5b67833",borderRadius:7,color:"#fff",fontSize:16,padding:"8px 10px",outline:"none",resize:"none",fontFamily:"inherit"}}
                placeholder="Write something about yourself..."/>
              <div style={{display:"flex",gap:8,marginTop:6,justifyContent:"flex-end"}}>
                <button onClick={()=>{setEditBio(false);setBioText(profile.bio||"");}} style={{padding:"5px 14px",borderRadius:6,border:"1px solid #ffffff22",background:"transparent",color:"#c4cbb7",cursor:"pointer",fontSize:12}}>Cancel</button>
                <button onClick={saveBio} style={{padding:"5px 14px",borderRadius:6,border:"none",background:"#e5b678",color:"#141614",cursor:"pointer",fontSize:12,fontWeight:700}}>Save</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
              <p style={{color:profile.bio?"#ffffffbb":"#c4cbb7",fontSize:13,lineHeight:1.5,flex:1}}>{profile.bio||"No bio yet. Click edit to add one."}</p>
              <button onClick={()=>setEditBio(true)} style={{background:"none",border:"1px solid #ffffff22",borderRadius:6,color:"#c4cbb7",padding:"4px 10px",cursor:"pointer",fontSize:11,flexShrink:0}}>✏️ Edit</button>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:5,marginBottom:18}}>
          {tabS("stats","Stats","📊")}{tabS("bets","Active Bets","🎫")}{tabS("history","History","📋")}{tabS("friends","Friends","👥")}{tabS("avatar","Avatar","🎨")}
        </div>
        {tab==="stats"&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {[["Races",totalRaces,"#e5b678"],["Wins",wins,"#97bd88"],["Win Rate",winRate+"%","#e4c48b"],["Wagered","$"+fmt2(totalWagered),"#adbba2"],["Total Won","$"+fmt2(totalWon),"#97bd88"],["Net P&L",(netPnL>=0?"+$":"−$")+fmt2(Math.abs(netPnL)),netPnL>=0?"#97bd88":"#d48d80"],["Best Win","$"+fmt2(bestWin),"#e4c48b"],["Balance","$"+fmt2(user.balance),"#e5b678"]].map(([lbl,val,col])=>(
              <div key={lbl} style={{flex:"1 1 calc(50% - 8px)",padding:"14px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,textAlign:"center"}}>
                <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:1,marginBottom:5}}>{lbl.toUpperCase()}</div>
                <div style={{fontFamily:"var(--track-label)",color:col,fontSize:18,fontWeight:700}}>{val}</div>
              </div>
            ))}
          </div>
        )}
        {tab==="bets"&&(
          <div>
            {activeBets.length===0&&<p style={{color:"#c4cbb7",textAlign:"center",padding:"30px 0"}}>No active bets right now.</p>}
            {activeBets.map(({race,data,st})=>{
              const rt=RACE_TYPES[race.type]; const secs=Math.floor((race.startTime-now)/1000);
              return (
                <div key={race.id} style={{marginBottom:10,padding:"14px",background:"rgba(255,255,255,0.03)",border:`1px solid ${rt.color}33`,borderRadius:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div><div style={{color:"#fff",fontWeight:700}}>{rt.icon} {race.name}{race.condition&&race.condition!=="sunny"?<span style={{marginLeft:6,fontSize:12}}>{TRACK_CONDITIONS[race.condition].icon}</span>:null}</div><div style={{color:rt.color,fontSize:11}}>{rt.label}{race.condition&&race.condition!=="sunny"?<span style={{color:TRACK_CONDITIONS[race.condition].color,marginLeft:6,fontSize:10}}>{TRACK_CONDITIONS[race.condition].label}</span>:null}</div></div>
                    <div style={{textAlign:"right"}}>
                      {st==="locked"&&<div style={{color:"#d48d80",fontFamily:"var(--track-label)",fontSize:13}}>{secs}s</div>}
                      {st==="betting"&&<div style={{color:"#97bd88",fontSize:12}}>{fmtCD(secs-BET_CLOSE_SECS)} to close</div>}
                      {st==="racing"&&<div style={{color:"#d48d80",fontSize:12,animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                      <div style={{color:"#c4cbb7",fontSize:10}}>{fmtTime(new Date(race.startTime))}</div>
                    </div>
                  </div>
                  {Object.entries(data.bets||{}).map(([hid,amt])=>{
                    const h=HORSES[parseInt(hid)];
                    return <div key={hid} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:`${h.color}0a`,border:`1px solid ${h.color}22`,borderRadius:7,marginBottom:4}}>
                      <HorseName race={race} horseId={h.id} style={{color:h.color,fontWeight:700,flex:1,fontSize:13}}/>
                      <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:13}}>${fmt2(parseFloat(amt))}</span>
                    </div>;
                  })}
                  <div style={{textAlign:"right",marginTop:4}}><span style={{color:"#e5b678",fontSize:11}}>Total locked: ${fmt2(data.pot)}</span></div>
                </div>
              );
            })}
          </div>
        )}
        {tab==="history"&&(
          <div>
            {hist.length===0&&<p style={{color:"#c4cbb7",textAlign:"center",padding:"30px 0"}}>No races yet!</p>}
            {showProfileReplay && <RaceReplayScreen race={showProfileReplay} onClose={()=>setShowProfileReplay(null)}/>}
            {[...hist].reverse().map((h,i)=>{
              const horse=HORSES[h.horseId]; const rt=RACE_TYPES[h.raceType];
              return <div key={i} style={{marginBottom:6,padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${h.won?"#97bd8822":"#d48d8011"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:4,marginBottom:4,alignItems:"center"}}>
                  <span style={{color:"#e5b678",fontSize:12,fontWeight:600}}>{rt?.icon} {h.raceName||"Race"}</span>
                  {h.raceId && <button onClick={()=>{
  const found = schedule.find(r=>r.id===h.raceId)||auctionSchedule.find(r=>r.id===h.raceId);
  setShowProfileReplay(found || {id:h.raceId,name:h.raceName,type:h.raceType||"standard",horses:h.horses,condition:h.condition||"sunny",seed:h.seed,engineVersion:h.engineVersion||1,startTime:h.time||Date.now()});
}} style={{padding:"2px 8px",background:"rgba(173,187,162,0.1)",border:"1px solid #adbba233",borderRadius:6,color:"#adbba2",cursor:"pointer",fontSize:10,fontWeight:700}}>📼</button>}
                  <span style={{color:"#c4cbb7",fontSize:10}}>{new Date(h.time).toLocaleString()}</span>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{color:horse.color,fontWeight:700,fontSize:13}}>🐴 {h.horseName||horse.name}</span>
                  <span style={{color:"#c4cbb7",fontSize:12}}>Bet: <span style={{color:"#e4c48b"}}>${h.amount}</span></span>
                  {h.won?<span style={{color:"#97bd88",fontWeight:700,fontSize:13}}>✓ +${fmt2(h.payout)}</span>:<span style={{color:"#d48d80",fontSize:13}}>✗ Lost</span>}
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
            <p style={{color:"#c4cbb7",fontSize:12,marginBottom:14,textAlign:"center"}}>Choose your avatar</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center"}}>
              {AVATAR_OPTIONS.map(av=>(
                <button key={av} onClick={()=>saveAvatar(av)} style={{width:52,height:52,borderRadius:12,fontSize:26,cursor:"pointer",
                  background:(profile.avatar||"🏇")===av?"rgba(229,182,120,0.15)":"rgba(255,255,255,0.05)",
                  border:`2px solid ${(profile.avatar||"🏇")===av?"#e5b678":"rgba(255,255,255,0.1)"}`,
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
  const [roomsLoaded,setRoomsLoaded]=useState(false);

  useEffect(()=>onSnapshot(doc(db,'global','privateRaces'),snap=>{savePrivateRaces(snap.exists()?snap.data().races||{}:{});setRoomsLoaded(true);setRefresh(n=>n+1);}),[]);
  const allRaces = getPrivateRaces();
  // My races = hosted or member
  const myRaces = roomsLoaded?Object.values(allRaces).filter(r=>r.hostUsername===user.username||r.members?.[user.username]):[];
  const tick = ()=>setRefresh(r=>r+1);

  const showFlash=(msg,ok=true)=>{setFlash({msg,ok});setTimeout(()=>setFlash(null),3000);};

  const createRace=async()=>{
    if(!raceName.trim()){showFlash("Enter a race name",false);return;}
    const newCode=genRaceCode();
    const horses=pickHorseNames(newCode);
    const coats=pickHorseCoats(newCode);
    const condition = raceType==="magic_dice" ? "sunny" : selCond;
    const race={
      code:newCode, name:raceName.trim(), hostUsername:user.username,
      raceType, horses, coats, condition, seed:privateSeed(newCode), engineVersion:ENGINE_VERSION, created:Date.now(),
      started:false, startedAt:null, finished:false, winner:null,
      members:{ [user.username]:{ bets:{}, confirmed:false, joinedAt:Date.now() } }
    };
    try{await raceStore.privateRace(user,newCode,'create',race);}catch(e){showFlash(e.message,false);return;}
    setCode(newCode); setRaceName(""); setTab("browse"); tick();
    showFlash(`Race created! Code: ${newCode}`);
  };

  const joinRace=async()=>{
    const c=joinCode.trim().toUpperCase();if(!c){showFlash('Enter a race code',false);return;}
    try{await raceStore.privateRace(user,c,'join');setJoinCode('');tick();showFlash('Joined race '+c);}catch(e){showFlash(e.message,false);}
  };

  const tabS=(id,lbl,icon)=>(
    <button onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",borderRadius:7,border:"none",cursor:"pointer",
      background:tab===id?"#adbba2":"rgba(255,255,255,0.05)",color:tab===id?"#fff":"#c4cbb7",
      fontFamily:"var(--track-label)",fontWeight:700,fontSize:10,letterSpacing:1,transition:"all 0.2s"}}>{icon} {lbl}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"#14251ff7",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflowY:"auto"}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:600,background:"var(--track-surface)",border:"1px solid #adbba233",borderRadius:20,padding:28,maxHeight:"90vh",overflow:"auto",animation:"slideIn 0.2s ease-out",boxShadow:"none"}} onClick={e=>e.stopPropagation()}>
        
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div>
            <h2 style={{fontFamily:"var(--track-label)",color:"#adbba2",fontSize:18,letterSpacing:3,textShadow:"none"}}>🔒 PRIVATE RACES</h2>
            <div style={{color:"#c4cbb7",fontSize:11,marginTop:2}}>Host or join a private race with friends</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#c4cbb7",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>

        {flash&&<div style={{padding:"10px 16px",borderRadius:9,marginBottom:14,textAlign:"center",background:flash.ok?"rgba(151,189,136,0.1)":"rgba(212,141,128,0.1)",border:`1px solid ${flash.ok?"#97bd8844":"#d48d8044"}`,color:flash.ok?"#97bd88":"#d48d80",fontWeight:700,fontSize:13,animation:"slideIn 0.2s ease-out"}}>{flash.ok?"✅":"⚠️"} {flash.msg}</div>}

        <div style={{display:"flex",gap:5,marginBottom:20}}>
          {tabS("browse","My Races","🏇")}
          {tabS("create","Create","➕")}
          {tabS("join","Join","🔑")}
        </div>

        {/* BROWSE — my races */}
        {tab==="browse"&&(
          <div>
            {!roomsLoaded&&<p>Loading your private races…</p>}
            {roomsLoaded&&myRaces.length===0&&(
              <div style={{textAlign:"center",padding:"40px 0"}}>
                <div style={{fontSize:40,marginBottom:12}}>🔒</div>
                <p style={{color:"#c4cbb7",fontSize:13,marginBottom:16}}>No private races yet.</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>setTab("create")} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#adbba2",color:"#fff",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:12}}>➕ Create Race</button>
                  <button onClick={()=>setTab("join")} style={{padding:"10px 20px",borderRadius:10,border:"1px solid #adbba244",background:"rgba(173,187,162,0.08)",color:"#adbba2",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:12}}>🔑 Join Race</button>
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
              <label style={{color:"#c4cbb7",fontSize:11,letterSpacing:2}}>RACE NAME</label>
              <input value={raceName} onChange={e=>setRaceName(e.target.value)} placeholder="e.g. Friday Night Showdown"
                style={{width:"100%",marginTop:6,padding:"12px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid #adbba233",borderRadius:8,color:"#fff",fontSize:15,outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#adbba2"} onBlur={e=>e.target.style.borderColor="#adbba233"}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{color:"#c4cbb7",fontSize:11,letterSpacing:2}}>RACE TYPE</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                {Object.entries(RACE_TYPES).map(([k,rt])=>(
                  <button key={k} onClick={()=>{setRaceType(k);if(k==='magic_dice')setSelCond('sunny');}} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${raceType===k?rt.color+"88":rt.color+"22"}`,background:raceType===k?`${rt.color}18`:"rgba(255,255,255,0.03)",color:raceType===k?rt.color:"#c4cbb7",cursor:"pointer",fontSize:12,fontWeight:700,transition:"all 0.15s"}}>
                    {rt.icon} {rt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{color:"#c4cbb7",fontSize:11,letterSpacing:2}}>TRACK CONDITION</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                {Object.entries(TRACK_CONDITIONS).map(([k,cd])=>(
                  <button key={k} onClick={()=>setSelCond(k)} disabled={raceType==="magic_dice"}
                    style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${selCond===k?cd.color+"88":cd.color+"22"}`,background:selCond===k?`${cd.color}18`:"rgba(255,255,255,0.03)",color:selCond===k?cd.color:"#c4cbb7",cursor:raceType==="magic_dice"?"not-allowed":"pointer",fontSize:12,fontWeight:700,opacity:raceType==="magic_dice"?0.4:1,transition:"all 0.15s"}}>
                    {cd.icon} {cd.label}
                  </button>
                ))}
              </div>
              {raceType==="magic_dice"&&<div style={{color:"#c4cbb7",fontSize:10,marginTop:4}}>Magic Dice races are always Sunny</div>}
            </div>
            <div style={{padding:"12px 16px",background:"rgba(173,187,162,0.06)",border:"1px solid #adbba222",borderRadius:10,marginBottom:20,fontSize:12,color:"#c4cbb7",lineHeight:1.7}}>
              <div>• You become the <span style={{color:"#adbba2",fontWeight:700}}>race admin</span> — only you can start the race</div>
              <div>• Share the generated <span style={{color:"#e4c48b",fontWeight:700}}>6-character code</span> with players</div>
              <div>• Everyone places bets, then you hit Start when ready</div>
            </div>
            <button onClick={createRace} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#adbba2,#405c48)",color:"#fff",fontFamily:"var(--track-label)",fontWeight:700,fontSize:14,letterSpacing:2,boxShadow:"none"}}>
              🔒 CREATE PRIVATE RACE
            </button>
          </div>
        )}

        {/* JOIN */}
        {tab==="join"&&(
          <div>
            <label style={{color:"#c4cbb7",fontSize:11,letterSpacing:2}}>ENTER RACE CODE</label>
            <div style={{display:"flex",gap:8,marginTop:8,marginBottom:16}}>
              <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                style={{flex:1,padding:"13px 16px",background:"rgba(255,255,255,0.05)",border:"1px solid #adbba233",borderRadius:8,color:"#fff",fontSize:20,outline:"none",fontFamily:"var(--track-label)",letterSpacing:4,textAlign:"center"}}
                onFocus={e=>e.target.style.borderColor="#adbba2"} onBlur={e=>e.target.style.borderColor="#adbba233"}
                onKeyDown={e=>e.key==="Enter"&&joinRace()}/>
              <button onClick={joinRace} style={{padding:"13px 22px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#adbba2,#405c48)",color:"#fff",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>JOIN</button>
            </div>
            <p style={{color:"#c4cbb7",fontSize:12,textAlign:"center"}}>Ask the race host for their 6-character code</p>
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
  },[race.started, race.startedAt, race.finished]);

  const saveBet=(hid,val)=>{
    const n=parseFloat(val); const b={...localBets};
    if(!val||isNaN(n)||n<=0) delete b[hid]; else b[hid]=n;
    setLocalBets(b);
  };

  const confirmBets=async()=>{
    try{await raceStore.privateRace(user,race.code,'confirm',localBets);setBetting(false);onUpdate();showFlash('Bets confirmed');}
    catch(e){showFlash(e.message,false);}
  };
  const startRace=async()=>{
    try{await raceStore.privateRace(user,race.code,'start');onUpdate();}catch(e){showFlash(e.message,false);}
  };

  const totalMembers=members.length;
  const confirmedCount=members.filter(([,m])=>m.confirmed).length;
  const timerColor = countdown<=10?"#d48d80":countdown<=20?"#e4c48b":"#e5b678";

  // ── COUNTDOWN SCREEN — shown to everyone once race.started=true ──────────────
  if(race.started && !race.finished && countdown !== null) {
    const ringPct = (countdown / PRIVATE_COUNTDOWN_SECS) * 100;
    const totalPool = Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.pot)||0),0);
    return (
      <div style={{padding:"20px",background:"rgba(173,187,162,0.08)",border:"2px solid #adbba244",borderRadius:16,animation:"slideIn 0.2s ease-out"}}>
        {/* Header */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:24,marginBottom:4}}>{rt.icon}</div>
          <div style={{fontFamily:"var(--track-label)",color:"#fff",fontSize:15,letterSpacing:2}}>{race.name}</div>
          <div style={{color:"#adbba2",fontSize:11,letterSpacing:2,marginTop:2}}>PRIVATE RACE · BETS CLOSED</div>
        </div>

        {/* Countdown ring */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
          <div style={{position:"relative",width:120,height:120}}>
            <svg width="120" height="120" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke={timerColor} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*52}`}
                strokeDashoffset={`${2*Math.PI*52*(1-ringPct/100)}`}
                style={{transition:"stroke-dashoffset 1s linear, stroke 0.5s",filter:"none"}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <div style={{fontFamily:"var(--track-label)",color:timerColor,fontSize:34,fontWeight:900,lineHeight:1,textShadow:"none"}}>{countdown}</div>
              <div style={{color:"#c4cbb7",fontSize:9,letterSpacing:2,marginTop:2}}>SECS</div>
            </div>
          </div>
        </div>

        <div style={{fontFamily:"var(--track-label)",color:"#c4cbb7",fontSize:10,letterSpacing:3,textAlign:"center",marginBottom:16,animation:"racingBlink 1s infinite"}}>
          RACE STARTING SOON
        </div>

        {/* Odds — admin sees full live odds, others see blurred until ≤10s */}
        <div style={{width:"100%"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{color:"#c4cbb7",fontSize:10,letterSpacing:2}}>RACE ODDS</span>
            {isHost
              ? <span style={{color:"#e4c48b",fontSize:10}}>👑 ADMIN VIEW</span>
              : countdown>10
                ? <span style={{color:"#c4cbb7",fontSize:10}}>reveals at 10s</span>
                : <span style={{color:"#e5b678",fontSize:10}}>final odds</span>
            }
          </div>
          <div style={{filter: !isHost && countdown>10 ? "blur(6px)" : "none", transition:"filter 0.8s", userSelect: !isHost && countdown>10 ? "none":"auto"}}>
            {liveOdds.map(({h,name,odds,totalOnHorse},i)=>{
              const rank=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
              const myBetAmt = parseFloat(myBets[h.id]||0);
              return (
                <div key={h.id} style={{marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:`${h.color}0d`,border:`1px solid ${h.color}44`,borderRadius:10}}>
                    <div style={{width:30,height:30,borderRadius:"50%",background:`${h.color}18`,border:`2px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}><RunnerSilk horseId={h.id} width={30} height={30}/></div>
                    <div style={{flex:1}}>
                      <div style={{color:h.color,fontWeight:700,fontSize:13}}>{rank} {name}</div>
                      {isHost&&<div style={{color:"#c4cbb7",fontSize:10,marginTop:1}}>${fmt2(totalOnHorse)} bet total</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:16,fontWeight:900,textShadow:"none"}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                      {myBetAmt>0&&<div style={{color:"#e5b678",fontSize:10,marginTop:1}}>you: ${fmt2(myBetAmt)}</div>}
                    </div>
                  </div>
                  <div style={{height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,marginTop:2,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:2,background:h.color,width:odds?`${Math.min(100,100/odds*6)}%`:"0%",transition:"width 0.6s ease",boxShadow:"none"}}/>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Pool total */}
          <div style={{marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:8,display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"#c4cbb7",fontSize:11}}>Total pool</span>
            <span style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:13}}>${fmt2(totalPool)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{marginBottom:14,padding:"16px",background:"rgba(173,187,162,0.05)",border:`1px solid ${isHost?"#adbba244":"#ffffff18"}`,borderRadius:14,animation:"slideIn 0.2s ease-out"}}>
      {flash&&<div style={{padding:"8px 12px",borderRadius:7,marginBottom:8,textAlign:"center",background:flash.ok?"rgba(151,189,136,0.1)":"rgba(212,141,128,0.1)",border:`1px solid ${flash.ok?"#97bd8844":"#d48d8044"}`,color:flash.ok?"#97bd88":"#d48d80",fontSize:12}}>{flash.msg}</div>}
      
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{color:"#fff",fontWeight:700,fontSize:16}}>{rt.icon} {race.name}</div>
          <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
            <span style={{color:rt.color,fontSize:12,fontWeight:600}}>{rt.label}</span>
            <span style={{color:"#c4cbb7"}}>·</span>
            <span style={{color:"#adbba2",fontFamily:"var(--track-label)",fontSize:13,letterSpacing:2}}>{race.code}</span>
            {isHost&&<span style={{background:"rgba(228,196,139,0.12)",border:"1px solid #e4c48b33",borderRadius:8,padding:"1px 8px",color:"#e4c48b",fontSize:10,fontWeight:700}}>ADMIN</span>}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          {race.finished&&<span style={{color:"#c4cbb7",fontSize:12}}>FINISHED</span>}
          {race.started&&!race.finished&&<span style={{color:"#d48d80",fontSize:12,animation:"racingBlink 1s infinite"}}>LIVE 🔴</span>}
          {!race.started&&<span style={{color:"#97bd88",fontSize:12}}>WAITING</span>}
        </div>
      </div>

      {/* Race code display */}
      <div style={{padding:"8px 12px",background:"rgba(228,196,139,0.06)",border:"1px solid #e4c48b22",borderRadius:8,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#c4cbb7",fontSize:11}}>Share code:</span>
        <span style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:20,letterSpacing:6,fontWeight:900}}>{race.code}</span>
        <button onClick={()=>{navigator.clipboard?.writeText(race.code);showFlash("Code copied!");}} style={{background:"rgba(228,196,139,0.1)",border:"1px solid #e4c48b33",borderRadius:6,color:"#e4c48b",padding:"4px 10px",cursor:"pointer",fontSize:11}}>Copy</button>
      </div>

      {/* Members */}
      <div style={{marginBottom:12}}>
        <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:6}}>{totalMembers} MEMBER{totalMembers!==1?"S":""} · {confirmedCount} CONFIRMED</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {members.map(([uname,m])=>(
            <div key={uname} style={{padding:"4px 10px",borderRadius:20,background:m.confirmed?"rgba(151,189,136,0.1)":"rgba(255,255,255,0.05)",border:`1px solid ${m.confirmed?"#97bd8833":"#ffffff18"}`,display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:11}}>{getProfile(uname).avatar||"🏇"}</span>
              <span style={{color:m.confirmed?"#97bd88":"#c4cbb7",fontSize:11,fontWeight:600}}>{uname}</span>
              {uname===race.hostUsername&&<span style={{color:"#e4c48b",fontSize:9}}>★</span>}
              {m.confirmed&&<span style={{color:"#97bd88",fontSize:9}}>✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Horses */}
      <div style={{marginBottom:12}}>
        <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:6}}>HORSES IN THIS RACE</div>
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
        <div style={{marginBottom:12,padding:"12px",background:"rgba(228,196,139,0.04)",border:"1px solid #e4c48b22",borderRadius:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{color:"#e4c48b",fontSize:10,letterSpacing:2}}>👑 LIVE ODDS</span>
            <span style={{color:"#c4cbb7",fontSize:10}}>${fmt2(Object.values(race.members||{}).reduce((s,m)=>s+(parseFloat(m.pot)||0),0))} pool</span>
          </div>
          {liveOdds.map(({h,name,odds,totalOnHorse},i)=>{
            const rank=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
            return (
              <div key={h.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",marginBottom:4,background:`${h.color}0a`,border:`1px solid ${h.color}22`,borderRadius:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:h.color,flexShrink:0}}/>
                <span style={{flex:1,color:h.color,fontWeight:700,fontSize:12}}>{rank} {name}</span>
                <span style={{color:"#c4cbb7",fontSize:11,marginRight:8}}>${fmt2(totalOnHorse)} on</span>
                <span style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:14,fontWeight:900}}>{odds?`${odds.toFixed(2)}x`:"—"}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* My bets */}
      {race.finished&&<button className="track-primary" onClick={()=>onLaunch(race)}>View private race result</button>}
      {!race.started&&(
        <div>
          {!betting&&(
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!confirmed?(
                <button onClick={()=>setBetting(true)} style={{flex:1,padding:"10px",borderRadius:9,border:"1px solid #adbba244",background:"rgba(173,187,162,0.08)",color:"#adbba2",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:12}}>
                  🎫 Place Bets
                </button>
              ):(
                <div style={{flex:1,padding:"10px",borderRadius:9,background:"rgba(151,189,136,0.07)",border:"1px solid #97bd8833",textAlign:"center"}}>
                  <span style={{color:"#97bd88",fontWeight:700,fontSize:12}}>✓ Bets Confirmed — ${fmt2(Object.values(myBets).reduce((s,v)=>s+(parseFloat(v)||0),0))}</span>
                  <button onClick={()=>{setBetting(true);}} style={{marginLeft:10,background:"none",border:"1px solid #ffffff22",borderRadius:5,color:"#c4cbb7",padding:"2px 8px",cursor:"pointer",fontSize:10}}>Edit</button>
                </div>
              )}
              {isHost&&!race.started&&(
                <button onClick={startRace} style={{padding:"10px 18px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#d48d80,#b77d58)",color:"#fff",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:12,boxShadow:"none"}}>
                  🏁 START RACE
                </button>
              )}
            </div>
          )}
          {betting&&(
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,padding:"12px"}}>
              <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:8}}>PLACE YOUR BETS {race.started?"(RACE STARTED — BETS CLOSED)":""}</div>
              {HORSES.map((h,i)=>{
                const name=race.horses?.[i]||h.name;
                const val=localBets[h.id]||"";
                return (
                  <div key={h.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:h.color,flexShrink:0}}/>
                    <span style={{flex:1,color:h.color,fontWeight:600,fontSize:13}}>{name}</span>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#e4c48b",fontSize:12,pointerEvents:"none"}}>$</span>
                      <input type="number" min="0" placeholder="0" value={val} onChange={e=>saveBet(h.id,e.target.value)}
                        style={{width:80,padding:"6px 6px 6px 18px",background:"rgba(255,255,255,0.07)",border:"1px solid #ffffff18",borderRadius:6,color:"#fff",fontSize:16,outline:"none"}}/>
                    </div>
                  </div>
                );
              })}
              <div style={{display:"flex",gap:8,marginTop:10}}>
                <button onClick={()=>setBetting(false)} style={{flex:1,padding:"9px",borderRadius:7,border:"1px solid #ffffff22",background:"transparent",color:"#c4cbb7",cursor:"pointer",fontSize:12}}>Cancel</button>
                <button onClick={confirmBets} style={{flex:2,padding:"9px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#e5b678,#97bd88)",color:"#141614",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:12,letterSpacing:1}}>🔒 CONFIRM BETS</button>
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

  const bankBusy=useRef(false);
  const transfer=async(type,amount)=>{
    if(bankBusy.current)return;bankBusy.current=true;
    try{const result=await raceStore.bankTransfer(user,type,amount,crypto.randomUUID());setTxs(result.txs);setAmount('');sfx.deposit();showFlash('$'+fmt2(Number(amount))+' '+(type==='deposit'?'deposited':'withdrawn')+' successfully');}
    catch(e){showFlash(e.message||'Bank transaction failed',false);}finally{bankBusy.current=false;}
  };
  const doDeposit=amt=>transfer('deposit',amt);
  const doWithdraw=amt=>transfer('withdraw',amt);

  const DEPOSIT_PRESETS  = [100, 250, 500, 1000, 2500, 5000];
  const WITHDRAW_PRESETS = [50, 100, 250, 500, "All"];

  const tabBtn = (id, label, icon) => (
    <button onClick={()=>{setTab(id);setAmount("");setFlash(null);}} style={{
      flex:1, padding:"10px 8px", borderRadius:8, border:"none", cursor:"pointer",
      background: tab===id ? "#e5b678" : "rgba(255,255,255,0.05)",
      color: tab===id ? "#141614" : "#c4cbb7",
      fontFamily:"var(--track-label)", fontWeight:700, fontSize:11, letterSpacing:1,
      transition:"all 0.2s",
    }}>{icon} {label}</button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"#14251ff7",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:520,background:"var(--track-surface)",border:"1px solid #e4c48b33",borderRadius:20,padding:28,maxHeight:"88vh",overflow:"auto",animation:"slideIn 0.2s ease-out",boxShadow:"none"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div>
            <h2 style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:18,letterSpacing:3,textShadow:"none"}}>🏦 MY BANK</h2>
            <div style={{color:"#c4cbb7",fontSize:11,marginTop:3,letterSpacing:1}}>{user.username.toUpperCase()} · DEMO ACCOUNT</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#c4cbb7",fontSize:24,cursor:"pointer"}}>✕</button>
        </div>

        {/* Big balance */}
        <div style={{textAlign:"center",marginBottom:24,padding:"20px",background:"rgba(228,196,139,0.06)",border:"1px solid #e4c48b33",borderRadius:14}}>
          <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:3,marginBottom:4}}>AVAILABLE BALANCE</div>
          <div style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:42,fontWeight:900,textShadow:"none",lineHeight:1}}>${fmt2(user.balance)}</div>
          <div style={{marginTop:8,display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
            <span style={{color:"#97bd88",fontSize:12}}>▲ ${fmt2(totalDeposited)} deposited</span>
            <span style={{color:"#d48d80",fontSize:12}}>▼ ${fmt2(totalWithdrawn)} withdrawn</span>
            <span style={{color:netPnL>=0?"#97bd88":"#d48d80",fontSize:12,fontWeight:700}}>{netPnL>=0?"▲":"▼"} ${fmt2(Math.abs(netPnL))} betting P&L</span>
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
            background:flash.ok?"rgba(151,189,136,0.1)":"rgba(212,141,128,0.1)",
            border:`1px solid ${flash.ok?"#97bd8844":"#d48d8044"}`,
            color:flash.ok?"#97bd88":"#d48d80",fontWeight:700,fontSize:13,
            animation:"slideIn 0.2s ease-out"
          }}>{flash.ok?"✅":"⚠️"} {flash.msg}</div>
        )}

        {/* ── SUMMARY TAB ── */}
        {tab==="summary" && (
          <div>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              {[
                ["Starting Balance","$"+fmt2(startingBalance),"#e5b678"],
                ["Total Deposited","$"+fmt2(totalDeposited),"#97bd88"],
                ["Total Withdrawn","$"+fmt2(totalWithdrawn),"#d48d80"],
                ["Betting P&L",(netPnL>=0?"+":"-")+"$"+fmt2(Math.abs(netPnL)),netPnL>=0?"#97bd88":"#d48d80"],
              ].map(([lbl,val,col])=>(
                <div key={lbl} style={{flex:"1 1 45%",padding:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0d",borderRadius:10,textAlign:"center"}}>
                  <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:1,marginBottom:4}}>{lbl}</div>
                  <div style={{fontFamily:"var(--track-label)",color:col,fontSize:16,fontWeight:700}}>{val}</div>
                </div>
              ))}
            </div>
            {txs.length===0 ? (
              <p style={{color:"#c4cbb7",textAlign:"center",padding:"30px 0",fontSize:13}}>No transactions yet.</p>
            ) : (
              <div>
                <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:8}}>RECENT TRANSACTIONS</div>
                {txs.map((tx,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:5,background:"rgba(255,255,255,0.02)",border:"1px solid #ffffff08",borderRadius:9}}>
                    <span style={{fontSize:18}}>{tx.type==="deposit"?"💳":"💸"}</span>
                    <div style={{flex:1}}>
                      <div style={{color:"#fff",fontWeight:600,fontSize:13,textTransform:"capitalize"}}>{tx.type}</div>
                      <div style={{color:"#c4cbb7",fontSize:11}}>{new Date(tx.ts??tx.time).toLocaleString()}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"var(--track-label)",color:tx.type==="deposit"?"#97bd88":"#d48d80",fontSize:14,fontWeight:700}}>{tx.type==="deposit"?"+":"-"}${fmt2(tx.amount)}</div>
                      <div style={{color:"#c4cbb7",fontSize:11}}>bal: ${fmt2(tx.balance)}</div>
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
            <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:2,marginBottom:12}}>QUICK DEPOSIT</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {DEPOSIT_PRESETS.map(amt=>(
                <button key={amt} onClick={()=>doDeposit(amt)} style={{flex:"1 1 calc(33% - 8px)",padding:"12px 8px",borderRadius:10,border:"1px solid #e4c48b33",background:"rgba(228,196,139,0.07)",color:"#e4c48b",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:13,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(228,196,139,0.15)";e.currentTarget.style.borderColor="#e4c48b66";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(228,196,139,0.07)";e.currentTarget.style.borderColor="#e4c48b33";}}
                >+${fmt2(amt)}</button>
              ))}
            </div>
            <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:2,marginBottom:8}}>CUSTOM AMOUNT</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#e4c48b",fontSize:16,pointerEvents:"none"}}>$</span>
                <input type="number" min="1" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doDeposit(amount)}
                  style={{width:"100%",padding:"13px 12px 13px 28px",background:"rgba(255,255,255,0.05)",border:"1px solid #e4c48b33",borderRadius:10,color:"#fff",fontSize:16,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="#e4c48b"} onBlur={e=>e.target.style.borderColor="#e4c48b33"}/>
              </div>
              <button onClick={()=>doDeposit(amount)} style={{padding:"13px 22px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#e4c48b,#ff9500)",color:"#141614",fontFamily:"var(--track-label)",fontWeight:700,fontSize:13,letterSpacing:2,whiteSpace:"nowrap"}}>DEPOSIT</button>
            </div>
            <p style={{color:"#c4cbb7",fontSize:11,marginTop:10,textAlign:"center"}}>Demo currency only — no real money involved</p>
          </div>
        )}

        {/* ── WITHDRAW TAB ── */}
        {tab==="withdraw" && (
          <div>
            <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:2,marginBottom:12}}>QUICK WITHDRAW</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {WITHDRAW_PRESETS.map(amt=>(
                <button key={amt} onClick={()=>doWithdraw(amt==="All"?user.balance:amt)} style={{flex:"1 1 calc(33% - 8px)",padding:"12px 8px",borderRadius:10,border:"1px solid #d48d8033",background:"rgba(212,141,128,0.07)",color:"#d48d80",cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700,fontSize:13,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(212,141,128,0.15)";e.currentTarget.style.borderColor="#d48d8066";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(212,141,128,0.07)";e.currentTarget.style.borderColor="#d48d8033";}}
                >{amt==="All"?"ALL":"-$"+fmt2(amt)}</button>
              ))}
            </div>
            <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:2,marginBottom:8}}>CUSTOM AMOUNT</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#d48d80",fontSize:16,pointerEvents:"none"}}>$</span>
                <input type="number" min="1" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doWithdraw(amount)}
                  style={{width:"100%",padding:"13px 12px 13px 28px",background:"rgba(255,255,255,0.05)",border:"1px solid #d48d8033",borderRadius:10,color:"#fff",fontSize:16,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="#d48d80"} onBlur={e=>e.target.style.borderColor="#d48d8033"}/>
              </div>
              <button onClick={()=>doWithdraw(amount)} style={{padding:"13px 22px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#d48d80,#b77d58)",color:"#fff",fontFamily:"var(--track-label)",fontWeight:700,fontSize:13,letterSpacing:2,whiteSpace:"nowrap"}}>WITHDRAW</button>
            </div>
            <div style={{marginTop:14,padding:"10px 14px",background:"rgba(212,141,128,0.05)",border:"1px solid #d48d8022",borderRadius:9,display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#c4cbb7",fontSize:12}}>Available to withdraw</span>
              <span style={{fontFamily:"var(--track-label)",color:"#d48d80",fontSize:14}}>${fmt2(user.balance)}</span>
            </div>
            <p style={{color:"#c4cbb7",fontSize:11,marginTop:10,textAlign:"center"}}>Demo currency only — no real money involved</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── SOUND CONTROLS — two toggles: sfx/commentary + music ───────────────────
function MuteButton({ size=28 }) {
  const [sfxOn,   setSfxOn]   = useState(getSoundEnabled());
  const [musicOn, setMusicOn] = useState(getMusicEnabled());
  useEffect(()=>{
    const sync=()=>{setSfxOn(getSoundEnabled());setMusicOn(getMusicEnabled());};
    const events=["track-sound","track-music","storage"];
    events.forEach(event=>window.addEventListener(event,sync));
    return()=>events.forEach(event=>window.removeEventListener(event,sync));
  },[]);

  const toggleSfx = () => {
    const v = !sfxOn;
    setSfxOn(v);
    setSoundEnabled(v);
    setCommentaryEnabled(v);
    if(v) sfx.betConfirm();
  };

  const toggleMusic = () => {
    const v = !musicOn;
    setMusicOn(v);
    setMusicEnabled(v);
    setMusicEnabledGlobal(v);
  };

  const btnStyle = (active) => ({
    width:size, height:size, borderRadius:7,
    border:`1px solid ${active?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.08)"}`,
    background: active?"rgba(255,255,255,0.10)":"rgba(255,255,255,0.03)",
    cursor:"pointer", fontSize:size*0.48,
    display:"flex", alignItems:"center", justifyContent:"center",
    transition:"all 0.15s", opacity: active?1:0.45,
  });

  return (
    <div style={{display:"flex",gap:4}}>
      <button onClick={toggleSfx}   title={sfxOn?"Mute sound & commentary":"Unmute sound & commentary"} style={btnStyle(sfxOn)}>
        {sfxOn?"🔊":"🔇"}
      </button>
      <button onClick={toggleMusic} title={musicOn?"Mute music":"Unmute music"} style={btnStyle(musicOn)}>
        {musicOn?"🎵":"🔕"}
      </button>
    </div>
  );
}

function MuteButton_UNUSED({ size=28 }) {
  const [on, setOn] = useState(getSoundEnabled());
  const toggle = () => {
    const v = !on; setOn(v); setSoundEnabled(v); setCommentaryEnabled(v);
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
        <span style={{color:"#c4cbb7",fontSize:9,marginLeft:2}}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,minWidth:160,background:"rgba(20,22,20,0.98)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,overflow:"hidden",boxShadow:"none",zIndex:400,animation:"slideIn 0.12s ease-out"}}>
          {items.map(({icon,label,fn,danger})=>(
            <button key={label} onClick={()=>{ setOpen(false); fn(); }} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.05)",cursor:"pointer",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.07)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:14}}>{icon}</span>
              <span style={{color:danger?"#d48d80":"#ffffffcc",fontSize:13,fontWeight:600}}>{label}</span>
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
  useEffect(()=>{ const sync=()=>setSoundOn(getSoundEnabled()); window.addEventListener("track-sound",sync); return ()=>window.removeEventListener("track-sound",sync); },[]);
  const toggleSound = () => { const v=!soundOn; setSoundOn(v); setSoundEnabled(v); setCommentaryEnabled(v); if(v) sfx.betConfirm(); };
  const [musicOn2, setMusicOn2] = useState(getMusicEnabled());
  useEffect(()=>{
    const sync=()=>setMusicOn2(getMusicEnabled());
    window.addEventListener("track-music",sync);
    window.addEventListener("storage",sync);
    return()=>{window.removeEventListener("track-music",sync);window.removeEventListener("storage",sync);};
  },[]);
  const toggleMusic2 = () => { const v=!musicOn2; setMusicOn2(v); setMusicEnabled(v); setMusicEnabledGlobal(v); };

  const closeMenu = (fn) => { setMenuOpen(false); fn && fn(); };

  if(isMobile) {
    return (
      <>
        {/* Mobile bar: logo left, balance + burger right */}
        <div className="track-nav" style={{position:"fixed",top:0,left:0,right:0,zIndex:300,background:"#14251ff7",backdropFilter:"blur(16px)",borderBottom:"1px solid #e5b67818",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",height:52}}>
          <button type="button" className="track-nav-brand" onClick={onLobby} aria-label="The Track lobby"><TrackWordmark/></button>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {/* Balance pill */}
            <button onClick={onBank} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",background:"rgba(228,196,139,0.08)",border:"1px solid #e4c48b33",borderRadius:20,cursor:"pointer"}}>
              <span style={{fontSize:12}}>🏦</span>
              <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:12}}>${fmt2(user.balance)}</span>
            </button>
            {/* Sound + Music toggles */}
            <button onClick={toggleSound} style={{width:32,height:32,borderRadius:8,background:soundOn?"rgba(255,255,255,0.10)":"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",opacity:soundOn?1:0.45}}>
              {soundOn?"🔊":"🔇"}
            </button>
            <button onClick={toggleMusic2} style={{width:32,height:32,borderRadius:8,background:musicOn2?"rgba(255,255,255,0.10)":"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",opacity:musicOn2?1:0.45}}>
              {musicOn2?"🎵":"🔕"}
            </button>
            {/* Burger */}
            <button aria-label={menuOpen?'Close menu':'Open menu'} aria-expanded={menuOpen} onClick={()=>setMenuOpen(o=>!o)} style={{position:"relative",width:36,height:36,borderRadius:8,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:16,height:2,borderRadius:1,background:"#fff",transition:"all 0.2s",
                  transform: menuOpen ? (i===0?"rotate(45deg) translate(4px,4px)":i===2?"rotate(-45deg) translate(4px,-4px)":"scaleX(0)") : "none",
                  opacity: menuOpen && i===1 ? 0 : 1,
                }}/>
              ))}
              {pendingCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#d48d80",color:"#fff",borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700}}>{pendingCount}</span>}
            </button>
          </div>
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <div style={{position:"fixed",top:52,left:0,right:0,zIndex:299,background:"rgba(20,22,20,0.98)",backdropFilter:"blur(20px)",borderBottom:"1px solid #e5b67818",padding:"8px 0",animation:"slideIn 0.15s ease-out"}}>
            {/* Profile header */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:"1px solid #ffffff08",marginBottom:4}}>
              <span style={{fontSize:22}}>{avatar}</span>
              <div>
                <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{user.username}</div>
                <div style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:11}}>${fmt2(user.balance)}</div>
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
                <span style={{color:lbl==="Sign Out"?"#d48d80":"#ffffffcc",fontSize:14,fontWeight:600,flex:1}}>{lbl}</span>
                {badge&&<span style={{background:"#d48d80",color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700}}>{badge}</span>}
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
    <div className="track-nav" style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"#14251ff5",backdropFilter:"blur(16px)",borderBottom:"1px solid #e5b67818",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",height:56,flexShrink:0,gap:8}}>
      <button type="button" className="track-nav-brand" onClick={onLobby} aria-label="The Track lobby"><TrackWordmark/></button>
      <div style={{display:"flex",alignItems:"center",gap:4,flex:1,justifyContent:"center"}}>
        {[
          ["🏠","Lobby",onLobby,null],
          ["🔨","Auction Races",onAuctions,null],
          ["🎫","Active Bets",onMyBets,pendingCount>0?pendingCount:null],
        ].map(([icon,lbl,fn,badge])=>(
          <button key={lbl} onClick={fn} style={{position:"relative",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:6,color:"#c4cbb7",padding:"5px 10px",cursor:"pointer",fontSize:12,letterSpacing:1,transition:"all 0.15s",whiteSpace:"nowrap"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.1)";e.currentTarget.style.color="#fff";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.color="#ffffff66";}}
          >
            {icon} {lbl}
            {badge&&<span style={{position:"absolute",top:-6,right:-6,background:"#d48d80",color:"#fff",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{badge}</span>}
          </button>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        {/* Balance — display only */}
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:"rgba(228,196,139,0.06)",border:"1px solid #e4c48b22",borderRadius:8}}>
          <span style={{fontSize:13}}>🏦</span>
          <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:13}}>${fmt2(user.balance)}</span>
        </div>
        <UserMenu avatar={avatar} user={user} onProfile={onProfile} onBank={onBank} onHowTo={onHowTo} onPrivateRaces={onPrivateRaces} onLogout={onLogout}/>
        <MuteButton/>
      </div>
    </div>
  );
}

// ─── MODAL WRAPPER ────────────────────────────────────────────────────────────
function Modal({ title, accent="#e5b678", onClose, children, wide }) {
  return (
    <div className="track-modal" style={{position:"fixed",inset:0,background:"#101c18ed",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:wide?680:500,background:"var(--track-surface)",border:`1px solid ${accent}33`,borderRadius:16,padding:28,maxHeight:"85vh",overflow:"auto",animation:"slideIn 0.2s ease-out"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{fontFamily:"var(--track-label)",color:accent,fontSize:17,letterSpacing:3,textShadow:"none"}}>{title}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#c4cbb7",fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
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
    <Modal title="🎫 BETS" accent="#e5b678" onClose={onClose} wide>
      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:18,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:12}}>
        {[["active","Active Bets"],["history","History"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 18px",borderRadius:8,border:"none",cursor:"pointer",background:tab===id?"rgba(229,182,120,0.15)":"rgba(255,255,255,0.04)",color:tab===id?"#e5b678":"#c4cbb7",fontFamily:"var(--track-label)",fontSize:11,letterSpacing:1,fontWeight:700,borderBottom:tab===id?"2px solid #e5b678":"2px solid transparent",transition:"all 0.15s"}}>
            {lbl}{id==="active"&&myRaces.length>0?<span style={{marginLeft:6,background:"#d48d80",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:9}}>{myRaces.length}</span>:null}
          </button>
        ))}
      </div>

      {/* Balance */}
      <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(228,196,139,0.05)",border:"1px solid #e4c48b22",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#c4cbb7",fontSize:13}}>Balance</span>
        <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:16}}>${fmt2(userBalance)}</span>
      </div>

      {/* ── ACTIVE BETS TAB ── */}
      {tab==="active" && <>
        {myRaces.length===0 && <p style={{color:"#c4cbb7",textAlign:"center",padding:40}}>No active bets. Head to the lobby to place some!</p>}
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
                      ? <span style={{background:"rgba(229,182,120,0.12)",border:"1px solid #e5b67833",borderRadius:10,padding:"1px 8px",color:"#e5b678",fontSize:10,fontWeight:700,letterSpacing:1}}>✓ LOCKED IN</span>
                      : <span style={{background:"rgba(228,196,139,0.1)",border:"1px solid #e4c48b33",borderRadius:10,padding:"1px 8px",color:"#e4c48b",fontSize:10,fontWeight:700,letterSpacing:1}}>DRAFT</span>
                    }
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  {st==="betting" && <div style={{color:"#97bd88",fontSize:12,fontFamily:"var(--track-label)"}}>OPEN — {fmtCD(secsToStart)}</div>}
                  {st==="locked"  && <div style={{color:"#e4c48b",fontSize:12,fontFamily:"var(--track-label)"}}>LOCKED 🔒</div>}
                  {st==="racing"  && <div style={{color:"#d48d80",fontSize:12,fontFamily:"var(--track-label)",animation:"racingBlink 1s infinite"}}>LIVE 🔴</div>}
                  {st==="upcoming"&& <div style={{color:"#c4cbb7",fontSize:12,fontFamily:"var(--track-label)"}}>{fmtCD(secsToStart)}</div>}
                  <div style={{color:"#c4cbb7",fontSize:11,marginTop:2}}>🕐 {fmtTime(new Date(race.startTime))}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                {Object.entries(horseBets).map(([hid,amt])=>{
                  const h=HORSES[parseInt(hid)];
                  return (
                    <div key={hid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:`1px solid ${h.color}33`}}>
                      <div style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:`${h.color}18`,border:`1.5px solid ${h.color}`,flexShrink:0}}><RunnerSilk horseId={h.id} width={30} height={30}/></div>
                      <HorseName race={race} horseId={h.id} style={{flex:1,color:h.color,fontWeight:600,fontSize:13}}/>
                      {canEdit ? (
                        <>
                          <div style={{position:"relative"}}>
                            <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#e4c48b",fontSize:13,pointerEvents:"none"}}>$</span>
                            <input type="number" min="1" value={amt} onChange={e=>updateBet(race.id,hid,e.target.value)}
                              style={{width:80,padding:"6px 6px 6px 20px",background:"rgba(255,255,255,0.07)",border:"1px solid #ffffff18",borderRadius:6,color:"#fff",fontSize:14,outline:"none"}}/>
                          </div>
                          <button onClick={()=>updateBet(race.id,hid,"")} style={{background:"rgba(212,141,128,0.15)",border:"1px solid #d48d8033",borderRadius:6,color:"#d48d80",padding:"5px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                        </>
                      ) : (
                        <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:14}}>${fmt2(parseFloat(amt))}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <span style={{color:"#c4cbb7",fontSize:12}}>Total: <span style={{color:"#e4c48b",fontFamily:"var(--track-label)"}}>${fmt2(totalBet)}</span></span>
                <div style={{display:"flex",gap:8}}>
                  {canEdit && !isConfirmed && <button onClick={()=>removeBet(race.id)} style={{background:"rgba(212,141,128,0.1)",border:"1px solid #d48d8033",borderRadius:7,color:"#d48d80",padding:"6px 12px",cursor:"pointer",fontSize:12,letterSpacing:1}}>✕ Remove</button>}
                  <button onClick={()=>{onClose();onGoToRace(race);}} style={{background:`${rt.color}18`,border:`1px solid ${rt.color}44`,borderRadius:7,color:rt.color,padding:"6px 12px",cursor:"pointer",fontSize:12,letterSpacing:1}}>View Race →</button>
                </div>
              </div>
            </div>
          );
        })}
      </>}

      {/* ── HISTORY TAB ── */}
      {tab==="history" && <>
        {history===null && <div style={{textAlign:"center",padding:40,color:"#c4cbb7"}}>Loading...</div>}
        {history!==null && historyByRace.length===0 && <div style={{textAlign:"center",padding:40,color:"#c4cbb7"}}>No race history yet.</div>}
        {history!==null && historyByRace.map((race,i)=>{
          const rt = RACE_TYPES[race.raceType] || RACE_TYPES.standard;
          const net = race.totalPayout - race.totalBet;
          return (
            <div key={i} style={{marginBottom:12,padding:"13px 16px",background:"rgba(255,255,255,0.03)",border:`1px solid ${race.won?"#97bd8833":"#d48d8022"}`,borderRadius:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{rt.icon} {race.raceName||"Race"}</div>
                  <div style={{color:rt.color,fontSize:11,fontWeight:600,marginTop:2}}>{rt.label}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"var(--track-label)",fontSize:14,fontWeight:900,color:race.won?"#97bd88":"#d48d80"}}>{race.won?`+$${fmt2(race.totalPayout)}`:"Lost"}</div>
                  <div style={{color:"#c4cbb7",fontSize:10,marginTop:2}}>{race.time ? new Date(race.time).toLocaleDateString()+' '+new Date(race.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : ""}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {race.bets.map((b,bi)=>{
                  const h=HORSES[b.horseId]||HORSES[0];
                  return (
                    <div key={bi} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:"rgba(255,255,255,0.02)",borderRadius:6,border:`1px solid ${h.color}22`}}>
                      <span style={{color:h.color,fontSize:11,fontWeight:700,flex:1}}>{b.horseName||h.name}</span>
                      <span style={{color:"#c4cbb7",fontSize:11}}>Bet ${fmt2(b.amount)}</span>
                      {b.odds&&<span style={{color:"#c4cbb7",fontSize:10}}>{b.odds}x</span>}
                      {b.won
                        ? <span style={{color:"#97bd88",fontSize:11,fontWeight:700}}>✓ +${fmt2(b.payout)}</span>
                        : <span style={{color:"#d48d80",fontSize:11}}>✗</span>
                      }
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <span style={{color:"#c4cbb7",fontSize:11}}>Total bet: <span style={{color:"#e4c48b"}}>${fmt2(race.totalBet)}</span></span>
                  <span style={{color:"#c4cbb7",fontSize:11,marginLeft:12}}>Net: <span style={{color:net>=0?"#97bd88":"#d48d80",fontWeight:700}}>{net>=0?"+":""}${fmt2(net)}</span></span>
                </div>
                {race.bets[0]?.raceId && (
                  <button onClick={()=>{
                    const raceId = race.bets[0].raceId;
                    const found = schedule.find(r=>r.id===raceId)||auctionSchedule.find(r=>r.id===raceId);
                    const entry=race.bets[0];
                    setReplayRace(found || { id:raceId, name:race.raceName, type:race.raceType||"standard", horses:entry.horses, condition:entry.condition||"sunny", seed:entry.seed, engineVersion:entry.engineVersion||1, startTime:race.time||Date.now() });
                  }} style={{padding:"4px 10px",background:"rgba(173,187,162,0.1)",border:"1px solid #adbba233",borderRadius:7,color:"#adbba2",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0}}>
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

function AuctionRaceScreen({ race, user, now, onBack, onRaceStart, confirmedBets, confirmedPot, onConfirmBets, sharedPool={} }) {
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

  // ── Auction data — real-time from Firestore ──────────────────────────────
  const [aData, setAData] = useState({owners:{},bids:{},pot:0});
  const [tab, setTab]     = useState("auction");
  const [bidAmount, setBidAmount] = useState("");
  const [bidPending, setBidPending] = useState(false);
  const [bidError, setBidError] = useState('');
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
      raceStore.finalizeAuction(race).catch(e=>console.error('Auction finalization will retry',e.code));
    };

    const tick = ()=>{
      const liveSlot = getLiveSlot();
      while(shownUpToSlot.current < liveSlot && shownUpToSlot.current < 6){
        const ended = shownUpToSlot.current;
        shownUpToSlot.current = ended + 1;
        if(ended>=0) fireAnim(ended, aData);
      }
    };

    const t = setInterval(tick, 500);
    return ()=>clearInterval(t);
  },[race.id, race.startTime, race.horseOrder, aData]);

  // Recover closed lots even when nobody watched their countdown.
  useEffect(()=>{raceStore.finalizeAuction(race).catch(e=>console.error('Auction unavailable',e.code));},[race.id,currentSlot,inOdds,raceStarted]);

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

  const doBid = async () => {
    if(bidPending)return;
    setBidPending(true);setBidError('');
    try{await raceStore.bid(user,race,currentHorseId,Number(bidAmount));setBidAmount('');sfx.betConfirm();}
    catch(e){setBidError(e.message||'Bid was not accepted');sfx.error();}
    finally{setBidPending(false);}
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
  const confirmBets=async()=>{
    const cleaned={}; let pot=0;
    Object.entries(localBets).forEach(([hid,v])=>{const n=parseFloat(v);if(n>0){cleaned[hid]=n;pot+=n;}});
    if(pot===0){sfx.error();return;}
    if(pot>user.balance+(confirmedPot||0)){sfx.error();return;}
    try{await onConfirmBets(cleaned,pot,confirmedPot||0);}catch(e){window.alert(e.message||"Unable to confirm bets");return;}
    setBetsConfirmed(true);
    sfx.betConfirm();
  };

  // ── Odds/owners reveal (same 30s window as regular races) ───────────────────
  // oddsRevealSecs: 0 when auction ends, grows to PRESENT_SECS as race approaches
  const oddsRevealSecs = Math.min(PRESENT_SECS, Math.max(0, -secsToAuctionEnd));
  const revealCount    = Math.min(6, Math.floor(oddsRevealSecs/5)+1);

  // Auto-fire race — only once, guarded by ref
  const firedRaceRef = useRef(false);
  useEffect(()=>{
    if(raceStarted && !firedRaceRef.current){
      firedRaceRef.current = true;
      onRaceStart();
    }
  },[raceStarted]);

  // Bugle + music for auction races
  const bugleFiredRef2 = useRef(false);
  const auctionMusicRef = useRef(false);
  useEffect(()=>{
    // Start music at 30s countdown
    if(secsToRaceFire <= 30 && secsToRaceFire > 0 && !auctionMusicRef.current){
      auctionMusicRef.current = true;
      startBgMusic();
    }
    // Bugle at 4 seconds
    if(secsToRaceFire <= 8 && secsToRaceFire > 0 && !bugleFiredRef2.current){
      bugleFiredRef2.current = true;
      sfx.bugle();
      fadeBgMusic(0, 3000);
    }
  },[secsToRaceFire, inOdds, raceStarted]);

  const totalBet = Object.values(localBets).reduce((sum,value)=>sum+(parseFloat(value)||0),0);
  return <AuctionView race={race} names={HORSES.map((h,id)=>race.horses?.[id]||h.name)}
    typeLabel={rt.label} conditionLabel={TRACK_CONDITIONS[race.condition]?.label||'Clear track'}
    post={fmtTime(new Date(raceFiresAt))} phase={raceStarted?'racing':inOdds?'reveal':inAuction?'auction':'upcoming'}
    tab={tab} onTab={setTab} onBack={onBack} username={user.username}
    auction={{currentSlot,currentHorseId,seconds:slotTimeLeft,opensIn:fmtCD(Math.max(0,-elapsedSecs)),
      endsIn:fmtCD(Math.max(0,secsToAuctionEnd)),firesIn:fmtCD(Math.max(0,secsToRaceFire)),
      topBid,bidEntries,canBid,iOwn,minBid:myMinBid,amount:bidAmount,pending:bidPending,error:bidError,
      onAmount:value=>{setBidAmount(value);setBidError('');},onBid:doBid,sold:soldAnim,
      owners:aData.owners||{},pot:auctionPot,order:race.horseOrder||[0,1,2,3,4,5],revealCount}}
    ticket={{bets:localBets,confirmed:betsConfirmed,total:totalBet,pool:sharedPool.totalPot||0,poolBets:sharedPool.betsPerHorse||{},
      availableBalance:user.balance+(confirmedPot||0),cashBalance:user.balance,confirmedPot:confirmedPot||0,
      onBet:(id,value)=>{saveBet(id,value);setBetsConfirmed(false);},onConfirm:confirmBets}}/>;
}

function AuctionLobbyScreen({ schedule, now, onEnterRace, sharedPot={}, onBack }) {
  const [auctions,setAuctions]=useState(getAuctions);
  useEffect(()=>onSnapshot(doc(db,'global','auctions'),snap=>setAuctions(snap.data()?.data||{})),[]);
  const confirmed=getConfirmed();
  const races=schedule.filter(r=>raceStatus(r,now)!=='finished').map(race=>{
    const opensAt=race.startTime-180000,firesAt=race.startTime+30000;
    const status=now<opensAt?'upcoming':now<race.startTime?'auction':now<firesAt?'locked':'racing';
    const deadline=status==='upcoming'?opensAt:status==='auction'?race.startTime:firesAt;
    return {...race,status,typeLabel:(RACE_TYPES[race.type]||RACE_TYPES.standard).label,
      conditionLabel:race.condition&&race.condition!=='sunny'?TRACK_CONDITIONS[race.condition]?.label:'Clear track',
      post:fmtTime(new Date(firesAt)),pot:sharedPot[race.id]?.totalPot||0,
      ownedCount:Object.values(auctions[race.id]?.owners||{}).filter(Boolean).length,
      lot:Math.min(6,Math.floor((now-opensAt)/30000)+1),ticket:confirmed[race.id]?.pot||0,confirmed:!!confirmed[race.id],
      countdown:fmtCD(Math.max(0,(deadline-now)/1000))};
  });
  return <LobbyView auction races={races} onRegularLobby={onBack} onEnterRace={row=>onEnterRace(schedule.find(r=>r.id===row.id))}/>;
}

function LobbyScreen({ schedule, now, onEnterRace, userBets, friendRaces={}, sharedPot={} }) {
  const confirmed=getConfirmed();
  const races=schedule.map(race=>{
    const status=raceStatus(race,now),secs=Math.floor((race.startTime-now)/1000);
    const ticket=confirmed[race.id];
    const draft=userBets[race.id];
    return {...race,status,typeLabel:RACE_TYPES[race.type].label,
      conditionLabel:race.condition&&race.condition!=="sunny"?TRACK_CONDITIONS[race.condition].label:"Clear track",
      post:fmtTime(new Date(race.startTime)),pot:sharedPot[race.id]?.totalPot||0,
      ticket:ticket?.pot||(draft?Object.values(draft).reduce((sum,v)=>sum+(parseFloat(v)||0),0):0),
      confirmed:!!ticket,friends:friendRaces[race.id]||0,
      countdown:fmtCD(Math.max(0,status==="betting"?secs-BET_CLOSE_SECS:secs))};
  }).filter(r=>r.status!=="finished");
  // Preserve the original schedule record; view metadata is presentation only.
  return <LobbyView races={races} onEnterRace={row=>onEnterRace(schedule.find(r=>r.id===row.id))}/>;
}

// ─── RACE DETAIL / BETTING ────────────────────────────────────────────────────
// confirmedBets: bets that have been locked in (balance already deducted)
// onConfirmBets: called once when user locks bets — just saves, no race start
// onRaceStart: called when clock hits zero
function RaceDetailScreen({ race, user, now, onBack, onConfirmBets, confirmedBets, confirmedPot, sharedPot, onRaceStart, devForceStart, onDevForceStart, chatMsgs, setChatMsgs, chatOpen, setChatOpen, chatUnread, setChatUnread }) {
  useEffect(()=>{
    // User tapped to get here — pre-unlock bugle now while we're in a gesture context
    // We can't call play() here (not sync gesture) but we can load it
    const b = _getBugle();
    b.load();
    // Start lobby music if not already in countdown/race
    startLobbyMusic();
    return ()=>{};
  },[]);
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

  const handleConfirm=async()=>{
    if(overBalance||totalBet<=0||!canBet) return;
    // Calculate the delta vs what was previously reserved
    const delta = totalBet - prevPot;
    // Only adjust balance by the difference (can be negative = refund)
    try{await onConfirmBets(localBets, totalBet, prevPot);}catch(e){window.alert(e.message||"Unable to confirm bets");return;}
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

  // Fire bugle + start music when countdown begins
  const musicStartedRef   = useRef(false);
  const betsCallFiredRef  = useRef(false);
  useEffect(()=>{
    const countdown = devForceStart ? devCountdown : Math.max(0, liveSecs);
    const betsLeft  = Math.max(0, liveSecs - BET_CLOSE_SECS); // secs until betting closes

    // Start music as soon as locked (30s countdown begins)
    if((isLocked||isRacing) && !musicStartedRef.current){
      musicStartedRef.current = true;
      startBgMusic(); // _playTrack handles crossfade internally
      // Welcome commentary when 30s countdown starts
      const wKey = race.id+'-welcome';
      if(!firedCommentaryKeys.has(wKey)) {
        firedCommentaryKeys.add(wKey);
        setTimeout(()=>queueCommentary(COMMENTARY.raceWelcome(race.name), 2), 800);
      }
    }
    // Bets closing commentary — fires when betting window has 5 seconds left
    if(betsLeft <= 5 && betsLeft > 0 && st === "betting" && !betsCallFiredRef.current) {
      betsCallFiredRef.current = true;
      queueCommentary(COMMENTARY.betsClosing(), 2);
    }
    if(betsLeft === 0) betsCallFiredRef.current = false;
    // Bugle at 8 seconds of race countdown
    if(countdown <= 8 && countdown > 0 && !bugleFiredRef.current) {
      bugleFiredRef.current = true;
      sfx.bugle();
      fadeBgMusic(0, 3000);
    }
    if(countdown === 0) bugleFiredRef.current = false;
  }, [liveSecs, devCountdown, devForceStart, isLocked, isRacing]);
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

    const timerColor = countdown<=10?"#d48d80":countdown<=20?"#e4c48b":"#e5b678";

    return (
      <div style={{minHeight:"100vh",background:"var(--track-bg)",display:"flex",flexDirection:"column",alignItems:"center",padding:"72px 16px 40px",overflowY:"auto"}}>
        {/* Race header */}
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:32,marginBottom:4}}>{rt.icon}</div>
          <h2 style={{fontFamily:"var(--track-label)",color:"#fff",fontSize:18,letterSpacing:3,marginBottom:2}}>{race.name}</h2>
          <span style={{color:rt.color,fontSize:11,fontWeight:700,letterSpacing:2}}>{rt.label.toUpperCase()}</span>
        </div>

        {/* Countdown ring */}
        <div style={{position:"relative",width:140,height:140,marginBottom:16,flexShrink:0}}>
          <svg width="140" height="140" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
            <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
            <circle cx="70" cy="70" r="60" fill="none"
              stroke={timerColor} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${2*Math.PI*60}`}
              strokeDashoffset={`${2*Math.PI*60*(1-ringPct/100)}`}
              style={{transition:"stroke-dashoffset 1s linear, stroke 0.5s",filter:"none"}}
            />
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontFamily:"var(--track-label)",color:timerColor,fontSize:38,fontWeight:900,lineHeight:1,textShadow:"none",transition:"color 0.5s"}}>{countdown}</div>
            <div style={{color:"var(--track-muted)",fontSize:9,letterSpacing:2,marginTop:2}}>SECONDS</div>
          </div>
        </div>

        <div style={{fontFamily:"var(--track-label)",color:"var(--track-muted)",fontSize:11,letterSpacing:3,marginBottom:12,animation:"racingBlink 1s infinite"}}>
          {countdown<=0?"LOADING RACE…":"BETS CLOSED — RACE STARTING"}
        </div>

        {/* Live pot display */}
        <div style={{marginBottom:20,padding:"10px 28px",background:"rgba(228,196,139,0.07)",border:"1px solid #e4c48b33",borderRadius:12,textAlign:"center"}}>
          <div style={{color:"var(--track-muted)",fontSize:10,letterSpacing:3,marginBottom:3}}>🌐 LIVE POT</div>
          <div style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:28,fontWeight:900,textShadow:"none"}}>${fmt2(spTotal||0)}</div>
        </div>

        {/* Odds reveal — stage card swipes in from right at fixed height, hangs, then list grows below */}
        <div style={{width:"100%",maxWidth:480,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{color:"var(--track-muted)",fontSize:11,letterSpacing:2}}>RACE ODDS</span>
            <span style={{color:"var(--track-muted)",fontSize:10}}>{enteredEarly?"revealing…":"final odds"}</span>
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
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",background:`${h.color}12`,border:`1px solid ${h.color}88`,borderRadius:12,boxShadow:"none"}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:`${h.color}18`,border:`2px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}><RunnerSilk horseId={h.id} width={30} height={30}/></div>
                    <div style={{flex:1}}>
                      <div style={{color:h.color,fontWeight:700,fontSize:14}}>{rank} {horseName(race,h.id)}</div>
                      <div style={{color:"var(--track-muted)",fontSize:11,marginTop:1}}>{i===0?"FAVOURITE":i===HORSES.length-1?"LONG SHOT":""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"var(--track-label)",color:odds?"#e4c48b":"#c4cbb7",fontSize:18,fontWeight:900,textShadow:"none"}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                      {myBet>0&&<div style={{color:"#e5b678",fontSize:11,marginTop:1}}>your bet: ${fmt2(parseFloat(myBet))}</div>}
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
                  <div style={{width:28,height:28,borderRadius:"50%",background:`${h.color}18`,border:`1.5px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}><RunnerSilk horseId={h.id} width={30} height={30}/></div>
                  <div style={{flex:1}}>
                    <div style={{color:h.color,fontWeight:700,fontSize:12}}>{rank} {horseName(race,h.id)}</div>
                  </div>
                  <div style={{fontFamily:"var(--track-label)",color:odds?"#e4c48b":"#c4cbb7",fontSize:15,fontWeight:900}}>{odds?`${odds.toFixed(2)}x`:"—"}</div>
                  {myBet>0&&<div style={{color:"#e5b678",fontSize:10}}>💰${fmt2(parseFloat(myBet))}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* User bets summary */}
        {Object.keys(displayBets).length>0&&(
          <div style={{width:"100%",maxWidth:480,marginTop:16,padding:"12px 16px",background:"rgba(229,182,120,0.05)",border:"1px solid #e5b67822",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:"#e5b678",fontSize:12,fontWeight:600}}>✓ Your total bet</span>
            <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:15}}>${fmt2(Object.values(displayBets).reduce((s,v)=>s+(parseFloat(v)||0),0))}</span>
          </div>
        )}

        {/* Chat — available during countdown */}
        <RaceChat raceId={race.id} user={user} msgs={chatMsgs} setMsgs={setChatMsgs} open={chatOpen} setOpen={setChatOpen} unread={chatUnread} setUnread={setChatUnread}/>
      </div>
    );
  }

  // Shared view keeps account logic above separate from the race presentation.
  return <RaceEntryView race={race} names={HORSES.map(h=>horseName(race,h.id))}
    typeLabel={rt.label} description={rt.desc} post={fmtTime(new Date(race.startTime))}
    canBet={canBet} confirmed={confirmed} bets={localBets} totalBet={totalBet}
    pot={sharedPot?.totalPot||0} availableBalance={availableBalance} overBalance={overBalance}
    countdown={fmtCD(bettingSecsLeft)} openCountdown={fmtCD(liveSecs-BET_OPEN_HOURS*3600)}
    onBack={onBack} onBet={saveBet} onConfirm={handleConfirm}/>;
}

// ─── ODDS REVEAL ──────────────────────────────────────────────────────────────
function OddsRevealScreen({ race, bets, totalPot, odds }) {
  const [count,setCount]=useState(3);
  const rt=RACE_TYPES[race.type];
  useEffect(()=>{const t=setInterval(()=>setCount(c=>Math.max(0,c-1)),1000);return()=>clearInterval(t);},[]);
  return (
    <div style={{minHeight:"100vh",background:"var(--track-bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px 40px"}}>
      <div style={{fontSize:44,marginBottom:10}}>{rt.icon}</div>
      <h1 style={{fontFamily:"var(--track-label)",color:"#e4c48b",fontSize:22,letterSpacing:4,textShadow:"none",marginBottom:4}}>{race.name}</h1>
      <p style={{color:rt.color,letterSpacing:2,marginBottom:6,fontSize:13,fontWeight:700}}>{rt.label.toUpperCase()}</p>
      <p style={{color:"#c4cbb7",marginBottom:28,letterSpacing:2,fontFamily:"var(--track-label)",fontSize:16}}>RACE STARTS IN {count}…</p>
      <div style={{width:"100%",maxWidth:460}}>
        <div style={{background:"rgba(228,196,139,0.06)",border:"1px solid #e4c48b33",borderRadius:10,padding:"12px 18px",marginBottom:16,textAlign:"center"}}>
          <span style={{color:"#c4cbb7",fontSize:12,letterSpacing:2}}>🌐 LIVE POT </span>
          <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:26,textShadow:"none"}}>${fmt2(sharedPot?.totalPot||totalPot)}</span>
        </div>
        {HORSES.map(h=>(
          <div key={h.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",marginBottom:6,background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${h.color}33`}}>
            <div style={{width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:`${h.color}15`,border:`1.5px solid ${h.color}`}}><RunnerSilk horseId={h.id} width={30} height={30}/></div>
            <span style={{flex:1,color:h.color,fontWeight:700,fontSize:14}}><HorseName race={race} horseId={h.id}/> <span style={{color:"#c4cbb7",fontSize:10,fontWeight:400}}>({getCoatName(horseCoatIndex(race,h.id))})</span></span>
            <span style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:16}}>{odds[h.id]?`${odds[h.id].toFixed(2)}x`:"—"}</span>
            {bets[h.id]>0&&<span style={{color:"#e4c48b",fontSize:12}}>your: ${bets[h.id]}</span>}
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
          <span style={{color:"#c4cbb7",fontSize:10,letterSpacing:2}}>🎯 DIE 1 = HORSE</span>
          <span style={{color:"#c4cbb7",fontSize:10,letterSpacing:2}}>📏 DIE 2 = SPACES</span>
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
              borderCol = "#e5b678";
              bgColor   = "rgba(229,182,120,0.08)";
              label     = <span style={{color:"#e5b678",fontSize:11,fontWeight:700}}>+{dv} spaces</span>;
            }
          } else {
            const horseIdx   = dv > 0 ? Math.min(dv-1, 5) : 0;
            const horseColor = HORSES[horseIdx].color;
            const isWild     = di === dice.length-1 && wildMove;
            borderCol = isWild ? "#97bd88" : horseColor;
            bgColor   = isWild ? "rgba(151,189,136,0.1)" : "rgba(255,255,255,0.06)";
            label     = isWild
              ? <span style={{color:"#97bd88",fontSize:10,letterSpacing:1,fontWeight:700}}>✨ WILD</span>
              : <span style={{color:horseColor,fontSize:11,fontWeight:700}}>{horseName(race,horseIdx).split(" ")[0]}</span>;
          }
          return (
            <div key={di} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{
                width:64, height:64, borderRadius:14,
                background: bgColor,
                border:`2.5px solid ${borderCol}`,
                boxShadow:"none",
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
            <span style={{color:"#c4cbb7",fontSize:12}}>+{m.steps}</span>
          </div>
        ))}
        {!isMagic&&isDoubles&&raceType==="hurdle"&&<div style={{padding:"5px 14px",background:"rgba(151,189,136,0.15)",border:"1px solid #97bd8866",borderRadius:20,color:"#97bd88",fontSize:13,fontWeight:700,animation:"winPulse 0.6s ease-in-out 3"}}>🌟 DOUBLES — JUMP THE HURDLE!</div>}
        {!isMagic&&isDoubles&&raceType!=="hurdle"&&<div style={{padding:"5px 12px",background:"rgba(228,196,139,0.12)",border:"1px solid #e4c48b44",borderRadius:20,color:"#e4c48b",fontSize:12,fontWeight:700}}>⚡ DOUBLES</div>}
        {!isMagic&&wildMove&&<div style={{padding:"5px 12px",background:"rgba(151,189,136,0.12)",border:"1px solid #97bd8844",borderRadius:20,color:"#97bd88",fontSize:12,fontWeight:700}}>✨ WILD +{wildMove.steps}</div>}
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
      background:"rgba(17,19,16,0.90)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      border:"1px solid rgba(255,255,255,0.10)", borderRadius:18,
      padding:"10px 18px",
      boxShadow:"none",
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
            col = di===0 ? HORSES[magicHorseIdx].color : "#e5b678";
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
              boxShadow:"none",
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
            <span style={{color:"#e5b678",fontSize:11}}>+{dice[1]}</span>
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
          <div style={{background:"rgba(228,196,139,0.1)",border:"1px solid rgba(228,196,139,0.3)",borderRadius:8,padding:"2px 8px",color:"#e4c48b",fontSize:10,fontWeight:700,alignSelf:"flex-start"}}>
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
    ctx.strokeStyle="rgba(228,196,139,0.85)"; ctx.lineWidth=1.5; ctx.stroke();

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
      ctx.fillStyle=winner===hi?"#e4c48b":h.color; ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.45)"; ctx.lineWidth=0.5; ctx.stroke();
    });
  },[positions,legDone,winner,visible]);

  return (
    <div style={{position:"fixed",bottom:16,left:12,zIndex:30,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:5}}>
      {/* Toggle button — matches chat button style */}
      <button onClick={()=>setVisible(v=>!v)} style={{
        width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.15)",
        background:"rgba(10,10,30,0.85)",backdropFilter:"blur(8px)",
        color:"#c4cbb7",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow:"none",
      }}>🏟</button>
      {/* Track panel */}
      {visible && (
        <div style={{
          borderRadius:8,overflow:"hidden",
          border:"1px solid rgba(255,255,255,0.07)",
          boxShadow:"none",
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
        if(steps < 0) {
          // Fog slide — always moves back regardless of hurdle position
          newPos[horse] = Math.max(0, newPos[horse] + steps);
        } else if(atHurdle) {
          if(isDoubles) {
            // Doubles at hurdle — jumps over
            newPos[horse] = hurdlePos + 1;
            newSkip[horse] = "jump";
          }
          // Non-doubles at hurdle — stays put (waiting for doubles)
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

            // ── COMMENTARY TRIGGERS ──────────────────────────────────────────
            // Each trigger uses its own unique key so they don't block each other
            if(phase !== "tiebreak") {
              const cRollNum = rc + 1;
              const isDownBack = raceType==="down_back";
              const isMagicDice = raceType==="magic_dice";
              const isWeather = race.condition==="rain"||race.condition==="fog";

              // DOUBLES — fire on actual dice doubles, not magic dice, not weather slide
              // Check dr.isDoubles AND that it wasn't a fog slide (fog moves backwards)
              const hasForwardMove = dr.moves.some(m=>(m.steps||0)>0);
              if(dr.isDoubles && !isMagicDice && hasForwardMove) {
                const dKey = race.id+'-dbl-'+cRollNum;
                if(!firedCommentaryKeys.has(dKey)) {
                  firedCommentaryKeys.add(dKey);
                  const mover = dr.moves.find(m=>(m.steps||0)>0)?.horse ?? dr.moves[0]?.horse ?? 0;
                  T(()=>queueCommentary(COMMENTARY.doubles(horseName(race,mover))), 350);
                }
              }
              // EARLY LEADER — rolls 2-4
              else if(cRollNum>=2 && cRollNum<=4) {
                const eKey = race.id+'-early';
                if(!firedCommentaryKeys.has(eKey)) {
                  firedCommentaryKeys.add(eKey);
                  const leader = newPos.indexOf(Math.max(...newPos));
                  const gap = Math.max(...newPos) - [...newPos].sort((a,b)=>b-a)[1];
                  if(newPos[leader]>0 && gap>=1) {
                    T(()=>queueCommentary(COMMENTARY.earlyLeader(horseName(race,leader))), 400);
                  }
                }
              }
              // BIG LEAD — any time a horse is 3+ ahead of second place
              const sortedPos = [...newPos].sort((a,b)=>b-a);
              const bigLead = sortedPos[0]-sortedPos[1] >= 3;
              if(bigLead && cRollNum>4) {
                const blKey = race.id+'-lead-'+Math.floor(cRollNum/3);
                if(!firedCommentaryKeys.has(blKey)) {
                  firedCommentaryKeys.add(blKey);
                  const leader = newPos.indexOf(Math.max(...newPos));
                  T(()=>queueCommentary(COMMENTARY.bigLead(horseName(race,leader))), 400);
                }
              }
              // MIDRACE CLOSE — around halfway mark
              const halfway = isDownBack ? TRACK_SPACES : Math.floor(TRACK_SPACES/2);
              const leaderPos = Math.max(...newPos);
              if(leaderPos >= halfway-1 && leaderPos <= halfway+1 && cRollNum>3) {
                const mKey = race.id+'-mid';
                if(!firedCommentaryKeys.has(mKey)) {
                  firedCommentaryKeys.add(mKey);
                  const sortedE = [...newPos.entries()].sort((a,b)=>b[1]-a[1]);
                  if(sortedE[0][1]-sortedE[1][1] <= 2) {
                    T(()=>queueCommentary(COMMENTARY.midraceClose(horseName(race,sortedE[0][0]),horseName(race,sortedE[1][0]))), 400);
                  }
                }
              }
              // FINAL STRETCH — leader hits space 9-10 (or space 3-4 on return leg for down_back)
              const stretchZone = isDownBack
                ? (newLeg[newPos.indexOf(Math.max(...newPos))] && Math.max(...newPos) <= 3)
                : (leaderPos >= 9 && leaderPos <= 10);
              if(stretchZone) {
                const fKey = race.id+'-final';
                if(!firedCommentaryKeys.has(fKey)) {
                  firedCommentaryKeys.add(fKey);
                  const leader3 = newPos.indexOf(Math.max(...newPos));
                  T(()=>queueCommentary(COMMENTARY.finalStretch(horseName(race,leader3))), 300);
                }
              }
              // HURDLE CLEARED
              if(raceType==="hurdle") {
                dr.moves.forEach(m=>{
                  const prevP = (newPos[m.horse]||0) - (m.steps||0);
                  if(newPos[m.horse]>HURDLE_CELL && prevP<=HURDLE_CELL) {
                    const hKey = race.id+'-hurdle-'+m.horse;
                    if(!firedCommentaryKeys.has(hKey)){
                      firedCommentaryKeys.add(hKey);
                      T(()=>queueCommentary(COMMENTARY.hurdle(horseName(race,m.horse))), 350);
                    }
                  }
                });
              }
              // TURNAROUND — down_back reaches finish line for first time
              if(isDownBack) {
                const newTurners2 = newLeg.map((l,i)=>l&&!ref.current.legDone[i]?i:-1).filter(i=>i>=0);
                newTurners2.forEach(hi=>{
                  const tKey = race.id+'-turn-'+hi;
                  if(!firedCommentaryKeys.has(tKey)){
                    firedCommentaryKeys.add(tKey);
                    T(()=>queueCommentary(COMMENTARY.turnaround(horseName(race,hi))), 300);
                  }
                });
              }
            }

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
                    T(()=>queueCommentary(COMMENTARY.tiebreak(), 1), 300);
                    T(doRoll, 2400);
                  } else {
                    ref.current.winner  = w;
                    ref.current.running = false;
                    setWinner(w);
                    sfx.finishLine();
                    // Winner commentary
                    const cWinName = horseName(race,w);
                    const cPot = Object.values(bets||{}).reduce((s,v)=>s+(parseFloat(v)||0),0);
                    const cMyBet = parseFloat(bets?.[w]||0);
                    const cOdds = cMyBet>0&&cPot>0 ? (cPot/cMyBet).toFixed(1) : (1.5+Math.random()*5).toFixed(1);
                    const cUpset = parseFloat(cOdds) >= 5;
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
      <div className="track-race-chat" style={{position:"fixed",bottom:"max(20px, env(safe-area-inset-bottom, 20px))",right:20,zIndex:200,transform:"translateZ(0)",willChange:"transform"}}>
        {open && (
          <div style={{
            position:"absolute",bottom:52,right:0,
            width:280,height:"30vh",minHeight:180,maxHeight:320,
            background:"rgba(17,19,16,0.95)",
            backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
            border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:16,
            display:"flex",flexDirection:"column",
            boxShadow:"none",
            overflow:"hidden",
          }}>
            {/* Header */}
            <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <span style={{fontFamily:"var(--track-label)",fontSize:10,letterSpacing:2,color:"#e5b678"}}>RACE CHAT</span>
              <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#c4cbb7",fontSize:14,padding:"0 2px",lineHeight:1}}>✕</button>
            </div>

            {/* Messages */}
            <div style={{flex:1,overflowY:"auto",padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
              {msgs.length===0 && (
                <div style={{color:"#c4cbb7",fontSize:11,textAlign:"center",marginTop:20,letterSpacing:1}}>No messages yet</div>
              )}
              {msgs.map(m=>{
                const isMe = m.user===(user?.username||"Guest");
                return (
                  <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start"}}>
                    <div style={{fontSize:9,color:"#c4cbb7",marginBottom:2,letterSpacing:0.5}}>
                      {isMe?"You":m.user} · {fmt(m.ts)}
                    </div>
                    <div style={{
                      maxWidth:"85%",padding:"5px 10px",borderRadius:isMe?"12px 12px 3px 12px":"12px 12px 12px 3px",
                      background:isMe?"rgba(229,182,120,0.15)":"rgba(255,255,255,0.07)",
                      border:isMe?"1px solid rgba(229,182,120,0.25)":"1px solid rgba(255,255,255,0.08)",
                      color:isMe?"#e5b678":"#ffffffcc",fontSize:12,lineHeight:1.4,wordBreak:"break-word",
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
                  background:"rgba(229,182,120,0.15)",border:"1px solid rgba(229,182,120,0.3)",
                  borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"#e5b678",
                  fontSize:13,fontWeight:700,flexShrink:0,
                }}
              >↑</button>
            </div>
          </div>
        )}

        {/* Toggle button */}
        <button
          aria-label={open?'Close race chat':'Open race chat'}
          onClick={()=>setOpen(o=>!o)}
          style={{
            width:44,height:44,borderRadius:"50%",
            background:open?"rgba(229,182,120,0.2)":"rgba(255,255,255,0.08)",
            border:open?"1px solid rgba(229,182,120,0.5)":"1px solid rgba(255,255,255,0.15)",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:18,boxShadow:"none",
            transition:"all 0.2s",position:"relative",
          }}
        >
          💬
          {!open && unread>0 && (
            <div style={{
              position:"absolute",top:-3,right:-3,
              width:16,height:16,borderRadius:"50%",
              background:"#d48d80",border:"2px solid #06060f",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:8,fontWeight:700,color:"#fff",fontFamily:"var(--track-label)",
            }}>{unread>9?"9+":unread}</div>
          )}
        </button>
      </div>
    </>
  );
}

// ─── RACE SCREEN ──────────────────────────────────────────────────────────────
function RaceScreen(props) {
  return <UnifiedRaceScreen key={props.race.id} {...props}/>;
}

function UnifiedRaceScreen({ race, user, bets, auctionOwners, onRaceEnd, isReplay, replayRolls, replayWinner, replaySpeedRef,
  chatMsgs, setChatMsgs, chatOpen, setChatOpen, chatUnread, setChatUnread }) {
  const [saved,setSaved] = useState(null);
  const [invalid,setInvalid] = useState(false);
  const [soundOn,setSoundOn] = useState(getSoundEnabled);
  const [musicAllowed,setMusicAllowed] = useState(getMusicEnabled);
  const names = HORSES.map((_, id) => horseName(race,id));
  const startTime = isReplay ? 0 : race.startTime + (race.isAuction ? 30000 : 0);
  const history = useMemo(() => isReplay ? {rolls:replayRolls,winner:replayWinner,engineVersion:race.engineVersion||1} : saved,[isReplay,replayRolls,replayWinner,race.engineVersion,saved]);

  useEffect(() => {
    if (isReplay) return;
    let active = true;
    const localHistory = () => simulateRaceWithHistory(race.type,race.condition || "sunny",race.seed,race.engineVersion);
    const accept=result=>{if(!active)return;if(buildPlayback(result,ROLL_INTERVAL,TRACK_SPACES,TIEBREAK_SPACES,broadcastVoice,race.type,race.condition))setSaved(result);else setInvalid(true);};
    if(race._privateCode){accept(localHistory());return()=>{active=false;};}
    const unsubscribe=onSnapshot(doc(db,'raceRolls',race.id),snapshot=>{if(snapshot.exists())accept(snapshot.data());},()=>{if(active)setInvalid(true);});
    return()=>{active=false;unsubscribe();};
  },[isReplay,race.id,race.type,race.condition,race.seed,race.engineVersion,race._privateCode]);

  useEffect(() => {
    stopLobbyMusic(350);
    stopBgMusic(350);
    const sync = () => {setSoundOn(getSoundEnabled());setMusicAllowed(getMusicEnabled());};
    window.addEventListener("track-sound",sync);
    window.addEventListener("track-music",sync);
    window.addEventListener("storage",sync);
    return () => { window.removeEventListener("track-sound",sync); window.removeEventListener("track-music",sync); window.removeEventListener("storage",sync); };
  },[isReplay]);

  const chatProps = { raceId:race.id,user,msgs:chatMsgs,setMsgs:setChatMsgs,open:chatOpen,setOpen:setChatOpen,unread:chatUnread,setUnread:setChatUnread };
  if (invalid || (isReplay && history && !buildPlayback(history,ROLL_INTERVAL,TRACK_SPACES,TIEBREAK_SPACES,broadcastVoice,race.type,race.condition))) return <section className="track-race-unavailable"><h1>{race.name}</h1><p>This race history is unavailable. Its recorded result is preserved.</p><button className="track-primary" onClick={()=>window.location.reload()}>Retry loading</button></section>;
  return <>
    <Broadcast {...{race,history,names,startTime,soundOn,musicAllowed}} interval={ROLL_INTERVAL} spaces={TRACK_SPACES}
      tieSpaces={TIEBREAK_SPACES} clock={gameNow} replay={isReplay} speedRef={replaySpeedRef}
      onFinish={onRaceEnd} onSound={setCommentaryEnabled} getAudioContext={getAudioCtx}
      effects={{gate:sfx.gunshot,land:sfx.diceSettle,wire:sfx.finishLine}} owners={auctionOwners} bets={bets}/>
    {user && !isReplay && <RaceChat {...chatProps}/>}
  </>;
}




// ─── PRIVATE RACE PAYOUT SCREEN ──────────────────────────────────────────────
function PrivatePayoutScreen({ race, winner, user, onLobby }) {
  const pr = getPrivateRaces()[race?._privateCode];
  if(!pr) return <div style={{color:"#fff",padding:40,textAlign:"center"}}>Race data not found.<br/><button onClick={onLobby} style={{marginTop:20,padding:"10px 20px",background:"#e5b678",border:"none",borderRadius:8,cursor:"pointer",fontFamily:"var(--track-label)",fontWeight:700}}>LOBBY</button></div>;

  const rt       = RACE_TYPES[pr.raceType]||RACE_TYPES.standard;
  const winnerH  = HORSES[winner];
  const wName    = pr.horses?.[winner]||winnerH.name;
  const results  = pr.memberResults||{};
  const members  = Object.entries(results).sort((a,b)=>(b[1].payout||0)-(a[1].payout||0));
  const totalPool= Object.values(results).reduce((s,m)=>s+(m.pot||0),0);
  const myResult = results[user?.username]||{};

  return (
    <div style={{minHeight:"100vh",background:"var(--track-bg)",display:"flex",flexDirection:"column",alignItems:"center",padding:"72px 16px 60px",overflowY:"auto"}}>
      <Confetti/>
      {/* Race label */}
      <div style={{color:"#c4cbb7",fontSize:11,letterSpacing:3,marginBottom:8}}>{rt.icon} {pr.name.toUpperCase()} · PRIVATE RACE</div>

      {/* Winner banner */}
      <div style={{textAlign:"center",marginBottom:28,padding:"24px 40px",borderRadius:18,background:`${winnerH.color}0c`,border:`2px solid ${winnerH.color}55`,boxShadow:"none",width:"100%",maxWidth:480}}>
        <div style={{fontSize:52,marginBottom:6}}>🏆</div>
        <div style={{fontFamily:"var(--track-label)",color:winnerH.color,fontSize:26,letterSpacing:3,textShadow:"none"}}>{wName}</div>
        <div style={{color:"#c4cbb7",letterSpacing:3,marginTop:4,fontSize:11}}>WINS THE RACE</div>
        <div style={{marginTop:10,color:"#c4cbb7",fontSize:12}}>Total pool: <span style={{color:"#e4c48b",fontFamily:"var(--track-label)"}}>${fmt2(totalPool)}</span></div>
      </div>

      {/* My result */}
      <div style={{width:"100%",maxWidth:480,marginBottom:20,padding:"18px",borderRadius:14,textAlign:"center",
        background:myResult.payout>0?"rgba(151,189,136,0.07)":"rgba(212,141,128,0.07)",
        border:`1px solid ${myResult.payout>0?"#97bd8833":"#d48d8033"}`}}>
        {myResult.payout>0?(
          <>
            <div style={{fontFamily:"var(--track-label)",color:"#97bd88",fontSize:22,textShadow:"none"}}>YOU WON!</div>
            <div style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:28,marginTop:6}}>+${fmt2(myResult.payout)}</div>
            <div style={{color:"#c4cbb7",marginTop:4,fontSize:13}}>from ${fmt2(myResult.pot||0)} wagered</div>
          </>
        ):(
          <>
            <div style={{fontFamily:"var(--track-label)",color:"#d48d80",fontSize:18}}>{Object.keys(myResult.bets||{}).length===0?"NO BETS PLACED":"BETTER LUCK NEXT RACE"}</div>
            {myResult.pot>0&&<div style={{color:"#c4cbb7",marginTop:6,fontSize:13}}>${fmt2(myResult.pot)} wagered · no return</div>}
          </>
        )}
      </div>

      {/* Full member breakdown */}
      <div style={{width:"100%",maxWidth:480,marginBottom:24}}>
        <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:10}}>ALL PLAYERS</div>
        {members.map(([uname,mdata],i)=>{
          const isMe = uname===user?.username;
          const prof = getProfile(uname);
          const won  = mdata.payout>0;
          return (
            <div key={uname} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:6,
              background: isMe?"rgba(229,182,120,0.06)":won?"rgba(151,189,136,0.04)":"rgba(255,255,255,0.02)",
              border:`1px solid ${isMe?"#e5b67833":won?"#97bd8822":"#ffffff0d"}`,borderRadius:11}}>
              <div style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid #ffffff18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{prof.avatar||"🏇"}</div>
              <div style={{flex:1}}>
                <div style={{color:isMe?"#e5b678":"#fff",fontWeight:700,fontSize:13}}>{uname}{isMe?" (you)":""}{uname===pr.hostUsername?" ★":""}</div>
                <div style={{color:"#c4cbb7",fontSize:11,marginTop:1}}>
                  Wagered: <span style={{color:"#e4c48b"}}>${fmt2(mdata.pot||0)}</span>
                  {Object.entries(mdata.bets||{}).length>0&&(
                    <span> · Backed: {Object.entries(mdata.bets||{}).map(([hid])=>pr.horses?.[parseInt(hid)]||HORSES[parseInt(hid)].name).join(", ")}</span>
                  )}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {won?(
                  <div style={{fontFamily:"var(--track-label)",color:"#97bd88",fontSize:15,fontWeight:700}}>+${fmt2(mdata.payout)}</div>
                ):(
                  <div style={{color:"#d48d80",fontSize:13}}>—</div>
                )}
                <div style={{color:"#c4cbb7",fontSize:10,marginTop:1}}>#{i+1}</div>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={onLobby} style={{padding:"14px 40px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#e5b678,#a27342)",color:"#141614",fontFamily:"var(--track-label)",fontWeight:700,fontSize:14,letterSpacing:3,boxShadow:"none"}}>
        BACK TO LOBBY
      </button>
    </div>
  );
}

// ─── CONFETTI PIECES (winner screen) ─────────────────────────────────────────
function ConfettiPieces({ color }) {
  const colors = [color,'#e4c48b','#d48d80','#e5b678','#97bd88','#adbba2','#b77d58','#ffffff'];
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
  const [replaying,setReplaying]=useState(false);
  return <>
    <RaceResultView race={race} names={HORSES.map(h=>horseName(race,h.id))} winner={winner}
      bets={bets} odds={odds} userBalance={userBalance} onReplay={()=>setReplaying(true)} onLobby={onLobby}/>
    {replaying&&<RaceReplayScreen race={race} onClose={()=>setReplaying(false)}/>}
  </>;
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
    <div style={{margin:"12px 0",borderRadius:10,border:"1px solid rgba(229,182,120,0.2)",background:"rgba(229,182,120,0.04)",overflow:"hidden"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"none",border:"none",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:14}}>🔐</span>
          <span style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:10,letterSpacing:2,fontWeight:700}}>PROVABLY FAIR</span>
          {isRevealed && <span style={{background:"rgba(151,189,136,0.15)",border:"1px solid #97bd8833",borderRadius:10,padding:"1px 7px",color:"#97bd88",fontSize:9,fontWeight:700,letterSpacing:1}}>REVEALED</span>}
        </div>
        <span style={{color:"#e5b678",fontSize:11}}>{open?"▲":"▼"}</span>
      </button>

      {open && (
        <div style={{padding:"0 14px 14px"}}>
          <div style={{color:"#c4cbb7",fontSize:11,lineHeight:1.6,marginBottom:10}}>
            The outcome of this race was locked in before betting opened. The seed hash below was published before any bets were placed — proving the result was never changed.
          </div>

          {/* Seed Hash — always visible */}
          <div style={{marginBottom:10}}>
            <div style={{color:"#c4cbb7",fontSize:9,letterSpacing:2,marginBottom:4}}>SEED HASH (SHA-256) — published before betting</div>
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:6,padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#e5b678",wordBreak:"break-all",letterSpacing:0.5}}>
              {seedHash}
            </div>
          </div>

          {/* Revealed Seed — only after race */}
          {isRevealed ? (
            <div style={{marginBottom:12}}>
              <div style={{color:"#c4cbb7",fontSize:9,letterSpacing:2,marginBottom:4}}>REVEALED SEED — published after race finished</div>
              <div style={{background:"rgba(0,0,0,0.3)",borderRadius:6,padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#97bd88",wordBreak:"break-all",letterSpacing:0.5}}>
                {revealedSeed}
              </div>
            </div>
          ) : (
            <div style={{marginBottom:12,padding:"8px 10px",background:"rgba(228,196,139,0.05)",border:"1px solid #e4c48b22",borderRadius:6}}>
              <span style={{color:"#e4c48b",fontSize:11}}>🔒 Seed will be revealed after the race finishes</span>
            </div>
          )}

          {/* Verify section */}
          {isRevealed && (
            <div>
              <div style={{color:"#c4cbb7",fontSize:9,letterSpacing:2,marginBottom:6}}>VERIFY — SHA-256(seed) should equal the hash above</div>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <input
                  value={verifyInput||revealedSeed}
                  onChange={e=>{setVerifyInput(e.target.value);setVerifyResult(null);}}
                  placeholder="Paste seed to verify..."
                  style={{flex:1,padding:"6px 10px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,color:"#fff",fontSize:11,fontFamily:"monospace",outline:"none"}}
                />
                <button onClick={verify} style={{padding:"6px 14px",background:"rgba(229,182,120,0.1)",border:"1px solid #e5b67833",borderRadius:6,color:"#e5b678",cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
                  Verify ✓
                </button>
              </div>
              {verifyResult === true  && <div style={{color:"#97bd88",fontSize:12,fontWeight:700}}>✓ Verified — this race was provably fair</div>}
              {verifyResult === false && <div style={{color:"#d48d80",fontSize:12,fontWeight:700}}>✗ Hash mismatch — seed does not match</div>}
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
  const [unavailable,setUnavailable] = useState(false);
  const [winner,   setWinner]   = useState(null);
  const [replayVersion,setReplayVersion] = useState(race.engineVersion||1);
  const [speed,    setSpeed]    = useState(1);
  const [finished, setFinished] = useState(false);
  const speedRef = useRef(1);

  useEffect(()=>{
    let active=true;
    setRolls(null);setUnavailable(false);setFinished(false);
    fbGetRaceRoll(race.id).then(rd=>{
      if(!active)return;
      const result=rd||(Number.isFinite(race.seed)?simulateRaceWithHistory(race.type,race.condition||'sunny',race.seed,race.engineVersion):null);
      if(result?.rolls?.length){setRolls(result.rolls);setWinner(result.winner);setReplayVersion(result.engineVersion??race.engineVersion??1);}
      else setUnavailable(true);
    }).catch(()=>{if(active)setUnavailable(true);});
    return()=>{active=false;};
  },[race.id,race.type,race.condition,race.seed,race.engineVersion]);

  const toggleSpeed = () => {
    const s = speed===1?2:1;
    setSpeed(s); speedRef.current=s;
  };

  const rt = RACE_TYPES[race.type]||RACE_TYPES.standard;

  return (
    <div style={{position:"fixed",inset:0,zIndex:600,background:"var(--track-bg)",display:"flex",flexDirection:"column"}}>
      {/* Replay header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",background:"rgba(20,22,20,0.98)",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <span style={{fontSize:18}}>{rt.icon}</span>
          <div style={{minWidth:0}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>{race.name}</div>
            <div style={{color:"#adbba2",fontSize:9,letterSpacing:2,fontFamily:"var(--track-label)"}}>📼 REPLAY</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          {!finished && rolls && (
            <button onClick={toggleSpeed} style={{padding:"5px 12px",background:speed===2?"rgba(228,196,139,0.15)":"rgba(255,255,255,0.07)",border:`1px solid ${speed===2?"#e4c48b44":"rgba(255,255,255,0.12)"}`,borderRadius:8,color:speed===2?"#e4c48b":"#c4cbb7",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"var(--track-label)",letterSpacing:1}}>
              {speed===1?"1×":"2× ⚡"}
            </button>
          )}
          {finished && <span style={{color:"#97bd88",fontFamily:"var(--track-label)",fontSize:10,letterSpacing:2}}>✓ FINISHED</span>}
          {!rolls && !unavailable && <span style={{color:"#c4cbb7",fontSize:12}}>Loading...</span>}
          <button onClick={onClose} style={{width:32,height:32,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#c4cbb7",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>

      {/* Embed RaceScreen in replay mode */}
      {unavailable && <section className="track-race-unavailable"><h1>Recording unavailable</h1><p>The original result remains in your history. This race has no saved recording or verified seed to replay.</p><button className="track-primary" onClick={onClose}>Back to history</button></section>}
      {rolls && (
        <div style={{flex:1,overflowY:"auto",marginTop:0}}>
          <RaceScreen
            race={{...race,engineVersion:replayVersion, startTime: Date.now() + 1200, nowMs: Date.now()}}
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
        <span style={{fontFamily:"var(--track-label)",color:"#fff",fontSize:14,letterSpacing:2,fontWeight:700}}>{title}</span>
      </div>
      {children}
    </div>
  );

  const Row = ({label, value, color="#ffffffbb"}) => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <span style={{color:"#c4cbb7",fontSize:13,flex:1}}>{label}</span>
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
        <div style={{color:"#c4cbb7",fontSize:10,letterSpacing:2,marginBottom:8}}>LIVE EXAMPLE — adjust bets to see odds change</div>
        {horses.map(h => {
          const myBet = bets[h.id]||0;
          const odds = myBet > 0 ? (total/myBet).toFixed(2) : "—";
          return (
            <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <span style={{color:h.color,fontSize:12,fontWeight:700,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{color:"#c4cbb7",fontSize:11}}>$</span>
                <input type="number" min="0" value={myBet}
                  onChange={e=>setBets(b=>({...b,[h.id]:Math.max(0,parseInt(e.target.value)||0)}))}
                  style={{width:60,padding:"3px 6px",background:"rgba(255,255,255,0.07)",border:`1px solid ${h.color}44`,borderRadius:6,color:"#fff",fontSize:13,outline:"none",textAlign:"right"}}/>
              </div>
              <span style={{fontFamily:"var(--track-label)",color:myBet>0?"#e4c48b":"#c4cbb7",fontSize:14,fontWeight:900,minWidth:48,textAlign:"right"}}>{myBet>0?`${odds}x`:"—"}</span>
            </div>
          );
        })}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",marginTop:8,paddingTop:8,display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#c4cbb7",fontSize:12}}>Total pot</span>
          <span style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:14,fontWeight:900}}>${total}</span>
        </div>
        <div style={{color:"#c4cbb7",fontSize:11,marginTop:8}}>If you bet $100 on War Horse and win → ${(total/(bets[0]||1)).toFixed(2)} × $100 = <span style={{color:"#97bd88",fontWeight:700}}>${((total/(bets[0]||1))*100).toFixed(2)}</span></div>
      </div>
    );
  };

  const RaceTypeCard = ({icon, name, color, tag, desc, mechanics}) => (
    <div style={{marginBottom:14,background:`${color}08`,border:`1px solid ${color}22`,borderRadius:12,padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{fontSize:24}}>{icon}</span>
        <div>
          <div style={{color,fontFamily:"var(--track-label)",fontSize:13,fontWeight:700,letterSpacing:1}}>{name}</div>
          <div style={{color:`${color}88`,fontSize:11,marginTop:1}}>{tag}</div>
        </div>
      </div>
      <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.5,marginBottom:8}}>{desc}</div>
      <div style={{color:"#c4cbb7",fontSize:12,lineHeight:1.6,fontStyle:"italic"}}>{mechanics}</div>
    </div>
  );

  const WeatherCard = ({icon, name, color, effect, tip}) => (
    <div style={{marginBottom:12,display:"flex",gap:12,background:`${color}08`,border:`1px solid ${color}22`,borderRadius:12,padding:"12px 14px"}}>
      <span style={{fontSize:28,flexShrink:0}}>{icon}</span>
      <div>
        <div style={{color,fontFamily:"var(--track-label)",fontSize:12,fontWeight:700,letterSpacing:1,marginBottom:4}}>{name}</div>
        <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.5,marginBottom:4}}>{effect}</div>
        <div style={{color:"#c4cbb7",fontSize:11,fontStyle:"italic"}}>💡 {tip}</div>
      </div>
    </div>
  );

  const renderTab = () => {
    if(tab === "basics") return (
      <div>
        <Section icon="🏁" title="HOW A RACE WORKS">
          <Row label="Track length" value="New races: 13 spaces; Down & Back and Magic Dice: 12 out, 13 home. The final space is beyond the finish line."/>
          <Row label="Race interval" value="Races fire every 1–5 minutes"/>
          <Row label="Betting window" value="Closes 30 seconds before regular races; at the end of an auction"/>
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
            Odds are <span style={{color:"#e5b678",fontWeight:700}}>pari-mutuel</span> — the more money bet on a horse, the lower the payout. The pot is shared proportionally among winning bettors.
          </div>
          <div style={{background:"rgba(229,182,120,0.06)",border:"1px solid #e5b67822",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{color:"#e5b678",fontFamily:"var(--track-label)",fontSize:11,letterSpacing:2,marginBottom:4}}>THE FORMULA</div>
            <div style={{color:"#e4c48b",fontFamily:"var(--track-label)",fontSize:14}}>Odds = Total Pot ÷ Amount Bet on Winner</div>
            <div style={{color:"#c4cbb7",fontSize:12,marginTop:4}}>Payout = Your Bet × Odds</div>
          </div>
          <OddsExample/>
        </Section>
      </div>
    );

    if(tab === "racetypes") return (
      <div>
        <RaceTypeCard icon="🎲" name="STANDARD" color="#e5b678" tag="2 dice · classic"
          desc="Two dice are rolled each turn. Each die moves the matching horse one space. Doubles moves that horse two spaces."
          mechanics="Dice 1–6 = Horses 1–6. Roll a 3 and a 5 → Horse 3 and Horse 5 each move 1 space. Roll double 4s → Horse 4 moves 2 spaces."/>
        <RaceTypeCard icon="🎯" name="TRIPLE DICE" color="#a78bfa" tag="3 dice · more action"
          desc="Three dice rolled every turn — more movement, faster races, more horses in play each roll."
          mechanics="Same as Standard but with 3 dice. No doubles bonus — just 3 independent moves per roll."/>
        <RaceTypeCard icon="✨" name="MAGIC DICE" color="#e4c48b" tag="2 dice · wild card"
          desc="Die 1 picks the horse. Die 2 decides how many spaces it moves. Race out and back. One horse could leap forward 6 spaces in a single roll."
          mechanics="Die 1 (1–6) = which horse. Die 2 (1–6) = spaces moved. Huge swings possible — any horse can bolt from last to first."/>
        <RaceTypeCard icon="↩️" name="DOWN & BACK" color="#ff6b6b" tag="2 dice · two legs"
          desc="Horses race to the far end, then turn around and race back. First to return to start wins. Strategy shifts at the halfway point."
          mechanics="Horses advance to space 12, then reverse direction. Once a horse turns, it heads back toward 0. First to reach 0 on the return wins."/>
        <RaceTypeCard icon="🚧" name="HURDLES" color="#97bd88" tag="2 dice · obstacles"
          desc="A hurdle sits at space 6. Horses stop at space 5 and must roll doubles to jump to space 7. A well-timed doubles roll can leap over the field."
          mechanics="Any horse reaching the hurdle stops unless doubles were rolled. On doubles, the horse clears the hurdle and lands 2 ahead. Horses pile up, then burst through."/>
      </div>
    );

    if(tab === "weather") return (
      <div>
        <div style={{color:"#c4cbb7",fontSize:13,marginBottom:16,lineHeight:1.6}}>
          Weather conditions are assigned randomly when the schedule generates. They affect how dice moves work — same race, different chaos.
        </div>
        <WeatherCard icon="☀️" name="SUNNY" color="#e4c48b"
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
            Auction races let you <span style={{color:"#e4c48b",fontWeight:700}}>own a horse</span> by outbidding other players. Winning bidders become the horse's owner — their name appears on the track during the race.
          </div>
          <Row label="Auction format" value="6 horses auctioned one at a time, 30 seconds each"/>
          <Row label="Bidding" value="Place a bid higher than the current top bid to take the lead"/>
          <Row label="One owner per horse" value="Once you own a horse you can't bid on others"/>
          <Row label="No sale" value="If nobody bids on a horse, it runs unowned"/>
          <Row label="After auction" value="30-second presentation showing owners + odds"/>
        </Section>
        <Section icon="💵" title="AUCTION BETTING">
          <div style={{color:"#ffffffbb",fontSize:13,lineHeight:1.6,marginBottom:10}}>
            Owning a horse doesn't automatically mean you win money. You still need to <span style={{color:"#e5b678",fontWeight:700}}>place a bet</span> on it (or any horse) in the bets tab during the auction.
          </div>
          <Row label="Ownership" value="Bragging rights + name on the track"/>
          <Row label="Winning bid cost" value="Leading bids reserve funds; outbid funds return automatically"/>
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
              <div key={title} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 14px",borderLeft:"3px solid #e5b67844"}}>
                <div style={{color:"#e5b678",fontWeight:700,fontSize:13,marginBottom:3}}>{title}</div>
                <div style={{color:"#c4cbb7",fontSize:12,lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"60px 12px 12px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:560,background:"#1a2c22",border:"1px solid rgba(229,182,120,0.15)",borderRadius:20,overflow:"hidden",boxShadow:"none"}}>
        {/* Header */}
        <div style={{padding:"20px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"var(--track-label)",color:"#e5b678",fontSize:18,letterSpacing:3,textShadow:"none"}}>HOW IT WORKS</div>
            <div style={{color:"#c4cbb7",fontSize:12,marginTop:2,letterSpacing:1}}>The Track — Player Guide</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#c4cbb7",cursor:"pointer",width:32,height:32,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:4,padding:"14px 16px 0",overflowX:"auto",scrollbarWidth:"none"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flexShrink:0,padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",
              background:tab===t.id?"rgba(229,182,120,0.15)":"rgba(255,255,255,0.04)",
              color:tab===t.id?"#e5b678":"#c4cbb7",
              fontFamily:"var(--track-label)",fontSize:10,letterSpacing:1,fontWeight:700,
              borderBottom:tab===t.id?"2px solid #e5b678":"2px solid transparent",
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

// ─── LOCAL RACE SIMULATOR (fallback if cloud function hasn't run yet) ────────


function App() {
  // Prevent iOS auto-zoom on input focus by ensuring viewport doesn't scale
  useEffect(()=>{
    let meta = document.querySelector("meta[name=viewport]");
    if(!meta){ meta = document.createElement("meta"); meta.name="viewport"; document.head.appendChild(meta); }
    meta.content = "width=device-width, initial-scale=1";
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
  const [showRaceReplay,setShowRaceReplay] = useState(null);
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

  // One bounded listener replaces whole-collection polling on every client.
  useEffect(()=>{
    if(!user?.uid){_cachedRaceResultsRef.current={};return;}
    const recent=query(collection(db,'raceRolls'),orderBy('computedAt','desc'),limit(160));
    return onSnapshot(recent,snap=>{const results={};snap.forEach(d=>{const r=d.data();results[d.id]={winner:r.winner,visualFinishAt:r.visualFinishAt,finishedAt:r.computedAt};});_cachedRaceResultsRef.current=results;},e=>console.error('Race results unavailable',e.code));
  },[user?.uid]);

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




  // Settle only this user's tickets, from recorded results, after the race finishes.
  useEffect(()=>{
    if(!user?.uid)return;
    let running=false,cancelled=false;
    const settle=async()=>{
      if(running)return;running=true;
      try{for(const race of [...schedule,...auctionSchedule]){
        const result=_cachedRaceResultsRef.current[race.id];
        if(!userBets[race.id]||!result||gameNow()<result.visualFinishAt)continue;
        const receipt=await raceStore.settleTicket(user,race);
        if(receipt&&!cancelled){setUser(u=>u?{...u,balance:receipt.balance}:u);setUserBets(receipt.confirmed);}
      }}catch(e){console.error('Ticket settlement will retry',e.code||e.message);}finally{running=false;}
    };
    settle();const timer=setInterval(settle,15000);return()=>{cancelled=true;clearInterval(timer);};
  },[schedule,auctionSchedule,user?.uid,userBets]);

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
    if(!user?.uid) return;
    // Only the backend creates official races. An empty card waits for its next tick.
    const unsubSched = onSnapshot(doc(db,"global","schedule"), snap => {
      setSchedule(snap.exists()?snap.data().races||[]:[]);setScheduleLoaded(true);
    });
    const unsubAuction = onSnapshot(doc(db,"global","auctionSchedule"), snap => {
      setAuctionSchedule(snap.exists()?snap.data().races||[]:[]);
    });
    // Real-time shared pot listener
    const unsubPots = onSnapshot(doc(db,"global","racePots"), (snap) => {
      if(snap.exists()) setSharedPot(snap.data());
      else setSharedPot({});
    });

    return () => { unsubSched(); unsubAuction(); unsubPots(); };
  },[user?.uid]);

  useEffect(()=>{
    if(!user?.uid)return;
    const a=onSnapshot(doc(db,'users',user.uid),snap=>{if(snap.exists())setUser(u=>u?{...u,...snap.data()}:u);});
    const b=onSnapshot(doc(db,'bets',user.uid),snap=>{const c=snap.exists()?snap.data().confirmed||{}:{};setUserBets(c);saveConfirmed(c);});
    return()=>{a();b();};
  },[user?.uid]);

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
  const handleLogout=()=>{ signOut(auth); setUser(null); stopAllMusic(500); setScreen("lobby"); };

  // Lobby music controller
  useEffect(()=>{
    if(screen==="lobby" && user) {
      startLobbyMusic(); // crossfade from whatever is playing
    }
    // race/payout music handled by RaceScreen and handleRaceEnd
  },[screen, user]);

  const handleEnterRace=async(race)=>{
    {const b=_getBugle();if(b.readyState===0)b.load();}
    setActivePrivateRace(null);setAuctionOwners(null);setSelectedRace(race);setBets({});setTotalPot(0);setWinner(null);
    setChatMsgs([]);setChatOpen(false);setChatUnread(0);
    const st=raceStatus(race,gameNow());
    if(st==='finished'){
      try{const receipt=await raceStore.settleTicket(user,race);if(receipt){setWinner(receipt.winner);setBets(receipt.bets);setTotalPot(receipt.totalPot);setOdds(receipt.odds);setUser(u=>({...u,balance:receipt.balance}));setUserBets(receipt.confirmed);setScreen('payout');return;}}
      catch(e){console.error('Result unavailable',e.code||e.message);}
      setScreen('race');return;
    }
    const saved=userBets[race.id];if(saved){setBets(saved.bets);setTotalPot(saved.pot);}
    setScreen(st==='racing'?'race':'detail');
  };

  // Confirms/locks bets — saves to persistent store, race fires at post time
  // prevPot = amount already deducted for this race on a prior confirm (for edits)
  const confirmTicket=async(race,finalBets)=>{
    const result=await raceStore.confirmTicket(user,race,finalBets);
    setUser(u=>({...u,balance:result.balance}));setUserBets(result.confirmed);
    saveConfirmed(result.confirmed);setBets(result.bets);setTotalPot(result.pot);sfx.betConfirm();
  };
  const handleAuctionBetsConfirm=async(finalBets)=>confirmTicket(selectedAuctionRace,finalBets);
  const handleBetsConfirm=async(finalBets)=>confirmTicket(selectedRace,finalBets);

  // Called when race clock hits zero
  const handleRaceStart=useCallback(()=>{
    // userBets is already loaded and kept in sync — no need to await Firebase here
    const saved = userBets[selectedRace?.id];
    if(saved){ setBets(saved.bets); setTotalPot(saved.pot); }
    setScreen("race");
  },[selectedRace?.id, userBets]);

  const handleRaceEnd=useCallback(async(winnerIdx)=>{
    setWinner(winnerIdx);
    try{
      if(activePrivateRace){
        const result=await raceStore.privateRace(user,activePrivateRace,'settle');
        const local=getPrivateRaces();local[activePrivateRace]=result.race;savePrivateRaces(local);
        setUser(u=>({...u,balance:result.balance}));setScreen('private-payout');return;
      }
      const receipt=await raceStore.settleTicket(user,selectedRace);
      if(receipt){setWinner(receipt.winner);setBets(receipt.bets);setTotalPot(receipt.totalPot);setOdds(receipt.odds);setUser(u=>({...u,balance:receipt.balance}));setUserBets(receipt.confirmed);}
      else setOdds({}); // A pending backend result never triggers an estimated credit.
      setSchedule(races=>races.map(r=>r.id===selectedRace.id?{...r,status:'finished'}:r));
      setScreen('payout');stopBgMusic(3000);
    }catch(e){console.error('Settlement pending',e.code||e.message);setScreen(activePrivateRace?'private-payout':'payout');}
  },[user,selectedRace,activePrivateRace]);

  // Launch a private race — build a synthetic race object and go straight to RaceScreen
  const handleLaunchPrivateRace = (privateRace) => {
    const syntheticRace = {
      id:        `private_${privateRace.code}`,
      name:      privateRace.name,
      type:      privateRace.raceType || "standard",
      startTime: (privateRace.startedAt || Date.now()) + PRIVATE_COUNTDOWN_SECS*1000,
      condition: privateRace.condition || 'sunny', seed:privateRace.seed??privateSeed(privateRace.code), engineVersion:privateRace.engineVersion||1,
      status:    "racing",
      horses:    privateRace.horses,
      coats:     privateRace.coats||[],
      _privateCode: privateRace.code,
    };
    // Collect my bets from the private race member data
    const myData = privateRace.members?.[user?.username] || {};
    const myBets  = myData.bets || {};
    const myPot   = myData.pot  || Object.values(myBets).reduce((s,v)=>s+(parseFloat(v)||0),0);
    setAuctionOwners(null);setSelectedRace(syntheticRace);
    setBets(myBets);
    setTotalPot(myPot);
    setActivePrivateRace(privateRace.code);
    setWinner(null);
    setShowPrivate(false);
    setScreen("race");
  };

  const goLobby=()=>{
    setScreen("lobby");
    startLobbyMusic(); // crossfade handled internally
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
    <div className="track-app">
      <style>{GS}</style>
      <NavBar user={user} onLobby={goLobby} onMyBets={()=>{refreshPending();setShowMyBets(true);}} onProfile={()=>setShowProfile(true)} onPrivateRaces={()=>setShowPrivate(true)} onAuctions={()=>{goLobby();setShowAuction(true);}} onBank={()=>setShowBank(true)} onHowTo={()=>setShowHowTo(true)} onLogout={handleLogout} pendingCount={pendingCount}/>

      {showBank    && <BankPanel user={user} onClose={()=>setShowBank(false)} onBalanceChange={updateBalance}/>}
      {showHowTo   && <HowItWorksPanel onClose={()=>setShowHowTo(false)}/>}
      {showProfile && <ProfilePanel user={user} schedule={schedule} auctionSchedule={auctionSchedule} now={now} onClose={()=>setShowProfile(false)} onGoToRace={handleEnterRace} onBalanceChange={updateBalance}/>}
      {showRaceReplay && <RaceReplayScreen race={showRaceReplay} onClose={()=>setShowRaceReplay(null)}/>}
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
        <div style={{position:"fixed",inset:0,zIndex:50,background:"var(--track-bg)",overflowY:"auto"}}>
          <AuctionLobbyScreen schedule={auctionSchedule} now={now} onBack={()=>setShowAuction(false)} onEnterRace={race=>{setSelectedAuctionRace(race);}} sharedPot={sharedPot}/>
        </div>
      )}
      {showAuction && selectedAuctionRace && screen!=="race" && (
        <div style={{position:"fixed",inset:0,zIndex:50,background:"var(--track-bg)",overflowY:"auto"}}>
          <AuctionRaceScreen
            race={auctionSchedule.find(r=>r.id===selectedAuctionRace.id)||selectedAuctionRace}
            user={user} now={now}
            onBack={()=>setSelectedAuctionRace(null)}
            onRaceStart={()=>{
              const r=auctionSchedule.find(x=>x.id===selectedAuctionRace.id)||selectedAuctionRace;
              // RaceScreen handles the +30s auction offset via race.isAuction flag — don't add it here
              setActivePrivateRace(null);setSelectedRace(r);
              const ticket=userBets[r.id];setBets(ticket?.bets||{});setTotalPot(ticket?.pot||0);
              fbGetAuctions().then(allA => setAuctionOwners((allA[r.id]||{}).owners||null));
              setWinner(null);
              setShowAuction(false);
              setScreen("race");
            }}
            confirmedBets={userBets[selectedAuctionRace?.id]?.bets||{}}
            confirmedPot={userBets[selectedAuctionRace?.id]?.pot||0}
            sharedPool={sharedPot[selectedAuctionRace?.id]||{}}
            onConfirmBets={handleAuctionBetsConfirm}
          />
        </div>
      )}
      {screen==="lobby" && !showAuction && <LobbyScreen schedule={schedule} now={now} onEnterRace={handleEnterRace} userBets={userBets} friendRaces={friendRaces} sharedPot={sharedPot}/>}
      {screen==="detail" && liveSelectedRace && <RaceDetailScreen race={liveSelectedRace} user={user} now={now} onBack={goLobby} onConfirmBets={handleBetsConfirm} confirmedBets={bets} confirmedPot={totalPot} sharedPot={sharedPot[liveSelectedRace?.id]||null} onRaceStart={handleRaceStart} devForceStart={false} onDevForceStart={()=>{}} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs} chatOpen={chatOpen} setChatOpen={setChatOpen} chatUnread={chatUnread} setChatUnread={setChatUnread}/>}
      {screen==="race"   && liveSelectedRace && <RaceScreen key={liveSelectedRace.id} race={{...liveSelectedRace, nowMs:now}} bets={bets} totalPot={sharedPot[liveSelectedRace?.id]?.totalPot||totalPot} onRaceEnd={handleRaceEnd} user={user} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs} chatOpen={chatOpen} setChatOpen={setChatOpen} chatUnread={chatUnread} setChatUnread={setChatUnread} auctionOwners={auctionOwners}/>}
      {screen==="payout"         && liveSelectedRace && winner!==null && <PayoutScreen race={liveSelectedRace} bets={bets} totalPot={totalPot} odds={odds} winner={winner} userBalance={user.balance} onPlayAgain={()=>setShowRaceReplay(liveSelectedRace)} onLobby={goLobby}/>}
      {screen==="private-payout"  && liveSelectedRace && winner!==null && <PrivatePayoutScreen race={liveSelectedRace} winner={winner} user={user} onLobby={goLobby}/>}
    </div>
  );
}

export default App;
