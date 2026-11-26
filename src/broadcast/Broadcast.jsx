import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPlayback, LAND, PIPS, SILKS } from './playback.mjs';
import voice from './voice.json';
import './broadcast.css';

const audioUrl = import.meta.env.BASE_URL + 'broadcast/david-wolfe.mp3';
const shots = {gate:'Starting gate',pack:'Trackside',stretch:'Backstretch',wire:'Finish line'};
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

function FlatPositions({ frame }) {
  return <div className="tv-flat" aria-hidden="true">
    {frame.active.map(id => <div className="tv-flat-lane" key={id}>
      <span style={{'--silk':SILKS[id],left:(3+frame.progress[id]/frame.goal*92)+'%'}}>{id+1}</span>
    </div>)}
  </div>;
}

export function Broadcast({ race, history, interval, spaces, tieSpaces, names, clock, startTime, replay,
  speedRef, onFinish, soundOn, onSound, getAudioContext, effects, owners }) {
  const playback = useMemo(() => buildPlayback(history,interval,spaces,tieSpaces,voice),[history,interval,spaces,tieSpaces]);
  const [display,setDisplay] = useState(null);
  const [viewStatus,setViewStatus] = useState('loading');
  const container = useRef(null);
  const view = useRef(null);
  const audio = useRef({});
  const settings = useRef();
  const complete = useRef(false);
  settings.current = {onFinish,soundOn,clock,effects};

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
    let started = false;
    let atWire = false;
    let lastTimestamp;
    let replayTime = 0;
    let nextDraw = 0;
    const draw = timestamp => {
      const {clock,soundOn,onFinish,effects} = settings.current;
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
      if (!frame.rolling && frame.roll && frame.index !== lastSoundRoll) {
        lastSoundRoll = frame.index;
        if (soundOn && frame.into < LAND+.22) effects.land();
      }
      if (frame.done && !atWire) {
        atWire = true;
        if (soundOn && elapsed < playback.end + .16) effects.wire?.();
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
      const ui = [frame.index,frame.rolling,faceTick,frame.exact.join(''),frame.done,frame.shot,cueTag,frame.launched,cameraStatus].join('|');
      if (ui !== lastPaint) {
        lastPaint=ui;
        setDisplay({...frame,dice,contextLost:cameraStatus});
      }
      // Cap rendering on high-refresh monitors without changing the race clock.
      if (timestamp >= nextDraw) {
        view.current?.draw(frame);
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
  const order = frame?.active.slice().sort((a,b) => frame.exact[b]-frame.exact[a] || a-b);
  const caption = frame?.done ? names[frame.winner]+' wins.' : frame?.cue?.text ||
    (frame?.rolling ? 'Dice rolling' : frame?.tiebreak ? 'Tiebreak' : frame?.launched ? 'The field is away.' : 'Six runners at the gate.');
  return <section className={'track-broadcast'+(replay?' is-replay':'')} aria-label="Race broadcast">
    <div className="tv-video">
      <div ref={container} className="tv-viewport" />
      {frame && (viewStatus !== 'ready' || frame.contextLost) && <FlatPositions frame={frame} />}
      <div className="tv-shade" />
      <div className="tv-heading"><span>{replay ? 'Replay' : frame?.tiebreak ? 'Tiebreak' : shots[frame?.shot || 'gate']}</span><h1>{race.name}</h1></div>
      {frame && <div className="tv-dice" aria-label={frame.rolling?'Dice rolling':frame.roll?'Dice '+frame.roll.dice.join(' and '):'Dice ready'}>
        <span>Roll <strong>{Math.max(0,frame.index+1)}</strong></span>
        <div>{(frame.dice || [0,0]).map((value,id) => <Dice key={id} value={value} rolling={frame.rolling}
          weather={!frame.rolling && frame.roll?.mudDieIdx===id?'is-mud':!frame.rolling && frame.roll?.fogDieIdx===id?'is-fog':null}/>)}</div>
      </div>}
      <div className="tv-caption">{history ? caption : 'Loading the race…'}</div>
      {frame?.done && <div className="tv-winner" role="status">Winner <b>{frame.winner+1}</b></div>}
    </div>
    <div className="tv-controls">
      <p>{race.condition === 'rain' ? 'Rain' : race.condition === 'fog' ? 'Fog' : 'Standard race'}</p>
      <button type="button" onClick={() => { if (!soundOn) unlock(); onSound(!soundOn); }} aria-pressed={soundOn}>
        {soundOn ? 'Sound on' : 'Enable race sound'}
      </button>
    </div>
    {frame && <div className="tv-order">
      <h2>Running order</h2>
      <ol>{order.map(id => <li key={id}>
        <b style={{'--silk':SILKS[id],'--number':[1,2].includes(id)?'#221b13':'#fff8eb'}}>{id+1}</b>
        <span><strong title={names[id]}>{names[id]}</strong><small>{frame.done && frame.winner===id?'Winner':frame.goal-frame.exact[id]+' to go'}{owners?.[id]?.username ? ' · '+owners[id].username : ''}</small></span>
      </li>)}</ol>
    </div>}
    <p className="tv-credit">Commentary by David Wolfe. Horse model and gallop by <a href="https://vinish.dev/free-3d-models/horses">vinish.dev</a>, recolored · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
  </section>;
}
