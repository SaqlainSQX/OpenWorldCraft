#!/usr/bin/env python3
"""
Generates gfx/blocks.png for OpenWorldCraft.

Output: 256x256 PNG, a 16x16 grid of 16x16-pixel tiles.
Tile index matches the `face` attribute in the chunk shader:
    texX = mod(face, 16), texY = floor(face / 16)
which means tile id N sits at column (N % 16), row (N / 16), i.e. left-to-right
then top-to-bottom.

Re-run: python3 tools/gen_blocks.py
"""

import os
import random
from PIL import Image

ATLAS_TILES = 16          # 16x16 grid of tiles
TILE_PX = 16              # each tile is 16x16 pixels
ATLAS_PX = ATLAS_TILES * TILE_PX  # 256x256
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "gfx", "blocks.png")

random.seed(42)  # deterministic

# ---------- small helpers -------------------------------------------------

def clamp8(v): return max(0, min(255, int(v)))

def jitter(rgb, amt):
    r, g, b = rgb
    d = random.randint(-amt, amt)
    return (clamp8(r + d), clamp8(g + d), clamp8(b + d))

def blend(a, b, t):
    return (clamp8(a[0] + (b[0] - a[0]) * t),
            clamp8(a[1] + (b[1] - a[1]) * t),
            clamp8(a[2] + (b[2] - a[2]) * t))

def fill(tile, color):
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(color, 8))

# ---------- per-tile painters --------------------------------------------

def paint_alien_grass_top(tile):
    base = (42, 24, 76)       # dark indigo
    glow_teal = (110, 230, 210)
    glow_magenta = (230, 90, 200)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 12))
    # scatter glow specks
    for _ in range(14):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, TILE_PX - 1)
        c = glow_teal if random.random() < 0.65 else glow_magenta
        tile.putpixel((x, y), c)
        # soft edges
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if 0 <= nx < TILE_PX and 0 <= ny < TILE_PX:
                old = tile.getpixel((nx, ny))
                tile.putpixel((nx, ny), blend(old, c, 0.35))

def paint_alien_soil(tile):
    base = (56, 36, 62)       # dark purple-brown
    fill(tile, base)
    # faint veins: darker cellular streaks
    vein = (34, 20, 42)
    for _ in range(5):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, TILE_PX - 1)
        length = random.randint(2, 4)
        dx = random.choice([-1, 0, 1])
        dy = random.choice([-1, 0, 1])
        for i in range(length):
            nx, ny = x + dx * i, y + dy * i
            if 0 <= nx < TILE_PX and 0 <= ny < TILE_PX:
                tile.putpixel((nx, ny), vein)

def paint_alien_grass_side(tile):
    soil = (56, 36, 62)
    glow_teal = (110, 230, 210)
    glow_magenta = (230, 90, 200)
    # soil base everywhere
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(soil, 10))
    # top band — teal bleed 3-4 rows deep with fade
    for y in range(0, 5):
        for x in range(TILE_PX):
            t = 1.0 - y / 5.0
            grass = jitter((42, 24, 76), 8)
            mixed = blend(tile.getpixel((x, y)), grass, t)
            tile.putpixel((x, y), mixed)
    # occasional glowing drips running down 2-5 pixels
    for _ in range(4):
        x = random.randint(0, TILE_PX - 1)
        length = random.randint(2, 5)
        c = glow_teal if random.random() < 0.7 else glow_magenta
        for y in range(length):
            if y < TILE_PX:
                old = tile.getpixel((x, y))
                tile.putpixel((x, y), blend(old, c, 0.5 * (1 - y / length)))

def paint_obsidian(tile):
    base = (18, 12, 28)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 6))
    # faint purple sheen highlights
    for _ in range(6):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, TILE_PX - 1)
        tile.putpixel((x, y), jitter((48, 24, 64), 10))

def paint_ash(tile):
    base = (78, 72, 86)       # cool dark grey
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 14))
    # granular speckles
    for _ in range(12):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, TILE_PX - 1)
        if random.random() < 0.5:
            tile.putpixel((x, y), jitter((115, 110, 125), 5))  # light
        else:
            tile.putpixel((x, y), jitter((50, 44, 60), 5))     # dark

def paint_crystal(tile):
    base = (70, 190, 220)
    highlight = (220, 250, 255)
    dark = (32, 100, 130)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 18))
    # angular highlights along diagonals
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            d = abs(x - y)
            if d < 2 and (x + y) % 3 == 0:
                tile.putpixel((x, y), highlight)
    # sharp dark fractures
    for _ in range(3):
        x0 = random.randint(0, TILE_PX - 1)
        y0 = random.randint(0, TILE_PX - 1)
        length = random.randint(3, 6)
        dx = random.choice([-1, 1])
        dy = random.choice([-1, 1])
        for i in range(length):
            nx, ny = x0 + dx * i, y0 + dy * i
            if 0 <= nx < TILE_PX and 0 <= ny < TILE_PX:
                tile.putpixel((nx, ny), dark)

def paint_glowmoss_top(tile):
    base = (80, 220, 170)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 16))
    # bright spores — near-white dots
    for _ in range(18):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, TILE_PX - 1)
        tile.putpixel((x, y), (240, 255, 230))

def paint_glowmoss_side(tile):
    soil = (56, 36, 62)
    glow = (80, 220, 170)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(soil, 10))
    # top band glows teal, fading down
    for y in range(0, 8):
        for x in range(TILE_PX):
            t = 1.0 - y / 8.0
            mixed = blend(tile.getpixel((x, y)), glow, t * 0.9)
            tile.putpixel((x, y), mixed)
    # a few bright spore dots on the top
    for _ in range(5):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, 3)
        tile.putpixel((x, y), (240, 255, 230))

def paint_fungus(tile):
    cap = (180, 60, 150)          # magenta
    stem = (210, 185, 170)        # pale pink
    # top half cap, bottom half stem
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            if y < 9:
                tile.putpixel((x, y), jitter(cap, 14))
            else:
                tile.putpixel((x, y), jitter(stem, 10))
    # bright bioluminescent dots on cap
    for _ in range(6):
        x = random.randint(0, TILE_PX - 1)
        y = random.randint(0, 8)
        tile.putpixel((x, y), (255, 220, 255))

def paint_acid(tile):
    base = (120, 230, 100)
    for x in range(TILE_PX):
        for y in range(TILE_PX):
            tile.putpixel((x, y), jitter(base, 14))
    # horizontal ripples
    for y in range(0, TILE_PX, 3):
        for x in range(TILE_PX):
            old = tile.getpixel((x, y))
            lighter = blend(old, (220, 255, 180), 0.35)
            tile.putpixel((x, y), lighter)

# ---------- atlas layout -------------------------------------------------

TILE_PAINTERS = {
    # tile_id : painter
    0:  paint_alien_grass_top,    # grass top
    1:  paint_alien_soil,         # soil / grass bottom
    2:  paint_alien_grass_side,   # grass sides
    3:  paint_obsidian,           # stone
    4:  paint_ash,                # sand equivalent
    5:  paint_crystal,            # crystal
    6:  paint_glowmoss_top,       # glowmoss top
    7:  paint_glowmoss_side,      # glowmoss sides
    8:  paint_fungus,             # fungus
    16: paint_acid,               # acid (was water)
}

def main():
    atlas = Image.new("RGBA", (ATLAS_PX, ATLAS_PX), (0, 0, 0, 0))
    for tile_id, painter in TILE_PAINTERS.items():
        tile = Image.new("RGBA", (TILE_PX, TILE_PX), (0, 0, 0, 255))
        painter(tile)
        tx = tile_id % ATLAS_TILES
        ty = tile_id // ATLAS_TILES
        atlas.paste(tile, (tx * TILE_PX, ty * TILE_PX))
    out = os.path.abspath(OUT_PATH)
    atlas.save(out)
    print(f"wrote {out}")

if __name__ == "__main__":
    main()
