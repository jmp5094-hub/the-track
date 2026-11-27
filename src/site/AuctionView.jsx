import {RunnerNumber,RaceEntryView} from './RaceViews';
import {RunnerSilk} from './RunnerSilk';

const money=value=>Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD'});

export function AuctionView({race,names,typeLabel,conditionLabel,post,phase,auction,ticket,tab,onTab,onBack,username}){
  const live=phase==='auction',reveal=phase==='reveal'||phase==='racing';
  const current=auction.currentHorseId;
  const bidValid=Number.isFinite(Number(auction.amount))&&Number(auction.amount)>=auction.minBid&&Number(auction.amount)<=ticket.cashBalance;
  return <main className="site-page site-auction">
    <button className="site-back" onClick={onBack}>← Auction race card</button>
    <header className="site-page-header"><div><p className="track-kicker">Auction race · {typeLabel} · {conditionLabel}</p><h1>{race.name}</h1><p>Own a runner. Back a winner. Follow the field to the wire.</p></div><span className="site-status">{live?'Auction live':reveal?'To the starting gate':'Auction coming up'}</span></header>
    <div className="site-auction-timeline"><span><b>01</b> Six 30-second lots</span><span><b>02</b> Place your race bets</span><span><b>03</b> Automatic start · {post}</span></div>
    {!reveal&&<nav className="site-auction-tabs" aria-label="Auction sections"><button aria-pressed={tab==='auction'} onClick={()=>onTab('auction')}>The auction</button><button aria-pressed={tab==='bets'} onClick={()=>onTab('bets')}>Race ticket{ticket.total>0&&<span>{money(ticket.total)}</span>}</button><p>Ownership and race bets are separate.</p></nav>}

    {reveal?<div className="site-entry-grid">
      <section className="site-panel"><div className="site-section-heading"><div><p className="track-kicker">The field is set</p><h2>Meet the owners.</h2></div><span>6 runners</span></div>
        {names.map((name,id)=>{const owner=auction.owners[id],shown=id<auction.revealCount;const stake=ticket.poolBets[id]||0,odds=stake>0&&ticket.pool>0?ticket.pool/stake:null;return <div className={'site-auction-owner '+(shown?'is-revealed':'')} key={id}>
          <RunnerNumber id={id}/><div><strong>{name}</strong><small>{shown?(owner?`${owner.username===username?'You':owner.username} · ${money(owner.amount)}`:'House runner · no owner'):'Owner reveal coming up'}</small></div><span>{shown&&odds?`${odds.toFixed(2)}×`:'—'}</span>
        </div>;})}
      </section>
      <aside className="site-panel site-ticket site-auction-countdown"><p className="track-kicker">Race starts in</p><strong className="site-auction-clock">{auction.firesIn}</strong><h2>All eyes on the gate.</h2><p>The race starts automatically. Stay here for the first roll.</p><dl><div><dt>Auction total</dt><dd>{money(auction.pot)}</dd></div><div><dt>Race betting pool</dt><dd>{money(ticket.pool)}</dd></div><div><dt>Your confirmed ticket</dt><dd>{money(ticket.confirmedPot)}</dd></div></dl></aside>
    </div>:tab==='bets'?<RaceEntryView embedded race={race} names={names} canBet confirmed={ticket.confirmed} bets={ticket.bets} totalBet={ticket.total} pot={ticket.pool} availableBalance={ticket.availableBalance} overBalance={ticket.total>ticket.availableBalance} countdown={auction.endsIn} onBet={ticket.onBet} onConfirm={ticket.onConfirm}/>:<div className="site-entry-grid site-auction-grid">
      <section className="site-panel site-auction-ring" aria-label="Auction ring">
        {auction.sold&&auction.sold.hi>=0&&<div className="site-auction-sale" role="status"><strong>{auction.sold.winner?'Sold':'No sale'} · {names[auction.sold.hi]}</strong><span>{auction.sold.winner?`${auction.sold.winner} · ${money(auction.sold.winAmt)}`:'This horse stays with the house.'}</span></div>}
        {live?<>
          <div className="site-section-heading"><div><p className="track-kicker">In the ring</p><span className="site-auction-lot">Lot {auction.currentSlot+1} of 6</span></div><div className={'site-auction-lot-timer '+(auction.seconds<=5?'is-urgent':'')}><strong>{Math.ceil(auction.seconds)}s</strong><span>until the hammer</span></div></div>
          <div className="site-auction-progress" aria-label={`Lot ${auction.currentSlot+1} of 6`}>{auction.order.map((id,index)=><span key={id} className={index<auction.currentSlot?'is-done':index===auction.currentSlot?'is-current':''}/>)}</div>
          <div className="site-auction-horse"><RunnerSilk horseId={current} width={150} height={114}/><div><p className="track-kicker">Runner {current+1}</p><h2>{names[current]}</h2><p>{race.type==='magic_dice'?`First die ${current+1} picks this horse.`:`Watch for ${current+1} on the dice.`}</p></div></div>
          <div className="site-auction-price"><div><span>{auction.topBid?'Leading bid':'Opening bid'}</span><strong>{money(auction.topBid?.[1]||auction.minBid)}</strong></div><p>{auction.topBid?(auction.topBid[0]===username?'You lead this lot.':`Led by ${auction.topBid[0]}`):'Be the first to raise your paddle.'}</p></div>
          {auction.canBid?<form className="site-auction-bid" onSubmit={e=>{e.preventDefault();if(bidValid&&!auction.pending)auction.onBid();}}><label htmlFor="auction-bid">Your bid <span>Minimum {money(auction.minBid)}</span></label><div><span className="site-bet-input"><span aria-hidden="true">$</span><input id="auction-bid" type="number" min={auction.minBid} step="1" placeholder={String(auction.minBid)} value={auction.amount} onChange={e=>auction.onAmount(e.target.value)} disabled={auction.pending}/></span><button className="track-primary" disabled={!bidValid||auction.pending}>{auction.pending?'Placing bid…':'Place bid'}</button></div><p>Leading bids are held from your balance. An outbid hold is returned.</p></form>:<p className="site-confirmed">{auction.iOwn?'You own a runner. Follow the remaining lots, or place a race bet.':'You are the high bidder. Hold your breath for the hammer.'}</p>}
          {auction.error&&<p className="site-error" role="alert">{auction.error}</p>}
          {auction.bidEntries.length>0&&<div className="site-auction-bids"><h3>Bids on this runner</h3>{auction.bidEntries.map(([name,amount],index)=><div key={name}><span>{name===username?'You':name}{index===0&&<small>Leading</small>}</span><strong>{money(amount)}</strong></div>)}</div>}
        </>:<div className="site-auction-waiting"><p className="track-kicker">The ring opens in</p><strong className="site-auction-clock">{auction.opensIn}</strong><h2>Choose your runner.</h2><p>Six horses come through the ring, one at a time. Each lot lasts 30 seconds, with bidding from $5.</p><button className="track-secondary" onClick={()=>onTab('bets')}>Build your race ticket</button></div>}
      </section>
      <aside className="site-panel site-ticket site-auction-order"><div className="site-section-heading"><div><p className="track-kicker">The auction order</p><h2>Six chances.</h2></div></div>
        {auction.order.map((id,index)=>{const owner=auction.owners[id],closed=live&&index<auction.currentSlot,active=live&&index===auction.currentSlot;return <div className={'site-auction-order-row '+(active?'is-active':'')} key={id}><RunnerNumber id={id}/><div><strong>{names[id]}</strong><small>{owner?`${owner.username===username?'You':owner.username} · ${money(owner.amount)}`:closed?'No sale · house runner':active?'In the ring now':`Lot ${index+1} · From $5`}</small></div>{active&&<span className="site-status-dot is-live"/>}</div>;})}
        <dl><div><dt>Auction total</dt><dd>{money(auction.pot)}</dd></div><div><dt>Race betting pool</dt><dd>{money(ticket.pool)}</dd></div><div><dt>Bets close in</dt><dd>{auction.endsIn}</dd></div></dl><p className="site-ticket-note">One horse per owner. Owning a horse gives you bragging rights; race bets determine payouts.</p>
      </aside>
    </div>}
  </main>;
}
