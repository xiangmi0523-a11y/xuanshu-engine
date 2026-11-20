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

// 【用户裁决 E1-2】左闭右开 [start, end) 的端点语义。期望值由定义直接得出：区间只含起点、不含终点。
test("E1-2：UTC+8 轴上的窗口恰好在 00:00 结束不算跨日；实际跨过 00:00 才算", async () => {
  const { utc8DaySpan } = await import("../src/index.js");
  const at = (y: number, mo: number, d: number, h: number) => Date.UTC(y, mo - 1, d, h) - UTC8; // 北京时间 → UTC
  const day = (s: { y: number; m: number; d: number }) => `${s.y}-${s.m}-${s.d}`;
  // [22:00, 00:00)：恰好在 00:00 结束 → 单日
  let s = utc8DaySpan(at(2024, 3, 10, 22), at(2024, 3, 11, 0));
  assert.equal(s.crossesMidnight, false); assert.equal(day(s.first), "2024-3-10"); assert.equal(day(s.last), "2024-3-10");
  // [23:00, 01:00)：跨 00:00 → 前一日在前、当日在后
  s = utc8DaySpan(at(2024, 3, 10, 23), at(2024, 3, 11, 1));
  assert.equal(s.crossesMidnight, true); assert.equal(day(s.first), "2024-3-10"); assert.equal(day(s.last), "2024-3-11");
  // [00:00, 02:00)：从 00:00 开始（左端点含）→ 单日，属新一天
  s = utc8DaySpan(at(2024, 3, 11, 0), at(2024, 3, 11, 2));
  assert.equal(s.crossesMidnight, false); assert.equal(day(s.first), "2024-3-11");
  // 终点比 00:00 多 1 毫秒 → 跨日
  s = utc8DaySpan(at(2024, 3, 10, 22), at(2024, 3, 11, 0) + 1);
  assert.equal(s.crossesMidnight, true);
  // 跨年、跨月同样按日历日判断
  s = utc8DaySpan(at(2023, 12, 31, 23), at(2024, 1, 1, 1));
  assert.equal(s.crossesMidnight, true); assert.equal(day(s.first), "2023-12-31"); assert.equal(day(s.last), "2024-1-1");
});

test("E1-2：交节落在窗口起点算在窗口内，落在终点不算（左闭右开）", async () => {
  const { jieWithin } = await import("../src/index.js");
  const t = loadTables();
  const jz = t.jieqi.all.find((r) => r.year === 2024 && r.term === "惊蛰")!.utcMs;
  assert.equal(jieWithin(t.jieqi, jz, jz + H).length, 1, "起点含");
  assert.equal(jieWithin(t.jieqi, jz - H, jz).length, 0, "终点不含");
  assert.equal(jieWithin(t.jieqi, jz - H, jz + 1).length, 1);
});
