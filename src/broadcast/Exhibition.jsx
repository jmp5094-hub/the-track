import {useCallback,useRef,useState} from 'react';
import {Broadcast} from './Broadcast';
import {getRaceAudioContext,playRaceEffect} from './race-sound';
import {FIRST_ROLL,MOVE_END} from './playback.mjs';
import exhibition from './exhibition.json';
import '../track-theme.css';
import './exhibition.css';

const names=['Railbird','Night Watch','High Note','Bay Runner','Last Call','Homeward'];
const race={id:'brass-cup-exhibition-v1',name:'The Brass Cup',type:'standard',condition:'sunny'};
const end=FIRST_ROLL+(exhibition.rolls.length-1)*3.5+MOVE_END;
const read=()=>{try{return JSON.parse(localStorage.getItem('track-exhibition-v1'))||{};}catch{return {};}};
const initial=()=>{const saved=read();return {time:Number.isFinite(saved.time)?Math.max(0,Math.min(end+4,saved.time)):0,follow:Number.isInteger(saved.follow)&&saved.follow>=0&&saved.follow<6?saved.follow:3};};
export default function Exhibition(){
  const [saved]=useState(initial);
  const control=useRef({time:saved.time,paused:true,speed:1,version:0});
  const [follow,setFollow]=useState(saved.follow);
  const [paused,setPaused]=useState(true);
  const [finished,setFinished]=useState(saved.time>=end);
  const [speed,setSpeed]=useState(1);
  const [sound,setSound]=useState(()=>{try{return localStorage.getItem('track-demo-sound')==='true';}catch{return false;}});
  const [frame,setFrame]=useState(null);
  const followed=useRef(follow);followed.current=follow;
  const save=useCallback(()=>{try{localStorage.setItem('track-exhibition-v1',JSON.stringify({time:control.current.time,follow:followed.current}));}catch{}},[]);
  const onFrame=useCallback(value=>{setFrame(value);save();},[save]);
  const onFinish=useCallback(()=>{control.current.paused=true;setPaused(true);setFinished(true);save();},[save]);
  const go=(time=0)=>{control.current.time=time;control.current.version++;control.current.paused=false;setPaused(false);setFinished(false);save();};
  const toggle=()=>{if(finished){go(0);return;}control.current.paused=!control.current.paused;setPaused(control.current.paused);save();};
  const setAudio=value=>{setSound(value);try{localStorage.setItem('track-demo-sound',String(value));}catch{}};
  const effects={gate:()=>playRaceEffect(getRaceAudioContext(),'gate'),land:()=>playRaceEffect(getRaceAudioContext(),'land'),wire:()=>playRaceEffect(getRaceAudioContext(),'finish')};
  return <main className="track-exhibition">
    <nav className="exhibition-nav"><a href="?demo=1" aria-label="The Track exhibition"><span className="track-mark" aria-hidden="true"><i/><i/><i/></span> THE TRACK <small>DEMO</small></a><a href="/">Enter The Track</a></nav>
    <div className="exhibition-intro"><p>Pick a runner below. Watch for its number.</p><span>Standard exhibition · no account needed</span></div>
    <div className="exhibition-controls" aria-label="Exhibition playback">
      <button className="exhibition-play" type="button" onClick={toggle}>{finished?'Replay race':paused?(control.current.time>0?'Resume race':'Watch demo race'):'Pause race'}</button>
      <button type="button" onClick={()=>go(FIRST_ROLL+17*3.5-.05)}>Closing stretch</button>
      <button type="button" onClick={()=>{control.current.time=0;control.current.version++;control.current.paused=true;setPaused(true);setFinished(false);save();}}>Restart</button>
      <button type="button" aria-label="Playback speed" onClick={()=>{const next=speed===1?2:1;control.current.speed=next;setSpeed(next);}}>{speed}×</button>
      <span className="exhibition-progress">{finished?'Race complete':paused?'Ready when you are':'Exhibition replay'}</span>
    </div>
    <Broadcast race={race} history={exhibition} names={names} replay exhibition controlRef={control} followHorse={follow} onFollow={id=>{followed.current=id;setFollow(id);save();}}
      onFrame={onFrame} onFinish={onFinish} soundOn={sound} onSound={setAudio} getAudioContext={getRaceAudioContext} effects={effects}/>
    {finished&&<section className="exhibition-result" aria-live="polite"><p>THE DECISIVE ROLL</p><h2>{names[frame?.winner??exhibition.winner]} wins the Brass Cup.</h2><p>{follow===exhibition.winner?'You followed the winner.':`You followed #${follow+1} ${names[follow]}. #${exhibition.winner+1} crossed first.`} This exhibition has no wagers or payouts.</p><button type="button" onClick={()=>go(FIRST_ROLL+(exhibition.rolls.length-3)*3.5-.05)}>Replay the finish</button><a href="/">Enter The Track</a></section>}
  </main>;
}
