// The .zip writer behind "Download everything" (lib/zip): checked against the standard CRC and the system unzip.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { crc32, zip } from "../../src/lib/zip";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
};
const enc = new TextEncoder();

check("CRC-32 matches the standard check value", crc32(enc.encode("123456789")) === 0xcbf43926, crc32(enc.encode("123456789")).toString(16));
check("…and of nothing is 0", crc32(new Uint8Array()) === 0);

const photo = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) % 256);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zip-")), "t.zip");
fs.writeFileSync(file, zip([
  { name: "README.txt", data: enc.encode("hello\r\n") },
  { name: "files/pod/2026-10-09 Señal POD.jpg", data: photo, date: new Date(2026, 9, 9, 14, 30) },
  { name: "data/empty.json", data: enc.encode("") },
]));
let unzip = "";
try {
  unzip = execFileSync("unzip", ["-t", file]).toString();
} catch (e) {
  unzip = String((e as { stdout?: Buffer }).stdout ?? e);
}
check("the system unzip reads it with no errors", /No errors detected/.test(unzip), unzip);
const back = execFileSync("unzip", ["-p", file, "files/pod/2026-10-09 Señal POD.jpg"], { maxBuffer: 1 << 24 });
check("…a file comes back byte for byte, with a non-English name", Buffer.compare(back, Buffer.from(photo)) === 0);
const list = execFileSync("unzip", ["-l", file]).toString();
check("…and keeps its date", /(2026-10-09|10-09-2026) 14:30/.test(list), list);
fs.rmSync(path.dirname(file), { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
