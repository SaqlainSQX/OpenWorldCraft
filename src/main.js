import Display from "./display.js";
import Camera from "./camera.js";
import Controller from "./controller.js";
import Map from "./map.js";
import Vector from "./vector.js";
import {radians} from "./math.js";
import Picker from "./picker.js";
import Crosshairs from "./crosshairs.js";
import Debugger from "./debugger.js";
import Model from "./model.js";
import Texture from "./texture.js";
import Server from "./server.js";
import Sky from "./sky.js";
import Speaker from "./speaker.js";
import Mob from "./mob.js";
import Hotbar from "./hotbar.js";
import ShadowMap from "./shadowmap.js";
import LightManager from "./lights.js";
import PostProcessor from "./postprocessor.js";
import ParticleSystem from "./particles.js";
import BurstSystem from "./bursts.js";
import HostileMob from "./hostilemob.js";
import Arrow from "./arrow.js";
import {groundZ} from "./astar.js";
import {loadMobPolicy, predictAction} from "./mob_policy.js";

let display = new Display();

display.appendToBody();

let crosshairs = new Crosshairs();

crosshairs.appendToBody();

let server = new Server();
let map = new Map(display, server);

// Spawn high above spawn chunk so the player falls onto terrain on load.
// Surface heights now reach ~44, so spawn ~80 to give a clean fall.
let camera = new Camera(map, 90, 800/600, 0.1, 1000, 8,8,80, -30,0);

let picker = new Picker(display, map);
let speaker = new Speaker();
let controller = new Controller(camera, display, picker, map, speaker);

let dbg = new Debugger(camera, map, controller, server);

dbg.enable();
dbg.appendToBody();

let hotbar = new Hotbar(controller);
hotbar.appendToBody();

// --- Player HP HUD ---------------------------------------------------------

const PLAYER_MAX_HP = 10;
let playerHP = PLAYER_MAX_HP;
const SPAWN_POS = [8, 8, 80];

let hpHud = document.createElement("div");
hpHud.style.cssText = [
	"position: fixed",
	"top: 16px",
	"right: 16px",
	"padding: 6px 12px",
	"font-family: monospace",
	"font-size: 18px",
	"color: #fff",
	"background: rgba(15, 5, 25, 0.65)",
	"border: 1px solid rgba(180, 100, 220, 0.5)",
	"border-radius: 6px",
	"z-index: 100",
	"text-shadow: 1px 1px 0 #000",
].join(";");
document.body.appendChild(hpHud);

function renderHP() {
	hpHud.textContent = `HP: ${"♥".repeat(Math.max(0, playerHP))}${"·".repeat(PLAYER_MAX_HP - Math.max(0, playerHP))}`;
}
renderHP();

function flashHP() {
	hpHud.style.background = "rgba(200, 60, 100, 0.75)";
	setTimeout(() => hpHud.style.background = "rgba(15, 5, 25, 0.65)", 180);
}

let dead = false;

function damagePlayer(n) {
	if(dead) return;                     // ignore further hits during death screen
	playerHP = Math.max(0, playerHP - n);
	renderHP();
	flashHP();
	if(playerHP <= 0) {
		dead = true;
		document.exitPointerLock?.();    // release the cursor for the respawn click
		controller.locked = false;
		deathOverlay.style.display = "flex";
	}
}

function respawn() {
	camera.pos.data[0] = SPAWN_POS[0];
	camera.pos.data[1] = SPAWN_POS[1];
	camera.pos.data[2] = SPAWN_POS[2];
	camera.vel.set(0, 0, 0);
	playerHP = PLAYER_MAX_HP;
	submergedTime = 0;
	drownDamageAccum = 0;
	// Disarm fall tracking so the spawn-drop doesn't deal damage on landing.
	hasLanded = false;
	fallPeakZ = null;
	renderHP();
	dead = false;
	deathOverlay.style.display = "none";
}

let deathOverlay = document.createElement("div");
deathOverlay.style.cssText = [
	"position: fixed",
	"inset: 0",
	"background: radial-gradient(ellipse at center, rgba(80, 5, 20, 0.55) 0%, rgba(20, 0, 5, 0.92) 100%)",
	"display: none",
	"flex-direction: column",
	"align-items: center",
	"justify-content: center",
	"font-family: 'Courier New', monospace",
	"z-index: 999",
	"user-select: none",
].join(";");
deathOverlay.innerHTML = `
	<h1 style="
		font-size: 88px;
		letter-spacing: 12px;
		margin: 0 0 18px;
		color: #ff5577;
		text-shadow: 0 0 20px #ff2244, 0 0 50px #aa1133;
	">YOU DIED</h1>
	<p style="font-size: 16px; color: #d8a8b0; opacity: 0.85; margin: 0 0 36px;
	          letter-spacing: 3px;">the alien acid claimed another wanderer</p>
	<button id="respawnBtn" style="
		padding: 16px 56px;
		font-size: 22px;
		font-family: inherit;
		color: #ffe0e6;
		background: rgba(120, 30, 50, 0.55);
		border: 2px solid #cc3355;
		border-radius: 8px;
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 4px;
		box-shadow: 0 0 24px rgba(204, 51, 85, 0.5);
	">Respawn</button>
`;
document.body.appendChild(deathOverlay);

document.getElementById("respawnBtn").addEventListener("click", e => {
	e.stopPropagation();
	respawn();
});

// --- Drowning -------------------------------------------------------------
//
// First 10 s underwater: no damage (grace period). Past that, lose 1 HP
// every 3 s while still submerged. Surfacing instantly resets both timers,
// so quick dips are free.
const DROWN_GRACE_SEC    = 10;
const DROWN_TICK_SEC     = 3;
let submergedTime    = 0;
let drownDamageAccum = 0;

// --- Fall damage ----------------------------------------------------------
//
// Damage starts at fall distance 4 (1 heart), then +1 heart for every 2
// further blocks of fall (so 4..5 → 1, 6..7 → 2, 8..9 → 3, ...).
// `hasLanded` keeps the spawn-fall and respawn-fall exempt: the player
// must touch ground at least once before fall tracking arms.
let hasLanded = false;
let fallPeakZ = null;

function updateFallDamage()
{
	let onGround = camera.rest.z < 0;
	if(onGround) {
		if(hasLanded && fallPeakZ !== null) {
			let dist = fallPeakZ - camera.pos.z;
			if(dist >= 4) {
				let damage = 1 + Math.floor((dist - 4) / 2);
				damagePlayer(damage);
			}
		}
		hasLanded = true;
		fallPeakZ = null;
	}
	else if(camera.inFluid) {
		// Water cushions the fall — reset the peak so a partial drop into
		// acid then re-emerging doesn't carry the previous airborne distance.
		fallPeakZ = null;
	}
	else if(hasLanded) {
		if(fallPeakZ === null || camera.pos.z > fallPeakZ) {
			fallPeakZ = camera.pos.z;
		}
	}
}

function updateDrowning(delta) {
	if(camera.inFluid) {
		submergedTime += delta;
		if(submergedTime > DROWN_GRACE_SEC) {
			drownDamageAccum += delta;
			while(drownDamageAccum >= DROWN_TICK_SEC) {
				drownDamageAccum -= DROWN_TICK_SEC;
				damagePlayer(1);
			}
		}
	}
	else {
		submergedTime = 0;
		drownDamageAccum = 0;
	}
	// Drowning vignette intensity ramps from 0 at grace start to 1 at the
	// first damage tick — gives the player a visual warning before HP drops.
	let warnStart = DROWN_GRACE_SEC - 4;
	let drowning = 0;
	if(submergedTime > warnStart) {
		drowning = Math.min(1.0, (submergedTime - warnStart) / 4.0);
	}
	postProcessor.setUnderwater(camera.inFluid ? 1.0 : 0.0, drowning);
}

let sun = new Vector(0,0,1);

// Tilt the sun 45° off vertical so shadows are long and visible.
sun.rotateX(radians(45));

let model = new Model(
	display,
	new Texture(display, "gfx/guy.png"),
	[[-0.375, 0, -0.375], [+0.375, 0, -0.375], [0, 0, -0.25]]
);

model.addCube([-0.25, -0.25,-0.25], [ 0.5, 0.5, 0.5], [ 0, 0], [8,8, 8], 64, 3); // head
model.addCube([-0.25,-0.125, -1.0], [ 0.5,0.25,0.75], [ 0, 8], [8,4,12], 64, 0); // upper body
model.addCube([ -0.5,-0.125, -1.0], [0.25,0.25,0.75], [40, 0], [4,4,12], 64, 1); // left arm
model.addCube([ 0.25,-0.125, -1.0], [0.25,0.25,0.75], [40,12], [4,4,12], 64, 2); // right arm
model.addCube([-0.25,-0.125,-1.75], [0.25,0.25,0.75], [ 0,20], [4,4,12], 64, 0); // left leg
model.addCube([    0,-0.125,-1.75], [0.25,0.25,0.75], [20,20], [4,4,12], 64, 0); // right leg

// --- Monster model for hostile mobs ---------------------------------------
//
// Distinctly non-humanoid: a low-slung quadruped with a bulbous head, a
// jutting snout and two curved horns. The skin is a procedural magenta-on-
// near-black noise texture generated into a canvas at load time so no new
// asset file is needed; every face samples the same tileable patch.

function makeMonsterSkinURL()
{
	let c = document.createElement("canvas");
	c.width = 64; c.height = 64;
	let g = c.getContext("2d");
	g.fillStyle = "#1a0322";
	g.fillRect(0, 0, 64, 64);
	for(let i = 0; i < 900; i++) {
		let x = Math.floor(Math.random() * 64);
		let y = Math.floor(Math.random() * 64);
		let r = Math.random();
		g.fillStyle = r < 0.55 ? "#2b0838" : r < 0.85 ? "#45104a" : "#6a1c6a";
		g.fillRect(x, y, 1, 1);
	}
	// A few bright emissive specks — reads as pinpoint eyes / bioluminescent pores.
	for(let i = 0; i < 12; i++) {
		let x = Math.floor(Math.random() * 64);
		let y = Math.floor(Math.random() * 64);
		g.fillStyle = "#ff55cc";
		g.fillRect(x, y, 2, 2);
	}
	return c.toDataURL();
}

// Skeleton:
//   bone 1 — head cluster (head + snout + horns)   pivot in front of body
//   bone 2 — tail                                   pivot at body rear
//   bone 3 — front-left leg
//   bone 4 — front-right leg
//   bone 5 — back-left leg
//   bone 6 — back-right leg
// Each leg pivots around its hip joint (top of the leg cube). The hostile-
// mob update writes rx on the leg bones to swing them forward/back through
// a trot cycle.
let monsterModel = new Model(
	display,
	new Texture(display, makeMonsterSkinURL()),
	[
		[ 0,    -0.3,  0   ],   // bone 1 — head pivot
		[ 0,     0.45,-0.75],   // bone 2 — tail base
		[-0.425,-0.325,-1.1],   // bone 3 — front-left  hip
		[ 0.425,-0.325,-1.1],   // bone 4 — front-right hip
		[-0.425, 0.325,-1.1],   // bone 5 — back-left   hip
		[ 0.425, 0.325,-1.1],   // bone 6 — back-right  hip
	]
);

// Lowest z = -1.8 matches HostileMob's boxmin.z so feet sit on the ground.
monsterModel.addCube([-0.6, -0.5, -1.8], [0.35,0.35,0.7 ], [ 0, 0], [4,4, 8], 64, 3); // FL leg (bone 3)
monsterModel.addCube([ 0.25,-0.5, -1.8], [0.35,0.35,0.7 ], [ 0, 0], [4,4, 8], 64, 4); // FR leg (bone 4)
monsterModel.addCube([-0.6,  0.15,-1.8], [0.35,0.35,0.7 ], [ 0, 0], [4,4, 8], 64, 5); // BL leg (bone 5)
monsterModel.addCube([ 0.25, 0.15,-1.8], [0.35,0.35,0.7 ], [ 0, 0], [4,4, 8], 64, 6); // BR leg (bone 6)
monsterModel.addCube([-0.75,-0.65,-1.1 ], [1.5, 1.1, 0.8 ], [ 0, 0], [12,8,6], 64, 0); // body (static)
monsterModel.addCube([-0.55,-1.2, -0.35], [1.1, 0.6, 0.7 ], [ 0, 0], [10,4,6], 64, 1); // head
monsterModel.addCube([-0.35,-1.55,-0.25], [0.7, 0.4, 0.35], [ 0, 0], [6, 4,4], 64, 1); // snout
monsterModel.addCube([-0.5, -0.85, 0.3 ], [0.22,0.22,0.6 ], [ 0, 0], [2, 2,6], 64, 1); // left horn
monsterModel.addCube([ 0.28,-0.85, 0.3 ], [0.22,0.22,0.6 ], [ 0, 0], [2, 2,6], 64, 1); // right horn
monsterModel.addCube([-0.15, 0.45,-0.9 ], [0.3, 0.55,0.28], [ 0, 0], [2, 4,2], 64, 2); // tail (bone 2)

let players = {};

server.onAddPlayer = id => {
	players[id] = new Mob(map, 6,15,16, 0,0, [-0.25, -0.25, -1.75], [+0.25, +0.25, +0.25], model);
};

server.onRemovePlayer = id => {
	delete players[id];
};

server.onSetPlayerPos = (id, x, y, z, rx, rz) => {
	let player = players[id];
	
	if(player) {
		player.pos.data[0] = x;
		player.pos.data[1] = y;
		player.pos.data[2] = z;
		player.bones[2].rx = rx;
		player.rz = rz;
	}
};

let sky = new Sky(display);
let shadowMap = new ShadowMap(display, 1024);
let lightManager = new LightManager();
let postProcessor = new PostProcessor(display);
let particles = new ParticleSystem(display);
let bursts    = new BurstSystem(display);

// Per-block-id dust colour. Roughly matches the block's surface tint so a
// broken crystal puffs cyan, broken obsidian puffs near-black, etc.
const BLOCK_DUST_COLOR = {
	1:  [0.50, 0.85, 0.55],   // alien_grass
	2:  [0.55, 0.30, 0.55],   // alien_soil
	3:  [0.20, 0.10, 0.25],   // obsidian
	4:  [0.45, 0.95, 1.00],   // crystal
	5:  [0.60, 0.55, 0.55],   // ash
	6:  [0.45, 0.95, 0.45],   // acid
	7:  [0.40, 0.95, 0.75],   // glowmoss
	8:  [0.95, 0.45, 0.85],   // fungus
	9:  [0.55, 0.40, 0.30],   // alien_wood
	10: [0.60, 0.95, 0.85],   // glow_leaves
};

controller.onBlockBroken = (x, y, z, blockId) => {
	let col = BLOCK_DUST_COLOR[blockId] || [0.55, 0.50, 0.55];
	bursts.spawn(x + 0.5, y + 0.5, z + 0.5, col);
};

// --- Bow ------------------------------------------------------------------
//
// The player charges the bow with E (held) and releases to fire. An arrow
// is one-shot lethal to any mob it hits. Trail particles emitted each
// frame from the in-flight arrow give it a glowing streak.

let arrows = [];

controller.onBowFire = (charge) => {
	let speed = 18 + charge * 24;          // 18..42 m/s
	let v = camera.lookat;
	let p = camera.pos;
	// Spawn a metre or so in front of the camera so the arrow doesn't
	// instantly self-intersect the player's collision box.
	arrows.push(new Arrow(
		p.x + v.x * 0.6, p.y + v.y * 0.6, p.z + v.z * 0.6,
		v.x * speed,     v.y * speed,     v.z * speed,
	));
};

// Bow HUD — a small canvas drawn at the bottom-centre. Visible only while
// charging; the string pulls back proportionally to charge, and the colour
// shifts toward gold at full draw.
let bowHud = document.createElement("canvas");
bowHud.width  = 220;
bowHud.height = 270;
bowHud.style.cssText = [
	"position: fixed",
	"bottom: 24px",
	"left: 50%",
	"transform: translateX(-50%)",
	"pointer-events: none",
	"z-index: 50",
	"display: none",
].join(";");
document.body.appendChild(bowHud);
let bowCtx = bowHud.getContext("2d");

function drawBowHud(charge)
{
	let g = bowCtx;
	g.clearRect(0, 0, 220, 270);

	const cx = 110, top = 20, bottom = 240, mid = (top + bottom) / 2;
	const pull = charge * 62;
	const fullDraw = charge >= 0.95;

	// Bow limb — single curved stroke from top tip through belly to bottom tip.
	g.strokeStyle = "#7a4a22";
	g.lineWidth = 9;
	g.lineCap = "round";
	g.beginPath();
	g.moveTo(cx, top);
	g.quadraticCurveTo(cx - 78, mid, cx, bottom);
	g.stroke();

	// Wood highlight along the inside of the limb.
	g.strokeStyle = "#a06838";
	g.lineWidth = 3;
	g.beginPath();
	g.moveTo(cx, top + 8);
	g.quadraticCurveTo(cx - 64, mid, cx, bottom - 8);
	g.stroke();

	// String — bent toward the camera by `pull`.
	g.strokeStyle = fullDraw ? "#fff0a0" : "#e8e8e8";
	g.lineWidth = 2;
	g.beginPath();
	g.moveTo(cx, top);
	g.lineTo(cx + pull, mid);
	g.lineTo(cx, bottom);
	g.stroke();

	// Arrow nocked on the string.
	if(charge > 0.05) {
		const ax = cx + pull;
		g.strokeStyle = "#c87838";
		g.lineWidth = 4;
		g.lineCap = "round";
		g.beginPath();
		g.moveTo(ax - 110, mid);
		g.lineTo(ax, mid);
		g.stroke();
		// Head
		g.fillStyle = fullDraw ? "#ffe48a" : "#e0a060";
		g.beginPath();
		g.moveTo(ax,      mid - 6);
		g.lineTo(ax + 14, mid);
		g.lineTo(ax,      mid + 6);
		g.closePath();
		g.fill();
		// Fletching
		g.fillStyle = "#cc4477";
		g.beginPath();
		g.moveTo(ax - 110,    mid - 5);
		g.lineTo(ax - 102, mid);
		g.lineTo(ax - 110,    mid + 5);
		g.lineTo(ax - 118,    mid);
		g.closePath();
		g.fill();
	}

	// Charge bar.
	g.fillStyle = "rgba(0, 0, 0, 0.45)";
	g.fillRect(20, 252, 180, 6);
	g.fillStyle = fullDraw ? "#ffdd44" : "#cc6699";
	g.fillRect(20, 252, 180 * charge, 6);
}

// --- Hostile mobs ----------------------------------------------------------

const MAX_MOBS = 6;
const GREETER_COUNT = 3;            // mobs guaranteed in front of player at spawn
const SPAWN_RADIUS_MIN = 8;
const SPAWN_RADIUS_MAX = 22;
const RANDOM_SPAWN_MIN = 8;         // seconds between background spawns (random)
const RANDOM_SPAWN_MAX = 20;

let hostileMobs = [];
let lastPlayerAttackTime = -999;

// Controller reads this array to decide which mob the player is aiming at.
controller.hostileMobs = hostileMobs;
controller.onMobHit = () => { lastPlayerAttackTime = performance.now(); };

// On-screen mob HUD so we can diagnose spawns without scrolling the console.
let mobHud = document.createElement("div");
mobHud.style.cssText = [
	"position: fixed",
	"left: 16px",
	"bottom: 80px",
	"padding: 4px 10px",
	"font-family: monospace",
	"font-size: 13px",
	"color: #ffaaee",
	"background: rgba(20, 5, 30, 0.65)",
	"border: 1px solid rgba(180, 100, 220, 0.4)",
	"border-radius: 4px",
	"z-index: 100",
].join(";");
document.body.appendChild(mobHud);

let _spawnAttempts = 0;
let _spawnSkipped  = 0;
let _lastSpawnInfo = "—";
let _greeterSpawnedCount = 0;
let _randomSpawnTimer = RANDOM_SPAWN_MIN + Math.random() * (RANDOM_SPAWN_MAX - RANDOM_SPAWN_MIN);

// Helper that wraps the HostileMob ctor + hook wiring so we don't repeat it.
function makeMob(sx, sy, gz)
{
	let m = new HostileMob(map, monsterModel, sx + 0.5, sy + 0.5, gz + 2.0);
	m.onAttackPlayer = (d) => damagePlayer(d);
	m.policy = predictAction;
	hostileMobs.push(m);
	_lastSpawnInfo = `@(${sx},${sy},${gz})`;
	console.log("[mob] spawned", _lastSpawnInfo, "total", hostileMobs.length);
}

// Deterministic "greeter" trio — drops three mobs in a fan in front of the
// player as soon as walkable cells are found there. groundZ guarantees each
// landing cell sits on a solid (non-fluid) block.
function trySpawnGreeterMob()
{
	if(_greeterSpawnedCount >= GREETER_COUNT) return;

	// Fan angles: -25°, 0°, +25° (centered on +x), each with its own
	// distance so they don't stack.
	let fan = [
		{ angle: -25 * Math.PI / 180, dist: 5 },
		{ angle:   0,                  dist: 6 },
		{ angle: +25 * Math.PI / 180, dist: 5 },
	];
	let target = fan[_greeterSpawnedCount];

	// Search outward from the target cell so we still place even if the
	// exact tile is occupied (e.g. landed on a tree/water).
	for(let pad = 0; pad <= 4; pad++) {
		for(let oy = -pad; oy <= pad; oy++) {
			for(let ox = -pad; ox <= pad; ox++) {
				if(Math.abs(ox) !== pad && Math.abs(oy) !== pad) continue;
				let sx = Math.floor(camera.pos.x + Math.cos(target.angle) * target.dist) + ox;
				let sy = Math.floor(camera.pos.y + Math.sin(target.angle) * target.dist) + oy;
				let gz = groundZ(map, sx, sy);
				if(gz < 0) continue;
				makeMob(sx, sy, gz);
				_greeterSpawnedCount++;
				return;
			}
		}
	}
}

// One random spawn — used for background respawning. groundZ already requires
// a solid block beneath and a 3-tile air column, so the mob is guaranteed to
// land on top of a real block (never floating, never in fluid).
function spawnOneMob()
{
	_spawnAttempts++;

	for(let tries = 0; tries < 12; tries++) {
		let angle = Math.random() * 2 * Math.PI;
		let r = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
		let sx = Math.floor(camera.pos.x + Math.cos(angle) * r);
		let sy = Math.floor(camera.pos.y + Math.sin(angle) * r);
		let gz = groundZ(map, sx, sy);
		if(gz < 0) continue;

		makeMob(sx, sy, gz);
		return true;
	}
	_spawnSkipped++;
	return false;
}

// Per-frame: trickle in random spawns on a randomised cooldown so they
// appear over time rather than instantly filling the cap.
function tickRandomSpawns(delta)
{
	if(hostileMobs.length >= MAX_MOBS) return;
	_randomSpawnTimer -= delta;
	if(_randomSpawnTimer > 0) return;
	if(spawnOneMob()) {
		_randomSpawnTimer = RANDOM_SPAWN_MIN + Math.random() * (RANDOM_SPAWN_MAX - RANDOM_SPAWN_MIN);
	}
	else {
		// Couldn't find ground (chunks still loading) — retry quickly.
		_randomSpawnTimer = 1.0;
	}
}

// Kick off policy load early so by the time a mob spawns, inference is ready.
loadMobPolicy();

// --- Home screen ---------------------------------------------------------
// Full-screen overlay shown at page load. The frame loop renders the world
// behind it (so the player previews the scene), but all game-state updates
// (controller, mob spawning/AI, drowning, damage, particles) are gated on
// `gameStarted` so the player isn't dying or being chased while reading.
let gameStarted = false;

let homeOverlay = document.createElement("div");
homeOverlay.style.cssText = [
	"position: fixed",
	"inset: 0",
	"background: radial-gradient(ellipse at center, rgba(20, 5, 35, 0.55) 0%, rgba(8, 2, 18, 0.92) 100%)",
	"display: flex",
	"flex-direction: column",
	"align-items: center",
	"justify-content: center",
	"font-family: 'Courier New', monospace",
	"z-index: 1000",
	"user-select: none",
].join(";");
homeOverlay.innerHTML = `
	<h1 style="
		font-size: 78px;
		letter-spacing: 8px;
		margin: 0 0 12px;
		color: #ff99dd;
		text-shadow: 0 0 18px #ff55cc, 0 0 38px #ff55cc, 0 0 60px #aa33aa;
	">OpenWorldCraft</h1>
	<p style="font-size: 16px; color: #c8a8d8; opacity: 0.85; margin: 0 0 36px;
	          letter-spacing: 4px;">an alien bioluminescent voxel world</p>
	<button id="startBtn" style="
		padding: 16px 56px;
		font-size: 22px;
		font-family: inherit;
		color: #ffe0f5;
		background: rgba(80, 30, 100, 0.55);
		border: 2px solid #cc66cc;
		border-radius: 8px;
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 4px;
		box-shadow: 0 0 24px rgba(204, 102, 204, 0.45);
	">Click to Begin</button>
	<div style="margin-top: 56px; font-size: 13px; color: #a890b8; opacity: 0.7;
	            max-width: 520px; text-align: center; line-height: 1.9;">
		WASD move &middot; SHIFT sprint &middot; SPACE jump<br>
		F flashlight &middot; E hold-and-release to fire bow<br>
		1-9 hotbar &middot; mouse wheel cycle slot<br>
		Left-click attack/break &middot; Right-click place block
	</div>
`;
document.body.appendChild(homeOverlay);

document.getElementById("startBtn").addEventListener("click", e => {
	e.stopPropagation();
	homeOverlay.style.display = "none";
	gameStarted = true;
});

display.onframe = () =>
{
	dbg.frame();
	
	let cx = Math.floor(camera.pos.x / 16);
	let cy = Math.floor(camera.pos.y / 16);

	// Load a 5x5 region around the player (matches map.draw's cull radius).
	// One new chunk at a time so crossing a boundary doesn't stall on a big
	// batch of generation.
	const LOAD_RADIUS = 2;
	let missing = null;
	for(let y = cy - LOAD_RADIUS; y <= cy + LOAD_RADIUS && !missing; y++) {
		for(let x = cx - LOAD_RADIUS; x <= cx + LOAD_RADIUS && !missing; x++) {
			if(!map.getChunk(x, y)) missing = [x, y];
		}
	}
	if(missing) {
		map.loadChunk(missing[0], missing[1]);
	}

	camera.aspect = display.getAspect();

	// Game-state updates only run once the player clicks "Begin", and stop
	// while the death overlay is up. The world is still rendered behind
	// each overlay so they sit on top of the live scene.
	let active = gameStarted && !dead;
	if(active) {
		controller.update(1/60);
		updateDrowning(1/60);
		server.setMyPos(camera.pos.x, camera.pos.y, camera.pos.z, camera.rx, camera.rz);
		camera.update(1/60);
		updateFallDamage();
		picker.pick(camera.pos, camera.lookat, 16);
		hotbar.update();
	}

	map.update();
	
	for(let id in players) {
		players[id].update(1/60);
	}
	
	// Shadow pass: render nearby chunks into the light-space depth texture.
	shadowMap.update(camera, sun);
	shadowMap.render(shader => map.drawDepth(camera, shader));

	// Collect nearby emissive blocks into an 8-light uniform set for the
	// main chunk pass, plus push the player's flashlight into the same
	// manager so the chunk shader can apply a cone-spotlight on top.
	lightManager.update(camera, map, 2);
	lightManager.setFlashlight(controller.flashlightOn, camera.pos, camera.lookat);

	// Render the world into an offscreen RGBA8 FBO so the post-process
	// stage can run bloom + tone mapping over the whole scene.
	postProcessor.beginScene();

	sky.draw(camera);
	map.draw(camera, sun, shadowMap, lightManager);

	for(let id in players) {
		players[id].draw(camera, sun);
	}

	if(active) {
		// Hostile mobs — three guaranteed greeters at spawn, then random
		// trickle-spawns up to MAX_MOBS.
		trySpawnGreeterMob();
		tickRandomSpawns(1/60);
		let sinceAttack = (performance.now() - lastPlayerAttackTime) / 1000;
		for(let i = hostileMobs.length - 1; i >= 0; i--) {
			let mob = hostileMobs[i];
			mob.update(1/60, camera, sinceAttack);
			if(mob.removed) {
				hostileMobs.splice(i, 1);
			}
			else {
				mob.draw(camera, sun);
			}
		}

		mobHud.textContent = `MOBS: ${hostileMobs.length}/${MAX_MOBS}  tries:${_spawnAttempts}  skipped:${_spawnSkipped}  last:${_lastSpawnInfo}`;

		// Arrows — physics + collision, with a trail particle each frame so
		// the projectile reads as a glowing streak.
		for(let i = arrows.length - 1; i >= 0; i--) {
			let a = arrows[i];
			a.update(1/60, map, hostileMobs);
			if(a.dead) {
				arrows.splice(i, 1);
				continue;
			}
			bursts.trail(a.pos.x, a.pos.y, a.pos.z, [1.0, 0.78, 0.30]);
			bursts.trail(a.pos.x, a.pos.y, a.pos.z, [1.0, 0.55, 0.18], 18, 0.25);
		}

		// Ambient particles — drawn into the scene FBO so bloom picks them up.
		particles.update(1/60, camera);
		particles.draw(camera);

		// One-shot burst particles (block-break dust, arrow trails).
		bursts.update(1/60);
		bursts.draw(camera);

		picker.draw(camera);

		// Bow HUD — visible only while drawing the bow back.
		if(controller.bowCharging) {
			bowHud.style.display = "block";
			drawBowHud(controller.bowCharge);
		}
		else if(bowHud.style.display !== "none") {
			bowHud.style.display = "none";
		}
	}

	postProcessor.endSceneAndComposite();
};
