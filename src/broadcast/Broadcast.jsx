import {useEffect,useMemo,useRef,useState} from 'react';
import {buildPlayback,describeRoll,rootingHint,raceMoment,LAND,MOVE,MOVE_END,PIPS,SILKS} from './playback.mjs';
import voice from './voice.json';
import {playRaceEffect,stopRaceEffects} from './race-sound';
import {createRaceSoundscape} from './soundscape';
import './broadcast.css';

const audioUrl=import.meta.env.BASE_URL+'broadcast/audio/announcer.mp3';
let voiceBytes;
const loadVoice=()=>voiceBytes??=(fetch(audioUrl).then(r=>{if(!r.ok)throw Error('Voice unavailable');return r.arrayBuffer();}).catch(e=>{voiceBytes=undefined;throw e;}));
const readPreference=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
const savePreference=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};

function Dice({value,rolling,revealed,weather,follow}){
  return <span aria-hidden="true" style={{'--die-silk':SILKS[value-1]||'#f4e3c1'}} className={'tv-die'+(rolling?' is-rolling':'')+(revealed?' is-landed':'')+(!rolling&&value===follow+1?' is-hit':'')+(weather?' '+weather:'')}>
    {Array.from({length:9},(_,i)=><i key={i} className={PIPS[value]?.includes(i)?'is-pip':''}/>)}
    {weather&&<small>{weather==='is-mud'?'×':'−'}</small>}
  </span>;
}

export function RaceField({frame,names,follow,onFollow,flat=false}){
  return <div className={'tv-field'+(flat?' is-flat':'')}>
    <div className="tv-field-axis"><span>Follow a runner</span><span><i>{frame.tiebreak?'Tiebreak start':'Start'}</i><i>{frame.goal} spaces</i><b>{frame.roundTrip?'Home':'Finish'}</b></span><span>To finish</span></div>
    {names.map((name,id)=>{
      const eligible=frame.active.includes(id),left=Math.max(0,frame.goal-frame.exact[id]);
      return <button type="button" key={id} className={'tv-lane'+(follow===id?' is-followed':'')+(frame.moving[id]?' is-advancing':'')+(!eligible?' is-out':'')}
        aria-pressed={follow===id} aria-label={`Follow #${id+1} ${name}, ${eligible?left+' spaces to finish':'out of tiebreak'}${frame.leaders.includes(id)?', leading':''}`}
        onClick={()=>onFollow(id)}>
        <span className="tv-runner"><b style={{'--silk':SILKS[id]}}>{id+1}</b><span title={name}>{name}</span></span>
        <span className="tv-lane-track" style={{'--spaces':frame.goal}} aria-hidden="true"><i className="tv-token" style={{left:(Math.min(frame.goal,frame.progress[id])/frame.goal*100)+'%','--silk':SILKS[id]}}>{id+1}</i></span>
        <span className="tv-distance">{!eligible?'Out':frame.done&&frame.winner===id?'Winner':left+' left'}</span>
      </button>;
    })}
  </div>;
}

export function Broadcast({race,history,interval=3500,spaces=12,tieSpaces=3,names,clock=Date.now,startTime=0,replay=false,
  speedRef,onFinish=()=>{},soundOn=false,onSound=()=>{},getAudioContext,effects={},owners,bets={},
  controlRef,followHorse,onFollow,onFrame,exhibition=false,musicAllowed=true}){
  const playback=useMemo(()=>buildPlayback(history,interval,spaces,tieSpaces,voice,race.type,race.condition),[history,interval,spaces,tieSpaces,race.type,race.condition]);
  const savedKey='track-follow-'+race.id;
  const backed=Object.keys(bets).map(Number).filter(id=>Number(bets[id])>0&&id>=0&&id<6);
  const [localFollow,setLocalFollow]=useState(()=>{
    const stored=Number(readPreference(savedKey,String(backed[0]??3)));return stored>=0&&stored<6?stored:3;
  });
  const follow=followHorse??localFollow;
  const choose=id=>{setLocalFollow(id);savePreference(savedKey,id);onFollow?.(id);};
  const [viewMode,setViewMode]=useState(()=>readPreference('track-view',window.matchMedia('(prefers-reduced-motion: reduce)').matches?'board':'trackside'));
  const [viewStatus,setViewStatus]=useState('loading');
  const [audioMix,setAudioMix]=useState(()=>readPreference('track-race-mix','stadium'));
  const [display,setDisplay]=useState(null);
  const [fullscreen,setFullscreen]=useState(Boolean(document.fullscreenElement));
  const [fullscreenError,setFullscreenError]=useState('');
  useEffect(()=>{const sync=()=>setFullscreen(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);},[]);
  async function toggleFullscreen(){
    try{setFullscreenError('');if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    catch{setFullscreenError('Fullscreen is unavailable in this browser. Use its full-screen control.');}
  }
  const container=useRef(null),view=useRef(null),audio=useRef({}),settings=useRef({});
  settings.current={onFinish,soundOn,clock,effects,follow,viewMode,onFrame,audioMix,musicAllowed};
  function stopVoice(){const source=audio.current.source;if(source){try{source.stop();}catch{}audio.current.source=null;}}
  function unlock(){
    try{
      const ctx=getAudioContext?.();if(!ctx)return;
      ctx.resume().catch(()=>{});audio.current.context=ctx;
      audio.current.mix??=createRaceSoundscape(ctx);
      audio.current.promise??=loadVoice().then(bytes=>ctx.decodeAudioData(bytes.slice(0))).then(buffer=>{audio.current.buffer=buffer;}).catch(()=>{audio.current.promise=undefined;});
    }catch{}
  }
  useEffect(()=>{
    if(!soundOn){stopVoice();stopRaceEffects(audio.current.context);audio.current.mix?.stop();return;}
    unlock();window.addEventListener('pointerdown',unlock,{passive:true});window.addEventListener('keydown',unlock);
    return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);};
  },[soundOn]);
  useEffect(()=>()=>{stopVoice();stopRaceEffects(audio.current.context);audio.current.mix?.dispose();audio.current.mix=null;},[]);
  useEffect(()=>{
    if(viewMode==='board'){setViewStatus('board');return;}
    let cancelled=false;setViewStatus('loading');
    import('./track-view').then(({createTrackView})=>createTrackView(container.current)).then(scene=>{
      if(cancelled){scene.dispose();return;}view.current=scene;setViewStatus('ready');
    }).catch(()=>{if(!cancelled)setViewStatus('fallback');});
    return()=>{cancelled=true;view.current?.dispose();view.current=null;};
  },[viewMode]);

  useEffect(()=>{
    if(!playback)return;
    let timer,lastTimestamp,lastPaint='',lastCue='',lastRoll=-2,lastMove=-2,lastStep=-2,lastCrowd=-2,lastFrameKey='',lastVersion=-1;
    let replayTime=0,nextDraw=0,finished=false,started=false,atWire=false,slowFrames=0;
    const draw=timestamp=>{
      const s=settings.current,control=controlRef?.current;
      const speed=replay?(control?.speed??speedRef?.current??1):1;
      const version=control?.version??0;
      const changed=version!==lastVersion;
      if(changed){lastVersion=version;finished=false;lastCue='';lastRoll=-2;lastMove=-2;lastStep=-2;lastCrowd=-2;started=false;atWire=false;stopVoice();stopRaceEffects(audio.current.context);audio.current.mix?.stop();}
      const delta=lastTimestamp===undefined||changed?0:(timestamp-lastTimestamp)/1000;
      lastTimestamp=timestamp;
      if(replay){if(control){if(!control.paused)control.time+=delta*speed;replayTime=control.time;}else replayTime+=delta*speed;}
      const elapsed=replay?replayTime:(s.clock()-startTime)/1000;
      const frame={...playback.sample(elapsed),follow:s.follow,steady:s.viewMode==='steady'};
      const paused=Boolean(control?.paused);
      const ctx=audio.current.context;
      const sound=s.soundOn&&!paused&&document.visibilityState!=='hidden'&&ctx?.state==='running';
      const withEffects=sound&&s.audioMix!=='caller';
      audio.current.mix?.sync(frame,{enabled:sound,paused,mix:s.audioMix,musicAllowed:s.musicAllowed},speed);
      if(!sound)stopVoice();
      if(!withEffects)stopRaceEffects(ctx);
      if(frame.launched&&!started){started=true;if(withEffects&&elapsed<1.1)playRaceEffect(ctx,'gate');}
      if(frame.index>=0&&frame.index!==lastRoll){lastRoll=frame.index;if(withEffects&&frame.into<.2)playRaceEffect(ctx,'rattle');}
      if(frame.revealed&&frame.index!==lastMove){lastMove=frame.index;if(withEffects&&frame.into<LAND+.18)playRaceEffect(ctx,'land');}
      const step=frame.into>=MOVE&&frame.into<MOVE_END?frame.index:-1;
      if(step>=0&&step!==lastStep&&frame.moving.some(Boolean)){lastStep=step;if(withEffects){const moving=frame.active.filter(id=>frame.moving[id]);audio.current.mix?.effect('hooves',{duration:MOVE_END-frame.into,speed,pan:moving.length===1?(moving[0]-2.5)*.13:0});}}
      if(frame.done&&!atWire){atWire=true;if(withEffects&&elapsed<playback.end+.25){audio.current.mix?.effect('roar',{speed});audio.current.mix?.effect('hooves',{duration:.8,speed,level:.65});}}
      if(frame.leadChange&&frame.settled&&frame.index!==lastCrowd){lastCrowd=frame.index;if(withEffects&&!frame.done&&frame.into<MOVE_END+.1)audio.current.mix?.effect('roar',{duration:1.15,level:.36,speed});}
      const cue=frame.cue,cueTag=cue?cue.key+'@'+cue.time:'';
      if(cue&&cueTag!==lastCue){
        lastCue=cueTag;const offset=frame.time-cue.time;
        if(sound&&offset<.24&&audio.current.buffer){
          stopVoice();const source=ctx.createBufferSource(),gain=ctx.createGain();
          source.buffer=audio.current.buffer;source.playbackRate.value=speed;gain.gain.value=.9;source.connect(gain).connect(ctx.destination);
          audio.current.source=source;source.onended=()=>{source.disconnect();gain.disconnect();if(audio.current.source===source)audio.current.source=null;};
          source.start(0,cue.offset+offset,cue.duration-offset);
        }
      }
      const faceTick=frame.rolling?Math.floor(frame.into*15):-1;
      const dice=frame.rolling?Array.from({length:race.type==='triple_dice'?3:2},(_,i)=>(faceTick*(3+i*2)+frame.index+i*2)%6+1):frame.roll?.dice||frame.lastRoll?.dice||[0,0];
      const contextLost=container.current?.dataset.contextLost==='true';
      const ui=[frame.index,faceTick,frame.revealed,frame.exact.join(','),frame.progress.map(p=>p.toFixed(1)).join(','),frame.runOut>=.85,frame.done,frame.shot,cueTag,frame.follow,contextLost,paused].join('|');
      if(ui!==lastPaint){lastPaint=ui;setDisplay({...frame,dice,contextLost,paused});}
      if(timestamp>=nextDraw){
        try{view.current?.draw(frame);}catch{setViewStatus('fallback');view.current?.dispose();view.current=null;}
        nextDraw=timestamp+30;
      }
      if(document.visibilityState==='visible'&&delta>.085&&delta<.5&&view.current)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>40){setViewMode('board');setViewStatus('fallback');slowFrames=0;}
      const key=frame.index+':'+frame.settled+':'+frame.done+':'+version;
      if(key!==lastFrameKey){lastFrameKey=key;s.onFrame?.(frame);}
      if(elapsed>=playback.end+playback.endHold&&!finished){finished=true;s.onFinish(frame.winner);}
      timer=requestAnimationFrame(draw);
    };
    timer=requestAnimationFrame(draw);return()=>cancelAnimationFrame(timer);
  },[playback,replay,controlRef,speedRef,startTime,race.type]);

  const frame=display||playback?.sample(controlRef?.current?.time||0);
  const roll=frame?.roll||frame?.lastRoll;
  const rollIndex=frame?.roll?frame.index:frame?.lastIndex;
  const previousRoll=rollIndex>0&&history?.rolls[rollIndex-1]?.phase===roll?.phase?history.rolls[rollIndex-1]:null;
  const previous=previousRoll?.positions||[0,0,0,0,0,0];
  const summary=describeRoll(roll,previous,race.type,previousRoll?.legDone);
  const magic=race.type==='magic_dice'&&!frame?.tiebreak;
  const leaders=frame?.leaders||[];
  const leadLabel=frame?.index<0?'All six at the gate':leaders.length===6?'All six tied':leaders.map(id=>'#'+(id+1)).join(' + ');
  const leaderLeft=frame?frame.goal-Math.max(...frame.active.map(id=>frame.exact[id])):spaces;
  const followLeft=frame?frame.goal-frame.exact[follow]:spaces;
  const flat=viewMode==='board'||viewStatus!=='ready'||frame?.contextLost;
  const moment=raceMoment(frame,follow,race.condition||'sunny');
  return <section className={'track-broadcast'+(replay?' is-replay':'')+(exhibition?' is-exhibition':'')+(frame?.paused?' is-paused':'')+(flat?' is-board':'')} aria-label="Race broadcast">
    <header className="tv-heading"><div><p>{exhibition?'Exhibition replay':replay?'Replay':frame?.tiebreak?'Tiebreak':'Live at The Track'} · {frame?.formatLabel||race.type} · {race.condition==='rain'?'Rain':race.condition==='fog'?'Fog':'Clear'}</p><h1>{race.name}</h1></div>
      <div className="tv-tools"><select aria-label="Race view" value={viewMode} onChange={e=>{setViewMode(e.target.value);savePreference('track-view',e.target.value);}}><option value="trackside">Trackside 3D</option><option value="steady">Steady 3D</option><option value="board">Board view</option></select>
        <button type="button" aria-pressed={soundOn} onClick={()=>{if(!soundOn)unlock();onSound(!soundOn);}}>{soundOn?'Sound on':'Sound off'}</button>
        <select aria-label="Audio mix" value={audioMix} onChange={e=>{setAudioMix(e.target.value);savePreference('track-race-mix',e.target.value);}}><option value="stadium">Crowd + music</option><option value="trackside">Crowd only</option><option value="caller">Caller only</option></select>
        {document.fullscreenEnabled&&<button className="tv-fullscreen" type="button" onClick={toggleFullscreen}>{fullscreen?'Exit fullscreen':'Fullscreen'}</button>}</div>
    </header>
    <div className="tv-race-layout">
    <div className="tv-situation">
    <div className="tv-focus" aria-live="polite"><div><span>Following</span><strong><b style={{'--silk':SILKS[follow]}}>{follow+1}</b>{names[follow]}</strong><em>{frame?.done&&frame.winner===follow?'Winner':followLeft+' '+(followLeft===1?'space':'spaces')+' to finish'}</em></div>
      <div><span>{leaders.length>1?'Tied leaders':'Leader'}</span><strong>{leadLabel}</strong><em>{frame?.done?(frame.historicalResult?'Official result':'Across the wire'):leaderLeft+' '+(leaderLeft===1?'space':'spaces')+' to finish'}</em></div></div>
    <p className="tv-stakes" aria-live="polite">{rootingHint(frame,follow,race.condition||'sunny')}</p>
    </div>
    <div className="tv-video">
      <div ref={container} className="tv-viewport" aria-hidden="true"/>
      {frame&&flat&&<div className="tv-board-scene"><span>{viewStatus==='loading'&&viewMode!=='board'?'Preparing trackside view':'The course'} · {frame.goal} fixed spaces</span><RaceField {...{frame,names,follow}} onFollow={choose} flat/></div>}
      {!flat&&<div className="tv-shot-label">{frame?.tiebreak?'Three-space tiebreak':frame?.shot==='wire'?'At the wire':frame?.shot==='contest'?'The lead changes':frame?.shot==='gate'?'At the gate':'Trackside'}</div>}
      {!flat&&!frame?.done&&!frame?.tiePending&&<div key={frame?.index+':'+moment.kind} className={'tv-moment is-'+moment.kind} style={{'--moment-silk':SILKS[moment.horse]||'#e4c48b'}}><span>{moment.detail}</span><strong>{moment.title}</strong></div>}
      {!flat&&frame?.tiePending&&<div className="tv-announcement">Tied at the wire <b>{frame.tieActive.map(i=>'#'+(i+1)).join(' + ')}</b><span>Three-space tiebreak next</span></div>}
      {!flat&&frame?.done&&frame.runOut>=.85&&<div className="tv-announcement"><span>{frame.historicalResult?'Official recorded result':'Across the wire'}</span><b>#{frame.winner+1} {names[frame.winner]}</b><span>Wins on {frame.roll.dice.join(' and ')}</span></div>}
    </div>
    <div className="tv-sidebar">
    <div className="tv-roll-panel"><div className="tv-dice" role="img" aria-label={frame?.rolling?'Dice rolling':roll?'Dice '+roll.dice.join(' and '):'Dice ready'}><span>Roll {Math.max(0,(frame?.index??-1)+1)}</span><div>{(frame?.dice||[0,0]).map((value,id)=><span key={id} className="tv-die-slot">{magic&&<small>{id===0?'Horse':'Spaces'}</small>}<Dice follow={magic&&id===1?-1:follow} value={value} rolling={frame?.rolling} revealed={frame?.revealed} weather={!frame?.rolling&&roll?.mudDieIdx===id?'is-mud':!frame?.rolling&&roll?.fogDieIdx===id?'is-fog':null}/></span>)}</div></div>
      <div className="tv-roll-copy" aria-live="polite"><p className="tv-call">{frame?.rolling?'Here come the dice…':frame?.cue?.text||(!history?'Loading the race…':frame?.done?names[frame.winner]+' wins.':roll?'The dice have landed.':'Pick your horse. Watch for its number.')}</p><p className="tv-effect">{frame?.rolling&&roll?'Last roll: ':''}{summary}</p></div></div>
    {frame&&!flat&&<RaceField {...{frame,names,follow}} onFollow={choose}/>}
    {frame?.historicalResult&&<p className="tv-history-note">Archived race: positions are shown as recorded. The official result is unchanged.</p>}
    <div className="tv-ticket">{exhibition?'Exhibition · no wagers or payouts':backed.length?<>Your ticket: {backed.map(id=>'#'+(id+1)+' $'+Number(bets[id]).toFixed(2)).join(' · ')}</>:'Following only · no ticket placed'}{owners?.[follow]?.username?' · Owner: '+owners[follow].username:''}</div>
    </div>
    </div>
    <p className="tv-credit">{fullscreenError||<>David Wolfe on commentary · Horses by <a href="https://vinish.dev/free-3d-models/horses">vinish.dev</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></>}</p>
  </section>;
}
