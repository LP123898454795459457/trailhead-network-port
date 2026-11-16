import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { heightAt, hash2, roadDistance, treeAtCell } from './world.js';

const socket = window.io({ transports: ['websocket', 'polling'] });
const viewport = document.getElementById('viewport');
const connection = document.querySelector('.connection');
const connectionLabel = document.getElementById('connection-label');
const playerCount = document.getElementById('players-online');
const speedValue = document.getElementById('speed-value');
const surfaceValue = document.getElementById('surface-value');
const coordinates = document.getElementById('coordinates');
const notice = document.getElementById('notice');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#aeb6a7');
scene.fog = new THREE.FogExp2('#aeb6a7', 0.00155);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
viewport.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight('#d9e3dd', '#453c2c', 2.0));
const sun = new THREE.DirectionalLight('#fff0d4', 2.25);
sun.position.set(-120, 180, 90);
scene.add(sun);
const fill = new THREE.DirectionalLight('#b8d5d9', 0.75);
fill.position.set(100, 70, -120);
scene.add(fill);

const chunkSize = 184;
const chunks = new Map();
const cars = new Map();
const remoteStates = new Map();
let myId = null;
let selectedVehicle = 'trail';
let lastChunkCenter = '';
let lastSnapshotTime = 0;
const held = new Set();
const input = { throttle: false, brake: false, left: false, right: false, handbrake: false };
const clock = new THREE.Clock();
const targetCamera = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
let initialized = false;

function makeCar(color, type) {
  const root = new THREE.Group();
  const length = type === 'rock' ? 3.75 : type === 'rally' ? 4.15 : 3.95;
  const width = type === 'rock' ? 1.95 : 1.8;
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.43, metalness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: '#27302d', roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#273b3a', roughness: 0.22, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, 0.68, length), paint);
  body.position.y = 0.79;
  root.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(width * 0.87, 0.23, length * 0.34), paint);
  hood.position.set(0, 1.17, length * 0.22);
  root.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.66, length * 0.39), glass);
  cabin.position.set(0, 1.42, -length * 0.08);
  root.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.75, 0.1, length * 0.35), paint);
  roof.position.set(0, 1.78, -length * 0.08);
  root.add(roof);
  const wheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.32, 12);
  const wheels = [];
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * (width * 0.53), 0.48, end * (length * 0.31));
    root.add(wheel);
    wheels.push(wheel);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(width * 1.07, 0.16, 0.18), dark);
  bumper.position.set(0, 0.54, length * 0.51);
  root.add(bumper);
  const lamps = new THREE.MeshStandardMaterial({ color: '#f5e4ad', emissive: '#dcb85d', emissiveIntensity: 1.1 });
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 0.08), lamps);
    lamp.position.set(side * width * 0.31, 0.91, length * 0.51);
    root.add(lamp);
  }
  root.userData.wheels = wheels;
  root.userData.length = length;
  return root;
}

function ensureCar(player) {
  let entry = cars.get(player.id);
  if (entry && entry.vehicle === player.vehicle && entry.color === player.color) return entry;
  if (entry) scene.remove(entry.mesh);
  const mesh = makeCar(player.color, player.vehicle);
  scene.add(mesh);
  entry = { mesh, vehicle: player.vehicle, color: player.color, current: { x: player.x, z: player.z, yaw: player.yaw, speed: player.speed }, target: player };
  cars.set(player.id, entry);
  return entry;
}

function terrainColor(x, z, elevation) {
  const d = roadDistance(x, z);
  const noise = hash2(Math.floor(x / 8), Math.floor(z / 8));
  if (d < 7.5) return new THREE.Color(noise > 0.57 ? '#806a4d' : '#746046');
  if (d < 11.5) return new THREE.Color('#81765c');
  if (elevation > 25) return new THREE.Color('#777765');
  return new THREE.Color(noise > 0.64 ? '#53684b' : noise < 0.24 ? '#59664b' : '#637552');
}

function buildChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunks.has(key)) return;
  const group = new THREE.Group();
  const segments = 28;
  const positions = [], colors = [], indices = [];
  const originX = cx * chunkSize, originZ = cz * chunkSize;
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const x = originX + ix / segments * chunkSize;
      const z = originZ + iz / segments * chunkSize;
      const y = heightAt(x, z);
      positions.push(x, y, z);
      const color = terrainColor(x, z, y);
      colors.push(color.r, color.g, color.b);
      if (ix < segments && iz < segments) {
        const a = iz * (segments + 1) + ix;
        indices.push(a, a + segments + 1, a + 1, a + 1, a + segments + 1, a + segments + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  ground.frustumCulled = true;
  group.add(ground);

  // Deterministic tree placement: all clients see matching landmarks without sending world data.
  const firstX = Math.floor(originX / 23) - 1;
  const lastX = Math.floor((originX + chunkSize) / 23) + 1;
  const firstZ = Math.floor(originZ / 23) - 1;
  const lastZ = Math.floor((originZ + chunkSize) / 23) + 1;
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.21, 1.15, 5);
  const crownGeo = new THREE.ConeGeometry(0.85, 2.1, 6);
  for (let tz = firstZ; tz <= lastZ; tz++) for (let tx = firstX; tx <= lastX; tx++) {
    const tree = treeAtCell(tx, tz);
    if (!tree || tree.x < originX || tree.x >= originX + chunkSize || tree.z < originZ || tree.z >= originZ + chunkSize) continue;
    const scale = tree.scale;
    const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#564331', roughness: 1 }));
    trunk.position.set(tree.x, heightAt(tree.x, tree.z) + 0.52 * scale, tree.z);
    trunk.scale.setScalar(scale);
    group.add(trunk);
    const crown = new THREE.Mesh(crownGeo, new THREE.MeshStandardMaterial({ color: tree.tone > 0.5 ? '#324b34' : '#3d5838', roughness: 1 }));
    crown.position.set(tree.x, heightAt(tree.x, tree.z) + 1.85 * scale, tree.z);
    crown.scale.setScalar(scale);
    group.add(crown);
  }
  scene.add(group);
  chunks.set(key, group);
}

function updateChunks(x, z) {
  const centerX = Math.floor(x / chunkSize), centerZ = Math.floor(z / chunkSize);
  const key = `${centerX},${centerZ}`;
  if (key === lastChunkCenter) return;
  lastChunkCenter = key;
  const wanted = new Set();
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const cx = centerX + dx, cz = centerZ + dz;
    const chunkKey = `${cx},${cz}`;
    wanted.add(chunkKey);
    buildChunk(cx, cz);
  }
  for (const [chunkKey, group] of chunks) {
    if (wanted.has(chunkKey)) continue;
    scene.remove(group);
    group.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
    chunks.delete(chunkKey);
  }
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.add('show');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.remove('show'), 2600);
}

function updateInput() {
  input.throttle = held.has('w') || held.has('arrowup');
  input.brake = held.has('s') || held.has('arrowdown');
  input.left = held.has('a') || held.has('arrowleft');
  input.right = held.has('d') || held.has('arrowright');
  input.handbrake = held.has(' ');
}
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  held.add(key);
  updateInput();
});
window.addEventListener('keyup', (event) => { held.delete(event.key.toLowerCase()); updateInput(); });
window.addEventListener('blur', () => { held.clear(); updateInput(); });

setInterval(() => { if (socket.connected) socket.emit('input', input); }, 50);
socket.on('connect', () => { connection.className = 'connection online'; connectionLabel.textContent = 'CONNECTED'; });
socket.on('disconnect', () => { connection.className = 'connection offline'; connectionLabel.textContent = 'RECONNECTING'; });
socket.on('serverFull', () => showNotice('This session is full. Try again shortly.'));
socket.on('welcome', (data) => {
  myId = data.id;
  initialized = true;
  showNotice('You are on the trail. The world is generated as you explore.');
});
socket.on('state', (state) => {
  lastSnapshotTime = performance.now();
  playerCount.textContent = `${state.players.length} ${state.players.length === 1 ? 'DRIVER' : 'DRIVERS'}`;
  const active = new Set();
  for (const player of state.players) {
    active.add(player.id);
    const entry = ensureCar(player);
    entry.target = player;
    if (player.id === myId) {
      entry.current.x += (player.x - entry.current.x) * 0.72;
      entry.current.z += (player.z - entry.current.z) * 0.72;
    }
  }
  for (const [id, entry] of cars) {
    if (active.has(id)) continue;
    scene.remove(entry.mesh);
    cars.delete(id);
  }
});

document.querySelectorAll('.vehicle-option').forEach((button) => {
  button.addEventListener('click', () => {
    selectedVehicle = button.dataset.vehicle;
    document.querySelectorAll('.vehicle-option').forEach((item) => item.classList.toggle('active', item === button));
    socket.emit('selectVehicle', selectedVehicle);
    showNotice(`${button.querySelector('span').textContent} selected`);
  });
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const me = cars.get(myId);
  if (me) {
    const p = me.target;
    me.current.yaw += Math.atan2(Math.sin(p.yaw - me.current.yaw), Math.cos(p.yaw - me.current.yaw)) * 0.32;
    if (me.current.x === undefined) { me.current.x = p.x; me.current.z = p.z; }
    me.current.x += (p.x - me.current.x) * 0.45;
    me.current.z += (p.z - me.current.z) * 0.45;
    me.current.speed = p.speed;
    me.mesh.position.set(me.current.x, heightAt(me.current.x, me.current.z), me.current.z);
    me.mesh.rotation.y = me.current.yaw;
    for (const wheel of me.mesh.userData.wheels) wheel.rotation.x -= p.speed * dt * 0.6;
    updateChunks(me.current.x, me.current.z);
    speedValue.textContent = String(Math.round(p.speed * 3.6)).padStart(3, '0');
    const offTrail = roadDistance(p.x, p.z) > 14;
    surfaceValue.textContent = offTrail ? 'OPEN GROUND' : 'DIRT TRAIL';
    coordinates.textContent = `${p.x.toFixed(0)} / ${p.z.toFixed(0)}`;
    const followDistance = 11;
    targetCamera.set(me.current.x - Math.sin(me.current.yaw) * followDistance, heightAt(me.current.x, me.current.z) + 8.3, me.current.z - Math.cos(me.current.yaw) * followDistance);
    camera.position.lerp(targetCamera, 1 - Math.exp(-4.2 * dt));
    cameraLook.set(me.current.x + Math.sin(me.current.yaw) * 5, heightAt(me.current.x, me.current.z) + 1.2, me.current.z + Math.cos(me.current.yaw) * 5);
    camera.lookAt(cameraLook);
  }
  const now = performance.now();
  for (const [id, entry] of cars) {
    if (id === myId) continue;
    const p = entry.target;
    entry.current.x += (p.x - entry.current.x) * 0.24;
    entry.current.z += (p.z - entry.current.z) * 0.24;
    entry.current.yaw += Math.atan2(Math.sin(p.yaw - entry.current.yaw), Math.cos(p.yaw - entry.current.yaw)) * 0.24;
    entry.mesh.position.set(entry.current.x, heightAt(entry.current.x, entry.current.z), entry.current.z);
    entry.mesh.rotation.y = entry.current.yaw;
    for (const wheel of entry.mesh.userData.wheels) wheel.rotation.x -= p.speed * dt * 0.6;
  }
  if (!lastSnapshotTime && initialized) connectionLabel.textContent = 'WAITING FOR WORLD';
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

camera.position.set(0, 12, -16);
animate();
