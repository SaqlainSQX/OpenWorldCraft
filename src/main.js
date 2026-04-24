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
import HostileMob from "./hostilemob.js";
import {groundZ} from "./astar.js";
import {loadMobPolicy, predictAction} from "./mob_policy.js";

let display = new Display();

display.appendToBody();

let crosshairs = new Crosshairs();

crosshairs.appendToBody();

let server = new Server();
let map = new Map(display, server);

// Spawn high above spawn chunk so the player falls onto terrain on load.
let camera = new Camera(map, 90, 800/600, 0.1, 1000, 8,8,40, -30,0);

let picker = new Picker(display, map);
let speaker = new Speaker();
let controller = new Controller(camera, display, picker, map, speaker);

let dbg = new Debugger(camera, map, controller, server);

dbg.enable();
dbg.appendToBody();

let hotbar = new Hotbar(controller);
hotbar.appendToBody();

// --- Player HP HUD ---------------------------------------------------------

const PLAYER_MAX_HP = 5;
let playerHP = PLAYER_MAX_HP;
const SPAWN_POS = [8, 8, 40];

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

function damagePlayer(n) {
	playerHP = Math.max(0, playerHP - n);
	renderHP();
	flashHP();
	if(playerHP <= 0) {
		// Respawn: teleport to spawn, restore HP, zero velocity.
		camera.pos.data[0] = SPAWN_POS[0];
		camera.pos.data[1] = SPAWN_POS[1];
		camera.pos.data[2] = SPAWN_POS[2];
		camera.vel.set(0, 0, 0);
		playerHP = PLAYER_MAX_HP;
		renderHP();
	}
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

// --- Hostile mobs ----------------------------------------------------------

const MAX_MOBS = 3;
const SPAWN_RADIUS_MIN = 14;
const SPAWN_RADIUS_MAX = 22;

let hostileMobs = [];
let lastPlayerAttackTime = -999;

// Controller reads this array to decide which mob the player is aiming at.
controller.hostileMobs = hostileMobs;
controller.onMobHit = () => { lastPlayerAttackTime = performance.now(); };

let _spawnAttempts = 0;
function spawnOneMob()
{
	_spawnAttempts++;
	let angle = Math.random() * 2 * Math.PI;
	let r = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
	let sx = Math.floor(camera.pos.x + Math.cos(angle) * r);
	let sy = Math.floor(camera.pos.y + Math.sin(angle) * r);
	let gz = groundZ(map, sx, sy);
	if(gz < 0) {
		if(_spawnAttempts % 120 === 1) console.log("[mob] spawn skipped — no ground at", sx, sy);
		return false;
	}

	console.log("[mob] spawning at", sx, sy, "ground z", gz, "— total now", hostileMobs.length + 1);
	let m = new HostileMob(map, model, sx + 0.5, sy + 0.5, gz + 1.75);
	m.onAttackPlayer = (dmg) => damagePlayer(dmg);
	m.policy = predictAction;
	hostileMobs.push(m);
	return true;
}

// Kick off policy load early so by the time a mob spawns, inference is ready.
loadMobPolicy();

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
	
	controller.update(1/60);
	
	server.setMyPos(camera.pos.x, camera.pos.y, camera.pos.z, camera.rx, camera.rz);
	
	camera.aspect = display.getAspect();
	camera.update(1/60);
	
	picker.pick(camera.pos, camera.lookat, 16);
	hotbar.update();

	map.update();
	
	for(let id in players) {
		players[id].update(1/60);
	}
	
	// Shadow pass: render nearby chunks into the light-space depth texture.
	shadowMap.update(camera, sun);
	shadowMap.render(shader => map.drawDepth(camera, shader));

	// Collect nearby emissive blocks into an 8-light uniform set for the
	// main chunk pass.
	lightManager.update(camera, map, 2);

	// Render the world into an offscreen RGBA8 FBO so the post-process
	// stage can run bloom + tone mapping over the whole scene.
	postProcessor.beginScene();

	sky.draw(camera);
	map.draw(camera, sun, shadowMap, lightManager);

	for(let id in players) {
		players[id].draw(camera, sun);
	}

	// Hostile mobs — keep MAX_MOBS alive; update/draw each, drop any that
	// fully dissolved.
	if(hostileMobs.length < MAX_MOBS) {
		spawnOneMob();
	}
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

	// Ambient particles — drawn into the scene FBO so bloom picks them up.
	particles.update(1/60, camera);
	particles.draw(camera);

	picker.draw(camera);

	postProcessor.endSceneAndComposite();
};
