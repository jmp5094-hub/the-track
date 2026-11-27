let context;
const activeNodes=new WeakMap();
export function stopRaceEffects(ctx){for(const node of activeNodes.get(ctx)||[]){try{node.stop();}catch{}}activeNodes.get(ctx)?.clear();}
export function getRaceAudioContext(){
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return null;
  context??=new Audio();return context;
}
export function playRaceEffect(ctx,kind){
  if(!ctx||ctx.state!=='running')return;
  if(!activeNodes.has(ctx))activeNodes.set(ctx,new Set());
  const nodes=activeNodes.get(ctx);
  const noise=(time,duration,level,frequency)=>{
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=buffer;filter.type='lowpass';filter.frequency.value=frequency;gain.gain.setValueAtTime(level,time);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    source.connect(filter).connect(gain).connect(ctx.destination);nodes.add(source);source.start(time);source.onended=()=>{nodes.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
  };
  const tone=(time,hz,duration,level)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.value=hz;gain.gain.setValueAtTime(level,time);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);osc.connect(gain).connect(ctx.destination);nodes.add(osc);osc.start(time);osc.stop(time+duration);osc.onended=()=>{nodes.delete(osc);osc.disconnect();gain.disconnect();};};
  const now=ctx.currentTime;
  if(kind==='rattle')for(let i=0;i<6;i++)noise(now+i*.085,.07,.09,1800);
  if(kind==='land'){noise(now,.12,.23,1200);tone(now,145,.12,.11);}
  if(kind==='hooves'){noise(now,.08,.11,460);noise(now+.13,.08,.085,370);}
  if(kind==='crowd')noise(now,.7,.035,650);
  if(kind==='gate'){noise(now,.16,.28,1800);noise(now+.035,.21,.15,650);tone(now,94,.11,.12);}
  if(kind==='takeoff'){noise(now,.09,.10,700);noise(now+.06,.16,.055,1200);}
  if(kind==='touchdown'){noise(now,.16,.21,520);noise(now+.06,.1,.09,1100);tone(now,86,.14,.07);}
  if(kind==='finish'){[523,659,784].forEach((hz,i)=>tone(now+i*.13,hz,.55,.055));noise(now,.8,.045,850);}
}
