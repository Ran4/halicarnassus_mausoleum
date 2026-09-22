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

## Screenshots without a window

`tools/shots.mjs` drives headless Chrome (real GPU via ANGLE) and captures a list of views:

    npm run shots      # writes the views in tools/views.example.json

URL parameters for automation: `?shot=1&pos=x,y,z&yaw=deg&pitch=deg&noao=1`.

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
