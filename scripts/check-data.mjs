// 冻结数据校验：data/frozen/ 下的文件必须与 MANIFEST.json 登记的哈希一致，且不得多出未登记文件。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../data/frozen/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", dir), "utf8"));
let bad = 0;
for (const [name, { sha256, decision }] of Object.entries(manifest.files)) {
  const got = createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex");
  if (got === sha256) console.log(`✅ ${name} 哈希一致（${decision}）`);
  else { console.log(`❌ ${name} 哈希不符：登记 ${sha256.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`); bad++; }
}
for (const f of readdirSync(dir)) {
  if (f !== "MANIFEST.json" && !(f in manifest.files)) { console.log(`❌ ${f} 未登记`); bad++; }
}
process.exit(bad ? 1 : 0);
