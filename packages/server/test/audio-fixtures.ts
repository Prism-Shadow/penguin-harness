export function speechWave(samples = 48): Buffer {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

/**
 * A structurally valid MP3: an optional empty ID3v2 tag, then MPEG-1 Layer III frames at
 * 128 kbps and 44.1 kHz (417 bytes each, silent). Each frame lasts 1152 / 44100 s.
 */
export function soundMp3(frames = 20, id3 = true): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([...(id3 ? [tag] : []), ...Array.from({ length: frames }, () => frame)]);
}
