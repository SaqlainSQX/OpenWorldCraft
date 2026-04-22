/*
	OpenWorldCraft block table.

	Each entry:
		name         - debug identifier
		faces        - [left, front, bottom, right, back, top] tile IDs into gfx/blocks.png
		transparent  - if true, adjacent faces aren't culled and it goes in the trans pass
		emissive     - (unused by current shader) flag consumed by the upcoming
		               point-light pass to know which blocks cast local light

	IMPORTANT: src/mesher.js runs in a classic worker and keeps its own
	inlined copy of this table. Update both when editing.
*/

export default [
	{ name: "air",         transparent: true },
	{ name: "alien_grass", faces: [2, 2, 1, 2, 2, 0] },
	{ name: "alien_soil",  faces: [1, 1, 1, 1, 1, 1] },
	{ name: "obsidian",    faces: [3, 3, 3, 3, 3, 3] },
	{ name: "crystal",     faces: [5, 5, 5, 5, 5, 5], emissive: true },
	{ name: "ash",         faces: [4, 4, 4, 4, 4, 4] },
	{ name: "acid",        faces: [16,16,16,16,16,16], transparent: true, emissive: true },
	{ name: "glowmoss",    faces: [7, 7, 1, 7, 7, 6], emissive: true },
	{ name: "fungus",      faces: [8, 8, 8, 8, 8, 8], emissive: true },
	{ name: "alien_wood",  faces: [9, 9,10, 9, 9,10] },
	{ name: "glow_leaves", faces: [11,11,11,11,11,11], transparent: true, emissive: true },
];
