import {useCallback,useMemo,useRef,useState} from 'react';
import {Broadcast} from './Broadcast';
import {getRaceAudioContext} from './race-sound';
import {FIRST_ROLL,buildPlayback} from './playback.mjs';
import {simulateV2,RACE_FORMATS,validConditions} from '../../functions/race-rules.mjs';
import '../track-theme.css';
import './exhibition.css';

const names=['Railbird','Night Watch','High Note','Bay Runner','Last Call','Homeward'];
const setups=Object.keys(RACE_FORMATS).flatMap(type=>validConditions(type).map(condition=>({type,condition,id:type+':'+condition,label:RACE_FORMATS[type]+' · '+(condition==='sunny'?'Clear':condition==='rain'?'Rain':'Fog')})));
export default function Exhibition(){
  const params=new URLSearchParams(location.search);
  const [setup,setSetup]=useState(()=>setups.find(s=>s.type===params.get('type')&&s.condition===(params.get('condition')||'sunny'))||setups[0]);
  const seed=Number(params.get('seed')||33);
  const history=useMemo(()=>simulateV2(setup.type,setup.condition,Number.isFinite(seed)?seed:33),[setup,seed]);
  const race=useMemo(()=>({id:'exhibition-'+setup.id+'-'+seed,name:'The Brass Cup',...setup}),[setup,seed]);
  const playback=useMemo(()=>buildPlayback(history,3500,12,3,{},setup.type,setup.condition),[history,setup]);
  const control=useRef({time:0,paused:true,speed:1,version:0});
  const [follow,setFollow]=useState(3),[paused,setPaused]=useState(true),[finished,setFinished]=useState(false),[speed,setSpeed]=useState(1);
  const [sound,setSound]=useState(()=>localStorage.getItem('track-demo-sound')==='true');
  const finish=useCallback(()=>{control.current.paused=true;setPaused(true);setFinished(true);},[]);
  const go=(time=0,play=true)=>{control.current.time=time;control.current.version++;control.current.paused=!play;setPaused(!play);setFinished(false);};
  const toggle=()=>{if(finished){go();return;}control.current.paused=!control.current.paused;setPaused(control.current.paused);};
  const keyMoment=history.rolls.findIndex(r=>r.events.some(e=>e.kind==='jump'||e.kind==='turn'));
  return <main className="track-exhibition">
    <nav className="exhibition-nav"><a href="?demo=1" aria-label="The Track exhibition"><span className="track-mark" aria-hidden="true"><i/><i/><i/></span> THE TRACK <small>DEMO</small></a><a href="/">Enter The Track</a></nav>
    <div className="exhibition-intro"><p>Pick a runner below. Watch for its number.</p><span>All races roll automatically · no account needed</span></div>
    <div className="exhibition-controls" aria-label="Exhibition playback">
      <select aria-label="Race setup" value={setup.id} onChange={e=>{go(0,false);setSetup(setups.find(s=>s.id===e.target.value));}}>{setups.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
      <button className="exhibition-play" type="button" onClick={toggle}>{finished?'Replay race':paused?(control.current.time>0?'Resume race':'Watch demo race'):'Pause race'}</button>
      <button type="button" onClick={()=>go(FIRST_ROLL+Math.max(0,history.rolls.length-4)*3.5-.05)}>Closing stretch</button>
      {keyMoment>=0&&<button type="button" onClick={()=>go(FIRST_ROLL+keyMoment*3.5-.05)}>{setup.type==='hurdle'?'First jump':'First turn'}</button>}
      <button type="button" onClick={()=>go(0,false)}>Restart</button>
      <button type="button" aria-label="Playback speed" onClick={()=>{const next=speed===1?2:1;control.current.speed=next;setSpeed(next);}}>{speed}×</button>
    </div>
    <Broadcast key={race.id} race={race} history={history} names={names} replay exhibition controlRef={control} followHorse={follow} onFollow={setFollow}
      onFinish={finish} soundOn={sound} onSound={v=>{setSound(v);localStorage.setItem('track-demo-sound',String(v));}} getAudioContext={getRaceAudioContext}/>
    {finished&&<section className="exhibition-result" aria-live="polite"><p>THE DECISIVE ROLL</p><h2>{names[history.winner]} wins the Brass Cup.</h2><p>{follow===history.winner?'You followed the winner.':`You followed #${follow+1} ${names[follow]}. #${history.winner+1} crossed first.`} This exhibition has no wagers or payouts.</p><button type="button" onClick={()=>go(playback.end-8)}>Replay the finish</button><a href="/">Enter The Track</a></section>}
  </main>;
}
