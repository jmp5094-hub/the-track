let context;
export function getRaceAudioContext(){
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return null;
  context??=new Audio();return context;
}
export function playRaceEffect(ctx,kind){
  if(!ctx||ctx.state!=='running')return;
  const noise=(time,duration,level,frequency)=>{
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=buffer;filter.type='lowpass';filter.frequency.value=frequency;gain.gain.setValueAtTime(level,time);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    source.connect(filter).connect(gain).connect(ctx.destination);source.start(time);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  };
  const tone=(time,hz,duration,level)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.value=hz;gain.gain.setValueAtTime(level,time);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);osc.connect(gain).connect(ctx.destination);osc.start(time);osc.stop(time+duration);osc.onended=()=>{osc.disconnect();gain.disconnect();};};
  const now=ctx.currentTime;
  if(kind==='rattle')for(let i=0;i<6;i++)noise(now+i*.085,.07,.09,1800);
  if(kind==='land'){noise(now,.12,.23,1200);tone(now,145,.12,.11);}
  if(kind==='hooves'){noise(now,.08,.11,460);noise(now+.13,.08,.085,370);}
  if(kind==='crowd')noise(now,.7,.035,650);
  if(kind==='gate'){tone(now,880,.38,.09);tone(now,1318,.28,.035);}
  if(kind==='finish'){[523,659,784].forEach((hz,i)=>tone(now+i*.13,hz,.55,.055));noise(now,.8,.045,850);}
}
