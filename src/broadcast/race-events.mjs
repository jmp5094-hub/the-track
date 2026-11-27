// Presentation facts derived from this roll and the positions before it. No look-ahead.
export function rollStory({roll,previous,current,active,goal,type,tiebreak=false,first=false,tiePending=false,done=false}) {
  const best=Math.max(...active.map(id=>current[id])),before=Math.max(...active.map(id=>previous[id]));
  const leaders=active.filter(id=>current[id]===best),prior=active.filter(id=>previous[id]===before);
  const leadChange=!first&&leaders.length===1&&!prior.every(id=>id===leaders[0])&&current[leaders[0]]>previous[leaders[0]];
  const jumping=type==='hurdle'&&!tiebreak&&roll.isDoubles&&roll.dice.length===2&&roll.mudDieIdx==null&&roll.fogDieIdx==null&&
    active.some(id=>previous[id]===5&&current[id]===7&&roll.dice.every(d=>d===id+1));
  const maxStep=type==='magic_dice'&&!tiebreak?6:roll.dice.length-(roll.mudDieIdx!=null||roll.fogDieIdx!=null?1:0);
  const contenders=active.filter(id=>goal-previous[id]>0&&goal-previous[id]<=maxStep);
  const missed=contenders.length>0&&!done&&!tiePending&&best<goal;
  const gap=leaders.length===1?best-Math.max(...active.filter(id=>id!==leaders[0]).map(id=>current[id])):0;
  const oldGap=prior.length===1?before-Math.max(...active.filter(id=>id!==prior[0]).map(id=>previous[id])):0;
  return {leaders,left:goal-best,previousLeft:goal-before,leadChange,jumping,missed,
    turn:!tiebreak&&roll.events?.some(e=>e.kind==='turn'),
    blocked:!tiebreak&&type==='hurdle'&&roll.events?.some(e=>e.kind==='blocked'),
    rain:!tiebreak&&roll.mudDieIdx!=null,
    fog:!tiebreak&&roll.fogDieIdx!=null&&active.some(id=>current[id]<previous[id]),
    level:leaders.length>1&&leaders.length<active.length&&best>0&&leaders.some(id=>current[id]>previous[id]),
    opensGap:!leadChange&&leaders.length===1&&prior[0]===leaders[0]&&gap>=3&&gap>oldGap,
    closesGap:!leadChange&&leaders.length===1&&prior.length===1&&prior[0]===leaders[0]&&gap<oldGap&&gap<=2,
    reaction:done?'finish':tiePending?'tie':jumping||leadChange?'cheer':missed?'ooh':null};
}
