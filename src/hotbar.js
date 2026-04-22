import blocks from "./blocks.js";

// Count-based hotbar HUD. Reads controller.hotbar (slot -> block id),
// controller.inventory (block id -> count), and controller.selectedSlot.
// An empty slot shows only the outline; a filled slot shows the block's
// front-face tile plus a count badge in the bottom-right.

const ATLAS_URL = "gfx/blocks.png";
const ATLAS_TILES = 16;
const SLOT_SIZE = 48;
const ATLAS_SCALED = ATLAS_TILES * SLOT_SIZE;

export default class Hotbar
{
	constructor(controller)
	{
		this.controller = controller;

		this.root = document.createElement("div");
		this.root.style.cssText = [
			"position: fixed",
			"left: 50%",
			"bottom: 16px",
			"transform: translateX(-50%)",
			"display: flex",
			"gap: 4px",
			"padding: 4px",
			"background: rgba(15, 5, 25, 0.65)",
			"border: 1px solid rgba(180, 100, 220, 0.5)",
			"border-radius: 6px",
			"z-index: 100",
			"pointer-events: none",
		].join(";");

		this.slots = [];       // per-slot aggregate of DOM refs + cached state
		for(let i = 0; i < controller.hotbar.length; i++) {
			let blockId = controller.hotbar[i];
			let faces = blocks[blockId] && blocks[blockId].faces;
			let tileId = faces ? faces[1] : 0;
			let tx = tileId % ATLAS_TILES;
			let ty = Math.floor(tileId / ATLAS_TILES);

			// Outer cell: handles border / glow for selection.
			let cell = document.createElement("div");
			cell.style.cssText = [
				`width: ${SLOT_SIZE}px`,
				`height: ${SLOT_SIZE}px`,
				"border: 2px solid rgba(255,255,255,0.15)",
				"border-radius: 4px",
				"position: relative",
				"box-sizing: border-box",
				"background: rgba(0,0,0,0.35)",
			].join(";");

			// Inner icon: toggled on/off based on inventory count.
			let icon = document.createElement("div");
			icon.style.cssText = [
				"position: absolute",
				"inset: 0",
				`background-image: url("${ATLAS_URL}")`,
				`background-size: ${ATLAS_SCALED}px ${ATLAS_SCALED}px`,
				`background-position: -${tx * SLOT_SIZE}px -${ty * SLOT_SIZE}px`,
				"image-rendering: pixelated",
				"image-rendering: crisp-edges",
				"visibility: hidden",
			].join(";");

			// Slot number in top-left (always visible).
			let numLabel = document.createElement("div");
			numLabel.textContent = String(i + 1);
			numLabel.style.cssText = [
				"position: absolute",
				"top: 1px",
				"left: 3px",
				"color: rgba(255,255,255,0.85)",
				"font-family: monospace",
				"font-size: 11px",
				"text-shadow: 1px 1px 0 #000",
				"z-index: 2",
			].join(";");

			// Count badge in bottom-right (hidden when 0).
			let countLabel = document.createElement("div");
			countLabel.style.cssText = [
				"position: absolute",
				"bottom: 1px",
				"right: 3px",
				"color: #fff",
				"font-family: monospace",
				"font-size: 13px",
				"font-weight: bold",
				"text-shadow: 1px 1px 0 #000, 0 0 3px #000",
				"z-index: 2",
			].join(";");

			cell.appendChild(icon);
			cell.appendChild(numLabel);
			cell.appendChild(countLabel);
			this.root.appendChild(cell);

			this.slots.push({
				cell,
				icon,
				countLabel,
				blockId,
				lastCount: -1,
				lastSelected: null,
			});
		}
	}

	appendToBody()
	{
		document.body.appendChild(this.root);
	}

	update()
	{
		let sel = this.controller.selectedSlot;
		let inv = this.controller.inventory;
		for(let i = 0; i < this.slots.length; i++) {
			let s = this.slots[i];
			let count = inv[s.blockId] || 0;
			let isSel = i === sel;

			if(count !== s.lastCount) {
				s.lastCount = count;
				s.icon.style.visibility = count > 0 ? "visible" : "hidden";
				s.countLabel.textContent = count > 0 ? String(count) : "";
			}

			if(isSel !== s.lastSelected) {
				s.lastSelected = isSel;
				if(isSel) {
					s.cell.style.border = "2px solid rgba(255, 230, 120, 0.95)";
					s.cell.style.boxShadow = "0 0 8px rgba(255, 230, 120, 0.7)";
				}
				else {
					s.cell.style.border = "2px solid rgba(255,255,255,0.15)";
					s.cell.style.boxShadow = "none";
				}
			}
		}
	}
}
