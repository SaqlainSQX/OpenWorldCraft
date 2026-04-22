import Buffer from "./buffer.js";
import Shader from "./shader.js";

// Unit cube around the camera — each vertex position doubles as the
// world-space direction from camera to that point on the sky dome,
// so the fragment shader can compute colour purely from `normalize(vPos)`.
const verts = new Float32Array([
	-1,+1,-1, +1,+1,-1, -1,+1,+1,  -1,+1,+1, +1,+1,-1, +1,+1,+1, // back
	+1,-1,-1, -1,-1,-1, +1,-1,+1,  +1,-1,+1, -1,-1,-1, -1,-1,+1, // front
	-1,-1,-1, -1,+1,-1, -1,-1,+1,  -1,-1,+1, -1,+1,-1, -1,+1,+1, // left
	+1,+1,-1, +1,-1,-1, +1,+1,+1,  +1,+1,+1, +1,-1,-1, +1,-1,+1, // right
	-1,-1,-1, +1,-1,-1, -1,+1,-1,  -1,+1,-1, +1,-1,-1, +1,+1,-1, // bottom
	-1,+1,+1, +1,+1,+1, -1,-1,+1,  -1,-1,+1, +1,+1,+1, +1,-1,+1, // top
]);

const vert = `
	uniform mat4 proj;
	uniform mat4 view;
	uniform mat4 model;
	attribute vec3 pos;
	varying mediump vec3 vPos;

	void main()
	{
		gl_Position = proj * view * model * vec4(pos, 1);
		vPos = pos;
	}
`;

// Alien night sky:
//   1. Vertical gradient from dark-magenta horizon to near-black indigo zenith.
//   2. Soft teal atmospheric band just above horizon.
//   3. Cellular-hash star field, twinkling with time, fading near horizon.
//   4. Two moons at fixed world-direction vectors (cool teal + warm magenta),
//      each with a sharp disc and a soft halo.
const frag = `
	precision mediump float;
	varying vec3 vPos;
	uniform float time;

	float hash3(vec3 p) {
		p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
		p *= 17.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}

	void main() {
		vec3 dir = normalize(vPos);
		float t = clamp(dir.z, 0.0, 1.0);

		// Gradient: horizon -> zenith.
		vec3 zenith  = vec3(0.020, 0.015, 0.080);
		vec3 horizon = vec3(0.180, 0.050, 0.220);
		vec3 col = mix(horizon, zenith, pow(t, 0.5));

		// Teal atmospheric band (thin, just above horizon).
		float band = exp(-pow((t - 0.04) * 25.0, 2.0));
		col += vec3(0.08, 0.28, 0.32) * band * 0.7;

		// Sparse procedural star field above the horizon.
		vec3 cell = floor(dir * 500.0);
		float s = hash3(cell);
		float mask = step(0.996, s);
		float intensity = (s - 0.996) * 250.0 * mask;
		intensity *= smoothstep(0.01, 0.08, t);              // fade near horizon
		intensity *= 0.7 + 0.3 * sin(time * 2.5 + s * 100.0); // twinkle
		col += vec3(1.0, 0.95, 1.0) * intensity;

		// Moon 1 — larger, pale teal.
		vec3 m1Dir = normalize(vec3(-0.4, 0.7, 0.5));
		float d1 = dot(dir, m1Dir);
		float disc1 = smoothstep(0.988, 0.992, d1);
		col = mix(col, vec3(0.85, 0.96, 0.92), disc1);
		col += vec3(0.10, 0.20, 0.18) * pow(max(d1, 0.0), 60.0);

		// Moon 2 — smaller, magenta/pink.
		vec3 m2Dir = normalize(vec3(0.5, -0.3, 0.35));
		float d2 = dot(dir, m2Dir);
		float disc2 = smoothstep(0.9955, 0.9975, d2);
		col = mix(col, vec3(0.95, 0.55, 0.85), disc2);
		col += vec3(0.22, 0.08, 0.20) * pow(max(d2, 0.0), 90.0);

		gl_FragColor = vec4(col, 1.0);
	}
`;

export default class Sky
{
	constructor(display)
	{
		this.buffer = new Buffer(display, verts);
		this.shader = new Shader(display, vert, frag);
		this.display = display;
		this.startTime = performance.now();
	}

	draw(camera)
	{
		let shader = this.shader;
		let buffer = this.buffer;
		let gl = this.display.gl;
		let t = (performance.now() - this.startTime) / 1000;

		shader.assignFloatAttrib("pos", buffer, 3, 3, 0);
		shader.use();
		shader.assignMatrix("proj", camera.proj);
		shader.assignMatrix("view", camera.view);
		shader.assignMatrix("model", camera.model);
		shader.assignFloat("time", t);

		gl.disable(gl.DEPTH_TEST);

		this.display.drawTriangles(verts.length / 3);

		gl.enable(gl.DEPTH_TEST);
	}
}
