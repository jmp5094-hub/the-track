import { useEffect, useMemo, useState } from 'react';
import TrackScene from './TrackScene';
import { SILKS, RACE_LABELS, raceOrder, rollCaption } from './presentation.mjs';
import './cinematic.css';

const pipLocations = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const format = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function Die({ value, rolling, index = 0, special }) {
  return <div className={`track-die ${rolling ? 'is-rolling' : ''} ${special ? 'is-special' : ''}`} style={{ '--die-delay': `${index * -0.13}s` }} role="img" aria-label={rolling ? 'Die rolling' : `Die ${index + 1}: ${value || 'not rolled'}${special ? `, ${special}` : ''}`}>
    {Array.from({ length: 9 }, (_, n) => <i key={n} className={!rolling && pipLocations[value]?.includes(n) ? 'pip is-on' : rolling && pipLocations[5].includes(n) ? 'pip is-on' : 'pip'} />)}
    {special && <span className="die-tag">{special}</span>}
  </div>;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return [reduced, setReduced];
}

export default function RaceRoom({ race, names, positions, legDone, diceResult, rolling, rollCount, phase = 'main', winner = null, tieHorses, jumpingHorses, bets = {}, totalPot = 0, onClassic, onChat, isReplay = false, demo = false, stage = 'racing', selectedHorse = 4, onSelectHorse, controls, lockedOdds, seconds, soundControl, moveDuration }) {
  const [cameraMode, setCameraMode] = useState('broadcast');
  const [renderer, setRenderer] = useState('3d');
  const [focusedHorse, setFocusedHorse] = useState(selectedHorse);
  const [reducedMotion, setReducedMotion] = useReducedMotion();
  const order = useMemo(() => raceOrder(positions, legDone, race.type, phase, tieHorses), [positions, legDone, race.type, phase, tieHorses]);
  const commentary = rollCaption({ diceResult, rolling, winner, names, rollCount, phase });
  const roundTrip = race.type === 'down_back' || race.type === 'magic_dice';
  const myTickets = Object.entries(bets).filter(([, amount]) => Number(amount) > 0);
  const choose = i => { setFocusedHorse(i); if (stage === 'betting') onSelectHorse?.(i); };
  return <main className={`track-experience ${demo ? 'is-demo' : ''} stage-${stage} ${reducedMotion ? 'reduce-motion' : ''}`}>
    <header className="track-room-heading">
      <div><p className="track-eyebrow">{demo ? 'The Clubhouse · playable showcase' : isReplay ? 'The Clubhouse · race replay' : 'The Clubhouse · race room'}</p><h1>{race.name}</h1><p className="track-race-meta">{RACE_LABELS[race.type] || race.type}<span>·</span>{race.condition === 'rain' ? 'Heavy rain' : race.condition === 'fog' ? 'Morning fog' : 'Clear track'}<span>·</span>{phase === 'tiebreak' ? '3-space tiebreak' : roundTrip ? '12 spaces out & back' : '12 spaces to the finish'}</p></div>
      <div className="track-status-group"><span className={`track-status ${stage === 'racing' && winner === null ? 'is-live' : ''}`}><i />{winner !== null ? 'Result confirmed' : stage === 'betting' ? 'Demo ticket open' : stage === 'reveal' ? 'Tickets locked' : isReplay ? 'Replay' : demo ? 'Demo race' : 'Race live'}</span>{demo && <small>Simulated credits · no money</small>}</div>
    </header>
    <div className="track-room-layout">
      <section className="track-broadcast" aria-label="Race broadcast">
        <div className="track-stage">
          <TrackScene onRenderer={setRenderer} positions={positions} legDone={legDone} raceType={race.type} condition={race.condition} phase={phase} tieHorses={tieHorses} winner={winner} focusedHorse={focusedHorse} cameraMode={cameraMode} reducedMotion={reducedMotion} rollCount={rollCount} jumpingHorses={jumpingHorses} moveDuration={moveDuration} onFallback={onClassic} />
          <div className="track-stage-top"><span className="track-stage-chip">{winner !== null ? 'At the wire' : phase === 'tiebreak' ? 'Tiebreak' : stage === 'betting' ? 'At the starting gate' : `Roll ${String(rollCount).padStart(2, '0')}`}</span><span className="track-stage-chip">{stage === 'betting' ? 'Odds sealed until close' : 'Bets locked'}</span></div>
          {stage === 'betting' && <div className="track-stage-intro"><span className="track-eyebrow">A familiar game. A new grandstand.</span><h2>Every roll. Everyone on their feet.</h2></div>}
          {stage === 'reveal' && <div className="track-reveal-overlay"><div className="track-eyebrow">Betting has closed</div><h2>The room has spoken.</h2><p>Final returns are revealed. The race is next.</p><div className="track-countdown" aria-label={`Race begins in ${seconds} seconds`}>{seconds}</div></div>}
          {winner !== null && <div className="track-winner-overlay" aria-live="polite"><span className="track-eyebrow">Official result</span><h2>{names[winner]}</h2><p>Number {winner + 1} takes the race.</p></div>}
          <div className="track-camera-controls" role="group" aria-label="Camera view">
            {[['broadcast', 'Broadcast'], ['follow', 'Follow horse'], ...(renderer === '3d' ? [['overhead', 'Overhead']] : [])].map(([id, label]) => <button key={id} type="button" aria-pressed={cameraMode === id} onClick={() => setCameraMode(id)}>{label}</button>)}
          </div>
        </div>
        <div className="track-commentary" aria-live="polite" aria-atomic="true"><span className="track-commentary-icon" aria-hidden="true">◖</span><div><span className="track-eyebrow">{stage === 'betting' ? 'Before the race' : stage === 'reveal' ? 'The reveal' : 'From the booth'}</span><p>{stage === 'betting' ? 'Everyone commits before seeing the final payouts.' : stage === 'reveal' ? 'Betting popularity sets the returns. The dice decide the race.' : commentary}</p></div></div>
        <div className="track-broadcast-bottom">
          <div className="track-dice-box"><div><span className="track-eyebrow">{rolling ? 'Rolling' : 'Latest roll'}</span><p>{race.type === 'magic_dice' ? 'Horse · movement' : 'Each die selects a horse'}</p></div><div className="track-dice-row">{Array.from({ length: race.type === 'triple_dice' ? 3 : 2 }, (_, i) => <Die key={i} index={i} value={diceResult?.dice[i]} rolling={rolling} special={diceResult?.mudDieIdx === i ? 'Mud' : diceResult?.fogDieIdx === i ? 'Fog' : null} />)}</div></div>
          <div className="track-room-tools">{soundControl}<button type="button" aria-pressed={reducedMotion} onClick={() => setReducedMotion(value => !value)}>{reducedMotion ? 'Motion reduced' : 'Reduce motion'}</button>{onChat && <button type="button" onClick={onChat}>Open room chat</button>}{onClassic && <button type="button" onClick={onClassic}>Classic track</button>}</div>
        </div>
      </section>
      <aside className="track-sidebar" aria-label="Your ticket and race order">
        <section className="track-ticket"><span className="track-eyebrow">{stage === 'betting' ? 'Choose your demo horse' : myTickets.length ? 'Your locked ticket' : 'Watching the race'}</span>
          {stage === 'betting' ? <><h2>Who’s your horse?</h2><p>The final returns stay hidden until tickets lock.</p></> : <><h2>{myTickets.length === 1 ? names[Number(myTickets[0][0])] : myTickets.length > 1 ? `${myTickets.length} horses backed` : 'A seat at the rail.'}</h2><p>{myTickets.length ? `${format(myTickets.reduce((sum, [, value]) => sum + Number(value), 0))} ${demo ? 'demo credits' : 'credits'} committed` : 'Follow a horse below. No ticket required.'}</p></>}
          <div className="track-ticket-pool"><span>{demo ? 'Illustrative pool' : 'Shared race pool'}</span><strong>{stage === 'betting' && demo ? 'Sealed' : `${format(totalPot)} credits`}</strong></div>
        </section>
        <section className="track-running-order"><div className="track-section-label"><span className="track-eyebrow">{stage === 'betting' ? 'The field' : stage === 'reveal' ? 'Final returns' : 'Running order'}</span><small>{stage === 'betting' ? '6 runners' : stage === 'reveal' ? 'Includes stake' : 'Exact race progress'}</small></div>
          {(stage === 'betting' || stage === 'reveal' ? names.map((_, id) => ({ id, progress: 0 })) : order).map(({ id, progress }, rank) => <button key={id} type="button" className={`track-runner ${focusedHorse === id ? 'is-focused' : ''}`} aria-pressed={focusedHorse === id} onClick={() => choose(id)}>
            <span className="track-silk" style={{ '--silk': SILKS[id] }}>{id + 1}</span><span className="track-runner-info"><strong>{names[id]}</strong><span>{stage === 'betting' ? id === selectedHorse ? 'Your selection' : 'Select horse' : stage === 'reveal' ? lockedOdds?.[id] ? `${lockedOdds[id].toFixed(2)}× gross return` : 'No backing' : `${positions[id]} / ${phase === 'tiebreak' ? 3 : 12} spaces${roundTrip && phase !== 'tiebreak' ? legDone[id] ? ' · homeward' : ' · outward' : ''}`}</span>{stage === 'racing' && <i className="track-progress"><i style={{ width: `${progress * 100}%`, background: SILKS[id] }} /></i>}</span>{Number(bets[id]) > 0 && <span className="track-backed" aria-label="Your ticket">●</span>}
          </button>)}
        </section>
        {controls && <section className="track-demo-controls">{controls}</section>}
        <p className="track-integrity">{demo ? 'A local demonstration using the existing race rules. The pool is illustrative; no account or payment is connected.' : 'The animation follows the recorded dice results. Camera controls do not affect the race.'}</p>
      </aside>
    </div>
  </main>;
}
