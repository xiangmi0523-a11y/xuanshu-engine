/**
 * 冻结数据表的解析与查询（纯计算：只接收文本，不读文件、不联网）。
 * 文件读取与哈希校验由调用方负责（测试与比对程序用 data/frozen/MANIFEST.json）。
 */
import { BlockedError } from "./errors.js";

export interface SolarTerm {
  year: number;
  term: string;
  longitude: number;
  utcMs: number;
}

export interface JieqiTable {
  all: SolarTerm[];
  /** 只含“节”（黄经 ≡ 15° mod 30°），按时间升序。 */
  jie: SolarTerm[];
}

export function parseJieqiCsv(text: string): JieqiTable {
  const lines = text.trim().split("\n");
  if (lines[0] !== "year,term,ecliptic_longitude,term_utc8_iso,term_utc_iso") throw new Error("节气表表头不符");
  const all: SolarTerm[] = lines.slice(1).map((line) => {
    const [y, term, lon, , utc] = line.split(",");
    const utcMs = Date.parse(utc!);
    if (Number.isNaN(utcMs)) throw new Error(`节气表时间无法解析：${line}`);
    return { year: Number(y), term: term!, longitude: Number(lon), utcMs };
  });
  for (let i = 1; i < all.length; i++) if (all[i]!.utcMs <= all[i - 1]!.utcMs) throw new Error("节气表时间未递增");
  return { all, jie: all.filter((t) => t.longitude % 30 === 15) };
}

/** 最后一个时刻 ≤ t 的节；没有则返回 undefined。 */
export function prevJie(table: JieqiTable, t: number): SolarTerm | undefined {
  const a = table.jie;
  let lo = 0, hi = a.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]!.utcMs <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? a[ans] : undefined;
}

/** 第一个时刻 > t 的节。 */
export function nextJie(table: JieqiTable, t: number): SolarTerm | undefined {
  const p = prevJie(table, t);
  const i = p ? table.jie.indexOf(p) + 1 : 0;
  return table.jie[i];
}

/** 最后一个时刻 ≤ t 的立春。 */
export function prevLichun(table: JieqiTable, t: number): SolarTerm | undefined {
  let found: SolarTerm | undefined;
  for (const j of table.jie) {
    if (j.utcMs > t) break;
    if (j.longitude === 315) found = j;
  }
  return found;
}

/** [from, to) 内的所有节。 */
export function jieWithin(table: JieqiTable, from: number, to: number): SolarTerm[] {
  return table.jie.filter((j) => j.utcMs >= from && j.utcMs < to);
}

/** 支持区间：须能找到前一个立春与后一个节。 */
export function assertJieqiRange(table: JieqiTable, t: number): void {
  if (!prevLichun(table, t) || !nextJie(table, t)) {
    const first = table.jie.find((j) => j.longitude === 315)!;
    const last = table.jie[table.jie.length - 1]!;
    throw new BlockedError("JIEQI_OUT_OF_RANGE",
      `超出节气基准表支持范围（${new Date(first.utcMs).toISOString()} 至 ${new Date(last.utcMs).toISOString()} 之前）`);
  }
}

export interface EotTable {
  /** 首个样本的 UT1 时刻（按 UTC 坐标表示，UT1 − UTC 取 0，见 B1-1）。 */
  startMs: number;
  /** 每日样本，单位秒（视太阳时 − 平太阳时）。 */
  seconds: Float64Array;
}

const DAY_MS = 86_400_000;

export function parseEotCsv(text: string): EotTable {
  const lines = text.trim().split("\n");
  if (lines[0] !== "date,sample_ut1_iso,eot_seconds") throw new Error("均时差表表头不符");
  const rows = lines.slice(1);
  const startMs = Date.parse(rows[0]!.split(",")[1]!);
  const seconds = new Float64Array(rows.length);
  rows.forEach((line, i) => {
    const [, iso, v] = line.split(",");
    if (Date.parse(iso!) !== startMs + i * DAY_MS) throw new Error(`均时差表日期不连续：${line}`);
    seconds[i] = Number(v);
  });
  return { startMs, seconds };
}

/**
 * 按 UTC 时刻在相邻两日样本间线性插值（B1-1）。
 * 时间坐标：查表坐标为 UT1；输入为 UTC 时取 UT1 − UTC = 0，调用方须在结果中记录此近似。
 */
export function eotSecondsAt(table: EotTable, utcMs: number): number {
  const x = (utcMs - table.startMs) / DAY_MS;
  const i = Math.floor(x);
  const n = table.seconds.length;
  if (x < 0 || x > n - 1) throw new BlockedError("EOT_OUT_OF_RANGE", "超出均时差表范围（1900-01-01 至 2101-01-01）");
  if (i === n - 1) return table.seconds[i]!;
  const f = x - i;
  return table.seconds[i]! * (1 - f) + table.seconds[i + 1]! * f;
}
