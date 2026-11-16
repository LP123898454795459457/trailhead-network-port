# Backcountry — Online Trail Drive

A small original multiplayer off-road driving game built for the browser and GitHub Codespaces. It takes inspiration from the broad appeal of open-road exploration and tactile vehicle handling, with original code, procedural terrain, visuals, and tuning—not TRAILHEAD's code or assets.

## Run in Codespaces

1. Open this repository in a Codespace.
2. Run `npm start` in the terminal (dependencies install automatically in a new Codespace).
3. Open forwarded port **3000**. Open the game in another browser or share the forwarded URL to test multiplayer.

You can also run it locally with Node.js 20 or newer:

```bash
npm install
npm start
```

## Driving

- **W / Up:** throttle
- **S / Down:** brake, then reverse
- **A / D or Left / Right:** steer
- **Space:** handbrake / loosen the rear end
- Use the top-right selector to change vehicle; it affects handling for everyone immediately.

## What is implemented

- Procedurally generated, deterministic rolling terrain and a winding dirt trail, streamed in chunks around the driver.
- Deterministically placed forest landmarks that match for all players.
- Three vehicles with different top speed, acceleration, steering, and grip profiles.
- Server-authoritative 30 Hz vehicle simulation with 20 Hz multiplayer snapshots and up to 16 drivers per session.
- Surface-dependent traction and speed, lateral grip, handbrake slide, reverse, chase camera, speed/surface HUD, and responsive controls.
- A small `/health` endpoint for checking that the game server is running.

Terrain and vehicle handling are deliberately lightweight and tuned for a smooth browser prototype, not a fully simulated suspension/rigid-body physics package. Three.js is loaded from jsDelivr, so the browser needs internet access to load the 3D renderer.
