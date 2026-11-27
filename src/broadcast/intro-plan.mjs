export const INTRO_SECONDS = 20;
const opening = {key:'welcome',time:-17,offset:0,duration:3.72,text:'Six runners. One winner. Welcome to The Track!'};
const conditions = {
  sunny:{key:'sunny',time:-10,offset:4.42,duration:2.36,text:'Clear skies. The track is ready!'},
  rain:{key:'rain',time:-10,offset:7.58,duration:3.5,text:'Rain on the track. Every roll could change this race!'},
  fog:{key:'fog',time:-10,offset:11.82,duration:3.12,text:'Fog over the course. Keep your eyes on your runner!'},
};
const gate = {key:'gate',time:-3.4,offset:15.76,duration:2.56,text:"They're at the gate. All set for the start!"};
export const introCues = condition => [opening,conditions[condition]||conditions.sunny,gate];
export function introFrame(elapsed,condition) {
  const cues=introCues(condition),line=cues.findLast(c=>elapsed>=c.time);
  return {seconds:Math.max(0,Math.ceil(-elapsed)),text:line?.text||'The field is coming to the gate.',
    cue:line&&elapsed<line.time+line.duration?line:null,active:elapsed<0&&elapsed>=-INTRO_SECONDS};
}
export const canStartIntroCue = (cue,elapsed,seen) => Boolean(cue&&!seen.has(cue.key)&&elapsed>=cue.time&&elapsed-cue.time<.24);
