import Shader from "./shader.js";
import Texture from "./texture.js";
import Buffer from "./buffer.js";
import Matrix from "./matrix.js";
import Generator from "./generator.js";
import blocks from "./blocks.js";
import {MAX_LIGHTS} from "./lights.js";

let vert = `
	uniform mat4 proj;
	uniform mat4 view;
	uniform mat4 model;
	uniform mat4 lightVP;
	uniform vec3 sun;
	attribute vec3 pos;
	attribute vec3 norm;
	attribute vec2 uv;
	attribute float face;
	attribute float ao;
	varying mediump vec2 vUv;
	varying mediump vec2 texOffs;
	varying mediump float vDiffuse;
	varying mediump float vAmbient;
	varying mediump float vEmissive;
	varying mediump float vIsWater;
	varying mediump vec3 vNormal;
	varying highp vec3 vWorldPos;
	varying highp vec4 vLightPos;

	void main()
	{
		vec4 world = model * vec4(pos, 1.0);
		gl_Position = proj * view * world;
		vLightPos = lightVP * world;
		vWorldPos = world.xyz;
		vNormal = norm;
		vUv = uv;

		float texX = mod(face, 16.0);
		float texY = floor(face / 16.0);
		texOffs = vec2(texX, texY) / 16.0;

		vDiffuse = max(0.0, dot(sun, norm));

		// The mesher packs +4 into ao for emissive-block faces so we can
		// self-illuminate them without widening the vertex stride.
		float isEm = step(3.5, ao);
		float actualAo = ao - isEm * 4.0;
		vAmbient = (4.0 - actualAo) * 0.25;
		vEmissive = isEm;

		// Flag acid top faces for the water-shading branch in the fragment
		// shader. Face id 16 is acid; norm.z > 0.5 isolates top faces.
		vIsWater = step(15.5, face) * (1.0 - step(16.5, face)) * step(0.5, norm.z);
	}
`;

let frag = `
	// highp matches the vertex shader's default. Using mediump here caused
	// precision mismatches for shared uniforms (sun, lightVP, proj/view/model)
	// and the program silently failed to link.
	precision highp float;
	uniform sampler2D tex;
	uniform sampler2D shadowMap;
	uniform float shadowEnabled;
	uniform vec3 lightPos[${MAX_LIGHTS}];
	uniform vec3 lightColor[${MAX_LIGHTS}];
	uniform vec3 uCameraPos;
	uniform mat4 lightVP;
	uniform vec3 sun;
	uniform float uTime;

	varying mediump vec2 vUv;
	varying mediump vec2 texOffs;
	varying mediump float vDiffuse;
	varying mediump float vAmbient;
	varying mediump float vEmissive;
	varying mediump float vIsWater;
	varying mediump vec3 vNormal;
	varying highp vec3 vWorldPos;
	varying highp vec4 vLightPos;

	// Match the sky shader's horizon colour so fog blends into the skybox
	// seamlessly. God-ray colour is a brighter tint of the fog so scatter
	// events read as the fog catching sunlight.
	const vec3 FOG_COLOR     = vec3(0.18, 0.05, 0.22);
	const vec3 GOD_RAY_COLOR = vec3(0.75, 0.45, 0.60);
	const float FOG_DENSITY  = 0.010;

	float sampleShadow()
	{
		if(shadowEnabled < 0.5) return 1.0;
		vec3 sc = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
		if(sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) {
			return 1.0;
		}
		float stored = texture2D(shadowMap, sc.xy).r;
		return sc.z - 0.004 > stored ? 0.12 : 1.0;
	}

	vec3 computePointLights()
	{
		vec3 total = vec3(0.0);
		for(int i = 0; i < ${MAX_LIGHTS}; i++) {
			vec3 col = lightColor[i];
			float brightness = col.r + col.g + col.b;
			if(brightness > 0.001) {
				vec3 L = lightPos[i] - vWorldPos;
				float d = length(L);
				float att = 1.0 / (1.0 + 0.18 * d + 0.035 * d * d);
				float ndotl = max(0.0, dot(L / max(d, 0.001), vNormal));
				total += col * att * ndotl;
			}
		}
		return total;
	}

	// Raymarch from camera to fragment through the shadow volume. Steps lit in
	// light space contribute to the accumulation; shadowed steps don't. The
	// resulting [0,1] factor is attenuated by sun-direction alignment so the
	// effect only shows up when the player looks roughly toward the sun.
	float computeGodRayFactor(vec3 sunDir)
	{
		if(shadowEnabled < 0.5) return 0.0;
		vec3 viewDir = normalize(vWorldPos - uCameraPos);
		float sunAlign = max(0.0, dot(viewDir, sunDir));
		if(sunAlign < 0.05) return 0.0;

		vec3 ray = vWorldPos - uCameraPos;
		vec3 stepv = ray / 6.0;
		vec3 p = uCameraPos + stepv * 0.5;
		float lit = 0.0;
		for(int i = 0; i < 6; i++) {
			vec4 lp = lightVP * vec4(p, 1.0);
			vec3 sc = lp.xyz / lp.w * 0.5 + 0.5;
			if(sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0) {
				float stored = texture2D(shadowMap, sc.xy).r;
				if(sc.z <= stored + 0.005) lit += 1.0;
			}
			p += stepv;
		}
		return (lit / 6.0) * pow(sunAlign, 3.0);
	}

	// Per-fragment water normal from two summed sine waves whose gradient
	// tilts the normal. Fragment-only (no vertex displacement) so greedy-
	// meshed acid surfaces still show rippling lighting.
	vec3 waterNormal(vec2 xy, float t)
	{
		vec2 d1 = vec2( 1.0, 0.3);  float f1 = 0.70; float amp1 = 0.12;
		vec2 d2 = vec2(-0.4, 0.8);  float f2 = 1.10; float amp2 = 0.07;
		float a1 = dot(d1, xy) * f1 + t * 2.0;
		float a2 = dot(d2, xy) * f2 + t * 1.5;
		vec2 slope = cos(a1) * d1 * f1 * amp1 + cos(a2) * d2 * f2 * amp2;
		return normalize(vec3(-slope.x, -slope.y, 1.0));
	}

	void main()
	{
		vec2 texCoord = texOffs + fract(vUv) / 16.0;
		vec4 color = texture2D(tex, texCoord);
		float alpha = color.a;

		vec3 shadingNormal = vNormal;
		bool isWater = vIsWater > 0.5;

		// Water branch: recompute colour using Fresnel reflection, sun
		// specular, and a wavy surface normal.
		if(isWater) {
			shadingNormal = waterNormal(vWorldPos.xy, uTime);
			vec3 viewDir = normalize(uCameraPos - vWorldPos);
			float fresnel = pow(1.0 - clamp(dot(shadingNormal, viewDir), 0.0, 1.0), 2.5);

			vec3 deep    = vec3(0.05, 0.35, 0.10);
			vec3 reflCol = vec3(0.35, 0.12, 0.38);
			vec3 wc = mix(deep, reflCol, fresnel);

			// Blinn-Phong style specular toward the sun.
			vec3 halfV = normalize(viewDir + sun);
			float spec = pow(max(0.0, dot(shadingNormal, halfV)), 120.0);
			wc += vec3(1.0, 0.9, 0.75) * spec * 2.0;

			color.rgb = wc;
			alpha = 0.78;
		}

		// Sun diffuse — recomputed with shading normal so water catches
		// light in a direction-dependent way.
		float diffuse = isWater ? max(0.0, dot(sun, shadingNormal)) : vDiffuse;

		float shadow = sampleShadow();
		float lightFactor = 0.7 * diffuse * shadow + 0.3 * vAmbient;

		vec3 lit = color.rgb * lightFactor;
		lit += color.rgb * computePointLights();
		lit += color.rgb * vEmissive * 1.4;

		// Atmospheric fog — blend toward the sky horizon colour.
		float fragDist = length(vWorldPos - uCameraPos);
		float fogFactor = 1.0 - exp(-FOG_DENSITY * fragDist);
		lit = mix(lit, FOG_COLOR, fogFactor);

		// God-ray scattering.
		float godRay = computeGodRayFactor(sun) * fogFactor;
		lit += GOD_RAY_COLOR * godRay * 0.25;

		gl_FragColor = vec4(lit, alpha);
	}
`;

// Identity matrix used when the shadow pass is disabled.
const IDENTITY = new Matrix();

// Game-wide clock used for shader animations (water waves, etc.). Kept
// relative to module load so sin/cos phases stay in a well-conditioned range.
const CHUNK_START_TIME = performance.now();

let zeroChunk = new Uint8Array(16 * 16 * 256);

export default class Chunk
{
	constructor(display, map, cx, cy)
	{
		if(display) {
			this.shader = display.getCached("Chunk.shader", () => new Shader(display, vert, frag));
			this.texture = display.getCached("Chunk.texture", () => new Texture(display, "gfx/blocks.png"));
			this.buffer = new Buffer(display);
			this.transbuf = new Buffer(display);
			this.gl = display.gl;
		}
		
		this.data = new Uint8Array(16 * 16 * 256);
		this.generator = new Generator();
		this.count = 0;
		this.transcount = 0;
		this.display = display;
		this.map = map;
		this.cx = cx;
		this.cy = cy;
		this.invalid = false;
		this.meshingStartTime = 0;
		this.model = new Matrix();
		this.model.translate(cx * 16, cy * 16, 0);

		// Lazily-computed list of {wx, wy, wz, block} for emissive voxels
		// that are exposed to air. See get emissives() below.
		this._emissives = null;
	}

	// Emissive voxels in this chunk, in world coordinates. Recomputed on first
	// access after a data change. Only blocks with at least one air neighbour
	// count as lights — fully buried crystals don't illuminate anything.
	get emissives()
	{
		if(this._emissives !== null) return this._emissives;
		let list = [];
		let d = this.data;
		for(let z = 0; z < 256; z++) {
			for(let y = 0; y < 16; y++) {
				for(let x = 0; x < 16; x++) {
					let b = d[x + y * 16 + z * 256];
					if(b === 0 || !blocks[b] || !blocks[b].emissive) continue;
					let exposed =
						this.getBlock(x - 1, y, z) === 0 ||
						this.getBlock(x + 1, y, z) === 0 ||
						this.getBlock(x, y - 1, z) === 0 ||
						this.getBlock(x, y + 1, z) === 0 ||
						this.getBlock(x, y, z - 1) === 0 ||
						this.getBlock(x, y, z + 1) === 0;
					if(!exposed) continue;
					list.push({
						wx: x + this.cx * 16 + 0.5,
						wy: y + this.cy * 16 + 0.5,
						wz: z + 0.5,
						block: b,
					});
				}
			}
		}
		this._emissives = list;
		return list;
	}
	
	getBlock(x, y, z)
	{
		if(x >= 0 && y >= 0 && z >= 0 && x < 16 && y < 16 && z < 256) {
			return this.data[x + y * 16 + z * 16 * 16];
		}
		
		if(z >= 0 && z < 256) {
			return this.map.getBlock(this.cx * 16 + x, this.cy * 16 + y, z);
		}
		
		return 0;
	}
	
	setBlock(x, y, z, b)
	{
		if(x >= 0 && y >= 0 && z >= 0 && x < 16 && y < 16 && z < 256) {
			this.data[x + y * 16 + z * 16 * 16] = b;
			this.invalid = true;
			this._emissives = null;

			let adjacentList = [];
			
			if(x === 0) {
				adjacentList.push(this.map.getChunk(this.cx - 1, this.cy));
			
				if(y === 0) {
					adjacentList.push(this.map.getChunk(this.cx - 1, this.cy - 1));
				}
				else if(y === 15) {
					adjacentList.push(this.map.getChunk(this.cx - 1, this.cy + 1));
				}
			}
			else if(x === 15) {
				adjacentList.push(this.map.getChunk(this.cx + 1, this.cy));
			
				if(y === 0) {
					adjacentList.push(this.map.getChunk(this.cx + 1, this.cy - 1));
				}
				else if(y === 15) {
					adjacentList.push(this.map.getChunk(this.cx + 1, this.cy + 1));
				}
			}
			
			if(y === 0) {
				adjacentList.push(this.map.getChunk(this.cx, this.cy - 1));
			}
			else if(y === 15) {
				adjacentList.push(this.map.getChunk(this.cx, this.cy + 1));
			}
			
			adjacentList.forEach(chunk => {
				if(chunk) {
					chunk.invalid = true;
				}
			});
		}
	}
	
	generate()
	{
		for(let z=0, i=0; z<256; z++) {
			for(let y=0; y<16; y++) {
				for(let x=0; x<16; x++, i++) {
					this.data[i] = this.generator.getBlock(
						x + this.cx * 16,
						y + this.cy * 16,
						z,
					);
				}
			}
		}

		this._emissives = null;
		this.invalidateVicinity();
	}

	setData(data)
	{
		this.data = data;
		this._emissives = null;
		this.invalidateVicinity();
	}
	
	invalidateVicinity()
	{
		this.invalid = true;
		
		for(let y = -1; y <= +1; y++) {
			for(let x = -1; x <= +1; x++) {
				let chunk = this.map.getChunk(this.cx + x, this.cy + y);
				
				if(chunk) {
					chunk.invalid = true;
				}
			}
		}
	}
	
	getVicinity()
	{
		let chunks = [];
		
		for(let y = -1; y <= +1; y++) {
			for(let x = -1; x <= +1; x++) {
				let chunk = this.map.getChunk(this.cx + x, this.cy + y);
				
				if(chunk) {
					chunks.push(chunk.data);
				}
				else {
					chunks.push(zeroChunk);
				}
			}
		}
		
		return chunks;
	}
	
	update()
	{
		if(this.invalid) {
			this.meshingStartTime = performance.now();
			this.map.remeshChunk(this);
			this.invalid = false;
		}
	}
	
	applyMesh(mesh, transmesh)
	{
		this.buffer.update(new Float32Array(mesh));
		this.count = mesh.length / 10;
		this.transbuf.update(new Float32Array(transmesh));
		this.transcount = transmesh.length / 10;
		
		console.log("chunk mesh updated", this.cx, this.cy, "time", performance.now() - this.meshingStartTime);
	}
	
	draw(camera, sun, drawTrans, shadowMap, lightManager)
	{
		let shader = this.shader;
		let buffer = null;
		let count = 0;

		if(drawTrans) {
			buffer = this.transbuf;
			count = this.transcount;
		}
		else {
			buffer = this.buffer;
			count = this.count;
		}

		if(count === 0) {
			return;
		}

		shader.assignFloatAttrib("pos",  buffer, 3, 10, 0);
		shader.assignFloatAttrib("norm", buffer, 3, 10, 3);
		shader.assignFloatAttrib("uv",   buffer, 2, 10, 6);
		shader.assignFloatAttrib("face", buffer, 1, 10, 8);
		shader.assignFloatAttrib("ao",   buffer, 1, 10, 9);
		shader.use();
		shader.assignMatrix("proj", camera.proj);
		shader.assignMatrix("view", camera.view);
		shader.assignMatrix("model", this.model);
		shader.assignVector("sun", sun);
		shader.assignVector("uCameraPos", camera.pos);
		shader.assignFloat("uTime", (performance.now() - CHUNK_START_TIME) / 1000);
		shader.assignTexture("tex", this.texture, 0);

		if(shadowMap && shadowMap.enabled) {
			shader.assignMatrix("lightVP", shadowMap.lightVP);
			shader.assignTexture("shadowMap", {tex: shadowMap.depthTex}, 1);
			shader.assignFloat("shadowEnabled", 1.0);
		}
		else {
			shader.assignMatrix("lightVP", IDENTITY);
			shader.assignFloat("shadowEnabled", 0.0);
		}

		if(lightManager) {
			shader.assignVector3Array("lightPos", lightManager.posArr);
			shader.assignVector3Array("lightColor", lightManager.colArr);
		}

		this.display.drawTriangles(count);
	}

	// Depth-only pass for the shadow map. Uses a shader provided by the
	// ShadowMap (bound + .use()'d by the caller); we only need to push this
	// chunk's `pos` attribute and its `model` matrix.
	drawDepth(shader)
	{
		if(this.count === 0) return;
		shader.assignFloatAttrib("pos", this.buffer, 3, 10, 0);
		shader.assignMatrix("model", this.model);
		this.display.drawTriangles(this.count);
	}
}
