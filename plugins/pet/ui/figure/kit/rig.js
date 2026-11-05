/**
 * A small Live2D-like renderer: textured grid meshes (parts) hang from a tree of deformers.
 *
 * Every coordinate is in one rig space (the pet's logo units: facing right, ground at y=256).
 * A part is a texture stretched over a box in that space, cut into a grid of quads. Each frame
 * the grid's rest points run through the part's deformer chain, innermost first:
 *   rot  – turn/scale/move about a pivot: p' = pivot + t + R(a)·S·(p − pivot)
 *   warp – a displacement field over a rect: p' = p + fn(u, v), u/v = p's place in the rect
 *            (points outside the rect take the field at the nearest edge)
 * Deformers are defined in rest space too, so a child always acts before its parent.
 *
 * A part may carry a second texture under `<tex>@mix` (same layout): `st.mix` (0..1) crossfades to it,
 * which is how a figure fades from one colour scheme to another.
 * A part with `blend: 'multiply'` multiplies the colours under it (a shadow layer, see render).
 */

// GLSL ES 1.00 and no vertex array objects: the same code runs on a WebGL 1 context, which some
// machines give where WebGL 2 is refused (older Macs whose GPU ANGLE drives through OpenGL)
const VS = `
attribute vec2 aPos; attribute vec2 aUv;
uniform vec4 uView; // x0, y0, 1/w, 1/h
varying vec2 vUv;
void main() {
  vec2 n = (aPos - uView.xy) * uView.zw;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;
const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uTex2;
uniform float uMix;
uniform float uAlpha;
uniform vec4 uTint; // rgb multiply, a = mix toward it
void main() {
  vec4 c = mix(texture2D(uTex, vUv), texture2D(uTex2, vUv), uMix);
  c.rgb = mix(c.rgb, c.rgb * uTint.rgb, uTint.a);
  gl_FragColor = c * uAlpha;
}`;

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function createRig(canvas, model) {
  // the canvas lives in an SVG foreignObject, which the browser may repaint from the canvas at any time: keep the
  // drawing buffer, or a repaint between our frames shows an empty canvas (flicker, worst in screen recordings)
  const attrs = { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
  if (!gl) throw new Error('webgl unavailable');
  // WebGL 1 builds mipmaps only for power-of-two sizes, and the textures are not
  const pot = (n) => (n & (n - 1)) === 0;
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const canMip = (src) => gl2 || (pot(src.width) && pot(src.height));
  const defs = model.deformers;
  let view = model.view; // [x0, y0, x1, y1]

  // the source each texture was uploaded from: a lost context takes the GL textures with it,
  // so restoring means uploading them all again from what they came from
  const textures = new Map(), sources = new Map();
  function upload(key, src) {
    if (disposed) return null;
    sources.set(key, src);
    let t = textures.get(key);
    if (!t) { t = gl.createTexture(); textures.set(key, t); }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const mip = canMip(src);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // deformer chain per part, innermost first
  const chainOf = id => { const c = []; for (let d = id; d; d = defs[d].parent) c.push(d); return c; };

  let prog, loc, meshes = [];
  let shaders = [];
  /** Builds every GL resource; called again on `webglcontextrestored`, where the old ones died with the context. */
  function buildGL() {
    shaders = [shader(gl, gl.VERTEX_SHADER, VS), shader(gl, gl.FRAGMENT_SHADER, FS)];
    prog = gl.createProgram();
    for (const s of shaders) gl.attachShader(prog, s);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'), aUv: gl.getAttribLocation(prog, 'aUv'),
      uView: gl.getUniformLocation(prog, 'uView'), uTex: gl.getUniformLocation(prog, 'uTex'),
      uAlpha: gl.getUniformLocation(prog, 'uAlpha'), uTint: gl.getUniformLocation(prog, 'uTint'),
      uTex2: gl.getUniformLocation(prog, 'uTex2'), uMix: gl.getUniformLocation(prog, 'uMix'),
    };
    // parts: rest grid, uv, index buffer; `uvBox` picks a sub-rect of the texture (atlas), default whole
    meshes = model.parts.map(p => {
      const [nx, ny] = p.grid || [6, 6];
      const [x, y, w, h] = p.box;
      const [u0, v0, u1, v1] = p.uvBox || [0, 0, 1, 1];
      const rest = new Float32Array((nx + 1) * (ny + 1) * 2), uv = new Float32Array(rest.length);
      let k = 0;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        rest[k] = x + w * i / nx; rest[k + 1] = y + h * j / ny;
        uv[k] = u0 + (u1 - u0) * i / nx; uv[k + 1] = v0 + (v1 - v0) * j / ny;
        k += 2;
      }
      const idx = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const pos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, rest.byteLength, gl.DYNAMIC_DRAW);
      const uvb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvb);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      return { part: p, rest, out: new Float32Array(rest.length), pos, uvb, ib, count: idx.length };
    });
    meshes.forEach(m => { m.chain = chainOf(m.part.parent); });
    gl.enableVertexAttribArray(loc.aPos);
    gl.enableVertexAttribArray(loc.aUv);
  }

  // a lost context blanks the canvas; unless the loss is preventDefault-ed the browser never
  // restores it, and it stays blank for good. On restoration every GL resource must be rebuilt
  // and the textures uploaded again from their sources.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    // dispose() during a loss cannot reach WEBGL_lose_context, so the browser may still restore a disposed rig
    if (disposed) return;
    lost = false;
    textures.clear();
    buildGL();
    for (const [key, src] of sources) upload(key, src);
  });
  buildGL();

  /**
   * Frees every GL resource and kills the context. Without this the browser keeps the context
   * alive until GC collects the canvas, and Chromium caps live contexts per page (~16): swapping
   * figures back and forth could exhaust them and leave later mounts rendering nothing.
   */
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    lost = true;
    try {
      for (const t of textures.values()) gl.deleteTexture(t);
      for (const m of meshes) { gl.deleteBuffer(m.pos); gl.deleteBuffer(m.uvb); gl.deleteBuffer(m.ib); }
      if (prog) gl.deleteProgram(prog);
      for (const s of shaders) gl.deleteShader(s);
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  /** Moves a rest point through deformer `id` and its ancestors, with this frame's states. */
  function applyChain(chain, st, x, y) {
    for (const id of chain) {
      const d = defs[id], s = st[id];
      if (!s) continue;
      if (d.kind === 'rot') {
        const [px, py] = d.pivot, a = (s.a || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
        const sx = s.sx ?? s.s ?? 1, sy = s.sy ?? s.s ?? 1;
        const lx = (x - px) * sx, ly = (y - py) * sy;
        x = px + (s.tx || 0) + lx * c - ly * sn;
        y = py + (s.ty || 0) + lx * sn + ly * c;
      } else if (d.kind === 'warp' && s.fn) {
        const [x0, y0, x1, y1] = d.rect;
        const u = Math.min(1, Math.max(0, (x - x0) / (x1 - x0))), v = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
        const r = s.fn(u, v, x, y);
        x += r[0]; y += r[1];
      }
    }
    return [x, y];
  }

  function render(st, opts = {}) {
    if (lost || gl.isContextLost()) return;
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(loc.uView, view[0], view[1], 1 / (view[2] - view[0]), 1 / (view[3] - view[1]));
    gl.uniform1i(loc.uTex, 0);
    gl.uniform1i(loc.uTex2, 1);
    const mixK = Math.min(1, Math.max(0, st.mix || 0));
    const order = meshes.filter(m => !(opts.hidden && opts.hidden[m.part.id]))
      .map(m => ({ m, z: st.z?.[m.part.id] ?? m.part.z })).sort((a, b) => a.z - b.z);
    for (const { m } of order) {
      const p = m.part, alpha = st.alpha?.[p.id] ?? p.alpha ?? 1;
      const tex = textures.get(p.tex);
      if (!tex || alpha <= 0.001) continue;
      for (let i = 0; i < m.rest.length; i += 2) {
        const q = applyChain(m.chain, st, m.rest[i], m.rest[i + 1]);
        m.out[i] = q[0]; m.out[i + 1] = q[1];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.out);
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.uvb);
      gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      const tex2 = mixK > 0 ? textures.get(p.tex + '@mix') : null;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex2 || tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1f(loc.uMix, tex2 ? mixK : 0);
      gl.uniform1f(loc.uAlpha, alpha);
      const tint = st.tint?.[p.id];
      gl.uniform4f(loc.uTint, ...(tint || [1, 1, 1, 0]));
      // a `multiply` part darkens what is already drawn under it and leaves the coverage alone,
      // so a shadow shows only on the parts below it and never over empty canvas
      if (p.blend === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
      if (p.blend === 'multiply') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  return {
    gl, upload, render, dispose,
    /** Where a rest point lands this frame (for overlays and hit tests). */
    point(deformer, st, x, y) { return applyChain(chainOf(deformer), st, x, y); },
    setView(v) { view = v; },
    get view() { return view; },
  };
}
