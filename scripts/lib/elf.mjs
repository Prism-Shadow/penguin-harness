/**
 * Just enough of an ELF reader to say what a Linux binary needs from the C library: its
 * machine, and every symbol version it binds (the `.gnu.version_r` section, which is what the
 * dynamic linker checks and what `objdump -T` prints in parentheses). A binding compiled
 * against a newer glibc than the machine it lands on fails at load time with "version
 * `GLIBC_2.42' not found", and these needs are the only place that is written down before then.
 *
 * Read from the section headers, as readelf does. Both classes and both byte orders are read;
 * an object with no section headers, or a table that runs past the file's end, is refused
 * rather than reported as needing nothing.
 */

const SHT_DYNSYM = 11;
const SHT_GNU_VERNEED = 0x6ffffffe;
const SHT_GNU_VERSYM = 0x6fffffff;

/** The machines a release ships Linux bindings for, by e_machine, in node's `process.arch` names. */
const MACHINES = new Map([
  [3, "ia32"],
  [40, "arm"],
  [62, "x64"],
  [183, "arm64"],
]);

/** Whether the bytes start with the ELF magic. */
export function isElf(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  );
}

/**
 * The machine an ELF object is for and the symbol versions it needs:
 * `{ machine, needs: [{ file, version, symbols }] }`, `machine` a `process.arch` name (or
 * `e_machine <n>` for one no release targets). Throws on bytes that are not a readable ELF.
 */
export function readElf(bytes) {
  if (!isElf(bytes)) throw new Error("not an ELF object");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wide = bytes[4] === 2;
  if (bytes[4] !== 1 && !wide) throw new Error(`unknown ELF class ${bytes[4]}`);
  const little = bytes[5] === 1;
  if (bytes[5] !== 1 && bytes[5] !== 2) throw new Error(`unknown ELF byte order ${bytes[5]}`);
  const at = (offset, size) => {
    if (offset + size > bytes.length) throw new Error("ELF table runs past the end of the file");
    if (size === 1) return view.getUint8(offset);
    if (size === 2) return view.getUint16(offset, little);
    if (size === 4) return view.getUint32(offset, little);
    return Number(view.getBigUint64(offset, little));
  };
  const word = wide ? 8 : 4;
  const machineId = at(18, 2);
  const machine = MACHINES.get(machineId) ?? `e_machine ${machineId}`;
  const shoff = at(wide ? 0x28 : 0x20, word);
  const shentsize = at(wide ? 0x3a : 0x2e, 2);
  const shnum = at(wide ? 0x3c : 0x30, 2);
  if (shoff === 0 || shnum === 0) throw new Error("the ELF object has no section headers");
  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize;
    sections.push({
      type: at(base + 4, 4),
      offset: at(base + (wide ? 24 : 16), word),
      size: at(base + (wide ? 32 : 20), word),
      link: at(base + (wide ? 40 : 24), 4),
      info: at(base + (wide ? 44 : 28), 4),
      entsize: at(base + (wide ? 56 : 36), word),
    });
  }
  const string = (section, offset) => {
    if (section === undefined) throw new Error("ELF string table missing");
    const start = section.offset + offset;
    let end = start;
    while (end < section.offset + section.size && at(end, 1) !== 0) end++;
    return Buffer.from(bytes.subarray(start, end)).toString("latin1");
  };

  // The version index each need is known by (vna_other), and the symbols bound at it.
  const byIndex = new Map();
  const needs = [];
  for (const section of sections.filter((s) => s.type === SHT_GNU_VERNEED)) {
    const strings = sections[section.link];
    let need = section.offset;
    for (let n = 0; n < section.info; n++) {
      const file = string(strings, at(need + 4, 4));
      const count = at(need + 2, 2);
      let aux = need + at(need + 8, 4);
      for (let a = 0; a < count; a++) {
        const entry = { file, version: string(strings, at(aux + 8, 4)), symbols: [] };
        needs.push(entry);
        byIndex.set(at(aux + 6, 2), entry);
        const next = at(aux + 12, 4);
        if (next === 0) break;
        aux += next;
      }
      const next = at(need + 12, 4);
      if (next === 0) break;
      need += next;
    }
  }
  const dynsym = sections.find((s) => s.type === SHT_DYNSYM);
  const versym = sections.find((s) => s.type === SHT_GNU_VERSYM);
  if (dynsym !== undefined && versym !== undefined && byIndex.size > 0) {
    const strings = sections[dynsym.link];
    const symSize = dynsym.entsize || (wide ? 24 : 16);
    const count = Math.floor(dynsym.size / symSize);
    for (let i = 1; i < count; i++) {
      const entry = byIndex.get(at(versym.offset + i * 2, 2) & 0x7fff);
      if (entry === undefined) continue;
      entry.symbols.push(string(strings, at(dynsym.offset + i * symSize, 4)));
    }
  }
  return { machine, needs };
}

/** The `x.y` of a `GLIBC_x.y` need; null for any other version name (GLIBCXX_…, CXXABI_…). */
export function glibcVersion(name) {
  return /^GLIBC_(\d+\.\d+(?:\.\d+)?)$/.exec(name)?.[1] ?? null;
}

/** Negative, zero or positive as dotted version `a` is older than, equal to or newer than `b`. */
export function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
