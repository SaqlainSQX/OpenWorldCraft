import Shader from "./shader.js";
import Buffer from "./buffer.js";

// Skinned-mesh model shader.
//
// Renders per-vertex bone-weighted positions + a 2D texture. Two optional
// effects are plumbed through the draw() call:
//   • uTint       — per-instance colour multiplier; defaults to white.
//   • uDissolve   — 0..1 dissolve amount for death animation. A per-world-
//                   position hash > uDissolve survives; fragments just above
//                   the threshold glow bright pink at the dissolve front.
//
// These are additions to the original guckstift/voxel-game-js model shader,
// backwards-compatible with the multiplayer-player Mob class (both params
// default to the "no effect" values).

let vert = `
	precision highp float;
	uniform mat4 proj;
	uniform mat4 view;
	uniform mat4 model;
	uniform vec3 sun;
	uniform mat4 bones[16];
	attribute vec3 pos;
	attribute vec3 norm;
	attribute vec2 uv;
	attribute float bone;
	varying mediump vec2 vUv;
	varying mediump float factor;
	varying highp vec3 vWorldPos;

	void main()
	{
		vec4 bonePos = vec4(pos, 1.0);
		vec4 normal  = vec4(norm, 0.0);

		for(int i = 0; i < 16; i++) {
			if(i + 1 == int(bone)) {
				bonePos = bones[i] * bonePos;
				normal  = bones[i] * normal;
			}
		}

		vec4 world = model * bonePos;
		vWorldPos = world.xyz;
		gl_Position = proj * view * world;
		vUv = uv;

		vec3 worldNorm = (model * normal).xyz;
		float diffuse = max(0.0, dot(sun, worldNorm));
		float ambient = 1.0;
		factor = mix(diffuse, ambient, 0.5);
	}
`;

let frag = `
	precision highp float;
	uniform sampler2D tex;
	uniform vec3 uTint;
	uniform float uDissolve;
	varying mediump vec2 vUv;
	varying mediump float factor;
	varying highp vec3 vWorldPos;

	// Cheap 3D hash for the dissolve mask.
	float hash3(vec3 p) {
		p = fract(p * 0.3183099 + vec3(0.11, 0.27, 0.41));
		p *= 19.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}

	void main()
	{
		float mask = hash3(floor(vWorldPos * 8.0));
		if(mask < uDissolve) discard;

		vec4 color = texture2D(tex, vUv);
		color.rgb *= uTint;
		color.rgb *= factor;

		// Emissive dissolve front — bright pink edge on surviving fragments
		// just above the cutoff. Only active while dissolving.
		float edge = (1.0 - smoothstep(uDissolve, uDissolve + 0.07, mask))
		           * step(0.01, uDissolve);
		color.rgb += vec3(1.0, 0.45, 0.9) * edge * 2.5;

		gl_FragColor = color;
	}
`;

export default class Model
{
	constructor(display, texture, roots)
	{
		this.gl = display.gl;
		this.display = display;
		this.shader = display.getCached("Model.shader", () => new Shader(display, vert, frag));
		this.texture = texture;
		this.buffer = new Buffer(display);
		this.mesh = [];
		this.invalid = false;
		this.boneCount = 0;
		this.roots = roots;
	}

	addQuad(v0, v1, v2, v3, n, uvStart, uvSize, bone)
	{
		let uv00 = [uvStart[0],             uvStart[1] + uvSize[1]];
		let uv01 = [uvStart[0],             uvStart[1]];
		let uv10 = [uvStart[0] + uvSize[0], uvStart[1] + uvSize[1]];
		let uv11 = [uvStart[0] + uvSize[0], uvStart[1]];

		this.mesh.push(...v0, ...n, ...uv00, bone);
		this.mesh.push(...v1, ...n, ...uv10, bone);
		this.mesh.push(...v2, ...n, ...uv01, bone);
		this.mesh.push(...v2, ...n, ...uv01, bone);
		this.mesh.push(...v1, ...n, ...uv10, bone);
		this.mesh.push(...v3, ...n, ...uv11, bone);

		this.invalid = true;
		this.boneCount = Math.max(this.boneCount, bone);
	}

	addCube(start, size, texpos, texbox, div, bone)
	{
		let end = [start[0] + size[0], start[1] + size[1], start[2] + size[2]];
		let v000 = start;
		let v001 = [start[0], start[1], end[2]];
		let v010 = [start[0], end[1],   start[2]];
		let v011 = [start[0], end[1],   end[2]];
		let v100 = [end[0],   start[1], start[2]];
		let v101 = [end[0],   start[1], end[2]];
		let v110 = [end[0],   end[1],   start[2]];
		let v111 = end;
		let u = texpos[0];
		let v = texpos[1];
		let sx = texbox[0];
		let sy = texbox[1];
		let sz = texbox[2];

		this.addQuad(v010, v000, v011, v001, [-1, 0, 0], [  (2*sx+sy+u)/div,      v/div], [sy/div, sz/div], bone);
		this.addQuad(v000, v100, v001, v101, [ 0,-1, 0], [            u/div,      v/div], [sx/div, sz/div], bone);
		this.addQuad(v010, v110, v000, v100, [ 0, 0,-1], [(2*sx+2*sy+u)/div, (sy+v)/div], [sx/div, sy/div], bone);
		this.addQuad(v100, v110, v101, v111, [+1, 0, 0], [       (sx+u)/div,      v/div], [sy/div, sz/div], bone);
		this.addQuad(v110, v010, v111, v011, [ 0,+1, 0], [    (sx+sy+u)/div,      v/div], [sx/div, sz/div], bone);
		this.addQuad(v001, v101, v011, v111, [ 0, 0,+1], [(2*sx+2*sy+u)/div,      v/div], [sx/div, sy/div], bone);
	}

	update()
	{
		if(this.invalid) {
			this.buffer.update(new Float32Array(this.mesh));
			this.invalid = false;
		}
	}

	draw(camera, sun, modelMat, bones, opts = {})
	{
		let shader = this.shader;
		let buffer = this.buffer;

		shader.assignFloatAttrib("pos",  buffer, 3, 9, 0);
		shader.assignFloatAttrib("norm", buffer, 3, 9, 3);
		shader.assignFloatAttrib("uv",   buffer, 2, 9, 6);
		shader.assignFloatAttrib("bone", buffer, 1, 9, 8);
		shader.use();
		shader.assignMatrix("proj", camera.proj);
		shader.assignMatrix("view", camera.view);
		shader.assignMatrix("model", modelMat);
		shader.assignMatrices("bones", bones);
		shader.assignVector("sun", sun);
		shader.assignTexture("tex", this.texture, 0);

		// Tint defaults to white; dissolve defaults to 0 so existing callers
		// (the multiplayer player Mob) get the original look unchanged.
		let tint = opts.tint || [1, 1, 1];
		shader.assignVector("uTint", {data: tint});
		shader.assignFloat("uDissolve", opts.dissolve || 0);

		this.display.drawTriangles(this.mesh.length / 9);
	}
}
