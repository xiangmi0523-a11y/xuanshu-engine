// 非 UTC+8 出生地：只知时辰 / 不知道时辰的日期归属（E1 收口；vectors/tz_precision.json，SPEC §7）。
// 期望值由独立 Python 只读冻结 CSV 推出，不调用引擎（推导脚本：reports/evidence/E1-closure/derive.md）。
import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, computeBazi, type BaziInput, type Shichen } from "../src/index.js";
import { loadTables, readVectors } from "./helpers/load.js";

interface Expect { blocked?: string; day?: string | string[]; hour?: string; year?: string | string[]; month?: string | string[]; warning?: string }
interface Case { id: string; time_precision: "SHICHEN" | "UNKNOWN"; local_date: string; utc_offset_hours: number;
  zi_reference_time: "clock" | "true_solar"; shichen?: Shichen; longitude_deg?: number; expect: Expect; basis: string }
const suite = readVectors("tz_precision.json") as { cases: Case[] };

const field = (f: unknown): string | string[] | null => {
  const o = f as { value?: string | null; candidates?: string[] };
  return o.candidates ?? o.value ?? null;
};

for (const c of suite.cases) {
  test(`[tz] ${c.id}`, () => {
    const [y, m, d] = c.local_date.split("-").map(Number) as [number, number, number];
    const input: BaziInput = {
      civil: { year: y, month: m, day: d }, utcOffsetSeconds: c.utc_offset_hours * 3600,
      timePrecision: c.time_precision, gender: "FEMALE",
      config: { zi_rule: "ye_zi_b", zi_reference_time: c.zi_reference_time },
      ...(c.shichen ? { shichen: c.shichen } : {}),
      ...(c.longitude_deg !== undefined ? { longitudeDeg: c.longitude_deg } : {}),
    };
    if (c.expect.blocked) {
      assert.throws(() => computeBazi(input, loadTables()), (e: unknown) => e instanceof BlockedError && e.code === c.expect.blocked, c.basis);
      return;
    }
    const r = computeBazi(input, loadTables());
    assert.deepEqual(field(r.day_pillar), c.expect.day, `日柱：${c.basis}`);
    assert.deepEqual(field(r.year_pillar), c.expect.year, `年柱：${c.basis}`);
    assert.deepEqual(field(r.month_pillar), c.expect.month, `月柱：${c.basis}`);
    if (c.time_precision === "SHICHEN") assert.equal(field(r.hour_pillar), c.expect.hour, `时柱：${c.basis}`);
    else assert.equal(field(r.hour_pillar), null);
    assert.equal(r.warnings.includes("CROSS_TERM_DAY_HOUR_UNKNOWN"), c.expect.warning === "CROSS_TERM_DAY_HOUR_UNKNOWN");
    const amb = [r.year_pillar, r.month_pillar, r.day_pillar].some((p) => Array.isArray(field(p)));
    assert.equal(r.requires_user_confirmation, amb);
  });
}
