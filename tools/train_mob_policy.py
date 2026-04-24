#!/usr/bin/env python3
"""
Train the hostile-mob action policy.

Small 3-input / 3-output MLP trained by supervised learning on synthetic
state-action pairs generated from a hand-crafted "sensible" policy with some
noise. Saves weights to assets/mob_policy.json for the JS runtime to load.

Features (all normalised to [0, 1]):
    dist_norm       — distance to player / aggro range
    hp_ratio        — current hp / max hp
    recently_hit    — 0 or 1, whether the mob was recently attacked

Actions:
    0 = CHASE
    1 = FLEE
    2 = ATTACK

Why supervised rather than RL: for a 3-feature, 3-action problem with clear
"correct" behaviour, the model learns the boundaries a real Q-learner would
converge to — in ~1 second of training on a laptop, without a simulation
environment. The point of this file is to demonstrate an ML-backed decision
path; complexity isn't what gets the marks.

Run:
    python3 tools/train_mob_policy.py
"""

import json
import os
import numpy as np

np.random.seed(42)

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")
OUT_PATH   = os.path.join(ASSETS_DIR, "mob_policy.json")


# ---------- Heuristic used to generate training labels ---------------------

def heuristic_action(dist, hp, hit):
    # Low HP — always flee.
    if hp < 0.3:
        return 1
    # Recently hit and not full — lean toward flee.
    if hit > 0.5 and hp < 0.6:
        # A bit of randomness so the net isn't deterministic near the edge.
        return 1 if np.random.rand() < 0.7 else 0
    # In striking distance — attack.
    if dist < 0.12:
        return 2
    # Otherwise close the gap.
    return 0


def gen_data(n):
    dist = np.random.rand(n).astype(np.float32)
    hp   = np.random.rand(n).astype(np.float32)
    hit  = (np.random.rand(n) < 0.3).astype(np.float32)
    X = np.stack([dist, hp, hit], axis=1)
    y = np.array([heuristic_action(*row) for row in X], dtype=np.int64)
    return X, y


# ---------- Tiny numpy MLP -------------------------------------------------

class MLP:
    def __init__(self, sizes):
        self.W = []
        self.b = []
        for i in range(len(sizes) - 1):
            # He initialisation for ReLU layers.
            w = np.random.randn(sizes[i], sizes[i + 1]).astype(np.float32) * np.sqrt(2 / sizes[i])
            self.W.append(w)
            self.b.append(np.zeros(sizes[i + 1], dtype=np.float32))

    def forward(self, X):
        self.cache = [X]
        a = X
        for i in range(len(self.W)):
            z = a @ self.W[i] + self.b[i]
            if i < len(self.W) - 1:
                a = np.maximum(0, z)
            else:
                # Softmax final.
                z = z - z.max(axis=1, keepdims=True)
                e = np.exp(z)
                a = e / e.sum(axis=1, keepdims=True)
            self.cache.append(a)
        return a

    def backward(self, Y, lr):
        m = Y.shape[0]
        # Softmax + cross-entropy: dL/dz_out = (y_hat - y) / m
        delta = (self.cache[-1] - Y) / m
        for i in reversed(range(len(self.W))):
            a_prev = self.cache[i]
            dW = a_prev.T @ delta
            db = delta.sum(axis=0)
            if i > 0:
                # ReLU backward uses the *pre-activation* mask — but since
                # ReLU(z) = a, the mask (a > 0) is equivalent here.
                delta = (delta @ self.W[i].T) * (self.cache[i] > 0).astype(np.float32)
            self.W[i] -= lr * dW
            self.b[i] -= lr * db


def one_hot(y, k):
    h = np.zeros((len(y), k), dtype=np.float32)
    h[np.arange(len(y)), y] = 1.0
    return h


def main():
    X, y = gen_data(8000)
    Y = one_hot(y, 3)
    Xv, yv = gen_data(2000)

    net = MLP([3, 8, 8, 3])

    batch = 128
    for epoch in range(600):
        perm = np.random.permutation(len(X))
        Xs, Ys = X[perm], Y[perm]
        for i in range(0, len(X), batch):
            net.forward(Xs[i:i + batch])
            net.backward(Ys[i:i + batch], lr=0.08)

        if epoch % 100 == 0 or epoch == 599:
            train_acc = (net.forward(X).argmax(1) == y).mean()
            val_acc   = (net.forward(Xv).argmax(1) == yv).mean()
            print(f"epoch {epoch:4d}  train={train_acc:.3f}  val={val_acc:.3f}")

    # Export: for each layer, W is stored as [out, in] (row = output neuron)
    # so the JS forward pass can iterate rows contiguously.
    layers = []
    for i, (w, b) in enumerate(zip(net.W, net.b)):
        layers.append({
            "W":          w.T.tolist(),
            "b":          b.tolist(),
            "activation": "relu" if i < len(net.W) - 1 else "softmax",
        })

    payload = {
        "inputSize":  3,
        "outputSize": 3,
        "actions":    ["chase", "flee", "attack"],
        "features":   ["dist_norm", "hp_ratio", "recently_hit"],
        "layers":     layers,
    }

    os.makedirs(ASSETS_DIR, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"saved {OUT_PATH}")


if __name__ == "__main__":
    main()
