import test from "node:test";
import assert from "node:assert/strict";
import { dayIndex, ganzhiName, hourBranchOfMinute, hourIndex, indexOf, monthBranchOfJie, monthIndex, yearIndex } from "../src/index.js";

test("六十甲子序与奇偶校验（P-D-01）", () => {
  assert.equal(ganzhiName(0), "甲子");
  assert.equal(ganzhiName(59), "癸亥");
  assert.equal(indexOf(0, 4), 40); // 甲辰
  assert.throws(() => indexOf(0, 1)); // 甲丑 非法
});

test("日柱锚点与契约金值（P-D-04、§13.11）", () => {
  const d = (y: number, m: number, dd: number) => ganzhiName(dayIndex(y, m, dd));
  assert.equal(d(1949, 10, 1), "甲子");
  assert.equal(d(1949, 9, 30), "癸亥");
  assert.equal(d(2024, 3, 7), "庚午");
  assert.equal(d(2024, 3, 10), "癸酉");
  assert.equal(d(2024, 3, 11), "甲戌");
  assert.equal(d(1900, 1, 1), "甲戌");
  assert.equal(d(2100, 12, 31), "丁未");
});

test("年柱（立春年）", () => {
  assert.equal(ganzhiName(yearIndex(2024)), "甲辰");
  assert.equal(ganzhiName(yearIndex(2023)), "癸卯");
  assert.equal(ganzhiName(yearIndex(1984)), "甲子");
});

test("五虎遁（P-D-03）", () => {
  // 甲年寅月丙寅、卯月丁卯；癸年丑月乙丑
  assert.equal(ganzhiName(monthIndex(0, 2)), "丙寅");
  assert.equal(ganzhiName(monthIndex(0, 3)), "丁卯");
  assert.equal(ganzhiName(monthIndex(9, 1)), "乙丑");
  assert.equal(ganzhiName(monthIndex(4, 2)), "甲寅");
});

test("五鼠遁与时支（P-D-05）", () => {
  assert.equal(ganzhiName(hourIndex(0, 0)), "甲子"); // 甲日子时
  assert.equal(ganzhiName(hourIndex(9, 11)), "癸亥"); // 癸日亥时
  assert.equal(hourBranchOfMinute(23 * 60), 0);
  assert.equal(hourBranchOfMinute(59), 0);
  assert.equal(hourBranchOfMinute(60), 1);
  assert.equal(hourBranchOfMinute(22 * 60 + 59), 11);
});

test("节 → 月支", () => {
  assert.equal(monthBranchOfJie(315), 2); // 立春 寅
  assert.equal(monthBranchOfJie(345), 3); // 惊蛰 卯
  assert.equal(monthBranchOfJie(255), 0); // 大雪 子
  assert.equal(monthBranchOfJie(285), 1); // 小寒 丑
  assert.throws(() => monthBranchOfJie(0)); // 春分是中气
});
