// 按 vectors/SPEC.md 运行 B4 回归矩阵 group 0～4 向量（引擎单元测试层面）。
// 与冻结基准的全量比对另由 xuanshu-data/harness/ 独立执行（B4-11、B3-1 D4）。
import test from "node:test";
import assert from "node:assert/strict";
import { computeBazi, type BaziInput, type BaziResult, type PillarField, type Shichen, type Tables } from "../src/index.js";
import { loadTables, readVectors } from "./helpers/load.js";

type Json = Record<string, unknown>;
interface Vec { id: string; group: string; input: Json; expect: Json }
interface Suite { defaults: { utc_offset_seconds: number; config: BaziInput["config"] }; cases: Vec[] }

const suite = readVectors("b4_group0_4.json") as Suite;
const H = 3_600_000, M = 60_000, UTC8 = 8 * H;

function parseOffset(s: string): number {
  const m = /^([+-])((\d+)h)?((\d+)m)?$/.exec(s);
  if (!m || (m[3] === undefined && m[5] === undefined)) throw new Error(`offset 语法错误：${s}`);
  return (m[1] === "-" ? -1 : 1) * ((Number(m[3] ?? 0) * 60 + Number(m[5] ?? 0)) * M);
}

function termUtc(t: Tables, year: number, term: string): number {
  const x = t.jieqi.all.find((r) => r.year === year && r.term === term);
  if (!x) throw new Error(`节气表无 ${year} ${term}`);
  return x.utcMs;
}

function civilFromUtc8(ms: number): BaziInput["civil"] {
  const d = new Date(ms + UTC8);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

function buildInput(v: Vec, t: Tables): { input: BaziInput; utcMs?: number; termMs?: number } {
  const i = v.input;
  let civil: BaziInput["civil"], utcMs: number | undefined, termMs: number | undefined;
  if (typeof i.fixed_utc8_datetime === "string") {
    utcMs = Date.parse(i.fixed_utc8_datetime);
    civil = civilFromUtc8(utcMs);
  } else if (typeof i.fixed_utc8_date === "string") {
    const [y, m, d] = i.fixed_utc8_date.split("-").map(Number) as [number, number, number];
    civil = { year: y, month: m, day: d };
    if (typeof i.term === "string") termMs = termUtc(t, i.year as number, i.term);
  } else {
    termMs = termUtc(t, i.year as number, i.term as string);
    utcMs = termMs + parseOffset(i.offset as string);
    civil = civilFromUtc8(utcMs);
  }
  if (i.time_precision === "UNKNOWN") civil = { year: civil.year, month: civil.month, day: civil.day };
  if (i.time_precision === "SHICHEN" && utcMs !== undefined) {
    // SPEC §3：用具体时刻表示时辰时，D = （该时刻 + 1 小时）的北京日期，使子时 [D−1 23:00, D 01:00) 包含该时刻
    const d = civilFromUtc8(utcMs + H);
    civil = { year: d.year, month: d.month, day: d.day };
  }
  const input: BaziInput = {
    civil, utcOffsetSeconds: suite.defaults.utc_offset_seconds,
    timePrecision: i.time_precision as BaziInput["timePrecision"],
    gender: i.gender as BaziInput["gender"], config: suite.defaults.config,
  };
  if (typeof i.shichen === "string") input.shichen = i.shichen as Shichen;
  const out: { input: BaziInput; utcMs?: number; termMs?: number } = { input };
  if (utcMs !== undefined) out.utcMs = utcMs;
  if (termMs !== undefined) out.termMs = termMs;
  return out;
}

const valueOf = (f: PillarField | { value: null }): string | null => ("candidates" in f ? null : f.value);
const amb = (f: PillarField | { value: null }): boolean => "ambiguous" in f && f.ambiguous;
const pillarKey = { year: "year_pillar", month: "month_pillar", day: "day_pillar", hour: "hour_pillar" } as const;

for (const v of suite.cases) {
  test(`[group ${v.group}] ${v.id}`, () => {
    const t = loadTables();
    const { input, utcMs, termMs } = buildInput(v, t);
    const r: BaziResult = computeBazi(input, t);
    const e = v.expect;
    if ("expected_status" in e) assert.equal(r.result_completeness, e.expected_status);
    if ("expected_reasons" in e) assert.deepEqual([...r.degradation_reasons].sort(), [...(e.expected_reasons as string[])].sort());
    if ("expected_luck_status" in e) assert.equal(r.luck_cycle?.status, e.expected_luck_status);
    if ("chart_type" in e) assert.equal(r.chart_type, e.chart_type);
    for (const p of ["year", "month", "day", "hour"] as const) {
      const f = r[pillarKey[p]];
      if (`expected_${p}_pillar` in e) assert.equal(valueOf(f), e[`expected_${p}_pillar`], `${p} 柱`);
      if (`${p}_ambiguous` in e) assert.equal(amb(f), e[`${p}_ambiguous`], `${p} 歧义`);
      if (`${p}_candidates` in e) assert.deepEqual("candidates" in f ? f.candidates : null, e[`${p}_candidates`], `${p} 候选`);
    }
    if ("primary_candidate_year" in e) assert.equal(r.primary_candidate.year_pillar, e.primary_candidate_year);
    if ("primary_candidate_month" in e) assert.equal(r.primary_candidate.month_pillar, e.primary_candidate_month);
    for (const k of (e.primary_candidate_includes as string[] | undefined) ?? []) assert.ok(k in r.primary_candidate, `primary 含 ${k}`);
    if (Array.isArray(e.primary_candidate_includes) && e.primary_candidate_includes.length === 0) assert.deepEqual(r.primary_candidate, {});
    for (const k of (e.primary_candidate_excludes as string[] | undefined) ?? []) assert.ok(!(k in r.primary_candidate), `primary 不含 ${k}`);
    if ("requires_user_confirmation" in e) assert.equal(r.requires_user_confirmation, e.requires_user_confirmation);
    for (const w of (e.expected_warnings as string[] | undefined) ?? []) assert.ok(r.warnings.includes(w), `应含告警 ${w}`);
    for (const w of (e.expected_warnings_not_containing as string[] | undefined) ?? []) assert.ok(!r.warnings.includes(w), `不应含告警 ${w}`);
    if ("expected_flag" in e) {
      if (e.expected_flag === null) assert.ok(!r.flags.includes("SOLAR_TERM_BOUNDARY_AMBIGUOUS"));
      else assert.ok(r.flags.includes(e.expected_flag as string));
    }
    if ("hour_pillar" in e && e.hour_pillar === null) assert.ok("value" in r.hour_pillar && r.hour_pillar.value === null);
    for (const p of ["year", "month"] as const) {
      if (`${p}_after_term` in e) {
        assert.ok(termMs !== undefined);
        const before = computeBazi({ ...input, civil: civilFromUtc8(termMs - 3 * M) }, t);
        const after = computeBazi({ ...input, civil: civilFromUtc8(termMs + 3 * M) }, t);
        const want = e[`${p}_after_term`] ? after : before;
        assert.equal(valueOf(r[pillarKey[p]]), valueOf(want[pillarKey[p]]), `${p}_after_term`);
      }
    }
    if (e.next_hour_adjacent) {
      assert.ok(utcMs !== undefined);
      const next = computeBazi({ ...input, civil: civilFromUtc8(utcMs + H) }, t);
      const a = valueOf(r.hour_pillar as PillarField), b = valueOf(next.hour_pillar as PillarField);
      assert.equal(b, e.next_hour_expected);
      // 六十甲子序在运行器内独立列出，不调用引擎函数判定
      const SEQ = Array.from({ length: 60 }, (_, k) => "甲乙丙丁戊己庚辛壬癸"[k % 10]! + "子丑寅卯辰巳午未申酉戌亥"[k % 12]!);
      const idx = (s: string | null) => SEQ.indexOf(s ?? "");
      assert.equal((idx(b) - idx(a) + 60) % 60, 1, "亥时接子时须相邻");
    }
  });
}
