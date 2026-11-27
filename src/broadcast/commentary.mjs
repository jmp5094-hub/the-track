import {rollStory} from './race-events.mjs';

// Keep the simple dice calls. Vary their words/delivery and add truthful race colour.
// Selection is deterministic for a recording, with no use of its eventual winner.
export function planCommentary({rolls,positions,cycle,goalAt,tieStart,tieActive,type,voice,timing}) {
  const {FIRST_ROLL,GO,VOICE,MOVE_END}=timing,all=[0,1,2,3,4,5],gate=all.map(()=>0);
  const cues=[],stories=[],used=new Map(),counts=new Map(),lastDice=new Map();
  const salt=rolls[0].dice.reduce((n,d)=>n*7+d,0);
  let stretchCalled=false,chanceCalled=false,lastColour=-20,lastOoh=-3;
  const make=(key,time,kind)=>voice[key]?{...voice[key],key,time,kind}:null;
  const choose=(keys,time,kind,deadline=Infinity,cooldown=0)=>{
    const options=keys.filter(key=>voice[key]&&time-(used.get(key)??-Infinity)>=cooldown&&time+voice[key].duration<=deadline);
    options.sort((a,b)=>(counts.get(a)||0)-(counts.get(b)||0));
    if(!options.length)return null;
    const key=options[0],cue=make(key,time,kind);used.set(key,time);counts.set(key,(counts.get(key)||0)+1);return cue;
  };
  const open=choose(salt%2?['openAlt','open']:['open','openAlt'],GO+.04,'open',FIRST_ROLL+MOVE_END-.1);
  if(open)cues.push(open);
  rolls.forEach((roll,index)=>{
    const start=FIRST_ROLL+index*cycle,tiebreak=tieStart>0&&index>=tieStart;
    const previous=index===0||index===tieStart?gate:positions[index-1],active=tiebreak?tieActive:all;
    const story=rollStory({roll,previous,current:positions[index],active,goal:goalAt(index),type,tiebreak,first:index===0||index===tieStart,tiePending:index===tieStart-1,done:index===rolls.length-1});
    if(story.reaction==='ooh'){if(index-lastOoh<3)story.reaction=null;else lastOoh=index;}
    stories.push(story);
    // The dice say only their face values, so weather does not make these calls false.
    const pair=roll.dice.length===2&&!(type==='magic_dice'&&!tiebreak)?[...roll.dice].sort((a,b)=>a-b).join(''):null;
    const urgent=story.previousLeft<=3||tiebreak;
    const normal=(index+salt)%2?[`alt${pair}`,pair]:[pair,`alt${pair}`];
    const choices=urgent?[`urgent${pair}`,...normal]:normal;
    const alternatives=choices.filter(key=>voice[key]&&key!==lastDice.get(pair));
    const previousCue=cues.at(-1),primaryTime=Math.max(start+VOICE,(previousCue?.time||0)+(previousCue?.duration||0)+.09);
    const primary=pair?choose(alternatives.length?alternatives:choices,primaryTime,'dice',start+cycle+VOICE-.08):null;
    if(primary)lastDice.set(pair,primary.key);
    if(primary)cues.push(primary);
    const beatTime=Math.max(start+MOVE_END,(primary?.time||0)+(primary?.duration||0)+.09,(previousCue?.time||0)+(previousCue?.duration||0)+.09),deadline=start+cycle+MOVE_END-.8;
    let cue=null,kind;
    if(index===tieStart-1&&beatTime<start+cycle-.06){cue=choose(['tiebreakAlt','tiebreak'],beatTime,'tiebreak',deadline);}
    else if(story.left>0&&index<rolls.length-1&&beatTime<start+cycle-.06){
      const options=[];
      if(story.jumping)options.push(['jump',['jump','jumpAlt']]);
      if(story.turn)options.push(['turn',['turn','turnAlt']]);
      if(story.leadChange)options.push(['lead',urgent?[`leadAlt${story.leaders[0]+1}`,`lead${story.leaders[0]+1}`]:[`lead${story.leaders[0]+1}`,`leadAlt${story.leaders[0]+1}`]]);
      if(!stretchCalled&&story.left<=3)options.push(['stretch',['stretchAlt','stretch','stretchClose']]);
      if(!chanceCalled&&story.left===1)options.push(['chance',['chanceAlt','chance','chanceClose']]);
      if(beatTime-lastColour>=6){
        if(story.reaction==='ooh')options.push(['miss',['miss','missAlt']]);
        if(story.blocked)options.push(['blocked',['blocked','blockedAlt']]);
        if(story.rain)options.push(['rain',['rain','rainAlt']]);
        if(story.fog)options.push(['fog',['fog','fogAlt']]);
        if(story.level)options.push(['level',['level','levelAlt']]);
        if(story.opensGap)options.push(['opensGap',['opensGap']]);
        if(story.closesGap)options.push(['closesGap',['closesGap']]);
      }
      for(const [event,keys] of options){
        cue=choose(keys,beatTime,event,deadline,14);
        if(cue){kind=event;break;}
      }
      if(cue){lastColour=beatTime;if(kind==='stretch')stretchCalled=true;if(kind==='chance')chanceCalled=true;}
    }
    if(cue)cues.push(cue);
  });
  return {cues,stories};
}
