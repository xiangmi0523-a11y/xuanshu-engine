// W-01 禁令检查（契约 §12.1(b)）：代码、DDL、迁移中以下模式匹配数必须为 0。
// 229.18 只允许出现在含“已冻结”的注释行。本脚本自身不在扫描范围内。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "db", "test", "ddl", "migrations", "vectors"];
const RULES = [
  { name: "'ye_zi'（旧笼统夜子值）", re: /\bye_zi\b(?!_[bc])/ },
  { name: "DEFAULT 'zi_zheng'", re: /DEFAULT\s+['"]zi_zheng['"]/i },
  { name: "smt_h_1 / yh_1", re: /\b(smt_h_1|yh_1)\b/ },
  { name: "san_ming", re: /\bsan_ming\b/ },
  { name: "229.18（NOAA 均时差系数）", re: /229\.18/, allow: (line) => line.includes("已冻结") },
];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
for (const r of ROOTS) if (existsSync(r)) walk(r);
let hits = 0;
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line) && !(rule.allow && rule.allow(line))) { console.log(`❌ ${f}:${i + 1} 命中 ${rule.name}`); hits++; }
    }
  });
}
const present = ROOTS.filter((r) => existsSync(r));
console.log(`W-01 扫描目录：${present.join("、")}（不存在未扫：${ROOTS.filter((r) => !existsSync(r)).join("、") || "无"}）`);
console.log(hits ? `W-01：${hits} 处命中` : `✅ W-01：扫描 ${files.length} 个文件，五个模式匹配数均为 0`);
process.exit(hits ? 1 : 0);
