// Terrain layout constants. Surface columns are roughly 28–44 blocks tall
// (BASE_GROUND..BASE_GROUND+HEIGHT_RANGE), so there's a thick block of
// material underneath every surface tile for caves to carve into. Acid
// fills any low spot whose surface sits below ACID_LINE.
export const BASE_GROUND   = 28;
export const HEIGHT_RANGE  = 16;
export const ACID_LINE     = 32;

export default class Generator
{
	rand2d(x, y)
	{
		x *= 15485863;   // mult with 1000000. prime
		y *= 285058399;  // mult with 15485863. prime
		x += y;          // add x and y together
		x *= 3141592653; // scramble with 10 first digits of PI
		x ^= x >>> 2;    // xor with r-shift with 1. prime
		x ^= x << 5;     // xor with l-shift with 3. prime
		x ^= x >>> 11;   // xor with r-shift with 5. prime
		x ^= x << 17;    // xor with l-shift with 7. prime
		x ^= x >>> 23;   // xor with r-shift with 9. prime
		x ^= x << 31;    // xor with l-shift with 11. prime

		return (x >>> 0) / 0xFFffFFff;
	}

	// 3D variant of rand2d for cave noise — same xorshift mixer but with z
	// folded into the seed so the result is independent across layers.
	rand3d(x, y, z)
	{
		x *= 15485863;
		y *= 285058399;
		z *= 472882027;
		x += y + z;
		x *= 3141592653;
		x ^= x >>> 2;
		x ^= x << 5;
		x ^= x >>> 11;
		x ^= x << 17;
		x ^= x >>> 23;
		x ^= x << 31;
		return (x >>> 0) / 0xFFffFFff;
	}

	smooth(x, a, b)
	{
		return a + (3 * x ** 2 - 2 * x ** 3) * (b - a);
	}

	sample2d(x, y)
	{
		let ax = Math.floor(x);
		let ay = Math.floor(y);
		let bx = Math.ceil(x);
		let by = Math.ceil(y);
		let aa = this.rand2d(ax, ay);
		let ab = this.rand2d(ax, by);
		let ba = this.rand2d(bx, ay);
		let bb = this.rand2d(bx, by);
		let fx = x - ax;
		let fy = y - ay;

		return this.smooth(fy,
			this.smooth(fx, aa, ba),
			this.smooth(fx, ab, bb),
		);
	}

	// Trilinear smooth interpolation of rand3d at the eight surrounding
	// integer corners. Used by the cave carver.
	sample3d(x, y, z)
	{
		let ax = Math.floor(x), bx = ax + 1;
		let ay = Math.floor(y), by = ay + 1;
		let az = Math.floor(z), bz = az + 1;
		let aaa = this.rand3d(ax, ay, az);
		let aab = this.rand3d(ax, ay, bz);
		let aba = this.rand3d(ax, by, az);
		let abb = this.rand3d(ax, by, bz);
		let baa = this.rand3d(bx, ay, az);
		let bab = this.rand3d(bx, ay, bz);
		let bba = this.rand3d(bx, by, az);
		let bbb = this.rand3d(bx, by, bz);
		let fx = x - ax, fy = y - ay, fz = z - az;

		return this.smooth(fz,
			this.smooth(fy,
				this.smooth(fx, aaa, baa),
				this.smooth(fx, aba, bba),
			),
			this.smooth(fy,
				this.smooth(fx, aab, bab),
				this.smooth(fx, abb, bbb),
			),
		);
	}

	getHeight(x, y)
	{
		return BASE_GROUND + Math.floor(HEIGHT_RANGE * this.sample2d(x / 16, y / 16));
	}

	// True if (x,y,z) is inside a cave (carved out air). Caves only exist
	// underground — at least 3 blocks below the local surface so the top
	// terrain stays continuous and acid pools don't drain — and not in the
	// bottom few blocks so there's always a bedrock floor.
	//
	// Two stacked thresholds combine wide caverns at large scale with thin
	// tunnels at fine scale. The OR keeps the caves connected.
	isCave(x, y, z, height)
	{
		if(z < 4) return false;
		if(z >= height - 2) return false;

		let cavern = this.sample3d(x / 16, y / 16, z / 8);
		if(cavern > 0.74) return true;

		let tunnel = this.sample3d(x / 9 + 51, y / 9 + 23, z / 5 + 7);
		return tunnel > 0.78;
	}

	// Is a tree rooted at the grass column (rx, ry)?
	// Trees only spawn on grass (not glowmoss, not ash), above the acid line,
	// and at sparse noise thresholds.
	hasTreeAt(rx, ry)
	{
		let h = this.getHeight(rx, ry);
		if(h <= ACID_LINE) return false;              // no trees in/under acid
		let moss = this.sample2d(rx / 6 + 101, ry / 6 + 73);
		if(moss > 0.72) return false;                 // that tile is glowmoss
		let seed = this.sample2d(rx * 3.7 + 17, ry * 2.9 + 31);
		return seed > 0.955;                          // ~30% sparser than before
	}

	// Deterministic trunk height 4-6 for a given tree root.
	treeHeightAt(rx, ry)
	{
		return 4 + Math.floor(this.sample2d(rx * 7.3, ry * 5.1) * 3);
	}

	// Build (once per chunk) the list of tree roots that could place blocks
	// into the 16x16 column spanning chunk (cx, cy). Padded by 2 on each side
	// so canopies that overhang neighbouring chunks are accounted for.
	getChunkTrees(cx, cy)
	{
		if(this._treesCx === cx && this._treesCy === cy) {
			return this._trees;
		}
		let trees = [];
		for(let dy = -2; dy < 18; dy++) {
			for(let dx = -2; dx < 18; dx++) {
				let rx = cx * 16 + dx;
				let ry = cy * 16 + dy;
				if(this.hasTreeAt(rx, ry)) {
					let ground = this.getHeight(rx, ry);
					trees.push({
						x: rx, y: ry, ground,
						topZ: ground + this.treeHeightAt(rx, ry),
					});
				}
			}
		}
		this._trees = trees;
		this._treesCx = cx;
		this._treesCy = cy;
		return trees;
	}

	// Per-block tree check, now O(trees-in-chunk) instead of O(5x5 * noise).
	getTreeBlock(x, y, z)
	{
		let cx = Math.floor(x / 16);
		let cy = Math.floor(y / 16);
		let trees = this.getChunkTrees(cx, cy);
		for(let i = 0; i < trees.length; i++) {
			let t = trees[i];
			let dx = x - t.x, dy = y - t.y;
			if(dx < -2 || dx > 2 || dy < -2 || dy > 2) continue;

			// Trunk column
			if(dx === 0 && dy === 0 && z > t.ground && z <= t.topZ) {
				return 9;  // alien_wood
			}

			// Canopy — slightly oblate sphere around the treetop.
			let ddz = z - t.topZ;
			if(dx * dx + dy * dy + ddz * ddz * 1.3 <= 5.5 && z > t.ground) {
				return 10; // glow_leaves
			}
		}
		return 0;
	}

	getBlock(x, y, z)
	{
		// Block IDs (match src/blocks.js):
		//   1 alien_grass   2 alien_soil   3 obsidian   4 crystal
		//   5 ash           6 acid         7 glowmoss   8 fungus
		//   9 alien_wood   10 glow_leaves
		let height = this.getHeight(x, y);

		// Above surface: trees, acid, or open air.
		if(z > height) {
			if(z < ACID_LINE) return 6;          // acid fills lows
			return this.getTreeBlock(x, y, z);
		}

		// Top surface block — ash for sub-acid columns, otherwise
		// glowmoss/grass picked by a moss noise field.
		if(z === height) {
			if(height <= ACID_LINE) return 5;    // sea-bed ash
			let moss = this.sample2d(x / 6 + 101, y / 6 + 73);
			return moss > 0.72 ? 7 : 1;
		}

		// Underground — first check whether the cave carver hollows it.
		if(this.isCave(x, y, z, height)) return 0;

		// Top 3 blocks below the surface are soil so caves break into a
		// recognisable transition rather than straight obsidian.
		if(z >= height - 3) return 2;

		// Deep layer: obsidian with rare crystal veins. Veins are slightly
		// denser around caves — gives flashlight something to catch on.
		let vein = this.sample2d(x / 3 + z * 0.37, y / 3 + z * 0.71);
		return vein > 0.78 ? 4 : 3;
	}
}
