import {useEffect,useRef,useState} from 'react';
import {loadAnnouncer} from './announcer';
import {canStartIntroCue,introFrame} from './intro-plan.mjs';
import './intro.css';

export function RaceIntro({raceId,condition='sunny',startTime,clock=Date.now,soundOn,getAudioContext,controlRef,showCountdown=false}) {
  const options=useRef({});options.current={startTime,clock,soundOn,getAudioContext,controlRef};
  const [view,setView]=useState(null);
  useEffect(()=>{
    let timer,source,context,buffer,loading=false,retryAt=0,disposed=false,lastPaint='',lastVersion,seen=new Set();
    const stop=()=>{if(source){try{source.stop();}catch{}source=null;}};
    const unlock=()=>{
      const o=options.current;if(!o.soundOn)return;
      try{
        context=o.getAudioContext?.();if(!context)return;
        if(context.state==='suspended')context.resume().catch(()=>{});
        if(!loading&&performance.now()>=retryAt){loading=true;
          // Warm the race reel too: the starting call must be ready at the gate.
          loadAnnouncer(context).catch(()=>{});
          loadAnnouncer(context,'gate-intro').then(value=>{if(!disposed)buffer=value;}).catch(()=>{loading=false;retryAt=performance.now()+5000;});
        }
      }catch{}
    };
    const draw=()=>{
      const o=options.current,c=o.controlRef?.current,version=c?.version??0;
      if(version!==lastVersion){lastVersion=version;seen=new Set();stop();}
      const elapsed=c?c.time:(o.clock()-o.startTime)/1000;
      const frame=introFrame(elapsed,condition);
      const audible=o.soundOn&&!c?.paused&&document.visibilityState==='visible';
      if(!audible||!frame.active)stop();
      if(audible&&!buffer)unlock();
      if(frame.cue){
        if(canStartIntroCue(frame.cue,elapsed,seen)&&audible&&context?.state==='running'&&buffer){
          stop();seen.add(frame.cue.key);
          const offset=elapsed-frame.cue.time,node=context.createBufferSource(),gain=context.createGain();
          node.buffer=buffer;node.playbackRate.value=c?.speed??1;gain.gain.value=.9;
          node.connect(gain).connect(context.destination);source=node;
          node.onended=()=>{node.disconnect();gain.disconnect();if(source===node)source=null;};
          node.start(0,frame.cue.offset+offset,frame.cue.duration-offset);
        }
        // Late joins and an unmuted/foregrounded tab wait for the next call.
        if(elapsed-frame.cue.time>=.24)seen.add(frame.cue.key);
      }
      const paint=frame.seconds+':'+frame.text+':'+frame.active;
      if(paint!==lastPaint){lastPaint=paint;setView(frame);}
      timer=requestAnimationFrame(draw);
    };
    unlock();window.addEventListener('pointerdown',unlock,{passive:true});window.addEventListener('keydown',unlock);
    const hide=()=>{if(document.visibilityState!=='visible')stop();};document.addEventListener('visibilitychange',hide);
    timer=requestAnimationFrame(draw);
    return()=>{disposed=true;cancelAnimationFrame(timer);stop();window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);document.removeEventListener('visibilitychange',hide);};
  },[raceId,condition]);
  if(!view?.active)return null;
  return <div className="race-intro" data-countdown-seconds={view.seconds}>
    <span className="race-intro-label">At the gate {showCountdown&&<b>{view.seconds}s</b>}</span>
    <p aria-live="polite">{view.text}</p>
  </div>;
}
