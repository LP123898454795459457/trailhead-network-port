import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { heightAt, roadCenterX, roadDistance } from './public/world.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 1e5 });
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 16;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 20;

app.use(express.static(path.join(root, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size }));

const VEHICLES = {
  trail: { label: 'Trail Scout', color: '#e7a64b', maxSpeed: 38, acceleration: 20, steering: 1.75, grip: 7.2, mass: 1.0 },
  rally: { label: 'Ridge Rally', color: '#66c5a4', maxSpeed: 49, acceleration: 24, steering: 1.52, grip: 5.2, mass: 1.12 },
  rock: { label: 'Rock Crawler', color: '#d88778', maxSpeed: 27, acceleration: 15, steering: 1.95, grip: 9.0, mass: 1.35 }
};
const players = new Map();
let nextSpawn = 0;
let lastSnapshot = 0;

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const cleanInput = (input = {}) => ({
  throttle: input.throttle === true,
  brake: input.brake === true,
  left: input.left === true,
  right: input.right === true,
  handbrake: input.handbrake === true
});

function publicPlayer(player) {
  return {
    id: player.id, x: player.x, z: player.z, yaw: player.yaw,
    vx: player.vx, vz: player.vz, speed: player.speed,
    vehicle: player.vehicle, color: player.color,
    name: player.name, grounded: true
  };
}

io.on('connection', (socket) => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit('serverFull');
    socket.disconnect(true);
    return;
  }

  const spawn = nextSpawn++;
  const z = 8 + Math.floor(spawn / 4) * 7;
  const x = roadCenterX(z) + ((spawn % 4) - 1.5) * 4;
  const player = {
    id: socket.id,
    x, z, yaw: Math.PI,
    vx: 0, vz: 0, speed: 0,
    vehicle: 'trail', color: VEHICLES.trail.color,
    name: `Driver ${String(spawn + 1).padStart(2, '0')}`,
    input: cleanInput()
  };
  players.set(socket.id, player);

  socket.emit('welcome', {
    id: socket.id,
    seed: 'trailhead-original-world-v1',
    maxPlayers: MAX_PLAYERS,
    vehicles: Object.fromEntries(Object.entries(VEHICLES).map(([id, vehicle]) => [id, { label: vehicle.label, color: vehicle.color }]))
  });
  socket.on('input', (input) => { player.input = cleanInput(input); });
  socket.on('selectVehicle', (vehicle) => {
    if (!Object.hasOwn(VEHICLES, vehicle)) return;
    const selected = VEHICLES[vehicle];
    player.vehicle = vehicle;
    player.color = selected.color;
  });
  socket.on('disconnect', () => players.delete(socket.id));
});

function simulate(dt) {
  for (const player of players.values()) {
    const input = player.input;
    const vehicle = VEHICLES[player.vehicle];
    const forwardX = Math.sin(player.yaw);
    const forwardZ = Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    let forwardSpeed = player.vx * forwardX + player.vz * forwardZ;
    let lateralSpeed = player.vx * rightX + player.vz * rightZ;

    const onTrail = roadDistance(player.x, player.z) < 14;
    const surfaceGrip = onTrail ? 1 : 0.58;
    const surfaceDrag = onTrail ? 0.992 : 0.976;
    if (input.throttle) forwardSpeed += vehicle.acceleration * dt;
    if (input.brake) {
      if (forwardSpeed > 1) forwardSpeed -= 34 * dt;
      else forwardSpeed -= vehicle.acceleration * 0.72 * dt;
    }

    const maxForward = vehicle.maxSpeed * (onTrail ? 1 : 0.72);
    forwardSpeed = clamp(forwardSpeed, -vehicle.maxSpeed * 0.32, maxForward);
    const steering = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const speedFactor = clamp(Math.abs(forwardSpeed) / 8, 0, 1);
    const handbrakeFactor = input.handbrake ? 0.58 : 1;
    player.yaw += steering * vehicle.steering * speedFactor * handbrakeFactor * dt * Math.sign(forwardSpeed || 1);

    const grip = vehicle.grip * surfaceGrip * (input.handbrake ? 0.28 : 1);
    lateralSpeed *= Math.exp(-grip * dt);
    forwardSpeed *= Math.pow(surfaceDrag, dt * 60);
    player.vx = forwardX * forwardSpeed + rightX * lateralSpeed;
    player.vz = forwardZ * forwardSpeed + rightZ * lateralSpeed;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    // Keep sessions in a large, navigable region while avoiding unbounded coordinates.
    player.x = clamp(player.x, -12000, 12000);
    player.z = clamp(player.z, -12000, 12000);
    player.speed = Math.hypot(player.vx, player.vz);
  }
}

let previous = performance.now();
let accumulator = 0;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min((now - previous) / 1000, 0.1);
  previous = now;
  const step = 1 / TICK_RATE;
  while (accumulator >= step) {
    simulate(step);
    accumulator -= step;
  }
  if (now - lastSnapshot >= 1000 / SNAPSHOT_RATE) {
    io.volatile.emit('state', { players: [...players.values()].map(publicPlayer) });
    lastSnapshot = now;
  }
}, 1000 / TICK_RATE);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Trailhead-style driving prototype listening on port ${PORT}`);
});
