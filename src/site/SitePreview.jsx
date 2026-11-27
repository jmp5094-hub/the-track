import {useState} from 'react';
import {LobbyView,RaceEntryView,RaceResultView,SiteBrand} from './RaceViews';
import '../track-theme.css';

// Pure presentation fixtures: this route never imports the authenticated application.
const names=['Railbird','Night Watch','High Note','Bay Runner','Last Call','Homeward'];
const races=[
  {id:'preview-brass',name:'The Brass Cup',status:'racing',post:'Now',typeLabel:'Standard',pot:1260,countdown:'Live'},
  {id:'preview-evening',name:'The Evening Stakes',status:'betting',post:'8:15 PM',typeLabel:'Standard',pot:840,countdown:'04:32'},
  {id:'preview-rail',name:'The Railbird Classic',status:'betting',post:'8:30 PM',typeLabel:'Standard',pot:620,countdown:'19:32'},
  {id:'preview-night',name:'The Nightcap',status:'upcoming',post:'9:00 PM',typeLabel:'Standard',pot:0,countdown:'49:32'},
];
export default function SitePreview(){
  const [screen,setScreen]=useState('lobby');
  const [race,setRace]=useState(races[1]);
  const go=screen=>{setScreen(screen);window.scrollTo({top:0,behavior:'instant'});};
  const watch=()=>{window.location.href='?demo=1';};
  return <div className="track-app site-preview">
    <nav className="site-preview-nav" aria-label="Design preview"><a href="?preview=site" aria-label="The Track design preview"><SiteBrand/><span className="site-preview-badge">DESIGN PREVIEW</span></a><div>{[['lobby','Lobby'],['entry','Race card'],['results','Result']].map(([id,label])=><button key={id} aria-pressed={screen===id} onClick={()=>go(id)}>{label}</button>)}</div></nav>
    {screen==='lobby'&&<LobbyView races={races} preview onEnterRace={r=>{if(r.status==='racing'){watch();return;}setRace(r);go('entry');}}/>}
    {screen==='entry'&&<RaceEntryView race={race} names={names} typeLabel="Standard" description="Six numbered horses. Two dice. Matching dice move the field one space at a time." post={race.post} canBet={race.status==='betting'} confirmed={false} bets={{3:25}} totalBet={25} pot={race.pot} availableBalance={250} countdown={race.countdown} openCountdown="19:32" onBack={()=>go('lobby')} preview onWatch={watch}/>}
    {screen==='results'&&<RaceResultView race={races[0]} names={names} winner={3} odds={{0:8.4,1:7,2:6,3:4.2,4:8.4,5:5.04}} onReplay={watch} onLobby={()=>go('lobby')} preview/>}
  </div>;
}
