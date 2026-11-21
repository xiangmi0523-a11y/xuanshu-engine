// 数据校验：data/frozen/（冻结数据）与 data/static/（已准入静态表）下的文件必须与各自 MANIFEST.json 登记的哈希一致，且不得多出未登记文件。
// static 另须逐表登记规则编号、裁决、正本路径（E2-A 第 1 项审查 RC4），并核对独立基准 vectors/static_oracle.json 的登记哈希。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

let bad = 0;
for (const sub of ["frozen", "static", "contract"]) {
  const dir = new URL(`../data/${sub}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", dir), "utf8"));
  for (const [name, entry] of Object.entries(manifest.files)) {
    const { sha256, decision } = entry;
    if (sub === "static") for (const k of ["rule", "ruling", "source", "provenance"]) {
      if (!entry[k]) { console.log(`❌ static/${name} 未登记 ${k}`); bad++; }
    }
    const got = createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex");
    if (got === sha256) console.log(`✅ ${sub}/${name} 哈希一致（${decision}）`);
    else { console.log(`❌ ${sub}/${name} 哈希不符：登记 ${sha256.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`); bad++; }
  }
  for (const f of readdirSync(dir)) {
    if (f !== "MANIFEST.json" && !(f in manifest.files)) { console.log(`❌ ${sub}/${f} 未登记`); bad++; }
  }
}
{
  const m = JSON.parse(readFileSync(new URL("../data/static/MANIFEST.json", import.meta.url), "utf8"));
  if (!m.oracle?.path || !m.oracle?.sha256) { console.log("❌ static/MANIFEST.json 未登记独立基准 oracle"); bad++; }
  else {
    const got = createHash("sha256").update(readFileSync(new URL(`../${m.oracle.path}`, import.meta.url))).digest("hex");
    if (got === m.oracle.sha256) console.log(`✅ ${m.oracle.path} 独立基准哈希一致`);
    else { console.log(`❌ ${m.oracle.path} 独立基准哈希不符：登记 ${m.oracle.sha256.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`); bad++; }
  }
}
{
  // jcs-1 金标向量（审核清单 §6.4(6)）：数据仓库独立生成，引擎逐字节复制
  const m = JSON.parse(readFileSync(new URL("../data/contract/MANIFEST.json", import.meta.url), "utf8"));
  if (!m.golden?.path || !m.golden?.sha256) { console.log("❌ contract/MANIFEST.json 未登记 jcs-1 金标 golden"); bad++; }
  else {
    const got = createHash("sha256").update(readFileSync(new URL(`../${m.golden.path}`, import.meta.url))).digest("hex");
    if (got === m.golden.sha256) console.log(`✅ ${m.golden.path} jcs-1 金标哈希一致`);
    else { console.log(`❌ ${m.golden.path} jcs-1 金标哈希不符：登记 ${m.golden.sha256.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`); bad++; }
  }
}
process.exit(bad ? 1 : 0);
