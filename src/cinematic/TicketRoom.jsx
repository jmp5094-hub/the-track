import { RACE_LABELS, SILKS } from './presentation.mjs';
import './cinematic.css';

const credits = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = n => `${Math.floor(Math.max(0,n)/60)}:${String(Math.max(0,n)%60).padStart(2,'0')}`;

export function TicketRoom({ race, names, description, bets, total, available, overBalance, confirmed, canBet, seconds, onChange, onConfirm, onEdit, onBack }) {
  return <main className="track-experience track-entry-room">
    <div className="track-entry-inner">
      <button className="track-back" onClick={onBack}>← Back to the clubhouse</button>
      <header className="track-room-heading"><div><p className="track-eyebrow">The race card · {RACE_LABELS[race.type]}</p><h1>{race.name}</h1><p className="track-race-meta">{new Date(race.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<span>·</span>{race.condition === 'rain' ? 'Heavy rain' : race.condition === 'fog' ? 'Fog' : 'Clear track'}</p></div><span className="track-status">{canBet ? `Tickets close in ${clock(seconds)}` : 'Betting opens later'}</span></header>
      <div className="track-ticket-layout"><section><div className="track-entry-intro"><h2>Who are you cheering for?</h2><p>{description}</p><p>Back one horse or several. Payouts stay hidden until everyone’s ticket is locked.</p></div>
        <div className="track-entry-field">{names.map((name,id) => <label className="track-entry-runner" key={id}><span className="track-silk" style={{'--silk':SILKS[id]}}>{id+1}</span><span><strong>{name}</strong><small>Final return revealed after close</small></span><span className="track-entry-amount"><input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Credits on ${name}`} placeholder="0.00" value={bets[id] || ''} disabled={!canBet || confirmed} onChange={e => onChange(id,e.target.value)} /><small>credits</small></span></label>)}</div>
      </section><aside className="track-ticket track-entry-summary"><p className="track-eyebrow">Your race ticket</p><h2>{credits(total)} credits</h2><p>{Object.values(bets).filter(v=>Number(v)>0).length} horses backed</p><div className="track-ticket-pool"><span>Available for this race</span><strong>{credits(available)}</strong></div><div className="track-sealed-note"><span aria-hidden="true">◇</span><div><strong>Odds stay sealed</strong><p>More money on a horse means a smaller payout per winning credit. The dice decide who wins.</p></div></div>
        {overBalance && <p className="track-error" role="alert">Your ticket exceeds the available balance.</p>}
        {confirmed ? <><p role="status" className="track-confirmation">Ticket submitted. You can edit it until betting closes.</p><button className="track-primary" disabled={!canBet} onClick={onEdit}>Edit your ticket</button></> : <button className="track-primary" disabled={!canBet || overBalance || total<=0} onClick={onConfirm}>{canBet ? 'Confirm ticket' : 'Betting is not open'}</button>}
        <p className="track-integrity">The race starts automatically at post time. This version uses game credits.</p>
      </aside></div>
    </div>
  </main>;
}

export function RevealRoom({ race, names, bets, totalPot, odds, seconds, revealCount = 6, onBack }) {
  const sorted = names.map((name,id)=>({name,id,odds:odds[id]})).sort((a,b)=>(a.odds ?? Infinity)-(b.odds ?? Infinity));
  return <main className="track-experience track-entry-room"><div className="track-entry-inner">
    {onBack && <button className="track-back" onClick={onBack}>← Back to the clubhouse</button>}
    <header className="track-room-heading"><div><p className="track-eyebrow">Tickets locked · {RACE_LABELS[race.type]}</p><h1>{race.name}</h1><p className="track-race-meta">The final returns are in. Meet your field.</p></div><div className="track-countdown" aria-label={`Race begins in ${seconds} seconds`}>{seconds}</div></header>
    <div className="track-ticket-layout"><section><div className="track-entry-intro"><h2>The room has spoken.</h2><p>Returns include your stake. Popularity determines the payout, never the dice.</p></div><div className="track-entry-field">{sorted.map(({id,name,odds:odd},rank) => <div className="track-entry-runner" key={id}><span className="track-silk" style={{'--silk':SILKS[id]}}>{id+1}</span><span><strong>{name}</strong><small>{rank < revealCount ? Number(bets[id]) > 0 ? `Your ticket: ${credits(bets[id])} credits` : rank===0 && odd ? 'Most backed' : 'Final gross return' : 'Revealing shortly'}</small></span><strong className="track-final-odds">{rank < revealCount ? odd ? `${Number(odd).toFixed(2)}×` : '—' : '•••'}</strong></div>)}</div></section>
    <aside className="track-ticket track-entry-summary"><p className="track-eyebrow">Shared race pool</p><h2>{credits(totalPot)} credits</h2><p>Combined backing from the room.</p><div className="track-ticket-pool"><span>Your committed stake</span><strong>{credits(Object.values(bets).reduce((s,v)=>s+Number(v),0))}</strong></div><div className="track-sealed-note"><span aria-hidden="true">◇</span><div><strong>The gates are next.</strong><p>Stay here to join the race automatically. A dash means no recorded backing for that horse.</p></div></div></aside></div>
  </div></main>;
}
