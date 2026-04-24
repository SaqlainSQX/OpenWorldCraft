import Body from "./body.js";
import Bone from "./bone.js";
import {findPath, groundZ} from "./astar.js";

// Hostile mob: a simple alien creature that chases the player using A*
// pathfinding driven by a behavior tree.
//
// Behavior tree (states):
//   IDLE    → not paying attention (initial state)
//   PATROL  → wander to a random nearby target
//   CHASE   → A* path to player's current cell, walk toward it
//   ATTACK  → within strike range, deal damage on a cooldown
//   FLEE    → low HP or a separate condition — path away from the player
//   DEAD    → death animation (dissolve) plays, then mob is marked for removal
//
// An ML policy (loaded elsewhere) can bias transitions between CHASE, FLEE
// and ATTACK; fallback rules here keep the mob working even with no policy.

const MAX_HP            = 3;
const ATTACK_RANGE      = 2.2;
const AGGRO_RANGE       = 22;
const FLEE_HP_FRACTION  = 0.4;
const REPLAN_INTERVAL   = 0.8;   // seconds between A* replans
const CHASE_SPEED       = 3.0;
const FLEE_SPEED        = 4.0;
const PATROL_SPEED      = 1.5;
const ATTACK_COOLDOWN   = 1.5;
const DISSOLVE_SPEED    = 0.6;   // per second

export default class HostileMob extends Body
{
	constructor(map, model, x, y, z)
	{
		super(map, x, y, z, 0, 0, [-0.3, -0.3, -1.0], [+0.3, +0.3, +0.5]);

		this.model = model;
		this.bones = model.roots.map(root => new Bone(...root));

		this.hp = MAX_HP;
		this.state = "IDLE";
		this.path = null;
		this.pathIdx = 0;
		this.replanTimer = 0;
		this.attackCooldown = 0;
		this.wanderTarget = null;

		this.dead = false;
		this.dissolve = 0;
		this.removed = false;          // set when fully dissolved — caller respawns

		this.acc.set(0, 0, -20);       // gravity

		// Optional hooks — set by caller
		this.onAttackPlayer = null;    // fn(damage)
		this.policy = null;            // fn(features) -> action index
	}

	// Decide next state given distance/HP/policy. Fallback logic is tabular;
	// if a policy function is present, it overrides the CHASE/FLEE/ATTACK
	// decision within its own envelope.
	_decideState(dist, sincePlayerAttack)
	{
		if(this.hp <= 0) return "DEAD";
		if(dist > AGGRO_RANGE) return "PATROL";

		if(this.policy) {
			let features = [
				Math.min(dist / AGGRO_RANGE, 1.0),
				this.hp / MAX_HP,
				sincePlayerAttack < 2.0 ? 1.0 : 0.0,
			];
			let action = this.policy(features);
			if(action === 0) return "CHASE";
			if(action === 1) return "FLEE";
			if(action === 2) return dist < ATTACK_RANGE ? "ATTACK" : "CHASE";
		}

		if(this.hp / MAX_HP < FLEE_HP_FRACTION) return "FLEE";
		if(dist < ATTACK_RANGE) return "ATTACK";
		return "CHASE";
	}

	update(delta, player, timeSincePlayerAttack = 10.0)
	{
		// Death animation — keep physics so it falls, run the dissolve up to 1.
		if(this.dead) {
			this.vel.data[0] = 0;
			this.vel.data[1] = 0;
			super.update(delta);
			this.model.update();
			this.bones.forEach(b => b.update());
			this.dissolve = Math.min(1.0, this.dissolve + delta * DISSOLVE_SPEED);
			if(this.dissolve >= 1.0) this.removed = true;
			return;
		}

		this.replanTimer    -= delta;
		this.attackCooldown -= delta;

		let dx = player.pos.x - this.pos.x;
		let dy = player.pos.y - this.pos.y;
		let dist = Math.hypot(dx, dy);

		let nextState = this._decideState(dist, timeSincePlayerAttack);
		if(nextState !== this.state) {
			this.state = nextState;
			this.path = null;
		}

		// Reset horizontal velocity; state action writes it.
		this.vel.data[0] = 0;
		this.vel.data[1] = 0;

		switch(this.state) {
			case "CHASE":  this._chase (delta, player, dx, dy, dist); break;
			case "FLEE":   this._flee  (delta, player, dx, dy, dist); break;
			case "ATTACK": this._attack(delta, player, dx, dy, dist); break;
			case "PATROL": this._patrol(delta); break;
			// IDLE / DEAD: no motion
		}

		super.update(delta);
		this.model.update();
		this.bones.forEach(b => b.update());
	}

	_replan(sx, sy, gx, gy)
	{
		this.path = findPath(this.map, sx, sy, gx, gy, 150);
		this.pathIdx = 0;
		this.replanTimer = REPLAN_INTERVAL;
	}

	_followPath(delta, speed)
	{
		if(!this.path || this.pathIdx >= this.path.length) return;
		let target = this.path[this.pathIdx];
		let tx = target.x + 0.5;
		let ty = target.y + 0.5;
		let dx = tx - this.pos.x;
		let dy = ty - this.pos.y;
		let d  = Math.hypot(dx, dy);

		if(d < 0.3) {
			this.pathIdx++;
			return;
		}

		this.vel.data[0] = (dx / d) * speed;
		this.vel.data[1] = (dy / d) * speed;
		this.rz = Math.atan2(dx, dy) * 180 / Math.PI;
	}

	_chase(delta, player)
	{
		if(this.replanTimer <= 0 || !this.path) {
			this._replan(
				Math.floor(this.pos.x), Math.floor(this.pos.y),
				Math.floor(player.pos.x), Math.floor(player.pos.y),
			);
		}
		this._followPath(delta, CHASE_SPEED);
	}

	_flee(delta, player, dx, dy, dist)
	{
		if(this.replanTimer <= 0 || !this.path) {
			let away = 12;
			let ux = -dx / Math.max(dist, 0.001);
			let uy = -dy / Math.max(dist, 0.001);
			this._replan(
				Math.floor(this.pos.x), Math.floor(this.pos.y),
				Math.floor(this.pos.x + ux * away),
				Math.floor(this.pos.y + uy * away),
			);
		}
		this._followPath(delta, FLEE_SPEED);
	}

	_attack(delta, player, dx, dy)
	{
		// Face the player.
		this.rz = Math.atan2(dx, dy) * 180 / Math.PI;
		if(this.attackCooldown <= 0) {
			this.attackCooldown = ATTACK_COOLDOWN;
			if(this.onAttackPlayer) this.onAttackPlayer(1);
		}
	}

	_patrol(delta)
	{
		if(!this.wanderTarget || this.replanTimer <= 0) {
			let angle = Math.random() * 2 * Math.PI;
			let r = 4 + Math.random() * 6;
			this.wanderTarget = {
				x: Math.floor(this.pos.x + Math.cos(angle) * r),
				y: Math.floor(this.pos.y + Math.sin(angle) * r),
			};
			this._replan(
				Math.floor(this.pos.x), Math.floor(this.pos.y),
				this.wanderTarget.x, this.wanderTarget.y,
			);
			this.replanTimer = REPLAN_INTERVAL * 3;
		}
		this._followPath(delta, PATROL_SPEED);
	}

	takeDamage(amount)
	{
		if(this.dead) return;
		this.hp -= amount;
		if(this.hp <= 0) {
			this.dead = true;
			this.state = "DEAD";
		}
	}

	draw(camera, sun)
	{
		this.model.draw(camera, sun, this.mat, this.bones.map(b => b.mat), {
			tint: this._tint(),
			dissolve: this.dissolve,
		});
	}

	// Dark magenta tint so the hostile mob reads as "not you".
	_tint()
	{
		return [0.85, 0.45, 0.95];
	}
}
