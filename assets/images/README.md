# assets/images

Reserved for bitmap assets — intentionally empty.

Everything in Frost Breakout is drawn procedurally on the `<canvas>` at runtime:

* the arctic gradient, starfield, frost lattice and distant ice ridges are
  painted once into an offscreen layer whenever the window is resized;
* ice crystals, icicles, the paddle, the ball, blocks, power-ups and every
  particle are vector/procedural draws.

That keeps the whole game inside three files (`index.html`, `style.css`,
`script.js`) plus the optional WAVs, loads instantly, and scales crisply to any
display density. Drop artwork in here only if you want to extend the game with
sprites — nothing in the current build requires it.