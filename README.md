# OpenWorldCraft

```
   ___                __        __         _    _  _____           __ _
  / _ \ _ __ ___  ___ \ \      / /__  _ __| | __| |/ ___|_ __ __ _ / _| |_
 | | | | '_ ` _ \/ _ \ \ \ /\ / / _ \| '__| |/ _` | |   | '__/ _` | |_| __|
 | |_| | | | | | |  __/  \ V  V / (_) | |  | | (_| | |___| | | (_| |  _| |_
  \___/|_| |_| |_|\___|   \_/\_/ \___/|_|  |_|\__,_|\____|_|  \__,_|_|  \__|
```

> **An alien bioluminescent voxel world rendered in WebGL.**
> A computer graphics semester project that builds a serious real-time rendering stack — shadow mapping, point lights, post-processing, volumetric god rays, Gerstner-wave water, an animated hostile mob with an ML-driven decision policy, and more — on top of a hand-written voxel sandbox.

Built on a fork of [guckstift/voxel-game-js](https://github.com/guckstift/voxel-game-js). Pure WebGL 1.0, vanilla JavaScript, no framework, no build step. The chunk mesher runs as a classic Web Worker; the mob policy is trained offline in NumPy and run in JS.

---

## Table of Contents

1. [Quick start](#quick-start)
2. [Controls](#controls)
3. [Showreel](#showreel)
4. [Rendering pipeline — deep dive](#rendering-pipeline--deep-dive)
5. [World & terrain](#world--terrain)
6. [Hostile mob](#hostile-mob)
7. [Gameplay & interaction](#gameplay--interaction)
8. [Architecture](#architecture)
9. [Build & ML training](#build--ml-training)
10. [Tech stack](#tech-stack)

---

## Quick start

```bash
./serve.sh
# open http://localhost:8000 in a Chromium-based browser
```

Only `python3` is required. No build step — every source file is loaded directly by the browser as an ES module. Click **Begin** on the home screen and you're in.

---

## Controls

| Action                      | Binding                                                           |
|-----------------------------|-------------------------------------------------------------------|
| Look around                 | click canvas to lock pointer, then move mouse                     |
| Walk                        | `W` `A` `S` `D`                                                   |
| Sprint                      | `Shift` (land only — disabled in fluids)                          |
| Jump / swim up              | `Space`                                                           |
| Toggle flashlight           | `F`                                                               |
| Charge bow                  | hold `E`                                                          |
| Fire bow                    | release `E` — one-shot lethal vs. mobs, sticks in walls           |
| Select hotbar slot          | `1`–`9`                                                           |
| Cycle hotbar slot           | scroll wheel                                                      |
| Break / attack              | left click (mob takes priority within a 25° aim cone)             |
| Place block                 | right click — slot 9 is acid which spreads after placing          |
| Debug overlay               | `F3`                                                              |
| Release pointer             | `Esc`                                                             |

---

## Showreel

> Everything below is implemented and live. Hard-refresh the page at `localhost:8000` to see any of it.

| Subsystem                          | What it does                                                                                                            |
|------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| **Shadow mapping**                 | Orthographic directional sun, 1024² depth-texture FBO, per-fragment biased shadow lookup                               |
| **Point lights (×8)**              | Emissive blocks register as lights; chunk shader sums distance-attenuated contributions                                 |
| **Player flashlight**              | Cone spotlight with smoothstep cone falloff and quadratic distance attenuation, toggleable with `F`                    |
| **Volumetric god rays**            | Per-fragment shadow-volume raymarch (4 steps), gated by sun-direction alignment                                         |
| **Atmospheric fog**                | Exponential fog blended toward the sky horizon for seamless skybox transitions                                          |
| **Gerstner-wave water**            | Per-fragment normals from two summed sines, Fresnel reflection, Blinn-Phong sun specular                               |
| **Bloom + ACES tone mapping**      | Half-res bright pass → 2× ping-pong Gaussian blur → ACES filmic composite to screen                                    |
| **Underwater post-process**        | Sin-based UV ripple + teal tint applied during the composite pass when the camera is submerged                          |
| **Drowning vignette**              | Pulsing red ring closes in from screen edges as oxygen runs out                                                         |
| **Caves**                          | Two stacked 3D-noise thresholds: wide caverns + thin tunnels, ORed → connected cave systems                              |
| **Above-ground rock formations**   | Region-gated tapered blob mask, hollowed by the same tunnel noise — natural arches and surface caves                    |
| **Procedural alien sky**           | Magenta horizon, indigo zenith, teal band, hashed star field with twinkle, twin moons with halos                       |
| **Particle systems**               | 100-point ambient swarm (spores + fireflies, additive blend) plus a separate burst pool                                 |
| **Hostile mob**                    | A* navigation, behavior tree, ML policy, 6-bone walk cycle, jumping, dissolve death                                     |
| **Bow + arrows**                   | Canvas-rendered HUD with charge animation, projectile arc tracing with substepped collision                             |
| **Fluid flow**                     | Player-placed acid spreads with 4-level fade gradient, dies out, ticks at 7.5 Hz                                        |
| **Block-break dust**               | 16-particle burst per break, colour-matched to the broken block                                                         |
| **Fall damage**                    | 4 blocks → 1 heart, then +1 heart per additional 2 blocks; spawn-fall and water-drops exempt                            |

---

## Rendering pipeline — deep dive

Each frame runs through a five-stage pipeline:

```
┌────────────────────┐  ┌─────────────────┐  ┌───────────────┐  ┌──────────────┐  ┌────────────────────┐
│  1. Shadow pass    │→ │ 2. Light gather │→ │ 3. Scene FBO  │→ │ 4. Bloom     │→ │ 5. ACES composite  │
│  depth-only render │  │ 8 point lights  │  │ sky + chunks  │  │ bright +     │  │ + underwater +     │
│  from sun's POV    │  │ + flashlight    │  │ + mobs +      │  │ ping-pong    │  │ drowning vignette  │
│  → depth texture   │  │ → uniform pack  │  │ particles +   │  │ Gaussian     │  │ → backbuffer       │
│                    │  │                 │  │ picker        │  │ blur ×2      │  │                    │
└────────────────────┘  └─────────────────┘  └───────────────┘  └──────────────┘  └────────────────────┘
```

### Shadow mapping

Orthographic projection from the sun direction into a 1024² depth-only FBO via the `WEBGL_depth_texture` extension. The light-VP matrix is computed each frame to follow the camera so the shadow frustum stays around the player. Shadow lookup in the chunk fragment shader does a single sample with a 0.004 bias to suppress acne; missed lookups fall back to fully lit so terrain at the shadow-map edge isn't darkened.

```glsl
float sampleShadow() {
    if(shadowEnabled < 0.5) return 1.0;
    vec3 sc = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
    if(sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    float stored = texture2D(shadowMap, sc.xy).r;
    return sc.z - 0.004 > stored ? 0.12 : 1.0;
}
```

### Point lights

A `LightManager` walks every chunk in the draw radius each frame, collects `(pos, block_id)` for every emissive voxel exposed to air, sorts by distance squared with a partial selection sort, and packs the closest 8 into flat `Float32Array`s for a single uniform upload. Block-specific colours (cyan crystal, magenta fungus, teal glow_leaves, …) come from a small lookup table. Falloff is `1 / (1 + 0.18·d + 0.035·d²)` clipped to 0.

### Player flashlight

The same `LightManager` carries a separate set of uniforms for a cone spotlight. The chunk shader evaluates a cone-attenuated point light:

```glsl
float align = -dot(Ldir, uFlashDir);
if(align < uFlashConeCos) return vec3(0.0);
float cone = smoothstep(uFlashConeCos, 1.0, align);
float att  = 1.0 / (1.0 + 0.05 * d + 0.012 * d * d);
return uFlashColor * cone * att * max(0.0, dot(Ldir, vNormal));
```

The half-angle is 39° and the colour exceeds 1.0 in red/green so the centre of the beam crosses the bloom threshold and glows softly through fog.

### Volumetric god rays

A per-fragment screen-space raymarch from camera → fragment, four samples reprojected into light space, scoring "lit" steps by comparing against the shadow map. Modulated by `pow(dot(viewDir, sunDir), 3.0)` so the effect appears only when looking roughly toward the sun, and by the fog factor so god rays show inside fog where there's something for the light to scatter off.

### Gerstner-wave water

Acid surfaces use a fragment-only normal perturbation (no vertex displacement, since greedy meshing coalesces water into giant quads). Two summed directional sine waves whose gradient tilts the surface normal:

```glsl
vec3 waterNormal(vec2 xy, float t) {
    vec2 d1 = vec2( 1.0, 0.3); float f1 = 0.70; float amp1 = 0.12;
    vec2 d2 = vec2(-0.4, 0.8); float f2 = 1.10; float amp2 = 0.07;
    float a1 = dot(d1, xy) * f1 + t * 2.0;
    float a2 = dot(d2, xy) * f2 + t * 1.5;
    vec2 slope = cos(a1) * d1 * f1 * amp1 + cos(a2) * d2 * f2 * amp2;
    return normalize(vec3(-slope.x, -slope.y, 1.0));
}
```

The water branch then mixes a deep teal with a magenta sky reflection through a Fresnel term, and adds a sharp Blinn-Phong sun specular toward the sun direction.

### Bloom + ACES tone mapping

Three FBOs and four passes:

1. Render the world into a full-resolution RGBA8 scene FBO with an attached depth renderbuffer.
2. Bright pass at half-resolution with a soft-knee threshold (`smoothstep(0.83, 0.93, luma)`).
3. Two ping-pong separable Gaussian blur passes (9-tap, sigma ≈ 2) at half-resolution. Second iteration uses 2× tap spacing for a wider bloom halo.
4. Composite to the default framebuffer: `aces((scene + bloom * 0.3) * 1.05)`.

ACES is the standard filmic tonemap:

```glsl
vec3 aces(vec3 x) {
    return clamp((x*(2.51*x + 0.03)) / (x*(2.43*x + 0.59) + 0.14), 0.0, 1.0);
}
```

### Underwater + drowning post-process

Two extra terms in the composite shader, both gated on uniforms set per-frame from the camera state:

- **`uUnderwater`** — adds a sin-based UV ripple in screen space (`uv += sin(uv.y*30 + t)*0.0035`) and tints the scene toward `vec3(0.18, 0.52, 0.55)` (alien-acid teal), with a slight darkening as a function of depth.
- **`uDrowning`** — pulsing red vignette that closes in from the edges (`smoothstep(0.25, 0.75, dist_from_centre)` ramped by an oscillating `0.6 + 0.4*sin(t*4)`).

### Skinned-mesh shader (player + mobs)

The model shader has two extra uniforms beyond the upstream version:

- **`uTint`** — per-instance colour multiplier; the hostile mob gets `[0.85, 0.45, 0.95]` so it reads as "not you" while sharing a model class.
- **`uDissolve`** — a `0..1` death-animation amount. A 3D-hash mask discards fragments below the threshold and adds a bright pink emissive edge in a thin smoothstep band just above it, producing a glowing-disintegration effect:

```glsl
float mask = hash3(floor(vWorldPos * 8.0));
if(mask < uDissolve) discard;
float edge = (1.0 - smoothstep(uDissolve, uDissolve + 0.07, mask)) * step(0.01, uDissolve);
color.rgb += vec3(1.0, 0.45, 0.9) * edge * 2.5;
```

---

## World & terrain

### Block palette

Eleven block types, all alien-themed, with three player-only spread variants for fluid flow:

| ID | Name           | Notes                                                 |
|----|----------------|-------------------------------------------------------|
| 1  | alien_grass    | top biome cover                                       |
| 2  | alien_soil     | sub-surface                                           |
| 3  | obsidian       | deep stone                                            |
| 4  | crystal        | emissive cyan                                         |
| 5  | ash            | sea-bed cover under acid pools                        |
| 6  | acid           | full-strength fluid; full Fresnel + waves            |
| 7  | glowmoss       | emissive teal, alternative biome surface              |
| 8  | fungus         | emissive magenta (decoration)                         |
| 9  | alien_wood     | tree trunks                                           |
| 10 | glow_leaves    | emissive teal-green canopies                          |
| 11 | acid_mid       | spread level 1 — visually 1/3 faded                   |
| 12 | acid_dim       | spread level 2 — visually 2/3 faded                   |
| 13 | acid_trace     | spread level 3 — nearly transparent, dies out         |

### Terrain generator

A single 16×16-cell smooth-noise field samples the surface height in the range `[28, 44]`, so every column has 28+ blocks of solid material. The acid line at z=32 fills any depression below it. Two separate 3D-noise fields then carve caves:

```js
isCave(x, y, z, height) {
    if(z < 4)            return false;        // bedrock floor
    if(z >= height - 2)  return false;        // surface buffer

    let cavern = sample3d(x/16, y/16, z/8);
    if(cavern > 0.74) return true;            // wide chambers

    let tunnel = sample3d(x/9 + 51, y/9 + 23, z/5 + 7);
    return tunnel > 0.78;                     // thin tunnels
}
```

Above-ground rock formations follow the same recipe with a region-gating 2D mask for sparseness and a tapered altitude threshold so blobs converge to a peak instead of rising as walls. The same tunnel noise then hollows them, so the formations naturally form arches and surface caves. Crystal veins inside surface rock for visual interest.

Trees are placed by a per-chunk noise threshold (≥0.955 → tree), refused on glowmoss / sub-acid columns, and meshed as a trunk column plus an oblate-spheroid canopy of glow_leaves.

### Sky

A single full-screen quad shader, no skybox texture:

- Vertical gradient: magenta horizon → indigo zenith with a teal band.
- 500-cell hashed star field with per-cell twinkle phase.
- Two moons (large teal + small magenta) with radial halos drawn additively.

---

## Hostile mob

Probably the densest single feature in the project. Subsystems:

### Navigation

`groundZ(map, x, y)` walks z=60 → 0 looking for a block where the floor is solid (non-fluid), feet/body/head are clear (3-block air column), and no fluid is in the body. `findPath(map, sx, sy, gx, gy)` does 4-connected XY-plane A* over walkable cells with a 180-node budget; replanning cadence is 0.8 s in combat states and 2.5–5 s on patrol.

### Behavior tree

Five-state FSM: `IDLE / PATROL / CHASE / ATTACK / FLEE / DEAD`. Transitions are chosen by an ML policy each frame; if the policy isn't loaded, a tabular fallback decides:

```text
hp <= 0                       → DEAD
dist > AGGRO_RANGE            → PATROL
hp / max < FLEE_HP_FRACTION   → FLEE
dist < ATTACK_RANGE           → ATTACK
otherwise                     → CHASE
```

### ML decision policy

The mob's `CHASE / FLEE / ATTACK` choice is a tiny MLP trained offline:

- **Architecture** — `3 (input) → 8 → 8 → 3 (softmax)`, ReLU on hidden layers.
- **Features** — `dist_norm = dist / aggro_range`, `hp_ratio = hp / max_hp`, `recently_hit ∈ {0, 1}`.
- **Training** — 8000 synthetic samples generated by a hand-crafted heuristic policy with bounded random noise, 600 epochs, lr=0.08 with manual SGD on `numpy`. Reaches ~97% validation accuracy.
- **Export** — weights written to `assets/mob_policy.json`. Layer matrices are stored as `[out, in]` row-major so the JS forward pass iterates rows contiguously.
- **JS runtime** — a per-frame forward pass in `src/mob_policy.js` returns the argmax action; the FSM interprets that as a CHASE / FLEE / ATTACK bias, but never overrides safety transitions like `hp <= 0 → DEAD`.

This is supervised learning rather than RL — for a 3-feature 3-action problem with clear correct answers, the MLP recovers the same boundaries a Q-learner would converge to without needing a simulation environment.

### Skeletal animation

Six-bone rig parented under one model matrix:

```
   bone 1 — head cluster (head + snout + horns)   pivot: (0, -0.3, 0)
   bone 2 — tail                                   pivot: (0,  0.45, -0.75)
   bone 3 — front-left  hip
   bone 4 — front-right hip
   bone 5 — back-left   hip
   bone 6 — back-right  hip
```

Each leg pivots around its hip joint at the top of the leg cube. The animation runs a diagonal quadruped trot — front-left + back-right swing in phase, front-right + back-left offset by π — with amplitude scaling on horizontal speed. Tail wags out of phase with the head; head bobs in both pitch and yaw. Idle wag continues at low amplitude when standing still.

### Combat & death

Player damages mob via left-click within a 25° aim cone × 6-block range. Each hit is 1 HP; the mob has 3 HP so it takes 3 clicks. The bow one-shots regardless of distance.

On death the mob drops `vel.x/y` to zero, freezes the FSM at `DEAD`, and the `uDissolve` uniform climbs from 0 → 1 over `1 / DISSOLVE_SPEED ≈ 1.7 s`. Once dissolve hits 1.0, the spawner removes the mob from the array and re-rolls the random spawn timer.

### Jumping

Two triggers, both gated on ground contact + 0.55 s cooldown:

- **Obstacle hop** — when `rest.x` or `rest.y` latches non-zero while horizontal velocity is > 0.05, indicating the mob is pushing into a wall.
- **Random hop** — `0.18 / s` chance during PATROL or CHASE for liveliness.

`vel.z` is set to `JUMP_SPEED = 7`, which clears a 1-block step under the existing `-20` gravity.

---

## Gameplay & interaction

### Player physics

Standard AABB collision (`Body` superclass) against the voxel grid via `boxmarch`. Inputs from the controller go straight to `vel`; gravity is applied each frame; rest axes latch to zero on contact so the player doesn't slide into walls or stick to the ground.

### Fluid physics

Fluid blocks (acid + the three spread variants) don't collide. While submerged: gravity is reduced from -20 to -5, drag is increased, sprint is disabled, horizontal speed is multiplied by 0.6, and `Space` becomes a continuous upward acceleration of `+30 * delta` for swimming up.

### Drowning

10-second grace period underwater. After that, lose 1 HP every 3 s while still submerged. A pulsing red vignette starts ramping in from ~6 s as a warning. Surfacing instantly resets both timers.

### Fall damage

Tracks the highest airborne `pos.z` seen since last ground contact:

```text
damage = max(0, 1 + floor((peak.z - landing.z - 4) / 2))
```

So 4–5 blocks → 1 heart, 6–7 → 2, 8–9 → 3, and so on. Spawn-fall and respawn-fall are exempt (fall tracking is disarmed until the first ground touch). Falling into acid resets the running peak so water cushions the impact.

### Bow

Held `E` advances `bowCharge` from 0 to 1 over ~0.7 s. While charging, a canvas-rendered bow appears at the bottom-centre of the screen with the string pulling back, the arrow sliding with it, and a charge bar filling. At full draw the colour shifts toward gold. Releasing `E` spawns an `Arrow` 0.6 m in front of the camera with `velocity = lookat * (18 + charge*24)` m/s.

The arrow steps physics in five substeps per frame to avoid tunneling. Each substep checks every hostile mob via a 1.4-block sphere test; a hit calls `mob.takeDamage(9999)` for guaranteed one-shot. Collision with a solid block embeds the arrow at the surface for 2 s before it despawns. Two trail particles per frame give the arrow a glowing yellow streak.

### Player-placed water flow

Slot 9 is acid. Right-click placement registers the block at level 0 in a JS `Map` keyed by `"x,y,z"`. A 130-ms tick (`tickFluids`) iterates a snapshot of the map:

```text
for each tracked fluid cell at level L:
    if L >= MAX_LEVEL: continue            # dying edge — no further spread
    if block below is air:
        push down-flow at the same level   # gravity
        continue
    for each horizontal neighbour:
        if it's air: push spread at L + 1  # capped on level
```

The `MAX_LEVEL` is 3, so flow visibly fans out from the source through three levels of progressively-faded acid blocks before stopping. The chunk shader's water branch dims the colour by `mix(1.0, 0.55, fade)` and the alpha by `mix(0.78, 0.28, fade)` based on a per-vertex fade extracted from the face id.

---

## Architecture

```
src/
├── main.js              orchestration, HUDs, frame loop, drowning + fall damage + fluid flow
├── display.js           WebGL context, requestAnimationFrame loop
├── camera.js            view + projection matrices, camera physics
├── controller.js        keyboard / mouse / pointer-lock, hotbar, bow input
├── body.js              AABB collision against the voxel grid
├── map.js               chunk store, raymarch + boxmarch, mesh worker dispatch
├── chunk.js             per-chunk shader: shadows, lights, water, fog, god rays, flashlight
├── mesher.js            classic Web Worker — greedy mesher, packed AO + emissive flag
├── generator.js         terrain noise (2D height, 3D cave + surface-rock mask, tree placement)
├── shadowmap.js         orthographic light-VP + depth FBO
├── lights.js            8-slot point-light selector + flashlight uniform pack
├── postprocessor.js     scene FBO → bright pass → ping-pong blur → ACES (+ underwater + drown)
├── particles.js         100-point ambient swarm — additive blend, life envelope
├── bursts.js            short-lived burst particles (block-break dust, arrow trails)
├── sky.js               full-screen alien sky: gradient, stars, twin moons
├── model.js             skinned-mesh shader for player + mob (tint + dissolve)
├── bone.js              skeleton joint matrix
├── arrow.js             bow projectile physics + sphere-vs-mob hit detection
├── astar.js             XY-plane A* over walkable surface cells
├── hostilemob.js        behavior tree, A*, skeletal animation, jumping, dissolve death
├── mob_policy.js        runtime forward pass for the trained MLP policy
├── mob.js               other-player Mob class (legacy multiplayer)
├── picker.js            voxel raycaster + crosshair-target wireframe
├── crosshairs.js        centre crosshair sprite
├── hotbar.js            DOM-rendered hotbar with active-slot highlight
├── debugger.js          F3 stats overlay
├── speaker.js           Web Audio output (jump sound, ambient activation)
├── server.js            optional multiplayer client (offline by default)
├── vector.js, matrix.js, math.js, buffer.js, shader.js, texture.js, blocks.js   primitives

tools/
├── gen_blocks.py        regenerate gfx/blocks.png texture atlas
└── train_mob_policy.py  train + export the mob policy MLP

assets/
└── mob_policy.json      trained weights, loaded at runtime
```

---

## Build & ML training

There is no JavaScript build — everything is loaded directly. Two Python tools are kept for asset regeneration:

```bash
# Regenerate the texture atlas (only needed if blocks.js changes faces)
python3 tools/gen_blocks.py

# Retrain the mob's MLP decision policy
python3 tools/train_mob_policy.py
# writes assets/mob_policy.json — picked up automatically next page load
```

The training script runs in ~1 second on a laptop and prints train/val accuracy at four checkpoints. Final accuracy hovers around 0.97 on the synthetic dataset; you can tweak the heuristic in `heuristic_action()` and re-run if you want different mob behaviour without touching JS.

---

## Tech stack

| Layer                  | Tech                                                                                   |
|------------------------|----------------------------------------------------------------------------------------|
| Rendering              | WebGL 1.0, GLSL ES 1.0, `WEBGL_depth_texture` extension                                |
| Application            | Vanilla JavaScript (ES modules), no framework, no bundler                              |
| Mesher                 | Classic Web Worker (greedy meshing, packed AO + emissive flag)                         |
| Offline ML             | Python 3, NumPy — exports `assets/mob_policy.json`                                     |
| Static dev server      | Python 3 `http.server` (run with `./serve.sh`)                                         |

---

## Credits

- Engine fork of [guckstift/voxel-game-js](https://github.com/guckstift/voxel-game-js) (MIT-licensed).
- Built as a 7th-semester computer graphics elective project.
