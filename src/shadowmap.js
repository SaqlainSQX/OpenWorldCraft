import Shader from "./shader.js";
import Matrix from "./matrix.js";

// Directional-sun shadow map.
//
// Strategy:
//   1. Each frame, build an orthographic light-space matrix centered on the
//      camera, looking along the inverse sun direction. A fixed-size frustum
//      means shadows are sharpest around the player.
//   2. Render every nearby chunk into a depth-only framebuffer using a minimal
//      position-only shader.
//   3. The main chunk shader samples that depth texture and darkens fragments
//      whose recorded depth in light space is further than the actual stored
//      depth (the surface is occluded from the sun).
//
// Requires the WEBGL_depth_texture extension (widely supported). If missing
// we disable the effect — callers can check `enabled`.

const vert = `
	uniform mat4 lightVP;
	uniform mat4 model;
	attribute vec3 pos;

	void main()
	{
		gl_Position = lightVP * model * vec4(pos, 1.0);
	}
`;

const frag = `
	precision mediump float;
	void main()
	{
		// We only care about the depth buffer. Colour write is essentially
		// unused but some drivers require a bound COLOR_ATTACHMENT0.
		gl_FragColor = vec4(1.0);
	}
`;

export default class ShadowMap
{
	constructor(display, size = 1024)
	{
		let gl = display.gl;
		this.display = display;
		this.gl = gl;
		this.size = size;
		this.enabled = false;

		let ext = gl.getExtension("WEBGL_depth_texture")
			|| gl.getExtension("WEBKIT_WEBGL_depth_texture")
			|| gl.getExtension("MOZ_WEBGL_depth_texture");
		if(!ext) {
			console.warn("[shadowmap] WEBGL_depth_texture unavailable — shadows disabled");
			return;
		}

		// Depth texture (will receive the z-buffer contents).
		this.depthTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0,
			gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		// Dummy colour attachment. Some drivers refuse a FBO without one.
		this.colorTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA,
			gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		this.fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D, this.colorTex, 0);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D, this.depthTex, 0);

		let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if(status !== gl.FRAMEBUFFER_COMPLETE) {
			console.error("[shadowmap] FBO incomplete, status:", status);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			return;
		}

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		this.shader = new Shader(display, vert, frag);
		this.proj = new Matrix();
		this.view = new Matrix();
		this.lightVP = new Matrix();
		this.enabled = true;
	}

	// Rebuild the light-space projection+view for this frame. The frustum is
	// a FOLLOW_RADIUS-sized box around the camera so shadow coverage stays
	// consistent as the player moves.
	update(camera, sun)
	{
		if(!this.enabled) return;

		const FOLLOW_RADIUS = 45;     // half-extent of ortho frustum in world units
		const LIGHT_DIST    = 100;    // how far along +sun we place the virtual eye
		const NEAR = 0.1;
		const FAR  = 260;

		this.proj.ortho(-FOLLOW_RADIUS, FOLLOW_RADIUS, -FOLLOW_RADIUS, FOLLOW_RADIUS, NEAR, FAR);

		// Sun vector points from surface toward the sun. The shadow-casting
		// "eye" sits far out along +sun, looking back at the camera.
		let sx = camera.pos.x + sun.x * LIGHT_DIST;
		let sy = camera.pos.y + sun.y * LIGHT_DIST;
		let sz = camera.pos.z + sun.z * LIGHT_DIST;

		// Reference up: world-up, unless sun is nearly parallel to it.
		let ux = 0, uy = 0, uz = 1;
		if(Math.abs(sun.z) > 0.99) { ux = 0; uy = 1; uz = 0; }

		this.view.lookAt(sx, sy, sz, camera.pos.x, camera.pos.y, camera.pos.z, ux, uy, uz);
		this.lightVP.multiply(this.proj, this.view);
	}

	// Bind FBO, clear depth, and invoke `renderFn(shader)` with the depth
	// shader already `.use()`d. Caller is responsible for per-object drawing.
	render(renderFn)
	{
		if(!this.enabled) return;

		let gl = this.gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
		gl.viewport(0, 0, this.size, this.size);
		gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

		// Front-face polygons cast shadows — culling back faces is fine.
		// Enable a small polygon offset if supported to reduce shadow acne.
		this.shader.use();
		this.shader.assignMatrix("lightVP", this.lightVP);

		renderFn(this.shader);

		// Restore the default framebuffer + viewport.
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		let w = gl.drawingBufferWidth;
		let h = gl.drawingBufferHeight;
		gl.viewport(0, 0, w, h);
	}
}
