// The waypoint graph bots walk: nodes at lane junctions, doorways, cover spots and
// both spawns, joined by walkable straight lines. Pathfinding is a plain breadth
// first search — the graph is small enough that anything cleverer is waste.
export function createNav(nodes, links) {
  const adjacency = nodes.map(() => []);
  for (const [a, b] of links) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return { nodes, adjacency };
}

export function nearestNode(nav, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nav.nodes.length; i++) {
    const dx = nav.nodes[i].x - x;
    const dz = nav.nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Node indices from start to goal (inclusive), or just [goal] when unreachable.
export function findPath(nav, start, goal) {
  if (start === goal) return [start];
  const prev = new Int32Array(nav.nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    for (const next of nav.adjacency[cur]) {
      if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
    }
  }
  if (prev[goal] === -1) return [goal];
  const path = [];
  for (let cur = goal; cur !== start; cur = prev[cur]) path.push(cur);
  path.push(start);
  path.reverse();
  return path;
}
