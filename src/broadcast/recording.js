import { buildPlayback, FIRST_ROLL, PIPS, SILKS } from './playback.mjs';
import { exhibitionHistory, exhibitionInterval, exhibitionNames } from './exhibition.mjs';
import voice from './voice.json';

const WIDTH = 960;
const HEIGHT = 540;
const SCENE_WIDTH = 670;
const SCENE_HEIGHT = 370;

function title(ctx,text,x,y,size=18,color='#f3dec0',weight=700) {
  ctx.font=weight+' '+size+'px system-ui, sans-serif';
  ctx.fillStyle=color;
  ctx.fillText(text,x,y);
}
function badge(ctx,id,x,y) {
  ctx.fillStyle=SILKS[id];
  ctx.fillRect(x,y,24,23);
  title(ctx,String(id+1),x+8,y+17,14,[1,2].includes(id) ? '#211b13' : '#fffaf1');
}
function die(ctx,face,x,y) {
  ctx.fillStyle='#f1d7ad';
  ctx.fillRect(x,y,39,39);
  ctx.fillStyle='#251b13';
  for (const pip of PIPS[face] || []) {
    ctx.beginPath();
    ctx.arc(x+9+pip%3*10.5,y+9+Math.floor(pip/3)*10.5,2.6,0,Math.PI*2);
    ctx.fill();
  }
}

function drawBoard(ctx,frame) {
  ctx.fillStyle='#513c2b';
  ctx.fillRect(20,99,SCENE_WIDTH,SCENE_HEIGHT);
  for (let i=0;i<=frame.goal;i++) {
    ctx.fillStyle=i===frame.goal ? '#fff5cf' : '#887057';
    ctx.fillRect(54+i/frame.goal*601,151,i===frame.goal ? 3 : 1,265);
  }
  frame.active.forEach((id,lane)=>{
    const x = 44+frame.progress[id]/frame.goal*601;
    const y = 156+lane*44;
    ctx.fillStyle='#422f24';
    ctx.fillRect(54,y+26,601,1);
    badge(ctx,id,x,y);
  });
}

function paint(ctx,frame,horse,scene) {
  ctx.fillStyle='#141b15';
  ctx.fillRect(0,0,WIDTH,HEIGHT);
  title(ctx,'THE TRACK',20,34,20,'#e8b974',850);
  title(ctx,'Railside Exhibition',20,74,33,'#f6ead7');
  if (scene) ctx.drawImage(scene,20,99,SCENE_WIDTH,SCENE_HEIGHT);
  else drawBoard(ctx,frame);
  const phase=frame.done ? 'Finish' : frame.rolling ? 'Rolling' : 'Roll '+(frame.index+1);
  ctx.fillStyle='#181d16';
  ctx.fillRect(34,112,113,76);
  title(ctx,phase,43,132,15,'#f0c582');
  const faceTick=Math.floor(frame.into*16);
  const dice=frame.rolling ? [(faceTick*3+frame.index)%6+1,(faceTick*5+frame.index+2)%6+1] : frame.roll?.dice || [];
  dice.forEach((face,index)=>die(ctx,face,43+index*47,138));
  const caption=frame.done ? exhibitionNames[frame.winner]+' wins' : frame.cue?.text || '';
  if (caption) {
    ctx.fillStyle='#161b15e8';
    ctx.fillRect(32,425,630,32);
    title(ctx,caption,43,448,18);
  }
  const y=174;
  title(ctx,'Following',711,120,15,'#e8b974');
  badge(ctx,horse,711,135);
  title(ctx,exhibitionNames[horse],743,153,19);
  const left=Math.max(0,frame.goal-frame.exact[horse]);
  title(ctx,left+(left===1 ? ' space to finish' : ' spaces to finish'),711,y+14,18);
  title(ctx,'Running order',711,232,17,'#e8b974');
  [...frame.active].sort((a,b)=>frame.exact[b]-frame.exact[a]||a-b).forEach((id,index)=>{
    const row=245+index*35;
    badge(ctx,id,711,row);
    title(ctx,exhibitionNames[id],743,row+17,15);
    title(ctx,String(frame.goal-frame.exact[id]),910,row+17,17);
  });
  title(ctx,'Last roll',23,501,16,'#e8b974');
  const movement=frame.lastMove.map(({id,steps})=>'#'+(id+1)+' '+(steps>0?'+':'')+steps).join('  ·  ');
  title(ctx,(frame.previousRoll?.dice.join(' + ') || 'At the gate')+(movement ? '    '+movement : ''),105,501,18);
}

export async function downloadFinishClip(horse) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Recording unavailable');
  const playback=buildPlayback(exhibitionHistory,exhibitionInterval,12,3,voice);
  const canvas=document.createElement('canvas');
  canvas.width=WIDTH;
  canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d');
  const mount=document.createElement('div');
  Object.assign(mount.style,{width:SCENE_WIDTH+'px',height:SCENE_HEIGHT+'px',position:'fixed',left:'-1200px',top:'0'});
  document.body.append(mount);
  let view;
  let stream;
  try {
    try {
      const {createTrackView}=await import('./track-view');
      view=await createTrackView(mount);
    } catch {
      // A browser with 2D canvas can still export the same saved race.
    }
    const start=FIRST_ROLL+exhibitionInterval/1000*(exhibitionHistory.rolls.length-6);
    const until=playback.winsAt+2.1;
    stream=canvas.captureStream(24);
    const type=['video/webm;codecs=vp8','video/mp4','video/webm'].find(format=>MediaRecorder.isTypeSupported(format));
    const recorder=new MediaRecorder(stream,type ? {mimeType:type,videoBitsPerSecond:2500000} : {});
    const chunks=[];
    const file=new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType || type || 'video/webm'}));
      recorder.onerror=()=>reject(new Error('Recording failed'));
    });
    const render=seconds=>{
      const frame=playback.sample(seconds);
      view?.draw({...frame,followed:horse});
      paint(ctx,frame,horse,mount.querySelector('canvas'));
    };
    render(start);
    recorder.start();
    const began=performance.now();
    await new Promise((resolve,reject)=>{
      const tick=timestamp=>{
        try {
          const seconds=Math.min(until,start+Math.max(0,timestamp-began)/1000);
          render(seconds);
          if (seconds>=until) resolve();
          else requestAnimationFrame(tick);
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(tick);
    });
    recorder.stop();
    const video=await file;
    if(!video.size)throw new Error('No recorded frames');
    const url=URL.createObjectURL(video);
    const link=document.createElement('a');
    link.href=url;
    link.download='the-track-finish.'+(video.type.includes('mp4')?'mp4':'webm');
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  } finally {
    stream?.getTracks().forEach(track=>track.stop());
    view?.dispose();
    mount.remove();
  }
}
