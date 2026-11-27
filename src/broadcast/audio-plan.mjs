import {MOVE_END,clamp} from './playback.mjs';

// Only current, revealed race state affects the mix. Never the eventual winner.
export function raceAudioPlan(frame,{enabled=true,paused=false,mix='stadium',musicAllowed=true}={}){
  const active=enabled&&!paused&&frame.launched;
  const left=frame.goal-Math.max(...frame.active.map(id=>frame.exact[id]));
  const pressure=left<=1?1:left<=3?.7:.2;
  const duck=frame.cue ? .4 : 1;
  const finishFade=frame.done?1-clamp((frame.into-MOVE_END-.35)/1.15):1;
  const hurdleChance=frame.type==='hurdle'&&!frame.tiebreak&&frame.waiting?.some(Boolean);
  const anticipation=frame.rolling&&(left<=3||hurdleChance)?.28:1;
  return {active,pressure,
    crowd:active&&mix!=='caller'?(frame.done?.42:.12+pressure*.17)*duck:0,
    music:active&&mix==='stadium'&&musicAllowed?(.13+pressure*.14)*duck*anticipation*finishFade:0,
    effects:active&&mix!=='caller'};
}
