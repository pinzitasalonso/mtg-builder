// npm start: the database is backed up and brought up to date
// (scripts/prestart.mjs), then the server runs, and the two are one process
// that stops cleanly.
//
// It used to be `node scripts/prestart.mjs && next start`. That runs under a
// shell, and a shell told to stop (SIGTERM) just dies: it doesn't pass the
// signal on. So when the host stopped the app, which it does to the old
// version on every deploy, three things went wrong:
//   - npm reported the signal as a failure (exit code 143), and the host
//     took the old version for crashed: a "deploy crashed" email on every
//     deploy, though the new version was fine;
//   - the server itself never got the signal, so it was killed mid-request
//     instead of finishing what it was doing;
//   - nothing waited for it.
// Here the signal goes to the server, which closes its connections and
// exits, and this process then exits 0: stopped, not crashed. A server that
// exits on its own (a real crash) still exits with its code.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { main as prestart } from "./prestart.mjs";

/** How long the server gets to finish before it's killed. */
const GRACE_MS = Math.max(1000, Number(process.env.STOP_GRACE_MS) || 8000);

const ready = await prestart();
if (ready !== 0) process.exit(ready);

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [next, "start"], { stdio: "inherit" });

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[start] ${signal}: stopping the server.`);
  server.kill(signal);
  // A server that won't finish is killed: the host's own patience is shorter.
  setTimeout(() => server.kill("SIGKILL"), GRACE_MS).unref();
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

server.on("error", (e) => {
  console.error("[start] the server didn't start:", e.message);
  process.exit(1);
});
server.on("exit", (code, signal) => {
  // Asked to stop: a clean stop, however the server went down.
  if (stopping) process.exit(0);
  console.error(`[start] the server exited on its own (${signal ?? `code ${code}`}).`);
  process.exit(code ?? 1);
});
