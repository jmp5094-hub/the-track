import { useRef, useState } from 'react';
import { Broadcast } from './Broadcast';
import { BOARD_SPACES } from './playback.mjs';
import { exhibitionRace, exhibitionHistory, exhibitionNames, exhibitionInterval } from './exhibition.mjs';

export function Exhibition({ getAudioContext, effects, getSoundEnabled, onSound }) {
  const [picked,setPicked]=useState(3);
  const [take,setTake]=useState(new URLSearchParams(window.location.search).get('play')==='1' ? 1 : 0);
  const [winner,setWinner]=useState(null);
  const [soundOn,setSoundOn]=useState(getSoundEnabled);
  const [speed,setSpeed]=useState(1);
  const [clipStatus,setClipStatus]=useState('');
  const speedRef=useRef(1);
  const start=()=>{
    if (soundOn) getAudioContext().resume().catch(()=>{});
    speedRef.current=1;
    setSpeed(1);
    setWinner(null);
    setTake(current=>current+1);
  };
  const toggleSpeed=()=>{
    const next=speed===1 ? 2 : 1;
    speedRef.current=next;
    setSpeed(next);
  };
  const exportClip=async()=>{
    setClipStatus('Recording the finish…');
    try {
      const {downloadFinishClip}=await import('./recording');
      await downloadFinishClip(picked);
      setClipStatus('Finish clip downloaded.');
    } catch {
      setClipStatus('This browser could not record the finish.');
    }
  };
  return <main className="track-exhibition">
    <nav className="track-exhibition-nav" aria-label="Exhibition">
      <a className="track-quiet-link" href={import.meta.env.BASE_URL}>The Track</a>
      <div className="track-exhibition-actions">
        {take>0 && winner===null && <button type="button" className="track-secondary" onClick={toggleSpeed}>{speed===1 ? '1× speed' : '2× speed'}</button>}
        {take>0 && <button type="button" className="track-secondary" onClick={start}>Restart race</button>}
      </div>
    </nav>
    {take===0 ? <section className="track-exhibition-intro">
      <p className="track-kicker">Standard exhibition</p>
      <h1>Pick a horse. Watch the dice.</h1>
      <p>Each die moves the horse with that number. Doubles move it two spaces.</p>
      <div className="track-exhibition-picks" aria-label="Choose a horse to follow">
        {exhibitionNames.map((name,id)=><button type="button" key={name} className="track-secondary" aria-pressed={picked===id} onClick={()=>setPicked(id)}>#{id+1} {name}</button>)}
      </div>
      <button type="button" className="track-primary" onClick={start}>Start demo race</button>
    </section> : <>
      <Broadcast key={take} exhibition replay history={exhibitionHistory} race={exhibitionRace} names={exhibitionNames}
        interval={exhibitionInterval} spaces={BOARD_SPACES} tieSpaces={3} speedRef={speedRef} initialFollow={picked}
        getAudioContext={getAudioContext} effects={effects} soundOn={soundOn} onSound={next=>{onSound(next);setSoundOn(next);}}
        onFinish={setWinner}/>
      {winner!==null && <section className="track-exhibition-result" aria-label="Exhibition result">
        <h2>#{winner+1} {exhibitionNames[winner]} wins</h2>
        <p>Double {winner+1}s sent {exhibitionNames[winner]} across the wire on roll {exhibitionHistory.rolls.length}.</p>
        <div className="track-exhibition-actions">
          <button type="button" className="track-primary" onClick={start}>Watch again</button>
          <button type="button" className="track-secondary" onClick={()=>setTake(0)}>Choose a horse</button>
        </div>
      </section>}
    </>}
    <div className="track-exhibition-export">
      <button type="button" className="track-secondary" disabled={clipStatus==='Recording the finish…'} onClick={exportClip}>Download finish clip</button>
      <span role="status">{clipStatus}</span>
    </div>
  </main>;
}
