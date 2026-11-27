/**
 * A minimal 64-bit little-endian ELF shared object for the native-module checks to read:
 * section headers, `.dynstr`, `.dynsym` (one undefined function per symbol), `.gnu.version` and
 * `.gnu.version_r`, which is all the dynamic linker consults to decide whether a binding's
 * glibc needs are met. Nothing in it runs.
 *
 * `needs` maps a library to its versions and the symbols bound at each:
 * `{ "libc.so.6": { "GLIBC_2.42": ["cfsetispeed"] } }`.
 */
const MACHINE = { x64: 62, arm64: 183 };

export function elfObject({ machine = "x64", needs = {} } = {}) {
  const strings = [0];
  const strOffset = new Map();
  const str = (s) => {
    if (!strOffset.has(s)) {
      strOffset.set(s, strings.length);
      strings.push(...Buffer.from(s, "latin1"), 0);
    }
    return strOffset.get(s);
  };

  const symbols = [];
  const verneed = [];
  let index = 2; // 0 and 1 are the reserved local and global indexes
  for (const [file, versions] of Object.entries(needs)) {
    const aux = [];
    for (const [version, names] of Object.entries(versions)) {
      aux.push({ name: str(version), index });
      for (const name of names) symbols.push({ name: str(name), version: index });
      index++;
    }
    verneed.push({ file: str(file), aux });
  }

  const dynstr = Buffer.from(strings);
  const dynsym = Buffer.alloc(24 * (symbols.length + 1));
  symbols.forEach(({ name }, i) => {
    const at = 24 * (i + 1);
    dynsym.writeUInt32LE(name, at);
    dynsym.writeUInt8(0x12, at + 4); // STB_GLOBAL | STT_FUNC, st_shndx 0: undefined
  });
  const versym = Buffer.alloc(2 * (symbols.length + 1));
  symbols.forEach(({ version }, i) => versym.writeUInt16LE(version, 2 * (i + 1)));
  const verneedBytes = Buffer.alloc(
    verneed.reduce((sum, need) => sum + 16 + 16 * need.aux.length, 0),
  );
  let at = 0;
  verneed.forEach((need, n) => {
    const size = 16 + 16 * need.aux.length;
    verneedBytes.writeUInt16LE(1, at);
    verneedBytes.writeUInt16LE(need.aux.length, at + 2);
    verneedBytes.writeUInt32LE(need.file, at + 4);
    verneedBytes.writeUInt32LE(16, at + 8);
    verneedBytes.writeUInt32LE(n === verneed.length - 1 ? 0 : size, at + 12);
    need.aux.forEach((aux, a) => {
      const base = at + 16 + 16 * a;
      verneedBytes.writeUInt16LE(aux.index, base + 6);
      verneedBytes.writeUInt32LE(aux.name, base + 8);
      verneedBytes.writeUInt32LE(a === need.aux.length - 1 ? 0 : 16, base + 12);
    });
    at += size;
  });

  const shstrtab = Buffer.from("\0.dynstr\0.dynsym\0.gnu.version\0.gnu.version_r\0.shstrtab\0");
  const name = (s) => shstrtab.indexOf(`\0${s}\0`) + 1;
  const bodies = [dynstr, dynsym, versym, verneedBytes, shstrtab];
  const offsets = [];
  let offset = 64;
  for (const body of bodies) {
    offsets.push(offset);
    offset += body.length;
  }
  const shoff = Math.ceil(offset / 8) * 8;
  const headers = [
    null,
    { name: name(".dynstr"), type: 3, i: 0 },
    { name: name(".dynsym"), type: 11, i: 1, link: 1, info: 1, entsize: 24 },
    { name: name(".gnu.version"), type: 0x6fffffff, i: 2, link: 2, entsize: 2 },
    { name: name(".gnu.version_r"), type: 0x6ffffffe, i: 3, link: 1, info: verneed.length },
    { name: name(".shstrtab"), type: 3, i: 4 },
  ];

  const out = Buffer.alloc(shoff + 64 * headers.length);
  out.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0); // ELF, 64-bit, little-endian, version 1
  out.writeUInt16LE(3, 16); // ET_DYN
  out.writeUInt16LE(MACHINE[machine], 18);
  out.writeUInt32LE(1, 20);
  out.writeBigUInt64LE(BigInt(shoff), 0x28);
  out.writeUInt16LE(64, 0x34);
  out.writeUInt16LE(64, 0x3a);
  out.writeUInt16LE(headers.length, 0x3c);
  out.writeUInt16LE(headers.length - 1, 0x3e);
  bodies.forEach((body, i) => body.copy(out, offsets[i]));
  headers.forEach((h, i) => {
    if (h === null) return;
    const base = shoff + 64 * i;
    out.writeUInt32LE(h.name, base);
    out.writeUInt32LE(h.type, base + 4);
    out.writeBigUInt64LE(BigInt(offsets[h.i]), base + 24);
    out.writeBigUInt64LE(BigInt(bodies[h.i].length), base + 32);
    out.writeUInt32LE(h.link ?? 0, base + 40);
    out.writeUInt32LE(h.info ?? 0, base + 44);
    out.writeBigUInt64LE(BigInt(h.entsize ?? 0), base + 56);
  });
  return out;
}

/** What node-pty's darwin prebuild starts with: a Mach-O 64-bit magic, not ELF. */
export const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
