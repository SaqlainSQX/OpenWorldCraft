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
	varying highp vec4 vLightPos;

	void main()
	{
		vec4 world = model * vec4(pos, 1.0);
		gl_Position = proj * view * world;
		vLightPos = lightVP * world;
		vUv = uv;

		float texX = mod(face, 16.0);
		float texY = floor(face / 16.0);
		texOffs = vec2(texX, texY) / 16.0;

		vDiffuse = max(0.0, dot(sun, norm));
		vAmbient = (4.0 - ao) * 0.25;
	}
`;

let frag = `
	precision mediump float;
	uniform sampler2D tex;
	uniform sampler2D shadowMap;
	uniform float shadowEnabled;     // 1.0 when shadow pass is active
	varying mediump vec2 vUv;
	varying mediump vec2 texOffs;
	varying mediump float vDiffuse;
	varying mediump float vAmbient;
	varying highp vec4 vLightPos;

	float sampleShadow()
	{
		if(shadowEnabled < 0.5) return 1.0;
		vec3 sc = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
		// Outside the shadow frustum — assume fully lit.
		if(sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) {
			return 1.0;
		}
		// Small constant bias to avoid shadow acne on lit surfaces.
		float stored = texture2D(shadowMap, sc.xy).r;
		return sc.z - 0.004 > stored ? 0.12 : 1.0;
	}

	void main()
	{
		vec2 texCoord = texOffs + fract(vUv) / 16.0;
		vec4 color = texture2D(tex, texCoord);
		float shadow = sampleShadow();
		// Direct-sun term dominates so shadows actually bite into the colour;
		// ambient + AO provide a soft floor.
		float lightFactor = 0.7 * vDiffuse * shadow + 0.3 * vAmbient;
		gl_FragColor = vec4(color.rgb * lightFactor, color.a);
	}
`;

// Identity matrix used when the shadow pass is disabled.
const IDENTITY = new Matrix();

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
		
		this.invalidateVicinity();
	}
	
	setData(data)
	{
		this.data = data;
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
	
	draw(camera, sun, drawTrans, shadowMap)
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
