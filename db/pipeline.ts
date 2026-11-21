// 计算—判定—封存流水线（E2 数据库结构准备）：契约 §6、§7、§9.3、§13；审核清单 §3.5、§6、§7。
// 只在测试进程的内存库运行（B3-1 D1）。本文件不含任何夹具 ID：变体、引擎版本、阻断等一律读正式库（formal 模式）或由调用方传入。
// - BLOCKED：不生成快照、依赖、轨迹，只写一条 blocked_audit_event（K-4、Q-6）。
// - 六爻日界：取自正式库登记变体的内容（内容哈希须与登记一致）；没有可用变体即由判定 BLOCKED，代码中无任何默认日界（Q-18）。
// - 封存：子行先写，引擎预检（E + Q）通过后写快照行，同一事务（清单 §3.5、§3.10）。
import type { DatabaseSync } from "node:sqlite";
import { computeBazi, type BaziInput, type Tables } from "../src/bazi.js";
import { baziDetail } from "../src/bazi_detail.js";
import { dayIndex, ganzhiName } from "../src/ganzhi.js";
import type { StaticTables } from "../src/static.js";
import { nextJie, prevJie } from "../src/tables.js";
import { computeZhuanggua } from "../src/zhuanggua.js";
import {
  CANONICALIZATION_VERSION, CanonicalError, HASH_ALGORITHM, assertCanonicalText, canonicalize, dataFingerprint, hashOf,
  resultFingerprint, sortResolved, validateConfigObject, validateInputObject, validateResult, type ResolvedItem,
} from "./canonical.js";
import { currentRelease, judge, type ConfigParam, type Judgment, type Plan, type PlannedStep, type UsedVariant } from "./governance.js";
import { uuidv7 } from "./ids.js";
import { presealViolations } from "./queries.js";

export type Domain = "BAZI" | "LIUYAO";

// ---------------------------------------------------------------- 输入与配置
export interface TzResolution {
  tz_id: string; utc_offset_seconds: number; dst_flag: boolean; tzdata_version: string; tz_table_version: string; offset_source: string;
  confirmation_record?: string; ambiguity_reason?: string;
}
export interface InputSpec { domain: Domain; raw: Record<string, unknown>; tz: TzResolution; normalizer_version: string }
export interface PreparedInput {
  domain: Domain; raw: Record<string, unknown>; normalized: { v: 1; utc_instant: string; utc8_civil: string };
  tz: TzResolution; normalizer_version: string; input_object: Record<string, unknown>; input_hash: string; utcMs: number;
}
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const civilOf = (ms: number) => { const d = new Date(ms); return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

/** 归一化：当地钟表时间 + 已解析偏移 → UTC 瞬时与 UTC+8 民用时间（§6.1、§11.1；引擎不自行推断偏移） */
export function prepareInput(spec: InputSpec): PreparedInput {
  const civil = String(spec.domain === "BAZI" ? spec.raw["civil_datetime"] : spec.raw["cast_datetime"]);
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(civil);
  if (!m) throw new CanonicalError("DB-H-17", "E2 端到端只覆盖分钟精度输入（SHICHEN / UNKNOWN 输入属 E3）");
  const utcMs = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - spec.tz.utc_offset_seconds * 1000;
  const normalized = { v: 1 as const, utc_instant: new Date(utcMs).toISOString(), utc8_civil: civilOf(utcMs + 8 * 3_600_000) };
  const tz: Record<string, unknown> = { tz_id: spec.tz.tz_id, utc_offset_seconds: spec.tz.utc_offset_seconds, dst_flag: spec.tz.dst_flag,
    tzdata_version: spec.tz.tzdata_version, tz_table_version: spec.tz.tz_table_version, offset_source: spec.tz.offset_source };
  if (spec.tz.confirmation_record !== undefined) tz["confirmation_record"] = spec.tz.confirmation_record;
  if (spec.tz.ambiguity_reason !== undefined) tz["ambiguity_reason"] = spec.tz.ambiguity_reason;
  const input_object = { v: 1, domain: spec.domain, raw_payload: spec.raw, normalized_payload: normalized, normalizer_version: spec.normalizer_version, tz_resolution: tz };
  validateInputObject(input_object);
  return { domain: spec.domain, raw: spec.raw, normalized, tz: spec.tz, normalizer_version: spec.normalizer_version, input_object, input_hash: hashOf(input_object), utcMs };
}

export interface ConfigSpec { config_id: string; config_version: number; module: Domain; registry_version: string; params: ConfigParam[] }
export interface PreparedConfig extends ConfigSpec { config_object: Record<string, unknown>; config_hash: string }
export function prepareConfig(spec: ConfigSpec): PreparedConfig {
  const params = [...spec.params].sort((a, b) => (a.param_id < b.param_id ? -1 : a.param_id > b.param_id ? 1 : 0));
  const config_object = { v: 1, module: spec.module, registry_version: spec.registry_version,
    params: params.map((p) => ({ param_id: p.param_id, value: p.value, value_source: p.value_source, apply_mode: p.apply_mode })) };
  validateConfigObject(config_object);
  return { ...spec, params, config_object, config_hash: hashOf(config_object) };
}

/** 写入档案、输入、时区解析、配置与档案引用（输入属档案数据，BLOCKED 时同样保留；快照另行封存） */
export function saveProfileInputConfig(db: DatabaseSync, profileId: string, inp: PreparedInput, inputId: string, cfg: PreparedConfig): void {
  const exists = (sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) !== undefined;
  if (!exists("SELECT 1 FROM profile WHERE owner_profile_id = ?", profileId))
    db.prepare("INSERT INTO profile (owner_profile_id, created_at) VALUES (?, ?)").run(profileId, new Date().toISOString());
  db.prepare(`INSERT INTO calculation_input (input_id, input_hash, owner_profile_id, domain, raw_payload, gender, time_precision, normalized_payload, normalizer_version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(inputId, inp.input_hash, profileId, inp.domain, canonicalize(inp.raw),
    inp.domain === "BAZI" ? String(inp.raw["gender"]) : null, inp.domain === "BAZI" ? String(inp.raw["time_precision"]) : null,
    canonicalize(inp.normalized), inp.normalizer_version);
  db.prepare(`INSERT INTO input_tz_resolution (input_id, owner_profile_id, tz_id, utc_offset_seconds, dst_flag, tzdata_version, tz_table_version, offset_source, confirmation_record, ambiguity_reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(inputId, profileId, inp.tz.tz_id, inp.tz.utc_offset_seconds, inp.tz.dst_flag ? 1 : 0,
    inp.tz.tzdata_version, inp.tz.tz_table_version, inp.tz.offset_source, inp.tz.confirmation_record ?? null, inp.tz.ambiguity_reason ?? null);
  if (!exists("SELECT 1 FROM calculation_config WHERE config_id = ? AND config_version = ?", cfg.config_id, cfg.config_version)) {
    db.exec("BEGIN");
    try {
      const ins = db.prepare("INSERT INTO config_param_value (config_id, config_version, param_id, value, value_source, apply_mode) VALUES (?, ?, ?, ?, ?, ?)");
      for (const p of cfg.params) ins.run(cfg.config_id, cfg.config_version, p.param_id, p.value, p.value_source, p.apply_mode);
      db.prepare("INSERT INTO calculation_config (config_id, config_version, config_hash, module, registry_version, hash_algorithm, canonicalization_version) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(cfg.config_id, cfg.config_version, cfg.config_hash, cfg.module, cfg.registry_version, HASH_ALGORITHM, CANONICALIZATION_VERSION);
      db.exec("COMMIT");
    } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
  }
  if (!exists("SELECT 1 FROM profile_config_ref WHERE owner_profile_id = ? AND config_id = ? AND config_version = ?", profileId, cfg.config_id, cfg.config_version))
    db.prepare("INSERT INTO profile_config_ref (owner_profile_id, config_id, config_version) VALUES (?, ?, ?)").run(profileId, cfg.config_id, cfg.config_version);
}

// ---------------------------------------------------------------- 计划（审核清单 §3.8；实际依赖按 P-42 / Q-17）
interface StepDef { step: string; trace: string; reads: string[]; params: string[] }
const BAZI_STEPS: StepDef[] = [
  { step: "BZ-01", trace: "bazi.tz_resolve", reads: [], params: ["CFG-14", "CFG-15"] },
  { step: "BZ-02", trace: "bazi.longitude_correction", reads: ["bazi.longitude_correction"], params: ["CFG-02"] },
  { step: "BZ-03", trace: "bazi.eot", reads: ["bazi.eot"], params: ["CFG-02"] },
  { step: "BZ-04", trace: "bazi.zi_attribution", reads: ["bazi.zi_attribution"], params: ["CFG-01", "CFG-01T"] },
  { step: "BZ-05", trace: "bazi.year_pillar", reads: ["bazi.year_pillar"], params: ["CFG-03"] },
  { step: "BZ-06", trace: "bazi.month_pillar", reads: ["bazi.month_pillar", "calendar.jieqi_lookup"], params: [] },
  { step: "BZ-07", trace: "calendar.day_pillar", reads: ["calendar.day_pillar"], params: [] },
  { step: "BZ-08", trace: "bazi.hour_pillar", reads: ["bazi.hour_pillar"], params: [] },
  { step: "BZ-09", trace: "bazi.shishen", reads: ["bazi.shishen"], params: [] },
  { step: "BZ-10", trace: "bazi.canggan", reads: ["bazi.canggan"], params: ["CFG-05", "CFG-05S", "CFG-05W"] },
  { step: "BZ-11", trace: "bazi.changsheng", reads: ["bazi.changsheng"], params: [] },
  { step: "BZ-12", trace: "bazi.luck_cycle", reads: ["bazi.luck_cycle"], params: [] },
  { step: "BZ-13", trace: "bazi.siling", reads: ["bazi.siling"], params: [] },
];
const LIUYAO_STEPS: StepDef[] = [
  { step: "LY-01", trace: "liuyao.cast", reads: ["liuyao.cast"], params: [] },
  { step: "LY-02", trace: "liuyao.palace", reads: ["liuyao.palace"], params: [] },
  { step: "LY-03", trace: "liuyao.najia", reads: ["liuyao.najia"], params: [] },
  { step: "LY-04", trace: "liuyao.shiying", reads: ["liuyao.shiying"], params: [] },
  { step: "LY-05", trace: "liuyao.liuqin", reads: ["liuyao.liuqin"], params: [] },
  // 排日辰：日柱算法（跨域 P-D-04）+ 六爻日界规则（P-42：确定占时属哪一日时必须读取）
  { step: "LY-06", trace: "calendar.day_pillar", reads: ["calendar.day_pillar", "liuyao.day_boundary"], params: [] },
  { step: "LY-07", trace: "liuyao.liushen", reads: ["liuyao.liushen"], params: [] },
  { step: "LY-08", trace: "liuyao.xunkong", reads: ["liuyao.xunkong"], params: [] },
  { step: "LY-09", trace: "liuyao.month_build", reads: ["liuyao.month_build"], params: [] },
  { step: "LY-10", trace: "liuyao.bian", reads: ["liuyao.bian"], params: [] },
];
/** 跨域依赖：读取他域子项的函数（R-I-8） */
const CROSS_DOMAIN: Record<Domain, Set<string>> = { BAZI: new Set(), LIUYAO: new Set(["calendar.day_pillar"]) };

function admissionOfFunction(db: DatabaseSync, fn: string): string | undefined {
  return (db.prepare(`SELECT a.status FROM formal.rule_component c JOIN formal.v_admission_current a ON a.component_id = c.component_id AND a.purpose = 'calc'
                      WHERE c.calc_function_id = ? ORDER BY c.component_id LIMIT 1`).get(fn) as { status: string } | undefined)?.status;
}

export function buildPlan(db: DatabaseSync, inp: PreparedInput, cfg: PreparedConfig): Plan {
  const val = (p: string) => cfg.params.find((x) => x.param_id === p && x.apply_mode === "applied")?.value;
  const done = (d: StepDef): PlannedStep => ({ step_code: d.step, status: "完成", rule_functions: d.reads, params: d.params, trace_function: d.trace });
  const skip = (d: StepDef, kind: "范围外" | "输入缺失" | "按规则跳过", reason: string): PlannedStep =>
    ({ step_code: d.step, status: "未执行", skip_kind: kind, reason, rule_functions: [], params: d.params, trace_function: d.trace });
  if (inp.domain === "BAZI") {
    return { module: "BAZI", config: cfg.params, steps: BAZI_STEPS.map((d) => {
      if (d.step === "BZ-02" || d.step === "BZ-03") {
        if (val("CFG-02") === "false") return skip(d, "按规则跳过", "CFG-02 = false：钟表时间，不做经度换算与均时差（§9.4）");
        throw new CanonicalError("DB-T-07", "CFG-02 = true 的路径经过均时差（B1 / BLK-7），不在 E2 端到端范围");
      }
      if (d.step === "BZ-12") {
        if (inp.raw["gender"] === "UNKNOWN") return skip(d, "输入缺失", "gender = UNKNOWN：大运省略（§13.2，MISSING_GENDER）");
        return skip(d, "范围外", "引擎未实现大运（E3）");
      }
      if (d.step === "BZ-13") {
        const a = admissionOfFunction(db, "bazi.siling");
        if (a === "DEFERRED" || a === "PROHIBITED") return skip(d, "按规则跳过", `P-A-04 计算准入为 ${a}（§7.5、P-8.1）`);
        return skip(d, "范围外", "引擎未实现人元司令");
      }
      return done(d);
    }) };
  }
  return { module: "LIUYAO", config: cfg.params, steps: LIUYAO_STEPS.map((d) =>
    d.step === "LY-09" ? skip(d, "范围外", "月建不在 E2-A 装卦范围（Q-15）") : done(d)) };
}

// ---------------------------------------------------------------- 结果载荷
export interface EngineContext {
  engine_release_id: string; app_version: string; tables: Tables; static: StaticTables;
  /** 变体内容（正式库只存内容哈希；内容由版本化规则资产提供，使用前核对哈希） */
  variantContent: (ruleVariantId: string) => Record<string, unknown> | undefined;
}
function readVariantContent(ctx: EngineContext, v: UsedVariant): Record<string, unknown> {
  const c = ctx.variantContent(v.rule_variant_id);
  if (!c) throw new CanonicalError("DB-X-03", `变体 ${v.rule_variant_id} 内容不可得`);
  if (hashOf(c) !== v.content_hash) throw new CanonicalError("DB-X-03", `变体 ${v.rule_variant_id} 内容哈希与正式库登记不符`);
  return c;
}

function baziPayload(inp: PreparedInput, cfg: PreparedConfig, ctx: EngineContext) {
  const raw = inp.raw as { civil_datetime: string; gender: "MALE" | "FEMALE" | "UNKNOWN"; time_precision: "MINUTE"; longitude?: string };
  const [d, t] = raw.civil_datetime.split("T");
  const [y, mo, da] = d!.split("-").map(Number);
  const [h, mi] = t!.split(":").map(Number);
  const val = (p: string) => cfg.params.find((x) => x.param_id === p)?.value;
  const zi = val("CFG-01"), ref = val("CFG-01T");
  if (!zi || (ref !== "clock" && ref !== "true_solar")) throw new CanonicalError("ZR-DB-missing", "BAZI 配置缺 CFG-01 / CFG-01T");
  const input: BaziInput = { civil: { year: y!, month: mo!, day: da!, hour: h!, minute: mi! }, utcOffsetSeconds: inp.tz.utc_offset_seconds,
    timePrecision: raw.time_precision, gender: raw.gender, config: { zi_rule: zi, zi_reference_time: ref } };
  if (raw.longitude !== undefined) input.longitudeDeg = Number(raw.longitude);
  const r = computeBazi(input, ctx.tables);
  const single = (p: unknown) => { const x = p as { value?: string; ambiguous: boolean }; if (x.ambiguous || typeof x.value !== "string") throw new CanonicalError("DB-H-19", "歧义柱的十神等派生项【待定】（E3）"); return x.value; };
  const four = !("reason" in r.hour_pillar);
  const pillars = [single(r.year_pillar), single(r.month_pillar), single(r.day_pillar), ...(four ? [single(r.hour_pillar)] : [])];
  const det = baziDetail(pillars, ctx.static);
  const keys = ["year", "month", "day", "hour"] as const;
  const per = <T>(f: (k: number) => T) => Object.fromEntries(det.map((_, k) => [keys[k]!, f(k)]));
  const payload: Record<string, unknown> = {
    v: 1,
    result_scope: ["canggan", "changsheng", "luck_cycle", "pillars", "shishen"],
    notices: r.notices.map((n) => ({ code: n.code, text: n.text })),
    year_pillar: r.year_pillar, month_pillar: r.month_pillar, day_pillar: r.day_pillar, hour_pillar: r.hour_pillar,
    requires_user_confirmation: r.requires_user_confirmation,
    shishen: per((k) => ({ stem: det[k]!.stem_shishen, hidden: det[k]!.hidden_stems.map((x) => x.shishen) })),
    canggan: { layer: "现代整理层", ...per((k) => det[k]!.hidden_stems.map((x) => x.stem)) },
    changsheng: { layer: "术数传承层", ...per((k) => det[k]!.day_master_changsheng) },
    luck_cycle: r.luck_cycle ?? (() => { throw new CanonicalError("DB-H-19", "大运结果【待定】（E3）"); })(),
  };
  if (Object.keys(r.primary_candidate).length) payload["primary_candidate"] = r.primary_candidate;
  return { payload, degradation: r.degradation_reasons, pillars, utcMs: inp.utcMs };
}

function liuyaoPayload(inp: PreparedInput, ctx: EngineContext, variants: UsedVariant[]) {
  const yao = inp.raw["yao"] as number[];
  const boundaryVariant = variants.find((v) => v.calc_function_id === "liuyao.day_boundary");
  if (!boundaryVariant) throw new CanonicalError("DB-B-01", "六爻日界规则未登记可用变体，不得计算（Q-18；R-I-8）");
  const content = readVariantContent(ctx, boundaryVariant);
  const b = typeof content["boundary"] === "string" ? /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(content["boundary"]) : null;
  if (!b) throw new CanonicalError("DB-X-03", "日界变体内容缺 boundary（HH:MM）");
  // 日界在 UTC+8 钟表轴上判定（不使用真太阳时换日）
  const civil = inp.normalized.utc8_civil;
  const [d, t] = civil.split("T");
  const [y, mo, da] = d!.split("-").map(Number);
  const [h, mi] = t!.split(":").map(Number);
  const bm = Number(b[1]) * 60 + Number(b[2]);
  const shift = bm !== 0 && h! * 60 + mi! >= bm ? 1 : 0;
  const day = new Date(Date.UTC(y!, mo! - 1, da! + shift));
  const dayGanzhi = ganzhiName(dayIndex(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()));
  const z = computeZhuanggua(yao, dayGanzhi, ctx.static);
  const payload: Record<string, unknown> = {
    v: 1,
    result_scope: ["bagong", "bian", "liuqin", "liushen", "najia", "shiying", "xunkong"],
    notices: [],
    ben: { name: z.ben.name, palace: z.ben.palace, position: z.ben.palace_position, shi: z.ben.shi, ying: z.ben.ying,
      lines: z.ben.lines.map((l, k) => ({ yao: yao[k]!, najia: l.stem_branch, liuqin: l.liuqin, liushen: l.liushen, xunkong: z.xunkong.void.includes(l.stem_branch[1]!) })) },
    day_ganzhi: z.day_ganzhi,
    xunkong_branches: [...z.xunkong.void],
  };
  if (z.bian) payload["bian"] = { name: z.bian.name, lines: z.bian.lines.map((l) => ({ yang: l.yang, najia: l.stem_branch, liuqin: l.liuqin })) };
  else (payload["result_scope"] as string[]).splice(1, 1);
  return { payload, degradation: [] as string[], dayGanzhi };
}

// ---------------------------------------------------------------- 封存行
export interface SnapshotRows {
  snapshot: Record<string, string | number | null>;
  reasons: Record<string, string | number | null>[];
  degradation: string[];
  deps: Record<string, string | number | null>[];
  govApproval: { rule_variant_id: string; approval_id: string }[];
  govBlocker: { block_id: string; status: string }[];
  govSequence: { kind: string; max_sequence_no: number }[];
  resolved: ResolvedItem[];
  trace: Record<string, string | number | null>[];
  /** 复算比对用（不入库） */
  fingerprintParts: Parameters<typeof resultFingerprint>[0];
}
export type CalcOutcome =
  | { status: "BLOCKED"; judgment: Extract<Judgment, { status: "BLOCKED" }>; audit_event_id: string }
  | { status: "FORMAL" | "NON_FORMAL"; judgment: Judgment; rows: SnapshotRows; snapshot_id: string };

interface DataVersionRow { kind: string; version: string; sha256: string; data_release: string }
const dataVersion = (db: DatabaseSync, kind: string) =>
  db.prepare("SELECT kind, version, sha256, data_release FROM formal.data_version WHERE kind = ? ORDER BY version DESC LIMIT 1").get(kind) as DataVersionRow | undefined;

/** 计算一次：判定 → BLOCKED 写审计 / 否则构造封存行并封存。hooks 只供测试注入。 */
export function calculate(db: DatabaseSync, ctx: EngineContext, a: { profileId: string; inputId: string; inp: PreparedInput; cfg: PreparedConfig; recomputedFrom?: string },
  hooks?: SealHooks): CalcOutcome {
  const plan = buildPlan(db, a.inp, a.cfg);
  const j = judge(db, plan);
  if (j.status === "BLOCKED") {
    const id = uuidv7();
    db.prepare("INSERT INTO blocked_audit_event (event_id, occurred_at, module, block_reason_code, app_version, data_release) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, new Date().toISOString(), a.inp.domain, j.code, ctx.app_version, currentRelease(db));
    return { status: "BLOCKED", judgment: j, audit_event_id: id };
  }
  const rows = buildSnapshotRows(db, ctx, plan, j, a);
  sealSnapshot(db, rows, hooks);
  return { status: j.status, judgment: j, rows, snapshot_id: String(rows.snapshot["snapshot_id"]) };
}

export function buildSnapshotRows(db: DatabaseSync, ctx: EngineContext, plan: Plan, j: Extract<Judgment, { status: "FORMAL" | "NON_FORMAL" }>,
  a: { profileId: string; inputId: string; inp: PreparedInput; cfg: PreparedConfig; recomputedFrom?: string }): SnapshotRows {
  const sid = uuidv7();
  const owner = a.profileId;
  const release = currentRelease(db);
  const r = a.inp.domain === "BAZI" ? baziPayload(a.inp, a.cfg, ctx) : liuyaoPayload(a.inp, ctx, j.variants);
  const payload = r.payload;
  checkPayloadAgainstPlan(plan, a.inp.domain, payload);
  const resultText = canonicalize(payload);

  const engine = db.prepare("SELECT engine_release_id, version, data_release FROM formal.engine_release WHERE engine_release_id = ?").get(ctx.engine_release_id) as
    { engine_release_id: string; version: string; data_release: string } | undefined;
  if (!engine) throw new CanonicalError("DB-X-04", `引擎版本 ${ctx.engine_release_id} 未在正式库登记`);

  // 依赖行（§6.4、§7.5）
  const deps: Record<string, string | number | null>[] = [];
  const dep = (o: Record<string, string | number | null>) => deps.push({ snapshot_id: sid, owner_profile_id: owner, ord: deps.length + 1, ref_release: null, ref_version: null,
    ref_hash: null, approval_id: null, param_value: null, value_source: null, registry_version: null, normalizer_version: null, hash_algorithm: null,
    canonicalization_version: null, step_code: null, ...o });
  dep({ dep_type: "engine", ref_kind: "formal", ref_release: engine.data_release, ref_id: engine.engine_release_id, ref_version: engine.version,
    normalizer_version: a.inp.normalizer_version, hash_algorithm: HASH_ALGORITHM, canonicalization_version: CANONICALIZATION_VERSION });
  for (const v of j.variants) {
    dep({ dep_type: CROSS_DOMAIN[a.inp.domain].has(v.calc_function_id) ? "cross_domain" : "rule_variant", ref_kind: "formal", ref_release: v.data_release,
      ref_id: v.rule_variant_id, ref_version: String(v.version_no), ref_hash: v.content_hash, approval_id: v.approval_id, step_code: v.step_code });
  }
  const registryVersion = a.cfg.registry_version;
  const seenParam = new Set<string>();
  for (const s of plan.steps) for (const p of s.params) {
    if (seenParam.has(p)) continue;
    const cp = a.cfg.params.find((x) => x.param_id === p && x.apply_mode === "applied");
    if (!cp) continue;
    seenParam.add(p);
    dep({ dep_type: "parameter", ref_kind: "formal", ref_id: p, param_value: cp.value, value_source: cp.value_source, registry_version: registryVersion, step_code: s.step_code });
  }
  const executed = new Set(plan.steps.filter((s) => s.status === "完成").map((s) => s.step_code));
  const calendar: { kind: string; step: string }[] = a.inp.domain === "BAZI"
    ? [{ kind: "jieqi", step: "BZ-05" }, { kind: "day_pillar", step: "BZ-07" }] : [{ kind: "day_pillar", step: "LY-06" }];
  const resolved: ResolvedItem[] = [];
  let jieqiVersion: string | undefined;
  for (const c of calendar) {
    if (!executed.has(c.step)) continue;
    const dv = dataVersion(db, c.kind);
    if (!dv) throw new CanonicalError("DB-X-01", `正式库未登记数据版本 ${c.kind}`);
    if (c.kind === "jieqi") jieqiVersion = dv.version;
    dep({ dep_type: "calendar_data", ref_kind: "formal", ref_release: dv.data_release, ref_id: dv.kind, ref_version: dv.version, ref_hash: dv.sha256, step_code: c.step });
  }
  if (a.inp.domain === "BAZI") dep({ dep_type: "tz_data", ref_kind: "formal", ref_id: "tz", ref_version: a.inp.tz.tz_table_version, step_code: "BZ-01" });
  for (const d of deps) if (d["dep_type"] === "rule_variant" || d["dep_type"] === "calendar_data")
    resolved.push({ item_kind: "table_version", key: String(d["ref_id"]), version: String(d["ref_version"]), content_hash: String(d["ref_hash"]) });
  if (a.inp.domain === "BAZI") {
    const p = prevJie(ctx.tables.jieqi, a.inp.utcMs), n = nextJie(ctx.tables.jieqi, a.inp.utcMs);
    if (!p || !n) throw new CanonicalError("DB-S-09", "节气表范围外");
    resolved.push({ item_kind: "jieqi_prev", key: "jie", value: `${p.term}@${new Date(p.utcMs).toISOString()}` });
    resolved.push({ item_kind: "jieqi_next", key: "jie", value: `${n.term}@${new Date(n.utcMs).toISOString()}` });
  }

  // 轨迹（§6.6；input_summary 载明本步实际读取的规则函数与参数，供 Q-C-06 / Q-C-10 复核）
  const fnRow = db.prepare("SELECT function_version, impl_hash FROM formal.engine_function WHERE engine_release_id = ? AND calc_function_id = ?");
  const trace = plan.steps.map((s, k) => {
    const base = { snapshot_id: sid, owner_profile_id: owner, step_code: s.step_code, exec_order: k + 1, status: s.status,
      input_summary: canonicalize({ params: s.params, reads: s.rule_functions }) };
    if (s.status === "未执行") return { ...base, skip_kind: s.skip_kind ?? null, reason: s.reason ?? null, calc_function_id: null, function_version: null, impl_hash: null, output_summary: null };
    const f = fnRow.get(ctx.engine_release_id, s.trace_function) as { function_version: string; impl_hash: string } | undefined;
    if (!f) throw new CanonicalError("DB-T-04", `函数 ${s.trace_function} 未在引擎版本 ${ctx.engine_release_id} 登记`);
    return { ...base, skip_kind: null, reason: null, calc_function_id: s.trace_function, function_version: f.function_version, impl_hash: f.impl_hash,
      output_summary: canonicalize(stepOutput(s.step_code, payload)) };
  });

  // 治理上下文（§6.5；不进结果指纹）
  const maxSeq = (t: string) => (db.prepare(`SELECT coalesce(max(sequence_no), 0) AS n FROM formal.${t}`).get() as { n: number }).n;
  const govSequence = [
    { kind: "evidence_status", max_sequence_no: maxSeq("evidence_status_history") }, { kind: "admission", max_sequence_no: maxSeq("admission_record") },
    { kind: "formal_status", max_sequence_no: maxSeq("formal_status_history") }, { kind: "approval", max_sequence_no: maxSeq("approval_record") },
    { kind: "blocker_change", max_sequence_no: maxSeq("blocker_change") }];
  const govApproval = j.variants.filter((v) => v.approval_id !== null).map((v) => ({ rule_variant_id: v.rule_variant_id, approval_id: v.approval_id! }));

  const fingerprintParts: SnapshotRows["fingerprintParts"] = {
    input_hash: a.inp.input_hash, config_hash: a.cfg.config_hash,
    variant_hashes: j.variants.map((v) => ({ rule_variant_id: v.rule_variant_id, version_no: v.version_no, content_hash: v.content_hash })),
    data_release: release, engine_release_id: ctx.engine_release_id, registry_version: registryVersion,
  };
  if (a.inp.domain === "BAZI") fingerprintParts.tz_table_version = a.inp.tz.tz_table_version;
  if (jieqiVersion !== undefined) fingerprintParts.jieqi_data_version = jieqiVersion;

  const formal = j.status === "FORMAL";
  const personal = deps.some((d) => d["ref_kind"] === "personal");
  const snapshot = {
    snapshot_id: sid, owner_profile_id: owner, input_id: a.inputId, input_hash: a.inp.input_hash, config_id: a.cfg.config_id, config_version: a.cfg.config_version,
    config_hash: a.cfg.config_hash, engine_release_id: ctx.engine_release_id, domain: a.inp.domain, result_payload: resultText, result_hash: hashOf(payload),
    result_fingerprint: resultFingerprint(fingerprintParts), formal_status: formal ? "FORMAL" : "NON_FORMAL", calc_status: formal ? "CALC_FORMAL" : "CALC_RESEARCH",
    research_scope: formal ? "FORMAL" : personal ? "PERSONAL_RESEARCH" : "FORMAL_SCOPE_NON_FORMAL",
    result_completeness: r.degradation.length ? "OK_WITH_DEGRADATION" : "COMPLETE", data_fingerprint: dataFingerprint(resolved),
    hash_algorithm: HASH_ALGORITHM, canonicalization_version: CANONICALIZATION_VERSION, execution_trace_ref: sid,
    recomputed_from_snapshot_id: a.recomputedFrom ?? null, created_at: new Date().toISOString(),
  };
  return {
    snapshot,
    reasons: j.reasons.map((x, k) => ({ snapshot_id: sid, owner_profile_id: owner, ord: k + 1, reason_kind: x.reason_kind, ri_segment: x.ri_segment ?? null,
      step_code: x.step_code, upstream_release: x.upstream_release, upstream_id: x.upstream_id, upstream_hash: x.upstream_hash, note: x.note })),
    degradation: r.degradation, deps, govApproval, govBlocker: j.blockers, govSequence, resolved: sortResolved(resolved), trace, fingerprintParts,
  };
}

/** 封存前载荷校验：未执行步骤不得产出对应字段（DB-T-05），再按结果载荷 v1 规则校验（§6.4(3)） */
export function checkPayloadAgainstPlan(plan: Plan, domain: Domain, payload: Record<string, unknown>): void {
  if (plan.steps.some((s) => s.step_code === "LY-09" && s.status === "未执行") && "month_build" in payload)
    throw new CanonicalError("DB-T-05", "LY-09 未执行而结果含 month_build");
  validateResult(domain, payload);
}

/** 各步输出摘要（不含个人可识别输入；只取本步产出） */
function stepOutput(step: string, p: Record<string, unknown>): Record<string, unknown> {
  const pick = (k: string) => (k in p ? { [k]: p[k] } : {});
  const map: Record<string, () => Record<string, unknown>> = {
    "BZ-01": () => ({ resolved: true }), "BZ-04": () => ({ judged: true }),
    "BZ-05": () => pick("year_pillar"), "BZ-06": () => pick("month_pillar"), "BZ-07": () => pick("day_pillar"), "BZ-08": () => pick("hour_pillar"),
    "BZ-09": () => pick("shishen"), "BZ-10": () => pick("canggan"), "BZ-11": () => pick("changsheng"),
    "LY-01": () => ({ lines: ((p["ben"] as { lines: { yao: number }[] }).lines).map((l) => l.yao) }),
    "LY-02": () => ({ name: (p["ben"] as { name: string }).name, palace: (p["ben"] as { palace: string }).palace }),
    "LY-03": () => ({ najia: (p["ben"] as { lines: { najia: string }[] }).lines.map((l) => l.najia) }),
    "LY-04": () => ({ shi: (p["ben"] as { shi: number }).shi, ying: (p["ben"] as { ying: number }).ying }),
    "LY-05": () => ({ liuqin: (p["ben"] as { lines: { liuqin: string }[] }).lines.map((l) => l.liuqin) }),
    "LY-06": () => pick("day_ganzhi"), "LY-07": () => ({ liushen: (p["ben"] as { lines: { liushen: string }[] }).lines.map((l) => l.liushen) }),
    "LY-08": () => pick("xunkong_branches"), "LY-10": () => ("bian" in p ? { bian: (p["bian"] as { name: string }).name } : { bian: null }),
  };
  return (map[step] ?? (() => ({})))();
}

// ---------------------------------------------------------------- 封存（清单 §3.5）
export interface SealHooks {
  /** 测试注入：写第 n 行依赖前调用（DB-R-01） */
  beforeDep?: (ord: number, db: DatabaseSync) => void;
  /** 测试注入：跳过引擎预检（证明“绕过预检”时由连接级查询查出） */
  skipPrecheck?: boolean;
  /** 测试注入：不写快照行（DB-R-03） */
  omitSnapshot?: boolean;
}
export class PresealError extends Error {
  constructor(public readonly violations: { check: string; rows: unknown[] }[]) {
    super(`[PRESEAL] 封存前复核未通过：${violations.map((v) => v.check).join("、")}`);
  }
}
const insertRow = (db: DatabaseSync, table: string, row: Record<string, string | number | null>) => {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]!));
};

export function sealSnapshot(db: DatabaseSync, rows: SnapshotRows, hooks?: SealHooks): void {
  // DB-J-06：存储文本须为规范化形式（库层无法重算，封存前由引擎校验）
  assertCanonicalText(String(rows.snapshot["result_payload"]));
  for (const t of rows.trace) for (const k of ["input_summary", "output_summary"]) if (t[k] !== null && t[k] !== undefined) assertCanonicalText(String(t[k]));
  const sid = String(rows.snapshot["snapshot_id"]), owner = String(rows.snapshot["owner_profile_id"]);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows.reasons) insertRow(db, "snapshot_non_formal_reason", r);
    for (const c of rows.degradation) insertRow(db, "snapshot_degradation_reason", { snapshot_id: sid, owner_profile_id: owner, reason_code: c });
    for (const d of rows.deps) { hooks?.beforeDep?.(Number(d["ord"]), db); insertRow(db, "snapshot_dependency", d); }
    for (const g of rows.govApproval) insertRow(db, "snapshot_gov_approval", { snapshot_id: sid, owner_profile_id: owner, ...g });
    for (const g of rows.govBlocker) insertRow(db, "snapshot_gov_blocker", { snapshot_id: sid, owner_profile_id: owner, ...g });
    for (const g of rows.govSequence) insertRow(db, "snapshot_gov_sequence", { snapshot_id: sid, owner_profile_id: owner, ...g });
    for (const x of rows.resolved) insertRow(db, "snapshot_resolved_context", { snapshot_id: sid, owner_profile_id: owner, item_kind: x.item_kind, key: x.key,
      version: x.version ?? null, content_hash: x.content_hash ?? null, value: x.value ?? null });
    for (const t of rows.trace) insertRow(db, "execution_trace_step", t);
    if (!hooks?.omitSnapshot) insertRow(db, "calculation_snapshot", rows.snapshot);
    // 引擎复核（E + Q）：快照行写入后、提交前，以连接级查询复核本快照；不通过即整体回滚
    if (!hooks?.skipPrecheck) {
      const v = presealViolations(db, sid);
      if (v.length) throw new PresealError(v);
    }
    db.exec("COMMIT");
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------- 复算校验（§13.6；DB-S-03）
export function verifyRecompute(stored: SnapshotRows, fresh: SnapshotRows): { ok: true } | { ok: false; code: "DATA_FINGERPRINT_MISMATCH" | "RESULT_FINGERPRINT_MISMATCH" } {
  if (stored.snapshot["data_fingerprint"] !== dataFingerprint(fresh.resolved)) return { ok: false, code: "DATA_FINGERPRINT_MISMATCH" };
  if (stored.snapshot["result_fingerprint"] !== fresh.snapshot["result_fingerprint"]) return { ok: false, code: "RESULT_FINGERPRINT_MISMATCH" };
  return { ok: true };
}
