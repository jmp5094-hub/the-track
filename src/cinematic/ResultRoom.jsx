import { SILKS } from './presentation.mjs';
import './cinematic.css';
const fmt = n => Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

export default function ResultRoom({race,names,bets,odds,winner,userBalance,onLobby}) {
  const stake = Object.values(bets).reduce((sum,value)=>sum+Number(value),0);
  const returned = Number(bets[winner] || 0) * Number(odds[winner] || 0);
  const net = returned - stake;
  return <main className="track-experience track-result-room"><div className="track-result-inner">
    <p className="track-eyebrow">{race.name} · Official result</p>
    <div className="track-winner-medal" style={{'--silk':SILKS[winner]}}><span>{winner+1}</span></div>
    <p className="track-eyebrow">First across the line</p><h1>{names[winner]}</h1><p className="track-result-subtitle">One finish. A whole room of stories.</p>
    <section className="track-settlement" aria-label="Your result"><div><span>Your stake</span><strong>{fmt(stake)}</strong></div><div><span>Credits returned</span><strong>{fmt(returned)}</strong></div><div><span>Net result</span><strong>{net>0 ? '+' : net<0 ? '−' : ''}{fmt(Math.abs(net))}</strong></div></section>
    <p className="track-integrity">{stake ? 'Returned credits include the winning stake.' : 'You watched this race without a ticket.'} Balance: {fmt(userBalance)} credits.</p>
    <div className="track-result-field">{names.map((name,id)=><div className="track-entry-runner" key={id}><span className="track-silk" style={{'--silk':SILKS[id]}}>{id+1}</span><span><strong>{name}{id===winner ? ' · Winner' : ''}</strong><small>{Number(bets[id])>0 ? `${fmt(bets[id])} credits backed` : 'No ticket'}</small></span><strong className="track-final-odds">{odds[id] ? `${Number(odds[id]).toFixed(2)}×` : '—'}</strong></div>)}</div>
    <button className="track-primary" onClick={onLobby}>Back to the clubhouse</button>
  </div></main>;
}
