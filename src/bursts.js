import Buffer from "./buffer.js";
import Shader from "./shader.js";

// Short-lived burst particle system. Used for one-shot effects like block
// break dust — particles spawn on demand at a position, fly outward under
// gravity, and die on a fixed lifetime. Separate from the ambient swarm
// in particles.js so block breaks don't corrupt the always-on glow.

const MAX_BURSTS = 240;
const STRIDE = 7;       // x, y, z, r, g, b, size

const vertSrc = `
	uniform mat4 proj;
	uniform mat4 view;
	attribute vec3 pos;
	attribute vec3 color;
	attribute float size;
	varying mediump vec3 vColor;

	void main() {
		vec4 viewPos = view * vec4(pos, 1.0);
		gl_Position = proj * viewPos;
		gl_PointSize = max(2.0, size / -viewPos.z);
		vColor = color;
	}
`;

const fragSrc = `
	precision mediump float;
	varying mediump vec3 vColor;

	void main() {
		vec2 d = gl_PointCoord * 2.0 - 1.0;
		float r2 = dot(d, d);
		if(r2 > 1.0) discard;
		float a = 1.0 - r2;
		gl_FragColor = vec4(vColor * a, a);
	}
`;

export default class BurstSystem
{
	constructor(display)
	{
		this.display = display;
		this.gl = display.gl;
		this.N = MAX_BURSTS;

		this.posArr     = new Float32Array(this.N * 3);
		this.velArr     = new Float32Array(this.N * 3);
		this.colArr     = new Float32Array(this.N * 3);
		this.sizeArr    = new Float32Array(this.N);
		this.lifeArr    = new Float32Array(this.N);
		this.maxLifeArr = new Float32Array(this.N);
		this.gpuBuf     = new Float32Array(this.N * STRIDE);

		this.buffer = new Buffer(display, this.gpuBuf);
		this.shader = new Shader(display, vertSrc, fragSrc);
		this.cursor = 0;          // round-robin slot allocator
	}

	// Spawn `count` particles in a small burst at (x,y,z) tinted by color.
	// Particles fly outward in random directions with a slight upward bias.
	spawn(x, y, z, color, count = 16)
	{
		for(let n = 0; n < count; n++) {
			let i = this.cursor;
			this.cursor = (this.cursor + 1) % this.N;

			this.posArr[i*3 + 0] = x + (Math.random() - 0.5) * 0.25;
			this.posArr[i*3 + 1] = y + (Math.random() - 0.5) * 0.25;
			this.posArr[i*3 + 2] = z + (Math.random() - 0.5) * 0.25;

			let speed = 1.6 + Math.random() * 2.4;
			let theta = Math.random() * 2 * Math.PI;
			let phi   = (Math.random() - 0.4) * 1.2;
			let cphi = Math.cos(phi);
			this.velArr[i*3 + 0] = Math.cos(theta) * cphi * speed;
			this.velArr[i*3 + 1] = Math.sin(theta) * cphi * speed;
			this.velArr[i*3 + 2] = Math.sin(phi)        * speed + 1.6;

			// Slight per-particle hue jitter so a burst reads as cloudy dust
			// rather than uniform-coloured points.
			let j = 0.7 + Math.random() * 0.5;
			this.colArr[i*3 + 0] = color[0] * j;
			this.colArr[i*3 + 1] = color[1] * j;
			this.colArr[i*3 + 2] = color[2] * j;

			this.sizeArr[i] = 28 + Math.random() * 22;

			let life = 0.55 + Math.random() * 0.45;
			this.lifeArr[i] = life;
			this.maxLifeArr[i] = life;
		}
	}

	// Single near-stationary glowing particle. Used for arrow trails — call
	// once per arrow per frame and successive points form a streak.
	trail(x, y, z, color, size = 26, life = 0.35)
	{
		let i = this.cursor;
		this.cursor = (this.cursor + 1) % this.N;

		this.posArr[i*3 + 0] = x;
		this.posArr[i*3 + 1] = y;
		this.posArr[i*3 + 2] = z;
		this.velArr[i*3 + 0] = (Math.random() - 0.5) * 0.4;
		this.velArr[i*3 + 1] = (Math.random() - 0.5) * 0.4;
		this.velArr[i*3 + 2] = (Math.random() - 0.5) * 0.4;
		this.colArr[i*3 + 0] = color[0];
		this.colArr[i*3 + 1] = color[1];
		this.colArr[i*3 + 2] = color[2];
		this.sizeArr[i] = size;
		this.lifeArr[i] = life;
		this.maxLifeArr[i] = life;
	}

	update(dt)
	{
		const GRAVITY = -9;
		for(let i = 0; i < this.N; i++) {
			let b = i * STRIDE;
			if(this.lifeArr[i] <= 0) {
				// Dead slot — keep buffer zeroed so we don't render stale data.
				this.gpuBuf[b + 6] = 0;
				continue;
			}

			this.velArr[i*3 + 2] += GRAVITY * dt;
			this.posArr[i*3 + 0] += this.velArr[i*3 + 0] * dt;
			this.posArr[i*3 + 1] += this.velArr[i*3 + 1] * dt;
			this.posArr[i*3 + 2] += this.velArr[i*3 + 2] * dt;
			this.lifeArr[i] -= dt;

			// Fade-out envelope only — bursts are visible the moment they appear.
			let fade = Math.max(0, this.lifeArr[i] / this.maxLifeArr[i]);

			this.gpuBuf[b + 0] = this.posArr[i*3 + 0];
			this.gpuBuf[b + 1] = this.posArr[i*3 + 1];
			this.gpuBuf[b + 2] = this.posArr[i*3 + 2];
			this.gpuBuf[b + 3] = this.colArr[i*3 + 0] * fade;
			this.gpuBuf[b + 4] = this.colArr[i*3 + 1] * fade;
			this.gpuBuf[b + 5] = this.colArr[i*3 + 2] * fade;
			this.gpuBuf[b + 6] = this.sizeArr[i] * fade;
		}
		this.buffer.update(this.gpuBuf);
	}

	draw(camera)
	{
		let gl = this.gl;
		let shader = this.shader;

		shader.assignFloatAttrib("pos",   this.buffer, 3, STRIDE, 0);
		shader.assignFloatAttrib("color", this.buffer, 3, STRIDE, 3);
		shader.assignFloatAttrib("size",  this.buffer, 1, STRIDE, 6);
		shader.use();
		shader.assignMatrix("proj", camera.proj);
		shader.assignMatrix("view", camera.view);

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.depthMask(false);
		gl.drawArrays(gl.POINTS, 0, this.N);
		gl.depthMask(true);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}
}
