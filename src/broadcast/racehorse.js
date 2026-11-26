import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkin } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clamp, mix, smooth, GO, SILKS } from './playback.mjs';
const MODEL_SCALE = .895;
const COAT_TONES = [null, '#b7b1a4', null, '#a34d2b', '#241b19', '#695043'];
const COAT_MIX = [0, .77, 0, .39, .73, .48];

function gaitTime(time, id, progress, duration) {
  return (time * (.79 + id * .014) + progress * .033 + id * duration * .21) % duration;
}

export async function loadRacehorse() {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(import.meta.env.BASE_URL + 'broadcast/racehorse.glb');
  const gallop = THREE.AnimationClip.findByName(gltf.animations, 'Gallop');
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
  if (!gallop || !idle) throw new Error('The racehorse is missing an animation.');
  return { model: gltf.scene, gallop, idle };
}

export function makeRacehorseFactory(T, asset, letterCanvas) {
  function recolor(geometry, id) {
    const source = geometry.getAttribute('color');
    if (!source || !COAT_MIX[id]) return geometry;
    const result = new T.BufferGeometry();
    result.setIndex(geometry.index);
    Object.entries(geometry.attributes).forEach(([name, value]) => result.setAttribute(name, value));
    result.groups = geometry.groups.map(group => ({ ...group }));
    result.boundingBox = geometry.boundingBox;
    result.boundingSphere = geometry.boundingSphere;
    const target = new T.Color(COAT_TONES[id]);
    const rgb = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) {
      const r = source.getX(i), g = source.getY(i), b = source.getZ(i);
      const luma = .2126 * r + .7152 * g + .0722 * b;
      const tint = COAT_MIX[id] * (1 - clamp((luma - .43) / .34));
      const shade = clamp(.34 + luma * 1.61, .34, 1.4);
      rgb[i * 3] = mix(r, target.r * shade, tint);
      rgb[i * 3 + 1] = mix(g, target.g * shade, tint);
      rgb[i * 3 + 2] = mix(b, target.b * shade, tint);
    }
    result.setAttribute('color', new T.BufferAttribute(rgb, 3));
    return result;
  }

  return id => {
    const model = cloneSkin(asset.model);
    model.rotation.y = Math.PI / 2;
    model.scale.setScalar(MODEL_SCALE);
    const number = new T.CanvasTexture(letterCanvas(String(id + 1), SILKS[id], id === 1 || id === 2 ? '#211b17' : '#fff0d6', 128, 128, SILKS[id]));
    number.colorSpace = T.SRGBColorSpace;
    number.flipY = false;
    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
      const material = mesh.material;
      if (material.name === 'Coat') {
        mesh.geometry = recolor(mesh.geometry, id);
      } else if (material.name === 'Cloth_Blue') {
        mesh.material = material.clone();
        mesh.material.color.set(SILKS[id]);
      } else if (material.name === 'Number') {
        mesh.material = material.clone();
        mesh.material.map = number;
        mesh.material.color.set('#ffffff');
      }
    });
    const spine = model.getObjectByName('Spine');
    const mixer = new T.AnimationMixer(model);
    const gallop = mixer.clipAction(asset.gallop).play();
    const idle = mixer.clipAction(asset.idle).play();
    const seat = new T.Vector3();
    function sample(time, progress, rider, launched) {
      const blend = launched ? 1 : 0;
      idle.setEffectiveWeight(1-blend);
      gallop.setEffectiveWeight(blend);
      const moment = launched ? gaitTime(time, id, progress, asset.gallop.duration) : time*.85+id*.19;
      mixer.setTime(moment);
      model.updateWorldMatrix(true, true);
      if (!spine) return;
      spine.getWorldPosition(seat);
      model.parent.worldToLocal(seat);
      rider.position.set(seat.x + .033, seat.y + .276, seat.z);
    }
    return { model, sample };
  };
}
