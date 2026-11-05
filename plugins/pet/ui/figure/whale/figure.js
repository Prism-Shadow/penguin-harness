/**
 * The DeepSeek whale maid as a figure for the kit (web/kit/body.js): a sprite rig drawn with the kit's createRig (kit/rig.js).
 *
 * She stands the way Coo does, three-quarters on and facing right; the kit mirrors the whole
 * group when she turns. The kit runs the body (walking, jumping, dragging, faces); this file turns
 * each frame it hands over into rig parameters, runs springs for hair, skirt, tail, fins and ahoge,
 * paints the face (eyes, mouth, blush) into a live texture, and draws the rig into a canvas that
 * lives in the pet's own SVG group, so the stage's transform (position, squash, tilt, facing) applies.
 *
 * Every layer was cut from one master drawing, so at rest the parts line up pixel for pixel;
 * what each part hides (the dress under the arm, the hair behind the face, the legs under the
 * skirt) was painted in by edits of that same drawing.
 *
 * Rig space = the kit's logo space: x=128 under the body, soles at y=256.
 * model.json keeps the master drawing's pixel frame for the face sprites; U/V convert.
 */
const f1 = n => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const bump = u => Math.sin(Math.PI * clamp(u, 0, 1));
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const SVGNS = 'http://www.w3.org/2000/svg';

// the face texture covers this rect of the master drawing, one texel per master pixel
const FACE = { x: 520, y: 578, w: 390, h: 252 };
// the head's parallax warps act over this rect (rig units); the long hair below it stays put
const HEAD = [30, 12, 215, 168];

/**
 * A leg's warp: from 14 units below the hip pivot down it turns about the pivot by `a` degrees as a rigid
 * rotation would; above that the turn fades out over 20 units, so the top of the bloomer, which a rotation
 * would swing out past the narrow top of the skirt at the waist, stays where it was drawn. `ty` lifts the leg
 * the same way: all of it below the hinge, none of the bloomer's top, which would rise above the skirt.
 */
function hinge([px, py], a, ty) {
  const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
  return (u, v, x, y) => {
    const w = smooth(py - 6, py + 14, y), lx = x - px, ly = y - py;
    return [(lx * c - ly * s - lx) * w, ((lx * s + ly * c - ly) + ty) * w];
  };
}

/* ---------- springs ---------- */
// `lim` bounds the output: a hard throw may overshoot, the hair must not fold over itself
/** Whether a spring was handed a target that is not a finite number yet: logged the first time only. */
let badTargetLogged = false;
function spring(k, c, lim = Infinity) {
  return {
    x: 0, v: 0,
    step(target, dt) {
      // a NaN target would stay in x for good, and the warps that read it (hair, tail, skirt) draw nothing
      if (!Number.isFinite(target) || !Number.isFinite(dt)) {
        if (!badTargetLogged) { badTargetLogged = true; console.warn(`[大肥鱼] 弹簧收到的目标不是有限数,这一帧不动:target=${target} dt=${dt}`); }
        return this.x;
      }
      this.v += ((target - this.x) * k - this.v * c) * dt;
      this.x += this.v * dt;
      if (Math.abs(this.x) > lim) { this.x = Math.sign(this.x) * lim; this.v = 0; }
      return this.x;
    },
  };
}

function loadImage(url) {
  return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
}

/**
 * Loads the model and textures; resolves to a figure object for the kit's `opts.figure` (createPet, createBody).
 * `opts.raster` shows each frame as an SVG <image> copied from the canvas instead of the canvas itself (slower;
 * for pages that are screen-recorded, where a WebGL canvas inside SVG is not always in the capture).
 * `opts.scheme` picks a colour scheme (model.schemes) and an outfit (model.outfits) as `<scheme>-<outfit>`, the
 * pack's two axes; a bare `<scheme>` is the first outfit, the maid dress. `opts.model` (model.json
 * already parsed) and `opts.asset(path)` (a texture's URL) are for pages that bundle the files;
 * `opts.loadImage` is the figure frame's (figure-frame.js), which loads images WebGL may read there.
 * `opts.kit` is the frame's kit, whose `createRig` draws her; without it (a page that imports this file
 * from the package) the package's own kit/rig.js does. A pack installed elsewhere has no ../kit/.
 */
export async function createWhaleFigure(base = new URL('./', import.meta.url), opts = {}) {
  const createRig = opts.kit?.createRig ?? (await import('../kit/rig.js')).createRig;
  const model = opts.model || await (await fetch(new URL('model.json', base))).json();
  const asset = opts.asset || (p => new URL(p, base));
  const load = opts.loadImage || loadImage;
  const { S, X0, FEET } = model.units;
  const U = x => 128 + (x - X0) * S, V = y => 256 - (FEET - y) * S;
  const feat = model.feat;
  const EYES = ['eyeL', 'eyeR'];  // near (left) eye, far (right) eye
  const featNames = [...Object.keys(feat.sprites), ...EYES.flatMap(k => ['lash', 'ball', 'iris', ...(feat.eyes[k].rim ? ['rim'] : [])].map(n => `${k}_${n}`))];
  // a scheme is a set of textures over the same geometry; the original's are at tex/ and feat/
  const SCHEMES = (model.schemes || [{ id: 'deepseek' }]).filter(sc => sc.ready !== false);
  const schemeInfo = id => SCHEMES.find(sc => sc.id === id) || SCHEMES[0];
  // an outfit is its own part list: the maid dress is model.parts; another lists the parts it keeps from it and
  // its own, whose `src` is the texture file (drawn in the outfit's colours, which no scheme changes); an own part
  // without `src` has a texture in every scheme, beside the maid dress's
  const OUTFITS = model.outfits || [{ id: 'maid' }];
  const outfitInfo = id => OUTFITS.find(o => o.id === id) || OUTFITS[0];
  const pickOf = id => { const [c, o] = String(id ?? '').split('-'); return { scheme: schemeInfo(c).id, outfit: outfitInfo(o).id }; };
  const partsOf = id => outfitInfo(id).parts || model.parts;
  // the scheme's accent colours the listening arcs, thought bubbles and sleep z's
  const accent = () => schemeInfo(scheme).accent || '#4d6bfe';
  const loaded = {}, ready = {};
  function loadScheme(sc, of) {
    const key = `${sc}-${of}`;
    if (loaded[key]) return loaded[key];
    const dir = sc === SCHEMES[0].id ? '' : `schemes/${sc}/`;
    const set = { tex: {}, img: {} };
    loaded[key] = Promise.all([
      // an outfit's own part with a `src` is drawn in the outfit's colours
      ...partsOf(of).map(async p => { set.tex[p.tex] = await load(asset(p.src || `${dir}tex/${p.tex}.png`)); }),
      ...featNames.map(async n => { set.img[n] = await load(asset(`${dir}feat/${n}.png`)); }),
      // a scheme with `eyeHighlights` has each eye's highlights as their own sprite and an iris without them
      ...(schemeInfo(sc).eyeHighlights ? EYES.map(async k => { set.img[`${k}_hl`] = await load(asset(`${dir}feat/${k}_hl.png`)); }) : []),
    ]).then(() => (ready[key] = set));
    return loaded[key];
  }
  let { scheme, outfit } = pickOf(opts.scheme);
  let { tex, img } = await loadScheme(scheme, outfit);

  // each brow on the master: where its stroke ends, and the stretch of the brows texture it owns (x)
  const BROWS = [
    { outer: [610, 559.5], inner: [703, 548.7], x0: 596, x1: 765 },  // near
    { outer: [890, 560.8], inner: [837, 555.6], x0: 765, x1: 904 },  // far
  ];

  /** The rig's deformers and parts for an outfit; its pivots and boxes override the maid dress's. */
  function layoutOf(of) {
    const list = partsOf(of);
    const PV = { ...model.pivots, ...outfitInfo(of).pivots };
    const box = Object.fromEntries([...model.parts, ...list].map(p => [p.id, p.box]));
    const rectOf = id => { const [x, y, w, h] = box[id]; return [x, y, x + w, y + h]; };

    /* deformers: each acts in rest space; parents act after children */
    const deformers = {
      body: { kind: 'rot', pivot: PV.body },
      skirt: { kind: 'warp', parent: 'body', rect: rectOf('skirt') },
      skirtSit: { kind: 'warp', parent: 'body', rect: rectOf('skirt_sit') },
      // the upper body (bodice, arms, head) turns about the waist for a bow; the skirt and legs stay put
      waist: { kind: 'rot', parent: 'body', pivot: PV.waist },
      armNear: { kind: 'rot', parent: 'waist', pivot: PV.armNear },
      armFar: { kind: 'rot', parent: 'waist', pivot: PV.armFar },
      // the legs swing about the hip (see `hinge`), as warps so the bloomer above it stays under the skirt
      legBack: { kind: 'warp', parent: 'body', rect: rectOf('leg_back') },
      legFront: { kind: 'warp', parent: 'body', rect: rectOf('leg_front') },
      tail: { kind: 'rot', parent: 'body', pivot: PV.tail },
      tailBend: { kind: 'warp', parent: 'tail', rect: rectOf('tail') },
      neck: { kind: 'rot', parent: 'waist', pivot: PV.neck },
      headBack: { kind: 'warp', parent: 'neck', rect: HEAD },
      headMid: { kind: 'warp', parent: 'neck', rect: HEAD },
      headFeat: { kind: 'warp', parent: 'neck', rect: HEAD },
      headFront: { kind: 'warp', parent: 'neck', rect: HEAD },
      hairSway: { kind: 'warp', parent: 'headBack', rect: rectOf('hair_back') },
      bangsSway: { kind: 'warp', parent: 'headFront', rect: rectOf('bangs') },
      finNear: { kind: 'rot', parent: 'headMid', pivot: PV.finNear },
      finFar: { kind: 'rot', parent: 'headBack', pivot: PV.finFar },
      ahoge: { kind: 'rot', parent: 'headFront', pivot: PV.ahoge },
    };
    // an outfit's own pieces that hang and swing about a root (pompoms on the hood ties, scarf ends)
    const swings = outfitInfo(of).deformers || {};
    for (const [k, d] of Object.entries(swings)) deformers[k] = { kind: 'rot', parent: d.parent, pivot: d.pivot };
    const parts = list.map(p => ({ ...p, parent: p.id === 'torso_up' ? 'waist' : p.parent }));
    // the face features ride a little ahead of the face for the turn
    parts.push({ id: 'faceFx', tex: 'faceFx', box: [U(FACE.x), V(FACE.y), FACE.w * S, FACE.h * S], z: 9, parent: 'headFeat', grid: [4, 4] });
    // the brows lie on the skin under the fringe, and show through the hair: each is drawn again over the
    // fringe, faint. As in a Live2D model each brow moves and turns as a whole about the middle of the line
    // between its ends, and bends a little; the sorry faces swap in the same drawing turned over that line,
    // so the arch becomes a dip with the stroke as drawn, crossfading.
    const brows = parts.find(p => p.id === 'brows');
    if (brows) {
      parts.splice(parts.indexOf(brows), 1);
      const [bx, by, bw, bh] = brows.box;
      BROWS.forEach((b, i) => {
        const x0 = Math.max(bx, U(b.x0)), x1 = Math.min(bx + bw, U(b.x1)), u0 = (x0 - bx) / bw, u1 = (x1 - bx) / bw;
        const mid = [U((b.outer[0] + b.inner[0]) / 2), V((b.outer[1] + b.inner[1]) / 2)];
        deformers[`brow${i}`] = { kind: 'rot', parent: 'headFeat', pivot: mid };
        deformers[`browBend${i}`] = { kind: 'warp', parent: `brow${i}`, rect: [x0, by, x1, by + bh] };
        deformers[`browOver${i}`] = { kind: 'rot', parent: `browBend${i}`, pivot: mid };
        for (const [layer, z, alpha] of [['', brows.z, 1], ['_through', 13.2, .55]]) {
          parts.push({ ...brows, id: `brow${i}${layer}`, box: [x0, by, x1 - x0, bh], uvBox: [u0, 0, u1, 1], parent: `browBend${i}`, z, alpha, grid: [12, 2] });
          // mirrored about the middle's height (the texture upside down in the mirrored box); `browOver` turns it back onto the line
          parts.push({ ...brows, id: `browOver${i}${layer}`, box: [x0, 2 * mid[1] - by - bh, x1 - x0, bh], uvBox: [u0, 1, u1, 0], parent: `browOver${i}`, z, alpha, grid: [12, 2] });
        }
      });
    }
    // the lid creases follow each eye's upper lid down when the eye narrows, and go when it closes
    const creases = parts.find(p => p.id === 'eye_creases');
    if (creases) {
      deformers.creases = { kind: 'warp', parent: 'headFeat', rect: rectOf('eye_creases') };
      creases.parent = 'creases';
    }
    // how far the arms fly out while she is held, as a share of the maid dress's (short sleeves look wrong flung wide)
    const heldArms = outfitInfo(of).heldArms ?? 1;
    // an outfit whose tail turns about its root inside the body (`tailRoot`) bends it from there to the tip (see `tailBend`)
    const tailRoot = outfitInfo(of).tailRoot ? { x: PV.tail[0], tip: rectOf('tail')[0] } : null;
    return { PV, deformers, parts, brows, creases, swings, heldArms, tailRoot };
  }
  let L = layoutOf(outfit);

  /* ---------- face painting (master pixels) ---------- */
  const faceCv = document.createElement('canvas');
  faceCv.width = FACE.w; faceCv.height = FACE.h;
  // while a scheme fades in, the face is painted a second time with the incoming scheme's sprites
  const faceCv2 = document.createElement('canvas');
  faceCv2.width = FACE.w; faceCv2.height = FACE.h;
  const fg1 = faceCv.getContext('2d'), fg2 = faceCv2.getContext('2d');
  let fg = fg1;
  const eyeCv = document.createElement('canvas');
  const INK = '#5a2330';
  const poly2 = (c, x) => c[0] * x * x + c[1] * x + c[2];

  // how far the lid travels to close: from the lid line down past the lower rim
  const EYE = Object.fromEntries(EYES.map(k => {
    const e = feat.eyes[k], [x0, , x1] = e.ball;
    let h = 0;
    for (let x = x0 + 4; x < x1 - 4; x += 2) h = Math.max(h, poly2(e.rimFit, x) - poly2(e.lidFit, x));
    const cx = (e.iris[0] + e.iris[2]) / 2;
    return [k, { ...e, travel: h + 2, cx, cy: poly2(e.lidFit, cx) }];
  }));

  // the eye highlights' state this frame (master pixels), stepped once per frame in draw()
  const hl = { dx: 0, dy: 0, scale: 1, quiver: 0, alpha: 1 };
  // how each face changes the highlights: welling eyes quiver and shine bigger, a glare narrows them, drowsy eyes dull
  const HL_MOOD = {
    sad: { scale: 1.12, quiver: 1 }, worried: { scale: 1.1, quiver: .8 }, shy: { scale: 1.1, quiver: .6 }, pout: { scale: 1.06, quiver: .4 },
    excited: { scale: 1.18 }, listening: { scale: 1.06 }, angry: { scale: .78 }, determined: { scale: .86 },
    sleepy: { scale: .92, alpha: .7 }, content: { alpha: .8 }, waking: { alpha: .75 },
  };

  /**
   * The neutral eye with its lid at `open` (0 shut, 1 rest), iris moved by ix/iy, lid tilted by tilt (rad);
   * `glint` (0..1) adds star highlights on the iris, which twinkle with `t`.
   */
  function paintOpenEye(k, open, ix, iy, tilt, glint = 0, t = 0) {
    const e = EYE[k], [bx0, by0, bx1, by1] = e.ball, w = bx1 - bx0, h = by1 - by0;
    if (eyeCv.width !== w + 40 || eyeCv.height !== h + 40) { eyeCv.width = w + 40; eyeCv.height = h + 40; }
    const g = eyeCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 20 - bx0, 20 - by0);
    g.clearRect(bx0 - 20, by0 - 20, w + 40, h + 40);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(img[`${k}_ball`], bx0, by0);
    g.globalCompositeOperation = 'source-atop';
    g.drawImage(img[`${k}_iris`], e.iris[0] + ix, e.iris[1] + iy);
    const d = (1 - clamp(open, 0, 1)) * e.travel, tn = Math.tan(tilt);
    const hlImg = img[`${k}_hl`];
    if (hlImg && e.hl) {
      // the highlights ride on the iris, trail it on their spring, are pushed down by a closing lid as far as the
      // iris's middle (so a half-shut eye still shines) and take the face's size, quiver and strength; the far
      // eye's x is foreshortened
      const gx = k === 'eyeL' ? 1 : .35, ph = k === 'eyeL' ? 0 : 1.7, q = hl.quiver;
      const w = hlImg.width * hl.scale, h = hlImg.height * hl.scale;
      const cx = (e.hl[0] + e.hl[2]) / 2 + ix + (hl.dx + q * .8 * Math.sin(t * 29 + ph)) * gx;
      let cy = (e.hl[1] + e.hl[3]) / 2 + iy + hl.dy + q * .6 * Math.sin(t * 37 + ph);
      const lid = poly2(e.lidFit, clamp(cx, bx0, bx1)) + d + tn * (cx - e.cx) + 2;
      if (cy - h / 2 < lid) cy = Math.max(cy, Math.min(lid + h / 2, (e.iris[1] + e.iris[3]) / 2 + iy));
      g.globalAlpha = hl.alpha;
      g.drawImage(hlImg, cx - w / 2, cy - h / 2, w, h);
      g.globalAlpha = 1;
    }
    // the eye's outline over the iris, so a shifted iris tucks under it
    if (e.rim) { g.globalCompositeOperation = 'source-over'; g.drawImage(img[`${k}_rim`], e.rim[0], e.rim[1]); }
    if (glint > 0) {
      // white four-point stars on the iris, the far eye's foreshortened; painted inside the eye, so the lid and lashes cover them
      g.globalCompositeOperation = 'source-atop';
      const sc = k === 'eyeL' ? 1 : .6, ic = [(e.iris[0] + e.iris[2]) / 2 + ix, (e.iris[1] + e.iris[3]) / 2 + iy];
      [[-.16, -.2, 24], [.2, .2, 13]].forEach(([fx, fy, r], j) => {
        const R = r * glint * (.8 + .3 * Math.sin(t * 7 + j * 2 + (k === 'eyeL' ? 0 : 1))), w = R * .28;
        const cx = ic[0] + fx * (e.iris[2] - e.iris[0]), cy = ic[1] + fy * (e.iris[3] - e.iris[1]);
        g.save(); g.translate(cx, cy); g.scale(sc, 1);
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.beginPath(); g.moveTo(0, -R); g.quadraticCurveTo(w, -w, R, 0); g.quadraticCurveTo(w, w, 0, R); g.quadraticCurveTo(-w, w, -R, 0); g.quadraticCurveTo(-w, -w, 0, -R); g.fill();
        g.restore();
      });
    }
    // the lid hides everything above it
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(bx0 - 20, by0 - 20);
    for (let x = bx0 - 20; x <= bx1 + 20; x += 3) g.lineTo(x, poly2(e.lidFit, clamp(x, bx0, bx1)) + d + tn * (x - e.cx) - 1);
    g.lineTo(bx1 + 20, by0 - 20);
    g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    fg.drawImage(eyeCv, bx0 - 20 - FACE.x, by0 - 20 - FACE.y);
    // the lashes ride down with the lid and flatten as they close
    const L = e.lash, sy = .55 + .45 * clamp(open, 0, 1);
    fg.save();
    fg.translate(e.cx - FACE.x, e.cy + d - FACE.y);
    fg.rotate(tilt);
    fg.scale(1, sy);
    fg.drawImage(img[`${k}_lash`], L[0] - e.cx, L[1] - e.cy);
    fg.restore();
  }

  // Each mouth sprite sits where its expression edit drew it, and three of those edits drew the mouth
  // higher than the master's: these move them down (master pixels) so the middle of each visible mouth
  // is on the master's mouth line, y 769, as the neutral, love, dizzy and surprised mouths already are.
  const MOUTH_DY = { happy_mouth: 9, drag_mouth: 16, sleep_mouth: 4 };

  /** A whole drawn sprite (an expression's eye or mouth) at its place, optionally scaled/rotated about its centre. */
  function sprite(name, o = {}) {
    const b = feat.sprites[name];
    if (!b) return;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    fg.save();
    fg.globalAlpha = o.alpha ?? 1;
    fg.translate(cx - FACE.x, cy + (MOUTH_DY[name] || 0) - FACE.y);
    if (o.rot) fg.rotate(o.rot);
    fg.scale(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1);
    fg.drawImage(img[name], b[0] - cx, b[1] - cy);
    fg.restore();
  }

  const CHEEKS = [[618, 770, 40, 20], [852, 762, 22, 15]];
  function paintBlush(a) {
    if (a < .02) return;
    for (const [x, y, rx, ry] of CHEEKS) {
      fg.save();
      fg.translate(x - FACE.x, y - FACE.y); fg.scale(1, ry / rx);
      const gr = fg.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, `rgba(255,120,140,${f1(.55 * a)})`); gr.addColorStop(1, 'rgba(255,120,140,0)');
      fg.fillStyle = gr; fg.beginPath(); fg.arc(0, 0, rx, 0, Math.PI * 2); fg.fill();
      fg.restore();
    }
  }

  /** Small drawn mouths for the moods the sprites don't cover (form < 0 frowns). */
  function lineMouth(form, w = 1) {
    const cx = 766 - FACE.x, cy = 772 - FACE.y;
    fg.save(); fg.strokeStyle = INK; fg.lineWidth = 3; fg.lineCap = 'round';
    fg.beginPath(); fg.moveTo(cx - 9 * w, cy - form * 3); fg.quadraticCurveTo(cx, cy + form * 5, cx + 9 * w, cy - form * 3); fg.stroke();
    fg.restore();
  }

  const MOUTH = {
    neutral: 'neutral_mouth', happy: 'happy_mouth', wink: ['happy_mouth', .8], love: 'love_mouth', shy: ['drag_mouth', .7],
    surprised: 'surprised_mouth', sleepy: 'sleep_mouth', sleep: 'sleep_mouth', dizzy: 'dizzy_mouth', dragged: 'drag_mouth',
    content: 'neutral_mouth', waking: ['surprised_mouth', .6], squeeze: 'sleep_mouth', listening: 'neutral_mouth',
    thinking: 'sleep_mouth', run: ['happy_mouth', .7], angry: -1, sad: -1.2,
    smug: .7, pout: ['surprised_mouth', .45], worried: ['drag_mouth', .6], determined: .15, flustered: ['drag_mouth', .8],
    scared: ['drag_mouth', .8], excited: 'happy_mouth', cry: ['surprised_mouth', .8], confused: -.35,
  };

  // where the face's outline is under each eye's tear (master y), with room for the stream's rounded end
  const TEAR_END = { eyeL: 816, eyeR: 786 };
  /** Tears running from each eye's lower lid down the cheek (master pixels), wavering with `t`. */
  function paintStreams(t) {
    fg.save();
    EYES.forEach((k, i) => {
      const e = EYE[k], [bx0, , bx1, by1] = e.ball, w = (bx1 - bx0) * (k === 'eyeL' ? .22 : .2);
      // from just under the shut lid, narrow where it wells up and widening as it runs down
      // (painted before the eyes, so the shut lid's lashes lie over its top; it stops above the jaw under each eye)
      const x = bx0 + (bx1 - bx0) * (k === 'eyeL' ? .55 : .5) - FACE.x, y0 = by1 - 6 - FACE.y;
      const y1 = Math.min(FACE.h - 4, TEAR_END[k] - FACE.y, y0 + 110), wob = 4 * Math.sin(t * 6 + i);
      const gr = fg.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(120,195,255,.95)'); gr.addColorStop(1, 'rgba(120,195,255,.3)');
      fg.fillStyle = gr;
      fg.beginPath();
      fg.moveTo(x - w * .15, y0);
      fg.bezierCurveTo(x - w * .5 + wob, y0 + 25, x - w * .55 + wob, y1 - 20, x - w * .4, y1);
      fg.quadraticCurveTo(x, y1 + 6, x + w * .4, y1);
      fg.bezierCurveTo(x + w * .55 + wob, y1 - 20, x + w * .5 + wob, y0 + 25, x + w * .15, y0);
      fg.closePath(); fg.fill();
    });
    fg.restore();
  }

  function paintFace(fc, face, o, t) {
    fg.setTransform(1, 0, 0, 1, 0, 0);
    fg.clearRect(0, 0, FACE.w, FACE.h);
    paintBlush(fc.blush || 0);
    if (fc.streams) paintStreams(t);
    const shut = Math.max(o.blink || 0, o.eyeClose || 0);
    const lx = clamp(o.look[0], -6, 6), ly = clamp(o.look[1], -5, 5);
    const tilt = fc.brows === 'angry' ? .2 : fc.brows === 'sad' ? -.16 : 0;
    fc.eyes.forEach((e, i) => {
      const k = EYES[i], side = k === 'eyeL' ? 1 : -1;  // the near eye's inner corner is to its right
      const squash = { sy: 1 - .85 * (o.eyeClose || 0) };
      if ((face === 'surprised' || fc.wide) && e.shape === 'ring') { sprite(`surprised_${k}`, squash); return; }
      switch (e.shape) {
        case 'ring': case 'lid': {
          const open = (e.shape === 'ring' ? clamp(e.ry / e.rx, 0, 1) * (tilt ? .8 : 1) : clamp(e.ry / 16, 0, 1)) * (1 - shut);
          // the iris fills most of the eye: it only shifts a little, less in the foreshortened far eye,
          // so the white never shows past the eye's outline
          const gx = k === 'eyeL' ? 1 : .35;
          const ix = clamp((lx + (e.dx || 0)) * gx, -6 * gx, 6 * gx), iy = clamp(ly * .7 + (e.dy || 0) * .7, -3.5, 3.5);
          paintOpenEye(k, open, ix, iy + (e.shape === 'lid' ? 3 : 0), tilt * side, fc.sparkle ? 1 : 0, t);
          break;
        }
        case 'up': sprite(`happy_${k}`, squash); break;
        case 'down': sprite(`sleep_${k}`, squash); break;
        case 'gt': case 'lt': sprite(`drag_${k}`, { s: 1 + .03 * Math.sin(t * 22 + i) }); break;
        case 'heart': sprite(`love_${k}`, { s: .94 + .06 * (e.s ?? 1) / .8 }); break;
        case 'spiral': sprite(`dizzy_${k}`, { rot: (e.rot || 0) * .6 }); break;
      }
    });
    // mouth: talking opens the happy mouth about its middle, which stays on the mouth line; otherwise the face's own
    const talk = o.talk || 0;
    const gapOpen = clamp((Math.max(fc.gap[0], fc.gap[1]) - 50) / 14, 0, 1);
    const m = MOUTH[face] ?? 'neutral_mouth';
    const open = Math.max(talk * (.45 + .45 * Math.abs(Math.sin(t * 17))), face === 'sleepy' || face === 'waking' ? gapOpen : 0);
    if (open > .12) sprite(face === 'surprised' ? 'surprised_mouth' : 'happy_mouth', { sy: .35 + .65 * open, sx: .85 + .15 * open });
    else if (typeof m === 'number') lineMouth(m);
    else if (Array.isArray(m)) sprite(m[0], { s: m[1] });
    else sprite(m);
  }

  /* ---------- mounting inside the pet's SVG group ---------- */
  const VIEW = model.view;
  let fo = null, canvas = null, fxG = null, rig = null, mountedIn = null, pxScale = 0, frameN = 0;
  function mount(petG) {
    petG.textContent = '';
    // the previous rig's GL context outlives its canvas until GC: release it or repeated
    // figure switches pile up live contexts (Chromium caps them per page)
    rig?.dispose();
    rig = null;
    const box = (el) => { el.setAttribute('x', VIEW[0]); el.setAttribute('y', VIEW[1]); el.setAttribute('width', VIEW[2] - VIEW[0]); el.setAttribute('height', VIEW[3] - VIEW[1]); return el; };
    canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    if (opts.raster) {
      // each frame is copied into a plain SVG image: screenshots and recordings then always see it
      fo = box(document.createElementNS(SVGNS, 'image'));
    } else {
      fo = box(document.createElementNS(SVGNS, 'foreignObject'));
      canvas.style.cssText = 'width:100%;height:100%;display:block';
      fo.appendChild(canvas);
    }
    fxG = document.createElementNS(SVGNS, 'g');
    petG.append(fo, fxG);
    rig = createRig(canvas, { deformers: L.deformers, parts: L.parts, view: VIEW });
    for (const n in tex) rig.upload(n, tex[n]);
    if (fade) for (const n in fade.set.tex) rig.upload(n + '@mix', fade.set.tex[n]);
    mountedIn = petG; pxScale = 0;
  }
  // a fade in progress: the rig crossfades every part from `tex` to fade.set's textures over fade.dur seconds
  let fade = null;
  function endFade() {
    if (!fade) return;
    tex = fade.set.tex; img = fade.set.img; fade = null;
    if (rig) for (const n in tex) rig.upload(n, tex[n]);
  }
  /**
   * Switches the colour scheme and outfit (`<scheme>-<outfit>`, as opts.scheme): at once if their textures are
   * loaded (see preload), else once they are. Within one outfit `o.fade` (seconds) crossfades instead of cutting
   * over, the clock being the frames' `t` from `o.at` (the pet's time now) or else from the next frame drawn;
   * another outfit is another set of parts, so the rig is built again and the change is a cut.
   */
  function setScheme(id, o = {}) {
    const next = pickOf(id), key = `${next.scheme}-${next.outfit}`;
    const apply = set => {
      endFade();
      if (scheme === next.scheme && outfit === next.outfit && tex === set.tex) return;
      scheme = next.scheme;
      if (outfit !== next.outfit) {
        outfit = next.outfit; L = layoutOf(outfit);
        tex = set.tex; img = set.img;
        rig?.dispose(); rig = null; mountedIn = null;
        return;
      }
      if (o.fade > 0 && rig) {
        fade = { set, dur: o.fade, t0: o.at ?? null };
        for (const n in set.tex) rig.upload(n + '@mix', set.tex[n]);
        return;
      }
      tex = set.tex; img = set.img;
      if (rig) for (const n in tex) rig.upload(n, tex[n]);
    };
    if (ready[key]) { apply(ready[key]); return Promise.resolve(); }
    return loadScheme(next.scheme, next.outfit).then(apply);
  }
  let decoded = null; // raster mode: settles once the last frame's image is decoded
  let fixedRes = 0; // canvas pixels per rig unit for a snapshot; 0 = follow the screen
  function fitCanvas() {
    const m = fixedRes ? null : mountedIn.getScreenCTM();
    if (!m && !fixedRes) return;
    // the vertical axis: turning round squeezes the horizontal one through zero, which would shrink the canvas to a few texels
    const k = fixedRes || Math.hypot(m.c, m.d) * (window.devicePixelRatio || 1) * 1.25;
    if (Math.abs(k - pxScale) / (pxScale || 1) < .08) return;
    pxScale = k;
    canvas.width = Math.max(16, Math.round((VIEW[2] - VIEW[0]) * Math.min(k, 6)));
    canvas.height = Math.max(16, Math.round((VIEW[3] - VIEW[1]) * Math.min(k, 6)));
  }

  /* ---------- per-frame state ---------- */
  const sp = {
    hair: spring(55, 7, 1.8), hairY: spring(50, 8, 1.2), bangs: spring(110, 10, 1.6),
    skirt: spring(100, 9, 1.6), skirtY: spring(90, 10, 1.1), tail: spring(40, 5, 32), fins: spring(90, 9, 30),
    ahoge: spring(140, 6, 38), head: spring(70, 10, 16), armN: spring(60, 9, 125), armF: spring(60, 9, 95),
    hlX: spring(160, 9, 3), hlY: spring(160, 9, 3),
  };
  let lastT = null, prevTilt = 0, prevYaw = 0, prevLow = 0, headTilt = 0, fx = '';
  let prevLook = null, prevShut = 0;
  // the angle each hanging piece's root was last turned to (see the pendulums)
  let rootWas = {};
  // the kit tips Coo's whole round body to listen, nod, doze or wobble; she keeps her feet on the floor and
  // moves her head instead. Only flight, dragging and the jump's crouch and landing tip the whole group,
  // running keeps half its lean. The shares ease between modes so the group never snaps.
  // dancing sways her mostly as a whole, the rest of the sway goes to the neck
  const GROUP = { air: [1, 1], drag: [1, 1], crouch: [1, 1], land: [1, 1], walk: [1, .5], run: [1, .5], dance: [.6, 0] };
  // the ninja run leans her whole body forward from the soles, in a straight line: bent at the waist instead,
  // the bodice comes away from the skirt and its bow and the tops of the legs show at the waist
  let wTilt = 0, wLean = 0, facing = 1;
  let finMood = 0, tailMood = 0, wagAmp = 0, sitK = 0, walkK = 0, runK = 0, swingK = 0;
  const groupTilt = (mode, tilt, lean) => tilt * wTilt + lean * wLean + runK * 14 * facing;
  const st = { z: {}, alpha: {} };

  // fins and tail by face: fins up (+) or drooping (-), tail wag size
  const MOOD = {
    happy: [.8, 1], love: [.9, 1], wink: [.5, .7], surprised: [1, .2], angry: [.9, .15], sad: [-1, 0], shy: [-.5, .3],
    sleepy: [-.7, 0], sleep: [-.9, 0], dizzy: [-.3, 0], dragged: [.6, .6], content: [-.2, .25], listening: [.6, .2],
    thinking: [.1, .15], run: [.2, .4], waking: [-.4, 0], squeeze: [-.3, 0], neutral: [0, .25],
    smug: [.5, .6], pout: [.3, 0], worried: [-.3, .1], determined: [.9, .3], flustered: [.4, .8], scared: [-1, 0],
    excited: [1, 1], cry: [-1, 0], confused: [.2, .1], bowing: [-.2, .2],
  };
  // brows by face, per brow [near, far], in master pixels: [Y lift of the whole brow, A how much higher its
  // inner end (by the nose) sits than its outer end (a negative A is the frown), F how much more its middle
  // arches over its ends, X its shift toward the nose]. Sized from the master redrawn with each expression;
  // the far brow is shorter, and `both` gives it the same angle and curve.
  const both = (y, a = 0, f = 0, x = 0) => [[y, a, f, x], [y, a * .6, f * .6, x * .6]];
  const BROW = {
    surprised: both(32, 4, 12), excited: both(20, 2, 9),
    happy: both(9, 0, 6), love: both(9, 4, 6), listening: both(9, 0, 4), waking: both(6, 6),
    wink: [[9, 0, 6, 0], [-5, 0, 3, 0]],
    angry: both(-14, -44, -6, 8), determined: both(-6, -28, -3, 5), pout: both(-6, -22, -6, 5), run: both(2, -12, -3),
    squeeze: both(-12, -14, -8, 6), shy: both(0, 16, -4, 4),
    sad: both(-10, 30, -2, 6), cry: both(-10, 38, -4, 8), worried: both(-6, 24, 0, 5), scared: both(6, 26, 0, 5),
    flustered: both(2, 22, 0, 4), dragged: both(-4, 24, 0, 6),
    sleepy: both(-10, 2, -4), sleep: both(-10, 4, -2), content: both(-3, 0, 3), bowing: both(-3, 3),
    dizzy: [[12, 14, 0, 0], [-6, -10, 0, 0]],
    thinking: [[-6, -14, -4, 4], [14, 4, 6, 0]],
    smug: [[-8, -18, 0, 0], [14, -6, 4, 0]],
    confused: [[-10, -12, -4, 3], [22, 6, 8, 0]],
  };
  // faces whose brows are turned over, the arch a dip: the inner ends hook up out of it, pulled in
  const BROW_OVER = new Set(['sad', 'cry', 'worried', 'scared', 'flustered', 'dragged']);
  // how fast each face's brows get there (per second): a startle snaps them, sorrow sinks them slowly
  const BROW_RATE = { surprised: 18, scared: 18, excited: 14, angry: 16, dragged: 16, squeeze: 16, sad: 4, cry: 4, worried: 6, sleepy: 3, sleep: 3, content: 4 };
  // faces whose brows hold still during talk
  const BROW_STILL = new Set(['angry', 'sad', 'cry', 'sleepy', 'sleep', 'squeeze', 'dizzy']);
  // the head by face: tilt (degrees, forward +) and pitch (angleY, down +)
  const HEAD_TILT = { shy: 7, thinking: -8, smug: -6, pout: -4, confused: -7, worried: 3, cry: 4 };
  const HEAD_PITCH = { sad: .35, cry: .45, worried: .15 };
  const BROW_SPLIT = U(765);  // the near brow is left of this, the far brow right of it
  const browNow = [[0, 0, 0, 0], [0, 0, 0, 0]];
  let browOver = 0;  // 0 the brows as drawn, 1 turned over
  // a quick raise of both brows now and then during talk: when the last one started, and when talk was last seen
  let browFlashAt = -Infinity, talkedAt = -Infinity;
  // how far an eye's upper lid sits below its rest line (master pixels), and whether it is an open eye at all
  // (the same openness paintFace gives the eye, over the lid's full travel; the crease keeps a little above the lid)
  const lidDrop = (e, k, tilt) => {
    const open = e.shape === 'ring' ? clamp((e.ry ?? 16) / (e.rx ?? 16), 0, 1) * (tilt ? .8 : 1) : e.shape === 'lid' ? clamp(e.ry / 16, 0, 1) : 1;
    return EYE[k].travel * (1 - open) * .75;
  };
  const lidOpen = e => e.shape === 'ring' || e.shape === 'lid' ? 1 : 0;
  const creaseDrop = [0, 0];
  let creaseA = 1;

  function draw(petG, fc, o) {
    if (mountedIn !== petG || !petG.contains(fo)) mount(petG);
    if (frameN++ % 20 === 0) fitCanvas();
    const t = o.t, dt = lastT == null ? 1 / 60 : clamp(t - lastT, 0, .05);
    lastT = t;
    const mode = o.mode || 'idle', face = o.face || 'neutral';
    facing = Math.sign(o.facing || 1);
    const walking = mode === 'walk' || mode === 'run', held = mode === 'drag', airborne = mode === 'air';

    /* body: the kit's `low` is how far the hips sink (sitting, the walk's bob), in these units */
    sitK = lerp(sitK, clamp(o.sit ?? 0, 0, 1), ease(12, dt));
    const low = o.low || 0;
    const lowV = (low - prevLow) / Math.max(dt, 1e-3); prevLow = low;
    const breath = Math.sin(t * (mode === 'sleep' ? 1.7 : 2.4));

    /* head: tilt toward what it looks at, nod with sleep, wobble with dizzy */
    let tiltT = o.look[0] * .7 + Math.sin(t * .9) * 1.2 + o.look[1] * .4;
    if (mode === 'sleep') tiltT += 6;
    tiltT += HEAD_TILT[face] || 0;
    if (face === 'dizzy') tiltT += 3 * Math.sin(t * 4.5);
    if (held) tiltT += o.swing * .25;
    headTilt = sp.head.step(tiltT, dt);
    // what the kit meant for the whole body and the group did not take goes to the neck (forward +)
    const [gT, gL] = GROUP[mode] || [0, 0];
    const bend = (o.tilt ?? 0) * (1 - wTilt) + (o.lean ?? 0) * Math.sign(o.facing || 1) * (1 - wLean);
    wTilt = lerp(wTilt, gT, ease(10, dt)); wLean = lerp(wLean, gL, ease(10, dt));
    // the kit's short gestures, as she does them. Nod, shake, wave and bow are hers alone (see `gestures`):
    // a nod pitches the face down twice (angleY +) and dips the head forward, a shake turns the face from side
    // to side (angleX) under a slight roll; both die away by the end. The rest add to what the kit does.
    const g = o.gesture, gk = g ? g.k : 0;
    const env = (a, b) => smooth(0, a, gk) * (1 - smooth(b, 1, gk));
    const nod = g?.kind === 'nod' ? Math.sin(gk * Math.PI * 2) ** 2 * (1 - .3 * gk) : 0;
    const shake = g?.kind === 'shake' ? Math.sin(gk * Math.PI * 6) * smooth(0, .12, gk) * (1 - gk) : 0;
    const wave = g?.kind === 'wave' ? env(.15, .8) : 0;      // the near arm up beside her head, waving
    const bow = g?.kind === 'bow' ? env(.25, .7) : 0;        // the upper body tips forward about the waist
    const shiver = g?.kind === 'shiver' ? env(.08, .85) : 0; // arms hugged in, trembling, fins down
    const flap = g?.kind === 'flap' ? env(.05, .75) : 0;     // fins, tail, ahoge and arms all flutter
    const gNeck = nod * 7 + shake * 2.5 + bow * 10 + wave * 4, gYaw = shake * 1.1;
    const headA = headTilt + gNeck;
    const tiltVel = (headA - prevTilt) / Math.max(dt, 1e-3); prevTilt = headA;
    const yawVel = (gYaw - prevYaw) / Math.max(dt, 1e-3); prevYaw = gYaw;
    const angleX = clamp(clamp(o.look[0] / 5, -1, 1) * .9 + gYaw, -1.4, 1.4);
    // angleY + pitches the face down (the features slide down, more crown shows), as a gaze down (look[1] +) does
    const angleY = clamp(clamp(o.look[1] / 4, -1, 1) * .7 + (mode === 'sleep' ? .8 : 0) + (HEAD_PITCH[face] || 0) + nod * .9 + bow * .5, -1.4, 1.4);

    /* springs */
    const sway = clamp(o.swing / 26, -1.6, 1.6);
    const up = airborne || held ? 1 : 0;
    const hair = sp.hair.step(sway * 1.1 - tiltVel * .004 - yawVel * .02 + (walking ? -.25 : 0) - runK * .5, dt);
    const hairY = sp.hairY.step(up * -1 + lowV * .006, dt);
    const bangs = sp.bangs.step(sway * .7 - tiltVel * .004 - yawVel * .03, dt);
    const skirt = sp.skirt.step(sway * .8 + (walking ? -.2 : 0), dt);
    const flare = sp.skirtY.step(up * .8 + sitK * .6 + clamp(-lowV * .01, -.3, .6), dt);
    const [fm, wg] = MOOD[face] || MOOD.neutral;
    finMood = lerp(finMood, lerp(fm, -.6, shiver), ease(6, dt));
    wagAmp = lerp(wagAmp, wg, ease(3, dt));
    tailMood = lerp(tailMood, mode === 'sleep' || face === 'sad' || face === 'cry' || face === 'scared' ? -1 : 0, ease(3, dt));
    // fast flutters go on after the springs, which would smooth them away
    const fins = sp.fins.step(finMood * 14 + sway * 10, dt) + (face === 'angry' ? 2.5 * Math.sin(t * 40) : 0) + flap * 13 * Math.sin(t * 26);
    const ahoge = sp.ahoge.step(-tiltVel * .12 - yawVel * .5 + sway * 18 + (face === 'surprised' ? -16 : 0) + (face === 'confused' ? 20 : 0) + (mode === 'sleep' ? 22 : 0) - hairY * 12, dt)
      + flap * 12 * Math.sin(t * 19);
    const tail = sp.tail.step(sway * 14 + tailMood * 12, dt) + wagAmp * 13 * Math.sin(t * (4 + 5 * wagAmp)) + Math.sin(t * 1.3) * 3
      + flap * 14 * Math.sin(t * 17);

    /* legs: the kit hands hip→foot segments sized for Coo; keep their angle (forward = foot to the right) */
    const legA = o.legs.map(l => -Math.atan2(l[2] - l[0], Math.max(4, l[3] - l[1])) * 180 / Math.PI);
    const lift = o.legs.map(l => clamp(29 - Math.hypot(l[2] - l[0], l[3] - l[1]), -8, 20));
    // sitting swaps the lower body for its own drawing (skirt spread on the floor, legs forward) in a
    // couple of frames halfway down, under a little squash; a long crossfade would show both skirts at once
    const sitIn = smooth(.44, .54, sitK), plop = Math.sin(Math.PI * smooth(.3, .8, sitK));

    /* arms: swing against the legs when walking, out in the air, flailing when held */
    // running is a ninja run: both arms swept straight back, the whole body leaning forward (groupTilt)
    walkK = lerp(walkK, walking ? 1 : 0, ease(8, dt));
    runK = lerp(runK, mode === 'run' ? 1 : 0, ease(7, dt));
    // `swing` is whether the walk swings the arms: a pose that sets both arms holds them still
    let aN = 4, aF = -2, swing = walking ? 1 : 0;
    if (airborne) { aN = 40; aF = -30; }
    if (held) { aN = (70 + 16 * Math.sin(t * 13)) * L.heldArms; aF = (-45 - 12 * Math.sin(t * 13 + 1.3)) * L.heldArms; }
    if (sitK > .5 && !walking) { aN = lerp(aN, -4, sitK); aF = lerp(aF, -6, sitK); }
    if (face === 'happy' || face === 'love') { aN += 12 + 5 * Math.sin(t * 8); aF -= 8 + 4 * Math.sin(t * 8); }
    if (face === 'angry') { aN = 20 + 3 * Math.sin(t * 30); aF = -18 - 3 * Math.sin(t * 30); swing = 0; }
    if (face === 'determined') { aN = 14; aF = -10; swing = 0; }
    if (face === 'excited') { aN += 18; aF -= 12; }
    if (mode === 'dance') { const b = Math.sin((o.modeT || 0) * Math.PI * 2 * 1.1); aN = 16 + 24 * Math.max(0, b); aF = -8 - 22 * Math.max(0, -b); }
    if (runK > .001) { aN = lerp(aN, 38, runK); aF = lerp(aF, 32, runK); }
    if (wave) aN = lerp(aN, 108, wave);
    if (shiver) { aN = lerp(aN, -10, shiver); aF = lerp(aF, 8, shiver); }
    // each arm swings against the leg on its side. The swing goes on after the arm springs, which settle at about
    // 1.2 Hz: the walk's 2.1 Hz stride would come out of them about 120° late, each arm moving with its own leg.
    swingK = lerp(swingK, swing, ease(8, dt));
    const gait = swingK * (1 - runK) * (1 - wave) * (1 - shiver) * .5;
    const armN = sp.armN.step(aN, dt) - legA[0] * gait + wave * 13 * Math.sin(t * 15) + shiver * 1.4 * Math.sin(t * 47) + flap * 9 * Math.sin(t * 24);
    const armF = sp.armF.step(aF, dt) - legA[1] * gait - shiver * 1.2 * Math.sin(t * 43 + 1) - flap * 9 * Math.sin(t * 24 + 1);

    /* deformer states */
    // the kit sinks the hips 29 when seated; the sitting drawing's lowest point is 19.4 above the soles
    st.body = { a: -sway * 1.2 + (held ? o.swing * .15 : 0), ty: low - 9.6 * sitK, sx: (1 + .006 * breath + .04 * plop) * (1 - .03 * shiver), sy: 1 - .012 * breath - .06 * plop };
    st.waist = { a: bow * 20 };
    st.skirt = {
      fn: (u, v) => {
        const k = v * v;
        // on the way down the hem spreads a little before the sitting skirt takes over
        return [skirt * 4 * k + flare * (u - .45) * 9 * v + sitK * (u - .45) * 10 * v, -flare * k * 3 - sitK * k * 8];
      },
    };
    // the sitting skirt breathes a little at its hem, and its front edge swings with the body
    st.skirtSit = { fn: (u, v) => [skirt * 1.5 * v * v, -Math.max(0, breath) * .4 * v] };
    st.alpha.skirt = st.alpha.waist_bow_front = st.alpha.skirt_shadow = 1 - sitIn;
    st.alpha.leg_back = st.alpha.leg_front = 1 - smooth(.42, .52, sitK);
    st.alpha.skirt_sit = st.alpha.waist_bow_sit_front = sitIn;
    st.armNear = { a: armN };
    st.armFar = { a: armF };
    // the far arm's cuff layer sits over the bodice; swept back, the arm is behind her and so is the cuff
    st.alpha.arm_far_end_front = 1 - smooth(12, 30, armF);
    // she is turned toward us, so a foot behind its hip is also farther away: it rides a little higher,
    // which reads as the heel coming up at the push-off
    const behind = o.legs.map(l => Math.max(0, l[0] - l[2]) * .3 * walkK);
    st.legBack = { fn: hinge(L.PV.legBack, lerp(legA[0], -55, sitK), (-lift[0] * .9 - behind[0]) * (1 - sitK)) };
    st.legFront = { fn: hinge(L.PV.legFront, lerp(legA[1], -60, sitK), (-lift[1] * .9 - behind[1]) * (1 - sitK)) };
    st.tail = { a: tail - 10 * sitK };
    // the maid dress's tail turns about the edge of the skirt and bends most at its root end, out of sight under the
    // skirt; one that turns about its root inside the body stays put there and its tip trails the turn
    const tr = L.tailRoot;
    st.tailBend = tr
      ? { fn: (u, v, x) => { const k = clamp((tr.x - x) / (tr.x - tr.tip), 0, 1); return [0, tail * .3 * k * k]; } }
      : { fn: u => [0, -tail * .5 * u * u] };
    // the head stays up while she leans forward for the ninja run
    st.neck = { a: headA + clamp(bend * .8, -10, 12) - runK * 12, ty: (mode === 'sleep' ? 2.5 : 0) + breath * .35 };
    const parallax = (k, ky) => (u, v) => [angleX * k * bump(u) * (.4 + .6 * bump(v)), angleY * ky * bump(v) * (.4 + .6 * bump(u))];
    st.headFront = { fn: parallax(4.2, 2.8) };
    // the eyes and mouth move with the face: the eyes' outline is shared between the two layers
    st.headFeat = { fn: parallax(2, 1.4) };
    if (L.brows) {
      // the start of a line raises them once, and now and then a while into it
      if ((o.talk || 0) > .2) {
        if (t - talkedAt > .8 || (t - browFlashAt > 2.5 && Math.random() < dt * .4)) browFlashAt = t;
        talkedAt = t;
      }
      const ft = (t - browFlashAt) / .5, flash = ft >= 0 && ft < 1 && !BROW_STILL.has(face) ? 7 * Math.sin(Math.PI * ft) ** 2 : 0;
      const pose = BROW[face] || both(0), rate = BROW_RATE[face] || 9;
      browNow.forEach((b, i) => {
        // the whole brow leads and its tilt and curve follow, so the ends travel on a slight arc
        b[0] = lerp(b[0], pose[i][0] + flash - 2 * (o.blink || 0), ease(rate, dt));
        for (let j = 1; j < 4; j++) b[j] = lerp(b[j], pose[i][j], ease(rate * .75, dt));
      });
      browOver = lerp(browOver, BROW_OVER.has(face) ? 1 : 0, ease(14, dt));
      BROWS.forEach((b, i) => {
        const [Y, A, F, X] = browNow[i], outer = U(b.outer[0]), inner = U(b.inner[0]), toNose = Math.sign(inner - outer);
        // raising the inner end turns the brow toward its outer side
        st[`brow${i}`] = { a: -toNose * Math.atan2(A, Math.abs(b.inner[0] - b.outer[0])) * 180 / Math.PI, tx: X * toNose * S, ty: -Y * S };
        // a bend along the line between the ends: 0 at either end, F at the middle
        st[`browBend${i}`] = { fn: (u, v, x) => { const k = clamp((2 * x - outer - inner) / (inner - outer), -1, 1); return [0, -F * (1 - k * k) * S]; } };
        // the mirrored copy turned back so its ends sit where the drawing's do (a reflection over that line)
        st[`browOver${i}`] = { a: 2 * Math.atan((b.outer[1] - b.inner[1]) / (b.outer[0] - b.inner[0])) * 180 / Math.PI };
        st.alpha[`brow${i}`] = 1 - browOver; st.alpha[`browOver${i}`] = browOver;
        st.alpha[`brow${i}_through`] = .55 * (1 - browOver); st.alpha[`browOver${i}_through`] = .55 * browOver;
      });
    }
    if (L.creases) {
      // an eye drawn with the wide (surprised) sprite has no lowered lid, whatever the brows do
      fc.eyes.forEach((e, i) => { creaseDrop[i] = lerp(creaseDrop[i], lidDrop(e, EYES[i], fc.wide && e.shape === 'ring' ? 0 : fc.brows), ease(12, dt)); });
      creaseA = lerp(creaseA, (lidOpen(fc.eyes[0]) + lidOpen(fc.eyes[1])) / 2, ease(12, dt));
      st.alpha.eye_creases = creaseA;
      st.creases = { fn: (u, v, x) => [0, (x < BROW_SPLIT ? creaseDrop[0] : creaseDrop[1]) * S] };
    }
    st.headMid = { fn: parallax(2, 1.4) };
    st.headBack = { fn: parallax(-1.4, -1) };
    // the long hair hangs from the head but its lower half keeps to the body when the head tilts
    const nk = L.PV.neck, na = headA * Math.PI / 180;
    st.hairSway = {
      fn: (u, v, x, y) => {
        const w = smooth(.3, .8, v), a = -na * w, c = Math.cos(a), s = Math.sin(a);
        const dx = x - nk[0], dy = y - nk[1];
        const wv = Math.pow(v, 1.6);
        return [nk[0] + dx * c - dy * s - x + hair * 8 * wv + Math.sin(t * 1.6 + v * 3) * wv,
          nk[1] + dx * s + dy * c - y + hairY * 12 * wv * wv - Math.abs(hair) * 1.5 * wv];
      },
    };
    st.bangsSway = { fn: (u, v) => [bangs * 3.2 * v * v + Math.sin(t * 1.9 + u * 2) * .5 * v * v, hairY * 3 * v * v] };
    st.ahoge = { a: ahoge * .5 + Math.sin(t * 2.1) * 2 };
    st.finNear = { a: fins + Math.sin(t * 1.4) * 1.5 };
    st.finFar = { a: -fins * .8 - Math.sin(t * 1.4) * 1.2 };
    // what hangs off her (the pompoms on the hood ties, the scarf ends) is a pendulum: it hangs down whichever way
    // its root and the whole of her are turned, and the motion that flings her hair flings it, so it trails, swings
    // back and settles over a few swings. A quick turn of its root (a nod, a landing) kicks it, and so does each
    // step; one hung from the head also swings as the face turns (a shake, a look round), and idly sways a little.
    // `gain` is how freely it swings: 1 for a pompom on a string, less for cloth, which hangs only partly
    const faceTurn = (angleX - (rootWas.face ?? angleX)) / Math.max(dt, 1e-3); rootWas.face = angleX;
    for (const [k, d] of Object.entries(L.swings)) {
      let root = (o.groupRot || 0) * facing, onHead = false;
      for (let p = d.parent; p; p = L.deformers[p].parent) {
        if (L.deformers[p].kind === 'rot') root += st[p]?.a || 0;
        if (p === 'neck') onHead = true;
      }
      const kick = (root - (rootWas[k] ?? root)) / Math.max(dt, 1e-3); rootWas[k] = root;
      // a short string: it takes a good many degrees before the swing shows
      const pend = sp[`pend_${k}`] ||= spring(28, 1.8, 55), ph = d.pivot[0] * .05;
      const a = pend.step((-sway * 34 - kick * .15 + (onHead ? faceTurn * 8 : 0) + walkK * (legA[0] - legA[1]) * .3) * d.gain, dt);
      const idle = onHead ? Math.sin(t * 1.7 + ph) * 6 + Math.sin(t * 2.9 + ph * 1.3) * 2.5 : Math.sin(t * 1.7 + ph) * 2;
      st[k] = { a: a + idle * d.gain - root * Math.min(1, d.gain) };
    }

    // the highlights lag a gaze shift or a turn of the face and spring back; an opening lid flicks them up
    const look = [clamp(o.look[0], -6, 6), clamp(o.look[1], -5, 5)], was = prevLook || look; prevLook = look;
    const shut = Math.max(o.blink || 0, o.eyeClose || 0), shutV = (shut - prevShut) / Math.max(dt, 1e-3); prevShut = shut;
    hl.dx = sp.hlX.step(-(look[0] - was[0]) / Math.max(dt, 1e-3) * .03 - yawVel * .8, dt);
    hl.dy = sp.hlY.step(-(look[1] - was[1]) / Math.max(dt, 1e-3) * .03 + shutV * .12, dt);
    const mood = HL_MOOD[face] || {};
    hl.scale = lerp(hl.scale, mood.scale ?? 1, ease(6, dt));
    hl.quiver = lerp(hl.quiver, mood.quiver ?? 0, ease(4, dt));
    hl.alpha = lerp(hl.alpha, mood.alpha ?? 1, ease(4, dt));

    paintFace(fc, face, o, t);
    rig.upload('faceFx', faceCv);
    st.mix = 0;
    if (fade) {
      if (fade.t0 == null) fade.t0 = t;
      st.mix = smooth(0, 1, (t - fade.t0) / fade.dur);
      const own = img;
      img = fade.set.img; fg = fg2;
      paintFace(fc, face, o, t);
      img = own; fg = fg1;
      rig.upload('faceFx@mix', faceCv2);
    }
    rig.render(st);
    if (opts.raster) { fo.setAttribute('href', canvas.toDataURL('image/png')); decoded = fo.decode ? fo.decode().catch(() => {}) : null; }
    if (fade && st.mix >= 1) endFade();
    drawFx(fc, t);
  }

  /* ---------- effects over the figure (SVG, like the built-in figure's) ---------- */
  const at = (x, y) => rig.point('neck', st, x, y);
  function drawFx(fc, t) {
    let s = '';
    const ac = accent();
    const top = at(124, 34), side = at(204, 52);
    if (fc.orbit) {
      for (let i = 0; i < 3; i++) {
        const a = t * 3.2 + i * 2.094, sn = Math.sin(a);
        s += `<path fill="#ffd23f" stroke="#3a2f7a" stroke-width="1.6" stroke-linejoin="round" opacity="${sn < 0 ? .55 : 1}" transform="translate(${f1(top[0] + 56 * Math.cos(a))} ${f1(top[1] - 4 + 10 * sn)}) scale(${sn < 0 ? .7 : 1})" d="M0 -7L2 -2L7 -2L3 1L4.5 6.5L0 3.3L-4.5 6.5L-3 1L-7 -2L-2 -2Z"/>`;
      }
    }
    if (fc.listen) {
      for (let i = 0; i < 3; i++) {
        const p = (t * .9 + i / 3) % 1, r = 36 - 24 * p, c = at(214, 116);
        s += `<path fill="none" stroke="${ac}" stroke-width="5" stroke-linecap="round" opacity="${f1(Math.sin(Math.PI * p))}" d="M${f1(c[0] + r * Math.cos(-.55))} ${f1(c[1] + r * Math.sin(-.55))}A${f1(r)} ${f1(r)} 0 0 1 ${f1(c[0] + r * Math.cos(.55))} ${f1(c[1] + r * Math.sin(.55))}"/>`;
      }
    }
    if (fc.think) {
      for (let i = 0; i < 3; i++) {
        const k = (t * .8 + i / 3) % 1;
        s += `<circle fill="#e8f0ff" stroke="${ac}" stroke-width="3" cx="${f1(side[0] + 10 * i)}" cy="${f1(side[1] - 20 * i - 6 * k)}" r="${4 + 3 * i}" opacity="${f1(.4 + .6 * Math.sin(Math.PI * k))}"/>`;
      }
    }
    if (fc.sweat) {
      const c = at(196, 88 + 3 * Math.sin(t * 7));
      s += `<path fill="#8fd0ff" stroke="#2f5fae" stroke-width="1.4" transform="translate(${f1(c[0])} ${f1(c[1])}) scale(1.4)" d="M0 -9C4 -3 6 0 6 3.5A6 6 0 0 1 -6 3.5C-6 0 -4 -3 0 -9Z"/>`;
    }
    if (fc.anger) {
      const c = at(190, 62), k = 1 + .12 * Math.sin(t * 10);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])}) scale(${f1(k)})" fill="none" stroke="#e5484d" stroke-width="5" stroke-linecap="round"><path d="M-11 -3Q-3 -3 -3 -11M3 -11Q3 -3 11 -3M11 3Q3 3 3 11M-3 11Q-3 3 -11 3"/></g>`;
    }
    if (fc.bang) {
      const c = at(206, 36);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])})"><path fill="none" stroke="#252049" stroke-width="8" stroke-linecap="round" d="M0 -16V3"/><circle fill="#252049" cx="0" cy="14" r="4.5"/></g>`;
    }
    if (fc.question) {
      const c = at(206, 36), k = 1 + .06 * Math.sin(t * 3);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])}) scale(${f1(k)})"><path fill="none" stroke="#252049" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" d="M-8 -9Q-8 -19 0 -19Q9 -19 9 -11Q9 -4 0 -1V4"/><circle fill="#252049" cx="0" cy="14" r="4.5"/></g>`;
    }
    if (fx !== s) { fxG.innerHTML = s; fx = s; }
  }

  return {
    draw,
    groupTilt,
    /** The gestures she draws herself, from the frame's `gesture` (the kit leaves them off the body). */
    gestures: ['nod', 'shake', 'wave', 'bow'],
    setScheme,
    /** Forgets the motion state (springs, clocks), for callers that replay a timeline from its start. */
    /**
     * Renders `frames` frames of one pose (face `fc`, frame fields `o`, its clock starting at o.t) at `res` canvas
     * pixels per rig unit, then gives up the WebGL context; returns an SVG <image> for the result in rig space.
     * For pages showing many still figures, which would otherwise hold a GPU context each.
     */
    snapshot(fc, o, res = 3, frames = 60) {
      fixedRes = res;
      const g = document.createElementNS(SVGNS, 'g');
      for (let i = 0; i < frames; i++) draw(g, fc, { ...o, t: (o.t || 0) + i / 60 });
      const href = canvas.toDataURL('image/png');
      rig.dispose();
      rig = null; mountedIn = null; fixedRes = 0;
      return `<image href="${href}" x="${VIEW[0]}" y="${VIEW[1]}" width="${VIEW[2] - VIEW[0]}" height="${VIEW[3] - VIEW[1]}"/>`;
    },
    /**
     * Releases the WebGL context and drops the mounted DOM (what `setFigure` switching away from
     * this figure calls). The figure object stays usable: the next `draw` re-mounts from scratch.
     */
    dispose() {
      rig?.dispose();
      rig = null; canvas = null; fo = null; fxG = null; mountedIn = null;
    },
    reset() {
      endFade();
      for (const k in sp) { sp[k].x = 0; sp[k].v = 0; }
      lastT = null; rootWas = {}; prevTilt = 0; prevYaw = 0; prevLow = 0; headTilt = 0; wTilt = 0; wLean = 0; finMood = 0; tailMood = 0; wagAmp = 0; sitK = 0; walkK = 0; runK = 0; swingK = 0;
      prevLook = null; prevShut = 0; Object.assign(hl, { dx: 0, dy: 0, scale: 1, quiver: 0, alpha: 1 });
    },
    /** Loads every scheme's and outfit's textures, so later switches are immediate. */
    preload: () => Promise.all(SCHEMES.flatMap(sc => OUTFITS.map(of => loadScheme(sc.id, of.id)))),
    get scheme() { return `${scheme}-${outfit}`; },
    /** Raster mode: a promise that settles once the last drawn frame is ready to be painted. */
    get painted() { return decoded || Promise.resolve(); },
    get colors() { return { z: accent() }; },
    schemes: SCHEMES,
    // points the kit uses: eye tracking, a tear and one under each eye (where the streams run), sleep z's, hearts [x from, x to, y], bubble
    anchors: {
      gaze: [U(745), V(690)], tear: [U(640), V(752)], tears: [[U(654), V(752)], [U(852), V(750)]], z: [196, 44],
      hearts: [96, 176, 62], bubble: [128, 18],
    },
    model,
  };
}

/** The whale pack's entry (figure.json): her body for the figure frame, the kit's body drawn by her figure. */
export async function createWhaleBody(base, opts) {
  return opts.kit.createBody(opts.host, { figure: await createWhaleFigure(base, opts) });
}
