/**
 * The pet kit: a body that stands on the floor of the stage (or anywhere on it, `ground: 'free'`), walks, runs, jumps, sits, sleeps,
 * is picked up and thrown, makes faces and short gestures, with particles (hearts, tears, z's,
 * dust, notes) and a shadow. A figure pack builds its body on it (`createBody`) and only draws:
 * Coo (web/coo/figure.js) and the whale (web/whale/figure.js) both do. A pack may also ignore the
 * kit and answer the body contract (web/figure-frame.js) on its own.
 *
 * Coordinates: the figure is drawn in logo units, facing right, ground at y=256, inside a 256 square.
 * The stage places it with translate(AX AY) rotate(rot) scale(kx ky) translate(-ax -ay); `toStage`
 * maps a logo point back to stage pixels for hit tests, particles and the bubble's spot.
 *
 * Nothing here plays sound or talks to the World: sounds are asked for through `opts.sfx` and what
 * happens to the body is told through `opts.onEvent`; the page around the frame does the rest.
 */
export { createRig } from './rig.js';

export const f = n => Math.round(n * 10) / 10;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = k => k * k * (3 - 2 * k);
/** 0 → 1 over [0, a] of k, holds, then back to 0 over [b, 1]: the shape of a gesture held for a moment. */
export const envelope = (k, a, b) => smooth(clamp(k / a, 0, 1)) * (1 - smooth(clamp((k - b) / (1 - b), 0, 1)));

/* ---------- legs and particles ---------- */
export const HIPS = [[104, 212], [150, 212]];
export const LEG_W = 30;
// a foot's round cap touches the ground
const FOOT_Y = 256 - LEG_W / 2;
export const STAND = HIPS.map(h => [h[0], h[1], h[0], FOOT_Y]);
export const DROP = 'M0 -9C4 -3 6 0 6 3.5A6 6 0 0 1 -6 3.5C-6 0 -4 -3 0 -9Z';
export function heartD(cx, cy, s) {
  const p = (x, y) => `${f(cx + x * s)} ${f(cy + y * s)}`;
  return `M${p(0, 14)}C${p(-7, 8)} ${p(-19, 1)} ${p(-19, -6)}C${p(-19, -15)} ${p(-8, -18)} ${p(0, -9)}C${p(8, -18)} ${p(19, -15)} ${p(19, -6)}C${p(19, 1)} ${p(7, 8)} ${p(0, 14)}Z`;
}

/* ---------- faces ----------
   What a face asks of the body and the figure: eye shapes and sizes, mouth gap, blush, marks over
   the head, particles. Coo draws these as they are; a figure with its own art reads what it can. */
const ring = o => ({ shape: 'ring', rx: 16, ry: 16, ...o });
const yawn = t => { const p = (t % 4.2) / 1.6; return p < 1 ? Math.sin(Math.PI * p) ** 2 : 0; };

export const FACES = {
  neutral:   { label: '平静', kao: '(0 0',  f: () => ({ gap: [50, 50], eyes: [ring(), ring()] }) },
  happy:     { label: '开心', kao: '(^ ^',  f: () => ({ gap: [58, 58], eyes: [{ shape: 'up' }, { shape: 'up' }], blush: .45 }) },
  wink:      { label: '眨眼', kao: '(0 ^',  f: () => ({ gap: [56, 52], eyes: [ring(), { shape: 'up' }] }) },
  love:      { label: '喜欢', kao: '(♡ ♡',  f: t => { const s = .8 + .08 * Math.sin(t * 9); return { gap: [56, 56], eyes: [{ shape: 'heart', s, sw: 8 }, { shape: 'heart', s, sw: 8 }], blush: .7, emit: 'heart' }; } },
  shy:       { label: '害羞', kao: '(o o *', f: () => ({ gap: [40, 40], eyes: [ring({ rx: 13, ry: 12, dx: -3, dy: 5 }), ring({ rx: 13, ry: 12, dx: -3, dy: 5 })], blush: 1, lookLock: true }) },
  surprised: { label: '惊讶', kao: '(O O',  f: () => ({ gap: [62, 62], eyes: [ring({ rx: 20, ry: 21 }), ring({ rx: 20, ry: 21 })], bang: true }) },
  angry:     { label: '生气', kao: '(ò ó',  f: () => ({ gap: [36, 36], eyes: [ring({ ry: 11, dy: 4 }), ring({ ry: 11, dy: 4 })], brows: 'angry', anger: true, shake: true }) },
  sad:       { label: '难过', kao: '(ó ò',  f: () => ({ gap: [34, 40], eyes: [ring({ ry: 14, dy: 4 }), ring({ ry: 14, dy: 4 })], brows: 'sad', emit: 'tear' }) },
  // a yawn narrows the eyes without squeezing them to a slit
  sleepy:    { label: '犯困', kao: '(- -',  f: t => { const y = yawn(t); return { gap: [50 + 14 * y, 50 + 14 * y], eyes: [{ shape: 'lid', ry: 10 - 5 * y }, { shape: 'lid', ry: 10 - 5 * y }] }; } },
  sleep:     { label: '睡着', kao: '(u u',  f: t => { const b = 40 + 6 * Math.sin(t * 1.7); return { gap: [b, b], eyes: [{ shape: 'down' }, { shape: 'down' }], emit: 'z' }; } },
  dizzy:     { label: '晕乎', kao: '(@ @',  f: t => ({ gap: [54 + 5 * Math.sin(t * 5), 48], eyes: [{ shape: 'spiral', rot: t * 7 }, { shape: 'spiral', rot: t * 7 + 1.4 }], orbit: true }) },
  dragged:   { label: '被拎起', kao: '(> <', f: t => { const g = 55 + 3 * Math.sin(t * 22); return { gap: [g, g], eyes: [{ shape: 'gt' }, { shape: 'lt' }], sweat: true }; } },
  // seated eyes rest open; once drowse passes .7 they are the closed sleep sprite (the shape swap hides under a blink)
  content:   { label: '惬意', f: (t, p) => { const d = p ? p.drowse : 0; const e = d > .7 ? { shape: 'down' } : { shape: 'lid', ry: 13.5 - 10 * d }; return { gap: [46, 46], eyes: [e, { ...e }] }; } },
  waking:    { label: '醒来', f: (t, p) => {
    const mt = p ? p.modeT : 1;
    const k = clamp(mt / .5, 0, 1), y = mt > .5 ? Math.sin(clamp((mt - .5) / .9, 0, 1) * Math.PI) : 0;
    const r = Math.max(0, 10 * k * (1 - .7 * y));
    return { gap: [50 + 12 * y, 50 + 12 * y], eyes: [{ shape: 'lid', ry: r }, { shape: 'lid', ry: r }] };
  } },
  squeeze:   { label: '回神', f: () => ({ gap: [44, 44], eyes: [{ shape: 'lid', ry: 0 }, { shape: 'lid', ry: 0 }] }) },
  listening: { label: '倾听', f: () => ({ gap: [44, 44], eyes: [ring({ rx: 17, ry: 18, dy: -1 }), ring({ rx: 17, ry: 18, dy: -1 })], listen: true }) },
  thinking:  { label: '思考', f: t => ({ gap: [46, 46], eyes: [ring({ rx: 14, ry: 15, dx: 3, dy: -4 }), ring({ rx: 14, ry: 15, dx: 3, dy: -4 })], think: true }) },
  run:       { label: '冲刺', f: t => { const g = 55 + 4 * Math.sin(t * 16); return { gap: [g, g], eyes: [ring(), ring()], sweat: true }; } },
  smug:      { label: '得意', kao: '(¬ ¬', f: () => ({ gap: [52, 46], eyes: [{ shape: 'lid', ry: 8, dx: 4 }, { shape: 'lid', ry: 8, dx: 4 }], blush: .25 }) },
  // `lookAt` holds the gaze (and with it a figure's head) on a point, here away from whoever is there
  pout:      { label: '嘟嘴', kao: '(o o 3', f: () => ({ gap: [28, 28], eyes: [ring({ rx: 14, ry: 13 }), ring({ rx: 14, ry: 13 })], blush: .6, lookAt: [-5, -1] }) },
  worried:   { label: '担心', kao: '(ó ò ;', f: () => ({ gap: [40, 44], eyes: [ring({ ry: 17, dy: 2 }), ring({ ry: 17, dy: 2 })], brows: 'sad', sweat: true }) },
  determined: { label: '认真', kao: '(ò ó', f: () => ({ gap: [42, 42], eyes: [ring({ ry: 13, dy: 1 }), ring({ ry: 13, dy: 1 })], brows: 'angry' }) },
  flustered: { label: '慌张', kao: '(> <;', f: t => ({ gap: [50 + 3 * Math.sin(t * 22), 48], eyes: [{ shape: 'gt' }, { shape: 'lt' }], blush: 1, sweat: true }) },
  // `wide`: eyes wider than open (a figure with drawn eyes may use its surprised ones)
  scared:    { label: '害怕', kao: '(O O;', f: () => ({ gap: [38, 38], eyes: [ring({ rx: 18, ry: 19 }), ring({ rx: 18, ry: 19 })], brows: 'sad', wide: true, shake: true, sweat: true }) },
  excited:   { label: '期待', kao: '(☆ ☆', f: () => ({ gap: [60, 60], eyes: [ring({ rx: 18, ry: 19, dy: -1 }), ring({ rx: 18, ry: 19, dy: -1 })], sparkle: true, blush: .4 }) },
  cry:       { label: '大哭', kao: '(T T', f: t => { const g = 36 + 6 * Math.abs(Math.sin(t * 9)); return { gap: [g, g], eyes: [{ shape: 'lid', ry: 0 }, { shape: 'lid', ry: 0 }], brows: 'sad', emit: 'tears', streams: true }; } },
  // a motion's own face (not one to ask for): eyes shut through a bow
  bowing:    { label: '鞠躬', f: () => ({ gap: [48, 48], eyes: [{ shape: 'lid', ry: 0 }, { shape: 'lid', ry: 0 }] }) },
  confused:  { label: '疑惑', kao: '(0 o ?', f: () => ({ gap: [44, 40], eyes: [ring(), ring({ rx: 14, ry: 11 })], question: true }) },
};

/** The faces a word can ask for, and the motions the kit does by name. */
export const KIT_EXPRESSIONS = ['neutral', 'happy', 'wink', 'love', 'shy', 'surprised', 'angry', 'sad', 'sleepy', 'thinking',
  'smug', 'pout', 'worried', 'determined', 'flustered', 'scared', 'excited', 'cry', 'confused'];
export const KIT_MOTIONS = ['stand', 'jump', 'hop', 'look', 'turn', 'nod', 'shake', 'spin', 'sit', 'sleep', 'dizzy', 'walk', 'run',
  'wave', 'bow', 'shiver', 'flap', 'dance'];
/** The tone each face plays as it comes on (the host's synthesized sounds, web/sound.js), filed as a face sound. */
const FACE_TONES = {
  happy: 'happy', wink: 'wink', love: 'love', surprised: 'surprised', angry: 'angry', sad: 'sad', shy: 'shy', sleepy: 'yawn',
  smug: 'wink', worried: 'hmm', determined: 'pop', flustered: 'shy', scared: 'surprised', excited: 'sparkle', cry: 'sad', confused: 'hmm',
};
/** Body modes in which the figure travels across the stage or squashes fast (dancing steps and sways on the spot). */
const MOVING_MODES = new Set(['drag', 'air', 'crouch', 'land', 'walk', 'run', 'dance']);
/** Points on the body in logo units, for a figure that names none: where the eyes look from, where a tear starts,
 *  where z's and hearts start ([x from, x to, y]), the bubble's spot. `tears` (one start under each eye) has no default. */
const ANCHORS = { gaze: [140, 117], tear: [166, 136], z: [196, 40], hearts: [90, 175, 34], bubble: [128, 0] };
/** The body's box in logo units, for a figure that names none (`figure.extent`), and its hit circles (`figure.hits`). */
const EXTENT = [20, 12, 236, 256];
const HITS = [[128, 128, 108]];

/* ---------- the live pet: simulation, rendering, pointer ---------- */
/**
 * `els`: { petG, shadowEl, fxG }, SVG elements the body draws into (the shadow is an ellipse).
 * `opts.bounds()` returns { W, H, floorY, S } in stage pixels.
 * `opts.onEvent(kind, detail)` reports what happened to the body: arrived, interrupted, touch, mode, done.
 * `opts.sfx.play(name, kind, ...args)` asks for a sound (web/sound.js names them); an `sfx` without `play`
 * is called by name instead (`sfx.jump()`), for pages that record the calls.
 * `opts.enter: 'drop'` starts the pet above the top edge, falling to the floor.
 * `opts.ground: 'free'` lets the body stand anywhere on the stage above the floor, as seen from above: it walks
 * to any point (`walkTo` with a y), is set down where it is let go of, a throw tosses it across the stage, and
 * free roaming wanders both ways. Its own ground line (where its feet are) then starts at `opts.startY`, else the floor.
 * `opts.words` are the pack's own words, beyond the kit's (KIT_EXPRESSIONS, KIT_MOTIONS):
 *   `{ id: { expression: { like, seconds?, sound? } } }` holds a face that takes its eyes and marks from the kit's
 *   face `like` (the figure gets the word as `frame.face` and may draw it its own way);
 *   `{ id: { motion: { seconds, face?, sound? } } }` is a gesture the figure draws from `frame.gesture`.
 * `opts.figure` draws the body: `figure.draw(petG, face, frame)` keeps its own elements inside `petG` (logo space,
 * feet at y=256). Its frame adds the face's name, the mode, how long the mode has run, the talk level,
 * drowsiness, how far the body sits, and `status`: the kind of work the page's status bubble shows (src/status.ts), or null.
 * `figure.groupTilt(mode, tilt, lean)`, if present, returns the rotation (degrees) the whole group gets
 * instead of tilt + lean; the frame carries tilt, lean and that rotation (groupRot) so the figure can bend the rest.
 * `figure.colors.z`, if present, colours the sleep z's (otherwise they take the `eye` class).
 * `figure.gestures`, if present, names the short gestures (nod, shake) the figure draws itself: the body then
 * leaves them out, and the frame's `gesture` ({ kind, k: 0..1 }, or null) says which one is playing and how far.
 * `figure.anchors`, `figure.extent` ([x0, y0, x1, y1]) and `figure.hits` ([[x, y, r]]) are in logo units; each
 * is read every frame, so a getter may follow the skin. `figure.setSkin(skin)` hears each skin change.
 */
export function createPet(els, opts) {
  const { petG, shadowEl, fxG } = els;
  let custom = opts.figure;
  const sfx = opts.sfx;
  const play = (name, kind, ...args) => (sfx.play ? sfx.play(name, kind, ...args) : sfx[name]?.(...args));
  const onEvent = opts.onEvent || (() => {});
  const words = opts.words || {};
  let W = 0, H = 0, floorY = 0, S = .42, T = 0;
  let roam = opts.roam ?? 'free';
  let skin = opts.skin || null;
  let hold = 0; // until T: an order from outside is in progress, free roaming waits
  const freeGround = opts.ground === 'free';
  const pet = {
    x: 260, fy: 0, gy: 0, gvy: 0, targetY: 0, vx: 0, vy: 0, facing: 1, faceVis: 1, mode: 'idle', modeT: 0, dur: 0, target: 0,
    speed: 0, stride: 0, lift: 0, bob: 0, phase: 0, lastHalf: 0, lean: 0, tilt: 0, tiltV: 0,
    sq: 0, sqv: 0, sitK: 0, stretch: 0, low: 0, gap: [50, 50], look: [0, 0], drowse: 0,
    feet: STAND.map(l => [l[2], l[3]]), blinkT: 1.5, blinkAge: 9, expr: null, exprUntil: 0,
    nextAt: 1.2, emitAt: 0, airKind: 'jump', turned: false, startle: false, lastAct: '',
    turnAcc: 0, dx: 0, dy: 0, jumpV: 700, jumpVx: 0, xf: null, blushK: 0,
    eyeSig: '', eyeCur: null, eyePrev: null, eyeDims: [[16, 16, 0, 0], [16, 16, 0, 0]], swapAge: 9,
    glance: [0, 0], glanceAt: 0, swing: 0, swingV: 0, prevA: null, velX: 0, talkK: 0, sfxAt: 0, skid: false, cue: 0,
    pulse: null, walkId: 0, walkWord: null, listening: false, thinking: false, thoughtShown: false, placed: false, noteAt: 0, tearN: 0,
    cursor: '', status: null,
  };
  const pointer = { x: -1e4, y: -1e4, inside: false, vx: 0, samples: [] };
  let press = null, strokeAcc = 0, petCool = 0;
  /** Whether the last frame found the horizontal speed not finite: a run of such frames is logged once. */
  let velXBad = false;
  const P = [];
  const anchors = () => ({ ...ANCHORS, ...custom?.anchors });
  let A = anchors();
  const minX = () => 104 * S + 8, maxX = () => W - 104 * S - 8;
  /** The highest ground line a free body stands on: its head stays on the stage. */
  const minY = () => Math.min(floorY, 250 * S + 8);
  /** Where the feet rest: the floor, or a free body's own ground line. */
  const groundY = () => (freeGround ? pet.gy : floorY);
  /** Detail for a walk's events: a free body says how far down it stands. */
  const at = () => ({ x: Math.round(pet.x), ...(freeGround ? { y: Math.round(pet.gy) } : {}) });
  const faceDef = n => FACES[n] ?? FACES[words[n]?.expression?.like] ?? FACES.neutral;

  function resize() {
    const b = opts.bounds();
    W = b.W; H = b.H; floorY = b.floorY; S = b.S;
    if (!pet.placed && W > 0) {
      pet.x = opts.startX != null ? opts.startX : W * .7; pet.placed = true;
      pet.gy = freeGround && opts.startY != null ? opts.startY : floorY;
      if (opts.enter === 'drop') { pet.fy = -8; pet.vy = 0; pet.vx = 0; pet.airKind = 'drop'; setMode('air'); }
    }
    pet.x = clamp(pet.x, minX(), maxX());
    pet.target = clamp(pet.target, minX(), maxX());
    pet.gy = freeGround ? clamp(pet.gy, minY(), floorY) : floorY;
    pet.targetY = freeGround ? clamp(pet.targetY, minY(), floorY) : floorY;
    if (pet.mode !== 'air' && pet.mode !== 'drag') pet.fy = pet.gy;
  }

  function toStage(lx, ly) {
    const c = pet.xf;
    if (!c) return { x: pet.x, y: groundY() };
    const x = (lx - c.ax) * c.kx, y = (ly - c.ay) * c.ky, r = c.rot * Math.PI / 180;
    return { x: c.AX + x * Math.cos(r) - y * Math.sin(r), y: c.AY + x * Math.sin(r) + y * Math.cos(r) };
  }
  /** The hit circles in stage pixels. */
  function hits() {
    return (custom?.hits ?? HITS).map(([x, y, r]) => ({ ...toStage(x, y), r: r * S }));
  }
  function hitPet(p) {
    return hits().some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r);
  }

  function setMode(m, o = {}) {
    const prev = pet.mode;
    // an arrival clears walkId before going idle, so anything else that ends a walk (a turn, a bow, listening) cuts it short
    if ((prev === 'walk' || prev === 'run') && pet.walkId) {
      onEvent('interrupted', { walkId: pet.walkId, ...at(), by: m });
      pet.walkId = 0;
    }
    // a walk or run asked for as a word is done once the body stops going, whatever stopped it
    if ((prev === 'walk' || prev === 'run') && pet.walkWord && m !== prev) { onEvent('done', { word: pet.walkWord }); pet.walkWord = null; }
    pet.mode = m; pet.modeT = 0; pet.turned = false; pet.startle = false; pet.skid = false; pet.cue = 0;
    Object.assign(pet, o);
    if (prev !== m) onEvent('mode', { mode: m });
  }
  const busy = () => pet.mode === 'drag' || pet.mode === 'air' || pet.mode === 'crouch';
  function pickTarget(minDist) {
    for (let i = 0; i < 12; i++) {
      const x = rnd(minX(), maxX());
      if (Math.abs(x - pet.x) > minDist) return x;
    }
    return pet.x - minX() > maxX() - pet.x ? minX() : maxX();
  }
  /** A ground line to walk to: anywhere for a free body, else where it stands. */
  const pickY = () => (freeGround ? rnd(minY(), floorY) : pet.gy);

  /** Runs a motion. Returns false when the body cannot take it now (in the air, being dragged). */
  function act(a) {
    if (busy()) return false;
    pet.expr = null; pet.lastAct = a;
    const seated = pet.mode === 'sleep' || pet.mode === 'sit';
    switch (a) {
      case 'stand': setMode(seated ? 'wake' : 'idle', seated ? { startle: false } : {}); pet.nextAt = T + 3; break;
      case 'walk': setMode('walk', { target: pickTarget(160), targetY: pickY() }); break;
      case 'run': setMode('run', { target: pet.x < W / 2 ? maxX() - rnd(0, 30) : minX() + rnd(0, 30), targetY: pickY() }); break;
      case 'jump': setMode('crouch', { jumpV: 720, jumpVx: pet.facing * 40 }); break;
      case 'hop': setMode('crouch', { jumpV: 480, jumpVx: 0 }); break;
      case 'look': setMode('look'); break;
      case 'turn': if (!seated) setMode('idle'); pet.facing *= -1; play('tick', 'move'); break;
      case 'nod': pulse('nod', .7); play('nod', 'move'); break;
      case 'shake': pulse('shake', .7); play('shake', 'move'); break;
      case 'spin': if (!seated) setMode('idle'); pulse('spin', .6); play('spin', 'move'); break;
      case 'sit': setMode('sit', { dur: 1e9, willSleep: false }); break;
      case 'sleep': setMode('sleep', { dur: 1e9 }); break;
      case 'dizzy': setMode('dizzy'); break;
      case 'wave': pulse('wave', 1.6); holdFace('happy', 1.8); break;
      case 'bow': if (!seated) setMode('idle'); pulse('bow', 1.6); holdFace('bowing', 1.5); play('tick', 'move'); break;
      case 'shiver': pulse('shiver', 1.8); play('shiver', 'move'); break;
      case 'flap': setMode('crouch', { jumpV: 540, jumpVx: 0 }); pulse('flap', 1.4); holdFace('happy', 1.6); play('chirps', 'move'); break;
      case 'dance': setMode('dance', { dur: 3.2 }); holdFace('happy', 3.4); play('dance', 'move'); break;
      default: {
        // a gesture of the pack's own, drawn by its figure from frame.gesture
        const m = words[a]?.motion;
        if (!m) return false;
        if (!seated) setMode('idle');
        pulse(a, m.seconds);
        if (m.face) holdFace(m.face, m.seconds);
        if (m.sound) play(m.sound, 'move');
      }
    }
    return true;
  }
  function pulse(kind, dur) { pet.pulse = { kind, t0: T, dur }; }
  /** A motion's own face, without the expression's sound and bounce (act() has just cleared any held face). */
  function holdFace(n, seconds) { pet.expr = n; pet.exprUntil = T + seconds; pet.nextAt = Math.max(pet.nextAt, pet.exprUntil + .6); }

  function setExpr(n, seconds) {
    if (n === 'sleep') { act('sleep'); return; }
    if (busy()) return;
    if (n === 'dragged') {
      pet.expr = null;
      pet.vy = -1150; pet.vx = rnd(-120, 120); pet.airKind = 'throw'; pet.sqv -= 3;
      play('whoosh', 'move'); play('jump', 'move');
      setMode('air'); return;
    }
    if (n === 'dizzy') { pet.expr = null; setMode('dizzy'); return; }
    if (pet.mode === 'look' || pet.mode === 'land') setMode('idle');
    const own = words[n]?.expression;
    pet.expr = n; pet.exprUntil = T + (seconds ?? own?.seconds ?? (n === 'sleepy' ? 4.4 : 3.2));
    pet.nextAt = Math.max(pet.nextAt, pet.exprUntil + .6);
    pet.sqv += n === 'surprised' ? -2.2 : .8;
    const tone = own?.sound ?? FACE_TONES[n];
    if (tone) play(tone, 'face');
    if (n === 'love') for (let i = 0; i < 4; i++) emitHeart();
  }

  /**
   * Does a word of the body's vocabulary: one of the kit's faces or motions, or one of the pack's own
   * (`opts.words`). A walk or run goes to the other side of the stage and reports `done` once it stops.
   * Returns false for a word it does not know or cannot take now.
   */
  function doWord(w) {
    if (w === 'neutral') { setExpr('neutral', .1); return true; }
    if (w === 'walk' || w === 'run') {
      const x = pet.x < W / 2 ? W * (.55 + Math.random() * .35) : W * (.1 + Math.random() * .35);
      if (!walkTo(x, w === 'run', 0, pickY())) return false;
      if (pet.mode === w) pet.walkWord = w;
      else onEvent('done', { word: w });
      return true;
    }
    if (KIT_MOTIONS.includes(w) || words[w]?.motion) return act(w);
    if (KIT_EXPRESSIONS.includes(w) || words[w]?.expression) {
      if (busy()) return false;
      setExpr(w);
      return true;
    }
    return false;
  }

  /**
   * Walks (or runs) to stage x, and for a free body to ground line y (where it stands now when left out).
   * Resolves the walk through onEvent('arrived' | 'interrupted').
   */
  function walkTo(x, run, walkId, y) {
    if (busy()) return false;
    if (pet.mode === 'sleep' || pet.mode === 'sit') setMode('wake', { startle: true });
    const target = clamp(x, minX(), maxX());
    const targetY = freeGround && typeof y === 'number' && Number.isFinite(y) ? clamp(y, minY(), floorY) : pet.gy;
    pet.expr = null;
    if (Math.hypot(target - pet.x, targetY - pet.gy) < 2) { onEvent('arrived', { walkId, ...at() }); return true; }
    setMode(run ? 'run' : 'walk', { target, targetY, walkId });
    return true;
  }

  /** Stops the walk `walkId` where the pet stands; it reports the walk 'interrupted'. A finished walk is left alone. */
  function stopWalk(walkId) {
    if ((pet.mode === 'walk' || pet.mode === 'run') && pet.walkId === walkId) setMode('idle');
  }

  function faceName() {
    const m = pet.mode;
    if (m === 'drag') return 'dragged';
    if (m === 'air' && pet.airKind === 'throw') return pet.vy < 0 ? 'dragged' : 'surprised';
    if (m === 'air' && pet.airKind === 'drop') return 'surprised';
    if (m === 'dizzy') return pet.modeT < 2.4 ? 'dizzy' : 'squeeze';
    if (m === 'wake') return pet.startle ? 'surprised' : 'waking';
    if (pet.listening && m !== 'sleep') return 'listening';
    if (m === 'sleep') return 'sleep';
    if (pet.expr && T < pet.exprUntil) return pet.expr;
    if (pet.thinking) return 'thinking';
    if (m === 'sit') return 'content';
    if (m === 'run') return 'run';
    return 'neutral';
  }

  function decide() {
    const calm = roam === 'calm';
    const opts2 = [['walk', calm ? 10 : 28], ['run', calm ? 0 : 12], ['look', 14], ['jump', calm ? 2 : 8], ['sit', 16], ['expr', 12], ['wait', calm ? 30 : 10]]
      .filter(o => o[1] > 0 && (o[0] !== pet.lastAct || o[0] === 'wait'));
    let r = Math.random() * opts2.reduce((a, o) => a + o[1], 0), pick = 'wait';
    for (const o of opts2) { if ((r -= o[1]) < 0) { pick = o[0]; break; } }
    if (pick === 'look') { setMode('look'); pet.lastAct = 'look'; }
    else if (pick === 'expr') { setExpr(['happy', 'wink', 'love', 'sleepy', 'surprised', 'shy'][Math.floor(Math.random() * 6)]); pet.lastAct = 'expr'; }
    // a sit she chose decides up front whether it ends in sleep, so she only gets drowsy when she will fall asleep
    else if (pick === 'sit') { setMode('sit', { dur: rnd(6, 9), willSleep: Math.random() < .6 }); pet.lastAct = 'sit'; }
    else if (pick !== 'wait') act(pick);
    if (pet.mode === 'idle' && T >= pet.nextAt) pet.nextAt = T + rnd(2, 4);
  }

  /* particles */
  function emit(type, p, o = {}) { P.push({ type, x: p.x, y: p.y, vx: 0, vy: 0, age: 0, life: 1, ...o }); }
  function emitHeart() {
    emit('heart', toStage(rnd(A.hearts[0], A.hearts[1]), A.hearts[2] + pet.low), { vx: rnd(-20, 20), vy: rnd(-70, -45), life: 1.6 });
  }
  function dustAt(lx, n, spread) {
    for (let i = 0; i < n; i++) {
      emit('dust', toStage(lx, 250), { vx: rnd(-spread, spread) - pet.facing * rnd(10, 40), vy: rnd(-30, -8), life: rnd(.4, .65) });
    }
  }

  function step(dt) {
    // a frame that took no time has nothing to advance, and the horizontal speed below divides by its length
    if (!(dt > 0 && dt < Infinity)) return;
    T += dt; pet.modeT += dt;
    A = anchors();
    const m = pet.mode, mt = pet.modeT;
    let sqT = 0, strideT = 0, liftT = 0, leanT = 0, sitT = 0, bobT = 0, rate = 0, lookT = [0, 0], tiltT = 0;
    let tk = 160, tc = 12, drowseT = 0;
    const free = roam !== 'off' && T > hold && !opts.dialogOpen?.();

    pet.blinkT -= dt; pet.blinkAge += dt;
    if (pet.blinkT <= 0) { pet.blinkAge = 0; pet.blinkT = Math.random() < .2 ? .28 : rnd(2.2, 5.2); }

    const head = toStage(A.gaze[0], A.gaze[1]);
    const pdx = pointer.x - head.x, pdy = pointer.y - head.y, pm = Math.hypot(pdx, pdy) || 1;
    const track = () => {
      if (!pointer.inside) {
        if (T > pet.glanceAt) { pet.glance = Math.random() < .45 ? [0, 0] : [rnd(-3, 5), rnd(-3, 3)]; pet.glanceAt = T + rnd(1.2, 3); }
        return pet.glance;
      }
      const k = Math.min(1, pm / 120);
      return [pdx * pet.facing / pm * 5 * k, pdy / pm * 4 * k];
    };

    switch (m) {
      case 'idle': {
        lookT = track();
        if (pointer.inside && !press && pdx * pet.facing < -50 && pm < 600) {
          pet.turnAcc += dt;
          if (pet.turnAcc > .9) { pet.facing *= -1; pet.turnAcc = 0; }
        } else pet.turnAcc = 0;
        if (pet.listening) { lookT = [3, -4]; tiltT = -7; leanT = -2; }
        if (free && !pet.listening && T > pet.nextAt && !(pet.expr && T < pet.exprUntil)) decide();
        break;
      }
      case 'walk': case 'run': {
        const run = m === 'run', d = pet.target - pet.x, dy = pet.targetY - pet.gy, dist = Math.hypot(d, dy), dir = Math.sign(d) || pet.facing;
        // a free body walking up or down the stage keeps the way it faces
        if (!freeGround || Math.abs(d) > 2) pet.facing = dir;
        const vMax = run ? 250 : 78;
        const vT = Math.min(vMax, run ? dist * 4 + 20 : dist * 3 + 14);
        strideT = run ? 17 : 10; liftT = run ? 15 : 8; bobT = run ? 7 : 3; rate = run ? 4.4 : 2.1;
        leanT = run ? (dist < 50 && pet.speed > 120 ? -6 : 11) : 4;
        if (leanT < 0 && !pet.skid) { pet.skid = true; play('skid', 'move'); }
        const ramp = Math.min(1, mt / (run ? .35 : .25));
        pet.speed = lerp(pet.speed, vT * smooth(ramp), ease(run ? 6 : 9, dt));
        const go = Math.min(dist, pet.speed * dt);
        if (dist > 0) { pet.x += d / dist * go; pet.gy += dy / dist * go; pet.fy = pet.gy; }
        const k = clamp(pet.speed / vMax, 0, 1);
        strideT *= .4 + .6 * k; liftT *= .4 + .6 * k;
        pet.phase += Math.PI * 2 * rate * dt * Math.max(.35, k);
        lookT = [run ? 4 : 3, run ? 1 : 0];
        const half = Math.floor(pet.phase / Math.PI);
        if (half !== pet.lastHalf) {
          play('step', 'move', run, half & 1);
          if (run && pet.speed > 120) dustAt(128, dist < 50 ? 3 : 1, 20);
        }
        pet.lastHalf = half;
        if (dist < 1.5) {
          pet.speed = 0;
          const id = pet.walkId; pet.walkId = 0;
          setMode('idle'); pet.nextAt = T + rnd(1.2, 3.2);
          if (id) onEvent('arrived', { walkId: id, ...at() });
        }
        break;
      }
      case 'look': {
        if (!pet.cue) { pet.cue = 1; play('look', 'move'); }
        if (mt < .9) lookT = [4, -4];
        else if (mt < 1.8) { if (!pet.turned) { pet.turned = true; pet.facing *= -1; } lookT = [5, 0]; }
        else if (mt < 2.6) lookT = [1, 4];
        else { setMode('idle'); pet.nextAt = T + rnd(1, 2.5); }
        break;
      }
      case 'sit': {
        sitT = 1;
        lookT = track().map(v => v * (1 - pet.drowse));
        if (pet.listening) { lookT = [3, -4]; tiltT = -7; }
        // awake while sitting; a sit that ends in sleep closes over its last ~1.6s; a held sit (the word) never dozes off
        drowseT = pet.willSleep && free ? clamp((mt - (pet.dur - 1.6)) / 1.2, 0, 1) : .15;
        if (pet.drowse > .5) leanT = 7 * pet.drowse * Math.pow(Math.max(0, Math.sin(T * 1.3)), 6);
        if (free && mt > pet.dur) {
          if (pet.willSleep) setMode('sleep', { dur: rnd(8, 12) });
          else { setMode('idle'); pet.sqv -= 1.2; pet.nextAt = T + rnd(1.5, 3); }
        }
        break;
      }
      case 'sleep': {
        sitT = 1; drowseT = 1; leanT = 5;
        if (free && mt > pet.dur) setMode('wake');
        break;
      }
      case 'wake': {
        if (pet.startle) {
          sitT = 0; lookT = [3, -2];
          if (mt > .9) { setMode('idle'); pet.nextAt = T + rnd(1.5, 3); }
        } else {
          sitT = mt < 1.1 ? 1 : 0;
          if (mt > .5 && !pet.cue) { pet.cue = 1; play('yawn', 'face'); }
          sqT = mt > .5 && mt < 1.3 ? -.1 : 0;
          leanT = mt < .5 ? 5 : mt < 1.2 ? -5 : 0;
          lookT = mt > 1.2 ? track() : [0, 0];
          if (mt > 1.8) { setMode('idle'); pet.nextAt = T + rnd(1, 2); }
        }
        break;
      }
      case 'crouch': {
        sqT = .24; sitT = .3;
        if (mt > .16) {
          pet.vy = -pet.jumpV; pet.vx = pet.jumpVx; pet.airKind = 'jump'; pet.sqv -= 2.6;
          play('jump', 'move');
          setMode('air');
        }
        break;
      }
      case 'air': {
        pet.vy += 2300 * dt;
        pet.vx *= Math.exp(-dt * .4);
        pet.x += pet.vx * dt; pet.fy += pet.vy * dt;
        // a free body tossed across the stage: its ground line slides with the throw and slows
        if (freeGround && pet.gvy) {
          pet.gvy *= Math.exp(-dt * 1.2);
          pet.gy += pet.gvy * dt; pet.fy += pet.gvy * dt;
          if (pet.gy < minY()) { pet.fy += minY() - pet.gy; pet.gy = minY(); pet.gvy = Math.abs(pet.gvy) * .55; pet.sqv += .6; }
          if (pet.gy > floorY) { pet.fy -= pet.gy - floorY; pet.gy = floorY; pet.gvy = -Math.abs(pet.gvy) * .55; pet.sqv += .6; }
        }
        if (pet.x < minX()) { pet.x = minX(); pet.vx = Math.abs(pet.vx) * .55; pet.sqv += .6; }
        if (pet.x > maxX()) { pet.x = maxX(); pet.vx = -Math.abs(pet.vx) * .55; pet.sqv += .6; }
        if (pet.fy - 250 * S < 0 && pet.vy < 0) { pet.fy = 250 * S; pet.vy = Math.abs(pet.vy) * .3; }
        sqT = -Math.min(.12, Math.abs(pet.vy) / 6000);
        tiltT = clamp(pet.vx * .025, -30, 30);
        tk = 70; tc = 8;
        if (pet.fy >= pet.gy && pet.vy > 0) land();
        break;
      }
      case 'land': {
        sitT = .35 * (1 - smooth(clamp(mt / .35, 0, 1)));
        lookT = [2, 2];
        if (mt > .4) setMode('idle');
        break;
      }
      case 'dizzy': {
        sitT = mt < 2.6 ? 1 : 0;
        if (mt < 2.4 && T > pet.sfxAt) { play('chirps', 'move'); pet.sfxAt = T + .9; }
        if (mt >= 2.4 && !pet.cue) { pet.cue = 1; play('shake', 'move'); }
        if (mt < 2.4) tiltT = 8 * Math.sin(T * 4.5) * Math.min(1, mt * 2);
        else if (mt < 3) { const k = (mt - 2.4) / .6; tiltT = 12 * Math.sin(mt * 34) * (1 - k); }
        else { setMode('idle'); pet.sqv -= 1; pet.nextAt = T + rnd(1.5, 3); }
        break;
      }
      case 'dance': {
        // a little two-step on the spot: the feet take turns, the body sways with them, notes float up
        strideT = 5; liftT = 10; bobT = 3;
        pet.phase += Math.PI * 2 * 1.1 * dt;
        tiltT = 7 * Math.sin(pet.phase);
        lookT = [3, -2];
        const half = Math.floor(pet.phase / Math.PI);
        if (half !== pet.lastHalf) play('step', 'move', false, half & 1);
        pet.lastHalf = half;
        if (T > pet.noteAt) { emit('note', toStage(A.z[0], A.z[1] + pet.low), { vx: pet.facing * rnd(10, 30), vy: -34, life: 1.8 }); pet.noteAt = T + .6; }
        if (mt > pet.dur) { setMode('idle'); pet.nextAt = T + rnd(1.5, 3); }
        break;
      }
      case 'drag': {
        pet.dx = lerp(pet.dx, pointer.x, ease(28, dt));
        pet.dy = lerp(pet.dy, Math.min(pointer.y, floorY - 245 * S), ease(28, dt));
        tiltT = clamp(pointer.vx * .035, -40, 40); tk = 90; tc = 5;
        if (Math.abs(pointer.vx) > 500 && T > pet.sfxAt) { play('squeak', 'touch'); pet.sfxAt = T + rnd(.4, .7); }
        break;
      }
    }

    // short gestures layered over whatever the body is doing
    // (a figure that lists a gesture in `figure.gestures` draws it itself, from the frame's `gesture`)
    if (pet.pulse) {
      const k = (T - pet.pulse.t0) / pet.pulse.dur;
      if (k >= 1) pet.pulse = null;
      else if (custom?.gestures?.includes(pet.pulse.kind)) { /* the figure's own */ }
      else if (pet.pulse.kind === 'nod') leanT += 9 * Math.abs(Math.sin(k * Math.PI * 2));
      else if (pet.pulse.kind === 'shake') tiltT += 10 * Math.sin(k * Math.PI * 6) * (1 - k);
      else if (pet.pulse.kind === 'wave') tiltT += 6 * Math.sin(k * Math.PI * 6) * Math.sin(k * Math.PI);
      else if (pet.pulse.kind === 'bow') leanT += 16 * envelope(k, .25, .7);
      else if (pet.pulse.kind === 'flap') { tiltT += 7 * Math.sin(k * Math.PI * 8) * (1 - k); sqT -= .06 * Math.abs(Math.sin(k * Math.PI * 8)) * (1 - k); }
      else if (pet.pulse.kind === 'spin' && k > .5 && !pet.pulse.flipped) { pet.pulse.flipped = true; pet.facing *= -1; }
      else if (pet.pulse.kind === 'spin' && k < .5 && !pet.pulse.first) { pet.pulse.first = true; pet.facing *= -1; pet.sqv -= 1; }
    }

    const fname = faceName(), fc = faceDef(fname).f(T, pet);
    // while the page shows the thought in its status bubble, the face keeps the eyes without a second thought trail
    if (pet.thinking && pet.thoughtShown && fname === 'thinking') fc.think = false;
    if (fc.lookLock || pet.mode === 'sleep' || pet.mode === 'drag') lookT = [0, 0];
    else if (fc.lookAt) lookT = fc.lookAt;

    // eye shape changes hide under a quick blink; same-shape changes (ring size) ease
    const sig = fc.eyes.map(e => e.shape).join();
    if (sig !== pet.eyeSig) {
      if (pet.eyeCur) { pet.eyePrev = pet.eyeCur; pet.swapAge = 0; }
      pet.eyeSig = sig;
      fc.eyes.forEach((e, i) => { pet.eyeDims[i] = [e.rx ?? 16, e.ry ?? 16, e.dx || 0, e.dy || 0]; });
    }
    pet.swapAge += dt;
    pet.eyeCur = fc.eyes.map((e, i) => {
      if (e.shape !== 'ring' && e.shape !== 'lid') return e;
      const d = pet.eyeDims[i], tgt = [e.rx ?? 16, e.ry ?? 16, e.dx || 0, e.dy || 0];
      for (let j = 0; j < 4; j++) d[j] = lerp(d[j], tgt[j], ease(16, dt));
      return { ...e, rx: d[0], ry: d[1], dx: d[2], dy: d[3] };
    });
    pet.blushK = lerp(pet.blushK, fc.blush || 0, ease(6, dt));

    // springs & easing
    pet.sqv += ((sqT - pet.sq) * 280 - pet.sqv * 14) * dt;
    pet.sq = clamp(pet.sq + pet.sqv * dt, -.35, .45);
    pet.tiltV += ((tiltT - pet.tilt) * tk - pet.tiltV * tc) * dt;
    pet.tilt += pet.tiltV * dt;
    pet.lean = lerp(pet.lean, leanT, ease(7, dt));
    pet.sitK = lerp(pet.sitK, sitT, ease(m === 'land' ? 18 : 6, dt));
    pet.drowse = lerp(pet.drowse, drowseT, ease(m === 'sleep' ? 1.5 : m === 'sit' ? 4 : 6, dt));
    pet.stretch = lerp(pet.stretch, m === 'drag' ? 1 : 0, ease(8, dt));
    pet.stride = lerp(pet.stride, strideT, ease(10, dt));
    pet.lift = lerp(pet.lift, liftT, ease(10, dt));
    pet.bob = lerp(pet.bob, bobT, ease(10, dt));
    pet.look[0] = lerp(pet.look[0], lookT[0], ease(9, dt));
    pet.look[1] = lerp(pet.look[1], lookT[1], ease(9, dt));
    pet.gap[0] = lerp(pet.gap[0], fc.gap[0], ease(8, dt));
    pet.gap[1] = lerp(pet.gap[1], fc.gap[1], ease(8, dt));
    // turning reads as a quick card flip rather than a mirror snap
    pet.faceVis = lerp(pet.faceVis, pet.facing, ease(15, dt));
    if (m !== 'walk' && m !== 'run' && m !== 'dance') pet.phase = lerp(pet.phase, Math.round(pet.phase / Math.PI) * Math.PI, ease(6, dt));
    pointer.vx *= Math.exp(-dt * 6);

    // secondary motion for ears/antenna/scarf: lags behind horizontal movement
    const AX = pet.mode === 'drag' ? pet.dx : pet.x;
    if (pet.prevA != null) pet.velX = lerp(pet.velX, (AX - pet.prevA) / dt, .25);
    // lerp keeps a NaN or an infinity for good, and the swing with it: a figure's warps that read the swing then
    // draw nothing. Start the speed over and say what it came from.
    if (!Number.isFinite(pet.velX)) {
      if (!velXBad) console.warn(`[pet] 横向速度不是有限数,已归零:velX=${pet.velX} x=${AX} 上一帧x=${pet.prevA} dt=${dt} 模式=${m}`);
      velXBad = true;
      pet.velX = 0;
    } else velXBad = false;
    pet.prevA = AX;
    // dancing stays put but rocks: the rock swings what hangs off the body (ears, hair, skirt), as moving does
    const swingT = clamp(-(pet.velX * .06 + (m === 'dance' ? pet.tiltV * .22 : 0)) * Math.sign(pet.faceVis || 1), -28, 28);
    pet.swingV += ((swingT - pet.swing) * 110 - pet.swingV * 7) * dt;
    pet.swing = clamp(pet.swing + pet.swingV * dt, -40, 40);

    pet.low = pet.sitK * 29 + pet.bob * Math.abs(Math.sin(pet.phase));
    pet.feet.forEach((ft, i) => {
      const hx = HIPS[i][0], hy = HIPS[i][1] + pet.low;
      let tx, ty;
      if (m === 'drag') { tx = hx + 7 * Math.sin(T * 11 + i * 2.2); ty = hy + 36; }
      else if (m === 'air') { tx = hx + (i ? 9 : -9); ty = hy + 33; }
      else {
        const ph = pet.phase + i * Math.PI;
        const sx = hx + pet.stride * Math.sin(ph), sy = FOOT_Y - pet.lift * Math.max(0, Math.cos(ph));
        tx = lerp(sx, hx + 26, pet.sitK); ty = lerp(sy, FOOT_Y, pet.sitK);
      }
      const r = m === 'drag' || m === 'air' ? 14 : 40;
      ft[0] = lerp(ft[0], tx, ease(r, dt)); ft[1] = lerp(ft[1], ty, ease(r, dt));
    });

    if (fc.emit && T > pet.emitAt) {
      if (fc.emit === 'heart') { emitHeart(); pet.emitAt = T + .45; }
      if (fc.emit === 'z') { emit('z', toStage(A.z[0], A.z[1] + pet.low), { vx: pet.facing * 16, vy: -26, life: 2.4 }); pet.emitAt = T + 1.3; play('snore', 'snore', pet.modeT); }
      if (fc.emit === 'tear') { emit('drop', toStage(A.tear[0] + pet.look[0], A.tear[1] + pet.low), { vx: pet.facing * rnd(10, 30), vy: -20, life: 3 }); pet.emitAt = T + .8; }
      if (fc.emit === 'tears') {
        // both eyes cry, taking turns; a figure that names only its one tear spot cries from there
        const eyes = A.tears ?? [A.tear], [ex, ey] = eyes[pet.tearN++ % eyes.length];
        emit('drop', toStage(ex + pet.look[0] + rnd(-6, 6), ey + pet.low), { vx: pet.facing * rnd(-20, 50), vy: rnd(-60, -20), life: 3 }); pet.emitAt = T + .22;
      }
    }
    strokeAcc *= Math.exp(-dt * 1.5);
    petCool -= dt;

    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'drop') { p.vy += 900 * dt; if (p.y > groundY()) p.age = p.life; }
      if (p.type === 'dust') p.vx *= Math.exp(-dt * 4);
      if (p.age >= p.life) P.splice(i, 1);
    }
    pet.talkK *= Math.exp(-dt * 12);
    pet._fc = fc; pet._fname = fname;
  }

  function land() {
    const impact = pet.vy, kind = pet.airKind;
    pet.fy = pet.gy; pet.vy = 0; pet.vx = 0; pet.gvy = 0;
    pet.sqv += clamp(impact * .0024, .8, 4.5);
    play('land', 'move', kind !== 'jump' && impact > 1000);
    dustAt(128, impact > 900 ? 7 : 3, 70);
    if (kind === 'throw' && impact > 1000) { setMode('dizzy'); onEvent('touch', { kind: 'crash' }); return; }
    setMode('land');
    if (kind === 'throw') { pet.expr = 'surprised'; pet.exprUntil = T + .9; pet.nextAt = T + 2; }
    else if (kind === 'drop') { pet.expr = 'happy'; pet.exprUntil = T + 1.6; pet.nextAt = T + 2.6; }
    else pet.nextAt = T + rnd(.8, 2);
  }

  function render() {
    const fc = pet._fc || FACES.neutral.f(0), fname = pet._fname || 'neutral';
    const drag = pet.mode === 'drag';
    const br = Math.sin(T * (pet.mode === 'sleep' ? 1.7 : 2.4));
    const sx = (1 + pet.sq * .7) * (1 - .05 * pet.stretch) * (1 - .009 * br);
    const sy = (1 - pet.sq) * (1 + .09 * pet.stretch) * (1 + .016 * br);
    const ax = 128, ay = drag ? 36 : 256;
    let AX = drag ? pet.dx : pet.x, AY = drag ? pet.dy : pet.fy;
    if (fc.shake) AX += Math.sin(T * 60) * 1.4;
    else if (pet.pulse?.kind === 'shiver') AX += Math.sin(T * 75) * 1.1 * envelope((T - pet.pulse.t0) / pet.pulse.dur, .08, .85);
    // a figure may keep tilt and lean off the whole group and bend its own parts instead
    const kx = S * pet.faceVis * sx, ky = S * sy, lean = pet.lean * pet.faceVis;
    const rot = custom?.groupTilt ? custom.groupTilt(pet.mode, pet.tilt, lean) : pet.tilt + lean;
    pet.xf = { AX, AY, ax, ay, kx, ky, rot };
    petG.setAttribute('transform', `translate(${f(AX)} ${f(AY)}) rotate(${f(rot)}) scale(${kx.toFixed(4)} ${ky.toFixed(4)}) translate(${-ax} ${-ay})`);

    const legs = pet.feet.map((ft, i) => [HIPS[i][0], HIPS[i][1] + pet.low, ft[0], ft[1]]);
    // drowsy blinks are slower
    const bd = .16 + .3 * pet.drowse, blink = pet.blinkAge < bd ? Math.sin(Math.PI * pet.blinkAge / bd) : 0;
    let eyes = pet.eyeCur || fc.eyes, eyeClose = 0;
    if (pet.swapAge < .07 && pet.eyePrev) { eyes = pet.eyePrev; eyeClose = pet.swapAge / .07; }
    else if (pet.swapAge < .16) eyeClose = 1 - (pet.swapAge - .07) / .09;
    const face = { ...fc, eyes, gap: pet.gap.map(g => Math.min(64, g + pet.talkK * 12)), blush: pet.blushK };
    const gesture = pet.pulse ? { kind: pet.pulse.kind, k: clamp((T - pet.pulse.t0) / pet.pulse.dur, 0, 1) } : null;
    custom.draw(petG, face, {
      look: pet.look, legs, low: pet.low, t: T, blink, eyeClose, acc: skin, swing: pet.swing,
      face: fname, mode: pet.mode, modeT: pet.modeT, talk: pet.talkK, status: pet.status, drowse: pet.drowse, sit: pet.sitK, facing: pet.faceVis, tilt: pet.tilt, lean, groupRot: rot, gesture,
    });

    const footY = drag ? pet.dy + 220 * S * 1.09 : pet.fy;
    // a free body held up casts its shadow just under it, there being no floor below it to fall to
    const shadowY = freeGround && drag ? footY + 40 * S : groundY();
    const k = clamp(1 - (shadowY - footY) / 420, .3, 1);
    shadowEl.setAttribute('cx', f(AX)); shadowEl.setAttribute('cy', f(shadowY - 2));
    shadowEl.setAttribute('rx', f(72 * S * k * (1 + pet.sq * .5))); shadowEl.setAttribute('ry', f(10 * S * k + 1));
    shadowEl.setAttribute('opacity', f(k));

    let s = '';
    const sc = S / .48;
    // sleep z's take the eye colour, or the figure's own colour for them
    const zPaint = custom?.colors?.z ? `stroke="${custom.colors.z}"` : 'class="eye"';
    for (const p of P) {
      const a = p.age / p.life;
      if (p.type === 'z') {
        const op = a < .15 ? a / .15 : 1 - (a - .15) / .85, z = (.7 + .9 * a) * sc;
        s += `<path ${zPaint} fill="none" stroke-width="${f(3 / z)}" stroke-linecap="round" stroke-linejoin="round" opacity="${f(op)}" transform="translate(${f(p.x + Math.sin(p.age * 2.5) * 6)} ${f(p.y)}) scale(${f(z)})" d="M-6 -7H6L-6 7H6"/>`;
      } else if (p.type === 'heart') {
        s += `<path class="p-heart" fill="none" stroke-width="5" stroke-linejoin="round" opacity="${f(1 - a * a)}" transform="translate(${f(p.x + Math.sin(p.age * 4) * 5)} ${f(p.y)}) scale(${f((.45 + .35 * a) * sc)})" d="${heartD(0, 0, 1)}"/>`;
      } else if (p.type === 'dust') {
        s += `<circle class="p-dust" fill="none" stroke-width="2" cx="${f(p.x)}" cy="${f(p.y)}" r="${f((3 + 8 * a) * sc)}" opacity="${f(.7 * (1 - a))}"/>`;
      } else if (p.type === 'note') {
        const op = a < .15 ? a / .15 : 1 - (a - .15) / .85, z = (.8 + .4 * a) * sc;
        s += `<g opacity="${f(op)}" transform="translate(${f(p.x + Math.sin(p.age * 3) * 8)} ${f(p.y)}) scale(${f(z)})"><path ${zPaint} fill="none" stroke-width="2.4" stroke-linecap="round" d="M3 4V-9L9 -6"/><circle ${zPaint} fill="none" stroke-width="3.6" cx="0" cy="4.5" r="1.8"/></g>`;
      } else if (p.type === 'drop') {
        s += `<path class="tearf" transform="translate(${f(p.x)} ${f(p.y)}) scale(${f(.9 * sc)})" d="${DROP}"/>`;
      }
    }
    fxG.innerHTML = s;
    return fname;
  }

  /* pointer: stage-pixel coordinates; `p.t` is when it happened (ms), else now */
  const now = (p) => p?.t ?? performance.now();
  function velocity() {
    const s = pointer.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0], b = s[s.length - 1], dt = Math.max(.016, (b.t - a.t) / 1000);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
  /** Picks the body up by the scruff; it then follows the pointer until let go of. */
  function grab() {
    const scruff = toStage(128, 36);
    pet.expr = null;
    setMode('drag', { dx: scruff.x, dy: scruff.y });
    play('grab', 'touch');
    pet.sqv -= 1.2; pet.tiltV = 0;
    onEvent('touch', { kind: 'grab' });
  }
  function pointerDown(p) {
    Object.assign(pointer, { x: p.x, y: p.y, inside: true });
    if (!hitPet(p)) return false;
    press = { x: p.x, y: p.y, t: now(p) };
    pointer.samples = [{ t: now(p), x: p.x, y: p.y }];
    // caught while falling or flying: held at once, since the body would fall on while the pointer moved the drag threshold
    if (pet.mode === 'air') grab();
    return true;
  }
  /** Returns the cursor the stage should show. */
  function pointerMove(p) {
    const t = now(p);
    const ddx = p.x - pointer.x, ddy = p.y - pointer.y;
    Object.assign(pointer, { x: p.x, y: p.y, inside: true });
    pointer.samples.push({ t, x: p.x, y: p.y });
    while (pointer.samples.length > 2 && t - pointer.samples[0].t > 110) pointer.samples.shift();
    pointer.vx = lerp(pointer.vx, velocity().x, .35);

    if (press && pet.mode !== 'drag' && Math.hypot(p.x - press.x, p.y - press.y) > 6) grab();
    if (press) return (pet.cursor = 'grabbing');
    const over = hitPet(p);
    if (over && ['idle', 'look', 'sit', 'sleep'].includes(pet.mode)) {
      strokeAcc += Math.hypot(ddx, ddy);
      if (strokeAcc > 320 && petCool <= 0) {
        strokeAcc = 0; petCool = 2.5;
        play('purr', 'touch');
        if (pet.mode === 'sleep') emitHeart();
        else setExpr(Math.random() < .5 ? 'love' : 'shy');
        onEvent('touch', { kind: 'pet', asleep: pet.mode === 'sleep' });
      }
    }
    return (pet.cursor = over ? 'grab' : '');
  }
  function pointerUp(p) {
    pet.cursor = '';
    if (!press) return;
    if (pet.mode === 'drag') {
      // hand over from the scruff anchor to the feet anchor without a visual jump
      const foot = toStage(128, 256);
      const v = velocity();
      pet.x = clamp(foot.x, minX(), maxX());
      const speed = Math.hypot(v.x, v.y);
      if (freeGround) {
        // set down where it was let go of; a throw tosses it on across the stage, higher the faster it went
        pet.gy = clamp(foot.y, minY(), floorY); pet.fy = Math.min(pet.gy, foot.y);
        pet.vx = clamp(v.x, -1800, 1800); pet.gvy = clamp(v.y, -1800, 1800) * .6; pet.vy = -Math.min(1400, speed * .6);
      } else {
        pet.fy = Math.min(floorY, foot.y);
        pet.vx = clamp(v.x, -1800, 1800); pet.vy = clamp(v.y, -1800, 1400);
      }
      pet.airKind = 'throw';
      if (speed > 700) play('whoosh', 'move');
      setMode('air');
      onEvent('touch', { kind: speed > 700 ? 'throw' : 'drop', x: Math.round(pet.x) });
    } else if (now(p) - press.t < 400) {
      if (pet.mode === 'sleep' || pet.mode === 'sit') {
        const wasAsleep = pet.mode === 'sleep';
        setMode('wake', { startle: true }); pet.sqv -= 2.2; pet.nextAt = T + 2.4;
        play('surprised', 'face');
        onEvent('touch', { kind: 'poke', woke: wasAsleep });
      } else if (pet.mode !== 'dizzy') {
        play('poke', 'touch');
        const r = ['happy', 'wink', 'surprised', 'love', 'angry'][Math.floor(Math.random() * 5)];
        setExpr(r);
        if (Math.random() < .5 && pet.mode === 'idle') setMode('crouch', { jumpV: 480, jumpVx: 0 });
        onEvent('touch', { kind: 'poke' });
      }
    }
    press = null;
  }
  /**
   * Ends a drag with the body dropped from under stage point `p` with no throw: the pointer was let
   * go of on another display and the stage now covers that one. Call after `resize()` has taken the
   * new size.
   */
  function dropAt(p) {
    press = null;
    if (pet.mode !== 'drag') return;
    Object.assign(pointer, { x: p.x, y: p.y, vx: 0, samples: [] });
    pet.x = clamp(p.x, minX(), maxX());
    pet.fy = Math.min(floorY, p.y + 220 * S);
    if (freeGround) pet.gy = clamp(pet.fy, minY(), floorY);
    pet.vx = 0; pet.vy = 0; pet.gvy = 0;
    pet.airKind = 'drop';
    setMode('air');
    onEvent('touch', { kind: 'drop', x: Math.round(pet.x) });
  }
  /**
   * Keeps a held body under the pointer when the stage moved to another display mid-drag: every
   * point on screen now sits (dx, dy) stage pixels from where it was.
   */
  function shiftDrag(dx, dy) {
    if (pet.mode !== 'drag') return;
    pet.dx += dx; pet.dy += dy; pet.x += dx;
    pointer.x += dx; pointer.y += dy;
    for (const s of pointer.samples) { s.x += dx; s.y += dy; }
    if (press) { press.x += dx; press.y += dy; }
  }
  function pointerLeave() { if (!press) pointer.inside = false; }

  /** Head top in stage pixels, for placing a speech bubble. */
  const anchor = () => toStage(A.bubble[0], A.bubble[1] + pet.low);

  /**
   * Where the body is and what it is doing, in stage pixels, for the page around it: its box and hit
   * circles, the bubble's spot, the point the hover buttons sit beside (`side`, with `reach` from it to
   * the body's edge), and the cursor to show.
   */
  function layout() {
    const [x0, y0, x1, y1] = custom?.extent ?? EXTENT;
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => toStage(x, y));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const side = toStage(128, 128 + pet.low);
    return {
      x: pet.x, ...(freeGround ? { y: pet.gy } : {}), facing: pet.facing, mode: pet.mode, busy: busy(), pressing: !!press, cursor: pet.cursor,
      moving: !!press || MOVING_MODES.has(pet.mode) || !!pet.pulse || Math.abs(pet.faceVis - pet.facing) > .05,
      box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      hit: hits(), bubble: anchor(), side: { x: side.x, y: side.y, reach: 104 * S },
    };
  }

  resize();
  custom?.setSkin?.(skin);
  return {
    pet, step, render, resize, act, setExpr, doWord, walkTo, stopWalk, toStage, hitPet, busy, layout,
    pointerDown, pointerMove, pointerUp, pointerLeave, dropAt, shiftDrag,
    get pressing() { return !!press; },
    /** Pressed, carried, airborne, walking, running, dancing, turning round, or in a short gesture (nod, wave, bow…): motion that frames far apart show as jumps. */
    get moving() {
      return !!press || MOVING_MODES.has(pet.mode) || !!pet.pulse || Math.abs(pet.faceVis - pet.facing) > .05;
    },
    get time() { return T; },
    get bounds() { return { W, H, floorY, S, minX: minX(), maxX: maxX(), minY: minY() }; },
    /** A free body stands anywhere on the stage (`opts.ground`). */
    freeGround,
    setSkin(s) { skin = s; custom?.setSkin?.(s); },
    /** Swaps the body's drawing (see `opts.figure`). */
    setFigure(fig) {
      if (fig === custom) return;
      // a swapped-out figure may hold a WebGL context; release it now instead of waiting for GC
      custom?.dispose?.();
      custom = fig;
      custom.setSkin?.(skin);
      A = anchors();
      petG.textContent = '';
      render();
    },
    get figure() { return custom; },
    get skin() { return skin; },
    setRoam(r) { roam = r; if (r !== 'off') pet.nextAt = T + 1; },
    get roam() { return roam; },
    /** Outside orders keep free roaming quiet for `seconds`. */
    holdRoam(seconds) { hold = Math.max(hold, T + seconds); },
    talk() { pet.talkK = 1; },
    setListening(on) { pet.listening = on; if (on && (pet.mode === 'walk' || pet.mode === 'run')) setMode('idle'); },
    setThinking(on) { pet.thinking = on; },
    /** What the bot is busy with as the page's status bubble names it (`kind`), or null; the figure reads it from `frame.status`. */
    setStatus(kind) { pet.status = typeof kind === 'string' ? kind : null; },
    /** The page shows the bot's thinking in a bubble of its own. */
    setThoughtShown(on) { pet.thoughtShown = on; },
    anchor,
    emitHeart,
  };
}

/* ---------- the body a pack hands the figure frame ---------- */
/** Colours of what the kit draws itself (shadow, particles; z's take the `eye` class without a figure colour). */
const KIT_CSS = `
:root{--shadow:rgba(27,22,38,.12);--tear:#5AAEF0;--heart:#F0567A;--dust:#A39DB0;--skin-eye:#00A870}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--shadow:rgba(0,0,0,.32);--tear:#6BBDF7;--heart:#FF6F93;--dust:#5B6472;--skin-eye:#2FD59B}}
:root[data-theme="dark"]{--shadow:rgba(0,0,0,.32);--tear:#6BBDF7;--heart:#FF6F93;--dust:#5B6472;--skin-eye:#2FD59B}
.shadow{fill:var(--shadow)} .tearf{fill:var(--tear)} .p-heart{stroke:var(--heart)} .p-dust{stroke:var(--dust)} .eye{stroke:var(--skin-eye)}
svg.kit{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
`;
const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * The body contract (api 2, web/figure-frame.js) on top of `createPet`: what a pack's factory returns.
 * `host` is what the frame gives the factory: `root` (the element to draw in), `bounds()`, `emit(kind, detail)`
 * for what happens to the body, `sound(name, kind, ...args)` for what it wants heard, and `start` ({ x, y, facing,
 * enter, skin }: where it stands (`y`, its ground line, only for a free body that stood off the floor), or enter
 * 'drop' to fall in from above, and the skin to wear). `opts` are createPet's, with `figure` required; `opts.css` is
 * more style for the frame's document (a figure's own classes) and `opts.skinCss(skin)` the style that follows the skin.
 * `opts.moves` answers the pack's own targets (its manifest's `moves`): `{ id: (params, bounds) => ({ x, y? }) | null }`
 * gives the stage point to walk to for those params (bounds as `bounds()` gives them, with `minX` `maxX` `minY`);
 * null, or a target it does not name, answers the move `busy`.
 *
 * The body takes these calls from the page: step(dt), layout(), do(word), walk(x, run, id), stopWalk(id), pointer(type, p),
 * drop(p), shift(dx, dy), place(x, facing, y), move(args, id), set({ roam, hold, dialogOpen, listening, thinking, thoughtShown, status, skin, theme }),
 * cue(kind), talk(), setScheme(id, o), dispose(); `words` lists every word its do() knows.
 */
export function createBody(host, opts) {
  const doc = host.root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = KIT_CSS + (opts.css ?? '');
  doc.head.appendChild(style);
  const svg = doc.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'kit');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<ellipse class="shadow" cx="0" cy="0" rx="0" ry="0"/><g></g><g></g>';
  host.root.appendChild(svg);
  const [shadowEl, petG, fxG] = svg.children;
  const skinStyle = doc.createElement('style');
  doc.head.appendChild(skinStyle);
  const start = host.start ?? {};
  if (opts.skinCss && start.skin) skinStyle.textContent = opts.skinCss(start.skin);
  let dialogOpen = false;
  const ctl = createPet({ petG, shadowEl, fxG }, {
    ...opts,
    skin: start.skin ?? null, startX: start.x, startY: start.y, enter: start.enter,
    bounds: host.bounds,
    onEvent: host.emit,
    sfx: { play: host.sound },
    dialogOpen: () => dialogOpen,
  });
  if (start.facing === 1 || start.facing === -1) ctl.pet.facing = ctl.pet.faceVis = start.facing;
  return {
    step(dt) { ctl.step(dt); ctl.render(); },
    layout: ctl.layout,
    resize: ctl.resize,
    do: ctl.doWord,
    words: [...KIT_EXPRESSIONS, ...KIT_MOTIONS, ...Object.keys(opts.words ?? {}).filter((w) => opts.words[w]?.expression || opts.words[w]?.motion)],
    walk: (x, run, id) => ctl.walkTo(x, run, id),
    stopWalk: (id) => ctl.stopWalk(id),
    move(args, id) {
      const to = opts.moves?.[args?.to];
      const p = typeof to === 'function' ? to(args.params ?? {}, { ...host.bounds(), ...ctl.bounds }) : null;
      return !!p && ctl.walkTo(p.x, !!args.run, id, p.y);
    },
    pointer(type, p) {
      if (type === 'down') ctl.pointerDown(p);
      else if (type === 'move') ctl.pointerMove(p);
      else if (type === 'up' || type === 'cancel') ctl.pointerUp(p);
      else if (type === 'leave') ctl.pointerLeave();
    },
    drop: ctl.dropAt,
    shift: ctl.shiftDrag,
    /** Puts a body that is standing at stage x, turned to `facing` (1 right, -1 left); a free body also on ground line `y`. */
    place(x, facing, y) {
      if (ctl.pet.mode === 'drag' || ctl.pet.mode === 'air') return;
      const { minX, maxX, minY, floorY } = ctl.bounds;
      ctl.pet.x = ctl.pet.target = clamp(x, minX, maxX);
      if (ctl.freeGround && typeof y === 'number' && Number.isFinite(y)) ctl.pet.gy = ctl.pet.targetY = ctl.pet.fy = clamp(y, minY, floorY);
      if (facing === 1 || facing === -1) ctl.pet.facing = ctl.pet.faceVis = facing;
    },
    set(s) {
      if (s.roam) ctl.setRoam(s.roam);
      if (typeof s.hold === 'number') ctl.holdRoam(s.hold);
      if (typeof s.dialogOpen === 'boolean') dialogOpen = s.dialogOpen;
      if (typeof s.listening === 'boolean') ctl.setListening(s.listening);
      if (typeof s.thinking === 'boolean') ctl.setThinking(s.thinking);
      if (typeof s.thoughtShown === 'boolean') ctl.setThoughtShown(s.thoughtShown);
      if ('status' in s) ctl.setStatus(s.status);
      if (s.skin) { ctl.setSkin(s.skin); if (opts.skinCss) skinStyle.textContent = opts.skinCss(s.skin); }
      if (s.theme) doc.documentElement.dataset.theme = s.theme;
    },
    /** The page's own moments: a talk key tapped (`perk`), speech heard (`heard`), an answer sent (`cheer`), a dress pick (`bounce`). */
    cue(kind) {
      if (kind === 'perk') { ctl.pet.sqv += .6; ctl.setExpr('surprised', .5); }
      else if (kind === 'heard') ctl.pet.sqv += .9;
      else if (kind === 'cheer') ctl.setExpr('happy');
      else if (kind === 'bounce') ctl.pet.sqv += 1.2;
    },
    talk: ctl.talk,
    setScheme: (id, o) => opts.figure.setScheme?.(id, o),
    get z() { return opts.figure.colors?.z ?? null; },
    dispose() { opts.figure.dispose?.(); svg.remove(); style.remove(); skinStyle.remove(); },
  };
}
