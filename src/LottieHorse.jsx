// ─── LottieHorse.jsx ─────────────────────────────────────────────────────────
// Drop-in replacement for the 🐴 emoji on the race track.
// Usage:
//   <LottieHorse coatIndex={2} neonColor="#00f5ff" moving={true} size={64}/>
//
// Setup:
//   1. Copy Stallion_of_the_Cimarron.json to /public/horse-base.json
//   2. npm install lottie-react
//   3. Import this component where needed

import { useState, useEffect, useRef, useMemo } from "react";
import Lottie from "lottie-react";

// ─── 32 coat definitions ─────────────────────────────────────────────────────
// Each entry: [name, bodyHex, maneHex, darkHex]
export const COAT_DEFS = [
  ["Chestnut",         "#b85c28", "#7a3010", "#4a1a05"],
  ["Light Chestnut",   "#d4733a", "#c0622a", "#6b2a10"],
  ["Liver Chestnut",   "#7a3518", "#3d1a0a", "#1e0d05"],
  ["Flaxen Chestnut",  "#b85c28", "#e8d090", "#4a1a05"],
  ["Sorrel",           "#c45a20", "#8b3a10", "#3d1205"],
  ["Dark Sorrel",      "#9a3e18", "#5a2008", "#2a0e03"],
  ["Bay",              "#8b3a1a", "#1a0a04", "#0d0503"],
  ["Blood Bay",        "#7a2010", "#120804", "#080402"],
  ["Dark Bay",         "#5a2510", "#0e0604", "#060302"],
  ["Light Bay",        "#a84c28", "#2a1208", "#150904"],
  ["Mahogany Bay",     "#6b2a14", "#180804", "#0a0402"],
  ["Black",            "#1a1a1a", "#0e0e0e", "#060606"],
  ["Seal Brown",       "#2a1a10", "#150a06", "#080402"],
  ["Dark Brown",       "#3d2010", "#1e1008", "#0e0804"],
  ["Dapple Grey",      "#a0a0a0", "#787878", "#484848"],
  ["Light Grey",       "#c8c8c8", "#a0a0a0", "#606060"],
  ["Steel Grey",       "#787878", "#505050", "#303030"],
  ["Fleabitten Grey",  "#b8b0a8", "#909088", "#585450"],
  ["Rose Grey",        "#b0a8a0", "#888078", "#504840"],
  ["Palomino",         "#c8a040", "#e8d898", "#7a6020"],
  ["Dark Palomino",    "#a07828", "#c8b068", "#604818"],
  ["Cremello",         "#e8d8b0", "#f0e8c8", "#c0a870"],
  ["Perlino",          "#d8c8a0", "#e8dcc0", "#b09870"],
  ["Buckskin",         "#c8a050", "#1a0a04", "#0d0502"],
  ["Classic Dun",      "#b89058", "#2a1808", "#140c04"],
  ["Red Dun",          "#c07840", "#8a4820", "#4a2010"],
  ["Grullo",           "#808878", "#383c34", "#1c1e18"],
  ["Blue Roan",        "#606870", "#1a1e20", "#0c0e10"],
  ["Red Roan",         "#9a5848", "#3a1810", "#1e0c08"],
  ["Strawberry Roan",  "#b06858", "#7a3828", "#3e1c14"],
  ["Spotted",          "#c0c0b0", "#484840", "#282820"],
  ["Blanket",          "#d8d0c0", "#383028", "#181410"],
];

// Dominant color of the base animation (Chestnut body)
const DOM_H = 14.6, DOM_S = 61.2, DOM_L = 47.5;

function hexToRgb(hex) {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHsl(r,g,b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h, s, l=(max+min)/2;
  if(max===min){ h=s=0; }
  else {
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}
function hslToRgb(h,s,l) {
  h/=360; s/=100; l/=100;
  if(s===0) { const v=l; return [v,v,v]; }
  const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
  const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  return [hue2rgb(p,q,h+1/3), hue2rgb(p,q,h), hue2rgb(p,q,h-1/3)];
}

function remapColor(rn,gn,bn, bH,bS,bL, dH,dS,dL) {
  const [h,s,l] = rgbToHsl(rn*255,gn*255,bn*255);
  let nH,nS,nL;
  if(l < 25) {
    nH=(h+(dH-DOM_H)+360)%360;
    nS=Math.min(100, dS*(DOM_S>0?s/DOM_S:1));
    nL=Math.max(3, dL*(l/DOM_L)*1.2);
  } else if(l > 65) {
    nH=(h+(bH-DOM_H)+360)%360;
    nS=Math.min(100, bS*0.6);
    nL=Math.min(95, bL+(l-DOM_L)*0.7);
  } else {
    nH=(h+(bH-DOM_H)+360)%360;
    nS=Math.min(100, bS*(DOM_S>0?s/DOM_S:1));
    nL=Math.max(5, Math.min(90, bL+(l-DOM_L)*0.85));
  }
  return hslToRgb(nH,nS,nL);
}

function applyCoat(baseData, coatIndex) {
  const [,bodyHex,maneHex,darkHex] = COAT_DEFS[coatIndex % COAT_DEFS.length];
  const [bR,bG,bB] = hexToRgb(bodyHex);
  const [mR,mG,mB] = hexToRgb(maneHex); // unused in current impl but reserved
  const [dR,dG,dB] = hexToRgb(darkHex);
  const [bH,bS,bL] = rgbToHsl(bR,bG,bB);
  const [dH,dS,dL] = rgbToHsl(dR,dG,dB);

  // Deep clone + recolor
  const data = JSON.parse(JSON.stringify(baseData));
  function walk(obj) {
    if(!obj || typeof obj !== "object") return;
    if(Array.isArray(obj)) { obj.forEach(walk); return; }
    for(const ty of ["fl","st"]) {
      if(obj.ty === ty) {
        const c = obj.c?.k;
        if(Array.isArray(c) && c.length >= 3 && !Array.isArray(c[0])) {
          const [nr,ng,nb] = remapColor(c[0],c[1],c[2], bH,bS,bL, dH,dS,dL);
          obj.c.k = [parseFloat(nr.toFixed(4)), parseFloat(ng.toFixed(4)), parseFloat(nb.toFixed(4)), c[3]??1];
        }
      }
    }
    Object.values(obj).forEach(walk);
  }
  walk(data);
  return data;
}

// Pick coat deterministically from race ID + horse slot
export function getCoatIndex(raceId, horseSlot) {
  const seed = (raceId||"").split("").reduce((a,c,i) => a + c.charCodeAt(0)*(i+horseSlot*7+11), 0);
  return Math.abs(seed) % COAT_DEFS.length;
}

export function getCoatName(index) {
  return COAT_DEFS[index % COAT_DEFS.length][0];
}

// Cache: baseData loaded once, recolored versions cached by coatIndex
let baseDataCache = null;
const coatCache = {};
let baseLoadPromise = null;

async function loadBase() {
  if(baseDataCache) return baseDataCache;
  if(baseLoadPromise) return baseLoadPromise;
  baseLoadPromise = fetch("/horse-base.json").then(r=>r.json()).then(d=>{ baseDataCache=d; return d; });
  return baseLoadPromise;
}

async function getCoatData(index) {
  const key = index % COAT_DEFS.length;
  if(coatCache[key]) return coatCache[key];
  const base = await loadBase();
  const colored = applyCoat(base, key);
  coatCache[key] = colored;
  return colored;
}

// ─── SVG outline filter ───────────────────────────────────────────────────────
// Renders once globally — all horse instances share the same filter defs
function OutlineFilters() {
  const NEON_COLORS = ["#00f5ff","#ff2d55","#ffd700","#39ff14","#bf5fff","#ff6b00"];
  return (
    <svg width="0" height="0" style={{position:"absolute",pointerEvents:"none"}}>
      <defs>
        {NEON_COLORS.map((color,i) => {
          const hex = color.replace("#","");
          const r = parseInt(hex.slice(0,2),16);
          const g = parseInt(hex.slice(2,4),16);
          const b = parseInt(hex.slice(4,6),16);
          return (
            <filter key={i} id={`horse-outline-${i}`} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
              <feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="expanded"/>
              <feComposite in="expanded" in2="SourceAlpha" operator="out" result="ring"/>
              <feFlood floodColor={`rgb(${r},${g},${b})`} floodOpacity="1" result="col"/>
              <feComposite in="col" in2="ring" operator="in" result="outline"/>
              <feMerge>
                <feMergeNode in="outline"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          );
        })}
        {/* Dynamic filter for any hex color */}
        <filter id="horse-outline-custom" x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="expanded"/>
          <feComposite in="expanded" in2="SourceAlpha" operator="out" result="ring"/>
          <feFlood id="horse-outline-custom-flood" floodColor="#ffffff" floodOpacity="1" result="col"/>
          <feComposite in="col" in2="ring" operator="in" result="outline"/>
          <feMerge>
            <feMergeNode in="outline"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

let filtersRendered = false;
function ensureFilters() {
  if(filtersRendered) return;
  filtersRendered = true;
  const div = document.createElement("div");
  div.id = "horse-outline-filters";
  document.body.appendChild(div);
  // Filters injected via OutlineFilters component elsewhere, or inline here
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LottieHorse({
  coatIndex = 0,       // 0–31
  neonColor = "#00f5ff",
  moving = false,      // true = play, false = pause
  size = 64,           // px — width and height
  speed = 1.6,
  flipX = false,       // true = facing left (returning in down & back)
  style = {},
}) {
  const [animData, setAnimData] = useState(null);
  const lottieRef = useRef(null);
  const prevMoving = useRef(moving);

  // Load and recolor on mount or coat change
  useEffect(() => {
    let cancelled = false;
    getCoatData(coatIndex).then(data => {
      if(!cancelled) setAnimData(data);
    });
    return () => { cancelled = true; };
  }, [coatIndex]);

  // Play/pause on moving change
  useEffect(() => {
    if(!lottieRef.current) return;
    if(moving) {
      lottieRef.current.play();
    } else {
      lottieRef.current.pause();
      lottieRef.current.goToAndStop(0, true);
    }
  }, [moving, animData]);

  // Build filter reference
  const PRESET_COLORS = ["#00f5ff","#ff2d55","#ffd700","#39ff14","#bf5fff","#ff6b00"];
  const presetIdx = PRESET_COLORS.indexOf(neonColor);
  const filterId = presetIdx >= 0 ? `horse-outline-${presetIdx}` : "horse-outline-custom";

  if(!animData) {
    // Loading placeholder — static emoji fallback
    return (
      <div style={{width:size, height:size, display:"flex", alignItems:"center",
                   justifyContent:"center", fontSize:size*0.5, ...style}}>
        🐴
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size,
      transform: flipX ? "scaleX(1)" : "scaleX(-1)",  // scaleX(-1)=face right, scaleX(1)=face left
      filter: `url(#${filterId})`,
      ...style,
    }}>
      <Lottie
        lottieRef={lottieRef}
        animationData={animData}
        loop={true}
        autoplay={moving}
        style={{ width: size, height: size }}
        onDOMLoaded={() => {
          if(lottieRef.current) {
            lottieRef.current.setSpeed(speed);
            if(!moving) lottieRef.current.goToAndStop(0, true);
          }
        }}
      />
    </div>
  );
}

// Re-export filters component so App can render it once at root level
export { OutlineFilters };
