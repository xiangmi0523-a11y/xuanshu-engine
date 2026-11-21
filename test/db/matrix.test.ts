// 审核清单 §5.1 生成矩阵：DB-N、DB-N2、DB-E、DB-K、DB-I。按机读规格 db/spec.json 对全部表逐列生成用例。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openMemoryDb } from "../../db/connect.js";
import { DeletionModule } from "../../db/deletion.js";
import { baseRows, count, ins, inSavepoint, rejects, runCase, spec, tablesWithBase, type Row, type Val } from "./helpers.js";

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
  const s = spec().tables[t]!;
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

test("DB-N2：规格必填集合与 DDL NOT NULL 集合双向一致（全部表）", () => {
  const db = openMemoryDb();
  const sp = spec();
  const tables = (s: string) => (db.prepare(`SELECT name FROM ${s}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'passage_fts%'`).all() as { name: string }[]).map((r) => r.name);
  const all = [...tables("formal").map((t) => ["formal", t] as const), ...tables("main").map((t) => ["main", t] as const)];
  assert.equal(all.length, Object.keys(sp.tables).length, "规格表覆盖全部表");
  for (const [s, t] of all) {
    const want = new Set([...sp.tables[t]!.required, ...(sp.tables[t]!.supplement?.columns ?? [])]);
    const got = new Set((db.prepare(`PRAGMA ${s}.table_info("${t}")`).all() as { name: string; notnull: number; pk: number }[]).filter((c) => c.notnull || c.pk).map((c) => c.name));
    assert.deepEqual([...want].filter((c) => !got.has(c)), [], `${t}：规格必填而 DDL 可空`);
    assert.deepEqual([...got].filter((c) => !want.has(c)), [], `${t}：DDL 必填而规格未列`);
  }
});

test("DB-N：每个必填列置 NULL 各一次，报 NOT NULL constraint failed（全部表）", () => {
  const db = tablesWithBase();
  const base = firstBase();
  let n = 0;
  for (const [t, s] of Object.entries(spec().tables)) {
    const b = base.get(t);
    assert.ok(b, `${t} 缺基准行`);
    const cols = db.prepare(`PRAGMA ${s.schema}.table_info("${t}")`).all() as { name: string; type: string; pk: number }[];
    for (const c of [...s.required, ...(s.supplement?.columns ?? [])]) {
      const rowidAlias = cols.find((x) => x.name === c)?.type === "INTEGER" && cols.filter((x) => x.pk).length === 1 && cols.find((x) => x.name === c)!.pk === 1;
      inSavepoint(db, () => {
        if (rowidAlias) assert.throws(() => ins(db, s.schema, t, { ...b.row, [c]: null }), `${t}.${c}`); // INTEGER PRIMARY KEY：NULL 取自增值，再被 CHECK 拦下
        else rejects(() => ins(db, s.schema, t, { ...b.row, [c]: null }), `NOT NULL constraint failed: ${t}.${c}`, `${t}.${c}`);
      });
      n++;
    }
  }
  assert.ok(n > 350, `必填列用例数 ${n}`);
});

test("DB-E：每个枚举列取每个合法值成功、越界值报约束编号（全部表）", () => {
  const db = tablesWithBase();
  const base = firstBase();
  const companions = (JSON.parse(JSON.stringify(enumCompanions)) as Record<string, Row>);
  const failures: string[] = [];
  let n = 0;
  for (const [t, s] of Object.entries(spec().tables)) for (const [col, e] of Object.entries(s.enums)) {
    const b = base.get(t)!;
    for (const v of e.values) {
      if (v === b.row[col]) continue; // 基准行已证明
      inSavepoint(db, () => {
        const extra = companions[`${t}.${col}=${String(v)}`] ?? {};
        try { ins(db, s.schema, t, probe(db, s.schema, t, b.row, { [col]: v as Val, ...extra })); }
        catch (err) { failures.push(`${t}.${col}=${String(v)}：${(err as Error).message}`); }
      });
      n++;
    }
    inSavepoint(db, () => rejects(() => ins(db, s.schema, t, probe(db, s.schema, t, b.row, { [col]: e.values.every((x) => typeof x === "number") ? 2 : "X" })), `CHECK constraint failed: ${e.constraint}`, `${t}.${col}`));
    n++;
  }
  assert.deepEqual(failures, [], "合法枚举值均应写入成功");
  assert.ok(n > 150, `枚举用例数 ${n}`);
});

/** 枚举取某值时须同时满足的配对列（同表其他 CHECK 的配对要求） */
const enumCompanions: Record<string, Row> = {
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
};

/** 外键列取值时须同时满足的配对列 */
const fkCompanions: Record<string, Row> = {
  "edition.parent_edition_id": { base_text: "底本" },
};

test("DB-K：外键开启；每个外键单独指向不存在的父行被拒；结束后 foreign_key_check 为空（全部表）", () => {
  const db = tablesWithBase();
  assert.equal((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1, "PRAGMA foreign_keys = 1");
  const base = firstBase();
  let n = 0;
  for (const [t, s] of Object.entries(spec().tables)) for (const fk of s.fks) {
    const b = base.get(t)!;
    const cols = db.prepare(`PRAGMA ${s.schema}.table_info("${t}")`).all() as { name: string; type: string }[];
    const bad: Row = { ...Object.fromEntries(fk.from.map((c) => [c, cols.find((x) => x.name === c)!.type === "INTEGER" ? 987654 : "MISSING-PARENT"])), ...(fkCompanions[`${t}.${fk.from.join(",")}`] ?? {}) };
    const row = { ...freshCopy(db, s.schema, t, b.row, new Set(Object.keys(bad))), ...bad };
    if (!fk.deferred) inSavepoint(db, () => rejects(() => ins(db, s.schema, t, probe(db, s.schema, t, b.row, bad)), "FOREIGN KEY constraint failed", `${t}(${fk.from.join(",")})`));
    else {
      const d2 = tablesWithBase();
      d2.exec("BEGIN");
      ins(d2, s.schema, t, row); // 延迟外键：语句处不报
      rejects(() => d2.exec("COMMIT"), "FOREIGN KEY constraint failed", `${t}(${fk.from.join(",")}) 提交时`);
      if (d2.isTransaction) d2.exec("ROLLBACK");
    }
    n++;
  }
  for (const s of ["main", "formal"]) assert.equal(db.prepare(`PRAGMA ${s}.foreign_key_check`).all().length, 0, `${s} foreign_key_check 为空`);
  assert.ok(n > 80, `外键用例数 ${n}`);
});

test("DB-I：正式库每表拒 UPDATE、拒 DELETE，报 [DB-I-<表>]", () => {
  const db = openMemoryDb();
  db.exec("BEGIN");
  for (const [s, t, r] of baseRows()) if (s === "formal") ins(db, s, t, r);
  db.exec("COMMIT");
  for (const [t, s] of Object.entries(spec().tables)) {
    if (s.schema !== "formal") continue;
    assert.ok(count(db, `formal.${t}`) > 0, `${t} 有行`);
    const col = s.required[0] ?? s.supplement!.columns[0]!;
    rejects(() => db.exec(`UPDATE formal.${t} SET "${col}" = "${col}"`), `[DB-I-${t}]`, `UPDATE ${t}`);
    rejects(() => db.exec(`DELETE FROM formal.${t}`), `[DB-I-${t}]`, `DELETE ${t}`);
  }
});

test("DB-I：用户库计算层与审计表拒 UPDATE、未授权 DELETE 报 [DB-I-<表>]（数据来自 G2 端到端与一次真实删除）", () => {
  const r = runCase("G2", "E2E-BZ-1");
  const db = r.w.db;
  const del = new DeletionModule(db);
  runCase("G2", "E2E-LY-1", { w: r.w, profileId: "X-PROFILE-DEL", inputId: "X-INPUT-DEL" });
  const sid = (db.prepare("SELECT snapshot_id FROM calculation_snapshot WHERE owner_profile_id = ?").get("X-PROFILE-DEL") as { snapshot_id: string }).snapshot_id;
  db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR', 'b', NULL, ?, ?, 'OWNER', NULL)")
    .run(r.w.releases[0]!, sid);
  db.prepare("INSERT INTO branch_status_history (branch_id, previous_status, new_status, data_release, note, sequence_no) VALUES ('X-BR', NULL, 'active', NULL, 'n', 1)").run();
  db.prepare("INSERT INTO personal_rule_variant (rule_variant_id, branch_id, component_release, component_id, component_hash, version_no, content_hash, hash_algorithm, canonicalization_version, confidence, non_formal_reason, formal_status) VALUES ('X-PRV', 'X-BR', ?, 'P-D-04', 'h', 1, 'c', 'sha256', 'jcs-1', 'C', '个人校勘', 'NON_FORMAL')").run(r.w.releases[0]!);
  db.prepare("INSERT INTO blocked_audit_event (event_id, occurred_at, module, block_reason_code, app_version, data_release) VALUES ('X-E', 't', 'BAZI', 'MISSING_APPROVAL', '0', ?)").run(r.w.releases[0]!);
  const d = del.deleteProfile("X-PROFILE-DEL", { appVersion: "0.0.0", dataRelease: r.w.releases.at(-1)! });
  assert.ok(d.ok, "真实删除成功（生成审计、计数与 branch_event）");
  const noUpdate = ["profile", "calculation_input", "input_tz_resolution", "calculation_config", "config_param_value", "profile_config_ref", "calculation_snapshot",
    "snapshot_non_formal_reason", "snapshot_degradation_reason", "snapshot_dependency", "snapshot_gov_approval", "snapshot_gov_blocker", "snapshot_gov_sequence",
    "snapshot_resolved_context", "execution_trace_step", "blocked_audit_event", "deletion_audit", "deletion_audit_count", "branch_event", "branch_status_history", "personal_rule_variant"];
  for (const t of noUpdate) {
    if (count(db, t) === 0) { if (t === "snapshot_non_formal_reason") continue; assert.fail(`${t} 无行`); }
    const col = spec().tables[t]!.required[0] ?? spec().tables[t]!.supplement!.columns[0]!;
    rejects(() => db.exec(`UPDATE ${t} SET "${col}" = "${col}"`), `[DB-I-${t}]`, `UPDATE ${t}`);
    rejects(() => db.exec(`DELETE FROM ${t}`), `[DB-I-${t}]`, `DELETE ${t}`);
  }
  rejects(() => db.exec("DELETE FROM branch"), "[DB-I-branch]");
  rejects(() => db.exec("UPDATE branch SET branch_name = 'z'"), "[DB-I-branch]");
});
