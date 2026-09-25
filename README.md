# The Mausoleum at Halicarnassus — c. 350 BC

A walkable three.js reconstruction of the tomb of Mausolus at its peak, standing in its
walled temenos above the city of Halicarnassus and the harbour.

## Run

Modules and textures need an HTTP server (file:// will not work):

    npm start          # serves on http://127.0.0.1:8787
    # or: python3 -m http.server 8787

Open http://127.0.0.1:8787 and click to enter. Needs WebGL2 with hardware acceleration.

## Controls

| key            | action                                         |
|----------------|------------------------------------------------|
| W A S D        | walk                                           |
| mouse          | look                                           |
| Shift          | run                                            |
| Space          | jump                                           |
| F              | toggle flying (E / Q or Space / Ctrl = up/down)|
| O              | toggle ambient occlusion (GTAO)                |
| M              | sound on / off                                 |
| T              | subtitles for what people say                  |
| Esc            | release the mouse                              |

You spawn at the east propylon of the precinct. The steps of the krepis are walkable; the
south stair leads down to the broad street and the town. The city, agora, harbour,
theatre, Temple of Ares and the palace on Zephyrion are all reachable on foot or by flying.

## The reconstruction

Follows the Jeppesen / Waywell reconstructions, measurements in metres:

- three krepis steps, then a three-tiered podium (38.4 × 32.5 m at the foot, 20 m high)
  with life-size, heroic and colossal statues on the ledges and two painted relief friezes
  (Amazonomachy at the top, a second frieze below);
- a pteron of 36 Ionic columns (11 × 9, 9.6 m high, 24 flutes, volute capitals with
  egg-and-dart echinus), colossal dynastic portraits between the columns, a coffered
  ceiling and the sealed cella with bronze doors;
- an Ionic entablature with dentils and a palmette sima, 57 lions on the roof edge;
- a pyramid of 24 steps and, at 45 m, the marble quadriga with Mausolus and Artemisia.

Around it: the 242 × 105 m paved temenos with peribolos wall, east propylon, altar,
honorific statues and cypresses; the Hippodamian town on the slope; the platea, agora
with three stoas, quay, moles and ships; the theatre on the hill, the Temple of Ares on
its terrace, the palace on the east promontory and the circuit wall on the ridges.

## Wear and weather

The town is lived in rather than new. Every house has an age (`houseWear()` in `src/city.js`: most are kept up,
better on the platea and near the precinct and shabbier out towards the walls and the harbour, a few freshly
limewashed and a few neglected). The walls and roofs show it through a per-vertex `weather` attribute that
`src/weather/walls.js` and `src/weather/roofs.js` read in the shader:

- **walls**: splash and rising damp along the foot, with a tide mark; rain streaks under the eaves; limewash
  gone yellow-grey in blotches, and old repairs in a different tone. On older houses the walls crack and the
  plaster falls away (low down above all) to show the mud brick beneath. Some houses were never whitewashed and
  show bare clay plaster.
- **roofs**: tile-to-tile colour, replaced tiles, lichen and grime, and on neglected roofs broken or missing tiles.
- **doors**: plank leaves, oiled or painted on kept houses and silver-grey on the rest.

## The living world

`src/life/` puts life on top of the built town, one module each (`?life=birds,ships` loads only those, `?life=0` none):

- **wind** (`wind.js`) — one breeze from the west-north-west, with gusts you can watch travel across the land: the
  olives, pines, plane trees and cypresses sway with it (a cypress bends like a flame; the shadows sway too), the leaves
  flutter and glitter, the agora's awnings and sails billow. Butterflies over the gardens and orchards, dust and pollen
  in the sunlight.
- **birds** (`birds.js`) — swallows darting over the roofs and skimming the squares, yellow-legged gulls circling
  the harbour, floating in the basin and standing on the moles, pigeons and sparrows pecking on the temenos, the agora
  and the platea that burst up when you walk at them and land again further off, kestrels hovering over the slopes.
- **ships** (`ships.js`) — a trireme under oars (170 oars in three banks, in stroke) patrolling the bay and rowing in
  to the royal shipsheds, merchantmen whose square sails belly and luff with the gusts, fishing boats rowing along the
  shore or hauling nets, all heaving on the swell with wakes behind them.
- **animals** (`fauna.js`) — street dogs trotting, sniffing, lying in the shade, trailing passers-by (one may follow
  you; guard dogs bark at you from their doors), hens and roosters scratching at the poultry stalls and in the yards,
  belled herds of sheep and goats grazing beyond the walls, strings of pack donkeys on the roads.
- **hearths** (`hearths.js`) — thin smoke from kitchen hearths and bread ovens all over the town drifting down-wind,
  ovens glowing in the courtyards, sailors' cooking fires on the quay, washing swinging on the lines.
- **sound** (`audio.js`, `synth.js`) — everything you hear is synthesized at load in a Web Worker, no sound files: wind
  that swells with the gusts and grows on the heights, surf on the open shore and water slapping the quay, cicadas in
  the country, sparrows in the eaves, the murmur of the crowd where people stand thick. People talk: a formant
  synthesizer speaks transliterated Attic/Ionic Greek (aspirated stops, trilled *r*, a pitch accent on every word).
  Hammers, chisels and adzes sound on the frame the swing lands. A lyre player sits in the agora, an aulos plays at the
  altar, and a chorus rehearses the parodos of the *Bacchae* in the theatre. Everything above has its voice — gulls,
  pigeons, barking dogs, goat bells, a cock crowing, the splash of the trireme's oars and the call of the stroke,
  crackling ovens, washing snapping in a gust — and your sandals sound on paving or earth. All of it placed in 3D
  (HRTF) with distance absorption.
- **overheard talk** (`chatter.js`) — stallholders cry their wares in Greek, with the sense beneath; knots of talkers
  gossip about what Halicarnassus had on its mind around 350 BC (Artemisia's capture of Rhodes and Demosthenes' speech
  about it, the orators' contest Theopompus won, the four sculptors still at work on the tomb, Artaxerxes' Egyptian
  war, the Salmakis spring); an orator declaims; passers-by greet the stranger. The speaker gestures and turns to you.

## Screenshots without a window

`tools/shots.mjs` drives headless Chrome (real GPU via ANGLE) and captures a list of views:

    npm run shots      # writes the views in tools/views.example.json

URL parameters for automation: `?shot=1&pos=x,y,z&yaw=deg&pitch=deg&noao=1`.

`tools/listen.mjs` does the same for sound: it records the scene's mix at a list of spots to `.webm` files
(`node tools/listen.mjs spots.json`, spots `{name, pos, yaw, pitch, sec}`), for checking levels and spectrograms.

## Credits

Textures: [Poly Haven](https://polyhaven.com) (CC0). Water normals: three.js examples (MIT,
notice [below](#license)). Everything else is procedural (marble, friezes, coffers, foliage,
clouds) and generated at load time.

## Screenshots

![approach](screenshots/approach.png)
![pteron](screenshots/pteron.png)
![harbour](screenshots/harbour.png)

## License

The code is MIT-licensed, see [LICENSE](LICENSE). The Poly Haven textures are CC0 (public
domain).

`textures/waternormals.jpg` comes from the
[three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures) and is
used under their MIT License:

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
