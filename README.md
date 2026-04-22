# OpenWorldCraft

A WebGL voxel sandbox with an **alien bioluminescent planet** theme, built as a computer graphics semester project. Based on the [guckstift/voxel-game-js](https://github.com/guckstift/voxel-game-js) engine, with the rendering pipeline extended to showcase classic computer graphics techniques.

## Run locally

```bash
./serve.sh
# then open http://localhost:8000 in a Chromium-based browser
```

Requires only `python3` for the static dev server.

## Controls

- **Mouse click** — lock pointer / look around
- **W / A / S / D** — move
- **Space** — jump
- **Left click** — break block
- **F3** — debug overlay
- **Esc** — release pointer

## Planned CG features

- [ ] Alien bioluminescent block palette
- [ ] Alien sky shader (two moons, stars, gradient)
- [ ] Shadow mapping (directional sun)
- [ ] Emissive blocks with dynamic point lights
- [ ] Volumetric fog / god rays
- [ ] Post-processing stack (bloom + tone mapping)
- [ ] Gerstner wave water with reflection/refraction
- [ ] Particle systems (spores, fireflies)
- [ ] Hostile mob with skeletal animation and dissolve-shader death
