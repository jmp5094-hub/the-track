import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPlayback, LAND, MOVE, PIPS, SILKS } from './playback.mjs';
import voice from './voice.json';
import './broadcast.css';

const audioUrl = import.meta.env.BASE_URL + 'broadcast/david-wolfe.mp3';
const shots = {gate:'Starting gate',pack:'Trackside',lead:'Lead change',wire:'Finish line'};
const spacesText = value => value === 1 ? '1 space to finish' : value + ' spaces to finish';
const badge = id => ({'--silk':SILKS[id], '--number':[1,2].includes(id) ? '#211b13' : '#fffaf1'});
let voiceBytes;
function loadVoice() {
  voiceBytes ??= fetch(audioUrl).then(response => {
    if (!response.ok) throw new Error('Commentary download failed.');
    return response.arrayBuffer();
  }).catch(error => { voiceBytes = undefined; throw error; });
  return voiceBytes;
}

function Dice({ value, rolling, weather }) {
  return <span aria-hidden="true" className={'tv-die'+(rolling?' is-rolling':'')+(weather?' '+weather:'')}>
    {Array.from({length:9},(_,i) => <i key={i} className={PIPS[value]?.includes(i) ? 'is-pip' : ''} />)}
  </span>;
}

function FlatPositions({ frame, followed }) {
  return <div className="tv-flat" aria-hidden="true">
    <div className="tv-flat-labels"><span>Gate</span><span>Finish</span></div>
    {frame.active.map(id => <div className="tv-flat-lane" key={id} style={{'--grid':100/frame.goal+'%'}}>
      <span className={id===followed ? 'is-followed' : ''} style={{...badge(id),left:(frame.progress[id]/frame.goal*100)+'%'}}>{id+1}</span>
    </div>)}
  </div>;
}

function Field({ frame, names, followed, onFollow, backed, owners }) {
  return <div className="tv-field">
    <div className="tv-field-heading"><h2>Track positions</h2><span>Spaces left</span></div>
    {frame.active.map(id => {
      const distance=Math.max(0,frame.goal-frame.exact[id]);
      return <button key={id} type="button" className="tv-field-runner" onClick={()=>onFollow(id)} aria-pressed={followed===id} aria-label={'Follow #'+(id+1)+' '+names[id]+', '+spacesText(distance)}>
        <b className="tv-badge" style={badge(id)}>{id+1}</b>
        <span className="tv-runner-name"><strong title={names[id]}>{names[id]}</strong>
          {backed.includes(id) && <small>Your ticket</small>}
          {!backed.includes(id) && owners?.[id]?.username && <small>{owners[id].username}</small>}
        </span>
        <span className="tv-strip" aria-hidden="true" style={{'--grid':100/frame.goal+'%'}}>
          <i style={{...badge(id),left:(frame.exact[id]/frame.goal*100)+'%'}} />
        </span>
        <strong className="tv-spaces">{distance}</strong>
      </button>;
    })}
  </div>;
}

export function Broadcast({ race, history, interval, spaces, tieSpaces, names, clock, startTime, replay,
  speedRef, onFinish, soundOn, onSound, getAudioContext, effects, owners, backed = [], initialFollow, exhibition = false }) {
  const playback = useMemo(() => buildPlayback(history,interval,spaces,tieSpaces,voice),[history,interval,spaces,tieSpaces]);
  const [display,setDisplay] = useState(null);
  const [viewStatus,setViewStatus] = useState('loading');
  const [viewMode,setViewMode] = useState('directed');
  const [preferred,setPreferred] = useState(initialFollow ?? null);
  const container = useRef(null);
  const view = useRef(null);
  const audio = useRef({});
  const settings = useRef();
  const complete = useRef(false);
  settings.current = {onFinish,soundOn,clock,effects,viewMode};

  function stopVoice() {
    const active = audio.current.source;
    if (active) { active.stop(); audio.current.source = null; }
  }
  function unlock() {
    try {
      const ctx = getAudioContext();
      ctx.resume().catch(() => {});
      const state = audio.current;
      state.context = ctx;
      state.bufferPromise ??= loadVoice().then(data => ctx.decodeAudioData(data.slice(0))).then(buffer => {
        state.buffer = buffer;
      }).catch(() => { state.bufferPromise = undefined; });
    } catch {}
  }
  useEffect(() => {
    if (!soundOn) { stopVoice(); return; }
    unlock();
    window.addEventListener('pointerdown',unlock,{passive:true});
    window.addEventListener('keydown',unlock);
    return () => {
      window.removeEventListener('pointerdown',unlock);
      window.removeEventListener('keydown',unlock);
    };
  },[soundOn]);
  useEffect(() => () => stopVoice(),[]);

  useEffect(() => {
    let cancelled = false;
    const target = container.current;
    import('./track-view').then(({createTrackView}) => createTrackView(target)).then(scene => {
      if (cancelled) {scene.dispose(); return;}
      view.current = scene;
      setViewStatus('ready');
    }).catch(() => { if (!cancelled) setViewStatus('fallback'); });
    return () => { cancelled = true; view.current?.dispose(); view.current = null; };
  },[]);

  useEffect(() => {
    if (!playback) return;
    let timer;
    let lastPaint = '';
    let lastCue = '';
    let lastSoundRoll = -2;
    let lastSpin = -2;
    let lastMoveSound = -2;
    let started = false;
    let atWire = false;
    let lastTimestamp;
    let replayTime = 0;
    let nextDraw = 0;
    const draw = timestamp => {
      const {clock,soundOn,onFinish,effects,viewMode} = settings.current;
      const speed = replay ? speedRef?.current || 1 : 1;
      if (replay && lastTimestamp !== undefined) replayTime += (timestamp-lastTimestamp)/1000 * speed;
      lastTimestamp = timestamp;
      const elapsed = replay ? replayTime : (clock()-startTime)/1000;
      const frame = playback.sample(elapsed);
      const state = audio.current;
      if (frame.launched && !started) {
        started = true;
        if (elapsed < 1.35 && soundOn) effects.gate();
      }
      if (frame.rolling && frame.index !== lastSpin) {
        lastSpin = frame.index;
        if (soundOn && frame.into < .25) effects.spin?.();
      }
      if (!frame.rolling && frame.roll && frame.index !== lastSoundRoll) {
        lastSoundRoll = frame.index;
        if (soundOn && frame.into < LAND+.22) effects.land();
      }
      if (frame.roll && frame.into >= MOVE && frame.index !== lastMoveSound) {
        lastMoveSound = frame.index;
        if (soundOn && frame.into < MOVE+.28 && frame.movements.length) {
          effects.move?.(Math.max(...frame.movements.map(move=>Math.abs(move.steps))));
        }
      }
      if (frame.done && !atWire) {
        atWire = true;
        if (soundOn && elapsed < playback.winsAt + .28) effects.wire?.();
      }
      const cue = frame.cue;
      const cueTag = cue ? cue.key+'@'+cue.time : '';
      if (cue && cueTag !== lastCue) {
        const voiceTime = frame.time-cue.time;
        if (voiceTime < .24 && soundOn && state.context?.state === 'running' && state.buffer) {
          stopVoice();
          const source = state.context.createBufferSource();
          source.buffer = state.buffer;
          source.playbackRate.value = speed;
          const gain = state.context.createGain();
          gain.gain.value = .9;
          source.connect(gain).connect(state.context.destination);
          source.onended = () => {
            source.disconnect();
            gain.disconnect();
            if (state.source === source) state.source = null;
          };
          source.start(0,cue.offset+voiceTime,cue.duration-voiceTime);
          state.source = source;
          lastCue = cueTag;
        }
      }
      const faceTick = frame.rolling ? Math.floor(frame.into*16) : -1;
      const dice = frame.rolling ? [(faceTick*3+frame.index)%6+1,(faceTick*5+frame.index+2)%6+1] : frame.roll?.dice || [0,0];
      const cameraStatus = container.current?.dataset.contextLost === 'true';
      const ui = [frame.index,frame.rolling,faceTick,frame.exact.join(','),frame.amount>=1,frame.done,frame.shot,cueTag,frame.launched,cameraStatus].join('|');
      if (ui !== lastPaint) {
        lastPaint=ui;
        setDisplay({...frame,dice,contextLost:cameraStatus});
      }
      // Cap rendering on high-refresh monitors without changing the race clock.
      if (timestamp >= nextDraw) {
        if (viewMode !== 'board') view.current?.draw(frame,viewMode === 'steady');
        nextDraw=timestamp+25;
      }
      if (elapsed >= playback.end+playback.endHold) {
        if (!complete.current) { complete.current=true; onFinish(frame.winner); }
        return;
      }
      timer=requestAnimationFrame(draw);
    };
    timer=requestAnimationFrame(draw);
    return () => cancelAnimationFrame(timer);
  },[playback,replay,speedRef,startTime]);

  const frame = display || playback?.sample(0);
  const followed = frame?.active.includes(preferred) ? preferred : frame?.active.find(id=>backed.includes(id));
  const leader = frame?.leaders[0];
  const followDistance = followed === undefined ? null : Math.max(0,frame.goal-frame.exact[followed]);
  const leaderDistance = leader === undefined ? null : Math.max(0,frame.goal-frame.exact[leader]);
  const flat = viewStatus !== 'ready' || viewMode === 'board' || display?.contextLost;
  const moveLabel = frame?.lastMove.map(move => '#'+(move.id+1)+' '+(move.steps>0 ? '+' : '−')+Math.abs(move.steps)).join('  ·  ');
  const faces = frame?.previousRoll?.dice.join(' + ');
  const twinned = frame?.previousRoll?.isDoubles ?? (frame?.previousRoll?.dice[0] === frame?.previousRoll?.dice[1] && frame?.lastMove.some(move=>move.steps===2));
  const weather = frame?.previousRoll?.fogDieIdx != null ? 'Fog' : frame?.previousRoll?.mudDieIdx != null ? 'Mud' : '';
  const looks = followDistance === 1 ? 'A '+(followed+1)+' can win it.' : followDistance === 2 ? 'Double '+(followed+1)+' can win it.' : '';
  const showHint = !frame?.done && race.condition === 'sunny' && followDistance !== null && followDistance>0;
  const caption = !history ? 'Loading the race…' : frame?.done ? names[frame.winner]+' wins.' :
    frame?.cue?.text || (frame?.rolling ? 'Dice rolling' : frame?.tiebreak ? 'Tiebreak · '+frame.goal+' spaces' :
      frame?.launched ? (frame?.index < 0 ? 'The gates are open' : '') : 'The field is at the gate');
  return <section className={'track-broadcast'+(replay?' is-replay':'')} aria-label="Race broadcast">
    <header className="tv-header">
      <div><p className="track-kicker">{exhibition ? 'Exhibition · Standard' : replay ? 'Replay · Standard' : 'Live · Standard'}{race.condition==='rain' ? ' · Heavy rain' : race.condition==='fog' ? ' · Fog' : ''}</p>
        <h1>{race.name}</h1></div>
      <div className="tv-controls" aria-label="Broadcast controls">
        <label><span className="tv-visually-hidden">Camera</span><select aria-label="Camera" value={viewMode} onChange={event=>setViewMode(event.target.value)}>
          <option value="directed">Broadcast camera</option><option value="steady">Steady camera</option><option value="board">2D board</option>
        </select></label>
        <button type="button" onClick={() => { if (!soundOn) unlock(); onSound(!soundOn); }} aria-pressed={soundOn}>
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </header>
    <div className="tv-layout">
      <div className="tv-stage">
        <div className="tv-video">
          <div className={'tv-viewport'+(flat?' is-hidden':'')} ref={container} />
          {frame && flat && <FlatPositions frame={frame} followed={followed}/>}
          <div className={"tv-shade"+(race.condition==="rain" ? " is-rain" : race.condition==="fog" ? " is-fog" : "")} />
          <div className="tv-angle">{frame?.tiebreak ? 'Tiebreak' : flat ? 'Track board' : shots[frame?.shot || 'gate']}</div>
          {frame && <div className={'tv-dice'+(frame.rolling?' is-active':'')} aria-label={frame.rolling?'Dice rolling':frame.roll?'Dice '+frame.roll.dice.join(' and '):'Dice ready'}>
            <span>{frame.index<0 ? 'At the gate' : 'Roll '+(frame.index+1)}</span>
            <div>{(frame.dice || [0,0]).map((value,id) => <Dice key={id} {...{value}} rolling={frame.rolling}
              weather={!frame.rolling && frame.roll?.mudDieIdx===id?'is-mud':!frame.rolling && frame.roll?.fogDieIdx===id?'is-fog':null}/>)}</div>
          </div>}
          {caption && <p className="tv-caption">{caption}</p>}
          {frame?.done && <div className="tv-winner" role="status"><b>#{frame.winner+1}</b> Wins</div>}
        </div>
        <div className="tv-last" role="status">
          <span>Last roll</span>
          {faces ? <><strong>{faces}</strong>{(weather || twinned) && <b>{weather || 'Doubles'}</b>}<span>{moveLabel || 'No movement'}</span></> : <span>Awaiting first roll</span>}
        </div>
      </div>
      {frame && <aside className="tv-telemetry">
        <div className="tv-leaders">
          <div>
            <p>{frame.done ? 'Winner' : frame.leaders.length>1 ? 'Tied for lead' : 'Leading'}</p>
            <div className="tv-leader-id">
              {(frame.done ? [frame.winner] : frame.leaders).map(id=><b key={id} className="tv-badge" style={badge(id)}>{id+1}</b>)}
              {(frame.done || frame.leaders.length===1) && <strong title={names[frame.done ? frame.winner : leader]}>{names[frame.done ? frame.winner : leader]}</strong>}
            </div>
            <strong className="tv-distance">{frame.done ? 'Across the wire' : spacesText(leaderDistance)}</strong>
          </div>
          <div>
            <p>{followed !== undefined && backed.includes(followed) ? 'Your ticket' : 'Following'}</p>
            {followed !== undefined ? <><div className="tv-leader-id"><b className="tv-badge" style={badge(followed)}>{followed+1}</b>
              <strong title={names[followed]}>{names[followed]}</strong></div>
              <strong className="tv-distance">{spacesText(followDistance)}</strong>
              {showHint && looks && <small className="tv-follow-hint">{looks}</small>}
            </> : <small className="tv-follow-hint">{preferred!==null && frame.tiebreak ? 'Pick a horse in the tiebreak.' : 'Tap a horse to follow it.'}</small>}
          </div>
        </div>
        <Field {...{frame,names,followed,backed,owners}} onFollow={setPreferred}/>
      </aside>}
    </div>
    <p className="tv-credit">Commentary by David Wolfe. Horse model and gallop by <a href="https://vinish.dev/free-3d-models/horses">vinish.dev</a>, recolored · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
  </section>;
}
