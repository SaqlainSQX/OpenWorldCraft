#!/usr/bin/env python3
"""
Build the OpenWorldCraft project presentation as a .pptx file.

The deck follows the project brief: 14 slides, 16:9 widescreen, dark theme,
magenta + teal accents, monospace headings, code cards, ASCII diagrams.

Run from the repo root:

    pip install --break-system-packages python-pptx
    python3 tools/build_ppt.py
    # writes OpenWorldCraft.pptx
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree


# ---------- palette --------------------------------------------------------

BG_DEEP    = RGBColor(0x07, 0x02, 0x12)   # near-black indigo
BG_MID     = RGBColor(0x12, 0x05, 0x22)   # dark magenta tone
BG_PANEL   = RGBColor(0x1a, 0x07, 0x2c)   # accent panel fill
BG_CODE    = RGBColor(0x10, 0x05, 0x1a)   # code card fill
MAGENTA    = RGBColor(0xff, 0x55, 0xcc)
MAGENTA_DK = RGBColor(0xaa, 0x33, 0x88)
TEAL       = RGBColor(0x45, 0xe8, 0xc4)
TEAL_DK    = RGBColor(0x22, 0x90, 0x80)
CYAN       = RGBColor(0x5f, 0xd4, 0xff)
GOLD       = RGBColor(0xff, 0xd2, 0x66)
WHITE      = RGBColor(0xf6, 0xe4, 0xf8)
TEXT_DIM   = RGBColor(0xc8, 0xa8, 0xd8)
TEXT_MUTE  = RGBColor(0x9a, 0x86, 0xa8)

MONO  = "Consolas"
MONO2 = "Courier New"
SANS  = "Calibri"


# ---------- low-level helpers ---------------------------------------------

def slide_size(prs):
    prs.slide_width  = Inches(13.333)
    prs.slide_height = Inches(7.5)


def add_slide(prs):
    blank = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank)
    # full-bleed background
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.line.fill.background()
    bg.fill.solid()
    bg.fill.fore_color.rgb = BG_DEEP
    # subtle vertical accent on the left edge
    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.06), prs.slide_height)
    accent.line.fill.background()
    accent.fill.solid()
    accent.fill.fore_color.rgb = MAGENTA
    return slide


def add_rect(slide, x, y, w, h, fill=None, line=None, line_w=1.0):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(line_w)
    return s


def add_text(slide, x, y, w, h, text, *, size=14, color=WHITE,
             bold=False, font=SANS, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, line_spacing=1.15):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    lines = text.split("\n") if isinstance(text, str) else list(text)
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        run = p.add_run()
        run.text = ln
        run.font.name = font
        run.font.size = Pt(size)
        run.font.color.rgb = color
        run.font.bold = bold
    return tb


def add_runs(slide, x, y, w, h, runs, *, anchor=MSO_ANCHOR.TOP,
             align=PP_ALIGN.LEFT, line_spacing=1.2):
    """`runs` is a list of (text, font, size, color, bold) tuples; \n in
    text starts a new paragraph."""
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    first = True
    for text, font, size, color, bold in runs:
        for j, line in enumerate(text.split("\n")):
            if first and j == 0:
                p = tf.paragraphs[0]
            else:
                p = tf.add_paragraph()
            p.alignment = align
            p.line_spacing = line_spacing
            run = p.add_run()
            run.text = line
            run.font.name = font
            run.font.size = Pt(size)
            run.font.color.rgb = color
            run.font.bold = bold
            first = False
    return tb


def add_line(slide, x1, y1, x2, y2, *, color=TEAL, width=1.25):
    line = slide.shapes.add_connector(1, x1, y1, x2, y2)
    line.line.color.rgb = color
    line.line.width = Pt(width)
    return line


def add_arrow(slide, x1, y1, x2, y2, *, color=MAGENTA, width=2.0):
    line = slide.shapes.add_connector(1, x1, y1, x2, y2)
    line.line.color.rgb = color
    line.line.width = Pt(width)
    # add arrowhead via XML
    ln = line.line._get_or_add_ln()
    tail = etree.SubElement(ln, qn("a:tailEnd"), {"type": "triangle", "w": "med", "len": "med"})
    return line


def page_header(slide, title, subtitle=None, *, idx=None, total=14):
    add_text(slide, Inches(0.55), Inches(0.32), Inches(11.0), Inches(0.55),
             title, size=28, color=MAGENTA, bold=True, font=MONO)
    if subtitle:
        add_text(slide, Inches(0.55), Inches(0.92), Inches(11.0), Inches(0.40),
                 subtitle, size=13, color=TEXT_DIM, font=SANS)
    # title underline
    add_line(slide, Inches(0.55), Inches(1.40), Inches(12.78), Inches(1.40),
             color=TEAL, width=1.0)
    if idx is not None:
        add_text(slide, Inches(11.7), Inches(7.05), Inches(1.5), Inches(0.30),
                 f"{idx:02d} / {total:02d}", size=10, color=TEXT_MUTE,
                 font=MONO, align=PP_ALIGN.RIGHT)
    add_text(slide, Inches(0.55), Inches(7.05), Inches(8), Inches(0.30),
             "OpenWorldCraft  ·  CG semester project", size=10,
             color=TEXT_MUTE, font=MONO)


def code_card(slide, x, y, w, h, code, *, font=MONO, size=11):
    add_rect(slide, x, y, w, h, fill=BG_CODE, line=MAGENTA, line_w=1.0)
    pad = Inches(0.18)
    add_text(slide, x + pad, y + pad, w - 2 * pad, h - 2 * pad,
             code, size=size, color=TEAL, font=font, line_spacing=1.18)


def panel_card(slide, x, y, w, h, fill=BG_PANEL, line=TEAL_DK):
    add_rect(slide, x, y, w, h, fill=fill, line=line, line_w=0.75)


def feature_card(slide, x, y, w, h, glyph, title, desc):
    panel_card(slide, x, y, w, h)
    add_text(slide, x + Inches(0.12), y + Inches(0.10),
             Inches(0.55), Inches(0.40), glyph,
             size=20, color=MAGENTA, bold=True, font=MONO)
    add_text(slide, x + Inches(0.70), y + Inches(0.12),
             w - Inches(0.80), Inches(0.42), title,
             size=12, color=WHITE, bold=True, font=SANS)
    add_text(slide, x + Inches(0.18), y + Inches(0.55),
             w - Inches(0.30), h - Inches(0.65), desc,
             size=9, color=TEXT_DIM, font=SANS, line_spacing=1.18)


# ---------- slides ---------------------------------------------------------

def slide_01_title(prs):
    s = add_slide(prs)
    # large soft glow rectangle behind title (faked with semi-dark layered shape)
    glow = add_rect(s, Inches(2.2), Inches(2.4), Inches(8.9), Inches(2.0),
                    fill=BG_MID, line=None)
    add_text(s, Inches(0.0), Inches(2.5), Inches(13.33), Inches(1.6),
             "OpenWorldCraft", size=78, color=MAGENTA, bold=True,
             font=MONO, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.0), Inches(4.35), Inches(13.33), Inches(0.5),
             "An alien bioluminescent voxel world rendered in WebGL",
             size=18, color=TEXT_DIM, font=SANS, align=PP_ALIGN.CENTER)
    # tech badge row
    badges = ["WebGL 1.0", "GLSL ES", "Vanilla JS", "Web Workers", "NumPy"]
    bw, gap = Inches(1.55), Inches(0.18)
    total = len(badges) * bw + (len(badges) - 1) * gap
    bx = Inches((13.333) / 2) - total / 2
    by = Inches(5.1)
    for b in badges:
        add_rect(s, bx, by, bw, Inches(0.4), fill=BG_PANEL, line=TEAL, line_w=0.5)
        add_text(s, bx, by, bw, Inches(0.4), b, size=11, color=TEAL,
                 font=MONO, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        bx += bw + gap
    add_text(s, Inches(0.0), Inches(6.0), Inches(13.33), Inches(0.4),
             "Computer Graphics · 7th-Semester Elective Project",
             size=13, color=GOLD, font=MONO, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.0), Inches(6.5), Inches(13.33), Inches(0.4),
             "github.com/SaqlainSQX/OpenWorldCraft",
             size=10, color=TEXT_MUTE, font=MONO, align=PP_ALIGN.CENTER)


def slide_02_overview(prs):
    s = add_slide(prs)
    page_header(s, "Project Overview",
                "WebGL voxel sandbox extended into a CG-rich rendering stack",
                idx=2)
    cols = [
        ("GOAL", MAGENTA, [
            "Build a serious real-time rendering",
            "stack on top of a voxel sandbox.",
            "",
            "Theme it as an alien bioluminescent",
            "planet — visually distinct from",
            "Minecraft from the first frame.",
        ]),
        ("APPROACH", TEAL, [
            "Forked guckstift/voxel-game-js as",
            "the base engine.",
            "",
            "Extended the rendering pipeline with",
            "shadow mapping, point lights, post-",
            "processing, volumetric god rays,",
            "Gerstner-wave water, and an ML-",
            "driven hostile mob.",
        ]),
        ("SCOPE", CYAN, [
            "Pure WebGL 1.0 + GLSL ES 1.0.",
            "",
            "Vanilla JavaScript — no framework,",
            "no bundler, no build step.",
            "",
            "Classic Web Worker for chunk",
            "meshing.",
            "",
            "NumPy for offline ML training.",
        ]),
    ]
    cw = Inches(4.10)
    cx = Inches(0.55)
    cy = Inches(1.85)
    ch = Inches(5.0)
    for title, color, lines in cols:
        panel_card(s, cx, cy, cw, ch)
        add_text(s, cx + Inches(0.30), cy + Inches(0.30),
                 cw - Inches(0.6), Inches(0.5),
                 title, size=18, color=color, bold=True, font=MONO)
        add_line(s, cx + Inches(0.30), cy + Inches(0.85),
                 cx + Inches(1.6), cy + Inches(0.85), color=color, width=1.5)
        add_text(s, cx + Inches(0.30), cy + Inches(1.0),
                 cw - Inches(0.6), ch - Inches(1.2),
                 "\n".join(lines), size=12, color=TEXT_DIM, font=SANS,
                 line_spacing=1.4)
        cx += cw + Inches(0.20)


def slide_03_showreel(prs):
    s = add_slide(prs)
    page_header(s, "Feature Showreel",
                "Sixteen subsystems that ship in the build", idx=3)
    feats = [
        ("◆", "Shadow mapping",          "Orthographic sun + 1024² depth FBO"),
        ("◇", "Point lights ×8",          "Emissive blocks → uniform pack"),
        ("◈", "Player flashlight",        "Cone spotlight, toggle with F"),
        ("◉", "Volumetric god rays",      "Per-fragment shadow raymarch"),
        ("◐", "Atmospheric fog",          "Exponential, blends to sky"),
        ("≈", "Gerstner-wave water",      "Fresnel + sun specular + waves"),
        ("✦", "Bloom + ACES",             "Half-res ping-pong + tone map"),
        ("◜", "Underwater FX",            "UV ripple + teal tint pass"),
        ("◊", "Drowning vignette",        "Pulsing red ring closes in"),
        ("✶", "Procedural sky",           "Stars, twin moons, gradient"),
        ("⊛", "3D-noise caves",           "Wide caverns + thin tunnels"),
        ("⌬", "Surface formations",       "Region-gated outcrops, hollowed"),
        ("☉", "Hostile mob + ML",         "A* + behavior tree + 3-8-8-3 MLP"),
        ("➤", "Bow + arrows",             "Charged HUD, one-shot lethal"),
        ("≋", "Player water flow",        "4-level fade gradient, 7.5 Hz"),
        ("•", "Block-break dust",         "16 colour-matched particles"),
    ]
    cols, rows = 4, 4
    grid_x = Inches(0.55)
    grid_y = Inches(1.65)
    cw = Inches(3.05)
    ch = Inches(1.32)
    gap_x = Inches(0.10)
    gap_y = Inches(0.10)
    for i, (g, t, d) in enumerate(feats):
        r, c = divmod(i, cols)
        x = grid_x + c * (cw + gap_x)
        y = grid_y + r * (ch + gap_y)
        feature_card(s, x, y, cw, ch, g, t, d)


def slide_04_pipeline(prs):
    s = add_slide(prs)
    page_header(s, "Rendering Pipeline",
                "Five GPU stages, every frame, every pixel", idx=4)

    stages = [
        ("1. Shadow pass",     "Light's POV →\ndepth texture",       MAGENTA),
        ("2. Light gather",    "Top-8 emissives\n+ flashlight",      TEAL),
        ("3. Scene FBO",       "Sky · chunks ·\nmobs · particles",    CYAN),
        ("4. Bloom",           "Bright pass +\nping-pong blur ×2",   GOLD),
        ("5. ACES composite",  "Tone map + UW\n+ drowning",          MAGENTA),
    ]
    box_w = Inches(2.20)
    box_h = Inches(1.55)
    gap = Inches(0.27)
    total_w = len(stages) * box_w + (len(stages) - 1) * gap
    bx = Inches(13.333 / 2) - total_w / 2
    by = Inches(2.8)
    for i, (title, body, color) in enumerate(stages):
        add_rect(s, bx, by, box_w, box_h, fill=BG_PANEL, line=color, line_w=1.5)
        add_text(s, bx, by + Inches(0.18),
                 box_w, Inches(0.40), title, size=12,
                 color=color, bold=True, font=MONO, align=PP_ALIGN.CENTER)
        add_line(s, bx + Inches(0.4), by + Inches(0.66),
                 bx + box_w - Inches(0.4), by + Inches(0.66),
                 color=color, width=0.8)
        add_text(s, bx, by + Inches(0.78),
                 box_w, Inches(0.7), body, size=11,
                 color=TEXT_DIM, font=SANS, align=PP_ALIGN.CENTER)
        if i < len(stages) - 1:
            ax1 = bx + box_w + Inches(0.02)
            ax2 = bx + box_w + gap - Inches(0.02)
            ay = by + box_h / 2
            add_arrow(s, ax1, ay, ax2, ay, color=TEAL, width=2.0)
        bx += box_w + gap

    # bullet captions below
    captions = [
        "All offscreen buffers are RGBA8 (LDR). Bright surfaces saturate near 1.0",
        "so the bright pass still captures emissive blocks for bloom.",
        "",
        "Underwater + drowning effects piggy-back on the composite shader,",
        "so they cost a single extra branch per screen pixel.",
    ]
    add_text(s, Inches(0.55), Inches(5.2), Inches(12.2), Inches(1.7),
             "\n".join(captions), size=12, color=TEXT_DIM, font=SANS,
             line_spacing=1.5)


def slide_05_shadow(prs):
    s = add_slide(prs)
    page_header(s, "Shaders — Shadow Mapping + God Rays",
                "Two cooperating GLSL passes", idx=5)
    # left text panel
    panel_card(s, Inches(0.55), Inches(1.7), Inches(5.5), Inches(5.2))
    add_text(s, Inches(0.85), Inches(1.95), Inches(5.0), Inches(0.4),
             "SHADOW MAPPING", size=15, color=MAGENTA, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(2.45), Inches(5.0), Inches(2.5),
             "Orthographic projection from the sun's POV into a 1024² "
             "depth-only FBO via the WEBGL_depth_texture extension.\n\n"
             "The light-VP follows the player so the shadow frustum stays "
             "around the camera. A single shadow lookup with 0.004 bias; "
             "out-of-range fragments default to fully lit so there's no "
             "darkening at the shadow-map edge.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    add_text(s, Inches(0.85), Inches(5.05), Inches(5.0), Inches(0.4),
             "GOD-RAY RAYMARCH", size=15, color=TEAL, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(5.55), Inches(5.0), Inches(1.4),
             "Per-fragment screen-space raymarch from camera → fragment, "
             "4 samples in light space. Lit steps accumulate into a [0,1] "
             "factor, modulated by pow(dot(viewDir, sunDir), 3.0) so god "
             "rays only show when looking toward the sun.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    # right code card
    code = (
        "float sampleShadow() {\n"
        "    if (shadowEnabled < 0.5) return 1.0;\n"
        "    vec3 sc = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;\n"
        "    if (sc.x < 0.0 || sc.x > 1.0 ||\n"
        "        sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0)\n"
        "        return 1.0;\n"
        "    float stored = texture2D(shadowMap, sc.xy).r;\n"
        "    return sc.z - 0.004 > stored ? 0.12 : 1.0;\n"
        "}\n"
        "\n"
        "// god-ray accumulation, 4 steps:\n"
        "vec3 stepv = (vWorldPos - uCameraPos) / 4.0;\n"
        "vec3 p     = uCameraPos + stepv * 0.5;\n"
        "float lit  = 0.0;\n"
        "for (int i = 0; i < 4; i++) {\n"
        "    vec4 lp = lightVP * vec4(p, 1.0);\n"
        "    vec3 sc = lp.xyz / lp.w * 0.5 + 0.5;\n"
        "    if (sc in [0..1] && sc.z <= sampled+ε)\n"
        "        lit += 1.0;\n"
        "    p += stepv;\n"
        "}\n"
        "return (lit / 4.0) * pow(sunAlign, 3.0);"
    )
    code_card(s, Inches(6.30), Inches(1.7), Inches(6.5), Inches(5.2),
              code, size=11)


def slide_06_water_post(prs):
    s = add_slide(prs)
    page_header(s, "Shaders — Water + Post-Processing",
                "Per-fragment Gerstner waves and ACES tone-map", idx=6)
    # left: water explanation
    panel_card(s, Inches(0.55), Inches(1.7), Inches(6.0), Inches(5.2))
    add_text(s, Inches(0.85), Inches(1.95), Inches(5.5), Inches(0.4),
             "GERSTNER-WAVE WATER", size=15, color=TEAL, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(2.45), Inches(5.5), Inches(2.0),
             "Fragment-only normals — no vertex displacement — so greedy-"
             "meshed acid surfaces still ripple. Two summed sin waves whose "
             "gradient tilts the surface normal each pixel. Fresnel mixes "
             "deep-teal with magenta sky reflection; Blinn-Phong specular "
             "toward the sun adds a sharp glint.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    code_water = (
        "vec3 waterNormal(vec2 xy, float t) {\n"
        "  vec2 d1 = vec2( 1.0, 0.3); float f1=0.70, a1=0.12;\n"
        "  vec2 d2 = vec2(-0.4, 0.8); float f2=1.10, a2=0.07;\n"
        "  float p1 = dot(d1,xy)*f1 + t*2.0;\n"
        "  float p2 = dot(d2,xy)*f2 + t*1.5;\n"
        "  vec2 slope = cos(p1)*d1*f1*a1\n"
        "             + cos(p2)*d2*f2*a2;\n"
        "  return normalize(vec3(-slope.x,-slope.y,1.0));\n"
        "}"
    )
    code_card(s, Inches(0.85), Inches(4.55), Inches(5.40), Inches(2.20),
              code_water, size=11)

    # right: bloom + ACES
    panel_card(s, Inches(6.85), Inches(1.7), Inches(5.95), Inches(5.2))
    add_text(s, Inches(7.15), Inches(1.95), Inches(5.5), Inches(0.4),
             "BLOOM + ACES TONE MAP", size=15, color=GOLD, bold=True, font=MONO)
    add_text(s, Inches(7.15), Inches(2.45), Inches(5.5), Inches(1.8),
             "Render scene → bright pass at half-res with smoothstep knee → "
             "2× ping-pong Gaussian blur (9-tap, σ≈2) → composite with "
             "ACES filmic to backbuffer.\n\n"
             "Underwater + drowning vignette ride on the composite pass.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    code_aces = (
        "vec3 aces(vec3 x) {\n"
        "  return clamp(\n"
        "    (x*(2.51*x + 0.03)) /\n"
        "    (x*(2.43*x + 0.59) + 0.14),\n"
        "    0.0, 1.0);\n"
        "}\n"
        "\n"
        "vec3 hdr = (scene + bloom*0.30) * 1.05;\n"
        "gl_FragColor = vec4(aces(hdr), 1.0);"
    )
    code_card(s, Inches(7.15), Inches(4.55), Inches(5.40), Inches(2.20),
              code_aces, size=11)


def slide_07_lights(prs):
    s = add_slide(prs)
    page_header(s, "Point Lights & Player Flashlight",
                "Eight emissive sources + a directed cone", idx=7)
    # left big diagram panel
    panel_card(s, Inches(0.55), Inches(1.7), Inches(6.8), Inches(5.2))
    add_text(s, Inches(0.8), Inches(1.95), Inches(6.2), Inches(0.4),
             "LightManager pipeline (8-slot)",
             size=14, color=TEAL, bold=True, font=MONO)

    # mini-diagram: chunk grid → sort → uniform pack
    box1 = (Inches(0.85), Inches(2.6), Inches(2.0), Inches(1.0))
    box2 = (Inches(3.2),  Inches(2.6), Inches(1.7), Inches(1.0))
    box3 = (Inches(5.25), Inches(2.6), Inches(1.95),Inches(1.0))
    add_rect(s, *box1, fill=BG_PANEL, line=MAGENTA, line_w=1.0)
    add_text(s, box1[0], box1[1] + Inches(0.16), box1[2], Inches(0.3),
             "walk chunks", size=11, color=WHITE, bold=True,
             font=MONO, align=PP_ALIGN.CENTER)
    add_text(s, box1[0], box1[1] + Inches(0.50), box1[2], Inches(0.5),
             "collect emissive\nvoxels exposed to air",
             size=9, color=TEXT_DIM, font=SANS, align=PP_ALIGN.CENTER)
    add_arrow(s, box1[0]+box1[2], box1[1]+Inches(0.5),
              box2[0],            box2[1]+Inches(0.5), color=TEAL)
    add_rect(s, *box2, fill=BG_PANEL, line=MAGENTA, line_w=1.0)
    add_text(s, box2[0], box2[1] + Inches(0.16), box2[2], Inches(0.3),
             "partial sort", size=11, color=WHITE, bold=True,
             font=MONO, align=PP_ALIGN.CENTER)
    add_text(s, box2[0], box2[1] + Inches(0.50), box2[2], Inches(0.5),
             "by distance²,\nkeep closest 8",
             size=9, color=TEXT_DIM, font=SANS, align=PP_ALIGN.CENTER)
    add_arrow(s, box2[0]+box2[2], box2[1]+Inches(0.5),
              box3[0],            box3[1]+Inches(0.5), color=TEAL)
    add_rect(s, *box3, fill=BG_PANEL, line=MAGENTA, line_w=1.0)
    add_text(s, box3[0], box3[1] + Inches(0.16), box3[2], Inches(0.3),
             "uniform pack", size=11, color=WHITE, bold=True,
             font=MONO, align=PP_ALIGN.CENTER)
    add_text(s, box3[0], box3[1] + Inches(0.50), box3[2], Inches(0.5),
             "Float32Array(24)\nuploaded once / frame",
             size=9, color=TEXT_DIM, font=SANS, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.85), Inches(3.85), Inches(6.5), Inches(2.0),
             "Per-block-id colour table — crystal cyan, fungus magenta, "
             "glow_leaves teal, acid green, glowmoss aqua. Falloff: "
             "1 / (1 + 0.18·d + 0.035·d²).\n\n"
             "Chunk shader sums all 8 lights inside a single loop, gated "
             "on a brightness check so empty slots cost ~nothing.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)

    # right: flashlight panel
    panel_card(s, Inches(7.55), Inches(1.7), Inches(5.25), Inches(5.2))
    add_text(s, Inches(7.85), Inches(1.95), Inches(5), Inches(0.4),
             "PLAYER FLASHLIGHT (F)",
             size=14, color=GOLD, bold=True, font=MONO)
    add_text(s, Inches(7.85), Inches(2.45), Inches(4.7), Inches(2.4),
             "Cone spotlight sharing the LightManager's uniform path. "
             "Direction = camera lookat. Half-angle 39°, range 28 blocks. "
             "Smoothstep falloff between cone-cosine and 1.0 keeps the beam "
             "edge soft.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    code_flash = (
        "float align = -dot(Ldir, uFlashDir);\n"
        "if (align < uFlashConeCos)\n"
        "    return vec3(0.0);\n"
        "\n"
        "float cone = smoothstep(\n"
        "    uFlashConeCos, 1.0, align);\n"
        "float att = 1.0 / (1.0\n"
        "    + 0.05 * d + 0.012 * d * d);\n"
        "return uFlashColor * cone * att\n"
        "     * max(0.0, dot(Ldir, vNormal));"
    )
    code_card(s, Inches(7.85), Inches(4.55), Inches(4.7), Inches(2.20),
              code_flash, size=10.5)


def slide_08_terrain(prs):
    s = add_slide(prs)
    page_header(s, "Terrain Generation",
                "Heightmap + 3D-noise caves + above-ground rock", idx=8)
    # left: heightmap
    panel_card(s, Inches(0.55), Inches(1.7), Inches(6.0), Inches(2.5))
    add_text(s, Inches(0.85), Inches(1.95), Inches(5.5), Inches(0.4),
             "HEIGHTMAP + ACID LINE",
             size=14, color=MAGENTA, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(2.45), Inches(5.5), Inches(1.7),
             "Single 16×16-cell smooth-noise field. Surface heights "
             "land in [28, 44], so every column has 28+ blocks of "
             "solid material under it. Acid fills any depression "
             "below z=32. Trees are a per-chunk noise threshold "
             "(>0.955), refused on glowmoss / sub-acid columns.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)

    # right: caves with code
    panel_card(s, Inches(6.80), Inches(1.7), Inches(6.0), Inches(5.2))
    add_text(s, Inches(7.10), Inches(1.95), Inches(5.5), Inches(0.4),
             "CAVES (3D-NOISE CARVING)",
             size=14, color=TEAL, bold=True, font=MONO)
    add_text(s, Inches(7.10), Inches(2.45), Inches(5.5), Inches(1.0),
             "Two stacked noise thresholds — wide caverns + thin "
             "tunnels — ORed so the systems connect.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)
    code = (
        "isCave(x, y, z, height) {\n"
        "  if (z < 4)              return false;  // bedrock floor\n"
        "  if (z >= height - 2)    return false;  // surface buffer\n"
        "\n"
        "  let cavern = sample3d(x/16, y/16, z/8);\n"
        "  if (cavern > 0.74) return true;        // wide chamber\n"
        "\n"
        "  let tunnel = sample3d(x/9 + 51,\n"
        "                        y/9 + 23,\n"
        "                        z/5 + 7);\n"
        "  return tunnel > 0.78;                  // thin tunnel\n"
        "}"
    )
    code_card(s, Inches(7.10), Inches(3.55), Inches(5.4), Inches(3.2),
              code, size=11.5)

    # bottom-left: surface rocks
    panel_card(s, Inches(0.55), Inches(4.30), Inches(6.0), Inches(2.6))
    add_text(s, Inches(0.85), Inches(4.55), Inches(5.5), Inches(0.4),
             "ABOVE-GROUND ROCK FORMATIONS",
             size=14, color=CYAN, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(5.05), Inches(5.5), Inches(1.7),
             "Region-gated 2D mask gives sparse outcrop locations. "
             "Inside a region, a 3D blob mask picks rock-vs-air voxel "
             "by voxel; threshold rises with altitude so blobs taper "
             "to a peak. Same tunnel noise hollows them — the result "
             "is natural arches and walk-in surface caves.",
             size=11.5, color=TEXT_DIM, font=SANS, line_spacing=1.35)


def slide_09_mob(prs):
    s = add_slide(prs)
    page_header(s, "Hostile Mob",
                "A* navigation + behavior tree + skeletal animation", idx=9)

    # 6-bone rig diagram (centred)
    rig_x = Inches(3.7)
    rig_y = Inches(1.85)
    rig_w = Inches(5.9)
    rig_h = Inches(2.4)
    panel_card(s, rig_x, rig_y, rig_w, rig_h)
    add_text(s, rig_x, rig_y + Inches(0.15), rig_w, Inches(0.4),
             "6-BONE QUADRUPED RIG",
             size=13, color=MAGENTA, bold=True, font=MONO,
             align=PP_ALIGN.CENTER)
    rig_ascii = (
        "         (head)─bone 1                bone 2─(tail)\n"
        "             │                            │\n"
        "         ┌───┴───── BODY  (static, bone 0) ─────┴───┐\n"
        "         │                                          │\n"
        "        FL leg     FR leg     BL leg     BR leg\n"
        "        bone 3     bone 4     bone 5     bone 6\n"
        "          │          │          │          │\n"
        "        diagonal trot:  FL+BR  ⇄  FR+BL   (π apart)"
    )
    add_text(s, rig_x + Inches(0.15), rig_y + Inches(0.7),
             rig_w - Inches(0.3), rig_h - Inches(0.8),
             rig_ascii, size=10, color=TEAL, font=MONO,
             align=PP_ALIGN.LEFT, line_spacing=1.2)

    # three callout panels below
    cw = Inches(4.1)
    cy = Inches(4.6)
    ch = Inches(2.3)
    cx = Inches(0.55)
    callouts = [
        ("A* NAVIGATION", MAGENTA, [
            "groundZ() finds walkable cells:",
            "  solid floor + 3-block air column",
            "  + no fluid in feet/body/head.",
            "",
            "findPath() does 4-connected XY",
            "A* with a 180-node budget; replans",
            "every 0.8s in combat, 2.5–5s on",
            "patrol.",
        ]),
        ("BEHAVIOR TREE FSM", TEAL, [
            "States:  IDLE  PATROL  CHASE",
            "         ATTACK FLEE  DEAD",
            "",
            "Transitions chosen by an MLP",
            "policy each frame, with a tabular",
            "fallback if the JSON fails to load.",
            "",
            "ATTACK_RANGE 2.2 · AGGRO 22.",
        ]),
        ("DISSOLVE DEATH", CYAN, [
            "On HP=0 the FSM freezes at DEAD",
            "and the model shader's uDissolve",
            "ramps 0→1 over ~1.7s.",
            "",
            "3D hash mask discard with a",
            "smoothstep edge band that glows",
            "bright pink at the dissolve front.",
        ]),
    ]
    for title, color, lines in callouts:
        panel_card(s, cx, cy, cw, ch)
        add_text(s, cx + Inches(0.20), cy + Inches(0.18), cw - Inches(0.4),
                 Inches(0.4), title, size=13, color=color, bold=True,
                 font=MONO)
        add_text(s, cx + Inches(0.20), cy + Inches(0.65), cw - Inches(0.4),
                 ch - Inches(0.85), "\n".join(lines), size=10.5,
                 color=TEXT_DIM, font=SANS, line_spacing=1.4)
        cx += cw + Inches(0.10)


def slide_10_ml(prs):
    s = add_slide(prs)
    page_header(s, "ML Decision Policy",
                "A 3 → 8 → 8 → 3 MLP trained offline, run per-frame in JS", idx=10)
    # network diagram
    net_y = Inches(2.0)
    net_h = Inches(2.7)
    box_w = Inches(1.5)
    layers = [
        ("INPUT", "(3)",  ["dist_norm", "hp_ratio", "hit"], MAGENTA),
        ("DENSE 8", "ReLU", ["w₁ · X + b₁",  "ReLU"], TEAL),
        ("DENSE 8", "ReLU", ["w₂ · h₁ + b₂", "ReLU"], TEAL),
        ("DENSE 3", "Soft", ["w₃ · h₂ + b₃", "softmax"], CYAN),
        ("ACTION", "(3)",  ["chase", "flee", "attack"], GOLD),
    ]
    gap = Inches(0.4)
    total_w = len(layers) * box_w + (len(layers) - 1) * gap
    nx = Inches(13.333 / 2) - total_w / 2
    for i, (title, sub, body, color) in enumerate(layers):
        add_rect(s, nx, net_y, box_w, net_h, fill=BG_PANEL,
                 line=color, line_w=1.5)
        add_text(s, nx, net_y + Inches(0.2), box_w, Inches(0.3),
                 title, size=12, color=color, bold=True, font=MONO,
                 align=PP_ALIGN.CENTER)
        add_text(s, nx, net_y + Inches(0.55), box_w, Inches(0.3),
                 sub, size=10, color=TEXT_MUTE, font=MONO,
                 align=PP_ALIGN.CENTER)
        add_text(s, nx, net_y + Inches(1.0), box_w, net_h - Inches(1.2),
                 "\n".join(body), size=11, color=TEXT_DIM, font=MONO,
                 align=PP_ALIGN.CENTER, line_spacing=1.5)
        if i < len(layers) - 1:
            ay = net_y + net_h / 2
            add_arrow(s, nx + box_w + Inches(0.04), ay,
                      nx + box_w + gap - Inches(0.04), ay,
                      color=MAGENTA, width=2.0)
        nx += box_w + gap

    # info row below
    info_y = Inches(5.05)
    info_h = Inches(1.95)
    cw = Inches(4.10)
    cx = Inches(0.55)
    rows = [
        ("TRAINING (Python · NumPy)", MAGENTA, [
            "8000 synthetic samples generated",
            "from a hand-crafted heuristic with",
            "bounded random noise.",
            "600 epochs · batch 128 · lr 0.08",
            "Reaches ~97% val accuracy in ~1 s.",
        ]),
        ("EXPORT", TEAL, [
            "Layer matrices written as [out, in]",
            "row-major in mob_policy.json.",
            "JS forward pass iterates rows",
            "contiguously for cache locality.",
            "~2 KB on disk.",
        ]),
        ("RUNTIME (JS · per frame)", CYAN, [
            "Per-frame forward pass returns",
            "argmax action; FSM uses it as a",
            "CHASE/FLEE/ATTACK bias.",
            "Safety transitions (HP=0 → DEAD)",
            "always override.",
        ]),
    ]
    for title, color, lines in rows:
        panel_card(s, cx, info_y, cw, info_h)
        add_text(s, cx + Inches(0.18), info_y + Inches(0.12),
                 cw - Inches(0.36), Inches(0.4),
                 title, size=11, color=color, bold=True, font=MONO)
        add_text(s, cx + Inches(0.18), info_y + Inches(0.55),
                 cw - Inches(0.36), info_h - Inches(0.7),
                 "\n".join(lines), size=10, color=TEXT_DIM, font=SANS,
                 line_spacing=1.35)
        cx += cw + Inches(0.10)


def slide_11_gameplay(prs):
    s = add_slide(prs)
    page_header(s, "Gameplay Systems",
                "Three player-facing mechanics with explicit formulas", idx=11)
    cw = Inches(4.10)
    cy = Inches(1.85)
    ch = Inches(5.1)
    cx = Inches(0.55)
    blocks = [
        ("FALL DAMAGE", MAGENTA,
         "damage = max(0,\n  1 + ⌊(peak.z − landing.z − 4) / 2⌋)",
         [
             "4–5 blocks  →  1 ♥",
             "6–7 blocks  →  2 ♥",
             "8–9 blocks  →  3 ♥",
             "…",
             "Spawn-fall and respawn-fall exempt.",
             "Falling into acid resets the peak,",
             "so water cushions the impact.",
         ]),
        ("DROWNING", TEAL,
         "10 s grace, then 1 ♥ every 3 s",
         [
             "Pulsing red vignette ramps in",
             "from ~6 s as a warning.",
             "",
             "Surfacing instantly resets both",
             "the submerged timer and the",
             "damage accumulator — quick",
             "dips are free.",
         ]),
        ("BOW + ARROWS", CYAN,
         "v = lookat × (18 + charge × 24)  m/s",
         [
             "0.7 s to fully charge by holding E.",
             "Bow HUD canvas animates string",
             "pulling back, colour shifts to gold",
             "at full draw.",
             "",
             "5 substeps per frame for tunneling-",
             "free hits.  Mob touch → one-shot",
             "lethal.  Wall hit → embed for 2 s.",
         ]),
    ]
    for title, color, formula, lines in blocks:
        panel_card(s, cx, cy, cw, ch)
        add_text(s, cx + Inches(0.20), cy + Inches(0.18),
                 cw - Inches(0.40), Inches(0.4),
                 title, size=14, color=color, bold=True, font=MONO)
        add_line(s, cx + Inches(0.20), cy + Inches(0.65),
                 cx + Inches(1.5),    cy + Inches(0.65), color=color, width=1.5)
        # formula card
        add_rect(s, cx + Inches(0.20), cy + Inches(0.85),
                 cw - Inches(0.4), Inches(1.05),
                 fill=BG_CODE, line=color, line_w=0.5)
        add_text(s, cx + Inches(0.20), cy + Inches(0.85),
                 cw - Inches(0.4), Inches(1.05),
                 formula, size=12, color=color, font=MONO,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
                 line_spacing=1.3)
        add_text(s, cx + Inches(0.20), cy + Inches(2.10),
                 cw - Inches(0.4), ch - Inches(2.3),
                 "\n".join(lines), size=11, color=TEXT_DIM, font=SANS,
                 line_spacing=1.5)
        cx += cw + Inches(0.10)


def slide_12_fluid(prs):
    s = add_slide(prs)
    page_header(s, "Player-Placed Water Flow",
                "Source spreads through 4 fade levels, dies out", idx=12)

    # left: ring diagram
    panel_card(s, Inches(0.55), Inches(1.7), Inches(6.0), Inches(5.2))
    add_text(s, Inches(0.85), Inches(1.95), Inches(5.5), Inches(0.4),
             "FADE GRADIENT (top-down)",
             size=14, color=TEAL, bold=True, font=MONO)

    cx = Inches(3.55)
    cy = Inches(4.6)
    rings = [
        (Inches(2.4), MAGENTA,    "level 3 · acid_trace"),
        (Inches(1.85), MAGENTA_DK,"level 2 · acid_dim"),
        (Inches(1.30), TEAL_DK,   "level 1 · acid_mid"),
        (Inches(0.7),  TEAL,      "level 0 · acid (source)"),
    ]
    legend_y = Inches(2.55)
    for r, color, label in rings:
        s.shapes.add_shape(MSO_SHAPE.OVAL, cx - r, cy - r, r * 2, r * 2)\
            .fill.solid()
        oval = s.shapes[-1]
        oval.fill.fore_color.rgb = BG_DEEP
        oval.line.color.rgb = color
        oval.line.width = Pt(2.0)
    # legend
    for r, color, label in reversed(rings):
        # color swatch
        sw = slide_get_swatch(s, Inches(0.85), legend_y, color)
        add_text(s, Inches(1.1), legend_y - Inches(0.04),
                 Inches(4.5), Inches(0.3), label,
                 size=11, color=TEXT_DIM, font=MONO)
        legend_y += Inches(0.35)

    # right: rules
    panel_card(s, Inches(6.80), Inches(1.7), Inches(6.0), Inches(5.2))
    add_text(s, Inches(7.10), Inches(1.95), Inches(5.5), Inches(0.4),
             "TICK ALGORITHM (7.5 Hz)",
             size=14, color=MAGENTA, bold=True, font=MONO)
    rules = (
        "for each tracked fluid cell at level L:\n"
        "    if  L >= MAX_LEVEL: continue        // dying edge\n"
        "\n"
        "    if  block_below is air:\n"
        "        push down-flow at SAME level    // gravity\n"
        "        continue                        // no horiz spread\n"
        "\n"
        "    for each of the 4 horizontal neighbours:\n"
        "        if  it's air:\n"
        "            push spread at  L + 1       // capped\n"
        "\n"
        "// apply pending updates:\n"
        "// only fill if the cell isn't already a stronger source.\n"
        "// chunk shader extracts a per-vertex 'fade' from the face id\n"
        "// and dims color × mix(1.0, 0.55, fade)\n"
        "// and alpha × mix(0.78, 0.28, fade)."
    )
    code_card(s, Inches(7.10), Inches(2.50), Inches(5.40), Inches(4.30),
              rules, size=10.5)


def slide_get_swatch(slide, x, y, color):
    sw = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, Inches(0.2), Inches(0.2))
    sw.line.color.rgb = color
    sw.line.width = Pt(0.5)
    sw.fill.solid()
    sw.fill.fore_color.rgb = color
    return sw


def slide_13_arch(prs):
    s = add_slide(prs)
    page_header(s, "Architecture",
                "src/ — 28 modules, classic Web Worker for chunk meshing", idx=13)
    # left: file tree
    tree = (
        "src/\n"
        "├── main.js               orchestration · HUDs · frame loop\n"
        "├── display.js            WebGL context · rAF loop\n"
        "├── camera.js             view/projection · camera physics\n"
        "├── controller.js         input · hotbar · bow charge\n"
        "├── body.js               AABB collision over voxel grid\n"
        "├── map.js                chunk store · ray/box-march\n"
        "├── chunk.js              ★ per-chunk shader (most uniforms)\n"
        "├── mesher.js             ★ classic Worker · greedy mesher\n"
        "├── generator.js          ★ terrain noise · cave/rock masks\n"
        "├── shadowmap.js          orthographic light VP · depth FBO\n"
        "├── lights.js             8-slot point pack + flashlight\n"
        "├── postprocessor.js      bright + blur + ACES + UW + drown\n"
        "├── particles.js          ambient swarm (100 pts, additive)\n"
        "├── bursts.js             one-shot burst pool\n"
        "├── sky.js                full-screen alien sky shader\n"
        "├── model.js              ★ skinned mesh w/ tint + dissolve\n"
        "├── bone.js · arrow.js    rig joint · projectile physics\n"
        "├── astar.js              XY-plane A* on walkable cells\n"
        "├── hostilemob.js         ★ behavior tree + animation\n"
        "└── mob_policy.js         ★ MLP forward pass\n"
        "\n"
        "tools/\n"
        "├── gen_blocks.py         regenerate gfx/blocks.png\n"
        "└── train_mob_policy.py   train + export the MLP"
    )
    code_card(s, Inches(0.55), Inches(1.70), Inches(7.5), Inches(5.30),
              tree, size=10)

    # right: callouts
    cx = Inches(8.30)
    cy = Inches(1.70)
    cw = Inches(4.50)
    ch = Inches(5.30)
    panel_card(s, cx, cy, cw, ch)
    add_text(s, cx + Inches(0.25), cy + Inches(0.20), cw - Inches(0.5),
             Inches(0.35), "★  HOT FILES",
             size=13, color=GOLD, bold=True, font=MONO)
    callouts = [
        ("chunk.js",
         "All shadow / point-light / flashlight / fog / god-ray / "
         "water / fade uniforms live in one shader. Single source of truth "
         "for the look."),
        ("mesher.js",
         "Greedy meshing on a Web Worker. Packs ambient occlusion + emissive "
         "flag into the same byte (ao + 4 means 'emissive') so the vertex "
         "stride stays at 10 floats."),
        ("generator.js",
         "All world rules: surface heights, acid line, biome moss, tree "
         "placement, 3D-noise caves, surface rock formations."),
        ("hostilemob.js",
         "FSM transitions, A* replan cadence, jump triggers, head/tail/leg "
         "animation phase coupling, dissolve timing, dispatch to the policy."),
        ("mob_policy.js",
         "Tiny pure-JS MLP runtime. Loads weights once, per-frame argmax."),
    ]
    yy = cy + Inches(0.7)
    for name, body in callouts:
        add_text(s, cx + Inches(0.25), yy, Inches(2.0), Inches(0.32),
                 name, size=11, color=MAGENTA, bold=True, font=MONO)
        add_text(s, cx + Inches(0.25), yy + Inches(0.32),
                 cw - Inches(0.5), Inches(0.7),
                 body, size=9.5, color=TEXT_DIM, font=SANS,
                 line_spacing=1.3)
        yy += Inches(0.95)


def slide_14_credits(prs):
    s = add_slide(prs)
    page_header(s, "Tech Stack & Credits",
                "Everything used to build OpenWorldCraft", idx=14)
    # tech badges
    badges = [
        ("WebGL 1.0",          MAGENTA),
        ("GLSL ES 1.0",        MAGENTA),
        ("WEBGL_depth_texture",MAGENTA),
        ("Vanilla JS (ES modules)", TEAL),
        ("Classic Web Worker", TEAL),
        ("Python 3",           CYAN),
        ("NumPy",              CYAN),
        ("python-pptx",        CYAN),
    ]
    bw = Inches(2.4)
    bh = Inches(0.55)
    gap = Inches(0.20)
    cols = 4
    grid_y = Inches(1.95)
    for i, (b, color) in enumerate(badges):
        r, c = divmod(i, cols)
        x = Inches(0.55) + c * (bw + gap)
        y = grid_y + r * (bh + gap)
        add_rect(s, x, y, bw, bh, fill=BG_PANEL, line=color, line_w=1.0)
        add_text(s, x, y, bw, bh, b, size=12, color=color, bold=True,
                 font=MONO, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    # credits panel
    panel_card(s, Inches(0.55), Inches(4.40), Inches(12.20), Inches(2.30))
    add_text(s, Inches(0.85), Inches(4.65), Inches(11.5), Inches(0.4),
             "CREDITS", size=14, color=GOLD, bold=True, font=MONO)
    add_text(s, Inches(0.85), Inches(5.10), Inches(11.5), Inches(1.55),
             "Engine forked from guckstift/voxel-game-js (MIT-licensed). "
             "Every rendering technique, terrain feature, post-processing "
             "pass, and gameplay system added on top is original work for "
             "this 7th-semester CG elective.\n\n"
             "Repository:  github.com/SaqlainSQX/OpenWorldCraft",
             size=12, color=TEXT_DIM, font=SANS, line_spacing=1.5)

    # final wordmark
    add_text(s, Inches(0.0), Inches(6.95), Inches(13.33), Inches(0.4),
             "OpenWorldCraft  ·  end of presentation",
             size=14, color=MAGENTA, bold=True, font=MONO,
             align=PP_ALIGN.CENTER)


# ---------- main -----------------------------------------------------------

def main():
    prs = Presentation()
    slide_size(prs)

    slide_01_title(prs)
    slide_02_overview(prs)
    slide_03_showreel(prs)
    slide_04_pipeline(prs)
    slide_05_shadow(prs)
    slide_06_water_post(prs)
    slide_07_lights(prs)
    slide_08_terrain(prs)
    slide_09_mob(prs)
    slide_10_ml(prs)
    slide_11_gameplay(prs)
    slide_12_fluid(prs)
    slide_13_arch(prs)
    slide_14_credits(prs)

    out = os.path.join(os.path.dirname(__file__), "..", "OpenWorldCraft.pptx")
    out = os.path.abspath(out)
    prs.save(out)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
