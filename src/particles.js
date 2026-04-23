import Buffer from "./buffer.js";
import Shader from "./shader.js";

// Ambient-atmosphere particle system.
//
// A fixed-size pool of particles lives near the camera: each frame they drift
// along their velocity, fade in/out via life, and respawn either when their
// life runs out or when they wander too far from the camera. The whole buffer
// is uploaded to the GPU every frame — cheap for ~200 points.
//
// Rendered as gl.POINTS with additive blending so particles stack into glow
// clumps and read properly through the bloom pass.

const N_PARTICLES = 200;
const STRIDE = 7;           // x, y, z, r, g, b, size
const SPAWN_RADIUS = 22;
const MAX_DIST = 28;
const MAX_DIST_SQ = MAX_DIST * MAX_DIST;

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
		// Perspective-correct sizing with a floor so distant particles
		// don't vanish into a single pixel.
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
		float a = exp(-r2 * 4.0);
		gl_FragColor = vec4(vColor * a, a);
	}
`;

export default class ParticleSystem
{
	constructor(display)
	{
		this.display = display;
		this.gl = display.gl;
		this.N = N_PARTICLES;

		this.posArr     = new Float32Array(this.N * 3);
		this.velArr     = new Float32Array(this.N * 3);
		this.colArr     = new Float32Array(this.N * 3);
		this.sizeArr    = new Float32Array(this.N);
		this.lifeArr    = new Float32Array(this.N);
		this.maxLifeArr = new Float32Array(this.N);
		this.gpuBuf     = new Float32Array(this.N * STRIDE);

		// Everything dead at birth so the first update() respawns each into
		// a fresh position around the camera.
		for(let i = 0; i < this.N; i++) this.lifeArr[i] = 0;

		this.buffer = new Buffer(display, this.gpuBuf);
		this.shader = new Shader(display, vertSrc, fragSrc);
	}

	_respawn(i, camera)
	{
		let r = SPAWN_RADIUS;
		this.posArr[i*3 + 0] = camera.pos.x + (Math.random() - 0.5) * r;
		this.posArr[i*3 + 1] = camera.pos.y + (Math.random() - 0.5) * r;
		this.posArr[i*3 + 2] = camera.pos.z + (Math.random() - 0.3) * 6;

		this.velArr[i*3 + 0] = (Math.random() - 0.5) * 0.5;
		this.velArr[i*3 + 1] = (Math.random() - 0.5) * 0.5;
		this.velArr[i*3 + 2] = Math.random() * 0.3 + 0.05;    // slight upward drift

		// 25% are magenta fireflies — larger + brighter so they dominate bloom.
		if(Math.random() < 0.25) {
			this.colArr[i*3 + 0] = 1.10;
			this.colArr[i*3 + 1] = 0.45;
			this.colArr[i*3 + 2] = 0.85;
			this.sizeArr[i] = 75;
		}
		else {
			this.colArr[i*3 + 0] = 0.45;
			this.colArr[i*3 + 1] = 0.85;
			this.colArr[i*3 + 2] = 0.75;
			this.sizeArr[i] = 30;
		}

		this.lifeArr[i] = 3 + Math.random() * 5;
		this.maxLifeArr[i] = this.lifeArr[i];
	}

	update(dt, camera)
	{
		for(let i = 0; i < this.N; i++) {
			this.posArr[i*3 + 0] += this.velArr[i*3 + 0] * dt;
			this.posArr[i*3 + 1] += this.velArr[i*3 + 1] * dt;
			this.posArr[i*3 + 2] += this.velArr[i*3 + 2] * dt;
			this.lifeArr[i] -= dt;

			let dx = this.posArr[i*3 + 0] - camera.pos.x;
			let dy = this.posArr[i*3 + 1] - camera.pos.y;
			let dz = this.posArr[i*3 + 2] - camera.pos.z;
			let d2 = dx * dx + dy * dy + dz * dz;

			if(this.lifeArr[i] <= 0 || d2 > MAX_DIST_SQ) {
				this._respawn(i, camera);
			}

			// Life envelope: fade in over the first 0.5s, fade out over the
			// last 0.5s of life so particles pop in/out softly.
			let age = this.maxLifeArr[i] - this.lifeArr[i];
			let fade = Math.min(1, age / 0.5, this.lifeArr[i] / 0.5);

			let b = i * STRIDE;
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

		// Additive blend + depth-read (but no write) — gives glow that stacks
		// naturally and respects occlusion from solid terrain without letting
		// particles occlude each other in weird sort orders.
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.depthMask(false);

		gl.drawArrays(gl.POINTS, 0, this.N);

		gl.depthMask(true);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}
}
