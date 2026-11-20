// 静态表运行时语义校验（E2-A 第 1 项验收修复）。
// 每个用例只改一张表的一处，断言 parseStaticTables 以 STATIC_TABLE_INVALID 阻断、不返回任何结果，
// 并以错误信息断言是哪一条校验生效（避免被行数等其他检查“顺带”拦下而误以为语义校验有效）。
import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, parseStaticTables, type StaticCsv } from "../src/index.js";
import { readRepo, readStatic } from "./helpers/load.js";

const NAMES = ["liuyao_hexagrams", "liuyao_palace_wuxing", "liuyao_najia", "branch_wuxing", "liuyao_liuqin",
  "liuyao_liushen", "xunkong", "bazi_shishen", "bazi_canggan", "bazi_changsheng"] as const;
type Name = (typeof NAMES)[number];
type Grid = string[][];
const good = Object.fromEntries(NAMES.map((n) => [n, readStatic(`${n}.csv`)])) as StaticCsv;
const grid = (k: Name): Grid => good[k].replace(/\r/g, "").split("\n").filter((l) => l.length > 0).map((l) => l.split(","));
const text = (g: Grid) => g.map((r) => r.join(",")).join("\n") + "\n";
/** 找到首列（或谓词）匹配的数据行（跳过表头） */
const row = (g: Grid, pred: string | ((r: string[]) => boolean)): string[] => {
  const r = g.slice(1).find(typeof pred === "string" ? (x) => x[0] === pred : pred);
  assert.ok(r, `测试数据中找不到行 ${String(pred)}`);
  return r;
};
const drop = (g: Grid, first: string) => { g.splice(g.findIndex((r, i) => i > 0 && r[0] === first), 1); };

/** 负向用例实际命中的约束编号（从报错信息的 [SC-…] 前缀取得） */
const hit = new Set<string>();
function blocked(k: Name, edit: (g: Grid) => void, msg: RegExp) {
  const g = grid(k);
  edit(g);
  let out: unknown;
  assert.throws(() => { out = parseStaticTables({ ...good, [k]: text(g) }); },
    (e: unknown) => {
      const ok = e instanceof BlockedError && e.code === "STATIC_TABLE_INVALID" && msg.test(e.message);
      const id = ok ? /^\[(SC-[A-Z]+-\d+)\]/.exec((e as BlockedError).message)?.[1] : undefined;
      if (id) hit.add(id);
      return ok && id !== undefined;
    },
    `${k}：应以 STATIC_TABLE_INVALID（${msg}）阻断`);
  assert.equal(out, undefined, "阻断时不得返回结果");
}

test("静态表校验：原表经 拆分→拼回 后仍通过（负向用例的改动才是阻断原因）", () => {
  const t = parseStaticTables(Object.fromEntries(NAMES.map((n) => [n, text(grid(n))])) as StaticCsv);
  assert.equal(t.hexagrams.size, 64);
});

test("表头不符（每张表）", () => {
  for (const k of NAMES) blocked(k, (g) => { g[0]![0] = g[0]![0] + "_x"; }, /表头不符/);
});

test("六十四卦：非法值", () => {
  const K = "liuyao_hexagrams";
  blocked(K, (g) => { row(g, "000001")[1] = "天"; }, /上下卦非法/);
  blocked(K, (g) => { row(g, "000001")[4] = "天"; }, /卦宫非法/);
  blocked(K, (g) => { row(g, "000001")[5] = "本卦"; }, /宫内位置非法/);
  blocked(K, (g) => { row(g, "000001")[6] = "7"; }, /世应须为 1～6/);
  blocked(K, (g) => { row(g, "000001")[7] = ""; }, /世应须为 1～6/);
  blocked(K, (g) => { row(g, "000001")[3] = ""; }, /卦名非法/);
  blocked(K, (g) => { row(g, "000001")[0] = "00000x"; }, /键非法/);
});

test("六十四卦：缺失键、重复键、重复卦名", () => {
  const K = "liuyao_hexagrams";
  blocked(K, (g) => { drop(g, "000001"); }, /应为 64 行/);
  blocked(K, (g) => { row(g, "000001")[0] = "000000"; }, /键重复：000000/);
  blocked(K, (g) => { row(g, "000001")[3] = "坤为地"; }, /卦名重复/);
});

test("六十四卦：上下卦与卦画不一致", () => {
  const K = "liuyao_hexagrams";
  // 000001 山地剥：下坤上艮；把上下卦对调、或只改其一，都必须被卦画比对拦下
  blocked(K, (g) => { const r = row(g, "000001"); [r[1], r[2]] = [r[2]!, r[1]!]; }, /上下卦与卦画不一致/);
  blocked(K, (g) => { row(g, "000001")[2] = "坎"; }, /上下卦与卦画不一致/);
  blocked(K, (g) => { row(g, "111000")[1] = "坤"; }, /上下卦与卦画不一致/);   // 地天泰下卦乾（111），改作坤
});

test("六十四卦：宫内位置与世应不合契约（P-B-03）、八宫分布不合", () => {
  const K = "liuyao_hexagrams";
  const yiShi = (r: string[]) => r[5] === "一世";
  blocked(K, (g) => { const r = row(g, yiShi); r[6] = "2"; r[7] = "5"; }, /世爻与宫内位置不合/);
  blocked(K, (g) => { const r = row(g, yiShi); r[7] = r[6]!; }, /应 ≠ 世 \+ 3/);
  blocked(K, (g) => { const r = row(g, (x) => x[5] === "游魂"); r[6] = "3"; r[7] = "6"; }, /世爻与宫内位置不合/);
  // 非纯卦标为本宫（世应按本宫改齐，只剩“本宫须为纯卦”一处不合）
  blocked(K, (g) => { const r = row(g, "000001"); r[5] = "本宫"; r[6] = "6"; r[7] = "3"; }, /本宫卦须为本宫纯卦/);
  // 卦宫改到别宫：一宫 9 卦、一宫 7 卦
  blocked(K, (g) => { row(g, "000001")[4] = "坤"; }, /宫 应有 8 卦/);
  // 同宫内两个“二世”、没有“一世”（世应按二世改齐）
  blocked(K, (g) => { const r = row(g, yiShi); r[5] = "二世"; r[6] = "2"; r[7] = "5"; }, /宫内位置须各一/);
});

test("八宫五行：非法值、非法键、重复键、缺失键", () => {
  const K = "liuyao_palace_wuxing";
  blocked(K, (g) => { row(g, "乾")[1] = "金金"; }, /五行非法/);
  blocked(K, (g) => { row(g, "乾")[1] = ""; }, /五行非法/);
  blocked(K, (g) => { row(g, "坤")[0] = "天"; }, /键非法/);
  blocked(K, (g) => { row(g, "坤")[0] = "乾"; }, /键重复：乾/);
  blocked(K, (g) => { drop(g, "坤"); }, /应为 8 行/);
});

test("纳甲：非法干支、非法爻位、非法卦、重复键、缺失键", () => {
  const K = "liuyao_najia";
  const qian1 = (r: string[]) => r[0] === "乾" && r[1] === "1";
  blocked(K, (g) => { row(g, qian1)[2] = "甲丑"; }, /干支非法/);   // 阴阳不配，不在六十甲子中
  blocked(K, (g) => { row(g, qian1)[2] = "子甲"; }, /干支非法/);
  blocked(K, (g) => { row(g, qian1)[2] = "甲"; }, /干支非法/);
  blocked(K, (g) => { row(g, qian1)[1] = "7"; }, /键非法/);
  blocked(K, (g) => { row(g, qian1)[1] = "01"; }, /键非法/);
  blocked(K, (g) => { row(g, qian1)[0] = "天"; }, /键非法/);
  blocked(K, (g) => { row(g, (r) => r[0] === "乾" && r[1] === "2")[1] = "1"; }, /键重复：乾\|1/);
  blocked(K, (g) => { g.splice(g.findIndex(qian1), 1); }, /应为 48 行/);
});

test("地支五行：非法值、非法键、重复键、缺失键", () => {
  const K = "branch_wuxing";
  blocked(K, (g) => { row(g, "子")[1] = "风"; }, /五行非法/);
  blocked(K, (g) => { row(g, "子")[0] = "甲"; }, /键非法/);
  blocked(K, (g) => { row(g, "丑")[0] = "子"; }, /键重复：子/);
  blocked(K, (g) => { drop(g, "亥"); }, /应为 12 行/);
});

test("六亲：非法值、非法键、重复键、缺失键", () => {
  const K = "liuyao_liuqin";
  const jinjin = (r: string[]) => r[0] === "金" && r[1] === "金";
  blocked(K, (g) => { row(g, jinjin)[2] = "儿孙"; }, /取值非法/);
  blocked(K, (g) => { row(g, jinjin)[0] = "风"; }, /键非法/);
  blocked(K, (g) => { row(g, (r) => r[0] === "金" && r[1] === "木")[1] = "金"; }, /键重复：金\|金/);
  blocked(K, (g) => { g.splice(g.findIndex(jinjin), 1); }, /应为 25 行/);
});

test("六神：非法值、行内重复、次序不合、非法键、重复键、缺失键", () => {
  const K = "liuyao_liushen";
  blocked(K, (g) => { row(g, "甲")[3] = "白龙"; }, /取值非法/);
  blocked(K, (g) => { const r = row(g, "甲"); r[2] = r[1]!; }, /一行内重复/);
  blocked(K, (g) => { const r = row(g, "甲"); [r[5], r[6]] = [r[6]!, r[5]!]; }, /次序不合/);
  blocked(K, (g) => { row(g, "甲")[0] = "子"; }, /键非法/);
  blocked(K, (g) => { row(g, "乙")[0] = "甲"; }, /键重复：甲/);
  blocked(K, (g) => { drop(g, "癸"); }, /应为 10 行/);
});

test("旬空：非法旬首、非法空亡、非法键、重复键、缺失键", () => {
  const K = "xunkong";
  blocked(K, (g) => { row(g, "乙丑")[1] = "乙丑"; }, /旬首非法/);
  blocked(K, (g) => { row(g, "乙丑")[1] = "甲丑"; }, /旬首非法/);
  blocked(K, (g) => { row(g, "乙丑")[2] = "甲"; }, /空亡地支非法/);
  blocked(K, (g) => { const r = row(g, "乙丑"); r[3] = r[2]!; }, /空亡地支非法/);
  blocked(K, (g) => { row(g, "乙丑")[0] = "甲丑"; }, /键非法/);
  blocked(K, (g) => { row(g, "乙丑")[0] = "甲子"; }, /键重复：甲子/);
  blocked(K, (g) => { drop(g, "癸亥"); }, /应为 60 行/);
});

test("旬空：日干支与旬首、空亡的对应被篡改", () => {
  const K = "xunkong";
  blocked(K, (g) => { row(g, "乙丑")[1] = "甲戌"; }, /旬首应为 甲子/);           // 合法旬首但不是本旬
  blocked(K, (g) => { const r = row(g, "乙丑"); r[2] = "申"; r[3] = "酉"; }, /空亡与旬首不对应/); // 合法地支但属甲戌旬
  blocked(K, (g) => { const r = row(g, "乙丑"); [r[2], r[3]] = [r[3]!, r[2]!]; }, /空亡与旬首不对应/);
  // 整旬一起改：旬首与空亡彼此自洽（甲戌旬 申酉），但不是该日所在之旬
  blocked(K, (g) => { const r = row(g, "乙丑"); r[1] = "甲戌"; r[2] = "申"; r[3] = "酉"; }, /旬首应为 甲子/);
});

test("十神：非法值、非法键、重复键、缺失键", () => {
  const K = "bazi_shishen";
  const jiaJia = (r: string[]) => r[0] === "甲" && r[1] === "甲";
  blocked(K, (g) => { row(g, jiaJia)[2] = "偏官"; }, /取值非法/);   // 别名不进表，表中只用“七杀”
  blocked(K, (g) => { row(g, jiaJia)[2] = ""; }, /取值非法/);
  blocked(K, (g) => { row(g, jiaJia)[1] = "子"; }, /键非法/);
  blocked(K, (g) => { row(g, (r) => r[0] === "甲" && r[1] === "乙")[1] = "甲"; }, /键重复：甲\|甲/);
  blocked(K, (g) => { g.splice(g.findIndex(jiaJia), 1); }, /应为 100 行/);
});

test("藏干：本气为空或非法、中余气非法、行内重复、列有空洞、非法键、重复键、缺失键", () => {
  const K = "bazi_canggan";
  blocked(K, (g) => { row(g, "子")[1] = ""; }, /本气非法或为空/);
  blocked(K, (g) => { row(g, "子")[1] = "子"; }, /本气非法或为空/);
  blocked(K, (g) => { row(g, "丑")[2] = "子"; }, /中气或余气非法/);
  blocked(K, (g) => { row(g, "丑")[3] = "甲乙"; }, /中气或余气非法/);
  blocked(K, (g) => { const r = row(g, "丑"); r[2] = r[1]!; }, /一支内藏干重复/);
  blocked(K, (g) => { row(g, "子")[3] = "壬"; }, /无中气而有余气/);
  blocked(K, (g) => { row(g, "子")[0] = "甲"; }, /键非法/);
  blocked(K, (g) => { row(g, "丑")[0] = "子"; }, /键重复：子/);
  blocked(K, (g) => { drop(g, "亥"); }, /应为 12 行/);
});

test("十二长生：非法地支、行内重复、次序不合、顺逆不合、火土同宫不合、非法键、重复键、缺失键", () => {
  const K = "bazi_changsheng";
  blocked(K, (g) => { row(g, "甲")[1] = "甲"; }, /地支非法/);
  blocked(K, (g) => { const r = row(g, "甲"); r[2] = r[1]!; }, /一行内地支重复/);
  blocked(K, (g) => { const r = row(g, "甲"); [r[4], r[5]] = [r[5]!, r[4]!]; }, /未按十二阶段次序顺行/);
  blocked(K, (g) => { const r = row(g, "乙"); r.splice(1, 12, ...r.slice(1).reverse()); }, /未按十二阶段次序逆行/); // 阴干改顺行
  blocked(K, (g) => { row(g, "戊").splice(1, 12, ...row(g, "庚").slice(1)); }, /火土同宫/);              // 戊改从庚，自身顺行无误
  blocked(K, (g) => { row(g, "甲")[0] = "子"; }, /键非法/);
  blocked(K, (g) => { row(g, "乙")[0] = "甲"; }, /键重复：甲/);
  blocked(K, (g) => { drop(g, "癸"); }, /应为 10 行/);
});

// —— 第二轮验收补充：起点校验（不改上面任何用例） ——
const rotate = (r: string[], n: number) => { const v = r.slice(1); r.splice(1, v.length, ...v.slice(n), ...v.slice(0, n)); };

test("六神：整行循环错位（次序仍对，起首不合日干）", () => {
  const K = "liuyao_liushen";
  blocked(K, (g) => { rotate(row(g, "甲"), 1); }, /甲 日起首应为 青龙，表中为 朱雀/);   // 甲日改作朱雀起
  blocked(K, (g) => { rotate(row(g, "戊"), 5); }, /戊 日起首应为 勾陈/);
  blocked(K, (g) => { rotate(row(g, "癸"), 1); }, /癸 日起首应为 玄武/);
  blocked(K, (g) => { for (const r of g.slice(1)) rotate(r, 1); }, /日起首应为/);       // 全表一起错一位
});

test("十二长生：整行循环错位（顺逆仍对，长生起点不合准入版本）", () => {
  const K = "bazi_changsheng";
  blocked(K, (g) => { rotate(row(g, "甲"), 1); }, /甲 长生应在 亥，表中为 子/);          // 阳干顺行错一位
  blocked(K, (g) => { rotate(row(g, "乙"), 1); }, /乙 长生应在 午，表中为 巳/);          // 阴干逆行错一位
  // 丙、戊同步错位：火土同宫仍成立，只剩起点不合
  blocked(K, (g) => { rotate(row(g, "丙"), 3); rotate(row(g, "戊"), 3); }, /丙 长生应在 寅/);
  blocked(K, (g) => { for (const r of g.slice(1)) rotate(r, 2); }, /长生应在/);          // 全表一起错两位
});

// —— 约束清单覆盖（E2-A 第 1 项审查）：docs/static_semantics.md 的每个 L2 编号都必须被上面的负向用例实际命中 ——
test("约束清单覆盖：每个 L2 约束编号都有负向用例命中（SC-GEN-05 由 02+03+04 蕴含，不可达）", () => {
  const l2 = [...readRepo("docs/static_semantics.md").matchAll(/^\| (SC-[A-Z]+-\d+) \|.*\| L2 \|$/gm)].map((m) => m[1]!);
  assert.ok(l2.length >= 39, `清单 L2 编号只读到 ${l2.length} 个`);
  const missing = l2.filter((id) => id !== "SC-GEN-05" && !hit.has(id));
  assert.deepEqual(missing, [], "以下 L2 约束没有负向用例命中");
  assert.deepEqual([...hit].filter((id) => !l2.includes(id)), [], "命中了清单中不存在的编号");
});
