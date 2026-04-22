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

	getHeight(x, y)
	{
		return Math.floor(16 * this.sample2d(x / 16, y / 16));
	}

	// Is a tree rooted at the grass column (rx, ry)?
	// Trees only spawn on grass (not glowmoss, not ash), above the acid line,
	// and at sparse noise thresholds.
	hasTreeAt(rx, ry)
	{
		let h = this.getHeight(rx, ry);
		if(h <= 8) return false;
		let moss = this.sample2d(rx / 6 + 101, ry / 6 + 73);
		if(moss > 0.72) return false;                 // that tile is glowmoss
		let seed = this.sample2d(rx * 3.7 + 17, ry * 2.9 + 31);
		return seed > 0.93;                           // very sparse — occasional landmark trees
	}

	// Deterministic trunk height 4-6 for a given tree root.
	treeHeightAt(rx, ry)
	{
		return 4 + Math.floor(this.sample2d(rx * 7.3, ry * 5.1) * 3);
	}

	// For an air position above ground, check whether it falls inside any
	// nearby tree's trunk or canopy. Returns the block id or 0.
	getTreeBlock(x, y, z)
	{
		// Search a 5x5 footprint around (x, y) — canopy radius ~2.
		for(let dy = -2; dy <= 2; dy++) {
			for(let dx = -2; dx <= 2; dx++) {
				let rx = x - dx;
				let ry = y - dy;
				if(!this.hasTreeAt(rx, ry)) continue;

				let ground = this.getHeight(rx, ry);
				let th = this.treeHeightAt(rx, ry);
				let topZ = ground + th;

				// Trunk: only at the root column
				if(dx === 0 && dy === 0 && z > ground && z <= topZ) {
					return 9;  // alien_wood
				}

				// Canopy: approximate sphere around (rx, ry, topZ)
				// Slightly oblate so it looks more natural.
				let ddx = dx, ddy = dy;
				let ddz = z - topZ;
				let distSq = ddx * ddx + ddy * ddy + ddz * ddz * 1.3;
				if(distSq <= 5.5 && z > ground) {
					return 10; // glow_leaves
				}
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

		if(z < height / 3 * 2) {
			// Deep layer: obsidian with rare crystal veins.
			let vein = this.sample2d(x / 3 + z * 0.37, y / 3 + z * 0.71);
			return vein > 0.78 ? 4 : 3;
		}
		else if(height <= 8 && z <= height) {
			return 5;
		}
		else if(z < height) {
			return 2;
		}
		else if(z === height) {
			let moss = this.sample2d(x / 6 + 101, y / 6 + 73);
			return moss > 0.72 ? 7 : 1;
		}
		else if(z < 8) {
			return 6;
		}
		else {
			// Above surface — air unless a tree claims this voxel.
			return this.getTreeBlock(x, y, z);
		}
	}
}
