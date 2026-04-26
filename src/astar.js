// A* pathfinder for a hostile mob on the voxel world.
//
// Works in the XY plane: for each (x, y) cell we compute the walkable
// z-level (highest block with solid-below + air-feet + air-head), and
// pathfind 4-connected across that surface. This keeps the search space
// small enough that a single pathfind completes in well under a frame
// even without a proper binary heap (just linear scan over the open set).
//
// Re-plan on a cadence — not every frame — so A* stays cheap.

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Highest z such that a ~3-block-tall mob can stand at (x, y). -1 if nowhere.
// Additionally refuses to stand on — or with head/body inside — any fluid,
// so mobs never wade into acid/water surfaces.
export function groundZ(map, x, y)
{
	// Walk down from a safe upper bound. Surface heights peak around ~44
	// after the deeper-terrain refactor, plus margin for trees.
	for(let z = 60; z > 0; z--) {
		if(!map.isSolid(x, y, z - 1)) continue;
		if(map.isFluid(x, y, z - 1)) continue;           // ground block itself isn't fluid
		if(map.isSolid(x, y, z) || map.isFluid(x, y, z)) continue;         // feet clear
		if(map.isSolid(x, y, z + 1) || map.isFluid(x, y, z + 1)) continue; // body clear
		if(map.isSolid(x, y, z + 2) || map.isFluid(x, y, z + 2)) continue; // head clear
		return z;
	}
	return -1;
}

// Find a path from (sx, sy) to (gx, gy) in voxel coordinates. Returns an
// array of {x, y, z} waypoints (inclusive of both ends) or null on failure.
// maxNodes caps the search budget so worst-case pathfinds don't stall
// the main thread.
export function findPath(map, sx, sy, gx, gy, maxNodes = 180)
{
	if(groundZ(map, gx, gy) < 0) return null;

	const key = (x, y) => x + "," + y;
	const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

	const open = [];
	const cameFrom = new Map();
	const gScore = new Map();
	const visited = new Set();

	const startKey = key(sx, sy);
	gScore.set(startKey, 0);
	open.push({x: sx, y: sy, f: h(sx, sy)});

	let nodes = 0;
	while(open.length > 0) {
		if(++nodes > maxNodes) return null;

		// Min-f pop — linear scan. For 180-node budgets this is fine.
		let minIdx = 0;
		for(let i = 1; i < open.length; i++) {
			if(open[i].f < open[minIdx].f) minIdx = i;
		}
		const cur = open.splice(minIdx, 1)[0];
		const curKey = key(cur.x, cur.y);

		if(cur.x === gx && cur.y === gy) {
			// Reconstruct.
			const path = [];
			let k = curKey;
			while(k !== undefined) {
				const [xs, ys] = k.split(",");
				const x = parseInt(xs, 10);
				const y = parseInt(ys, 10);
				path.unshift({x, y, z: groundZ(map, x, y)});
				k = cameFrom.get(k);
			}
			return path;
		}

		if(visited.has(curKey)) continue;
		visited.add(curKey);

		for(const [dx, dy] of DIRS) {
			const nx = cur.x + dx;
			const ny = cur.y + dy;
			if(groundZ(map, nx, ny) < 0) continue;

			const nKey = key(nx, ny);
			const tentative = (gScore.get(curKey) ?? 0) + 1;
			if(tentative < (gScore.get(nKey) ?? Infinity)) {
				cameFrom.set(nKey, curKey);
				gScore.set(nKey, tentative);
				open.push({x: nx, y: ny, f: tentative + h(nx, ny)});
			}
		}
	}
	return null;
}
