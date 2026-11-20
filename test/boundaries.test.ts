// E1 验收第 2、3、4、6 项的端点测试。
import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, computeBazi, supportedRange, type BaziInput } from "../src/index.js";
import { loadTables } from "./helpers/load.js";

const M = 60_000, H = 60 * M, UTC8 = 8 * H;
const civil = (ms: number): BaziInput["civil"] => {
  const d = new Date(ms + UTC8);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
};
const run = (ms: number, over: Partial<BaziInput> = {}) => computeBazi({
  civil: civil(ms), utcOffsetSeconds: 28800, timePrecision: "MINUTE", gender: "MALE",
  config: { zi_rule: "ye_zi_b", zi_reference_time: "clock" }, ...over }, loadTables());
const at = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) - UTC8;

test("子时边界提示：闭区间 [22:30, 23:30]、[00:30, 01:30]", () => {
  for (const [h, mi, want] of [[22, 29, false], [22, 30, true], [23, 30, true], [23, 31, false], [0, 29, false], [0, 30, true], [1, 30, true], [1, 31, false]] as const) {
    assert.equal(run(at(2024, 6, 10, h, mi)).warnings.includes("ZI_BOUNDARY_HINT"), want, `${h}:${mi}`);
  }
});

test("交节告警：闭区间 ±2 小时、立春 ±24 小时（端点含）", () => {
  const t = loadTables();
  const jz = t.jieqi.all.find((r) => r.year === 2024 && r.term === "惊蛰")!.utcMs;
  const lc = t.jieqi.all.find((r) => r.year === 2024 && r.term === "立春")!.utcMs;
  assert.ok(run(jz - 2 * H).warnings.includes("boundary_warning"));
  assert.ok(run(jz + 2 * H).warnings.includes("boundary_warning"));
  assert.ok(!run(jz - 2 * H - 1000).warnings.includes("boundary_warning"));
  assert.ok(run(lc + 24 * H).warnings.includes("boundary_warning"));
  assert.ok(!run(lc + 24 * H + 1000).warnings.includes("boundary_warning"));
});

test("只知时辰且选真太阳时：阻断，待实现", () => {
  assert.throws(() => computeBazi({ civil: { year: 2024, month: 3, day: 11 }, utcOffsetSeconds: 28800, timePrecision: "SHICHEN", shichen: "子",
    gender: "MALE", longitudeDeg: 120, config: { zi_rule: "ye_zi_b", zi_reference_time: "true_solar" } }, loadTables()),
    (e: unknown) => e instanceof BlockedError && e.code === "SHICHEN_TRUE_SOLAR_PENDING");
});

test("支持区间按冻结表精确计算：[1900-02-04T05:51:30Z, 2100-12-07T01:42:06Z)", () => {
  const { fromMs, toMs } = supportedRange(loadTables().jieqi);
  assert.equal(new Date(fromMs).toISOString(), "1900-02-04T05:51:30.000Z");
  assert.equal(new Date(toMs).toISOString(), "2100-12-07T01:42:06.000Z");
  const blocked = (ms: number) => assert.throws(() => run(ms), (e: unknown) => e instanceof BlockedError && e.code === "JIEQI_OUT_OF_RANGE");
  blocked(fromMs - 1000);
  blocked(toMs);
  assert.doesNotThrow(() => run(toMs - 1000));
  // 下界 1 分钟内：交节前一侧候选超出范围，同样阻断
  blocked(fromMs);
  assert.doesNotThrow(() => run(fromMs + 2 * M));
});

test("非 UTC+8 输入：先换算 UTC，再归一到 UTC+8（东京 +09:00）", () => {
  const r = computeBazi({ civil: { year: 2024, month: 3, day: 11, hour: 0, minute: 30 }, utcOffsetSeconds: 9 * 3600, timePrecision: "MINUTE",
    gender: "MALE", config: { zi_rule: "ye_zi_b", zi_reference_time: "clock" } }, loadTables());
  assert.equal(r.time_basis.birth_utc_iso, "2024-03-10T15:30:00.000Z");
  assert.equal(r.time_basis.utc8_iso, "2024-03-10T23:30:00.000+08:00");
  assert.equal((r.day_pillar as { value: string }).value, "癸酉");
});
