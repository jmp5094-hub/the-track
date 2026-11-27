import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAudioManager} from './audio-manager.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Param {value=1;cancelScheduledValues(){} setTargetAtTime(v){this.value=v;} setValueAtTime(v){this.value=v;}}
class Node {
  gain=new Param();playbackRate=new Param();connections=[];stopped=false;
  connect(node){this.connections.push(node);return node;}
  disconnect(){this.disconnected=true;}
  start(...args){this.startArgs=args;}
  stop(){this.stopped=true;this.onended?.();}
}
class Context {
  state='suspended';currentTime=1;sampleRate=44100;destination=new Node();sources=[];listeners=[];resumeCalls=0;blocked=false;
  createGain(){return new Node();}
  createDynamicsCompressor(){const n=new Node();for(const k of ['threshold','knee','ratio','attack','release'])n[k]=new Param();return n;}
  createBuffer(){return {duration:1};}
  createBufferSource(){const n=new Node();this.sources.push(n);return n;}
  addEventListener(_,fn){this.listeners.push(fn);}
  transition(state){this.state=state;this.listeners.forEach(fn=>fn());}
  resume(){this.resumeCalls++;if(this.blocked)return Promise.reject(Error('Gesture required'));this.transition('running');return Promise.resolve();}
}
function setup({values={},load=async()=>({duration:20}),create}={}){
  const data=new Map(Object.entries(values)),contexts=[];let visible=true;
  const manager=createAudioManager({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
    createContext:create||(()=>{const c=new Context();contexts.push(c);return c;}),loadBuffer:load,visible:()=>visible});
  return {manager,data,contexts,visibility(v){visible=v;manager.visibilityChanged();}};
}
test('saved on means Enable sound until a real resume succeeds; one tap unlocks one context',async()=>{
  const {manager:m,contexts}=setup({values:{tt_sound:'1',tt_music:'1'}});
  assert.equal(m.getSnapshot().status,'locked');assert.equal(contexts.length,0);
  m.toggle();assert.equal(contexts[0].resumeCalls,1);await tick();
  assert.equal(m.getSnapshot().status,'on');assert.equal(m.getSnapshot().running,true);
  m.resume();await tick();assert.equal(contexts.length,1);assert.equal(contexts[0].resumeCalls,1);
});
test('blocked and interrupted sessions retry on one tap without first disabling the preference',async()=>{
  const {manager:m,contexts}=setup();const ctx=m.getContext();ctx.blocked=true;
  m.setEnabled(true);await tick();assert.equal(m.getSnapshot().status,'locked');
  ctx.blocked=false;m.toggle();await tick();assert.equal(m.getSnapshot().status,'on');
  ctx.transition('interrupted');assert.equal(m.getSnapshot().status,'interrupted');
  m.toggle();await tick();assert.equal(m.getSnapshot().enabled,true);assert.equal(m.getSnapshot().status,'on');assert.equal(contexts.length,1);
});
test('music waits for the caller to load and an off tap wins over pending loads and resumes',async()=>{
  const releases=[];const {manager:m,contexts}=setup({load:()=>new Promise(resolve=>releases.push(resolve))});
  m.setLobby(true);m.setEnabled(true);assert.equal(m.getSnapshot().status,'loading');
  assert.equal(m.output('music').gain.value,0);m.toggle();
  releases.forEach(resolve=>resolve({duration:20}));await tick();
  assert.equal(m.getSnapshot().status,'off');assert.equal(m.getSnapshot().running,false);
  assert.equal(m.output('music').connections[0].gain.value,0);
  assert.equal(contexts[0].sources.filter(n=>n.loop).length,0);
});
test('caller decode errors are visible and retry restores speech readiness without toggling off',async()=>{
  let fail=true;const {manager:m}=setup({load:async()=>{if(fail)throw Error('Offline');return {duration:20};}});
  m.setEnabled(true);await tick();assert.equal(m.getSnapshot().status,'error');assert.equal(m.output('music').gain.value,0);
  fail=false;m.toggle();await tick();assert.equal(m.getSnapshot().status,'on');
});
test('real voice playback ducks all backgrounds and stopping it restores their levels',async()=>{
  const {manager:m}=setup();m.setEnabled(true);await tick();
  const music=m.output('music'),crowd=m.output('ambience'),effects=m.output('effects');
  const before=[music.gain.value,crowd.gain.value,effects.gain.value];
  const line=m.playVoice({duration:4});assert.ok(line);
  assert.ok(music.gain.value<=before[0]*.14);assert.ok(crowd.gain.value<before[1]/3);assert.ok(effects.gain.value<before[2]/2);
  line.stop();assert.deepEqual([music.gain.value,crowd.gain.value,effects.gain.value],before);
});
test('master mute stops caller, loops and registered effects immediately, including scheduled nodes',async()=>{
  const {manager:m,contexts}=setup();let stopped=0;m.registerStop(()=>stopped++);m.setEnabled(true);m.setLobby(true);await tick();
  const line=m.playVoice({duration:6}),ctx=contexts[0],voice=ctx.sources.at(-1),loop=ctx.sources.find(n=>n.loop);
  assert.ok(line);assert.ok(loop);m.setEnabled(false);
  assert.equal(voice.stopped,true);assert.equal(loop.stopped,true);assert.equal(stopped,1);
  assert.equal(m.output('music').connections[0].gain.value,0);assert.equal(m.playVoice({duration:1}),null);
  m.resume();assert.equal(m.getSnapshot().status,'off');
});
test('backgrounding silences audio and returning resumes current audio without reviving a stale call',async()=>{
  const {manager:m,contexts,visibility}=setup();m.setEnabled(true);await tick();m.playVoice({duration:5});const old=contexts[0].sources.at(-1);
  visibility(false);assert.equal(old.stopped,true);assert.equal(m.getSnapshot().status,'background');assert.equal(m.getSnapshot().running,false);
  contexts[0].transition('interrupted');visibility(true);await tick();
  assert.equal(m.getSnapshot().status,'on');assert.equal(old.stopped,true);assert.equal(m.output('music').gain.value,.45);
});
test('caller-only and music level use the common gain graph and survive reload',async()=>{
  const {manager:m,data}=setup();m.setEnabled(true);await tick();m.setMusicLevel(.2);assert.equal(m.output('music').gain.value,.2);
  m.setMix('caller');for(const channel of ['music','ambience','effects'])assert.equal(m.output(channel).gain.value,0);
  m.setEnabled(false);m.setMix('stadium');assert.equal(m.getSnapshot().enabled,false);
  const next=setup({values:Object.fromEntries(data)}).manager;assert.equal(next.getSnapshot().musicLevel,.2);assert.equal(next.getSnapshot().status,'off');
});
test('all subscribers see the same state, storage changes and unsubscribe cleanup',async()=>{
  const {manager:m,data}=setup();const a=[],b=[];const off=m.subscribe(()=>a.push(m.getSnapshot()));m.subscribe(()=>b.push(m.getSnapshot()));
  m.setEnabled(true);await tick();assert.deepEqual(a,b);const before=a.length;off();
  data.set('track-audio-v2',JSON.stringify({enabled:false,mix:'caller',musicLevel:.1}));m.reloadPreferences();
  assert.equal(a.length,before);assert.equal(b.at(-1).status,'off');assert.equal(m.output('effects').gain.value,0);
});
test('storage failure and unavailable Web Audio produce a usable retry state',()=>{
  const m=createAudioManager({storage:{getItem(){throw Error();},setItem(){throw Error();}},createContext:()=>null,loadBuffer:async()=>null});
  assert.equal(m.getSnapshot().status,'off');m.setEnabled(true);assert.equal(m.getSnapshot().status,'unavailable');
});
