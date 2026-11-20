/**
 * 八字四柱计算（纯计算核心，B3-1 E1）。
 *
 * 契约依据：§13.1～§13.4、§13.10（降级、按柱歧义、交节、换日）；§9.4 与【用户裁决 B1-1】（真太阳时、子时边界提示）；
 * 【用户裁决 B4-12】（交节按北京钟表时间，表内 1972 年前为 UT1）；【用户裁决 B4-5】（2027 年起远期外推标记）；
 * 【用户裁决 N-3】（时辰未知不做真太阳时切日）；【用户裁决 N-6】（子时规则锁定 ye_zi_b）。
 *
 * 本模块只算四柱与其不确定性，不判定 FORMAL / NON_FORMAL（那取决于批准与阻断状态，不属 E1）。
 */
import { BlockedError } from "./errors.js";
import { assertZiRuleAllowed } from "./zi.js";
import {
  dayIndex, ganzhiName, hourBranchOfMinute, hourIndex, monthBranchOfJie, monthIndex, yearIndex,
  SHICHEN_NAMES, type Shichen,
} from "./ganzhi.js";
import {
  assertJieqiRange, eotSecondsAt, jieWithin, nextJie, prevJie, prevLichun,
  type EotTable, type JieqiTable, type SolarTerm,
} from "./tables.js";

export type Gender = "MALE" | "FEMALE" | "UNKNOWN";
export type TimePrecision = "MINUTE" | "SHICHEN" | "UNKNOWN";
export type ZiReferenceTime = "clock" | "true_solar";

export interface CivilDateTime {
  year: number; month: number; day: number;
  hour?: number; minute?: number; second?: number;
}

export interface BaziInput {
  /** 出生证明上的钟表时间（当地民用时）。SHICHEN / UNKNOWN 时只用日期。 */
  civil: CivilDateTime;
  /** 时区解析结果：该时刻的 UTC 偏移秒数（含夏令时），来自 tz_resolution（§6.1），引擎不自行推断。 */
  utcOffsetSeconds: number;
  timePrecision: TimePrecision;
  /** timePrecision = SHICHEN 时必填。日期 D + 子时 = [D−1 23:00, D 01:00)（§13.3、B4-14）。 */
  shichen?: Shichen;
  gender: Gender;
  /** 东经为正（度）。zi_reference_time = true_solar 且精度为 MINUTE 时必填。 */
  longitudeDeg?: number;
  config: { zi_rule: string; zi_reference_time: ZiReferenceTime };
}

export interface Tables { jieqi: JieqiTable; eot: EotTable }

export type PillarField =
  | { value: string; ambiguous: false }
  | { candidates: [string, string]; ambiguous: true };

export interface Notice { code: string; text: string }

export interface BaziResult {
  chart_type: "FOUR_PILLARS" | "THREE_PILLARS";
  result_completeness: "COMPLETE" | "OK_WITH_DEGRADATION";
  degradation_reasons: string[];
  year_pillar: PillarField;
  month_pillar: PillarField;
  day_pillar: PillarField;
  hour_pillar: PillarField | { value: null; reason: "HOUR_UNKNOWN" };
  luck_cycle?: { value: null; status: "DEGRADED_LUCK_OMITTED"; reason: "MISSING_GENDER" };
  flags: string[];
  warnings: string[];
  notices: Notice[];
  primary_candidate: Partial<Record<"year_pillar" | "month_pillar" | "day_pillar", string>>;
  requires_user_confirmation: boolean;
  time_basis: {
    zi_reference_time: ZiReferenceTime;
    birth_utc_iso?: string;
    utc8_iso?: string;
    true_solar?: {
      longitude_term_seconds: number;
      eot_seconds: number;
      ut1_minus_utc_assumed_seconds: 0;
      true_solar_display: string; // 只到分钟（P-D-08-c 禁止秒级输出）
    };
  };
  /** 契约未写明、E1 先按此实现并待裁决的点。 */
  pending: string[];
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const UTC8 = 8 * HOUR;

const JIE_AMBIGUOUS_MS = 1 * MIN;            // §13.4 判定层：距交节 ±1 分钟内（含）
const WARN_MS = 2 * HOUR, WARN_LICHUN_MS = 24 * HOUR; // §13.4 告警层
const FAR_FUTURE_FROM_YEAR = 2027;           // B4-5

export const ZI_HINT_TRUE_SOLAR =
  "子时边界提示：当前采用经度和均时差修正后的真太阳时。出生时刻接近 23:00 或 01:00 子时分界，日柱或时柱归属可能受到出生时间记录精度及时间修正影响。请核实出生时间及子时分界规则。本结果已标记子时边界敏感性。";
export const ZI_HINT_CLOCK =
  "子时边界提示：当前采用钟表时间作为日柱及时柱归属判断基准，未使用真太阳时修正。出生时刻接近 23:00 或 01:00 子时分界，日柱或时柱归属可能受到出生时间记录精度影响。如采用真太阳时，归属结果可能不同。请核实出生时间及子时分界规则。本结果已标记子时边界敏感性。";
export const HOUR_UNKNOWN_DECLARATION =
  "因出生时辰未知，日柱按登记日期确定，未做真太阳时切日；若出生时刻经真太阳时换算后跨过 00:00，日柱可能变动。";

/** 用 UTC 字段读取“某参考时间轴”上的日期与分钟（参考时间 = UTC 时刻 + 偏移）。 */
function parts(msOnAxis: number) {
  const d = new Date(msOnAxis);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
const fmt = (msOnAxis: number) => new Date(msOnAxis).toISOString().slice(0, 16).replace("T", " ");

/** 某 UTC 时刻的年柱、月柱（交节一律按时刻比较，与参考时间无关，§13.4）。 */
function yearMonthAt(tables: Tables, t: number): { year: string; month: string } {
  const lichun = prevLichun(tables.jieqi, t)!;
  const yi = yearIndex(lichun.year);
  const jie = prevJie(tables.jieqi, t)!;
  return { year: ganzhiName(yi), month: ganzhiName(monthIndex(yi % 10, monthBranchOfJie(jie.longitude))) };
}

/** 交节 n 前后两侧的年柱、月柱（候选 A = 交节前，B = 交节后，§13.11 规则 4）。 */
function sides(tables: Tables, n: SolarTerm) {
  return { before: yearMonthAt(tables, n.utcMs - 1), after: yearMonthAt(tables, n.utcMs) };
}

function dayPillarOf(y: number, m: number, d: number): string {
  return ganzhiName(dayIndex(y, m, d));
}

/** 子时时干按 00:00 之后那一日的日干起（§13.3，DAY_AFTER_0000_STEM）。 */
function hourPillarOn(dateMsOnAxis: number, minuteOfDay: number): string {
  const branch = hourBranchOfMinute(minuteOfDay);
  const stemDay = minuteOfDay >= 23 * 60 ? dateMsOnAxis + DAY : dateMsOnAxis;
  const p = parts(stemDay);
  return ganzhiName(hourIndex(dayIndex(p.y, p.m, p.d) % 10, branch));
}

const single = (value: string): PillarField => ({ value, ambiguous: false });

export function computeBazi(input: BaziInput, tables: Tables): BaziResult {
  assertZiRuleAllowed(input.config.zi_rule);
  const { civil, timePrecision } = input;
  const ref = input.config.zi_reference_time;

  const degradation: string[] = [];
  const flags = new Set<string>();
  const warnings: string[] = [];
  const notices: Notice[] = [];
  const pending: string[] = [];
  const primary: BaziResult["primary_candidate"] = {};
  const offset = input.utcOffsetSeconds * 1000;
  const dateUtcMidnight = Date.UTC(civil.year, civil.month - 1, civil.day); // 日期 D（在 UTC+8 轴上视为 D 00:00）

  if (input.gender === "UNKNOWN") degradation.push("MISSING_GENDER");
  if (input.utcOffsetSeconds !== 8 * 3600) {
    pending.push("非 UTC+8 输入：钟表基准按归一到 UTC+8 后的时间计（§13.10 第 2 条字面）；海外出生是否改用当地钟表日期【待定】");
  }

  let year: PillarField, month: PillarField, day: PillarField;
  let hour: BaziResult["hour_pillar"];
  const time_basis: BaziResult["time_basis"] = { zi_reference_time: ref };

  if (timePrecision === "MINUTE") {
    const t = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour ?? NaN, civil.minute ?? NaN, civil.second ?? 0) - offset;
    if (Number.isNaN(t)) throw new BlockedError("TIME_MISSING", "精度为 MINUTE 但缺少时、分");
    assertJieqiRange(tables.jieqi, t);
    time_basis.birth_utc_iso = new Date(t).toISOString();
    time_basis.utc8_iso = new Date(t + UTC8).toISOString().replace("Z", "+08:00");

    // 参考时间轴：clock = UTC+8 钟表时间；true_solar = UTC + 经度项 + 均时差
    let axis = t + UTC8;
    if (ref === "true_solar") {
      if (input.longitudeDeg === undefined) throw new BlockedError("LONGITUDE_MISSING", "真太阳时需要出生地经度（§9.3 第 2 步）");
      const lonSec = input.longitudeDeg * 240;
      const eot = eotSecondsAt(tables.eot, t);
      axis = t + (lonSec + eot) * 1000;
      time_basis.true_solar = {
        longitude_term_seconds: Math.round(lonSec * 1000) / 1000,
        eot_seconds: Math.round(eot * 1000) / 1000,
        ut1_minus_utc_assumed_seconds: 0,
        true_solar_display: fmt(axis),
      };
    }
    const p = parts(axis);
    const dateOnAxis = Date.UTC(p.y, p.m - 1, p.d);
    day = single(dayPillarOf(p.y, p.m, p.d));
    hour = single(hourPillarOn(dateOnAxis, p.minuteOfDay));

    // 年柱、月柱与交节判定
    const prev = prevJie(tables.jieqi, t)!, next = nextJie(tables.jieqi, t)!;
    const near = t - prev.utcMs <= next.utcMs - t ? prev : next;
    const dist = Math.abs(t - near.utcMs);
    const ym = yearMonthAt(tables, t);
    if (dist <= JIE_AMBIGUOUS_MS) {
      const s = sides(tables, near);
      flags.add("SOLAR_TERM_BOUNDARY_AMBIGUOUS");
      if (near.longitude === 315) {
        year = { candidates: [s.before.year, s.after.year], ambiguous: true };
        primary.year_pillar = s.before.year;
      } else year = single(ym.year);
      month = { candidates: [s.before.month, s.after.month], ambiguous: true };
      primary.month_pillar = s.before.month;
    } else {
      year = single(ym.year);
      month = single(ym.month);
    }
    // 告警层：前后两个“节”任一在窗口内即告警（立春 ±24 小时，其余 ±2 小时；端点暂取含，【待定】）
    for (const j of [prev, next]) {
      const w = j.longitude === 315 ? WARN_LICHUN_MS : WARN_MS;
      if (Math.abs(t - j.utcMs) <= w && !warnings.includes("boundary_warning")) warnings.push("boundary_warning");
    }
    if (parts(t + UTC8).y >= FAR_FUTURE_FROM_YEAR) flags.add("FAR_FUTURE_EXTRAPOLATION");

    // 子时边界提示（§9.4，B1-1）：按参考时间判定 22:30–23:30 或 00:30–01:30（端点含否【待定】，暂取闭区间）
    const mm = p.minuteOfDay;
    if ((mm >= 22 * 60 + 30 && mm <= 23 * 60 + 30) || (mm >= 30 && mm <= 90)) {
      warnings.push("ZI_BOUNDARY_HINT");
      notices.push({ code: "ZI_BOUNDARY_HINT", text: ref === "true_solar" ? ZI_HINT_TRUE_SOLAR : ZI_HINT_CLOCK });
      pending.push("子时边界提示窗口端点是否包含（22:30、23:30、00:30、01:30）契约未写明，暂取闭区间【待定】");
    }
  } else if (timePrecision === "SHICHEN") {
    if (!input.shichen) throw new BlockedError("SHICHEN_MISSING", "精度为 SHICHEN 但未给出时辰");
    const b = SHICHEN_NAMES.indexOf(input.shichen);
    // 窗口在 UTC+8 钟表轴上：子时 = [D−1 23:00, D 01:00)；其余时辰 = [D 2b−1 时, D 2b+1 时)
    const startAxis = b === 0 ? dateUtcMidnight - HOUR : dateUtcMidnight + (2 * b - 1) * HOUR;
    const endAxis = startAxis + 2 * HOUR;
    const ws = startAxis - UTC8, we = endAxis - UTC8; // UTC 时刻
    assertJieqiRange(tables.jieqi, ws);
    assertJieqiRange(tables.jieqi, we - 1);
    if (ref === "true_solar") pending.push("SHICHEN 窗口按 UTC+8 钟表时间解释；选真太阳时时的解释【待定】");

    // 日柱：子时跨 00:00，候选 [D−1, D]；其余时辰日柱为 D
    const pD = parts(dateUtcMidnight), pPrev = parts(dateUtcMidnight - DAY);
    if (b === 0) {
      const a = dayPillarOf(pPrev.y, pPrev.m, pPrev.d), bb = dayPillarOf(pD.y, pD.m, pD.d);
      day = { candidates: [a, bb], ambiguous: true };
      primary.day_pillar = a;
    } else day = single(dayPillarOf(pD.y, pD.m, pD.d));
    // 时柱单值：子时按 D 的日干起；其余按 D
    hour = single(ganzhiName(hourIndex(dayIndex(pD.y, pD.m, pD.d) % 10, b)));

    const inWin = jieWithin(tables.jieqi, ws, we);
    const ym = yearMonthAt(tables, ws);
    if (inWin.length) {
      const n = inWin[0]!;
      const s = sides(tables, n);
      flags.add("SOLAR_TERM_BOUNDARY_AMBIGUOUS");
      if (n.longitude === 315) {
        year = { candidates: [s.before.year, s.after.year], ambiguous: true };
        primary.year_pillar = s.before.year;
      } else year = single(ym.year);
      month = { candidates: [s.before.month, s.after.month], ambiguous: true };
      primary.month_pillar = s.before.month;
    } else {
      year = single(ym.year);
      month = single(ym.month);
    }
    if (pD.y >= FAR_FUTURE_FROM_YEAR) flags.add("FAR_FUTURE_EXTRAPOLATION");
  } else {
    // UNKNOWN：三柱模式；日柱按登记日期 D，不做真太阳时切日（N-3）
    degradation.push("HOUR_UNKNOWN");
    const ds = dateUtcMidnight - UTC8, de = ds + DAY;
    assertJieqiRange(tables.jieqi, ds);
    assertJieqiRange(tables.jieqi, de - 1);
    day = single(dayPillarOf(civil.year, civil.month, civil.day));
    hour = { value: null, reason: "HOUR_UNKNOWN" };
    notices.push({ code: "HOUR_UNKNOWN_DAY_BY_REGISTERED_DATE", text: HOUR_UNKNOWN_DECLARATION });
    const inDay = jieWithin(tables.jieqi, ds, de);
    const ym = yearMonthAt(tables, ds);
    if (inDay.length) {
      const n = inDay[0]!;
      const s = sides(tables, n);
      flags.add("SOLAR_TERM_BOUNDARY_AMBIGUOUS");
      warnings.push("CROSS_TERM_DAY_HOUR_UNKNOWN");
      if (n.longitude === 315) {
        year = { candidates: [s.before.year, s.after.year], ambiguous: true };
        primary.year_pillar = s.before.year;
      } else year = single(ym.year);
      month = { candidates: [s.before.month, s.after.month], ambiguous: true };
      primary.month_pillar = s.before.month;
    } else {
      year = single(ym.year);
      month = single(ym.month);
    }
    if (civil.year >= FAR_FUTURE_FROM_YEAR) flags.add("FAR_FUTURE_EXTRAPOLATION");
  }

  const ambiguous = [year, month, day, hour].some((f) => "ambiguous" in f && f.ambiguous);
  const result: BaziResult = {
    chart_type: timePrecision === "UNKNOWN" ? "THREE_PILLARS" : "FOUR_PILLARS",
    result_completeness: degradation.length ? "OK_WITH_DEGRADATION" : "COMPLETE",
    degradation_reasons: degradation,
    year_pillar: year, month_pillar: month, day_pillar: day, hour_pillar: hour,
    flags: [...flags], warnings, notices,
    primary_candidate: primary,
    requires_user_confirmation: ambiguous,
    time_basis, pending,
  };
  if (input.gender === "UNKNOWN") result.luck_cycle = { value: null, status: "DEGRADED_LUCK_OMITTED", reason: "MISSING_GENDER" };
  return result;
}
