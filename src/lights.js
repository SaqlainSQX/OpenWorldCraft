// Dynamic point-light selection for emissive blocks.
//
// Each frame:
//   1. Walk every chunk in draw radius and collect its cached `emissives` list.
//   2. Compute distance^2 to the camera for each, discard anything past the
//      light range.
//   3. Sort ascending, keep the first MAX_LIGHTS.
//   4. Pack positions + colours into flat Float32Arrays ready for
//      Shader.assignVector3Array().
//
// Chunks compute their `emissives` list lazily (see chunk.js) — this file
// just consumes it.

export const MAX_LIGHTS = 8;

// Per-block-id light colour. Tuned to read as "glowing" once bloom lands.
// (See blocks.js for ids: 4 crystal, 6 acid, 7 glowmoss, 8 fungus, 10 glow_leaves.)
const LIGHT_COLOUR = {
	4:  [0.35, 0.85, 1.00],
	6:  [0.45, 0.95, 0.35],
	7:  [0.35, 0.90, 0.70],
	8:  [0.90, 0.40, 0.80],
	10: [0.55, 0.95, 0.80],
};

const LIGHT_RANGE = 20;          // world units; farther lights are dropped
const LIGHT_RANGE_SQ = LIGHT_RANGE * LIGHT_RANGE;

export default class LightManager
{
	constructor()
	{
		this.posArr = new Float32Array(MAX_LIGHTS * 3);
		this.colArr = new Float32Array(MAX_LIGHTS * 3);
		this._candidates = [];
	}

	update(camera, map, chunkRadius)
	{
		let ccx = Math.floor(camera.pos.x / 16);
		let ccy = Math.floor(camera.pos.y / 16);
		let cR2 = chunkRadius * chunkRadius;
		let cx = camera.pos.x, cy = camera.pos.y, cz = camera.pos.z;

		let cand = this._candidates;
		cand.length = 0;

		map.forEachChunk(chunk => {
			let dx = chunk.cx - ccx;
			let dy = chunk.cy - ccy;
			if(dx * dx + dy * dy > cR2) return;

			let list = chunk.emissives;
			for(let i = 0; i < list.length; i++) {
				let e = list[i];
				let ex = e.wx - cx, ey = e.wy - cy, ez = e.wz - cz;
				let d2 = ex * ex + ey * ey + ez * ez;
				if(d2 > LIGHT_RANGE_SQ) continue;
				cand.push(e, d2);   // flat pairs to avoid allocating wrappers
			}
		});

		// Partial selection sort: we only need MAX_LIGHTS smallest,
		// and `cand` has [e0, d0, e1, d1, ...]. Cheap for small N.
		let n = cand.length >> 1;
		let k = Math.min(MAX_LIGHTS, n);
		for(let i = 0; i < k; i++) {
			let minIdx = i;
			let minD2 = cand[i * 2 + 1];
			for(let j = i + 1; j < n; j++) {
				let d2 = cand[j * 2 + 1];
				if(d2 < minD2) {
					minD2 = d2;
					minIdx = j;
				}
			}
			if(minIdx !== i) {
				let tmpE = cand[i * 2];     cand[i * 2]     = cand[minIdx * 2];     cand[minIdx * 2]     = tmpE;
				let tmpD = cand[i * 2 + 1]; cand[i * 2 + 1] = cand[minIdx * 2 + 1]; cand[minIdx * 2 + 1] = tmpD;
			}
		}

		for(let i = 0; i < MAX_LIGHTS; i++) {
			let base = i * 3;
			if(i < k) {
				let e = cand[i * 2];
				this.posArr[base + 0] = e.wx;
				this.posArr[base + 1] = e.wy;
				this.posArr[base + 2] = e.wz;
				let col = LIGHT_COLOUR[e.block] || [1, 1, 1];
				this.colArr[base + 0] = col[0];
				this.colArr[base + 1] = col[1];
				this.colArr[base + 2] = col[2];
			}
			else {
				this.posArr[base + 0] = 0;
				this.posArr[base + 1] = 0;
				this.posArr[base + 2] = 0;
				this.colArr[base + 0] = 0;
				this.colArr[base + 1] = 0;
				this.colArr[base + 2] = 0;
			}
		}
	}
}
