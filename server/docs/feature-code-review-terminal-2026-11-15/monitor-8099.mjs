import { appendFileSync, writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:8099";
const OUT = "D:\\LocalModels\\server\\docs\\feature-code-review-terminal-2026-11-15\\monitor-8099.txt";
writeFileSync(OUT, "# monitor " + new Date().toISOString() + "\n", "utf8");
const t0 = Date.now();
for (let i = 0; i < 100; i++) {
  const t = Date.now();
  let ok = false, ms = 0, err = "";
  try {
    const r = await fetch(BASE + "/api/state", { signal: AbortSignal.timeout(5000) });
    await r.text();
    ok = r.ok;
  } catch (e) { err = e.name; }
  ms = Date.now() - t;
  appendFileSync(OUT, ((Date.now() - t0) / 1000).toFixed(1) + "s\t" + ms + "ms\t" + (ok ? "ok" : "TIMEOUT/" + err) + "\n", "utf8");
  await new Promise((r) => setTimeout(r, 3000));
}
