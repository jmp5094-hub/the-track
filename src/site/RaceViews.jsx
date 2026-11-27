import {SILKS} from '../broadcast/playback.mjs';
import './site.css';

const money=value=>Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
export function RunnerNumber({id}){
  return <span className="site-runner-number" style={{'--silk':SILKS[id]}}>{id+1}</span>;
}
export function SiteBrand(){
  return <span className="track-wordmark"><span className="track-mark" aria-hidden="true"><i/><i/><i/></span>The Track</span>;
}
export function LobbyView({races,onEnterRace,demoHref='?demo=1',preview=false}){
  const groups=[['Live now',['racing','locked']],['Betting open',['betting']],['Up next',['upcoming']]];
  const featured=races.find(r=>r.status==='racing')||races.find(r=>r.status==='locked')||races[0];
  return <main className="track-lobby site-lobby">
    <header className="site-lobby-hero">
      <div><p className="track-kicker">Six horses. Every roll. One winner.</p><h1>Meet you<br/>at the rail.</h1><p>Pick your runner. Watch for its number.<br/>Every roll can change the race.</p>
        <div className="site-actions">{featured&&<button className="track-primary" onClick={()=>onEnterRace(featured)}>{featured.status==='racing'?'Watch live':'View next race'} <span aria-hidden="true">↗</span></button>}<a className="track-secondary" href={demoHref}>Watch a demo</a></div>
      </div>
      <div className="site-hero-caption"><span>Automatic races</span><strong>All eyes on the next roll.</strong></div>
    </header>
    <div className="site-card-heading"><div><p className="track-kicker">{preview?'Sample race card':'Today at The Track'}</p><h2>The race card</h2></div><p>Races start automatically at post time.</p></div>
    {groups.map(([title,statuses])=>{const list=races.filter(r=>statuses.includes(r.status));return list.length>0&&<section className="site-race-section" key={title} aria-label={title}>
      <h3><span className={'site-status-dot '+(title==='Live now'?'is-live':'')}/>{title}<span>{list.length}</span></h3>
      <div>{list.map(race=><button className="site-race-row" key={race.id} onClick={()=>onEnterRace(race)}>
        <span className="site-post"><small>{race.status==='racing'?'ON TRACK':'POST TIME'}</small><strong>{race.post}</strong></span>
        <span className="site-race-name"><strong>{race.name}</strong><span>{race.typeLabel} · {race.conditionLabel||'Clear track'}{race.friends>0?` · ${race.friends} friends`:''}</span></span>
        <span className="site-race-pot"><small>POOL</small><strong>{money(race.pot)}</strong>{race.ticket>0&&<small>{race.confirmed?'Ticket':'Draft'} {money(race.ticket)}</small>}</span>
        <span className={'site-race-status '+(race.status==='racing'?'is-live':'')}><strong>{race.status==='racing'?'Live':race.countdown}</strong><small>{race.status==='racing'?'Watch race':race.status==='locked'?'To the start':race.status==='betting'?'Bets close':'To post'}</small></span><span aria-hidden="true">↗</span>
      </button>)}</div>
    </section>;})}
    {!races.length&&<p className="site-empty">The next race card is being prepared. You can watch a demo while you wait.</p>}
  </main>;
}

export function RaceEntryView({race,names,typeLabel,description,post,canBet,confirmed,bets={},totalBet,pot,availableBalance,overBalance,countdown,openCountdown,onBack,onBet,onConfirm,preview=false,onWatch}){
  return <main className="site-page site-entry">
    <button className="site-back" onClick={onBack}>← Race lobby</button>
    <header className="site-page-header"><div><p className="track-kicker">{typeLabel} · Post {post}</p><h1>{race.name}</h1><p>{description}</p></div><span className="site-status">{canBet?(confirmed?'Ticket confirmed':'Betting open'):'Coming up'}</span></header>
    {!canBet?<section className="site-panel site-upcoming"><p className="track-kicker">Betting opens in</p><strong>{openCountdown}</strong><p>The race will start automatically at post time.</p></section>:<div className="site-entry-grid">
      <section className="site-panel site-field"><div className="site-section-heading"><div><p className="track-kicker">The field</p><h2>Choose your numbers.</h2></div><span>6 runners</span></div>
        <p className="site-field-help">{preview?'Sample field and ticket layout. Explore the race with the demo below.':'Enter an amount beside each horse you want to back.'}</p>
        <div className="site-field-labels"><span>Horse / number</span><span>Your bet</span></div>
        {names.map((name,id)=><div className={'site-entry-runner '+(Number(bets[id])>0?'is-backed':'')} key={id}>
          <RunnerNumber id={id}/><div><strong>{name}</strong><small>{race.type==='magic_dice'?'First die: '+(id+1):'Roll a '+(id+1)+' to move'}</small></div>
          <label className="site-bet-input"><span aria-hidden="true">$</span><input aria-label={`Bet on number ${id+1} ${name}`} type="number" min="0" placeholder="0" value={bets[id]||''} disabled={preview} onChange={e=>onBet(id,e.target.value)}/></label>
          <button className="site-quick-bet" aria-label={Number(bets[id])>0?`Clear bet on ${name}`:`Add 50 on ${name}`} disabled={preview} onClick={()=>onBet(id,bets[id]?'':'50')}>{Number(bets[id])>0?'−':'+50'}</button>
        </div>)}
      </section>
      <aside className="site-panel site-ticket"><p className="track-kicker">{preview?'Sample ticket':'Your ticket'}</p><div className="site-ticket-total"><span>Total stake</span><strong>{money(totalBet)}</strong></div>
        <dl><div><dt>Race pool</dt><dd>{money(pot)}</dd></div><div><dt>Available balance</dt><dd>{money(availableBalance)}</dd></div><div><dt>Bets close in</dt><dd>{countdown}</dd></div></dl>
        {overBalance&&<p className="site-error" role="alert">Your stake exceeds the available balance.</p>}
        {confirmed&&<p className="site-confirmed" role="status">Your ticket is confirmed. You can edit it until betting closes.</p>}
        {preview?<><p className="site-preview-note">Design preview · sample amounts.<br/>No bets can be placed here.</p><button className="track-primary" onClick={onWatch}>Watch the demo race ↗</button></>:<><button className="track-primary" onClick={onConfirm} disabled={overBalance||totalBet<=0}>{confirmed?'Update bets':'Confirm bets'}</button><p className="site-ticket-note">The race starts automatically. Stay here to watch, with or without a ticket.</p></>}
        <div className="site-rules"><span className="site-dice-mark" aria-hidden="true">{[4,5].map(n=><span key={n}>{Array.from({length:9},(_,i)=><i key={i} className={[0,2,6,8,...(n===5?[4]:[])].includes(i)?'is-pip':''}/>)}</span>)}</span><h3>Root for your number.</h3><p>{race.type==='magic_dice'?'The first die picks the horse. The second sets its distance. Race out and back to win.':race.type==='triple_dice'?'Three dice move their matching horses. Repeated numbers move the same horse again.':race.type==='hurdle'?'Matching dice move your horse. At the hurdle, matching doubles are needed to jump.':race.type==='down_back'?'Matching dice move your horse to the far end, then back home to win.':'Matching dice move the horses. Watch the whole field as each roll changes the race.'}</p></div>
      </aside>
    </div>}
  </main>;
}

export function RaceResultView({race,names,winner,bets={},odds={},userBalance,onReplay,onLobby,preview=false}){
  const hasTicket=Object.values(bets).some(v=>Number(v)>0),stake=Number(bets[winner]||0),payout=stake>0&&odds[winner]?stake*odds[winner]:0;
  return <main className="site-page site-results">
    <p className="track-kicker">{preview?'Sample result':'Race complete'} · {race.name}</p>
    <div className="site-result-hero"><RunnerNumber id={winner}/><span>Across the wire</span><h1>{names[winner]}</h1><p>Wins {race.name}</p></div>
    <div className="site-results-grid"><section className="site-panel site-final-field"><div className="site-section-heading"><h2>The final field</h2><span>Final odds</span></div>
      {names.map((name,id)=><div className={'site-final-row '+(id===winner?'is-winner':'')} key={id}><RunnerNumber id={id}/><strong>{name}</strong>{id===winner&&<span className="site-winner-label">Winner</span>}<span>{odds[id]?`${Number(odds[id]).toFixed(2)}×`:'—'}</span>{Number(bets[id])>0&&<small>Bet {money(bets[id])}</small>}</div>)}
    </section><aside className="site-panel site-result-ticket"><p className="track-kicker">{hasTicket?'Your ticket':'From the rail'}</p><h2>{payout>0?'Winning ticket':hasTicket?'Ticket result':'You saw it happen.'}</h2>
      {payout>0?<><strong className="site-payout">{money(payout)}</strong><p>Payout on a {money(stake)} stake at {Number(odds[winner]).toFixed(2)}×.</p></>:<p>{hasTicket?'Your ticket did not pay out.':'You watched this race without a wager.'}</p>}
      {userBalance!=null&&<p className="site-result-balance">Balance <strong>{money(userBalance)}</strong></p>}
      {preview&&<p className="site-preview-note">Design preview · sample result.</p>}
      <button className="track-primary" onClick={onReplay}>Replay the race</button><button className="track-secondary" onClick={onLobby}>Back to the lobby</button>
    </aside></div>
  </main>;
}
