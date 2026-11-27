import {SILKS} from './playback.mjs';

export function WinnerRibbon({winner,name,dice,historical=false,onReplay}) {
  return <div className="tv-winner" style={{'--winner-silk':SILKS[winner]}} role="status">
    <span className="tv-winner-number" aria-hidden="true">{winner+1}</span>
    <div className="tv-winner-copy"><span>{historical?'Official recorded winner':'First across the wire'}</span><strong>#{winner+1} {name}</strong><small>{dice?.length?'Winning roll · '+dice.join(' + '):'Race complete'}</small>
      {onReplay&&<button type="button" onClick={onReplay}>Watch the winning roll <span aria-hidden="true">↻</span></button>}
    </div>
  </div>;
}
