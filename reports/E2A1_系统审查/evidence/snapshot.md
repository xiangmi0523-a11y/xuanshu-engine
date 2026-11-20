# 证据：修复前后输出快照

脚本：见文末（仓库外运行，只输出哈希）。修复前 = 2ba5820 构建；修复后 = 6a5a417 构建。

修复前：
```json
{
 "tables": "8842c4d9d0648d8a13ec748fdc20fb6cb6329ae87b05627d8aaab8de86e2f156",
 "zhuanggua_calls": 245760,
 "zhuanggua": "ec763a0399a831345a0f9a76e251624d353f9d7e87aa92ddb0532bc826408e5c",
 "bazi": "eb1798669cb676dc22313b4db41641c51f84a90c8acb87fa82ad4da6235990d7"
}
```
修复后：
```json
{
 "tables": "8842c4d9d0648d8a13ec748fdc20fb6cb6329ae87b05627d8aaab8de86e2f156",
 "zhuanggua_calls": 245760,
 "zhuanggua": "ec763a0399a831345a0f9a76e251624d353f9d7e87aa92ddb0532bc826408e5c",
 "bazi": "eb1798669cb676dc22313b4db41641c51f84a90c8acb87fa82ad4da6235990d7"
}
```

## snapshot.mjs
```js
// 全量结果快照：解析后的十张表 + 4096 种爻值 × 60 日辰的装卦 + 十神/藏干/十二长生全表。只输出哈希。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const eng = process.argv[2];
const E = await import(`${eng}/dist/src/index.js`);
const names = ["liuyao_hexagrams","liuyao_palace_wuxing","liuyao_najia","branch_wuxing","liuyao_liuqin","liuyao_liushen","xunkong","bazi_shishen","bazi_canggan","bazi_changsheng"];
const csv = Object.fromEntries(names.map((n) => [n, readFileSync(`${eng}/data/static/${n}.csv`, "utf8")]));
const st = E.parseStaticTables(csv);
const h = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
const tables = Object.fromEntries(Object.entries(st).map(([k, m]) => [k, [...m.entries()]]));
const S = "甲乙丙丁戊己庚辛壬癸", B = "子丑寅卯辰巳午未申酉戌亥";
const days = Array.from({ length: 60 }, (_, i) => S[i % 10] + B[i % 12]);
const zg = createHash("sha256"); let n = 0;
for (let c = 0; c < 4096; c++) {
  const yao = Array.from({ length: 6 }, (_, i) => 6 + ((c >> (2 * i)) & 3));
  for (const d of days) { const r = E.computeZhuanggua(yao, d, st); zg.update(JSON.stringify([r.ben, r.bian, r.xunkong, r.layer, r.not_implemented])); n++; }
}
const bz = [];
for (const a of S) for (const b of S) bz.push(E.shishenOf(a, b, st));
for (const b of B) bz.push(E.cangganOf(b, st));
for (const a of S) for (const b of B) bz.push(E.changshengOf(a, b, st));
console.log(JSON.stringify({ tables: h(tables), zhuanggua_calls: n, zhuanggua: zg.digest("hex"), bazi: h(bz) }, null, 1));
```
