# assets/sounds

Optional 16-bit PCM WAV sound effects, generated from scratch with
[`tools/generate-sounds.mjs`](../tools/generate-sounds.mjs).

| File           | Trigger                                    |
| -------------- | ------------------------------------------ |
| `launch.wav`   | ball launches from the paddle              |
| `paddle.wav`   | ball hits the frost paddle                 |
| `wall.wav`     | ball hits an arena wall                    |
| `bounce.wav`   | ball hits a block that survives the impact |
| `brick.wav`    | ice block shatters                         |
| `powerup.wav`  | power-up collected                         |
| `shield.wav`   | frost shield raised / absorbed             |
| `level.wav`    | level cleared                              |
| `life.wav`     | a life is lost                             |
| `gameover.wav` | run finished                               |

## You do not need these files

`script.js` ships a complete WebAudio synthesiser, so the game makes the exact
same sounds even with this folder deleted — useful if you deploy over
`file://`, where browsers block `fetch()` of local files.

Whenever these WAVs **are** reachable (serve the folder over HTTP), the audio
engine transparently prefers them and skips the synthesis path.

Regenerate at any time:

```bash
node tools/generate-sounds.mjs
```