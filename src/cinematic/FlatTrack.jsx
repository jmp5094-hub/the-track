import { useEffect, useRef, useState, useId } from 'react';
import { SILKS } from './presentation.mjs';

const COATS = ['#bd8052','#e2d6bc','#794e39','#ad7051','#575052','#cba373'];

// A complete animated broadcast when a browser cannot create a WebGL context.
// SVG stays sharp on mobile and uses the same recorded positions as the 3D view.
function Runner({ id, position, returning, active, selected, reduced, duration, span }) {
  const previous = useRef(position);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (previous.current === position) return;
    previous.current = position;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), duration);
    return () => clearTimeout(timer);
  }, [position, duration]);
  const x = 105 + Math.min(span, Math.max(0, position)) / span * 730;
  return <g style={{ transform: `translate(${x}px, ${183 + id * 51}px)`, transition: reduced ? 'none' : `transform ${duration}ms cubic-bezier(.2,.65,.3,1)`, opacity: active ? 1 : .18 }}>
    <ellipse cy="5" rx="43" ry="6" fill="#07180d" opacity=".4" />
    {selected && <ellipse cy="6" rx="47" ry="9" fill="none" stroke="#ecd28f" strokeWidth="1.5" />}
    <g transform={`scale(${returning ? -1 : 1},1)`} className={moving && !reduced ? 'track-svg-gallop' : ''}>
      <g fill="none" stroke={COATS[id]} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path className="track-svg-backleg" d="M-24 -25 L-29 -12 L-20 2" />
        <path className="track-svg-frontleg" d="M17 -28 L29 -15 L32 2" />
        <path className="track-svg-frontleg" d="M-21 -26 L-13 -10 L-21 3" stroke="#72563f" />
        <path className="track-svg-backleg" d="M12 -27 L8 -10 L16 2" stroke="#72563f" />
      </g>
      <path d="M-29 -37 Q-46 -43 -52 -23 Q-46 -30 -35 -26" fill="#2c2522" />
      <path d="M-32 -31 C-40 -55 -11 -53 5 -45 C15 -48 17 -60 21 -66 L27 -70 L31 -62 L43 -57 L42 -49 L28 -47 C26 -28 19 -22 7 -25 C-5 -22 -21 -21 -32 -31Z" fill={COATS[id]} stroke="#281d1580" strokeWidth="1.5" />
      <path d="M5 -45 Q14 -62 22 -67 L19 -58 L17 -47" fill="#312a25" />
      <path d="M23 -65 L22 -75 L28 -68" fill={COATS[id]} />
      <circle cx="31" cy="-58" r="1.6" fill="#171a13" />
      <path d="M38 -54 L42 -53 M28 -48 L23 -57" stroke="#ead8b3" strokeWidth="1.7" />
      <path d="M-16 -46 L3 -45 L5 -27 L-16 -27Z" fill={SILKS[id]} stroke="#f7e3b7" strokeWidth=".7" />
      <text x="-6" y="-31" textAnchor="middle" fill="#17251d" fontSize="14" fontWeight="700" fontFamily="Georgia">{id + 1}</text>
      <path d="M-27 -46 Q-12 -50 1 -44" stroke="#fff1d0" strokeOpacity=".35" fill="none" strokeWidth="2" />
    </g>
  </g>;
}

export default function FlatTrack({ positions, legDone, raceType, phase, tieHorses, focusedHorse, cameraMode, reducedMotion, moveDuration = 680, condition }) {
  const uid = useId().replace(/:/g, '');
  const roundTrip = raceType === 'down_back' || raceType === 'magic_dice';
  const span = phase === 'tiebreak' ? 3 : 12;
  const focusX = 105 + Math.min(span, positions[focusedHorse] || 0) / span * 730;
  const follow = cameraMode === 'follow';
  return <svg className="track-flat-scene" viewBox="0 0 1000 580" aria-hidden="true">
    <defs>
      <radialGradient id={`${uid}-light`}><stop stopColor="#38543c" /><stop offset="1" stopColor="#102019" /></radialGradient>
      <linearGradient id={`${uid}-wood`} x2="0" y2="1"><stop stopColor="#97754b" /><stop offset=".3" stopColor="#4f3628" /><stop offset="1" stopColor="#231b16" /></linearGradient>
      <pattern id={`${uid}-turf`} width="61" height="102" patternUnits="userSpaceOnUse"><rect width="61" height="102" fill="#324f36" /><rect width="61" height="51" fill="#3d5b3d" /><path d="M0 0V102" stroke="#9eae7f" strokeOpacity=".15" /><path d="M13 14l1 -3 M34 75l1 -3 M51 32l1 -3 M7 88l1 -3" stroke="#cbd4a2" strokeOpacity=".12" /></pattern>
      <pattern id={`${uid}-check`} width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#ede4cb" /><path d="M0 0h6v6H0z M6 6h6v6H6z" fill="#253a29" /></pattern>
      <linearGradient id={`${uid}-fog`}><stop stopColor="#dce9db" stopOpacity=".28" /><stop offset="1" stopColor="#dce9db" stopOpacity="0" /></linearGradient>
    </defs>
    <rect width="1000" height="580" fill={`url(#${uid}-light)`} />
    <g style={{ transformOrigin: `${focusX}px ${183 + focusedHorse * 51}px`, transform: follow ? 'scale(1.65)' : 'scale(1)', transition: reducedMotion ? 'none' : 'transform .7s ease' }}>
      <ellipse cx="500" cy="468" rx="460" ry="45" fill="#06100a" opacity=".5" />
      <rect x="48" y="126" width="904" height="350" rx="6" fill={`url(#${uid}-wood)`} stroke="#ae8d56" />
      <rect x="60" y="132" width="880" height="320" rx="3" fill={`url(#${uid}-turf)`} stroke="#c6ac70" strokeWidth="2" />
      <rect x="846" y="137" width="18" height="306" fill={`url(#${uid}-check)`} />
      {Array.from({length:6}, (_, i) => <g key={i}><path d={`M62 ${188+i*51}H938`} stroke="#b9c69b" strokeOpacity=".3" /><text x="77" y={168+i*51} fill="#d3c8a0" fontSize="13" fontFamily="Georgia">{i+1}</text></g>)}
      {Array.from({length:13}, (_, i) => <text key={i} x={105+i*730/12} y="466" textAnchor="middle" fill="#c6b78f" fontSize="8">{phase === 'tiebreak' ? (i%4===0 ? i/4 : '') : i}</text>)}
      {raceType === 'hurdle' && phase !== 'tiebreak' && Array.from({length:6},(_, i) => <g key={i}><path d={`M470 ${144+i*51}v37 M484 ${144+i*51}v37`} stroke="#dac9a0" strokeWidth="3" /><path d={`M467 ${153+i*51}h20 M467 ${162+i*51}h20`} stroke="#a9ba8c" strokeWidth="5" /></g>)}
      {positions.map((p, id) => <Runner key={`${phase}-${id}`} id={id} position={p} span={span} returning={roundTrip && legDone[id] && phase !== 'tiebreak'} selected={id === focusedHorse} active={phase !== 'tiebreak' || !tieHorses || tieHorses.includes(id)} reduced={reducedMotion} duration={moveDuration} />)}
      {[122,455].map(y => <g key={y}><path d={`M44 ${y}H956`} stroke="#dac99a" strokeWidth="3" />{Array.from({length:16},(_, i) => <path key={i} d={`M${48+i*60} ${y-1}v14`} stroke="#a08b66" strokeWidth="2" />)}</g>)}
      {[70,285,500,715,930].map(x => <g key={x}><path d={`M${x} 120V72`} stroke="#9d8558" strokeWidth="2" /><circle cx={x} cy="72" r="22" fill="#e4c078" opacity=".035" /><circle cx={x} cy="72" r="12" fill="#e4c078" opacity=".07" /><circle cx={x} cy="72" r="4" fill="#f2dbab" /></g>)}
      <text x="500" y="496" fill="#c6ac77" textAnchor="middle" fontFamily="Georgia" fontSize="12" letterSpacing="6">THE TRACK · CLUBHOUSE</text>
    </g>
    {condition === 'fog' && <rect width="1000" height="580" fill={`url(#${uid}-fog)`} />}
    {condition === 'rain' && !reducedMotion && <g className="track-svg-rain" stroke="#c3dad2" strokeOpacity=".3">{Array.from({length:60},(_, i) => <path key={i} d={`M${(i*167)%1000} ${(i*89)%580}l-5 17`} />)}</g>}
  </svg>;
}
