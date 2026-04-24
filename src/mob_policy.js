// Runtime inference for the hostile-mob policy MLP.
//
// Loads the weights exported by tools/train_mob_policy.py and exposes a
// function that maps a feature vector to an action index. The network is
// tiny (3 → 8 → 8 → 3) so a per-frame forward pass is essentially free.

let model = null;
let loadPromise = null;

// Load weights once. Subsequent calls return the same promise.
export function loadMobPolicy(url = "assets/mob_policy.json")
{
	if(model) return Promise.resolve(model);
	if(loadPromise) return loadPromise;
	loadPromise = fetch(url)
		.then(r => r.json())
		.then(j => {
			// Cache typed arrays for faster per-frame work.
			let layers = j.layers.map(layer => ({
				W: layer.W.map(row => new Float32Array(row)),
				b: new Float32Array(layer.b),
				activation: layer.activation,
			}));
			model = {
				inputSize:  j.inputSize,
				outputSize: j.outputSize,
				actions:    j.actions,
				features:   j.features,
				layers,
			};
			return model;
		})
		.catch(err => {
			console.warn("[mob_policy] failed to load, falling back to rule-based:", err);
			model = null;
			return null;
		});
	return loadPromise;
}

// Forward pass through the loaded MLP. Returns action index (argmax of
// softmax), or -1 if the policy isn't loaded yet.
export function predictAction(features)
{
	if(!model) return -1;
	let a = features;
	for(let li = 0; li < model.layers.length; li++) {
		let layer = model.layers[li];
		let out = new Float32Array(layer.b.length);
		// out[i] = b[i] + sum_j W[i][j] * a[j]
		for(let i = 0; i < out.length; i++) {
			let s = layer.b[i];
			let row = layer.W[i];
			for(let j = 0; j < row.length; j++) s += row[j] * a[j];
			out[i] = s;
		}
		if(layer.activation === "relu") {
			for(let i = 0; i < out.length; i++) if(out[i] < 0) out[i] = 0;
		}
		else if(layer.activation === "softmax") {
			let max = out[0];
			for(let i = 1; i < out.length; i++) if(out[i] > max) max = out[i];
			let sum = 0;
			for(let i = 0; i < out.length; i++) {
				out[i] = Math.exp(out[i] - max);
				sum += out[i];
			}
			for(let i = 0; i < out.length; i++) out[i] /= sum;
		}
		a = out;
	}
	let best = 0, bestV = a[0];
	for(let i = 1; i < a.length; i++) if(a[i] > bestV) { bestV = a[i]; best = i; }
	return best;
}
