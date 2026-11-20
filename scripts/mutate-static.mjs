// 变异检查（E2-A 第 1 项全系统审查 RC3）：证明每条校验、每个关键计算步骤都有测试守着。
// - 在系统临时目录的仓库副本中逐个施加变异，构建并跑测试；工作区文件一律不改。
// - L2：src/static.ts 中每处 need(...) 逐个改为恒真；只允许 docs/static_semantics.md 声明的 SC-GEN-05 存活。
// - 计算与输入：预设变异（违反 P-B-02/04/05/06、子平法、长生、输入约束），必须全部被测出。
// 输出 Markdown 表与一行 JSON 汇总；与预期不符时退出码为 1。用法：npm run mutate
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "xuanshu-mutate-"));
for (const d of ["src", "test", "data", "vectors", "docs"]) cpSync(join(ROOT, d), join(work, d), { recursive: true });
for (const f of ["tsconfig.json", "package.json"]) cpSync(join(ROOT, f), join(work, f));
symlinkSync(join(ROOT, "node_modules"), join(work, "node_modules"), "dir");

const tsc = join(work, "node_modules", "typescript", "bin", "tsc");
const run = (tests) => {
  rmSync(join(work, "dist"), { recursive: true, force: true });
  const b = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: work, encoding: "utf8" });
  if (!existsDist()) return { built: false, fail: -1, out: b.stdout + b.stderr };
  const t = spawnSync(process.execPath, ["--test", ...tests], { cwd: work, encoding: "utf8" });
  const m = /^# fail (\d+)/m.exec(t.stdout);
  return { built: true, fail: m ? Number(m[1]) : -1 };
};
function existsDist() { try { readFileSync(join(work, "dist", "src", "index.js")); return true; } catch { return false; } }

const L2_TESTS = ["dist/test/static_integrity.test.js", "dist/test/zhuanggua.test.js"];
const ALL_TESTS = ["dist/test/static_integrity.test.js", "dist/test/zhuanggua.test.js", "dist/test/oracle.test.js", "dist/test/inputs.test.js"];
const ALLOWED_SURVIVORS = new Set(["SC-GEN-05"]);

const base = run(ALL_TESTS);
if (base.fail !== 0) { console.log(`基线未通过（fail=${base.fail}），中止`); process.exit(1); }

const rows = []; let unexpected = 0;
const apply = (file, from, to) => {
  const p = join(work, file), orig = readFileSync(p, "utf8");
  return { p, orig, text: orig.replace(from, to) };
};

// ---- L2：逐个使 need(...) 失效
const SRC = join(work, "src", "static.ts");
const srcOrig = readFileSync(SRC, "utf8");
const lines = srcOrig.split("\n");
lines.forEach((line, i) => {
  if (!/\bneed\(/.test(line) || /const need\b/.test(line)) return;
  const id = /\[(SC-[A-Z]+-\d+)\]/.exec(lines.slice(i, i + 3).join("\n"))?.[1] ?? "（无编号）";   // 报错信息可能换行
  const mutated = [...lines]; mutated[i] = line.replace(/\bneed\(/, "need(true || ");
  writeFileSync(SRC, mutated.join("\n"));
  const r = run(L2_TESTS);
  writeFileSync(SRC, srcOrig);
  const caught = r.fail > 0;
  const expected = ALLOWED_SURVIVORS.has(id) ? !caught : caught;
  if (!expected) unexpected++;
  rows.push(["L2", id, `static.ts:${i + 1}`, caught ? `测出（${r.fail} 败）` : "存活", expected ? "符合预期" : "**不符**"]);
});

// ---- 计算与输入：预设变异，必须全部测出
const CODE = [
  ["P-B-04", "变卦六亲改依变卦宫", "src/zhuanggua.ts", 'hexagram(ly.bian_lines.join(""), st, self, null)', 'hexagram(ly.bian_lines.join(""), st, st.palaceWuxing.get(st.hexagrams.get(ly.bian_lines.join(""))!.palace)!, null)'],
  ["P-B-02", "纳甲上下卦颠倒", "src/zhuanggua.ts", "i <= 3 ? h.lower : h.upper", "i <= 3 ? h.upper : h.lower"],
  ["P-B-05", "六神按日支起", "src/zhuanggua.ts", "st.liushen.get(dayGanzhi[0]!)!", "(st.liushen.get(STEMS[BRANCHES.indexOf(dayGanzhi[1]!) % 10]!) ?? st.liushen.get(dayGanzhi[0]!))!"],
  ["P-B-08", "动爻标记偏一位", "src/zhuanggua.ts", "ly.moving_lines.includes(l.line)", "ly.moving_lines.includes(l.line - 1)"],
  ["P-B-06", "旬空取前一日", "src/zhuanggua.ts", "xunkong: st.xunkong.get(dayGanzhi)!", "xunkong: st.xunkong.get([...st.xunkong.keys()][([...st.xunkong.keys()].indexOf(dayGanzhi) + 59) % 60]!)!"],
  ["P-A-06", "十二长生阴干改用阳干表", "src/bazi_detail.ts", "st.changsheng.get(s)!.indexOf(b)", "st.changsheng.get(STEMS[STEMS.indexOf(s) & ~1]!)!.indexOf(b)"],
  ["P-A-02", "十神日干与他干对调", "src/bazi_detail.ts", "st.shishen.get(`${dayStem}|${other}`)!", "st.shishen.get(`${other}|${dayStem}`)!"],
  ["P-A-03", "藏干漏掉余气", "src/bazi_detail.ts", "[cg.benqi, cg.zhongqi, cg.yuqi]", "[cg.benqi, cg.zhongqi]"],
  ["X-08", "日主长生改用年干", "src/bazi_detail.ts", "day_master_changsheng: changshengOf(day, b, st).state", "day_master_changsheng: changshengOf(pillars[0]![0]!, b, st).state"],
  ["IN-BZ-01", "四柱数量不查", "src/bazi_detail.ts", "(pillars.length !== 3 && pillars.length !== 4)", "pillars.length < 3"],
  ["IN-BZ-02", "每柱干支不查", "src/bazi_detail.ts", '!JIAZI.includes(p))', 'false)'],
  ["IN-ZG-02", "日辰不查六十甲子", "src/zhuanggua.ts", "|| !st.xunkong.has(dayGanzhi)", "|| false"],
];
for (const [rule, desc, file, from, to] of CODE) {
  const { p, orig, text } = apply(file, from, to);
  if (text === orig) { rows.push(["计算", rule, desc, "变异未命中源码", "**不符**"]); unexpected++; continue; }
  writeFileSync(p, text);
  const r = run(ALL_TESTS);
  writeFileSync(p, orig);
  const caught = r.fail > 0;
  if (!caught) unexpected++;
  rows.push(["计算/输入", rule, desc, r.built ? (caught ? `测出（${r.fail} 败）` : "存活") : "编译失败", caught ? "符合预期" : "**不符**"]);
}
rmSync(work, { recursive: true, force: true });

console.log("| 类 | 编号 | 位置或内容 | 结果 | 判定 |\n|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
const l2 = rows.filter((r) => r[0] === "L2");
console.log(JSON.stringify({
  l2_sites: l2.length, l2_caught: l2.filter((r) => r[3].startsWith("测出")).length,
  l2_survivors: l2.filter((r) => r[3] === "存活").map((r) => r[1]),
  code_mutants: rows.length - l2.length, code_caught: rows.filter((r) => r[0] !== "L2" && r[3].startsWith("测出")).length,
  unexpected,
}));
process.exit(unexpected ? 1 : 0);
