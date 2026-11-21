// 约束矩阵执行体（E2-FIX D）：DB-N2、DB-N、DB-E、DB-K 均以“规格 + 建库函数”为参数，
// 供 matrix.test.ts 正常运行，也供 spec.test.ts 的变异测试以改写过的 DDL 运行并断言失败。
import type { DatabaseSync } from "node:sqlite";
import { baseRows, ins, inSavepoint, type Row, type Spec, type Val } from "./helpers.js";

export type Mk = () => DatabaseSync;
const firstBase = () => {
  const m = new Map<string, { schema: string; row: Row }>();
  for (const [s, t, r] of baseRows()) if (!m.has(t)) m.set(t, { schema: s, row: r });
  return m;
};
function uniqueCols(db: DatabaseSync, schema: string, t: string): string[][] {
  const idx = db.prepare(`PRAGMA ${schema}.index_list("${t}")`).all() as { name: string; unique: number }[];
  return idx.filter((i) => i.unique).map((i) => (db.prepare(`PRAGMA ${schema}.index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name));
}
/** 基准行的“唯一化副本”：每个唯一键改动一列非外键、非枚举列，避免与基准行冲突 */
function freshCopy(db: DatabaseSync, schema: string, t: string, row: Row, keep: Set<string>): Row {
  const s = SPEC!.tables[t]!;
  const fkCols = new Set(s.fks.flatMap((f) => f.from));
  const out: Row = { ...row };
  for (const key of uniqueCols(db, schema, t)) {
    const c = key.find((k) => !fkCols.has(k) && !(k in s.enums) && !keep.has(k));
    if (!c) continue;
    const v = out[c];
    out[c] = typeof v === "number" ? v + 1000 : `${String(v)}-u`;
  }
  if ("execution_trace_ref" in out) out["execution_trace_ref"] = out["snapshot_id"]!; // DB-S-trace_ref 联动
  return out;
}
/** 探测行：基准行若无子行则先删去（在保存点内），用基准值加改动；否则用唯一化副本加改动 */
function probe(db: DatabaseSync, schema: string, t: string, base: Row, over: Row): Row {
  const where = Object.keys(base).map((c) => (base[c] === null ? `"${c}" IS NULL` : `"${c}" = ?`)).join(" AND ");
  try {
    db.prepare(`DELETE FROM ${schema}.${t} WHERE ${where}`).run(...(Object.values(base).filter((v) => v !== null) as (string | number)[]));
    return { ...base, ...over };
  } catch { return { ...freshCopy(db, schema, t, base, new Set(Object.keys(over))), ...over }; }
}


let SPEC: Spec | undefined;
const fail = (out: string[], fn: () => void, what: string) => { try { fn(); } catch (e) { out.push(`${what}：${(e as Error).message}`); } };
/** 断言抛错且含定位，否则记一条失败 */
function expectReject(out: string[], fn: () => unknown, locator: string, what: string) {
  try { fn(); out.push(`${what}：应被拒（${locator}）而写入成功`); }
  catch (e) { if (!(e as Error).message.includes(locator)) out.push(`${what}：期望 ${locator}，实际 ${(e as Error).message}`); }
}

/** DB-N2：规格必填集合与 DDL NOT NULL 集合双向一致 */
export function runDbN2(db: DatabaseSync, sp: Spec): string[] {
  const out: string[] = [];
  const tables = (s: string) => (db.prepare(`SELECT name FROM ${s}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'passage_fts%'`).all() as { name: string }[]).map((r) => r.name);
  const all = [...tables("formal").map((t) => ["formal", t] as const), ...tables("main").map((t) => ["main", t] as const)];
  for (const [s, t] of all) {
    if (!sp.tables[t]) { out.push(`${t}：DDL 有表而规格无`); continue; }
    const want = new Set([...sp.tables[t]!.required, ...(sp.tables[t]!.supplement?.columns ?? [])]);
    const got = new Set((db.prepare(`PRAGMA ${s}.table_info("${t}")`).all() as { name: string; notnull: number; pk: number }[]).filter((c) => c.notnull || c.pk).map((c) => c.name));
    for (const c of want) if (!got.has(c)) out.push(`${t}.${c}：规格必填而 DDL 可空`);
    for (const c of got) if (!want.has(c)) out.push(`${t}.${c}：DDL 必填而规格未列`);
  }
  for (const t of Object.keys(sp.tables)) if (!all.some(([, x]) => x === t)) out.push(`${t}：规格有表而 DDL 无`);
  return out;
}

/** DB-E：每个枚举列取每个合法值成功；越界值报约束编号；可空枚举取 NULL 成功（必填枚举的 NULL 拒绝归 DB-N） */
export function runDbE(mk: Mk, sp: Spec): { failures: string[]; n: number; nullPositive: string[] } {
  SPEC = sp;
  const db = mk();
  const base = firstBase();
  const failures: string[] = [];
  const nullPositive: string[] = [];
  let n = 0;
  for (const [t, s] of Object.entries(sp.tables)) for (const [col, e] of Object.entries(s.enums)) {
    const b = base.get(t);
    if (!b) { failures.push(`${t} 缺基准行`); continue; }
    for (const v of e.values) {
      if (v === b.row[col]) { n++; continue; } // 基准行已证明
      inSavepoint(db, () => fail(failures, () => ins(db, s.schema, t, probe(db, s.schema, t, b.row, { [col]: v as Val, ...(enumCompanions[`${t}.${col}=${String(v)}`] ?? {}) })), `${t}.${col}=${String(v)} 合法值写入`));
      n++;
    }
    inSavepoint(db, () => expectReject(failures, () => ins(db, s.schema, t, probe(db, s.schema, t, b.row, { [col]: e.values.every((x) => typeof x === "number") ? 2 : "X" })), `CHECK constraint failed: ${e.constraint}`, `${t}.${col} 越界值`));
    n++;
    if (e.nullable) {
      inSavepoint(db, () => fail(failures, () => ins(db, s.schema, t, probe(db, s.schema, t, b.row, { [col]: null, ...(enumCompanions[`${t}.${col}=NULL`] ?? {}) })), `${t}.${col}=NULL 可空枚举写入`));
      nullPositive.push(`${t}.${col}`);
      n++;
    }
  }
  return { failures, n, nullPositive };
}

/** DB-K：每个外键单独指向不存在的父行被拒（立即外键在语句处，延迟外键在提交处） */
export function runDbK(mk: Mk, sp: Spec): { failures: string[]; n: number } {
  SPEC = sp;
  const db = mk();
  const base = firstBase();
  const failures: string[] = [];
  let n = 0;
  if ((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1) failures.push("PRAGMA foreign_keys 未开启");
  for (const [t, s] of Object.entries(sp.tables)) for (const fk of s.fks) {
    const b = base.get(t);
    if (!b) { failures.push(`${t} 缺基准行`); continue; }
    const cols = db.prepare(`PRAGMA ${s.schema}.table_info("${t}")`).all() as { name: string; type: string }[];
    const missing = fk.from.filter((c) => !cols.some((x) => x.name === c));
    if (missing.length) { failures.push(`${t}(${fk.from.join(",")})：DDL 无此列`); continue; }
    const bad: Row = { ...Object.fromEntries(fk.from.map((c) => [c, cols.find((x) => x.name === c)!.type === "INTEGER" ? 987654 : "MISSING-PARENT"])), ...(fkCompanions[`${t}.${fk.from.join(",")}`] ?? {}) };
    const what = `${t}(${fk.from.join(",")}) → ${fk.table}`;
    if (!fk.deferred) inSavepoint(db, () => expectReject(failures, () => ins(db, s.schema, t, probe(db, s.schema, t, b.row, bad)), "FOREIGN KEY constraint failed", what));
    else {
      const d2 = mk();
      const row = { ...freshCopy(d2, s.schema, t, b.row, new Set(Object.keys(bad))), ...bad };
      d2.exec("BEGIN");
      try {
        ins(d2, s.schema, t, row); // 延迟外键：语句处不报
        expectReject(failures, () => d2.exec("COMMIT"), "FOREIGN KEY constraint failed", `${what}（延迟，提交时）`);
      } catch (e) { failures.push(`${what}（延迟）：语句处即报 ${(e as Error).message}`); }
      if (d2.isTransaction) d2.exec("ROLLBACK");
    }
    n++;
  }
  for (const s of ["main", "formal"]) if (db.prepare(`PRAGMA ${s}.foreign_key_check`).all().length !== 0) failures.push(`${s} foreign_key_check 非空`);
  return { failures, n };
}

/** 枚举取某值时须同时满足的配对列（同表其他 CHECK 的配对要求） */
export const enumCompanions: Record<string, Row> = {
  "edition.confidence=A": { transcription_status: "原刊本" },
  "rule_component.evidence_category=C-A": { is_calendar_anchor: 0 },
  "calculation_snapshot.formal_status=NON_FORMAL": { calc_status: "CALC_RESEARCH", research_scope: "FORMAL_SCOPE_NON_FORMAL" },
  "calculation_snapshot.calc_status=CALC_RESEARCH": { formal_status: "NON_FORMAL", research_scope: "FORMAL_SCOPE_NON_FORMAL" },
  "calculation_snapshot.research_scope=FORMAL_SCOPE_NON_FORMAL": { formal_status: "NON_FORMAL", calc_status: "CALC_RESEARCH" },
  "calculation_snapshot.research_scope=PERSONAL_RESEARCH": { formal_status: "NON_FORMAL", calc_status: "CALC_RESEARCH" },
  "calculation_snapshot.domain=BAZI": { result_payload: "{\"v\":1}" },
  "snapshot_non_formal_reason.reason_kind=R-I": { ri_segment: "R-I-4" },
  "snapshot_dependency.dep_type=rule_variant": { ref_hash: "h", ref_release: "r", ref_version: "1", approval_id: "a" },
  "snapshot_dependency.dep_type=edition": { ref_hash: "h", ref_release: "r", ref_version: "1" },
  "snapshot_dependency.dep_type=evidence": { ref_hash: "h", ref_release: "r", ref_version: "1" },
  "snapshot_dependency.dep_type=calendar_data": { ref_hash: "h", ref_release: "r", ref_version: "1" },
  "snapshot_dependency.dep_type=place_data": { ref_hash: "h", ref_release: "r", ref_version: "1" },
  "snapshot_dependency.dep_type=cross_domain": { ref_hash: "h", ref_release: "r", ref_version: "1" },
  "snapshot_dependency.dep_type=parameter": { param_value: "v", value_source: "user_selected", registry_version: "r" },
  "snapshot_dependency.dep_type=tz_data": { ref_version: "未记录" },
  "snapshot_resolved_context.item_kind=jieqi_prev": { version: null, content_hash: null, value: "立春@2026-02-04T00:00:00.000Z" },
  "snapshot_resolved_context.item_kind=jieqi_next": { version: null, content_hash: null, value: "惊蛰@2026-03-05T00:00:00.000Z" },
  "execution_trace_step.status=未执行": { skip_kind: "范围外", reason: "x", calc_function_id: null, function_version: null, impl_hash: null, input_summary: null, output_summary: null },
  "branch_status_history.new_status=merged": { data_release: "r" },
  "personal_rule_variant.non_formal_reason=实验规则": { experiment_hypothesis: "h", experiment_status: "进行中", experiment_promotion_path: "p", experiment_valid_until: "2027-01-01" },
  "parameter_registry.registry_status=VERSION_LOCKED": { locked_value: "v" },
  "parameter_registry.has_default=0": { default_value: null, first_use_prompt: "首次使用强制选择" },
  "calculation_input.domain=BAZI": { gender: "UNKNOWN", time_precision: "MINUTE", raw_payload: "{\"v\":1}" },
  "admission_record.new_status=CONDITIONAL": { conditions: "{\"all\":[{\"op\":\"param_selected\",\"param\":\"CFG-01\"}],\"v\":1}" },
  "dispute.status=已裁决": { ruling_ref: "x" },
  "approval_record.decision=approve_conditional": { conditions: "{\"all\":[{\"op\":\"param_selected\",\"param\":\"CFG-01\"}],\"v\":1}" },
  "review_record.role=revocation_trigger": { trigger_type: "x", source_event: "x", disposition: "x" },
  "evidence_status_history.field=evidence_status": { new_value: "UNVERIFIED" },
  "evidence_status_history.target_type=RuleComponent": {},
  "formal_status_history.new_value=NON_FORMAL": {},
  "deletion_audit.success=0": {},
  "rule_variant.non_formal_reason=实验规则": { experiment_hypothesis: "h", experiment_status: "进行中", experiment_promotion_path: "p", experiment_valid_until: "2027-01-01" },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`snapshot_non_formal_reason.ri_segment=R-I-${i}`, { reason_kind: "R-I" }])),
  ...Object.fromEntries(["范围外", "输入缺失", "按规则跳过"].map((k) => [`execution_trace_step.skip_kind=${k}`, { status: "未执行", reason: "x", calc_function_id: null, function_version: null, impl_hash: null, input_summary: null, output_summary: null }])),
  "personal_text_variant.preferred_reading=a": { preferred_basis: "依据" },
  "personal_text_variant.preferred_reading=b": { preferred_basis: "依据" },
};

/** 外键列取值时须同时满足的配对列 */
export const fkCompanions: Record<string, Row> = {
  "edition.parent_edition_id": { base_text: "底本" },
};

