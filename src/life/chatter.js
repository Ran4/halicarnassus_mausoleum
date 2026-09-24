// Overheard: what the people near you are saying, as subtitles — and, through audio.js, aloud in Greek.
//
// Walk close to a stall and its keeper cries the wares (the Greek call is spoken and shown with its sense); pass a knot of
// talkers and you catch a line of their gossip, sometimes the reply; an orator declaims; a curious passer-by greets the
// stranger; a mason swears at a block. What they talk about is what Halicarnassus had on its mind around 351–350 BC:
// Mausolus dead three years, Artemisia two, their tomb still ringing with the chisels of Scopas, Bryaxis, Timotheus and
// Leochares, who (Pliny says) stayed on to finish it for their own glory; Idrieus and Ada ruling; Artemisia's capture of
// Rhodes and Demosthenes' speech about it in Athens; the funeral contest of orators Theopompus won; Artaxerxes III
// gathering ships for Egypt; the Salmakis spring; Herodotus, the town's own; Zeus of Labraunda and his double axe.
//
// T toggles the subtitles; ?captions=0 hides them (and ?shot=1 runs show them only with ?captions=1). The line goes out as ctx.emit('speech', …) for the audio to voice.
import { inTerrace } from '../terrain.js';
import { insideWalls } from '../city.js';
import { rng } from '../util.js';

// ---------- the vendors' cries: [label, [greek, english], …], chosen by the note of the stall they keep ----------
const WARES = [
  [/fish/, 'a fishmonger', [['ikhthyes, ikhthyes! thynnos kalos!', 'Fish! Fresh fish! Tunny off the Knidian banks — look at the eye on it!'], ['kestreis, mainides! ikhthyes!', 'Grey mullet, sprats, a fine bream — caught at dawn off Kos!'], ['thynnos! drakhmēs ho kephalos!', 'Tunny! A whole head for a drachma — who else will sell you that?']]],
  [/bread|bakery/, 'a baker', [['artoi thermoi! artoi!', 'Hot loaves! Barley cakes, wheat loaves, still warm from the oven!'], ['artoi katharoi, obolou!', 'White bread, an obol a loaf — honest weight, ask the agoranomos!']]],
  [/produce/, 'a fruit-seller', [['syka, syka glykea!', 'Figs! Sweet figs from the Pedasa hills! Olives! Cucumbers!'], ['sikyoi, prasa, elaai!', 'Leeks, cucumbers, black olives — and the first grapes, taste one!'], ['mēla, rhoiai!', 'Apples! Pomegranates! Almonds by the handful!']]],
  [/oil/, 'an oil merchant', [['elaion kalon, elaion!', 'Oil! First pressing, clear as honey — dip your bread, friend, taste it!'], ['elaion! kotylē obolou!', 'Oil by the kotyle — for your lamp, your pan, your skin after the gymnasium!']]],
  [/wine/, 'a wine-seller', [['oinos Khios! oinos Lesbios!', 'Chian wine! Lesbian wine! And our own from the hills, for half the price!'], ['oinos glykys!', 'Sweet wine, strong wine — mix it three to one and it still sings!']]],
  [/pottery/, 'a potter', [['khytrai, lēkythoi, kylikes!', 'Cooking pots! Oil flasks! Drinking cups — Athenian black-glaze, the real thing!'], ['lykhnoi, lykhnoi!', 'Lamps! Two nozzles, three nozzles — light your house like a palace!']]],
  [/garland/, 'a garland-seller', [['stephanoi, stephanoi!', 'Garlands! Myrtle and violets — for the gods, for the feast, for your sweetheart!']]],
  [/spice/, 'a spice-dealer', [['libanōtos, smyrna!', 'Frankincense from Arabia! Myrrh, cinnamon — and silphium from Cyrene!']]],
  [/grain/, 'a grain-dealer', [['krithai, pyroi!', 'Barley, wheat, by the medimnos or the choinix — honest measure!'], ['pyros Aigyptios!', 'Egyptian wheat, just landed! Buy now — the price only climbs!']]],
  [/dairy/, 'a cheese-seller', [['tyros! tyros aigeios!', 'Goat’s cheese, pressed this morning! Milk, fresh milk!']]],
  [/leather/, 'a cobbler', [['hypodēmata, krēpides!', 'Sandals! Road boots! Soles that will outlast your journey!']]],
  [/bronze/, 'a bronze-seller', [['khalkōmata!', 'Bronze! Mirrors, strigils, pins — a lamp for your household shrine!']]],
  [/textile/, 'a cloth-merchant', [['himatia, khitōnes!', 'Milesian wool! Egyptian linen! Feel it — go on, feel it!'], ['porphyra!', 'Purple-dyed, from our own murex — fit for the satrap’s wife!']]],
  [/rope/, 'a rope-maker', [['skhoinia!', 'Rope! Hemp and papyrus — for your boat, your well, your mule!']]],
  [/amphora/, 'a jar-seller', [['amphoreis!', 'Amphorae, empty and sound! Rhodian, Knidian, Koan — stamped and sealed!']]],
  [/basket/, 'a basket-weaver', [['kana, phormoi!', 'Baskets! Rush mats! A basket for your figs, a mat for your floor!']]],
  [/chicken/, 'a poultry-seller', [['ornithes! ōa!', 'Hens! Eggs! A cockerel for Asklepios, sir?']]],
  [/money/, 'a money-changer', [['allagē, allagē!', 'Change! Athenian owls, Persian darics, Rhodian roses — fair rates!'], ['argyrion Karikon!', 'Hekatomnid silver, Zeus of Labraunda on every coin — good anywhere from Miletus to Cyprus!']]],
  [/barber/, 'a barber', [['keiresthai, ō polita?', 'A trim, citizen? And all the news of the town thrown in for free.']]],
  [/scribe/, 'a scribe', [['grammata grapho!', 'Letters written! Contracts drawn! Petitions to the satrap, in fine Ionic hand!']]],
  [/water/, 'a water-seller', [['hydōr psykhron!', 'Cold water! Cold from the spring!']]],
];
// ---------- gossip, by where you are: a line, or [line, reply] ----------
const TALK = {
  temenos: [
    ['They say Scopas himself carved the east side.', 'And Leochares the west — you can tell by the horses.'],
    ['Artemisia never lived to see it finished. The sculptors stayed on anyway.', 'For their own glory, they say. And the fees, I’d wager.'],
    'Pytheos wrote a whole book about this building. A book! About a tomb!',
    ['My cousin hauled marble for it from Proconnesus.', 'Your cousin hauled everything, to hear him tell it.'],
    ['Is it true the queen drank his ashes in her wine?', 'Every day, till she followed him. Two years, and not a day more.'],
    'The Great King himself has no tomb like this.',
    ['Bryaxis the north side, Timotheus the south. Four masters, four sides.', 'And every one of them swears his side is the finest.'],
    ['My boy counted the lions on the roof.', 'Fifty-six, he says. Or fifty-seven — he fell asleep at the corner.'],
    'When they sacrifice at the altar you can smell the meat down at the harbour.',
    'Idrieus will lie in here too, one day. Ada beside him, if the gods are kind.',
    ['Look at the chariot up there — you’d think the horses would bolt.', 'Mausolus himself, with the reins. A hundred cubits up, if it’s a finger.'],
    'Hold your voice down. This is a holy place.',
  ],
  agora: [
    ['Theopompus won the contest at the funeral games, did you hear?', 'Of course he won. Isocrates’ own pupil — he praised Mausolus to the stars.'],
    ['Barley’s gone up again. Three obols the choinix!', 'It’s the fleet. Idrieus buys everything that floats and everything that grows.'],
    ['Demosthenes made a speech in Athens — about setting Rhodes free of us Carians.', 'Let the Athenians come and try. Artemisia took Rhodes in a day.'],
    ['Remember how the queen fooled the Rhodian fleet?', 'Let them into the secret harbour, took their ships, and sailed them home wreathed in laurel. The fools opened their own gates!'],
    'The agoranomos fined the fishmonger again. Watered his fish to make it look fresh.',
    ['My brother-in-law is back from Naucratis. Says the Egyptians worship cats.', 'Cats! And they call us barbarians.'],
    ['Don’t drink from the Salmakis, lad. They say it makes men soft.', 'Then why does your wife send you there every morning?'],
    ['Herodotus was from here, you know. My grandfather heard him read.', 'Your grandfather heard everything.'],
    'The Persian King wants ships for Egypt again. Our ships, our rowers, his war.',
    ['They’re putting on Euripides at the theatre for the festival.', 'The Bacchae? Again?'],
    'The Mylasa road is full of pilgrims going up to Labraunda for the feast of Zeus.',
    'I sold the whole catch before the third hour. It’s the builders — they eat like horses.',
    ['Two and a half drachmas a day for a mason? They’re robbing the treasury.', 'The treasury can afford it. Mausolus left it fuller than the sea.'],
    'Isocrates is past eighty and still writing speeches nobody will ever deliver.',
    ['A Lycian was asking for you at the bank.', 'Tell him I’ve gone to Kos.'],
  ],
  harbour: [
    'Wind’s from the north-west. The grain ships from Egypt will be late.',
    'Careful with that jar — it’s Chian. It’s worth more than you are.',
    ['Pirates off Samos again. Two merchantmen taken last month.', 'Then the queen’s triremes should earn their bread.'],
    'You can row from the palace straight into the secret harbour and nobody in town sees you come or go.',
    'Stow the marble low and the wine on top. Who taught you to load a hold?',
    ['Phoenicians in port.', 'Count your change twice.'],
    'Best tunny run in years. Salted, it’ll go to Athens and come back as silver.',
    ['Rhodes by tomorrow, if the wind holds.', 'It won’t. It never does.'],
    'The trireme came in from Kos at dawn. Nobody’s saying what she carried.',
    'Another block from Proconnesus for the tomb. The crane groans louder than the crew.',
  ],
  streets: [
    'Is the bread in? The children are starving.',
    ['Your goat was in my garden again!', 'My goat has better taste than your garden.'],
    ['My husband is at the gymnasium all day.', 'Philosophy, he calls it.'],
    'The midwife says a boy. I’ll hang the olive wreath on the door.',
    ['The fountain’s low again. The pipe from the hills leaks.', 'Everything from the hills leaks. Ask my roof.'],
    ['We came down from Pedasa when Mausolus made the new city.', 'My mother still talks about the old house. Twenty years!'],
    'Come in out of the sun, the wine is cool.',
    ['Did you hear the dogs last night?', 'Someone was on the roofs. Lock your storeroom.'],
    'Hermes keep the door, Hestia the hearth, and let the landlord forget us till the new moon.',
    ['Are you going to the theatre?', 'If my wife lets me.'],
  ],
  chora: [
    'The olives are heavy this year, thanks be to Athena.',
    ['Watch the goats. The wolf took one last winter.', 'That was no wolf. That was your cousin.'],
    'Rain before the Pleiades set, and the barley will stand to your waist.',
    'Walk softly past the tombs. The dead are listening.',
    'My brother walked to Labraunda for the festival. Three days there, three back, and he still owes Zeus a bull.',
    ['The tax collectors were at Pedasa.', 'The satrap’s men, or the King’s?'],
    'The bees like the thyme on this hill. Best honey in Caria.',
  ],
  theatre: [
    ['The chorus is rehearsing the Bacchae for the Dionysia.', 'The chorus-master is a Theban. He says we sing like Carians.'],
    'Twenty days of rehearsal and they still come in late on the antistrophe.',
    ['Who pays for all this?', 'A shipowner from the harbour. He wants Idrieus to notice him.'],
    'Sit here — from the top row you can see the whole harbour and hear every word.',
  ],
  kids: ['Race you to the harbour!', 'Knucklebones? I’ve got five!', 'Mother says we can watch the sacrifice!', 'I saw a lion on the tomb move! I did!', 'Let’s go and look at the ships!'],
  pray: ['Zeus of Labraunda, lord of the double axe, keep my son safe at sea.', 'Hestia, keep the fire in my house and the fever out of it.', 'Take this, lord, and remember me.', 'Mausolus, hero, hear us.', 'Artemis, bring her through the birth.'],
  orator: [
    'Men of Halicarnassus! Mausolus found us scattered on the hills, and gave us walls, a harbour, a city worthy of the gods!',
    'Who among the Greeks ever honoured a husband as Artemisia honoured hers? Not Athens, not Sparta — Caria!',
    'In Athens they call us barbarians. Let them come and stand before our Mausoleum and say it again!',
    'The Rhodians broke their oaths, and the gods punished them — by the hand of a woman!',
    'Are we Greeks, or Carians, or subjects of the King? We are Halicarnassians — and that is enough!',
  ],
  work: {
    clink: ['Easy — easy — set it down!', 'Scopas wants the egg-and-dart finished before the festival.', 'That’s Proconnesian. Take care, it chips.', 'Another lion. Always another lion.'],
    anvil: ['More charcoal, boy! Pump!', 'Hot — hotter — now!', 'That share will turn a field of stones.'],
    knock: ['More pitch on that seam.', 'Measure twice, cut once, and pray to Athena Ergane.', 'Hold it steady, I said steady!'],
    pots: ['Don’t touch — the slip’s still wet.', 'The kiln must not cool before sunset.', 'Two hundred lamps for the festival, and he wants them by tomorrow.'],
    cloth: ['The wool is ready for the dye.', 'Murex stinks, but purple pays.', 'Mind the vat — that’s a month’s wages in there.'],
    misc: ['Heave!', 'Mind your back.', 'Lift together — now!', 'That one goes to the Rhodian.', 'Slower, you’ll spill it.'],
  },
};
const GREET = [['khaire, ō xene!', 'Greetings, stranger!'], ['khaire! pothen ēkeis?', 'Hail! Where have you come from?'], ['xene, ton taphon eides?', 'Stranger — have you seen the tomb yet? Go up, go up!'], ['pou badizeis?', 'Where are you off to in such a hurry?'], ['khaire, philos.', 'Good day to you, friend.']];
const GREET_KID = [['xene! obolon?', 'Stranger! An obol? Just one?'], ['xene! pothen?', 'Where are you from? Is it far?']];

export function build(ctx) {
  const { people, layout, camera } = ctx;
  const q = new URLSearchParams(location.search), R = rng(351);
  let on = q.has('captions') ? q.get('captions') !== '0' : !q.has('shot');   // (screenshot runs show no subtitles unless asked, ?captions=1)
  const stalls = layout.pois.filter(p => p.type === 'stall'), works = layout.pois.filter(p => p.type === 'work');
  const nearestNote = (list, x, z, r) => { let best = null, bd = r * r; for (const p of list) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best ? best.note || '' : ''; };
  // shuffle bags: every line is heard once before any is heard again
  const bags = new Map();
  const draw = (key, list) => { let b = bags.get(key); if (!b || !b.length) { b = list.map((_, i) => i).sort(() => R() - 0.5); bags.set(key, b); } return list[b.pop()]; };

  // ---------- the subtitle ----------
  const el = document.createElement('div'); el.id = 'caption';
  const css = document.createElement('style');
  css.textContent = `#caption { position: fixed; left: 50%; bottom: 8%; transform: translateX(-50%); max-width: min(760px, 86vw); padding: 10px 28px 12px; border-radius: 40px; background: radial-gradient(ellipse at center, rgba(10,12,16,.42), rgba(10,12,16,.22) 60%, rgba(10,12,16,0) 100%); text-align: center; pointer-events: none; z-index: 6; opacity: 0; transition: opacity .35s; font-family: Georgia, 'Times New Roman', serif; text-shadow: 0 1px 3px #000, 0 0 12px rgba(0,0,0,.7); }
#caption.on { opacity: 1; }
#caption .who { font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #e9c98a; opacity: .85; }
#caption .gr { font-size: 14px; font-style: italic; color: #d9cdb4; opacity: .75; margin-top: 3px; }
#caption .en { font-size: 18px; line-height: 1.4; color: #f3ead6; margin-top: 3px; }`;
  document.head.appendChild(css); document.body.appendChild(el);
  let showUntil = 0, nextAt = 3, busyUntil = 0, pending = null, lastGreet = -99, clock = 0, shown = 0;
  const spoke = new Map();   // person → when they last had a line
  function show(who, en, gr, dur, side) {
    el.innerHTML = `<div class="who">${side < 0 ? '◂ ' : ''}${who}${side > 0 ? ' ▸' : ''}</div>${gr ? `<div class="gr">${gr}</div>` : ''}<div class="en">${en}</div>`;
    if (on) el.classList.add('on'); showUntil = clock + dur; shown++;
  }
  const words = s => s.split(/\s+/).length, durOf = s => Math.min(8.5, Math.max(2.6, 1.4 + 0.3 * words(s)));
  const label = p => p.orator ? 'an orator' : p.child ? (p.female ? 'a girl' : 'a boy') : p.female ? (p.state === 'praying' ? 'a woman at prayer' : 'a woman') : p.state === 'praying' ? 'a man at prayer'
    : p.arch === 1 ? (p.seed < 0.25 ? 'an old man' : 'a citizen') : zone === 'harbour' ? 'a sailor' : zone === 'chora' ? 'a farmer' : 'a workman';
  let zone = 'streets';
  function say(p, en, gr, extra = {}) {
    const cam = camera.position, dur = durOf(en) + (gr ? 0.6 : 0);
    const rel = Math.atan2(p.x - cam.x, p.z - cam.z) - Math.atan2(-Math.sin(camera.rotation.y), -Math.cos(camera.rotation.y)), a = Math.atan2(Math.sin(rel), Math.cos(rel));
    show(extra.who || label(p), en, gr, dur, Math.abs(a) > 0.95 ? (a > 0 ? -1 : 1) : 0);   // (a > 0: to the left of where you look)
    ctx.emit('speech', p.x, p.y + 1.55, p.z, { i: p.i, greek: gr || null, dur, female: p.female, child: p.child, old: p.arch === 1 && p.seed < 0.25, orator: p.orator, sing: !!extra.sing, seed: p.seed });
    people.speak?.(p.i, dur, extra.look ? cam.x : undefined, extra.look ? cam.z : undefined);   // (they gesture as they talk; a greeting is said to your face)
    spoke.set(p.i, clock); busyUntil = clock + dur + 0.4;
  }

  function update(dt, t) {
    clock += dt;
    if (showUntil && clock > showUntil) { el.classList.remove('on'); showUntil = 0; }
    if (pending && clock >= pending.at) { const p = pending, cam = camera.position; pending = null; if (Math.hypot(p.p.x - cam.x, p.p.z - cam.z) < 16) { say(p.p, p.en, null); nextAt = clock + 4 + R() * 5; return; } }   // (unless you have walked on)
    if (clock < nextAt || clock < busyUntil || pending) return;
    nextAt = clock + 0.3;
    const cam = camera.position, fly = cam.y - ctx.world.groundHeight(cam.x, cam.z) > 6; if (fly) return;
    zone = inTerrace(cam.x, cam.z, 4) ? 'temenos' : Math.hypot(cam.x + 150, cam.z + 320) < 95 ? 'theatre' : Math.abs(cam.x) < 112 && cam.z > 365 && cam.z < 441 ? 'agora' : cam.z > 436 || cam.x > 420 && cam.z > 380 ? 'harbour' : !insideWalls(cam.x, cam.z) ? 'chora' : 'streets';
    const near = people.listen(cam.x, cam.z, 15).filter(p => !spoke.has(p.i) || clock - spoke.get(p.i) > 50);
    let best = null, bs = 0;
    for (const p of near) {
      let s = 0, what = null;
      if (p.orator && p.d < 14) { s = 3; what = 'orator'; }
      else if (p.kind === 'VENDOR' && p.d < 6.5) { s = 2.6; what = 'vendor'; }
      else if (p.talking && !p.walking && p.d < 7) { s = 2.2; what = 'talk'; }
      else if (p.state === 'praying' && p.d < 4.5) { s = 1.6; what = 'pray'; }
      else if ((p.kind === 'CRAFT' || p.hammerT >= 0) && p.d < 5.5) { s = 1.4; what = 'work'; }
      else if (p.child && p.d < 5) { s = 1.2; what = 'kid'; }
      else if (p.d < 3.2 && clock - lastGreet > 22 && !p.walking) { const face = Math.atan2(cam.x - p.x, cam.z - p.z) - p.yaw; if (Math.cos(face) > 0.5) { s = 1.8; what = 'greet'; } }
      if (!what) continue;
      s *= 1 / (1 + p.d / 6) * (0.75 + R() * 0.5);
      if (s > bs) { bs = s; best = { p, what }; }
    }
    if (!best) return;
    const { p, what } = best;
    if (what === 'vendor') {
      const note = nearestNote(stalls, p.x, p.z, 4.5), w = WARES.find(v => v[0].test(note)); if (!w) { spoke.set(p.i, clock); return; }
      const [gr, en] = draw(w[1], w[2]); say(p, en, gr, { who: w[1], sing: true, look: true });
    } else if (what === 'orator') say(p, draw('orator', TALK.orator), null);
    else if (what === 'pray') say(p, draw('pray', TALK.pray), null);
    else if (what === 'kid') say(p, draw('kids', TALK.kids), null);
    else if (what === 'greet') { const [gr, en] = draw(p.child ? 'gk' : 'g', p.child ? GREET_KID : GREET); say(p, en, gr, { look: true }); lastGreet = clock; }
    else if (what === 'work') {
      const n = nearestNote(works, p.x, p.z, 4), k = /smith|forge|anvil|ploughshare|chisels/.test(n) ? 'anvil' : /mason|sculpt|carv|marble|block|column|statue|lion|horse|moulding|egg-and-dart|polish|dressing a|roughing/.test(n) ? 'clink' : /ship|caulk|pitch|tar|timber|saw|boat/.test(n) ? 'knock' : /pot|kiln|clay|tile|brick|lamp/.test(n) ? 'pots' : /wool|dye|murex|cloth|loom|spinning|fulling/.test(n) ? 'cloth' : 'misc';
      say(p, draw('w' + k, TALK.work[k]), null, { who: k === 'clink' ? 'a mason' : k === 'anvil' ? 'a smith' : k === 'knock' ? (zone === 'harbour' ? 'a shipwright' : 'a carpenter') : k === 'pots' ? 'a potter' : k === 'cloth' ? 'a dyer' : label(p) });
    } else {
      const line = draw(zone, TALK[zone]);
      if (Array.isArray(line)) {
        say(p, line[0], null);
        const other = near.find(o => o.i !== p.i && o.group === p.group && p.group >= 0 && !o.walking);
        if (other) pending = { p: other, en: line[1], at: busyUntil };
      } else say(p, line, null);
    }
    nextAt = clock + 5 + R() * 6;
  }
  document.addEventListener('keydown', e => { if (e.code === 'KeyT' && !e.repeat) { on = !on; if (!on) el.classList.remove('on'); else if (showUntil) el.classList.add('on'); } });
  return { update, get on() { return on; }, caption: (who, en, gr, dur = 6) => show(who, en, gr, dur, 0), debug: () => ({ shown, zone, on }) };
}
