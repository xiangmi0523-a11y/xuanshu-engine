// jcs-1 规范化与字段级校验 —— 审核清单 §6.2（通用规则）、§6.4（字段级规则）；契约 §1.2（哈希存 hash_algorithm 与 canonicalization_version；古籍原文不做 Unicode 归一化）。
// 规范化版本只增不改（P-37）：本文件实现 jcs-1；将来新版本另起实现，旧实现永久保留，校验按记录上的版本选用。
import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "jcs-1" as const;
export const HASH_ALGORITHM = "sha256" as const;

export class CanonicalError extends Error {
  constructor(public readonly code: string, message: string) { super(`[${code}] ${message}`); }
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ---------------------------------------------------------------- 严格解析（拒绝重复键、孤立代理、非整数、-0、超界整数）
export function parseStrict(text: string): Json {
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i]!)) i++; };
  const err = (code: string, m: string): never => { throw new CanonicalError(code, `${m}（位置 ${i}）`); };
  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === "\"") return string();
    if (c === "t" && text.startsWith("true", i)) { i += 4; return true; }
    if (c === "f" && text.startsWith("false", i)) { i += 5; return false; }
    if (c === "n" && text.startsWith("null", i)) { i += 4; return null; }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    return err("DB-H-10", `无法解析的记号 ${JSON.stringify(text.slice(i, i + 8))}（NaN、Infinity 等不是合法值）`);
  };
  const object = (): Json => {
    i++; const o: { [k: string]: Json } = Object.create(null); ws();
    if (text[i] === "}") { i++; return o; }
    for (;;) {
      ws(); if (text[i] !== "\"") err("DB-H-parse", "对象键须为字符串");
      const k = string();
      if (Object.prototype.hasOwnProperty.call(o, k)) err("DB-H-07", `重复键 ${JSON.stringify(k)}`);
      ws(); if (text[i] !== ":") err("DB-H-parse", "缺冒号"); i++;
      o[k] = value(); ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return o; }
      err("DB-H-parse", "对象未闭合");
    }
  };
  const array = (): Json => {
    i++; const a: Json[] = []; ws();
    if (text[i] === "]") { i++; return a; }
    for (;;) {
      a.push(value()); ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return a; }
      err("DB-H-parse", "数组未闭合");
    }
  };
  const string = (): string => {
    i++; let out = "";
    for (;;) {
      if (i >= text.length) err("DB-H-parse", "字符串未闭合");
      const c = text[i]!;
      if (c === "\"") { i++; break; }
      if (c === "\\") {
        const e = text[i + 1]; i += 2;
        if (e === "u") { const h = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) err("DB-H-parse", "\\u 转义不完整"); out += String.fromCharCode(parseInt(h, 16)); i += 4; }
        else if (e !== undefined && e in ESC_IN) out += ESC_IN[e];
        else err("DB-H-parse", "非法转义");
      } else {
        if (c.charCodeAt(0) < 0x20) err("DB-H-parse", "字符串中有未转义的控制字符");
        out += c; i++;
      }
    }
    assertWellFormed(out);
    return out;
  };
  const number = (): number => {
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (!m) return err("DB-H-parse", "数字格式错误");
    i += m[0].length;
    if (m[2] !== undefined || m[3] !== undefined) err("DB-H-08", `非整数数值 ${m[0]}（非整数须以固定刻度十进制字符串表示）`);
    if (m[0] === "-0") err("DB-H-10", "不允许 -0");
    const n = Number(m[0]);
    if (!Number.isSafeInteger(n)) err("DB-H-09", `整数超出 ±(2^53 − 1)：${m[0]}`);
    return n;
  };
  const v = value(); ws();
  if (i !== text.length) err("DB-H-parse", "末尾有多余内容");
  return v;
}
const ESC_IN: Record<string, string> = { "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

function assertWellFormed(s: string): void {
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(k + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new CanonicalError("DB-H-06", `孤立代理项 U+${c.toString(16).toUpperCase()}`);
      k++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new CanonicalError("DB-H-06", `孤立代理项 U+${c.toString(16).toUpperCase()}`);
  }
}

// ---------------------------------------------------------------- 规范化输出（RFC 8785 做法；不做 Unicode 归一化）
export function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CanonicalError("DB-H-10", `不允许 ${v}`);
    if (Object.is(v, -0)) throw new CanonicalError("DB-H-10", "不允许 -0");
    if (!Number.isInteger(v)) throw new CanonicalError("DB-H-08", `非整数数值 ${v}`);
    if (!Number.isSafeInteger(v)) throw new CanonicalError("DB-H-09", `整数超出 ±(2^53 − 1)：${v}`);
    return String(v);
  }
  if (typeof v === "string") { assertWellFormed(v); return quote(v); }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // 键按 UTF-16 码元升序：JS 默认字符串比较即按 UTF-16 码元
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${quote(k)}:${canonicalize(o[k])}`).join(",")}}`;
  }
  throw new CanonicalError("DB-H-type", `不支持的类型 ${typeof v}`);
}

function quote(s: string): string {
  assertWellFormed(s);
  let out = "\"";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\"") out += "\\\"";
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + "\"";
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}
/** 对象 → jcs-1 规范化文本 → sha256（小写十六进制） */
export function hashOf(v: unknown): string { return sha256Hex(canonicalize(v)); }

/** 校验文本是否已是规范化形式（DB-J-06）：严格解析后重新规范化，须与原文逐字节相同 */
export function assertCanonicalText(text: string): Json {
  const v = parseStrict(text);
  if (canonicalize(v) !== text) throw new CanonicalError("DB-J-06", "文本合法但不是规范化形式（键序、空白等）");
  return v;
}

// ---------------------------------------------------------------- 字段级规则（清单 §6.4）
// 字段规则：kind 为类型；presence：req 必须出现 / opt 不适用即省略 / nullable 契约明定可为 null。
type Rule =
  | { kind: "str"; presence?: Presence; pattern?: RegExp; oneOf?: readonly string[] }
  | { kind: "int"; presence?: Presence; min?: number; max?: number }
  | { kind: "bool"; presence?: Presence }
  | { kind: "dec"; scale: number; presence?: Presence }
  | { kind: "obj"; presence?: Presence; fields: Record<string, Rule>; open?: false }
  | { kind: "arr"; presence?: Presence; order: "ordered" | "set"; item: Rule; len?: number }
  | { kind: "any"; presence?: Presence }
  | { kind: "union"; presence?: Presence; options: Rule[] };
type Presence = "req" | "opt" | "nullable";

export function validate(rule: Rule, v: unknown, path = "$"): void {
  const fail = (code: string, m: string): never => { throw new CanonicalError(code, `${path}：${m}`); };
  if (v === null) { if (rule.presence === "nullable") return; fail("DB-H-12", "该字段不允许 null（不适用应省略）"); }
  switch (rule.kind) {
    case "any": return;
    case "union": {
      const errs: string[] = [];
      for (const o of rule.options) { try { validate(o, v, path); return; } catch (e) { errs.push((e as Error).message); } }
      return fail("DB-H-19", `不符合任一允许结构：${errs.join(" | ")}`);
    }
    case "str":
      if (typeof v !== "string") return fail("DB-H-17", "应为字符串");
      if (rule.pattern && !rule.pattern.test(v)) fail("DB-H-17", `格式不符 ${rule.pattern}：${JSON.stringify(v)}`);
      if (rule.oneOf && !rule.oneOf.includes(v)) fail("DB-H-17", `取值不在 ${rule.oneOf.join("/")}：${v}`);
      return;
    case "int":
      if (typeof v !== "number" || !Number.isSafeInteger(v)) return fail("DB-H-08", "应为安全整数");
      if (rule.min !== undefined && v < rule.min) fail("DB-H-17", `小于 ${rule.min}`);
      if (rule.max !== undefined && v > rule.max) fail("DB-H-17", `大于 ${rule.max}`);
      return;
    case "bool":
      if (typeof v !== "boolean") fail("DB-H-18", "应为布尔值");
      return;
    case "dec": {
      if (typeof v !== "string") return fail("DB-H-11", `应为 ${rule.scale} 位小数的十进制字符串`);
      const re = rule.scale === 0 ? /^-?(0|[1-9][0-9]*)$/ : new RegExp(`^-?(0|[1-9][0-9]*)\\.[0-9]{${rule.scale}}$`);
      if (!re.test(v) || /^-0(\.0+)?$/.test(v)) fail("DB-H-11", `应为 ${rule.scale} 位小数的十进制字符串：${JSON.stringify(v)}`);
      return;
    }
    case "arr": {
      if (!Array.isArray(v)) return fail("DB-H-13", "应为数组");
      if (rule.len !== undefined && v.length !== rule.len) fail("DB-H-13", `长度应为 ${rule.len}`);
      v.forEach((x, k) => validate(rule.item, x, `${path}[${k}]`));
      if (rule.order === "set") {
        const texts = v.map((x) => canonicalize(x));
        for (let k = 1; k < texts.length; k++) {
          if (!(texts[k - 1]! < texts[k]!)) fail("DB-H-13", "集合型数组须按规范化文本严格升序（且无重复）");
        }
      }
      return;
    }
    case "obj": {
      if (typeof v !== "object" || Array.isArray(v)) return fail("DB-H-17", "应为对象");
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!(k in rule.fields)) fail("DB-J-04", `未知键 ${k}`);
      for (const [k, r] of Object.entries(rule.fields)) {
        if (!(k in o)) { if (r.presence === "opt") continue; fail("DB-H-12", `缺必需字段 ${k}`); }
        validate(r, o[k], `${path}.${k}`);
      }
      return;
    }
  }
}

const S = (extra: Partial<Extract<Rule, { kind: "str" }>> = {}): Rule => ({ kind: "str", ...extra });
const opt = <R extends Rule>(r: R): R => ({ ...r, presence: "opt" });
const DATE_MIN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GANZHI = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/;

// (1) input_hash 对象
export const RAW_BAZI: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  civil_datetime: S({ pattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$/ }),
  shichen: opt(S({ oneOf: ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] })),
  time_precision: S({ oneOf: ["MINUTE", "SHICHEN", "UNKNOWN"] }),
  gender: S({ oneOf: ["MALE", "FEMALE", "UNKNOWN"] }),
  tz_id: S(),
  dst_included: { kind: "bool" },
  longitude: opt({ kind: "dec", scale: 6 }),
  latitude: opt({ kind: "dec", scale: 6 }),
  place_name: opt(S()),
} };
export const RAW_LIUYAO: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  cast_datetime: S({ pattern: DATE_MIN }),
  tz_id: S(),
  method: S({ oneOf: ["coins"] }),
  yao: { kind: "arr", order: "ordered", len: 6, item: { kind: "int", min: 6, max: 9 } },
} };
export const NORMALIZED: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  utc_instant: S({ pattern: INSTANT }),
  utc8_civil: S({ pattern: DATE_MIN }),
} };
export const TZ_RESOLUTION: Rule = { kind: "obj", fields: {
  tz_id: S(), utc_offset_seconds: { kind: "int" }, dst_flag: { kind: "bool" }, tzdata_version: S(), tz_table_version: S(),
  offset_source: S(), confirmation_record: opt(S()), ambiguity_reason: opt(S()),
} };
const PLACE_REF: Rule = opt({ kind: "obj", fields: { release: S(), id: S(), hash: S({ pattern: HEX64 }) } });
export function inputObjectRule(domain: "BAZI" | "LIUYAO"): Rule {
  return { kind: "obj", fields: {
    v: { kind: "int", min: 1, max: 1 },
    domain: S({ oneOf: [domain] }),
    raw_payload: domain === "BAZI" ? RAW_BAZI : RAW_LIUYAO,
    normalized_payload: NORMALIZED,
    normalizer_version: S(),
    tz_resolution: opt(TZ_RESOLUTION),
    place_ref: PLACE_REF,
  } };
}
/** BAZI raw_payload 附加规则：SHICHEN 须带 shichen；MINUTE 须带时分；有地点须经纬度齐全 */
export function validateInputObject(o: unknown): void {
  const obj = o as { domain?: string; raw_payload?: Record<string, unknown> };
  const domain = obj?.domain === "LIUYAO" ? "LIUYAO" : "BAZI";
  validate(inputObjectRule(domain), o);
  if (domain === "BAZI") {
    const r = obj.raw_payload!;
    if (r["time_precision"] === "SHICHEN" && !("shichen" in r)) throw new CanonicalError("DB-H-17", "$.raw_payload：SHICHEN 精度缺 shichen");
    if (r["time_precision"] === "MINUTE" && !DATE_MIN.test(String(r["civil_datetime"]))) throw new CanonicalError("DB-H-17", "$.raw_payload.civil_datetime：MINUTE 精度须为 YYYY-MM-DDTHH:MM");
    if (r["time_precision"] !== "MINUTE" && !DATE.test(String(r["civil_datetime"]))) throw new CanonicalError("DB-H-17", "$.raw_payload.civil_datetime：非 MINUTE 精度只写日期");
    if (("longitude" in r) !== ("latitude" in r)) throw new CanonicalError("DB-H-17", "$.raw_payload：经纬度须同时出现");
  }
}

// (2) config_hash 对象（params 为集合，按 param_id 升序；Q-12：apply_mode 纳入指纹）
export const CONFIG_OBJECT: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  module: S({ oneOf: ["BAZI", "LIUYAO", "FENGSHUI", "CALENDAR"] }),
  registry_version: S(),
  // §6.4(2)：集合数组，排序键为 param_id（不是条目的规范化文本），由 validateConfigObject 校验
  params: { kind: "arr", order: "ordered", item: { kind: "obj", fields: {
    param_id: S(), value: S(), value_source: S({ oneOf: ["user_selected", "approved_default", "follows_param", "version_locked"] }),
    apply_mode: S({ oneOf: ["applied", "stored_only"] }),
  } } },
} };
export function validateConfigObject(o: unknown): void {
  validate(CONFIG_OBJECT, o);
  const ids = (o as { params: { param_id: string }[] }).params.map((p) => p.param_id);
  for (let k = 1; k < ids.length; k++) if (!(ids[k - 1]! < ids[k]!)) throw new CanonicalError("DB-H-18", "$.params 须按 param_id 严格升序");
}

// (3) result_payload v1
const PILLAR: Rule = { kind: "union", options: [
  { kind: "obj", fields: { value: S({ pattern: GANZHI }), ambiguous: { kind: "bool" } } },
  { kind: "obj", fields: { candidates: { kind: "arr", order: "ordered", len: 2, item: S({ pattern: GANZHI }) }, ambiguous: { kind: "bool" } } },
] };
const HOUR_NULL: Rule = { kind: "obj", fields: { value: { kind: "str", presence: "nullable" }, reason: S({ oneOf: ["HOUR_UNKNOWN"] }) } };
const PER_PILLAR = (r: Rule): Rule => ({ kind: "obj", fields: { year: r, month: r, day: r, hour: opt(r) } });
export const RESULT_BAZI: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  result_scope: { kind: "arr", order: "set", item: S() },
  notices: { kind: "arr", order: "ordered", item: { kind: "obj", fields: { code: S(), text: S() } } },
  year_pillar: PILLAR, month_pillar: PILLAR, day_pillar: PILLAR,
  hour_pillar: { kind: "union", options: [PILLAR, HOUR_NULL] },
  primary_candidate: opt({ kind: "obj", fields: { year_pillar: opt(S()), month_pillar: opt(S()), day_pillar: opt(S()) } }),
  requires_user_confirmation: { kind: "bool" },
  shishen: PER_PILLAR({ kind: "obj", fields: { stem: S(), hidden: { kind: "arr", order: "ordered", item: S() } } }),
  canggan: { kind: "obj", fields: { layer: S({ oneOf: ["现代整理层"] }), year: { kind: "arr", order: "ordered", item: S() }, month: { kind: "arr", order: "ordered", item: S() },
    day: { kind: "arr", order: "ordered", item: S() }, hour: opt({ kind: "arr", order: "ordered", item: S() }) } },
  changsheng: { kind: "obj", fields: { layer: S({ oneOf: ["术数传承层"] }), year: S(), month: S(), day: S(), hour: opt(S()) } },
  luck_cycle: { kind: "union", options: [
    { kind: "obj", fields: { value: { kind: "str", presence: "nullable" }, status: S({ oneOf: ["DEGRADED_LUCK_OMITTED"] }), reason: S({ oneOf: ["MISSING_GENDER"] }) } },
    { kind: "obj", fields: { value: { kind: "any" } } },
  ] },
} };
const LY_LINE: Rule = { kind: "obj", fields: { yao: { kind: "int", min: 6, max: 9 }, najia: S({ pattern: GANZHI }), liuqin: S(), liushen: S(), xunkong: { kind: "bool" } } };
const LY_BIAN_LINE: Rule = { kind: "obj", fields: { yang: { kind: "bool" }, najia: S({ pattern: GANZHI }), liuqin: S() } };
export const RESULT_LIUYAO: Rule = { kind: "obj", fields: {
  v: { kind: "int", min: 1, max: 1 },
  result_scope: { kind: "arr", order: "set", item: S() },
  notices: { kind: "arr", order: "ordered", item: { kind: "obj", fields: { code: S(), text: S() } } },
  ben: { kind: "obj", fields: { name: S(), palace: S(), position: S(), shi: { kind: "int", min: 1, max: 6 }, ying: { kind: "int", min: 1, max: 6 },
    lines: { kind: "arr", order: "ordered", len: 6, item: LY_LINE } } },
  bian: opt({ kind: "obj", fields: { name: S(), lines: { kind: "arr", order: "ordered", len: 6, item: LY_BIAN_LINE } } }),
  day_ganzhi: S({ pattern: GANZHI }),
  xunkong_branches: { kind: "arr", order: "ordered", len: 2, item: S({ pattern: /^[子丑寅卯辰巳午未申酉戌亥]$/ }) },
} };
export function validateResult(domain: "BAZI" | "LIUYAO", o: unknown): void {
  validate(domain === "BAZI" ? RESULT_BAZI : RESULT_LIUYAO, o);
  if (domain === "BAZI") {
    const r = o as Record<string, Record<string, unknown>>;
    const hp = r["hour_pillar"]!;
    if ("reason" in hp && hp["value"] !== null) throw new CanonicalError("DB-H-19", "$.hour_pillar：三柱模式时柱须为 null");
  }
}

// (4) resolved_context（有序数组，按 (item_kind, key) 升序）
export const RESOLVED_CONTEXT: Rule = { kind: "arr", order: "ordered", item: { kind: "obj", fields: {
  item_kind: S({ oneOf: ["jieqi_prev", "jieqi_next", "table_version"] }), key: S(),
  version: opt(S()), content_hash: opt(S({ pattern: HEX64 })), value: opt(S()),
} } };
export interface ResolvedItem { item_kind: "jieqi_prev" | "jieqi_next" | "table_version"; key: string; version?: string; content_hash?: string; value?: string }
export function sortResolved(items: ResolvedItem[]): ResolvedItem[] {
  return [...items].sort((a, b) => (a.item_kind < b.item_kind ? -1 : a.item_kind > b.item_kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
export function dataFingerprint(items: ResolvedItem[]): string {
  const sorted = sortResolved(items);
  validate(RESOLVED_CONTEXT, sorted);
  return hashOf(sorted);
}

// (5) result_fingerprint（§6.5：不含 governance_context，也不含 data_fingerprint）
export interface FingerprintParts {
  input_hash: string; config_hash: string;
  variant_hashes: { rule_variant_id: string; version_no: number; content_hash: string }[];
  data_release: string; engine_release_id: string; registry_version: string;
  tz_table_version?: string; place_data_version?: string; jieqi_data_version?: string;
}
export function resultFingerprint(p: FingerprintParts): string {
  const variant_hashes = [...p.variant_hashes].sort((a, b) => (a.rule_variant_id < b.rule_variant_id ? -1 : a.rule_variant_id > b.rule_variant_id ? 1 : 0));
  return hashOf({ v: 1, ...p, variant_hashes, hash_algorithm: HASH_ALGORITHM, canonicalization_version: CANONICALIZATION_VERSION });
}
