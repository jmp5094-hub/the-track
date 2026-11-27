// One preference store, one audio context and one output graph for the whole site.
// In particular, no HTMLMediaElement.volume: iPhone controls that at device level.
const KEY='track-audio-v2';
const MIXES=['stadium','trackside','caller'];
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function createAudioManager({storage,createContext,loadBuffer,visible=()=>true,setSession=()=>{}}){
  const read=key=>{try{return storage?.getItem(key);}catch{return null;}};
  let saved;try{saved=JSON.parse(read(KEY));}catch{}
  const oldSound=read('tt_sound');
  let prefs={enabled:Boolean(saved?.enabled??(oldSound!==null?oldSound==='1':read('track-demo-sound')==='true')),
    mix:MIXES.includes(saved?.mix)?saved.mix:(read('track-race-mix')==='caller'?'caller':read('tt_music')==='0'||read('track-race-mix')==='trackside'?'trackside':'stadium'),
    musicLevel:Number.isFinite(saved?.musicLevel)?clamp(saved.musicLevel,0,1):.45};
  let ctx,graph,snapshot,voiceStatus='idle',voicePromise,error=false,lobbyWanted=false,lobbySource,lobbyLoading=false,hidden=!visible();
  const listeners=new Set(),stoppers=new Set(),voices=new Set(),buffers=new Map();
  const status=()=>!prefs.enabled?'off':hidden?'background':error?'unavailable':!ctx||ctx.state==='suspended'?'locked':ctx.state!=='running'?'interrupted':voiceStatus==='error'?'error':voiceStatus!=='ready'?'loading':'on';
  function emit(){
    const next={...prefs,status:status(),running:prefs.enabled&&!hidden&&ctx?.state==='running',voiceReady:voiceStatus==='ready'};
    if(!snapshot||Object.keys(next).some(k=>next[k]!==snapshot[k])){snapshot=Object.freeze(next);listeners.forEach(fn=>fn());}
  }
  function persist(){try{storage?.setItem(KEY,JSON.stringify(prefs));}catch{}}
  function ramp(node,value,time=.035){node.gain.cancelScheduledValues(ctx.currentTime);node.gain.setTargetAtTime(value,ctx.currentTime,time);}
  function mix(){
    if(!graph)return;
    const active=prefs.enabled&&!hidden&&ctx.state==='running';
    // Mute at the master immediately, including already scheduled nodes.
    graph.master.gain.cancelScheduledValues(ctx.currentTime);graph.master.gain.setValueAtTime(active?.85:0,ctx.currentTime);
    const talking=voices.size>0,ready=voiceStatus==='ready';
    ramp(graph.music,ready&&prefs.mix==='stadium'?prefs.musicLevel*(talking?.13:1):0,talking?.015:.18);
    ramp(graph.ambience,ready&&prefs.mix!=='caller'?(talking?.16:.6):0,talking?.015:.18);
    ramp(graph.effects,prefs.mix!=='caller'?(talking?.28:.7):0,talking?.015:.12);
  }
  function stopVoices(){for(const source of [...voices])source.stop();}
  function silence(){stopVoices();for(const stop of stoppers)stop();stopLobby();}
  function context(){
    if(ctx?.state==='closed'){silence();ctx=null;graph=null;buffers.clear();voicePromise=null;voiceStatus='idle';}
    if(!ctx){
      try{
        ctx=createContext();if(!ctx)throw Error('Audio unavailable');error=false;
        graph={master:ctx.createGain(),voice:ctx.createGain(),music:ctx.createGain(),ambience:ctx.createGain(),effects:ctx.createGain()};
        graph.master.gain.value=0;graph.music.gain.value=0;graph.ambience.gain.value=0;
        const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-2;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.15;
        const voiceComp=ctx.createDynamicsCompressor();voiceComp.threshold.value=-10;voiceComp.knee.value=6;voiceComp.ratio.value=2;voiceComp.attack.value=.003;voiceComp.release.value=.12;
        graph.voice.gain.value=1.25;graph.voice.connect(voiceComp).connect(graph.master);
        for(const key of ['music','ambience','effects'])graph[key].connect(graph.master);
        graph.master.connect(limiter).connect(ctx.destination);
        ctx.addEventListener('statechange',()=>{mix();emit();if(ctx.state!=='running')silence();syncLobby();});
      }catch{error=true;emit();return null;}
    }
    return ctx;
  }
  function load(file){
    const c=context();if(!c)return Promise.reject(Error('Audio unavailable'));
    if(!buffers.has(file))buffers.set(file,loadBuffer(c,file).catch(e=>{buffers.delete(file);throw e;}));
    return buffers.get(file);
  }
  function prepare(){
    if(!voicePromise){
      voiceStatus='loading';emit();
      voicePromise=Promise.all([load('announcer'),load('gate-intro'),load('race-calls')]).then(()=>{voiceStatus='ready';mix();emit();syncLobby();return true;},()=>{voicePromise=null;voiceStatus='error';mix();emit();return false;});
    }
    return voicePromise;
  }
  function resume(){
    if(!prefs.enabled||hidden)return;
    const c=context();if(!c)return;
    try{setSession();}catch{}
    if(c.state==='running'){prepare();mix();emit();syncLobby();return;}
    // This call happens synchronously inside the tap, before fetching/decoding.
    try{const resumed=c.resume();Promise.resolve(resumed).then(()=>{mix();emit();syncLobby();},()=>{mix();emit();});}catch{emit();}
    // A silent buffer primes Web Audio on older iOS releases, never a media element.
    try{const prime=c.createBufferSource();prime.buffer=c.createBuffer(1,1,c.sampleRate);prime.connect(graph.master);prime.onended=()=>prime.disconnect();prime.start();}catch{}
    prepare();mix();emit();
  }
  function setEnabled(enabled){prefs={...prefs,enabled:Boolean(enabled)};persist();mix();emit();if(!enabled)silence();if(enabled)resume();}
  function setMix(value){if(!MIXES.includes(value))return;prefs={...prefs,mix:value};persist();mix();emit();syncLobby();}
  function setMusicLevel(value){prefs={...prefs,musicLevel:clamp(Number(value)||0,0,1)};persist();mix();emit();}
  function playVoice(buffer,{offset=0,duration=buffer.duration-offset,speed=1,onEnded}={}){
    if(!prefs.enabled||hidden||ctx?.state!=='running'||duration<=0)return null;
    // One caller at a time across countdowns, race transitions and replays.
    stopVoices();const source=ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=speed;source.connect(graph.voice);
    let ended=false,cancelled=false;const finish=()=>{if(ended)return;ended=true;voices.delete(handle);source.disconnect();mix();if(!cancelled)onEnded?.();};
    const handle={stop(){cancelled=true;try{source.stop();}catch{}finish();}};
    voices.add(handle);source.onended=finish;mix();source.start(0,offset,duration);return handle;
  }
  function stopLobby(){if(lobbySource){try{lobbySource.stop();}catch{}lobbySource.disconnect();lobbySource=null;}}
  function syncLobby(){
    if(!lobbyWanted||!snapshot.running||!snapshot.voiceReady||prefs.mix!=='stadium'){stopLobby();return;}
    if(lobbySource||lobbyLoading)return;
    lobbyLoading=true;load('pulse').then(buffer=>{
      if(!lobbyWanted||!snapshot.running||!snapshot.voiceReady||prefs.mix!=='stadium')return;
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=.075;
      source.connect(gain).connect(graph.music);source.onended=()=>gain.disconnect();lobbySource=source;source.start();
    }).catch(()=>{}).finally(()=>{lobbyLoading=false;});
  }
  function visibilityChanged(){hidden=!visible();mix();emit();if(hidden)silence();if(!hidden&&prefs.enabled)resume();}
  function reloadPreferences(){let next;try{next=JSON.parse(read(KEY));}catch{}if(!next)return;
    prefs={enabled:Boolean(next.enabled),mix:MIXES.includes(next.mix)?next.mix:'trackside',musicLevel:clamp(Number(next.musicLevel)||0,0,1)};
    mix();emit();if(!prefs.enabled)silence();syncLobby();
  }
  emit();
  return {getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getContext:context,
    output(channel='effects'){context();return graph?.[channel];},registerStop(fn){stoppers.add(fn);return()=>stoppers.delete(fn);},
    setEnabled,setMix,setMusicLevel,resume,prepare,load,playVoice,visibilityChanged,reloadPreferences,
    setLobby(wanted){lobbyWanted=wanted;if(wanted&&prefs.enabled)prepare();syncLobby();},
    toggle(){if(!prefs.enabled||['locked','interrupted','error','unavailable'].includes(status()))setEnabled(true);else setEnabled(false);}};
}
