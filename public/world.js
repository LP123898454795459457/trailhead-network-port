// Deterministic shared world functions: used by both the server physics and client renderer.
export function hash2(x, z) {
  let n = (Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(z), 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const smooth = (a, b, t) => {
  const v = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return v * v * (3 - 2 * v);
};

export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

export function roadCenterX(z) {
  return Math.sin(z * 0.0031) * 92 + Math.sin(z * 0.00083 + 1.2) * 175 + Math.sin(z * 0.009) * 13;
}

export function roadDistance(x, z) {
  return Math.abs(x - roadCenterX(z));
}

export function heightAt(x, z) {
  const broad = (noise2(x * 0.0022, z * 0.0022) - 0.5) * 45;
  const detail = (noise2(x * 0.012, z * 0.012) - 0.5) * 9;
  const ridges = Math.sin(x * 0.018 + z * 0.006) * 2.4 + Math.cos(z * 0.024 - x * 0.004) * 1.8;
  const base = broad + detail + ridges;
  const distance = roadDistance(x, z);
  // The winding trail is gently graded into the surrounding rolling terrain.
  const trail = 1 - smooth(8, 34, distance);
  const graded = (noise2(x * 0.006, z * 0.006) - 0.5) * 2.5;
  return base * (1 - trail) + graded * trail;
}

export function treeAtCell(cellX, cellZ) {
  const chance = hash2(cellX + 480, cellZ - 220);
  if (chance < 0.57) return null;
  const x = cellX * 23 + (hash2(cellX + 30, cellZ + 9) - 0.5) * 18;
  const z = cellZ * 23 + (hash2(cellX - 20, cellZ + 70) - 0.5) * 18;
  if (roadDistance(x, z) < 25) return null;
  return {
    x, z,
    scale: 0.72 + hash2(cellX + 8, cellZ + 11) * 0.8,
    tone: hash2(cellX - 5, cellZ - 16)
  };
}
