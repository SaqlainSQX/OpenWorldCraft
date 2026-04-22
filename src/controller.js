import Vector from "./vector.js";

export default class Controller
{
	constructor(camera, display, picker, map, speaker)
	{
		let canvas = display.canvas;
		
		this.canvas = canvas;
		this.camera = camera;
		this.picker = picker;
		this.speaker = speaker;
		this.map = map;
		this.keymap = {};
		this.locked = false;
		this.movespeed = 4;
		this.sprintspeed = 7;
		this.jumpspeed = 8;
		this.jumpsound = null;
		this.soundcooldown = true;
		
		speaker.loadSound("sfx/jump.ogg").then(sound => this.jumpsound = sound);
		
		window.addEventListener("keydown", e => this.keydown(e));
		window.addEventListener("keyup", e => this.keyup(e));
		canvas.addEventListener("mousedown", e => this.mousedown(e));
		canvas.addEventListener("mousemove", e => this.mousemove(e));
		document.addEventListener("pointerlockchange", e => this.lockchange(e));
	}
	
	getKey(e)
	{
		let key = e.key.toLowerCase();
		
		if(key === " ") {
			key = "space";
		}
		
		return key;
	}
	
	keydown(e)
	{
		this.speaker.activate();
		
		let key = this.getKey(e);
		
		this.keymap[key] = true;
	}
	
	keyup(e)
	{
		let key = this.getKey(e);
		
		this.keymap[key] = false;
	}
	
	mousedown(e)
	{
		this.speaker.activate();
		
		if(this.locked) {
			if(e.button === 0 && this.picker.hasHit) {
				this.map.setBlock(...this.picker.hitVox, 0);
			}
		}
		else {
			this.canvas.requestPointerLock();
			this.locked = true;
		}
	}
	
	mousemove(e)
	{
		if(this.locked) {
			this.camera.rx -= e.movementY;
			this.camera.rz -= e.movementX;
		}
	}
	
	lockchange(e)
	{
		if(document.pointerLockElement !== this.canvas) {
			this.locked = false;
		}
	}
	
	update(delta)
	{
		let inFluid = this.camera.inFluid;

		// Shift = sprint on land only. Sprint is disabled while swimming.
		let sprinting = !!this.keymap.shift && !inFluid;
		let movespeed = sprinting ? this.sprintspeed : this.movespeed;
		if(inFluid) {
			movespeed *= 0.6;  // slower horizontal travel in fluid
		}

		if(this.keymap.space) {
			if(inFluid) {
				// Swim up: continuous upward acceleration while Space is held.
				// The constant outpaces the reduced fluid gravity (-5) + drag,
				// giving a steady ascent rather than an instant jump.
				this.camera.vel.data[2] += 30 * delta;
			}
			else if(this.camera.rest.z < 0) {
				// Standard jump: impulse on ground contact only.
				this.camera.accel(new Vector(0, 0, this.jumpspeed), 1);

				if(this.jumpsound && this.soundcooldown) {
					this.speaker.playSound(this.jumpsound);
					this.soundcooldown = false;
					setTimeout(() => this.soundcooldown = true, 500);
				}
			}
		}

		if(this.keymap.w) {
			this.camera.moveForward(delta * movespeed);
		}
		if(this.keymap.s) {
			this.camera.moveBackward(delta * movespeed);
		}
		if(this.keymap.d) {
			this.camera.moveRightward(delta * movespeed);
		}
		if(this.keymap.a) {
			this.camera.moveLeftward(delta * movespeed);
		}
	}
}
