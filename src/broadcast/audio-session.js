import {createAudioManager} from './audio-manager.mjs';
import {loadAnnouncer} from './announcer';
let storage;try{storage=window.localStorage;}catch{}
export const raceAudio=createAudioManager({storage,
  createContext:()=>{const Audio=window.AudioContext||window.webkitAudioContext;return Audio?new Audio():null;},
  loadBuffer:loadAnnouncer,visible:()=>document.visibilityState!=='hidden',
  setSession:()=>{try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}}});
// Saved 'on' is intent, not proof of an unlocked iPhone audio session.
const gesture=()=>{if(raceAudio.getSnapshot().enabled)raceAudio.resume();};
window.addEventListener('click',gesture,{passive:true});window.addEventListener('keydown',gesture);
document.addEventListener('visibilitychange',raceAudio.visibilityChanged);
window.addEventListener('pageshow',raceAudio.visibilityChanged);
window.addEventListener('storage',event=>{if(event.key==='track-audio-v2'||event.key===null)raceAudio.reloadPreferences();});
