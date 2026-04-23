import Shader from "./shader.js";
import Buffer from "./buffer.js";

// Post-processing pipeline: bloom + tone mapping.
//
// Per frame:
//   1. beginScene()             -> bind full-res RGBA8 FBO, clear
//   2. (caller renders world)
//   3. endSceneAndComposite()   -> bright-pass, 2x gaussian ping-pong,
//                                   composite with scene + ACES tone map,
//                                   output to default framebuffer
//
// All offscreen buffers are RGBA8 (LDR). True HDR would need
// EXT_color_buffer_half_float; we rely on the chunk shader already
// producing values that saturate near 1.0 for emissive surfaces so the
// brightpass still captures them.

const QUAD_VERTS = new Float32Array([
	-1,-1,  1,-1,  -1, 1,
	-1, 1,  1,-1,   1, 1,
]);

const passthroughVert = `
	attribute vec2 pos;
	varying mediump vec2 vUV;
	void main() {
		vUV = pos * 0.5 + 0.5;
		gl_Position = vec4(pos, 0.0, 1.0);
	}
`;

const brightFrag = `
	precision mediump float;
	uniform sampler2D scene;
	uniform float threshold;
	varying mediump vec2 vUV;
	void main() {
		vec3 c = texture2D(scene, vUV).rgb;
		float luma = dot(c, vec3(0.299, 0.587, 0.114));
		// Soft knee: smooth fade in just below threshold so the bright-pass
		// isn't binary.
		float w = smoothstep(threshold - 0.05, threshold + 0.05, luma);
		gl_FragColor = vec4(c * w, 1.0);
	}
`;

const blurFrag = `
	precision mediump float;
	uniform sampler2D src;
	uniform vec2 direction;   // single-pixel step in UV space
	varying mediump vec2 vUV;
	void main() {
		// 9-tap Gaussian (weights approximate sigma ~ 2.0).
		vec3 c = vec3(0.0);
		c += texture2D(src, vUV - 4.0 * direction).rgb * 0.051;
		c += texture2D(src, vUV - 3.0 * direction).rgb * 0.089;
		c += texture2D(src, vUV - 2.0 * direction).rgb * 0.130;
		c += texture2D(src, vUV - 1.0 * direction).rgb * 0.171;
		c += texture2D(src, vUV                  ).rgb * 0.196;
		c += texture2D(src, vUV + 1.0 * direction).rgb * 0.171;
		c += texture2D(src, vUV + 2.0 * direction).rgb * 0.130;
		c += texture2D(src, vUV + 3.0 * direction).rgb * 0.089;
		c += texture2D(src, vUV + 4.0 * direction).rgb * 0.051;
		gl_FragColor = vec4(c, 1.0);
	}
`;

const compositeFrag = `
	precision mediump float;
	uniform sampler2D scene;
	uniform sampler2D bloom;
	uniform float bloomStrength;
	uniform float exposure;
	varying mediump vec2 vUV;

	// ACES filmic approximation — a classic HDR->LDR tone map.
	vec3 aces(vec3 x) {
		float a = 2.51;
		float b = 0.03;
		float cc = 2.43;
		float d = 0.59;
		float e = 0.14;
		return clamp((x * (a * x + b)) / (x * (cc * x + d) + e), 0.0, 1.0);
	}

	void main() {
		vec3 s = texture2D(scene, vUV).rgb;
		vec3 b = texture2D(bloom, vUV).rgb;
		vec3 hdr = (s + b * bloomStrength) * exposure;
		gl_FragColor = vec4(aces(hdr), 1.0);
	}
`;

export default class PostProcessor
{
	constructor(display)
	{
		this.display = display;
		this.gl = display.gl;
		this.quadBuffer = new Buffer(display, QUAD_VERTS);
		this.brightShader    = new Shader(display, passthroughVert, brightFrag);
		this.blurShader      = new Shader(display, passthroughVert, blurFrag);
		this.compositeShader = new Shader(display, passthroughVert, compositeFrag);

		this.w = 0;
		this.h = 0;
		this._ensureBuffers();
	}

	_makeTex(w, h)
	{
		let gl = this.gl;
		let tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return tex;
	}

	_ensureBuffers()
	{
		let gl = this.gl;
		let w = gl.drawingBufferWidth;
		let h = gl.drawingBufferHeight;
		if(w === this.w && h === this.h && this.sceneFbo) return;

		// Free previous allocations.
		if(this.sceneFbo) {
			gl.deleteFramebuffer(this.sceneFbo);
			gl.deleteFramebuffer(this.brightFbo);
			gl.deleteFramebuffer(this.blurFboA);
			gl.deleteFramebuffer(this.blurFboB);
			gl.deleteTexture(this.sceneColor);
			gl.deleteTexture(this.brightTex);
			gl.deleteTexture(this.blurTexA);
			gl.deleteTexture(this.blurTexB);
			gl.deleteRenderbuffer(this.sceneDepth);
		}

		this.w = w;
		this.h = h;
		let hw = Math.max(1, (w >> 1));
		let hh = Math.max(1, (h >> 1));
		this.hw = hw;
		this.hh = hh;

		// Full-res scene FBO with depth renderbuffer.
		this.sceneColor = this._makeTex(w, h);
		this.sceneDepth = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

		this.sceneFbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColor, 0);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);

		// Half-res work buffers.
		this.brightTex = this._makeTex(hw, hh);
		this.brightFbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.brightTex, 0);

		this.blurTexA = this._makeTex(hw, hh);
		this.blurFboA = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboA);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTexA, 0);

		this.blurTexB = this._makeTex(hw, hh);
		this.blurFboB = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboB);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTexB, 0);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	// Bind scene FBO — caller then renders the world normally.
	beginScene()
	{
		this._ensureBuffers();
		let gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
		gl.viewport(0, 0, this.w, this.h);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	// Run bright-pass, 2x ping-pong blur, composite with tone map to screen.
	endSceneAndComposite()
	{
		let gl = this.gl;

		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);

		// --- 1. Bright pass ---
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
		gl.viewport(0, 0, this.hw, this.hh);
		this.brightShader.use();
		this.brightShader.assignFloatAttrib("pos", this.quadBuffer, 2, 2, 0);
		this.brightShader.assignTexture("scene", {tex: this.sceneColor}, 0);
		this.brightShader.assignFloat("threshold", 0.88);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// --- 2. Two ping-pong gaussian blur iterations ---
		this.blurShader.use();
		this.blurShader.assignFloatAttrib("pos", this.quadBuffer, 2, 2, 0);
		let loc = gl.getUniformLocation(this.blurShader.prog, "direction");

		// Iter 1: bright -> blurA (horizontal)
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboA);
		this.blurShader.assignTexture("src", {tex: this.brightTex}, 0);
		gl.uniform2f(loc, 1.0 / this.hw, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Iter 1: blurA -> blurB (vertical)
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboB);
		this.blurShader.assignTexture("src", {tex: this.blurTexA}, 0);
		gl.uniform2f(loc, 0, 1.0 / this.hh);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Iter 2: blurB -> blurA (horizontal, wider tap)
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboA);
		this.blurShader.assignTexture("src", {tex: this.blurTexB}, 0);
		gl.uniform2f(loc, 2.0 / this.hw, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Iter 2: blurA -> blurB (vertical, wider tap)
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboB);
		this.blurShader.assignTexture("src", {tex: this.blurTexA}, 0);
		gl.uniform2f(loc, 0, 2.0 / this.hh);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// --- 3. Composite to screen with ACES tone map ---
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.w, this.h);
		this.compositeShader.use();
		this.compositeShader.assignFloatAttrib("pos", this.quadBuffer, 2, 2, 0);
		this.compositeShader.assignTexture("scene", {tex: this.sceneColor}, 0);
		this.compositeShader.assignTexture("bloom", {tex: this.blurTexB}, 1);
		this.compositeShader.assignFloat("bloomStrength", 0.3);
		this.compositeShader.assignFloat("exposure", 1.05);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
	}
}
