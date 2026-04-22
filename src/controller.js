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

		// Hotbar: fixed layout mapping slot index -> block ID.
		// Slot order: grass, soil, obsidian, crystal, glowmoss, wood, leaves, ash, acid.
		this.hotbar = [1, 2, 3, 4, 7, 9, 10, 5, 6];

		// Inventory: block ID -> count. Player starts empty and collects by
		// breaking. Placement is gated on count > 0 and decrements on use.
		this.inventory = {};
		for(let id of this.hotbar) this.inventory[id] = 0;

		this.selectedSlot = 0;
		this.heldBlock = this.hotbar[0];

		speaker.loadSound("sfx/jump.ogg").then(sound => this.jumpsound = sound);

		window.addEventListener("keydown", e => this.keydown(e));
		window.addEventListener("keyup", e => this.keyup(e));
		canvas.addEventListener("mousedown", e => this.mousedown(e));
		canvas.addEventListener("mousemove", e => this.mousemove(e));
		canvas.addEventListener("contextmenu", e => e.preventDefault());
		canvas.addEventListener("wheel", e => this.wheel(e), {passive: false});
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

		// Number keys 1-9 select a hotbar slot and update the held block.
		if(key.length === 1 && key >= "1" && key <= "9") {
			let slot = parseInt(key, 10) - 1;
			if(slot < this.hotbar.length) {
				this.selectSlot(slot);
			}
		}
	}

	selectSlot(slot)
	{
		this.selectedSlot = slot;
		this.heldBlock = this.hotbar[slot];
	}

	wheel(e)
	{
		// Only cycle when the game has input focus (pointer locked).
		if(!this.locked) return;
		e.preventDefault();
		let step = Math.sign(e.deltaY);
		if(step === 0) return;
		let n = this.hotbar.length;
		this.selectSlot((this.selectedSlot + step + n) % n);
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
				// Break: remove the targeted block and bank one unit of its
				// type if the inventory has a slot for it.
				let broken = this.map.getBlock(...this.picker.hitVox);
				this.map.setBlock(...this.picker.hitVox, 0);
				if(broken > 0 && this.inventory[broken] !== undefined) {
					this.inventory[broken] += 1;
				}
			}
			else if(e.button === 2 && this.picker.hasHit && this.heldBlock > 0) {
				// Place: require at least one in stock, and refuse to place a
				// block where the player's AABB currently sits.
				if((this.inventory[this.heldBlock] || 0) > 0) {
					let [px, py, pz] = this.picker.placeVox;
					let cam = this.camera;
					let overlap =
						(px + 1 > cam.pos.x + cam.boxmin.x) && (px < cam.pos.x + cam.boxmax.x) &&
						(py + 1 > cam.pos.y + cam.boxmin.y) && (py < cam.pos.y + cam.boxmax.y) &&
						(pz + 1 > cam.pos.z + cam.boxmin.z) && (pz < cam.pos.z + cam.boxmax.z);
					if(!overlap) {
						this.map.setBlock(px, py, pz, this.heldBlock);
						this.inventory[this.heldBlock] -= 1;
					}
				}
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
