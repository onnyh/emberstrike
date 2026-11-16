// Collision and ray tests against the map's axis-aligned boxes. Bodies are feet
// positions with a radius and a height; movement resolves one axis at a time so a
// body slides along walls instead of sticking, and the vertical pass lets a body
// stand on crates and land on ledges. Rays use the slab test; characters are a
// head sphere over a body capsule, so a shot can be scored head or body exactly.

export function makeBox(x0, y0, z0, x1, y1, z1) {
  return { x0, y0, z0, x1, y1, z1 };
}

const GRAVITY = 22;

export function createBody(x, z, radius = 0.35, height = 1.8) {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    radius,
    height,
    standHeight: height,
    onGround: true,
  };
}

// Highest walkable top under the body's footprint (the floor is y = 0).
function supportAt(body, colliders) {
  const r = body.radius * 0.72;
  const { x, z } = body.pos;
  let top = 0;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      if (b.y1 > top && b.y1 <= body.pos.y + 0.55) top = b.y1;
    }
  }
  return top;
}

function hitsSide(body, colliders, axis) {
  const r = body.radius;
  const { x, y, z } = body.pos;
  const head = y + body.height - 0.08;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (b.y1 <= y + 0.02 || b.y0 >= head) continue; // standing on it, or it passes overhead
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      if (axis === 'x') body.pos.x = body.vel.x > 0 ? b.x0 - r - 0.001 : b.x1 + r + 0.001;
      else body.pos.z = body.vel.z > 0 ? b.z0 - r - 0.001 : b.z1 + r + 0.001;
      return true;
    }
  }
  return false;
}

export function moveBody(body, colliders, dt) {
  body.pos.x += body.vel.x * dt;
  if (hitsSide(body, colliders, 'x')) body.vel.x = 0;
  body.pos.z += body.vel.z * dt;
  if (hitsSide(body, colliders, 'z')) body.vel.z = 0;

  body.vel.y -= GRAVITY * dt;
  body.pos.y += body.vel.y * dt;
  const support = supportAt(body, colliders);
  if (body.vel.y <= 0 && body.pos.y <= support) {
    body.pos.y = support;
    body.vel.y = 0;
    body.onGround = true;
  } else if (body.vel.y > 0) {
    // Rising: stop at the underside of anything the head reaches.
    const headY = body.pos.y + body.height;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (body.pos.x > b.x0 - 0.2 && body.pos.x < b.x1 + 0.2 && body.pos.z > b.z0 - 0.2 && body.pos.z < b.z1 + 0.2) {
        if (headY > b.y0 && body.pos.y < b.y0) { body.pos.y = b.y0 - body.height; body.vel.y = 0; }
      }
    }
    body.onGround = body.pos.y <= support + 0.001;
  } else {
    body.onGround = false;
  }
}

// Slab test: distance along the ray to the box, or Infinity when it misses.
function rayBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let t0 = 0;
  let t1 = maxDist;
  if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) return Infinity; }
  else {
    let ta = (b.x0 - ox) / dx; let tb = (b.x1 - ox) / dx;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) return Infinity; }
  else {
    let ta = (b.y0 - oy) / dy; let tb = (b.y1 - oy) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) return Infinity; }
  else {
    let ta = (b.z0 - oz) / dz; let tb = (b.z1 - oz) / dz;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
  }
  return t0;
}

export function rayVsWorld(ox, oy, oz, dx, dy, dz, maxDist, colliders) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i], best);
    if (t < best) best = t;
  }
  return best;
}

// Ray against one character: head sphere above a body capsule. Returns
// { t, head } for the nearer part, or null. charPos is the feet position.
export function rayVsCharacter(ox, oy, oz, dx, dy, dz, charPos, height, maxDist) {
  const hx = charPos.x; const hy = charPos.y + height - 0.22; const hz = charPos.z;
  let best = null;
  // Head sphere, radius 0.23.
  {
    const cx = hx - ox; const cy = hy - oy; const cz = hz - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const r2 = 0.23 * 0.23;
    if (d2 < r2 && tca > 0) {
      const t = tca - Math.sqrt(r2 - d2);
      if (t > 0 && t < maxDist) best = { t, head: true };
    }
  }
  // Body capsule: axis from y+0.28 to y+height-0.42, radius 0.34. Solved as the
  // closest approach between the ray and the axis segment.
  {
    const ax = charPos.x; const ay = charPos.y + 0.28; const az = charPos.z;
    const bx = charPos.x; const by = charPos.y + height - 0.42; const bz = charPos.z;
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const aox = ax - ox; const aoy = ay - oy; const aoz = az - oz;
    const abDotD = abx * dx + aby * dy + abz * dz;
    const abDotAO = abx * aox + aby * aoy + abz * aoz;
    const dDotAO = dx * aox + dy * aoy + dz * aoz;
    const abLen2 = abx * abx + aby * aby + abz * abz;
    const denom = abLen2 - abDotD * abDotD;
    let s = 0; // along the capsule axis
    let t = 0; // along the ray
    if (denom > 1e-9) {
      s = (abDotD * dDotAO - abDotAO) / denom;
      s = Math.max(0, Math.min(1, s));
    }
    t = abDotD * s + dDotAO;
    if (t > 0 && t < maxDist) {
      const px = ox + dx * t - (ax + abx * s);
      const py = oy + dy * t - (ay + aby * s);
      const pz = oz + dz * t - (az + abz * s);
      const dist2 = px * px + py * py + pz * pz;
      if (dist2 < 0.34 * 0.34 && (!best || t < best.t)) best = { t, head: false };
    }
  }
  return best;
}
