import {raceAudioPlan} from './audio-plan.mjs';
import {raceAudio} from './audio-session';
const files={crowd:'crowd.mp3',pulse:'pulse.mp3',hooves:'hooves.mp3',roar:'roar.mp3'};
const downloads=new Map();
const getBytes=key=>{
  if(!downloads.has(key))downloads.set(key,fetch(import.meta.env.BASE_URL+'broadcast/audio/'+files[key]).then(r=>{if(!r.ok)throw Error('Audio unavailable');return r.arrayBuffer();}).catch(e=>{downloads.delete(key);throw e;}));
  return downloads.get(key);
};

export function createRaceSoundscape(ctx){
  const buffers={},loops=new Map(),shots=new Set();
  let disposed=false,wasActive=false,plan={effects:false};
  const ready=Promise.allSettled(Object.keys(files).map(async key=>{const bytes=await getBytes(key);const buffer=await ctx.decodeAudioData(bytes.slice(0));if(!disposed)buffers[key]=buffer;}));
  const stop=()=>{
    for(const {source,gain} of loops.values()){try{source.stop();}catch{}source.disconnect();gain.disconnect();}loops.clear();
    for(const source of shots){try{source.stop();}catch{}}shots.clear();wasActive=false;
  };
  const unregister=raceAudio.registerStop(stop);
  function sync(frame,options,speed=1){
    if(disposed)return;
    plan=raceAudioPlan(frame,options);
    if(!plan.active){if(wasActive||shots.size)stop();return;}
    if(!plan.effects&&shots.size){for(const source of shots){try{source.stop();}catch{}}shots.clear();}
    wasActive=true;
    for(const [key,volume] of [['crowd',plan.crowd],['pulse',plan.music]]){
      if(!loops.has(key)&&buffers[key]&&volume>0){
        const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffers[key];source.loop=true;gain.gain.value=0;source.connect(gain).connect(raceAudio.output(key==='pulse'?'music':'ambience'));
        source.start(0,Math.max(0,frame.time) % source.buffer.duration);loops.set(key,{source,gain});
      }
      const loop=loops.get(key);if(loop){loop.source.playbackRate.setTargetAtTime(speed,ctx.currentTime,.06);loop.gain.gain.setTargetAtTime(volume,ctx.currentTime,.09);}
    }
  }
  function effect(kind,{duration,level=1,speed=1,pan=0}={}){
    if(disposed||!plan.effects||!buffers[kind])return false;
    const source=ctx.createBufferSource(),gain=ctx.createGain(),panner=ctx.createStereoPanner();
    source.buffer=buffers[kind];source.playbackRate.value=speed;panner.pan.value=Math.max(-.7,Math.min(.7,pan));
    const seconds=Math.min(duration||source.buffer.duration,source.buffer.duration)/speed;
    gain.gain.setValueAtTime(kind==='roar'?.48*level:.62*level,ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value,ctx.currentTime+Math.max(0,seconds-.07));gain.gain.linearRampToValueAtTime(0,ctx.currentTime+seconds);
    source.connect(gain).connect(panner).connect(raceAudio.output(kind==='roar'?'ambience':'effects'));shots.add(source);source.start(0,0,seconds*speed);
    source.onended=()=>{shots.delete(source);source.disconnect();gain.disconnect();panner.disconnect();};return true;
  }
  function dispose(){disposed=true;stop();unregister();}
  return {ready,sync,effect,stop,dispose};
}
