import {SILKS} from '../broadcast/playback.mjs';
export function RunnerSilk({horseId=0,horseIndex,color,width=86,height=58}){
  const id=horseIndex??horseId;
  return <span className="track-silk-portrait" style={{width,height,'--silk':color||SILKS[id]}} aria-hidden="true"><svg viewBox="0 0 100 76"><path d="M37 9 21 17 5 37l16 14 14-15v31h30V36l14 15 16-14-16-20-16-8-13 8z" fill="var(--silk)"/><path d="m40 11 10 7 10-7-4 55H44z" fill="#f5efdc" opacity=".8"/><circle cx="50" cy="42" r="15" fill="#203327"/><text x="50" y="48" textAnchor="middle" fill="#f5efdc" fontFamily="Segoe UI,sans-serif" fontSize="19" fontWeight="700">{Number(id)+1}</text></svg></span>;
}
