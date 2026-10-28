import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SILKS } from './presentation.mjs';
import FlatTrack from './FlatTrack';

const COATS = ['#a96d43', '#d5c6a7', '#643d28', '#8e5036', '#39332f', '#bc8c57'];
const GOLD = '#c7a467';
const X_START = -13;
const X_END = 13;
const laneZ = i => (i - 2.5) * 2.18;

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.57, metalness: 0.06, ...options });
}
function mesh(parent, geometry, mat, pos = [0, 0, 0], scale = [1, 1, 1]) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(...pos); item.scale.set(...scale);
  item.castShadow = true; item.receiveShadow = true;
  parent.add(item); return item;
}
function box(parent, size, mat, pos) { return mesh(parent, new THREE.BoxGeometry(...size), mat, pos); }
function labelTexture(text, background, color = '#f7edd6', width = 256, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color; ctx.font = `600 ${height * 0.64}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height * 0.54, width * 0.9);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function makeHorse(id) {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const skin = material(COATS[id], { roughness: 0.39 });
  const dark = material(id === 1 ? '#9a8a73' : '#29251f', { roughness: 0.8 });
  const hoof = material('#272720');
  const saddle = material(SILKS[id]);
  const brass = material(GOLD, { metalness: 0.72, roughness: 0.3 });
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  // Sculpted torso, shoulder and haunches; the model faces +X.
  mesh(body, sphere, skin, [0, 1.2, 0], [0.86, 0.39, 0.31]);
  mesh(body, sphere, skin, [-0.52, 1.24, 0], [0.43, 0.4, 0.34]);
  mesh(body, sphere, skin, [0.52, 1.3, 0], [0.36, 0.43, 0.3]);
  const neck = mesh(body, sphere, skin, [0.78, 1.62, 0], [0.27, 0.6, 0.23]); neck.rotation.z = -0.42;
  const head = new THREE.Group(); head.position.set(1.08, 2.01, 0); body.add(head);
  const skull = mesh(head, sphere, skin, [0, 0, 0], [0.3, 0.23, 0.18]); skull.rotation.z = -0.25;
  mesh(head, sphere, skin, [0.26, -0.14, 0], [0.29, 0.15, 0.16]);
  mesh(head, sphere, dark, [0.44, -0.18, 0], [0.105, 0.09, 0.14]);
  for (const side of [-1, 1]) {
    const ear = mesh(head, new THREE.ConeGeometry(0.065, 0.3, 8), skin, [-0.12, 0.29, side * 0.11]); ear.rotation.z = 0.15;
    mesh(head, sphere, material('#0f100d'), [0.08, 0.035, side * 0.173], [0.035, 0.038, 0.018]);
    const number = mesh(body, new THREE.PlaneGeometry(0.43, 0.37), new THREE.MeshBasicMaterial({ map: labelTexture(String(id + 1), SILKS[id]), side: THREE.DoubleSide }), [-0.12, 1.23, side * 0.337]);
    if (side < 0) number.rotation.y = Math.PI;
  }
  mesh(body, sphere, saddle, [-0.13, 1.43, 0], [0.43, 0.18, 0.355]);
  const maneCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.08, 1.56, 0), new THREE.Vector3(0.45, 1.75, 0), new THREE.Vector3(0.69, 2.05, 0), new THREE.Vector3(0.98, 2.2, 0)]);
  mesh(body, new THREE.TubeGeometry(maneCurve, 14, 0.065, 6, false), dark);
  const tailPivot = new THREE.Group(); tailPivot.position.set(-0.84, 1.37, 0); body.add(tailPivot);
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.35, 0.05, 0), new THREE.Vector3(-0.72, -0.15, 0), new THREE.Vector3(-0.96, -0.36, 0)]);
  mesh(tailPivot, new THREE.TubeGeometry(tailCurve, 10, 0.085, 6, false), dark);
  const legs = [];
  for (const front of [false, true]) for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(front ? 0.55 : -0.55, 1.14, side * 0.21); body.add(pivot);
    const upper = mesh(pivot, new THREE.CylinderGeometry(front ? 0.1 : 0.16, 0.07, 0.5, 10), skin, [0, -0.24, 0]);
    const knee = new THREE.Group(); knee.position.y = -0.47; pivot.add(knee);
    mesh(knee, sphere, skin, [0, 0, 0], [0.09, 0.095, 0.085]);
    mesh(knee, new THREE.CylinderGeometry(0.06, 0.045, 0.47, 8), skin, [0, -0.23, 0]);
    mesh(knee, sphere, hoof, [0.025, -0.49, 0], [0.1, 0.08, 0.08]);
    legs.push({ pivot, knee, front, side });
  }
  const base = mesh(group, new THREE.RingGeometry(0.6, 0.64, 32), brass, [0, 0.025, 0]); base.rotation.x = -Math.PI / 2; base.scale.set(1.7, 0.78, 1);
  group.userData = { body, head, legs, tailPivot, ring: base, targetX: X_START, movingUntil: 0, returning: false, lastPosition: null };
  group.position.set(X_START, 0.05, laneZ(id));
  group.scale.setScalar(0.86);
  return group;
}

function makeWorld(scene, rain) {
  const brass = material(GOLD, { metalness: 0.66, roughness: 0.35 });
  const wood = material('#39251b', { roughness: 0.4 });
  const trim = material('#785339');
  const cream = material('#cfc4a4');
  box(scene, [31.5, 0.8, 16.1], wood, [0, -0.5, 0]);
  box(scene, [31.8, 0.13, 16.4], trim, [0, -0.9, 0]);
  box(scene, [31.2, 0.08, 15.85], brass, [0, -0.08, 0]);
  box(scene, [30.8, 0.08, 15.45], material('#1e3025'), [0, -0.015, 0]);
  // Procedural grass is generated locally; no asset or tracking requests.
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#486046'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const x = (i * 73) % 256, y = (i * 31 + Math.floor(i / 17) * 47) % 256;
    ctx.fillStyle = i % 2 ? '#3d543d' : '#596d4a'; ctx.fillRect(x, y, 1, 3);
  }
  const grass = new THREE.CanvasTexture(canvas); grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(12, 2); grass.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 6; i++) {
    box(scene, [29, 0.03, 2.12], material(i % 2 ? '#b9c8a6' : '#9eaf8b', { map: grass, roughness: 0.97 }), [0, 0.04, laneZ(i)]);
    for (let n = 0; n <= 12; n++) box(scene, [0.026, 0.012, 1.98], material('#99a47b', { transparent: true, opacity: 0.24 }), [X_START + n * (26 / 12), 0.07, laneZ(i)]);
    const num = mesh(scene, new THREE.PlaneGeometry(1, 1.1), new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1), '#233b30') }), [-14.5, 0.08, laneZ(i)]); num.rotation.x = -Math.PI / 2;
    for (let row = 0; row < 2; row++) for (let j = 0; j < 4; j++) box(scene, [0.3, 0.015, 0.54], material((row + j) % 2 ? '#27382c' : '#ece2c7'), [X_END + row * 0.3, 0.085, laneZ(i) - 0.81 + j * 0.54]);
  }
  for (const side of [-1, 1]) {
    box(scene, [31, 0.1, 0.12], brass, [0, 0.65, side * 7.1]);
    box(scene, [31, 0.08, 0.09], cream, [0, 0.33, side * 7.1]);
    for (let x = -15; x <= 15; x += 2) box(scene, [0.085, 0.7, 0.085], cream, [x, 0.3, side * 7.1]);
    for (let x = -14; x <= 14; x += 7) {
      mesh(scene, new THREE.CylinderGeometry(0.045, 0.07, 3.2, 8), brass, [x, 1.6, side * 7.7]);
      mesh(scene, new THREE.SphereGeometry(0.21, 12, 8), material('#fff1ca', { emissive: '#ffd28e', emissiveIntensity: 2.3 }), [x, 3.25, side * 7.7]);
      const glow = new THREE.PointLight('#ffce8a', 5, 7, 2); glow.position.set(x, 3.3, side * 7.6); scene.add(glow);
    }
  }
  // Finish arch is above the rails, never in a horse's path.
  for (const z of [-6.9, 6.9]) {
    box(scene, [0.28, 3.4, 0.3], wood, [13.4, 1.7, z]);
    mesh(scene, new THREE.SphereGeometry(0.23, 14, 10), brass, [13.4, 3.55, z]);
  }
  const finish = mesh(scene, new THREE.PlaneGeometry(4.4, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture('THE TRACK', '#183326', GOLD, 512, 96), side: THREE.DoubleSide }), [1, 0.72, 7.2]);
  // Miniature clubhouse and empty seating, decorative rather than fake players.
  for (const side of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      box(scene, [22 - r * 0.7, 0.2, 0.65], material('#334b3d'), [-1, 0.2 + r * 0.42, side * (9 + r * 0.8)]);
      box(scene, [22 - r * 0.7, 0.3, 0.1], wood, [-1, 0.45 + r * 0.42, side * (9.2 + r * 0.8)]);
    }
    for (const x of [-15.5, 15.5]) {
      const trunk = material('#5a4130'), leaf = material('#234535');
      mesh(scene, new THREE.CylinderGeometry(0.13, 0.18, 2, 8), trunk, [x, 0.8, side * 10]);
      mesh(scene, new THREE.ConeGeometry(1.15, 3.2, 12), leaf, [x, 2.5, side * 10]);
    }
  }
  const floor = mesh(scene, new THREE.PlaneGeometry(180, 180), material('#101e18'), [0, -1.02, 0]); floor.rotation.x = -Math.PI / 2;
}

export default function TrackScene(props) {
  const host = useRef(null); const latest = useRef(props); latest.current = props;
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { setError(true); latest.current.onRenderer?.('flat'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#111f19'); scene.fog = new THREE.FogExp2('#111f19', 0.017);
    const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 160);
    camera.position.set(7, 23, 30); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight('#d9e9e3', '#826042', 2.4));
    const key = new THREE.DirectionalLight('#ffe2b0', 3.5); key.position.set(-5, 22, 10); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -23, right: 23, top: 17, bottom: -17, near: 1, far: 70 });
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; scene.add(key);
    const rim = new THREE.DirectionalLight('#91bfc0', 1.7); rim.position.set(8, 9, -15); scene.add(rim);
    makeWorld(scene);
    const horses = Array.from({ length: 6 }, (_, id) => makeHorse(id)); horses.forEach(h => scene.add(h));
    const hurdles = new THREE.Group(); scene.add(hurdles);
    for (let i = 0; i < 6; i++) {
      box(hurdles, [0.12, 0.8, 1.7], material('#d4c39a'), [0, 0.43, laneZ(i)]);
      box(hurdles, [0.14, 0.15, 1.8], material('#324a3c'), [0, 0.85, laneZ(i)]);
    }
    const weatherPositions = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) { weatherPositions[i * 3] = ((i * 73) % 320) / 10 - 16; weatherPositions[i * 3 + 1] = ((i * 31) % 120) / 10; weatherPositions[i * 3 + 2] = ((i * 57) % 160) / 10 - 8; }
    const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
    const rain = new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: '#adcacb', size: 0.06, transparent: true, opacity: 0.6 })); scene.add(rain);
    const dustGeometry = new THREE.BufferGeometry(); const dustPositions = new Float32Array(6 * 12 * 3);
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#c1a57a', size: 0.1, transparent: true, opacity: 0.46 })); scene.add(dust);
    const contextLost = e => { e.preventDefault(); renderer.setAnimationLoop(null); setError(true); latest.current.onRenderer?.('flat'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const halfH = Math.max(11.8, 19 / (width / height));
      camera.left = -halfH * width / height; camera.right = -camera.left; camera.top = halfH; camera.bottom = -halfH; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    let lastTime = performance.now(); const cameraTarget = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3(); const desiredTarget = new THREE.Vector3();
    renderer.setAnimationLoop(now => {
      if (document.hidden) { lastTime = now; return; }
      const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
      const p = latest.current, time = now / 1000, reduced = p.reducedMotion;
      const isReturn = p.raceType === 'down_back' || p.raceType === 'magic_dice';
      hurdles.visible = p.raceType === 'hurdle' && p.phase !== 'tiebreak';
      rain.visible = p.condition === 'rain' && !reduced;
      scene.fog.density = p.condition === 'fog' ? 0.028 : 0.017;
      horses.forEach((horse, i) => {
        const d = horse.userData, position = p.positions[i] || 0;
        const span = p.phase === 'tiebreak' ? 3 : 12;
        const x = X_START + Math.max(0, Math.min(1, position / span)) * (X_END - X_START);
        if (d.lastPosition === null || d.lastPhase !== p.phase) horse.position.x = x;
        d.lastPhase = p.phase;
        if (d.lastPosition !== x) { d.targetX = x; d.movingUntil = now + (p.moveDuration || 680); d.lastPosition = x; }
        const returning = isReturn && p.legDone[i] && p.phase !== 'tiebreak';
        const moving = !reduced && now < d.movingUntil && p.rollCount > 0;
        const blend = reduced ? 1 : 1 - Math.exp(-dt * 8);
        horse.position.x += (d.targetX - horse.position.x) * blend;
        if (Math.abs(d.targetX - horse.position.x) < 0.02) horse.position.x = d.targetX;
        horse.rotation.y = returning ? Math.PI : 0;
        const t = time * 16 + i * 0.7;
        d.body.position.y = moving ? Math.abs(Math.sin(t)) * 0.1 : (reduced ? 0 : Math.sin(time * 1.7 + i) * 0.018);
        if (p.jumpingHorses?.includes(i) && moving) d.body.position.y += Math.sin(Math.PI * Math.max(0, 1 - (d.movingUntil - now) / (p.moveDuration || 680))) * 0.5;
        d.head.rotation.z = moving ? Math.sin(t) * 0.06 : 0;
        d.tailPivot.rotation.x = reduced ? 0 : Math.sin(time * (moving ? 10 : 2) + i) * 0.16;
        d.legs.forEach(leg => {
          const offset = (leg.front ? 0 : 2.1) + (leg.side > 0 ? 0.65 : 0);
          leg.pivot.rotation.z = moving ? Math.sin(t + offset) * 0.7 : 0;
          leg.knee.rotation.z = moving ? Math.max(0, Math.sin(t + offset + 0.8)) * 1.25 - 0.15 : 0;
        });
        d.ring.visible = i === p.focusedHorse || i === p.winner;
        horse.visible = p.phase !== 'tiebreak' || !p.tieHorses || p.tieHorses.includes(i);
        for (let j = 0; j < 12; j++) {
          const n = (i * 12 + j) * 3, phase = (time * 1.8 + j / 12) % 1;
          dustPositions[n] = horse.position.x - (returning ? -1 : 1) * (0.8 + phase * 1.5);
          dustPositions[n + 1] = moving ? 0.12 + phase * 0.5 : -2;
          dustPositions[n + 2] = laneZ(i) + Math.sin(j * 5.3) * phase * 0.4;
        }
      });
      dust.visible = !reduced; dustGeometry.attributes.position.needsUpdate = true;
      if (rain.visible) { for (let i = 0; i < 240; i++) { weatherPositions[i * 3 + 1] -= dt * 8; if (weatherPositions[i * 3 + 1] < 0) weatherPositions[i * 3 + 1] = 12; } rainGeometry.attributes.position.needsUpdate = true; }
      if (p.cameraMode === 'follow' && p.focusedHorse !== null) {
        const focus = horses[p.focusedHorse]; desiredTarget.set(focus.position.x, 0.6, focus.position.z);
        cameraPosition.set(focus.position.x + 5, 11, focus.position.z + 17); camera.zoom += (1.85 - camera.zoom) * (reduced ? 1 : dt * 3);
      } else if (p.cameraMode === 'overhead') {
        desiredTarget.set(0, 0, 0); cameraPosition.set(0, 36, 0.1); camera.zoom += (1 - camera.zoom) * (reduced ? 1 : dt * 3);
      } else {
        desiredTarget.set(0, 0, 0); cameraPosition.set(7, 23, 30); camera.zoom += (1 - camera.zoom) * (reduced ? 1 : dt * 3);
      }
      const cameraBlend = reduced ? 1 : 1 - Math.exp(-dt * 3);
      camera.position.lerp(cameraPosition, cameraBlend); cameraTarget.lerp(desiredTarget, cameraBlend); camera.lookAt(cameraTarget); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null); observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); const ms = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []; ms.forEach(m => { materials.add(m); Object.values(m).forEach(v => { if (v?.isTexture) textures.add(v); }); }); });
      textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <div className="track-scene" ref={host} role="img" aria-label="Animated miniature racecourse. Exact positions and results are listed in the running order.">
    {error && <FlatTrack {...props} />}
  </div>;
}
