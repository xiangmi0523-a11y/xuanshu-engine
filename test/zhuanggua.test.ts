// 装卦与八字查表（【用户裁决 E2-A】第 1 项；vectors/zhuanggua.json，SPEC §8）。
// 期望值由独立 Python 用规则推算与原文卦例得出，不读静态表、不调用引擎。
import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, baziDetail, cangganOf, changshengOf, computeZhuanggua, parseStaticTables, shishenOf,
  ZHUANGGUA_LAYER, type StaticCsv } from "../src/index.js";
import { loadStatic, readStatic, readVectors } from "./helpers/load.js";

interface Line { stem_branch: string; wuxing: string; liuqin: string; liushen?: string }
interface Hex { name: string; palace: string; palace_position: string; shi: number; ying: number; lines: Line[] }
interface Case { id: string; yao: number[]; day_ganzhi: string; basis: string;
  expect: { ben: Hex; bian: Hex | null; moving: number[]; xunkong: { xun_head: string; void: [string, string] } } }
const V = readVectors("zhuanggua.json") as { cases: Case[];
  bazi: { pillars: string[]; stem_shishen: string[]; day_master_changsheng: string[] };
  canggan_sets_from_yuanhai_song: { sets: Record<string, string[]> } };

const hexOf = (h: { name: string; palace: string; palace_position: string; shi: number; ying: number; lines: { stem_branch: string; wuxing: string; liuqin: string; liushen?: string }[] }, withShen: boolean) => ({
  name: h.name, palace: h.palace, palace_position: h.palace_position, shi: h.shi, ying: h.ying,
  lines: h.lines.map((l) => ({ stem_branch: l.stem_branch, wuxing: l.wuxing, liuqin: l.liuqin, ...(withShen ? { liushen: l.liushen } : {}) })),
});

for (const c of V.cases) {
  test(`[装卦] ${c.id}`, () => {
    const r = computeZhuanggua(c.yao, c.day_ganzhi, loadStatic());
    assert.deepEqual(hexOf(r.ben, true), c.expect.ben, c.basis);
    assert.deepEqual(r.bian ? hexOf(r.bian, false) : null, c.expect.bian, c.basis);
    assert.deepEqual(r.liuyao.moving_lines, c.expect.moving);
    assert.deepEqual(r.ben.lines.filter((l) => l.moving).map((l) => l.line), c.expect.moving);
    assert.deepEqual(r.xunkong, c.expect.xunkong);
    assert.equal(r.ben.lines.filter((l) => l.shi).length, 1);
    assert.equal(r.ben.lines.find((l) => l.shi)!.line, c.expect.ben.shi);
    assert.equal(r.ben.lines.find((l) => l.ying)!.line, c.expect.ben.ying);
    assert.equal(r.layer, ZHUANGGUA_LAYER);
    assert.equal(r.liushen_is_auxiliary_symbol, true);
    if (r.bian) assert.ok(r.bian.lines.every((l) => l.liushen === undefined), "变卦不排六神");
  });
}

test("装卦：日辰干支不合法时阻断", () => {
  for (const bad of ["", "甲", "甲丑", "子甲", "甲子甲"]) {
    assert.throws(() => computeZhuanggua([7, 7, 7, 7, 7, 7], bad, loadStatic()), (e: unknown) => e instanceof BlockedError && e.code === "DAY_GANZHI_INVALID");
  }
});

test("静态表：表头、行数、取值不合时阻断", () => {
  const names = ["liuyao_hexagrams", "liuyao_palace_wuxing", "liuyao_najia", "branch_wuxing", "liuyao_liuqin",
    "liuyao_liushen", "xunkong", "bazi_shishen", "bazi_canggan", "bazi_changsheng"] as const;
  const good = Object.fromEntries(names.map((n) => [n, readStatic(`${n}.csv`)])) as StaticCsv;
  const bad = (k: keyof StaticCsv, f: (s: string) => string) => assert.throws(() => parseStaticTables({ ...good, [k]: f(good[k]) }),
    (e: unknown) => e instanceof BlockedError && e.code === "STATIC_TABLE_INVALID");
  bad("liuyao_hexagrams", (s) => s.replace("bits_bottom_up", "bits"));             // 表头
  bad("liuyao_najia", (s) => s.split("\n").slice(0, -2).join("\n") + "\n");         // 少一行
  bad("liuyao_liuqin", (s) => s.replace(",子孙\n", ",儿孙\n"));                       // 取值越界
  bad("liuyao_hexagrams", (s) => s.replace(",本宫,", ",本卦,"));                       // 宫内位置越界
});

test("八字查表：示例 庚午 甲申 壬子 丁未 的十神与日主十二长生", () => {
  const st = loadStatic();
  const d = baziDetail(V.bazi.pillars, st);
  assert.deepEqual(d.map((x) => x.stem_shishen), V.bazi.stem_shishen);
  assert.deepEqual(d.map((x) => x.day_master_changsheng), V.bazi.day_master_changsheng);
  // 藏干十神：各支藏干逐个按日主壬查十神
  for (const x of d) for (const h of x.hidden_stems) assert.equal(h.shishen, shishenOf("壬", h.stem, st));
});

test("八字查表：藏干集合与《渊海子平》〈又地支藏遁歌〉原文一致；本气为该支本五行之干", () => {
  const st = loadStatic();
  const own: Record<string, string> = { 子: "癸", 丑: "己", 寅: "甲", 卯: "乙", 辰: "戊", 巳: "丙", 午: "丁", 未: "己", 申: "庚", 酉: "辛", 戌: "戊", 亥: "壬" };
  for (const [zhi, set] of Object.entries(V.canggan_sets_from_yuanhai_song.sets)) {
    const c = cangganOf(zhi, st);
    assert.deepEqual([c.benqi, c.zhongqi, c.yuqi].filter((x) => x !== null).sort(), [...set].sort(), `${zhi} 藏干集合`);
    assert.equal(c.benqi, own[zhi], `${zhi} 本气`);
    assert.match(c.layer, /现代整理层/);
  }
});

test("八字查表：十二长生按阳顺阴逆、戊己火土同宫；非法天干地支阻断", () => {
  const st = loadStatic();
  assert.equal(changshengOf("甲", "亥", st).state, "长生");
  assert.equal(changshengOf("乙", "午", st).state, "长生");   // 阴干逆行
  assert.equal(changshengOf("戊", "寅", st).state, "长生");   // 戊从丙
  assert.equal(changshengOf("己", "酉", st).state, "长生");   // 己从丁
  assert.match(changshengOf("甲", "亥", st).layer, /旺衰不等于吉凶/);
  assert.throws(() => changshengOf("子", "亥", st), (e: unknown) => e instanceof BlockedError && e.code === "STEM_INVALID");
  assert.throws(() => cangganOf("甲", st), (e: unknown) => e instanceof BlockedError && e.code === "BRANCH_INVALID");
});
