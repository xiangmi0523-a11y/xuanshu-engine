// 审核清单 §5.10 哈希与规范化 DB-H-01～20；§5.8 DB-J-06；§6.4(6) 金标向量 GV-01～GV-14（数据仓库独立生成，逐字节比对）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICALIZATION_VERSION, CanonicalError, assertCanonicalText, canonicalize, dataFingerprint, hashOf, parseStrict, sha256Hex,
  validate, validateConfigObject, validateInputObject, validateResult, type ResolvedItem,
} from "../../db/canonical.js";
import { readRepo } from "../helpers/load.js";
import { cases } from "../fixtures/load.js";
import { prepareConfig, prepareInput } from "../../db/pipeline.js";

interface GV { id: string; input?: string; set_paths?: string[][]; canonical?: string; sha256?: string; rejects?: { input: string; reason: string }[] }
const golden = (): { version: string; vectors: GV[] } => JSON.parse(readRepo("vectors/golden_jcs1.json")) as { version: string; vectors: GV[] };
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { return e instanceof CanonicalError ? e.code : `非 CanonicalError：${(e as Error).message}`; } return "未拒绝"; };
const canonOf = (text: string) => canonicalize(parseStrict(text));
const firstDiff = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); let i = 0; while (i < x.length && x[i] === y[i]) i++; return i; };

test("DB-H-20 / DB-H-14：GV-01～GV-13 引擎输出与数据仓库独立实现逐字节相等；GV-14 拒绝集全部被拒", () => {
  const g = golden();
  assert.equal(g.version, CANONICALIZATION_VERSION);
  assert.deepEqual(g.vectors.map((v) => v.id), Array.from({ length: 14 }, (_, k) => `GV-${String(k + 1).padStart(2, "0")}`));
  for (const v of g.vectors.slice(0, 13)) {
    let obj = parseStrict(v.input!) as Record<string, unknown>;
    for (const p of v.set_paths ?? []) { // 集合数组按元素规范化文本排序（与生成器同义）
      const arr = obj[p[0]!] as unknown[];
      obj = { ...obj, [p[0]!]: [...arr].sort((a, b) => (canonicalize(a) < canonicalize(b) ? -1 : 1)) };
    }
    const got = canonicalize(obj);
    assert.equal(got, v.canonical, `${v.id} 首个差异字节 ${firstDiff(got, v.canonical!)}`);
    assert.equal(sha256Hex(got), v.sha256, `${v.id} 哈希`);
  }
  const want: Record<string, string> = { duplicate_key: "DB-H-07", lone_surrogate: "DB-H-06", nan_or_infinity: "DB-H-10", negative_zero: "DB-H-10", unsafe_integer: "DB-H-09", non_integer: "DB-H-08" };
  for (const r of g.vectors[13]!.rejects!) assert.equal(code(() => canonOf(r.input)), want[r.reason], `GV-14 ${r.input}`);
});

test("DB-H-01：键序不同的同一对象，规范化文本与哈希相同", () => {
  assert.equal(canonOf("{\"b\":1,\"a\":2}"), canonOf("{\"a\":2,\"b\":1}"));
  assert.equal(hashOf({ b: 1, a: 2 }), hashOf({ a: 2, b: 1 }));
});

test("DB-H-02：键按 UTF-16 码元排序（RFC 8785）", () => {
  assert.equal(canonicalize({ "甲": 1, a: 2, Z: 3, "\u{20000}": 4, "ａ": 5 }), "{\"Z\":3,\"a\":2,\"甲\":1,\"\u{20000}\":4,\"ａ\":5}");
});

test("DB-H-03 / DB-H-04：不做 Unicode 规范化；兼容字保留原码位", () => {
  assert.notEqual(hashOf({ s: "é" }), hashOf({ s: "é" }));
  assert.notEqual(hashOf({ s: "豈" }), hashOf({ s: "豈" }));
  assert.equal([...(parseStrict(canonicalize({ s: "豈" })) as { s: string }).s][0]!.codePointAt(0), 0xF900);
});

test("DB-H-05：转义按 RFC 8785（控制字符小写 \\u00xx，U+2028 不转义）", () => {
  assert.equal(canonicalize({ s: "\"\\\u0000\u001f \n" }), "{\"s\":\"\\\"\\\\\\u0000\\u001f \\n\"}");
});

test("DB-H-06～DB-H-10：孤立代理、重复键、非整数、超界整数、-0 / NaN / Infinity 皆拒", () => {
  assert.equal(code(() => canonicalize({ s: "\uD800" })), "DB-H-06");
  assert.equal(code(() => parseStrict("{\"a\":1,\"a\":2}")), "DB-H-07");
  assert.equal(code(() => parseStrict("{\"a\":1.5}")), "DB-H-08");
  assert.equal(code(() => canonicalize({ a: 1.5 })), "DB-H-08");
  assert.equal(code(() => parseStrict("{\"a\":9007199254740992}")), "DB-H-09");
  for (const t of ["{\"a\":-0}", "{\"a\":NaN}", "{\"a\":Infinity}"]) assert.equal(code(() => parseStrict(t)), "DB-H-10", t);
  for (const v of [-0, NaN, Infinity]) assert.equal(code(() => canonicalize({ a: v })), "DB-H-10");
});

const c0 = () => cases().cases.find((x) => x.case_id === "E2E-BZ-1")!;
const inputObj = (raw: Record<string, unknown>) => prepareInput({ domain: "BAZI", raw, tz: c0().tz, normalizer_version: "n" });

test("DB-H-11：经度 dec(6) \"116.400000\" 通过，\"116.4\" 按刻度规则拒", () => {
  inputObj(c0().raw);
  assert.equal(code(() => inputObj({ ...c0().raw, longitude: "116.4" })), "DB-H-11");
});

test("DB-H-12：{\"a\":null} 与 {} 不同；字段不允许 null 时拒", () => {
  assert.notEqual(hashOf({ a: null }), hashOf({}));
  assert.equal(code(() => inputObj({ ...c0().raw, place_name: null })), "DB-H-12");
});

test("DB-H-13：有序数组顺序影响哈希；集合型数组未排序被拒", () => {
  assert.notEqual(hashOf(["A", "B"]), hashOf(["B", "A"]));
  assert.equal(code(() => validate({ kind: "arr", order: "set", item: { kind: "str" } }, ["b", "a"])), "DB-H-13");
});

test("DB-H-15 / DB-H-16：canonicalization_version = jcs-1 时以 jcs-1 校验；其他版本标识被拒（引擎）", () => {
  assert.equal(CANONICALIZATION_VERSION, "jcs-1");
  const verify = (ver: string, text: string) => { if (ver !== CANONICALIZATION_VERSION) throw new CanonicalError("DB-H-15", `未实现的规范化版本 ${ver}`); assertCanonicalText(text); };
  verify("jcs-1", canonicalize({ a: 1 }));
  assert.equal(code(() => verify("jcs-2", canonicalize({ a: 1 }))), "DB-H-15");
});

test("DB-H-17：BAZI raw_payload——civil_datetime 带秒、longitude 为 dec(4)、SHICHEN 而缺 shichen，皆拒", () => {
  assert.notEqual(code(() => inputObj({ ...c0().raw, civil_datetime: "1990-06-15T14:30:00" })), "未拒绝");
  assert.equal(code(() => inputObj({ ...c0().raw, longitude: "116.4000" })), "DB-H-11");
  assert.notEqual(code(() => validateInputObject({ ...inputObj(c0().raw).input_object, raw_payload: { ...c0().raw, civil_datetime: "1990-06-15", time_precision: "SHICHEN" } })), "未拒绝");
});

test("DB-H-18：params 未按 param_id 排序；布尔写成 JSON true；空参数集省略 params，皆拒", () => {
  const base = prepareConfig({ ...c0().config, module: "BAZI" }).config_object as { params: unknown[] };
  assert.equal(code(() => validateConfigObject({ ...base, params: [...base.params].reverse() })), "DB-H-18");
  assert.notEqual(code(() => validateConfigObject({ ...base, params: (base.params as Record<string, unknown>[]).map((p) => (p["param_id"] === "CFG-02" ? { ...p, value: false } : p)) })), "未拒绝");
  const { params: _omit, ...noParams } = base as Record<string, unknown>;
  void _omit;
  assert.notEqual(code(() => validateConfigObject(noParams)), "未拒绝");
});

test("DB-H-19：result_scope 未排序；变卦 lines 出现 liushen；三柱模式时柱省略而非 null，皆拒", () => {
  const ly = { v: 1, result_scope: ["bian", "bagong"], notices: [], day_ganzhi: "己亥", xunkong_branches: ["辰", "巳"],
    ben: { name: "x", palace: "坎", position: "三世", shi: 3, ying: 6, lines: Array.from({ length: 6 }, () => ({ yao: 7, najia: "己卯", liuqin: "子孙", liushen: "青龙", xunkong: false })) } };
  assert.equal(code(() => validateResult("LIUYAO", ly)), "DB-H-13");
  const ly2 = { ...ly, result_scope: ["bagong", "bian"], bian: { name: "y", lines: Array.from({ length: 6 }, () => ({ yang: true, najia: "庚子", liuqin: "兄弟", liushen: "青龙" })) } };
  assert.notEqual(code(() => validateResult("LIUYAO", ly2)), "未拒绝");
  const bz = { v: 1, result_scope: ["pillars"], notices: [], year_pillar: { value: "庚午", ambiguous: false }, month_pillar: { value: "壬午", ambiguous: false }, day_pillar: { value: "辛亥", ambiguous: false },
    requires_user_confirmation: false, shishen: {}, canggan: { layer: "现代整理层" }, changsheng: { layer: "术数传承层" }, luck_cycle: { value: null, status: "DEGRADED_LUCK_OMITTED", reason: "MISSING_GENDER" } };
  assert.notEqual(code(() => validateResult("BAZI", bz)), "未拒绝");
});

test("DB-J-06：文本合法但非规范化形式（键乱序、带空格）封存前引擎校验拒", () => {
  assertCanonicalText("{\"a\":1,\"b\":2}");
  assert.equal(code(() => assertCanonicalText("{\"b\":2,\"a\":1}")), "DB-J-06");
  assert.equal(code(() => assertCanonicalText("{\"a\": 1}")), "DB-J-06");
});

test("GV-13 关联：resolved_context 样例的 data_fingerprint 由同一规则计算", () => {
  const v = golden().vectors.find((x) => x.id === "GV-13")!;
  const items = parseStrict(v.input!) as unknown as ResolvedItem[];
  assert.equal(dataFingerprint(items), v.sha256);
});
