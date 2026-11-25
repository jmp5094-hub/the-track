function makeCanvas(width, height, draw) {
  const element = document.createElement('canvas');element.width=width;element.height=height;
  draw(element.getContext('2d'),width,height);
  return element;
}
export function dirtTexture() {
  return makeCanvas(640,256,(ctx,w,h)=>{
    const image=ctx.createImageData(w,h), pixel=image.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const v = Math.sin(x*142.52+y*271.31)*47528.73;
      const fine = (v-Math.floor(v)-.5)*29;
      const bands = Math.sin(y*.38+x*.006)*3.7+Math.cos(y*.17-x*.019)*2.8;
      const coarse = Math.sin(x*.071+y*.14)*2.1;
      const j=(y*w+x)*4, d=fine+bands+coarse;
      pixel[j]=93+d;pixel[j+1]=64+.85*d;pixel[j+2]=48+.7*d;pixel[j+3]=255;
    }
    ctx.putImageData(image,0,0);
    for(let i=0;i<1350;i++){
      const x=(i*89.173)%w,y=(i*i*17.667)%h;
      ctx.fillStyle=i%4?'#fbc38715':'#20181442';ctx.fillRect(x,y,(i%7)*.54+1,1+i%3*.34);
    }
  });
}
export function letterTexture(label,bg,color,w,h,border){
  return makeCanvas(w,h,ctx=>{
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);ctx.strokeStyle=border;ctx.lineWidth=4;ctx.strokeRect(5,5,w-10,h-10);
    ctx.font=(label.length===1?'800 ':'700 ')+Math.round(h*(label.length===1 ? .75 : .48))+'px Georgia';ctx.fillStyle=color;
    ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(label,w/2,h/2+3,w-18);
  });
}
export function shadowTexture(){
  return makeCanvas(96,96,(ctx,w,h)=>{
    const fade=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
    fade.addColorStop(0,'#100c0cda');fade.addColorStop(.52,'#30221c6c');fade.addColorStop(1,'#20141100');
    ctx.fillStyle=fade;ctx.fillRect(0,0,w,h);
  });
}
