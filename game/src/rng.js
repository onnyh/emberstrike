// One seeded random source for the whole simulation, so a staged screenshot or a
// demo run with the same seed plays out the same way. mulberry32: tiny, fast, and
// good enough for spread, bot choices and burst lengths.
export function createRng(seed) {
  let a = seed >>> 0;
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    chance(p) { return next() < p; },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    sign() { return next() < 0.5 ? -1 : 1; },
  };
}
