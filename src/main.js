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

	sky.draw(camera);
	map.draw(camera, sun, shadowMap);

	for(let id in players) {
		players[id].draw(camera, sun);
	}

	picker.draw(camera);
};
