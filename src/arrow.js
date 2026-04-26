import Vector from "./vector.js";

// Projectile fired by the bow. Substeps motion each frame so a fast arrow
// doesn't tunnel through a thin wall or skim past a mob between frames.
// Arrows are one-shot lethal to mobs (call takeDamage with a huge value).

const ARROW_GRAVITY    = 18;     // m/s² downward
const ARROW_LIFE       = 6;      // seconds before despawn
const STUCK_LINGER     = 2.0;    // seconds an embedded arrow stays visible
const HIT_RADIUS       = 1.4;    // arrow-to-mob distance for a hit
const SUBSTEPS         = 5;      // motion substeps per update

export default class Arrow
{
	constructor(x, y, z, vx, vy, vz)
	{
		this.pos = new Vector(x, y, z);
		this.vel = new Vector(vx, vy, vz);
		this.dead = false;
		this.life = ARROW_LIFE;
		this.stuck = false;
		this.stuckTimer = 0;
	}

	update(delta, map, mobs)
	{
		this.life -= delta;
		if(this.life <= 0) { this.dead = true; return; }

		if(this.stuck) {
			this.stuckTimer += delta;
			if(this.stuckTimer >= STUCK_LINGER) this.dead = true;
			return;
		}

		let step = delta / SUBSTEPS;
		for(let s = 0; s < SUBSTEPS; s++) {
			this.vel.data[2] -= ARROW_GRAVITY * step;
			let nx = this.pos.x + this.vel.data[0] * step;
			let ny = this.pos.y + this.vel.data[1] * step;
			let nz = this.pos.z + this.vel.data[2] * step;

			// Mob hit — sphere check against each mob's centre. Mob centre
			// is roughly 0.4 above pos.z (boxmin at -1.8, boxmax at +0.9).
			for(let i = 0; i < mobs.length; i++) {
				let m = mobs[i];
				if(m.dead) continue;
				let dx = m.pos.x - nx;
				let dy = m.pos.y - ny;
				let dz = (m.pos.z - 0.4) - nz;
				if(dx*dx + dy*dy + dz*dz < HIT_RADIUS * HIT_RADIUS) {
					// One-shot lethal — pass a damage value larger than any
					// possible HP so it always kills outright.
					m.takeDamage(9999);
					this.dead = true;
					return;
				}
			}

			// Solid hit — embed the arrow at the surface.
			let bx = Math.floor(nx);
			let by = Math.floor(ny);
			let bz = Math.floor(nz);
			if(map.isSolid(bx, by, bz)) {
				this.stuck = true;
				this.pos.data[0] = nx;
				this.pos.data[1] = ny;
				this.pos.data[2] = nz;
				this.vel.set(0, 0, 0);
				return;
			}

			this.pos.data[0] = nx;
			this.pos.data[1] = ny;
			this.pos.data[2] = nz;
		}
	}
}
