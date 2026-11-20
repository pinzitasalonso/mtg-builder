#!/usr/bin/env node
// Plays a Spellpool Dial against the device API (docs/dial-device-api.md),
// so the server side can be tried with no hardware: it pairs, lists the
// decks sent to it, and downloads their art.
//
//   node scripts/dial-sim.mjs                      against http://localhost:3000
//   node scripts/dial-sim.mjs https://www.spellpool.com
//   node scripts/dial-sim.mjs <url> --out ./dial-art   where the pictures go
//   node scripts/dial-sim.mjs <url> --forget           drop the saved token, pair again
//
// The token is kept in .dial-sim.json (git-ignored), as the dial keeps its
// own in flash.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
};
const out = flag("--out") || "./dial-art";
const forget = flag("--forget");
const base = (args[0] || "http://localhost:3000").replace(/\/+$/, "");
const STATE = path.resolve(".dial-sim.json");
const FIRMWARE = "sim-0.1";

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
if (forget) delete state[base];
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const asDial = (p, headers = {}) => fetch(base + p, { headers: { Authorization: `Bearer ${state[base].token}`, "X-Dial-Firmware": FIRMWARE, ...headers } });

async function pair() {
  const res = await post("/api/device/pair/start", { firmware: FIRMWARE });
  if (!res.ok) throw new Error(`pair/start: ${res.status} ${await res.text()}`);
  const begun = await res.json();
  console.log(`\n  Pair this dial\n\n      ${begun.code.slice(0, 3)} ${begun.code.slice(3)}\n\n  Type it at ${base}/dial (signed in). Waiting…`);
  const until = Date.now() + begun.expiresIn * 1000;
  while (Date.now() < until) {
    await sleep(begun.pollEvery);
    const r = await post("/api/device/pair/poll", { code: begun.code, secret: begun.secret });
    if (r.status === 202) continue;
    if (!r.ok) throw new Error(`pair/poll: ${r.status} ${await r.text()}`);
    const got = await r.json();
    state[base] = { token: got.token, device: got.device, etags: {} };
    save();
    console.log(`\n  Paired as “${got.device.name}”, for ${got.player}.`);
    return;
  }
  throw new Error("the code expired before it was typed in");
}

async function sync() {
  const mine = state[base];
  const res = await asDial("/api/device/decks");
  if (res.status === 401) {
    console.log("  This dial was removed. Pairing again.");
    delete state[base];
    save();
    await pair();
    return sync();
  }
  if (!res.ok) throw new Error(`decks: ${res.status} ${await res.text()}`);
  const body = await res.json();
  console.log(`\n  ${body.device.name} · ${body.player} · ${body.decks.length} deck${body.decks.length === 1 ? "" : "s"}\n`);
  fs.mkdirSync(out, { recursive: true });
  for (const d of body.decks) {
    const bits = [d.colors || "colourless", d.bracket ? `bracket ${d.bracket}` : "not scanned", `${d.gamesWon}/${d.gamesPlayed} won`];
    let art = "no art";
    if (d.art) {
      const file = path.join(out, `${d.id}.jpg`);
      // The tag changes when the picture would: only then is it fetched again.
      if (mine.etags[d.id] === d.art && fs.existsSync(file)) art = "art kept";
      else {
        const pic = await asDial(`/api/device/art/${encodeURIComponent(d.id)}`);
        if (pic.ok) {
          const bytes = Buffer.from(await pic.arrayBuffer());
          fs.writeFileSync(file, bytes);
          mine.etags[d.id] = d.art;
          art = `art ${Math.round(bytes.length / 1024)} KB → ${file}`;
        } else art = `art failed (${pic.status})`;
      }
    }
    console.log(`  • ${d.name}${d.commander ? ` — ${d.commander}` : ""}\n      ${bits.join(" · ")} · ${art}`);
  }
  if (!body.decks.length) console.log(`  No decks yet. Tick some at ${base}/dial, then run this again.`);
  save();
}

try {
  if (!state[base]?.token) await pair();
  await sync();
} catch (e) {
  console.error(`\n  ${e.message}`);
  process.exit(1);
}
