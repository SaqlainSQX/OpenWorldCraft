import blocks from "./blocks.js";

// Renders a bottom-centre hotbar HUD from the controller's hotbar+selectedSlot
// fields. Non-interactive DOM; input still flows through the controller.

const ATLAS_URL = "gfx/blocks.png";
const ATLAS_TILES = 16;                 // 16x16 tile grid in the atlas
const SLOT_SIZE = 48;                   // px, display size of each slot
const ATLAS_SCALED = ATLAS_TILES * SLOT_SIZE;

export default class Hotbar
{
	constructor(controller)
	{
		this.controller = controller;
		this.lastSelected = -1;

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

		this.slotDivs = [];
		for(let i = 0; i < controller.hotbar.length; i++) {
			let blockId = controller.hotbar[i];
			// Show the "front" face (index 1) — nicer than the top for grass etc.
			let faces = blocks[blockId] && blocks[blockId].faces;
			let tileId = faces ? faces[1] : 0;
			let tx = tileId % ATLAS_TILES;
			let ty = Math.floor(tileId / ATLAS_TILES);

			let slot = document.createElement("div");
			slot.style.cssText = [
				`width: ${SLOT_SIZE}px`,
				`height: ${SLOT_SIZE}px`,
				`background-image: url("${ATLAS_URL}")`,
				`background-size: ${ATLAS_SCALED}px ${ATLAS_SCALED}px`,
				`background-position: -${tx * SLOT_SIZE}px -${ty * SLOT_SIZE}px`,
				"image-rendering: pixelated",
				"image-rendering: crisp-edges",
				"border: 2px solid rgba(255,255,255,0.15)",
				"border-radius: 4px",
				"position: relative",
				"box-sizing: border-box",
			].join(";");

			let label = document.createElement("div");
			label.textContent = String(i + 1);
			label.style.cssText = [
				"position: absolute",
				"top: 1px",
				"left: 3px",
				"color: #fff",
				"font-family: monospace",
				"font-size: 11px",
				"text-shadow: 1px 1px 0 #000",
			].join(";");
			slot.appendChild(label);

			this.root.appendChild(slot);
			this.slotDivs.push(slot);
		}
	}

	appendToBody()
	{
		document.body.appendChild(this.root);
	}

	update()
	{
		let sel = this.controller.selectedSlot;
		if(sel === this.lastSelected) return;
		this.lastSelected = sel;

		for(let i = 0; i < this.slotDivs.length; i++) {
			if(i === sel) {
				this.slotDivs[i].style.border = "2px solid rgba(255, 230, 120, 0.95)";
				this.slotDivs[i].style.boxShadow = "0 0 8px rgba(255, 230, 120, 0.7)";
			}
			else {
				this.slotDivs[i].style.border = "2px solid rgba(255,255,255,0.15)";
				this.slotDivs[i].style.boxShadow = "none";
			}
		}
	}
}
