import * as THREE from 'three';
import { buildArena } from './arena';
import { loadRacehorse, makeRacehorseFactory } from './racehorse';
import { dirtTexture, letterTexture, shadowTexture } from './textures';
import { shotAt } from './playback.mjs';

export async function createTrackView(container) {
  const asset = await loadRacehorse();
  const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.65));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45,2,.07,400);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const arena = buildArena(THREE, scene, {
    dirtCanvas:dirtTexture(), letterCanvas:letterTexture, shadowCanvas:shadowTexture(),
    horseRig:makeRacehorseFactory(THREE,asset,letterTexture),
  });
  const lost = event => { event.preventDefault(); container.dataset.contextLost = 'true'; };
  const restored = () => { delete container.dataset.contextLost; };
  renderer.domElement.addEventListener('webglcontextlost',lost);
  renderer.domElement.addEventListener('webglcontextrestored',restored);
  container.append(renderer.domElement);
  const resize = () => {
    const {width,height} = container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    camera.aspect = width/height;
    renderer.setSize(Math.round(width),Math.round(height),false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const target = new THREE.Vector3();
  const from = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let lastTime;
  let lastSteady;
  function draw(frame, steady = false) {
    if (container.dataset.contextLost) return;
    const locked = steady || reduced.matches;
    const shot = shotAt(frame,camera.aspect,locked);
    const elapsed = frame.time;
    const reset = lastTime === undefined || elapsed < lastTime || elapsed-lastTime > .75 || locked !== lastSteady;
    const weight = reset || locked ? 1 : 1 - Math.exp(-Math.max(.016,elapsed-lastTime)*7);
    lastTime = elapsed;
    lastSteady = locked;
    from.set(...shot.from);
    aim.set(...shot.at);
    camera.position.lerp(from,weight);
    target.lerp(aim,weight);
    camera.lookAt(target);
    camera.fov += (shot.fov-camera.fov)*weight;
    camera.updateProjectionMatrix();
    arena.pose({...frame,time:frame.sceneTime},true,reduced.matches);
    renderer.render(scene,camera);
  }
  function dispose() {
    observer.disconnect();
    const resources = new Set();
    for (const root of [scene,asset.model]) root.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      for (const material of [node.material].flat().filter(Boolean)) {
        resources.add(material);
        for (const entry of Object.values(material)) if (entry?.isTexture) resources.add(entry);
      }
      if (node.skeleton) resources.add(node.skeleton);
    });
    for (const resource of resources) resource.dispose();
    renderer.domElement.removeEventListener('webglcontextlost',lost);
    renderer.domElement.removeEventListener('webglcontextrestored',restored);
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { draw,dispose };
}
