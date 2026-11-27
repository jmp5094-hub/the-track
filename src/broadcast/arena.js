import { clamp, lane, smooth, SILKS, GO, SPACE, LEADER_START, COURSE_MIN, COURSE_MAX, TRACK_FINISH } from './playback.mjs';

export function buildArena(T, scene, { dirtCanvas, letterCanvas, shadowCanvas, horseRig }) {
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const geo = {
    sphere: new T.SphereGeometry(1, 18, 12), box: new T.BoxGeometry(1,1,1),
    tube: new T.CylinderGeometry(1,1,1,10), taper: new T.CylinderGeometry(.65,1,1,12),
    plane: new T.PlaneGeometry(1,1), ear: new T.ConeGeometry(1,1,9),
  };
  const standard = (color, rest = {}) => new T.MeshStandardMaterial({ color, roughness: .64, ...rest });
  const simple = (color, rest = {}) => new T.MeshBasicMaterial({ color, ...rest });
  const shape = (parent, g, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const node = new T.Mesh(g, material); node.position.set(x,y,z); node.scale.set(sx,sy,sz); parent.add(node); return node;
  };
  const ball = (parent, m, x, y, z, rx, ry, rz) => shape(parent, geo.sphere, m, x,y,z,rx,ry,rz);
  const block = (parent, m, x, y, z, w, h, d) => shape(parent, geo.box, m, x,y,z,w,h,d);
  const join = (parent, m, a, b, at, bt = at, g = geo.sphere) => {
    const delta = b.clone().sub(a), length = delta.length();
    const middle = a.clone().lerp(b,.5);
    const node = shape(parent,g,m,middle.x,middle.y,middle.z,at,g === geo.sphere ? length * .57 : length,bt);
    node.quaternion.setFromUnitVectors(V(0,1,0), delta.normalize());
    return node;
  };
  const curve = (parent, m, points, radius, sides = 7) => {
    const path = new T.CatmullRomCurve3(points.map(p => V(...p)));
    return shape(parent, new T.TubeGeometry(path, 18, radius, sides, false),m,0,0,0);
  };
  const tex = source => { const texture = new T.CanvasTexture(source); texture.colorSpace = T.SRGBColorSpace; return texture; };
  const paint = (text, background, color, width=192, height=112, border='#766143') => tex(letterCanvas(text,background,color,width,height,border));

  scene.background = new T.Color('#252730');
  scene.fog = new T.FogExp2('#3a3839',.003);
  const sky=new T.HemisphereLight('#ffedcc','#6f5146',2.08);scene.add(sky);
  const warm = new T.DirectionalLight('#ffd29a',2.35); warm.position.set(9,13,12); scene.add(warm);
  const rim = new T.DirectionalLight('#ccdef1',1.7); rim.position.set(-8,5,-10); scene.add(rim);

  const dirt = tex(dirtCanvas); dirt.wrapS = dirt.wrapT = T.RepeatWrapping; dirt.repeat.set(20,3); dirt.anisotropy = 6;
  const length=COURSE_MAX-COURSE_MIN, middle=(COURSE_MAX+COURSE_MIN)/2;
  const ground=standard('#e0b294',{map:dirt,roughness:1});
  block(scene,ground,middle,-.11,0,length,.21,15.4);
  const dark = standard('#262329'), stone = standard('#4b4849'), concrete = standard('#726b5f');
  const cream = standard('#d4c5a4'), brass = standard('#a87b40',{metalness:.53,roughness:.32}), backlit = simple('#ffd093');
  const glass = standard('#3a4652',{emissive:'#705037',emissiveIntensity:.37,roughness:.52});
  const floor = standard('#514139',{roughness:.94});
  // The board never drifts: one line per logical space, six fixed lanes.
  const chalk=standard('#e4d9bd',{transparent:true,opacity:.55,roughness:1});
  for(let i=0;i<=6;i++)block(scene,chalk,36,.025,(i-3)*1.56,72,.025,.035);
  const farMarkers=[];
  for(let step=0;step<=12;step++){
    block(scene,chalk,step*SPACE,.03,0,step>=9?.12:.07,.026,9.4);
    if(step>0&&step<12){
      const label=shape(scene,geo.plane,simple('#ffffff',{map:paint(String(step),'#3a352a','#f5e7c8',96,96),transparent:false}),step*SPACE,.05,5.65,1.15,1.15,1);
      label.rotation.x=-Math.PI/2;
    }
    if(step>=9&&step<12){
      farMarkers.push(shape(scene,geo.plane,simple('#ffffff',{map:paint((12-step)+' TO GO','#233c31','#ffe2a7',280,112),side:T.DoubleSide}),step*SPACE,1.15,-6.25,2.35,.94,1));
    }
  }
  for (const side of [-1,1]) {
    block(scene,floor,middle,-.155,side*14.8,length,.3,13.8);
    block(scene,side>0?brass:cream,middle,.8,side*7.17,length,.095,.105);
    block(scene,cream,middle,.41,side*7.17,length,.061,.075);
    for(let x=COURSE_MIN;x<=COURSE_MAX;x+=3.2) block(scene,cream,x,.42,side*7.17,.08,.86,.085);
  }

  // Stationary architecture gives the tracking camera near and far reference points.
  block(scene,stone,middle,1,-11,length,2,2.9);
  block(scene,brass,middle,2.08,-9.81,length,.13,.3);
  block(scene,dark,middle,4.25,-17,length,8.5,4.1);
  block(scene,concrete,middle,8.49,-15.2,length,.3,7.2);
  block(scene,brass,middle,8.35,-11.7,length,.13,.12);
  for(let row=0;row<5;row++) {
    block(scene,stone,middle,2.12+row*.48,-10.2-row*.91,length,.24,1.02);
    block(scene,dark,middle,2.42+row*.48,-10.4-row*.91,length,.24,.60);
  }
  for(let x=COURSE_MIN+1.4;x<COURSE_MAX-5;x+=8.6) {
    block(scene,concrete,x,4.32,-12.51,.42,8.2,.53);
    block(scene,brass,x,6.93,-12.18,.48,.13,.21);
    block(scene,glass,x+4.29,6.29,-14.88,7.05,1.7,.1);
    for(let n=-2;n<=2;n++) block(scene,dark,x+4.29+n*1.32,6.29,-14.79,.066,1.72,.09);
    block(scene,backlit,x+4.3,7.55,-12.4,2.26,.085,.36);
    block(scene,brass,x+.6,2.8,-8.98,.06,5.65,.06);
    block(scene,backlit,x+.6,5.64,-8.98,.39,.06,.23);
  }
  // The crowd is low-detail at this focal distance. Use instancing for consistent draw cost.
  const crowdGeo=new T.SphereGeometry(1,8,6), crowdMat=standard('#ffffff',{roughness:.95});
  const dummy=new T.Object3D();
  const clothes=['#29252a','#4e3b38','#6f6251','#493f44','#a68b6e','#383b44','#5b3031','#72604a'];
  for(let section=COURSE_MIN;section<COURSE_MAX;section+=40) {
    const counts=Math.min(155,Math.floor((COURSE_MAX-section-2)/1.24)*5), fans=new T.InstancedMesh(crowdGeo,crowdMat,counts);
    for(let i=0;i<counts;i++) {
      const row=i%5, x=section+Math.floor(i/5)*1.24+row*.46;
      dummy.position.set(x,2.58+row*.48+((i*73)%11)*.017,-10.42-row*.91);
      dummy.scale.set(.155+((i*37)%8)*.009,.25,.14);
      dummy.updateMatrix();fans.setMatrixAt(i,dummy.matrix);
      fans.setColorAt(i,new T.Color(clothes[(i*17+Math.floor(i/7))%clothes.length]));
    }
    fans.instanceMatrix.needsUpdate=true;fans.computeBoundingSphere();scene.add(fans);
  }
  for(let x=COURSE_MIN+11;x<COURSE_MAX;x+=25) {
    const placard = shape(scene,geo.plane,simple('#ffffff',{map:paint('THE TRACK','#242524','#d6b782',400,84)}),x,1.45,-8.97,4.5,.94,1);
    placard.rotation.z = 0;
  }
  const finishGroup=new T.Group();scene.add(finishGroup);
  for (let row=0;row<3;row++) for(let j=0;j<20;j++) {
    block(finishGroup,(j+row)%2?dark:cream,TRACK_FINISH + (row-1)*.19,.025,(j-9.5)*.715,.191,.028,.715);
  }
  for(const z of [-7.13,7.13]) {
    block(finishGroup,dark,TRACK_FINISH,1.14,z,.29,2.28,.28);
    block(finishGroup,brass,TRACK_FINISH,2.28,z,.44,.2,.41);
    for(let n=0;n<6;n++)block(finishGroup,n%2?dark:cream,TRACK_FINISH,1.43+n*.115,z,.32,.115,.3);
  }
  const finishSign = shape(finishGroup,geo.plane,simple('#ffffff',{map:paint('FINISH','#292624','#f7dab0',260,84),side:T.DoubleSide}),TRACK_FINISH,2.93,-7.16,2.17,.70,1);
  finishSign.rotation.y = Math.PI / 18;

  const turnSign=shape(scene,geo.plane,simple('#ffffff',{map:paint('TURN FOR HOME','#233c31','#ffe2a7',400,112),side:T.DoubleSide}),72,2.93,-7.16,3.34,.94,1);
  const hurdleGroup=new T.Group();scene.add(hurdleGroup);
  for(let i=0;i<6;i++){
    const z=lane(i);
    block(hurdleGroup,cream,36,.67,z,.16,.17,1.44);
    block(hurdleGroup,brass,36,.85,z,.18,.12,1.44);
    for(const side of [-1,1])block(hurdleGroup,cream,36,.42,z+side*.69,.13,.84,.13);
  }
  const rainPositions=new Float32Array(240*6),rainGeometry=new T.BufferGeometry();
  rainGeometry.setAttribute('position',new T.BufferAttribute(rainPositions,3).setUsage(T.DynamicDrawUsage));
  const rainfall=new T.LineSegments(rainGeometry,new T.LineBasicMaterial({color:'#c2d5d1',transparent:true,opacity:.35}));rainfall.frustumCulled=false;scene.add(rainfall);
  let weather='';
  const steel=standard('#394b49',{roughness:.55,metalness:.41});
  const gatePaint=standard('#53635a',{roughness:.62,metalness:.27});
  const gateTrim=standard('#c3bfaf',{roughness:.63});
  const doorX=LEADER_START+1.60;
  const gates=[];
  // Open canopy keeps all six horses visible from the elevated landscape camera.
  block(scene,steel,doorX,2.47,0,.13,.18,9.6);
  for(let i=0;i<=6;i++){
    const z=(i-3)*1.56;
    block(scene,steel,doorX,1.20,z,.11,2.45,.11);
    block(scene,steel,doorX-2.02,1.22,z,.095,2.45,.115);
    block(scene,gatePaint,doorX-1.02,.65,z,2.03,.089,.072);
    block(scene,gatePaint,doorX-1.02,1.22,z,2.03,.085,.077);
    block(scene,steel,doorX-1.02,2.43,z,2.06,.09,.086);
  }
  for(let i=0;i<6;i++) {
    const z=lane(i);
    const gateNumber=shape(scene,geo.plane,simple('#ffffff',{map:paint(String(i+1),'#2a3836','#f0e7d3',96,84),side:T.DoubleSide}),doorX+.08,2.58,z,.38,.31,1);
    gateNumber.rotation.y=Math.PI/2;
    for(const direction of [-1,1]) {
      const hinge=new T.Group();hinge.position.set(doorX,0,z+direction*.73);scene.add(hinge);
      const local=-direction;
      block(hinge,steel,0,.47,local*.35,.07,.061,.71);
      block(hinge,gateTrim,0,1.39,local*.35,.056,.067,.71);
      for(let bar=0;bar<4;bar++) block(hinge,steel,0,.93,local*(.07+bar*.19),.055,.96,.039);
      gates.push({hinge,direction});
    }
  }

  const shadowMat = new T.MeshBasicMaterial({map:tex(shadowCanvas),transparent:true,opacity:.72,depthWrite:false});
  const boots = standard('#272523',{roughness:.65});
  const pants = standard('#e6decd',{roughness:.92});
  const leather = standard('#292421',{roughness:.72});
  const skin = standard('#a77561',{roughness:.88});
  const lens = standard('#333a39',{metalness:.08,roughness:.23});
  const piping = standard('#e5d2ae',{roughness:.88});

  function runner(id) {
    const root = new T.Group(); scene.add(root);
    const rig = horseRig(id); root.add(rig.model);
    const jockey = new T.Group(); jockey.position.set(-.095,1.52,0); root.add(jockey);
    const suit = standard(SILKS[id],{roughness:.91});
    ball(jockey,pants,-.05,.081,0,.153,.10,.144);
    join(jockey,suit,V(-.02,.16,0),V(.42,.384,0),.122,.146);
    ball(jockey,suit,.29,.318,0,.181,.099,.148);
    join(jockey,suit,V(.36,.354,0),V(.45,.368,0),.084,.095);
    const face = ball(jockey,skin,.49,.423,0,.117,.080,.085); face.rotation.z=.15;
    const helmet = ball(jockey,suit,.455,.492,0,.126,.096,.105); helmet.rotation.z=.16;
    const visor = ball(jockey,leather,.55,.473,0,.093,.024,.116); visor.rotation.z=.13;
    curve(jockey,lens,[[.497,.445,-.081],[.57,.451,-.060],[.593,.45,0],[.567,.452,.06],[.497,.445,.081]],.021,6);
    for(const side of [-1,1]) {
      const leg = side * .23;
      join(jockey,pants,V(-.099,.117,side*.101),V(.168,-.016,leg),.084,.067);
      ball(jockey,pants,.163,-.016,leg,.078,.068,.075);
      join(jockey,boots,V(.168,-.032,leg),V(.002,-.304,side*.267),.049,.05);
      const shoe = ball(jockey,boots,.043,-.306,side*.266,.091,.037,.049);shoe.rotation.z=-.16;
      const shoulder = V(.30,.326,side*.13), elbow = V(.293,.199,side*.186);
      const grip = V(.556,.205,side*.157);
      join(jockey,suit,shoulder,elbow,.061,.055);
      join(jockey,suit,elbow,grip,.049,.045);
      join(jockey,piping,V(.48,.207,side*.162),V(.506,.207,side*.161),.05,.053,geo.tube);
      ball(jockey,leather,.559,.205,side*.154,.052,.029,.034);
    }
    const shadow = shape(root,geo.plane,shadowMat,-.16,.026,0,3.7,1.44,1);shadow.rotation.x = -Math.PI/2;
    const pin=new T.Sprite(new T.SpriteMaterial({map:paint(String(id+1),SILKS[id],'#162019',96,96),depthTest:false}));
    pin.position.set(0,3.03,0);pin.scale.set(.65,.65,1);root.add(pin);
    const followRing=new T.Mesh(new T.RingGeometry(.68,.82,40),simple('#fff0c8',{side:T.DoubleSide}));
    followRing.rotation.x=-Math.PI/2;followRing.position.set(-.05,.05,0);followRing.scale.set(1.7,1,1);root.add(followRing);
    return {root,jockey,rig,shadow,pin,followRing};
  }

  const horses = Array.from({length:6},(_,id)=>runner(id));
  const maxDust = 150;
  const dustPositions = new Float32Array(maxDust*3);
  const dustGeo = new T.BufferGeometry();dustGeo.setAttribute('position',new T.BufferAttribute(dustPositions,3).setUsage(T.DynamicDrawUsage));
  const dust = new T.Points(dustGeo,new T.PointsMaterial({map:tex(shadowCanvas),color:'#b78565',size:.21,transparent:true,opacity:.29,depthWrite:false,alphaTest:.023}));
  dust.frustumCulled = false;scene.add(dust);
  function pose(frame, live, reduced) {
    const elapsed = frame.time;
    finishGroup.position.x=frame.roundTrip?-TRACK_FINISH:0;
    turnSign.visible=Boolean(frame.roundTrip);
    farMarkers.forEach(marker=>{marker.visible=!frame.roundTrip;});
    hurdleGroup.visible=frame.type==='hurdle'&&!frame.tiebreak;
    if(weather!==frame.condition){
      weather=frame.condition;
      scene.background.set(weather==='sunny'?'#252730':weather==='rain'?'#263a3e':'#616c67');
      scene.fog.color.set(weather==='fog'?'#89938a':weather==='rain'?'#40575a':'#3a3839');
      scene.fog.density=weather==='fog'?.013:weather==='rain'?.006:.003;
      ground.color.set(weather==='rain'?'#877365':'#e0b294');ground.roughness=weather==='rain'?.48:1;
      warm.intensity=weather==='sunny'?2.35:1.2;sky.intensity=weather==='fog'?2.4:2.08;
    }
    rainfall.visible=weather==='rain'&&!reduced;
    if(rainfall.visible){for(let i=0;i<240;i++){const n=i*6,x=COURSE_MIN+(i*17.31)%100,y=12-((elapsed*9+i*.71)%12),z=-8+(i*7.37)%16;rainPositions.set([x,y,z,x-.12,y-.65,z],n);}rainGeometry.attributes.position.needsUpdate=true;}
    const open=smooth(clamp((frame.time-GO+.11)/.31));
    for(const {hinge,direction} of gates)hinge.rotation.y=-direction*open*Math.PI*.53;
    horses.forEach((animal,i) => {
      animal.root.visible = frame.active.includes(i);
      animal.followRing.visible=frame.follow===i;
      animal.pin.scale.setScalar(frame.follow===i ? .96 : .65);
      const energy = frame.surge[i];
      const tuck = Math.sin(elapsed * 10.4 + i * 1.8);
      animal.root.position.set(frame.world[i],.015+(frame.jumps?.[i]||0),lane(i));
      animal.root.rotation.y = (frame.directions?.[i]<0?Math.PI:0)+Math.sin(elapsed*1.45+i)*.014;
      animal.jockey.rotation.z = reduced ? 0 : .027*tuck - .10*energy;
      animal.rig.sample(elapsed,frame.progress[i],animal.jockey,Boolean(frame.moving?.[i])&&!reduced);
    });
    dust.material.opacity=weather==='rain'?.12:.29;
    dust.visible = live && frame.moving?.some(Boolean) && !reduced;
    if(dust.visible) for(let i=0;i<maxDust;i++) {
      const moving=frame.active.filter(id=>frame.moving[id]);
      const id = moving[i%moving.length], seed = i*1.17 + id*.9, life = (elapsed*(1.55+(i%9)*.09)+seed)%1, energy=frame.surge[id];
      const n=i*3;
      dustPositions[n] = frame.world[id] - (frame.directions?.[id]||1)*(.8 + life*(3.55+energy) + (i%5)*.08);
      dustPositions[n+1] = .09 + Math.sin(life*Math.PI)*(.14+(i%11)*.033+energy*.13);
      dustPositions[n+2] = lane(id)+Math.sin(seed*17)*life*.66;
    }
    if(dust.visible) dustGeo.attributes.position.needsUpdate=true;
  }
  return {pose, horses};
}
