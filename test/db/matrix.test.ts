// 审核清单 §5.1 生成矩阵：DB-N、DB-N2、DB-E、DB-K、DB-I。规格 db/spec.json 为独立规格（清单第 4 节 + 补充出处表生成，不读 DDL）。
import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../../db/connect.js";
import { DeletionModule } from "../../db/deletion.js";
import { baseRows, count, ins, inSavepoint, rejects, runCase, spec, tablesWithBase, type Row } from "./helpers.js";
import { runDbE, runDbK, runDbN2 } from "./matrix_lib.js";

const firstBase = () => {
  const m = new Map<string, { schema: string; row: Row }>();
  for (const [s, t, r] of baseRows()) if (!m.has(t)) m.set(t, { schema: s, row: r });
  return m;
};

test("DB-N2：规格必填集合与 DDL NOT NULL 集合双向一致（全部表）", () => {
  assert.deepEqual(runDbN2(openMemoryDb(), spec()), []);
});

test("DB-N：每个必填列置 NULL 各一次，报 NOT NULL constraint failed（全部表；必填枚举的 NULL 拒绝也在此）", () => {
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
  assert.ok(n > 300, `必填列用例数 ${n}`);
});

test("DB-E：每个枚举列取每个合法值成功、越界值报约束编号、可空枚举取 NULL 成功（全部表）", () => {
  const r = runDbE(() => tablesWithBase(), spec());
  assert.deepEqual(r.failures, [], "枚举矩阵");
  assert.ok(r.n > 200, `枚举用例数 ${r.n}`);
  const nullable = Object.entries(spec().tables).flatMap(([t, s]) => Object.entries(s.enums).filter(([, e]) => e.nullable).map(([c]) => `${t}.${c}`));
  assert.deepEqual(r.nullPositive.sort(), nullable.sort(), "每个可空枚举都有 NULL 正向用例");
  assert.ok(nullable.length >= 8, `可空枚举数 ${nullable.length}`);
});

test("DB-K：外键开启；规格要求的每个外键单独指向不存在的父行被拒；结束后 foreign_key_check 为空（全部表）", () => {
  const r = runDbK(() => tablesWithBase(), spec());
  assert.deepEqual(r.failures, []);
  const want = Object.values(spec().tables).reduce((a, s) => a + s.fks.length, 0);
  assert.equal(r.n, want, "规格中的外键逐条检验");
  assert.ok(r.n > 100, `外键用例数 ${r.n}`);
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
