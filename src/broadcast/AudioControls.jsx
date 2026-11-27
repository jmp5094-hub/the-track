import {useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {raceAudio} from './audio-session';
import './audio-controls.css';
export const useRaceAudio=()=>useSyncExternalStore(raceAudio.subscribe,raceAudio.getSnapshot);
const labels={off:'Sound off',locked:'Enable sound',interrupted:'Resume sound',loading:'Loading audio…',on:'Sound on',error:'Retry audio',unavailable:'Retry audio',background:'Sound paused'};
function Speaker({on}){return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9h4l5-4v14l-5-4H4z"/>{on?<><path d="M16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/></>:<path d="m17 9 5 6m0-6-5 6"/>}</svg>;}
export function AudioControls({compact=false}){
  const audio=useRaceAudio(),id=useId(),on=audio.status==='on';
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:16,top:60});
  const trigger=useRef(null),panel=useRef(null);
  useLayoutEffect(()=>{
    if(!open)return;
    const anchor=trigger.current.getBoundingClientRect(),width=Math.min(280,document.documentElement.clientWidth-32);
    setPosition({left:Math.max(16,Math.min(anchor.right-width,document.documentElement.clientWidth-width-16)),
      top:Math.max(16,Math.min(anchor.bottom+8,window.innerHeight-panel.current.offsetHeight-16))});
  },[open,audio.mix,compact]);
  useEffect(()=>{
    if(!open)return;
    const outside=e=>{if(!panel.current?.contains(e.target)&&!trigger.current?.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    const resize=()=>setOpen(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('click',outside);document.addEventListener('keydown',key);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('click',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',resize);};
  },[open]);
  const button=<button type="button" className="track-sound-toggle" aria-pressed={on} onClick={()=>raceAudio.toggle()}><Speaker on={on}/><span>{labels[audio.status]}</span></button>;
  const options=<div id={id+'panel'} ref={panel} className="track-audio-panel" style={position} role="region" aria-label="Race audio settings"><strong>Race audio</strong>{compact&&button}
    <label htmlFor={id+'mix'}>Listen to</label><select id={id+'mix'} aria-label="Audio mix" value={audio.mix} onChange={e=>raceAudio.setMix(e.target.value)}><option value="stadium">Caller + crowd + music</option><option value="trackside">Caller + crowd</option><option value="caller">Caller only</option></select>
    {audio.mix==='stadium'&&<><label htmlFor={id+'music'}>Music level <span>{Math.round(audio.musicLevel*100)}%</span></label><input id={id+'music'} aria-label="Music level" type="range" min="0" max="100" value={Math.round(audio.musicLevel*100)} onChange={e=>raceAudio.setMusicLevel(Number(e.target.value)/100)}/></>}
    <p role="status">{audio.status==='locked'||audio.status==='interrupted'?'Tap the sound button to connect audio.':audio.status==='error'?'The caller could not load. Tap Retry audio.':audio.status==='loading'?'Preparing the caller and race sounds…':'Music and crowd soften while the caller speaks.'}</p>
  </div>;
  return <div className={'track-audio-controls'+(compact?' is-compact':'')}>
    {!compact&&button}<button ref={trigger} type="button" className="track-audio-settings" aria-expanded={open} aria-controls={open?id+'panel':undefined} onClick={()=>setOpen(v=>!v)} aria-label={compact?'Audio settings: '+labels[audio.status]:'Audio settings'} title="Audio settings">{compact?<Speaker on={on}/>:<>Mix <span aria-hidden="true">⌄</span></>}</button>{open&&createPortal(options,document.body)}
  </div>;
}
