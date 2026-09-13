#!/usr/bin/env node
// Zip web/dist-portal/ into web/dist-portal.zip for upload to a game portal
// (CrazyGames, itch.io, Newgrounds, Armor Games all take a zip with index.html
// at its root). Node has no built-in zip *archive* writer, so this is a
// minimal one — deflate via node:zlib, CRC-32 by hand — rather than a new
// dependency. Usage: node scripts/zip-portal.mjs [srcDir] [outFile]
import { createWriteStream } from "node:fs";
import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(process.argv[2] ?? join(here, "..", "dist-portal"));
const outFile = resolve(process.argv[3] ?? join(here, "..", "dist-portal.zip"));

// GitHub Pages-only files that mean nothing (or are wrong) on a portal.
const EXCLUDE = new Set(["CNAME"]);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time pair, as the zip format wants it. */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

async function main() {
  const info = await stat(srcDir).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`zip-portal: ${srcDir} is not a directory — run the portal build first`);
    process.exit(1);
  }
  await rm(outFile, { force: true });
  const out = createWriteStream(outFile);
  const write = (buf) =>
    new Promise((res, rej) => out.write(buf, (err) => (err ? rej(err) : res())));

  const central = [];
  let offset = 0;
  let count = 0;
  for await (const file of walk(srcDir)) {
    const name = relative(srcDir, file).split("\\").join("/");
    if (EXCLUDE.has(name)) continue;
    const data = await readFile(file);
    const { time, date } = dosDateTime((await stat(file)).mtime);
    const crc = crc32(data);
    // deflate unless it doesn't help (already-compressed png/woff2/wasm)
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const nameBuf = Buffer.from(name, "utf8");
    const flags = 0x0800; // UTF-8 names

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(time), u16(date),
      u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf,
    ]);
    await write(local);
    await write(body);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(time), u16(date),
        u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBuf,
      ]),
    );
    offset += local.length + body.length;
    count += 1;
  }
  const centralBuf = Buffer.concat(central);
  await write(centralBuf);
  await write(
    Buffer.concat([
      u32(0x06054b50), u16(0), u16(0), u16(count), u16(count),
      u32(centralBuf.length), u32(offset), u16(0),
    ]),
  );
  await new Promise((res) => out.end(res));
  const size = (await stat(outFile)).size;
  console.log(`zip-portal: ${count} files -> ${relative(process.cwd(), outFile)} (${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
