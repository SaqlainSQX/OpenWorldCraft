# OpenWorldCraft

> An alien bioluminescent voxel world rendered in WebGL — a computer graphics semester project showcasing modern real-time rendering techniques on top of a voxel sandbox.

Built on the [guckstift/voxel-game-js](https://github.com/guckstift/voxel-game-js) engine and extended with a deep rendering stack: shadow mapping, point-light accumulation, post-processing, volumetric god rays, Gerstner-wave water, an animated hostile mob with an ML-driven decision policy, a player flashlight, drowning, fall damage, fluid flow, and more.

---

## Quick start

```bash
./serve.sh
# then open http://localhost:8000 in a Chromium-based browser
```

The only dependency is `python3` for the bundled static dev server. No build step — every source file is loaded directly by the browser as an ES module (the chunk mesher runs as a classic worker).

---

## Controls

| Action                 | Key / Mouse                                              |
|------------------------|----------------------------------------------------------|
| Look around            | Click canvas to lock pointer, then move mouse            |
| Walk                   | `W` `A` `S` `D`                                          |
| Sprint                 | `Shift` (land only — disabled in fluids)                |
| Jump / swim up         | `Space`                                                  |
| Toggle flashlight      | `F`                                                      |
| Charge bow             | hold `E`                                                 |
| Fire bow               | release `E` (one-shot lethal to mobs)                    |
| Select hotbar slot     | `1`–`9`                                                  |
| Cycle hotbar           | scroll wheel                                             |
| Break / attack         | left click                                               |
| Place block            | right click (slot 9 = acid; spreads after placing)       |
| Debug overlay          | `F3`                                                     |
| Release pointer        | `Esc`                                                    |

---

## Feature list

### Rendering pipeline

- **Shadow mapping** — orthographic directional sun, 1024² depth-texture FBO via `WEBGL_depth_texture`, per-fragment shadow lookup with bias.
- **Point lights** — emissive blocks (crystal, acid, glowmoss, fungus, glow_leaves) registered into an 8-light uniform set per frame; chunk shader sums their contribution with distance attenuation.
- **Player flashlight** — cone spotlight with smooth-step falloff and quadratic attenuation, toggleable with `F`. Same uniform path as point lights but with a direction + cone-cosine cutoff.
- **Volumetric god rays** — per-fragment shadow-volume raymarch (4 steps), gated by sun-direction alignment so the effect appears only when looking toward the sun.
- **Atmospheric fog** — exponential fog blended toward the sky horizon colour for seamless skybox transitions.
- **Gerstner-wave water** — per-fragment normals from two summed sine waves; Fresnel reflection (deep teal vs. magenta sky), Blinn-Phong specular toward the sun, fragment-only so it works with greedy-meshed acid surfaces.
- **Bloom + ACES tone mapping** — full-resolution scene FBO, half-res bright pass, 2× ping-pong Gaussian blur, ACES filmic tone map composite.
- **Underwater post-process** — sin-based UV ripple + teal tint applied during the composite stage when the camera is submerged.
- **Drowning vignette** — pulsing red ring closes in from the screen edges as oxygen runs out (post-process composite layer).

### World & terrain

- **Alien block palette** — alien_grass, alien_soil, obsidian, crystal, ash, acid, glowmoss, fungus, alien_wood, glow_leaves, plus three player-only spread variants.
- **Procedural terrain** — 2D smooth-noise heightmap (28–44 block thickness) with biome-noise modulation for grass / glowmoss patches.
- **Procedural trees** — sparse Poisson-like distribution from a noise threshold, with greedy-meshed trunks and oblate-spheroid canopies.
- **Caves** — 3D-noise carving combining a wide-cavern mask (sample at `1/16` scale) and a fine-tunnel mask (`1/9`) ORed together so caverns connect via tunnels. Bedrock floor + 2-block ceiling buffer keep the surface continuous.
- **Surface rock formations** — region-gated above-ground outcrops with a tapered blob mask, hollowed by the same tunnel noise → natural arches and surface caves.
- **Alien sky** — magenta horizon, indigo zenith, teal band, 500-cell hashed star field with twinkle, two moons (large teal + small magenta) with halos.
- **Particle systems** — 100-point ambient atmosphere (75% teal spores + 25% magenta fireflies) drawn additively so they pick up the bloom, plus a separate burst pool for one-shot effects.

### Gameplay & interaction

- **Player physics** — gravity, jumping, sprinting, step-up traversal.
- **Fluid physics** — buoyancy + drag in acid; swim up with `Space`; sprint disabled in fluid.
- **Drowning** — 10 s grace period underwater, then 1 heart every 3 s. Pulsing red vignette warns from ~6 s in.
- **Fall damage** — `4..5` blocks → 1 heart, then `+1` heart per additional 2 blocks. Spawn-fall and respawn-fall exempt; water cushions falls.
- **Inventory + hotbar** — count-based, 32 of each block at start; placement decrements the count; broken blocks add back (only for hotbar IDs).
- **Block-break dust** — 16-particle burst per break, colour-matched to the broken block.
- **Player-placed water flows** — placed acid registers as a level-0 source and propagates outward via a 4-block fade gradient (full → 1/3 → 2/3 → trace) before dying out. Down-flow is unlimited (gravity), horizontal spread is capped, all on a 130 ms tick.
- **Bow** — hold `E` to charge a canvas-rendered bow at the bottom of the HUD (string pulls back, colour shifts toward gold at full draw); release fires an arrow with arc-traced gravity that one-shots any hostile mob it hits or embeds in a wall for 2 seconds.

### Hostile mob

- **A\*** **pathfinding** — XY-plane voxel A* over walkable surface cells, with a 3-block air-column requirement and a fluid-rejecting `groundZ` so mobs never wade.
- **Behavior tree** — finite-state machine with PATROL / CHASE / ATTACK / FLEE / DEAD; transitions chosen by a small ML policy with rule-based fallback.
- **ML decision policy** — a 3 → 8 → 8 → 3 MLP trained in `tools/train_mob_policy.py` on synthetic heuristic-labelled data (8000 samples, 600 epochs, ~97% val accuracy), exported to `assets/mob_policy.json`. JS runtime in `src/mob_policy.js` does a forward pass per frame to bias CHASE / FLEE / ATTACK.
- **Procedural skin** — 64×64 magenta-on-near-black noise texture generated into a `<canvas>` at load time with bright emissive specks; no asset file needed.
- **Skeletal walk cycle** — 6-bone rig (head + tail + 4 hip joints) with a diagonal quadruped trot (FL+BR vs. FR+BL π apart), head bob, and tail wag. Speed scales with horizontal velocity.
- **Jumping** — automatic obstacle hops when `rest.x` or `rest.y` latches non-zero while moving, plus random patrol/chase hops for liveliness.
- **Dissolve death** — model-shader hash-noise dissolve with a bright pink emissive edge at the cutoff front.
- **Spawning** — three guaranteed greeter mobs in a fan in front of the player at game start; background trickle-spawner refills the population at 12–25 second intervals.

### UI

- **Home screen** — full-screen overlay with the OpenWorldCraft title in glowing magenta, a "Click to Begin" button, and a control reference. World renders behind it; game logic gated on the start click.
- **Death screen** — "YOU DIED" overlay in red on player HP zero, with a Respawn button. Pointer lock is released so you can click; mob attacks ignored while dead.
- **HP HUD** — top-right hearts (`♥`/`·`) with damage flash.
- **Bow HUD** — bottom-centre canvas drawn each frame while charging; bow body, pulling string, nocked arrow, and a charge bar.
- **Mob HUD** — bottom-left diagnostic line (mob count / spawn attempts / fluid sources / held block).

---

## Architecture

```
src/
├── main.js              orchestration, HUDs, frame loop, fluid + drowning + fall damage
├── display.js           WebGL context + per-frame loop
├── camera.js            view + projection matrices, camera physics
├── controller.js        keyboard / mouse / pointer-lock, hotbar, bow input
├── body.js              AABB collision against the voxel grid
├── map.js               chunk store, raymarch + boxmarch, mesh worker dispatch
├── chunk.js             per-chunk shader (most uniforms — shadows, lights, water, fog, god rays, flashlight)
├── mesher.js            classic Web Worker — greedy mesher with packed AO + emissive flag
├── generator.js         terrain noise (2D height, 3D cave + surface-rock mask, tree placement)
├── shadowmap.js         orthographic light-VP + depth FBO
├── lights.js            8-slot point-light selector + flashlight uniform pack
├── postprocessor.js     scene FBO → bright pass → ping-pong blur → ACES composite (+ underwater + drowning passes)
├── particles.js         ambient atmosphere — 100 points, additive blend, life envelope
├── bursts.js            short-lived burst particles (block-break dust, arrow trails)
├── sky.js               full-screen alien sky: gradient, stars, twin moons
├── model.js             skinned-mesh shader for player + mob (tint + dissolve uniforms)
├── bone.js, vector.js, matrix.js, math.js, buffer.js, shader.js, texture.js, blocks.js   primitives
├── picker.js            voxel raycaster + crosshair-target wireframe
├── crosshairs.js        centre crosshair sprite
├── hotbar.js            DOM-rendered hotbar with active-slot highlight
├── debugger.js          F3 stats overlay
├── speaker.js           Web Audio output (jump sound, ambient activation)
├── server.js            optional multiplayer client (offline by default)
├── astar.js             XY-plane A* over walkable surface cells (mob navigation)
├── mob.js               other-player Mob class (legacy multiplayer)
├── hostilemob.js        hostile mob: behavior tree, A*, skeletal animation, jumping, dissolve
├── mob_policy.js        runtime forward pass for the trained MLP policy
└── arrow.js             bow projectile physics + sphere-vs-mob hit detection

tools/
├── gen_blocks.py        generate gfx/blocks.png texture atlas
└── train_mob_policy.py  train + export the mob policy MLP
```

---

## ML training

The hostile mob's decision policy is trained offline with `numpy`:

```bash
python3 tools/train_mob_policy.py
# writes assets/mob_policy.json
```

The training script generates 8000 synthetic `(distance, hp_ratio, recently_hit)` samples labelled by a hand-crafted heuristic, fits a `3 → 8 → 8 → 3` softmax MLP, and exports the weights as JSON. The JS runtime (`src/mob_policy.js`) does a per-frame forward pass to bias the behavior tree's CHASE / FLEE / ATTACK decisions; if the JSON fails to load, the FSM falls back to its rule-based version.

This is supervised learning rather than RL — for a 3-feature, 3-action problem with clear correct behaviour, the MLP learns the same boundaries a Q-learner would converge to in seconds, without needing a simulation environment.

---

## Tech stack

- **WebGL 1.0** + **GLSL ES 1.0** (with `WEBGL_depth_texture` for shadow mapping)
- **Vanilla JavaScript** (ES modules, no framework)
- **Classic Web Worker** for chunk meshing (greedy mesher with packed AO)
- **Python 3 / NumPy** for the offline MLP training
- **Static dev server** — Python's `http.server`

---

## Credits

- Engine fork of [guckstift/voxel-game-js](https://github.com/guckstift/voxel-game-js) (MIT).
- Computer graphics project, 7th-semester elective.
