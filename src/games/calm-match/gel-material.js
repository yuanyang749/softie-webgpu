import * as THREE from 'three/webgpu';
import { bumpMap, cameraPosition, color, float, mix, mx_noise_float, normalView, normalWorld, pmremTexture, positionLocal, positionViewDirection, positionWorld, reflect, uniform, uv, vec3, vec4 } from 'three/tsl';

// Match the homepage's softbox rig, at a smaller cubemap resolution for the tray.
export function makeGelEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0xe9e7e5);
  const cards = [];
  for (const [x, y, z, w, h, strength] of [
    [-4.5, 5, 3, 3.2, 5.5, 12], [4.5, 3, 2, 1.6, 5, 9],
    [-1, 1, -5, 3, 3, 1.2], [-6, -.5, -2, 1.5, 5, -.45],
    [6, -.5, -2, 1.5, 5, -.45], [0, -4, 0, 9, 7, .7],
  ]) {
    const material = new THREE.MeshBasicNodeMaterial();
    const q = uv().sub(.5).mul(2).abs().pow(4);
    material.colorNode = float(.8).add(q.x.add(q.y).pow(.25).smoothstep(.7, 1).oneMinus().mul(strength));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    card.position.set(x, y, z); card.lookAt(0, 0, 0); studio.add(card); cards.push(card);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  try { return pmrem.fromScene(studio, .015, .1, 40, { size: 256 }); }
  finally { cards.forEach(c => { c.geometry.dispose(); c.material.dispose(); }); pmrem.dispose(); }
}

export function makeTrayGel(value, environment) {
  const tintColor = new THREE.Color(value);
  tintColor.multiplyScalar(1 / Math.max(tintColor.r, tintColor.g, tintColor.b)).lerp(new THREE.Color('white'), .23);
  // The authored homepage body is ~4x larger. Scale optical distance as well as geometry.
  const gel = new THREE.MeshPhysicalNodeMaterial({
    color: 'white', metalness: 0, roughness: .018,
    transmission: 1, thickness: .6, ior: 1.46,
    attenuationColor: tintColor, attenuationDistance: 1.05,
    clearcoat: .65, clearcoatRoughness: .025,
    specularIntensity: .85, envMapIntensity: 1.1,
  });
  const tint = uniform(gel.attenuationColor);
  const facing = normalView.dot(positionViewDirection).abs().clamp(0, 1);
  gel.thicknessNode = facing.pow(.55).mul(.5625).add(.0375);
  const limb = facing.smoothstep(.14, .34).oneMinus();
  const candy = mix(color('#f5f5f3'), tint, .48);
  const setupOutput = gel.setupOutput.bind(gel);
  gel.setupOutput = function (builder, output) {
    return setupOutput(builder, mix(output, vec4(candy, output.a), limb));
  };
  gel.normalNode = bumpMap(mx_noise_float(positionLocal.mul(36)), .012);
  gel.clearcoatNormalNode = gel.normalNode;
  const rear = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const direction = reflect(positionWorld.sub(cameraPosition).normalize(), normalWorld);
  const reflection = pmremTexture(environment, direction, .025).rgb;
  rear.colorNode = mix(color('#f5f5f3'), reflection.mul(tint.pow(.3)), facing.oneMinus().pow(3).mul(.55).add(.025));
  rear.maskNode = facing.greaterThan(.12);
  return { gel, rear };
}

export function makeAirMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({ color: '#fff1f7', metalness: 0, roughness: .028, clearcoat: 1, envMapIntensity: 1.1, transparent: true, depthWrite: false, depthTest: false });
  const glint = normalView.dot(vec3(-.3, .45, .85).normalize()).max(0).pow(48);
  material.opacityNode = normalView.dot(positionViewDirection).abs().oneMinus().pow(3).mul(.45).add(glint.mul(.8)).add(.008).clamp(0, 1);
  return material;
}
