import { useMemo, useState } from 'react';
import { RACE_LABELS } from './presentation.mjs';
import './cinematic.css';

const clock = seconds => seconds < 60 ? `${Math.max(0, Math.floor(seconds))}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

export default function ClubhouseLobby({ schedule, now, onEnterRace, userBets = {}, sharedPot = {}, raceStatus, confirmed = {}, betCloseSeconds = 30 }) {
  const [filter, setFilter] = useState('all');
  const races = useMemo(() => schedule.map(race => ({ ...race, status: raceStatus(race, now) })).filter(race => race.status !== 'finished').sort((a, b) => a.startTime - b.startTime), [schedule, now, raceStatus]);
  const featured = races.find(race => race.status === 'racing' || race.status === 'locked') || races.find(race => race.status === 'betting');
  const filtered = races.filter(race => filter === 'all' || race.type === filter);
  const timing = race => race.status === 'racing' ? ['Live', 'Race in progress'] : race.status === 'locked' ? [clock((race.startTime - now) / 1000), 'To the start'] : race.status === 'betting' ? [clock((race.startTime - now) / 1000 - betCloseSeconds), 'Tickets close'] : [clock((race.startTime - now) / 1000), 'To post'];
  return <main className="track-clubhouse"><div className="track-clubhouse-inner">
    <header className="track-lobby-header"><div><span className="track-eyebrow">Welcome to the clubhouse</span><h1>Find your next race.</h1><p>Choose your horse. Lock your ticket. The odds reveal when betting closes—and then the room comes alive.</p></div><a href="/?showcase=1" className="track-showcase-link">Explore the new race experience ↗</a></header>
    {featured && <section className="track-featured-race"><div><span className="track-eyebrow">{featured.status === 'racing' ? 'On the track now' : 'Next at the gate'}</span><h2>{featured.name}</h2><p>{RACE_LABELS[featured.type]} · {featured.condition === 'rain' ? 'Heavy rain' : featured.condition === 'fog' ? 'Fog' : 'Clear track'} · 6 horses</p></div><div><div className="featured-time">{timing(featured)[0]}</div><small>{timing(featured)[1]}</small><button onClick={() => onEnterRace(featured)}>{featured.status === 'betting' ? 'Enter race room' : 'Watch the race'} →</button></div></section>}
    <div className="track-lobby-filters" role="group" aria-label="Filter by race format">{[['all', 'All races'], ...Object.entries(RACE_LABELS)].map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {[['At the gate & live', ['racing', 'locked']], ['Tickets open', ['betting']], ['Coming up', ['upcoming']]].map(([title, statuses]) => { const list = filtered.filter(race => statuses.includes(race.status)); if (!list.length) return null; return <section className="track-lobby-section" key={title}><h2>{title}</h2>{list.map((race, i) => {
      const ticket = confirmed[race.id]; const draft = userBets[race.id]; const pot = sharedPot[race.id]?.totalPot;
      return <button type="button" className="track-race-card" key={race.id} onClick={() => onEnterRace(race)}><span className="track-race-emblem">{String(i + 1).padStart(2, '0')}</span><span><strong>{race.name}</strong><span className="track-card-meta"><span>{RACE_LABELS[race.type]}</span><span>·</span><span>{race.condition === 'rain' ? 'Heavy rain' : race.condition === 'fog' ? 'Fog' : 'Clear track'}</span>{ticket && <span>· Ticket submitted</span>}{!ticket && draft && <span>· Draft ticket</span>}{pot > 0 && <span>· {Number(pot).toLocaleString()} credits in pool</span>}</span></span><span className="track-card-countdown"><b>{timing(race)[0]}</b><small>{timing(race)[1]}</small></span></button>;
    })}</section>; })}
    {!filtered.length && <div className="track-lobby-empty">No races in this format are scheduled yet. Try another format.</div>}
  </div></main>;
}
