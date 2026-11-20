/**
 * 干支基础（纯计算）。
 * - 六十甲子序：0 = 甲子 … 59 = 癸亥（P-D-01）。
 * - 日柱：1949-10-01 = 甲子，序 = (日期 − 1949-10-01) mod 60（P-D-04，锚点递推）。
 * - 年柱：以立春为界（CFG-03 = lichun，P-D-02），立春所在公历年 Y 的序 = (Y − 4) mod 60。
 * - 月柱：月支由“节”定，月干按五虎遁（P-D-03）。
 * - 时柱：时支按子时 23:00–01:00 起每两小时一支，时干按五鼠遁（P-D-05）。
 */
export const STEMS = "甲乙丙丁戊己庚辛壬癸";
export const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function ganzhiName(index: number): string {
  const i = mod(index, 60);
  return STEMS[i % 10]! + BRANCHES[i % 12]!;
}

/** 由天干序、地支序求六十甲子序（二者奇偶须一致）。 */
export function indexOf(stem: number, branch: number): number {
  if (mod(stem, 2) !== mod(branch, 2)) throw new Error(`干支奇偶不一致：${stem} ${branch}（P-D-01 须拒绝）`);
  return mod(6 * stem - 5 * branch, 60);
}

const DAY_MS = 86_400_000;
const ANCHOR_DAY = Date.UTC(1949, 9, 1) / DAY_MS;

/** 公历日期 → 日柱序（锚点 1949-10-01 甲子）。 */
export function dayIndex(year: number, month: number, day: number): number {
  return mod(Date.UTC(year, month - 1, day) / DAY_MS - ANCHOR_DAY, 60);
}

/** 立春年 → 年柱序。 */
export function yearIndex(lichunYear: number): number {
  return mod(lichunYear - 4, 60);
}

/** 五虎遁：年干 + 月支 → 月柱序。寅月起干：甲己丙、乙庚戊、丙辛庚、丁壬壬、戊癸甲。 */
export function monthIndex(yearStem: number, monthBranch: number): number {
  const yinStem = mod(mod(yearStem, 5) * 2 + 2, 10);
  const stem = mod(yinStem + mod(monthBranch - 2, 12), 10);
  return indexOf(stem, monthBranch);
}

/** 五鼠遁：日干 + 时支 → 时柱序。子时起干：甲己甲、乙庚丙、丙辛戊、丁壬庚、戊癸壬。 */
export function hourIndex(dayStem: number, hourBranch: number): number {
  const ziStem = mod(mod(dayStem, 5) * 2, 10);
  return indexOf(mod(ziStem + hourBranch, 10), hourBranch);
}

/** 一日内分钟数 → 时支序（子 = 23:00–00:59）。 */
export function hourBranchOfMinute(minuteOfDay: number): number {
  return mod(Math.floor((minuteOfDay + 60) / 120), 12);
}

/** 节的黄经 → 月支序：立春 315° 寅 … 小寒 285° 丑。 */
export function monthBranchOfJie(longitude: number): number {
  if (mod(longitude, 30) !== 15) throw new Error(`${longitude}° 不是“节”`);
  return mod(mod(longitude - 315, 360) / 30 + 2, 12);
}

export const SHICHEN_NAMES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
export type Shichen = (typeof SHICHEN_NAMES)[number];
