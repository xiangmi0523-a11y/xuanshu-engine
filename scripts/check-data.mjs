// 数据校验：data/frozen/（冻结数据）与 data/static/（已准入静态表）下的文件必须与各自 MANIFEST.json 登记的哈希一致，且不得多出未登记文件。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

let bad = 0;
for (const sub of ["frozen", "static"]) {
  const dir = new URL(`../data/${sub}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", dir), "utf8"));
  for (const [name, { sha256, decision }] of Object.entries(manifest.files)) {
    const got = createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex");
    if (got === sha256) console.log(`✅ ${sub}/${name} 哈希一致（${decision}）`);
    else { console.log(`❌ ${sub}/${name} 哈希不符：登记 ${sha256.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`); bad++; }
  }
  for (const f of readdirSync(dir)) {
    if (f !== "MANIFEST.json" && !(f in manifest.files)) { console.log(`❌ ${sub}/${f} 未登记`); bad++; }
  }
}
process.exit(bad ? 1 : 0);
