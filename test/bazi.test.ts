import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, computeBazi, ZI_HINT_CLOCK, ZI_HINT_TRUE_SOLAR, HOUR_UNKNOWN_DECLARATION, type BaziInput } from "../src/index.js";
import { loadTables } from "./helpers/load.js";

const base = (over: Partial<BaziInput> = {}): BaziInput => ({
  civil: { year: 2024, month: 3, day: 7, hour: 10, minute: 22, second: 46 },
  utcOffsetSeconds: 28800, timePrecision: "MINUTE", gender: "MALE",
  config: { zi_rule: "ye_zi_b", zi_reference_time: "clock" }, ...over,
});

test("子时规则：其余三值与缺失被拦截（引擎层，W-03）", () => {
  const t = loadTables();
  for (const v of ["zi_zheng", "zi_chu", "ye_zi_c"]) {
    assert.throws(() => computeBazi(base({ config: { zi_rule: v, zi_reference_time: "clock" } }), t),
      (e: unknown) => e instanceof BlockedError && e.code === "ZI_RULE_NOT_ALLOWED");
  }
});

test("真太阳时：缺经度阻断；有经度时记录经度项、均时差与 UT1−UTC 近似，显示到分钟", () => {
  const t = loadTables();
  const ts = base({ config: { zi_rule: "ye_zi_b", zi_reference_time: "true_solar" } });
  assert.throws(() => computeBazi(ts, t), (e: unknown) => e instanceof BlockedError && e.code === "LONGITUDE_MISSING");
  const r = computeBazi({ ...ts, longitudeDeg: 121.55 }, t); // 宁波附近
  const s = r.time_basis.true_solar!;
  assert.equal(s.ut1_minus_utc_assumed_seconds, 0);
  assert.ok(Math.abs(s.longitude_term_seconds - 121.55 * 240) < 1e-6);
  assert.ok(s.eot_seconds < 0 && s.eot_seconds > -15 * 60); // 3 月初为负
  assert.match(s.true_solar_display, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("子时边界提示：按参考时间判定，文案区分 clock / true_solar", () => {
  const t = loadTables();
  const r1 = computeBazi(base({ civil: { year: 2024, month: 3, day: 10, hour: 22, minute: 45 } }), t);
  assert.ok(r1.notices.some((n) => n.text === ZI_HINT_CLOCK));
  const r2 = computeBazi(base({ civil: { year: 2024, month: 3, day: 10, hour: 21, minute: 0 } }), t);
  assert.ok(!r2.warnings.includes("ZI_BOUNDARY_HINT"));
  // 东经 135°，钟表 22:00 → 经度项 +1 小时 → 真太阳时约 22:50，落入窗口
  const r3 = computeBazi(base({ civil: { year: 2024, month: 3, day: 10, hour: 22, minute: 0 }, longitudeDeg: 135,
    config: { zi_rule: "ye_zi_b", zi_reference_time: "true_solar" } }), t);
  assert.ok(r3.notices.some((n) => n.text === ZI_HINT_TRUE_SOLAR));
});

test("时辰未知：三柱，附规定声明，不做真太阳时切日", () => {
  const t = loadTables();
  const r = computeBazi(base({ timePrecision: "UNKNOWN", civil: { year: 2024, month: 3, day: 7 } }), t);
  assert.equal(r.chart_type, "THREE_PILLARS");
  assert.deepEqual(r.hour_pillar, { value: null, reason: "HOUR_UNKNOWN" });
  assert.ok(r.notices.some((n) => n.text === HOUR_UNKNOWN_DECLARATION));
});

test("远期外推标记：2027 年起（B4-5）", () => {
  const t = loadTables();
  assert.ok(computeBazi(base({ civil: { year: 2027, month: 6, day: 1, hour: 12, minute: 0 } }), t).flags.includes("FAR_FUTURE_EXTRAPOLATION"));
  assert.ok(!computeBazi(base({ civil: { year: 2026, month: 6, day: 1, hour: 12, minute: 0 } }), t).flags.includes("FAR_FUTURE_EXTRAPOLATION"));
});

test("夏令时：+09:00 输入归一到 UTC+8 后再判（B4-12）", () => {
  const t = loadTables();
  // 1988-07-01 10:30 夏令时（UTC+9）= 北京标准时间 09:30
  const r = computeBazi(base({ civil: { year: 1988, month: 7, day: 1, hour: 10, minute: 30 }, utcOffsetSeconds: 9 * 3600 }), t);
  assert.equal(r.time_basis.utc8_iso, "1988-07-01T09:30:00.000+08:00");
});

test("超出节气表范围被阻断", () => {
  const t = loadTables();
  assert.throws(() => computeBazi(base({ civil: { year: 1900, month: 1, day: 10, hour: 12, minute: 0 } }), t),
    (e: unknown) => e instanceof BlockedError && e.code === "JIEQI_OUT_OF_RANGE");
});
