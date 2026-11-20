// 真太阳时专用向量（vectors/true_solar.json，SPEC §6）。
import test from "node:test";
import assert from "node:assert/strict";
import { computeBazi, type BaziInput, type PillarField } from "../src/index.js";
import { loadTables, readVectors } from "./helpers/load.js";

interface Case { id: string; civil_iso: string; longitude_deg: number;
  expect: { true_solar_display: string; eot_seconds_approx: number; expected_day_pillar: string; expected_hour_pillar: string; zi_boundary_hint: boolean } }
const suite = readVectors("true_solar.json") as { cases: Case[]; defaults: { config: BaziInput["config"] } };

for (const c of suite.cases) {
  test(`[true_solar] ${c.id}`, () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/.exec(c.civil_iso)!;
    const off = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 3600 + Number(m[9]) * 60);
    const r = computeBazi({
      civil: { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]!, second: +m[6]! },
      utcOffsetSeconds: off, timePrecision: "MINUTE", gender: "MALE", longitudeDeg: c.longitude_deg, config: suite.defaults.config,
    }, loadTables());
    const ts = r.time_basis.true_solar!;
    assert.equal(ts.true_solar_display, c.expect.true_solar_display);
    assert.ok(Math.abs(ts.eot_seconds - c.expect.eot_seconds_approx) <= 0.01);
    assert.equal((r.day_pillar as PillarField & { value: string }).value, c.expect.expected_day_pillar);
    assert.equal((r.hour_pillar as PillarField & { value: string }).value, c.expect.expected_hour_pillar);
    assert.equal(r.warnings.includes("ZI_BOUNDARY_HINT"), c.expect.zi_boundary_hint);
  });
}
