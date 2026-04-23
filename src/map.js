import Chunk from "./chunk.js";

// Block IDs that behave as fluids: no collision, but cause buoyancy & drag.
// Keep this in sync with src/blocks.js.
const FLUID_IDS = new Set([6]);  // acid

export default class Map
{
	constructor(display, server)
	{
		if(display) {
			this.mesher = new Worker("src/mesher.js");

			this.mesher.onerror = e => {
				console.error("[mesher] error:", e.message, "@", e.filename, "line", e.lineno);
			};

			this.mesher.onmessage = e => {
				let cx = e.data.cx;
				let cy = e.data.cy;
				let chunk = this.getChunk(cx, cy);

				if(chunk) {
					chunk.applyMesh(e.data.mesh, e.data.transmesh);
				}
			};
		}

		if(server) {
			server.onSetChunk = (cx, cy, data) => {
				let chunk = this.getChunk(cx, cy);
				chunk.setData(data);
			};

			server.onSetBlock = (x, y, z, block) => {
				this.setBlock(x, y, z, block, false)
			};
		}

		this.chunks = {};
		this.display = display;
		this.server = server;
		this.loadedChunks = 0;
	}

	getChunk(cx, cy)
	{
		if(this.chunks[cy] && this.chunks[cy][cx]) {
			return this.chunks[cy][cx];
		}
	}

	loadChunk(cx, cy, data = null)
	{
		let chunk = this.getChunk(cx, cy);

		if(!chunk) {
			if(!this.chunks[cy]) {
				this.chunks[cy] = {};
			}

			chunk = new Chunk(this.display, this, cx, cy);

			if(this.server && this.server.isopen) {
				this.server.getChunk(cx, cy);
			}
			else if(data) {
				chunk.setData(data);
			}
			else {
				chunk.generate();
			}

			this.chunks[cy][cx] = chunk;
			this.loadedChunks ++;
		}

		return chunk;
	}

	remeshChunk(chunk)
	{
		let chunks = chunk.getVicinity();
		let cx = chunk.cx;
		let cy = chunk.cy;

		this.mesher.postMessage({chunks, cx, cy});
	}

	getBlock(x, y, z)
	{
		let cx = Math.floor(x / 16);
		let cy = Math.floor(y / 16);
		let chunk = this.getChunk(cx, cy);

		return chunk ? chunk.getBlock(x - cx * 16, y - cy * 16, z) : 0;
	}

	isFluid(x, y, z)
	{
		return FLUID_IDS.has(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
	}

	isSolid(x, y, z)
	{
		let b = this.getBlock(x, y, z);
		return b > 0 && !FLUID_IDS.has(b);
	}

	setBlock(x, y, z, b, pushToServer = true)
	{
		let cx = Math.floor(x / 16);
		let cy = Math.floor(y / 16);
		let chunk = this.getChunk(cx, cy);

		if(chunk) {
			chunk.setBlock(x - cx * 16, y - cy * 16, z, b);
		}

		if(this.server && pushToServer) {
			this.server.setBlock(x, y, z, b);
		}

		return chunk;
	}

	forEachChunk(fn)
	{
		for(let y in this.chunks) {
			if(this.chunks[y]) {
				for(let x in this.chunks[y]) {
					let chunk = this.chunks[y][x];

					fn(chunk, x, y);
				}
			}
		}
	}

	update()
	{
		this.forEachChunk(chunk => chunk.update());
	}

	draw(camera, sun, shadowMap, lightManager)
	{
		// Distance-cull: only draw chunks within DRAW_RADIUS of the camera's
		// chunk position. Previously every loaded chunk was drawn every frame,
		// so the work grew unbounded as the player moved around.
		const DRAW_RADIUS = 2;
		const R2 = DRAW_RADIUS * DRAW_RADIUS;
		let ccx = Math.floor(camera.pos.x / 16);
		let ccy = Math.floor(camera.pos.y / 16);

		this.forEachChunk(chunk => {
			let dx = chunk.cx - ccx;
			let dy = chunk.cy - ccy;
			if(dx * dx + dy * dy > R2) return;
			chunk.draw(camera, sun, false, shadowMap, lightManager);
		});
		this.forEachChunk(chunk => {
			let dx = chunk.cx - ccx;
			let dy = chunk.cy - ccy;
			if(dx * dx + dy * dy > R2) return;
			chunk.draw(camera, sun, true, shadowMap, lightManager);
		});
	}

	// Renders opaque chunk geometry (no transparent blocks — leaves/acid
	// don't cast shadows) from the light's POV, using the ShadowMap's
	// depth-only shader. Uses the same cull radius as the colour pass.
	drawDepth(camera, shadowShader)
	{
		const DRAW_RADIUS = 2;
		const R2 = DRAW_RADIUS * DRAW_RADIUS;
		let ccx = Math.floor(camera.pos.x / 16);
		let ccy = Math.floor(camera.pos.y / 16);

		this.forEachChunk(chunk => {
			let dx = chunk.cx - ccx;
			let dy = chunk.cy - ccy;
			if(dx * dx + dy * dy > R2) return;
			chunk.drawDepth(shadowShader);
		});
	}

	raymarch(start, vec)
	{
		let len      = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
		let way      = 0;
		let axis     = 0;
		let voxpos   = [0,0,0];
		let step     = [0,0,0];
		let waydelta = [0,0,0];
		let waynext  = [0,0,0];

		for(let i=0; i<3; i++) {
			voxpos[i] = Math.floor(start[i]);

			if(vec[i] > 0) {
				waydelta[i] = +len / vec[i];
				waynext[i]  = waydelta[i] * (voxpos[i] + 1 - start[i]);
				step[i]     = +1;
			}
			else if(vec[i] < 0) {
				waydelta[i] = -len / vec[i];
				waynext[i]  = waydelta[i] * (start[i] - voxpos[i]);
				step[i]     = -1;
			}
			else {
				waynext[i] = Infinity;
			}
		}

		while(true) {
			if(waynext[0] < waynext[1] && waynext[0] < waynext[2]) {
				axis = 0;
			}
			else if(waynext[1] < waynext[2]) {
				axis = 1;
			}
			else {
				axis = 2;
			}

			way            = waynext[axis];
			waynext[axis] += waydelta[axis];
			voxpos[axis]  += step[axis];

			if(way >= len) {
				break;
			}

			if(this.getBlock(...voxpos) > 0) {
				return {axis, voxpos, step};
			}
		}
	}

	boxmarch(boxmin, boxmax, vec)
	{
		let len      = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
		let way      = 0;
		let axis     = 0;
		let slope    = 0;
		let voxmin   = [0,0,0];
		let voxmax   = [0,0,0];
		let leadvox  = [0,0,0];
		let trailvox = [0,0,0];
		let step     = [0,0,0];
		let waydelta = [0,0,0];
		let waynext  = [0,0,0];

		for(let i=0; i<3; i++) {
			voxmin[i] = Math.floor(boxmin[i]);
			voxmax[i] = Math.ceil(boxmax[i]) - 1;

			if(vec[i] > 0) {
				leadvox[i]  = voxmax[i];
				trailvox[i] = voxmin[i];
				waydelta[i] = +len / vec[i];
				waynext[i]  = waydelta[i] * (voxmax[i] + 1 - boxmax[i]);
				step[i]     = +1;
			}
			else if(vec[i] < 0) {
				leadvox[i]  = voxmin[i];
				trailvox[i] = voxmax[i];
				waydelta[i] = -len / vec[i];
				waynext[i]  = waydelta[i] * (boxmin[i] - voxmin[i]);
				step[i]     = -1;
			}
			else {
				leadvox[i]  = voxmax[i];
				trailvox[i] = voxmin[i];
				waynext[i]  = Infinity;
				step[i]     = +1;
			}
		}

		while(true) {
			if(waynext[0] < waynext[1] && waynext[0] < waynext[2]) {
				axis = 0;
			}
			else if(waynext[1] < waynext[2]) {
				axis = 1;
			}
			else {
				axis = 2;
			}

			way             = waynext[axis];
			waynext[axis]  += waydelta[axis];
			leadvox[axis]  += step[axis];
			trailvox[axis] += step[axis];

			if(way >= len) {
				break;
			}

			let xs = axis === 0 ? leadvox[0] : trailvox[0];
			let ys = axis === 1 ? leadvox[1] : trailvox[1];
			let zs = axis === 2 ? leadvox[2] : trailvox[2];
			let xe = leadvox[0] + step[0];
			let ye = leadvox[1] + step[1];
			let ze = leadvox[2] + step[2];

			for(let x = xs; x !== xe; x += step[0]) {
				for(let y = ys; y !== ye; y += step[1]) {
					for(let z = zs; z !== ze; z += step[2]) {
						if(this.isSolid(x, y, z)) {
							let offs = way / len * vec[axis];

							return {axis, offs, step: step[axis]};
						}
					}
				}
			}
		}
	}
}
