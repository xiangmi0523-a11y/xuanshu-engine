// 计算函数输入约束（docs/static_semantics.md 第四节；E2-A 第 1 项审查）。每个测试名以 IN 编号开头。
import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, baziDetail, cangganOf, changshengOf, computeZhuanggua, shishenOf } from "../src/index.js";
import { loadStatic } from "./helpers/load.js";

const blockedWith = (code: string, f: () => unknown) => {
  let out: unknown;
  assert.throws(() => { out = f(); }, (e: unknown) => e instanceof BlockedError && e.code === code, `应以 ${code} 阻断`);
  assert.equal(out, undefined);
};

test("IN-ZG-01 爻值须 6 个、每个为 6/7/8/9", () => {
  const st = loadStatic();
  for (const y of [[], [7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 5], [7, 7, 7, 7, 7, 10], [7, 7, 7, 7, 7, 7.5]]) {
    blockedWith("YAO_INVALID", () => computeZhuanggua(y, "甲子", st));
  }
  blockedWith("YAO_INVALID", () => computeZhuanggua([7, 7, 7, 7, 7, "7"] as unknown as number[], "甲子", st));
});

test("IN-ZG-02 日辰须为六十甲子之一", () => {
  const st = loadStatic();
  for (const d of ["", "甲", "甲丑", "子甲", "甲子甲", "乙子", " 甲子"]) blockedWith("DAY_GANZHI_INVALID", () => computeZhuanggua([7, 7, 7, 7, 7, 7], d, st));
  blockedWith("DAY_GANZHI_INVALID", () => computeZhuanggua([7, 7, 7, 7, 7, 7], null as unknown as string, st));
});

test("IN-BZ-01 四柱须为 3 柱或 4 柱", () => {
  const st = loadStatic();
  for (const p of [[], ["庚午"], ["庚午", "甲申"], ["庚午", "甲申", "壬子", "丁未", "甲子"]]) blockedWith("PILLARS_INVALID", () => baziDetail(p, st));
  blockedWith("PILLARS_INVALID", () => baziDetail(null as unknown as string[], st));
  assert.equal(baziDetail(["庚午", "甲申", "壬子"], st).length, 3);          // 时柱未知：只传三柱
  assert.equal(baziDetail(["庚午", "甲申", "壬子", "丁未"], st).length, 4);
});

test("IN-BZ-02 每柱须为六十甲子之一（含日柱、时柱）", () => {
  const st = loadStatic();
  for (const p of [["庚午", "甲丑", "壬子"], ["庚午", "甲申", "壬丑"], ["庚午", "甲", "壬子"], ["庚午", "甲申", "壬子", "丁子"], ["庚午", "甲申", "壬子", ""]]) {
    blockedWith("PILLARS_INVALID", () => baziDetail(p, st));
  }
  blockedWith("PILLARS_INVALID", () => baziDetail(["庚午", "甲申", "壬子", null as unknown as string], st));
});

test("IN-BZ-03 单个查表函数的天干、地支须合法", () => {
  const st = loadStatic();
  blockedWith("STEM_INVALID", () => shishenOf("子", "甲", st));
  blockedWith("STEM_INVALID", () => shishenOf("甲", "", st));
  blockedWith("STEM_INVALID", () => changshengOf(undefined as unknown as string, "亥", st));
  blockedWith("BRANCH_INVALID", () => cangganOf("甲", st));
  blockedWith("BRANCH_INVALID", () => changshengOf("甲", "子丑", st));
});
