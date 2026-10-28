import { useEffect, useMemo, useRef, useState } from 'react';
import RaceRoom from './RaceRoom';
import { simulateRaceWithHistory } from './rules.mjs';
import { poolReturns, RACE_LABELS } from './presentation.mjs';

const NAMES = ['Copper Crown', 'Silver Lining', 'Velvet Thunder', 'Lucky Break', 'Midnight Run', 'Golden Hour'];
const SAMPLE_POOL = [80, 140, 110, 70, 120, 90];
const EMPTY = () => ({ positions: Array(6).fill(0), legDone: Array(6).fill(false), diceResult: null, rolling: false, rollCount: 0, phase: 'main', winner: null, jumpingHorses: [] });
const CYCLE = 1700;

export default function Showcase() {
  const [stage, setStage] = useState('betting');
  const [type, setType] = useState('standard');
  const [condition, setCondition] = useState('sunny');
  const [selected, setSelected] = useState(4);
  const [seed, setSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const [state, setState] = useState(EMPTY);
  const [seconds, setSeconds] = useState(6);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(false);
  const timer = useRef({ start: 0, pausedAt: 0, offset: 0 });
  const music = useRef(null); const audioContext = useRef(null); const lastSpoken = useRef(-1); 
  const race = useMemo(() => ({ id: `showcase-${seed}`, name: 'The Midnight Cup', type, condition }), [seed, type, condition]);
  const history = useMemo(() => simulateRaceWithHistory(type, condition, seed), [type, condition, seed]);
  const pool = useMemo(() => SAMPLE_POOL.map((value, i) => value + (i === selected ? 10 : 0)), [selected]);
  const returns = poolReturns(pool, stage !== 'betting');
  const totalPot = pool.reduce((sum, n) => sum + n, 0);
  const tieHorses = useMemo(() => {
    const index = history.rolls.findIndex(r => r.phase === 'tiebreak');
    if (index < 1) return null;
    const previous = history.rolls[index - 1], roundTrip = type === 'down_back' || type === 'magic_dice';
    return previous.positions.map((p, i) => roundTrip ? previous.legDone[i] && p <= 0 ? i : null : p >= 12 ? i : null).filter(i => i !== null);
  }, [history, type]);

  useEffect(() => {
    if (stage !== 'reveal') return;
    const deadline = performance.now() + 6000; setSeconds(6);
    const interval = setInterval(() => { const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000)); setSeconds(remaining); if (!remaining) { timer.current = { start: performance.now(), pausedAt: 0, offset: 0 }; setStage('racing'); } }, 100);
    return () => clearInterval(interval);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'racing' || paused || state.winner !== null) return;
    const interval = setInterval(() => {
      const elapsed = performance.now() - timer.current.start - timer.current.offset;
      const index = Math.floor(elapsed / CYCLE), cycle = elapsed % CYCLE;
      if (index >= history.rolls.length) {
        const last = history.rolls.at(-1); setState({ positions: last.positions, legDone: last.legDone, diceResult: last, rolling: false, rollCount: history.rolls.length, phase: last.phase, winner: history.winner, jumpingHorses: [] });
        return;
      }
      const roll = history.rolls[index], previous = history.rolls[index - 1];
      const hasMoved = cycle >= 730;
      const shown = hasMoved ? roll : previous;
      const jumping = type === 'hurdle' && hasMoved ? roll.positions.map((p, i) => p >= 7 && previous?.positions[i] === 5 ? i : null).filter(i => i !== null) : [];
      setState({ positions: shown?.positions || Array(6).fill(0), legDone: shown?.legDone || Array(6).fill(false), diceResult: cycle >= 360 ? roll : null, rolling: cycle < 360, rollCount: index + 1, phase: shown?.phase || 'main', winner: null, jumpingHorses: jumping });
    }, 80);
    return () => clearInterval(interval);
  }, [stage, paused, history, type, state.winner]);

  useEffect(() => {
    if (!sound || paused || stage !== 'racing' || state.rolling || !state.diceResult || lastSpoken.current === state.rollCount) return;
    lastSpoken.current = state.rollCount;
    if (audioContext.current) {
      const ctx = audioContext.current, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.setValueAtTime(190, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.055); gain.gain.setValueAtTime(0.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.09);
    }
    if ('speechSynthesis' in window && (state.rollCount === 1 || state.rollCount % 5 === 0 || state.diceResult.isDoubles)) {
      const mover = state.diceResult.moves.find(m => m.steps > 0);
      if (!mover || speechSynthesis.speaking) return;
      const line = state.rollCount === 1 ? 'And they are away at The Track!' : state.diceResult.isDoubles ? `Doubles for ${NAMES[mover.horse]}!` : `${NAMES[mover.horse]} is called by the dice.`;
      const speech = new SpeechSynthesisUtterance(line); speech.rate = 1.15; speech.volume = 0.85; speechSynthesis.speak(speech);
    }
  }, [sound, paused, stage, state.rollCount, state.rolling, state.diceResult]);

  useEffect(() => {
    if (state.winner !== null && sound && 'speechSynthesis' in window) { speechSynthesis.cancel(); const speech = new SpeechSynthesisUtterance(`${NAMES[state.winner]} wins the Midnight Cup!`); speechSynthesis.speak(speech); }
  }, [state.winner, sound]);
  useEffect(() => () => { music.current?.pause(); audioContext.current?.close(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }, []);

  const toggleSound = () => {
    const next = !sound; setSound(next);
    if (next) {
      if (!music.current) { music.current = new Audio('/Race_Day.mp3'); music.current.loop = true; music.current.volume = 0.13; }
      music.current.play().catch(() => {});
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext && !audioContext.current) audioContext.current = new AudioContext();
      audioContext.current?.resume();
    } else { music.current?.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  };
  const togglePause = () => {
    if (paused) { timer.current.offset += performance.now() - timer.current.pausedAt; setPaused(false); if (sound) music.current?.play().catch(() => {}); }
    else { timer.current.pausedAt = performance.now(); setPaused(true); music.current?.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  };
  const reset = fresh => { setStage('betting'); setState(EMPTY()); setPaused(false); lastSpoken.current = -1; if (fresh) setSeed(crypto.getRandomValues(new Uint32Array(1))[0]); if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  const controls = stage === 'betting' ? <>
    <label>Race format<select aria-label="Race format" value={type} onChange={e => setType(e.target.value)}>{Object.entries(RACE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>Track conditions<select aria-label="Track conditions" value={condition} onChange={e => setCondition(e.target.value)}><option value="sunny">Clear track</option><option value="rain">Heavy rain</option><option value="fog">Fog</option></select></label>
    <button className="track-primary" onClick={() => { setStage('reveal'); document.getElementById('race-room')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }}>Lock demo ticket · 10 credits</button><p>This ticket is simulated. The odds appear after it locks.</p>
  </> : stage === 'reveal' ? <><p>Final gross returns are now visible. These are pool payouts, not predictions of a horse’s chance of winning.</p></> : state.winner !== null ? <>
    <div className="track-results-money">{state.winner === selected ? (10 * returns[selected]).toFixed(2) : '0.00'} credits returned<small>Stake: 10 · Net {state.winner === selected ? `+${(10 * returns[selected] - 10).toFixed(2)}` : '−10.00'} credits</small></div>
    <button className="track-primary" onClick={() => { setState(EMPTY()); setPaused(false); lastSpoken.current = -1; timer.current = { start: performance.now(), pausedAt: 0, offset: 0 }; }}>Replay this race</button>
    <button className="track-secondary" onClick={() => reset(true)}>New demo race</button>
  </> : <><button className="track-secondary" onClick={togglePause}>{paused ? 'Resume demo' : 'Pause demo'}</button><button className="track-secondary" onClick={() => reset(false)}>Return to the starting gate</button><p>Accelerated demo · The original dice and movement rules are preserved.</p></>;
  return <div style={{ background: '#101a16', minHeight: '100vh' }}>
    <header className="track-showcase-nav"><a href="/?showcase=1" className="track-wordmark">THE TRACK</a><nav><a href="#race-room">Race room</a><a href="#how-it-works">How it works</a><a href="/">Existing game</a></nav><span>Playable concept<br />Demo credits only</span></header>
    <div id="race-room"><RaceRoom race={race} names={NAMES} {...state} tieHorses={tieHorses} bets={stage === 'betting' ? {} : { [selected]: 10 }} totalPot={totalPot} demo stage={stage} selectedHorse={selected} onSelectHorse={setSelected} controls={controls} lockedOdds={returns} seconds={seconds} moveDuration={600} soundControl={<button type="button" aria-pressed={sound} onClick={toggleSound}>{sound ? 'Sound & voice on' : 'Enable sound & voice'}</button>} /></div>
    <section className="track-demo-rules" id="how-it-works"><h2>The table is bigger. The game is familiar.</h2><p>Six horses, visible dice, and everyone watching the same outcome. Players commit before the final betting distribution is revealed. More money on a horse means a smaller return per winning credit; betting popularity never changes the dice.</p><p>The showcase runs locally with an illustrative pool and no rake. It uses the current game’s simulator for all five race formats, including weather and tiebreaks. It does not connect to accounts, send bets, or process payments. Sound is optional; browser voice availability varies.</p></section>
  </div>;
}
