// 审核清单 §5.2 正式库（DB-F-04～25）、§5.3 历史序号（DB-Q-01～09）、§5.8 结构化 JSON（DB-J-01～05、07、08）。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openMemoryDb } from "../../db/connect.js";
import { releaseChecks } from "../../db/queries.js";
import { baseRows, ins, inSavepoint, rejects, releases, type Row } from "./helpers.js";

/** 完整结构 + 正式库基准行 */
function fdb(): DatabaseSync {
  const db = openMemoryDb();
  db.exec("BEGIN");
  for (const [s, t, r] of baseRows()) if (s === "formal") ins(db, s, t, r);
  db.exec("COMMIT");
  return db;
}
const B = (t: string, i = 0): Row => baseRows().filter((r) => r[1] === t)[i]![2];
const R = releases();
const F = (db: DatabaseSync, t: string, row: Row) => ins(db, "formal", t, row);
const addRelease = (db: DatabaseSync, k: number) => F(db, "data_release", { data_release: R[k]!, release_seq: k + 1, commit_sha: "none", created_at: "t" });
const RV1 = () => String(B("rule_variant", 0)["rule_variant_id"]);
const RV2 = () => String(B("rule_variant", 1)["rule_variant_id"]);
const RC1 = () => String(B("rule_component")["component_id"]);
const ALL = "{\"kind\":\"all\",\"v\":1}";
/** 写一条批准（依据先写、批准后写，同一事务） */
function approval(db: DatabaseSync, row: Row, opts: { revokeReason?: boolean; basis?: boolean } = {}) {
  db.exec("BEGIN");
  try {
    if (opts.basis !== false) F(db, "approval_basis", { approval_id: row["approval_id"]!, basis_ref: "x" });
    if (opts.revokeReason) F(db, "approval_revoke_reason", { approval_id: row["approval_id"]!, reason_code: "EVIDENCE_INVALIDATED" });
    F(db, "approval_record", row);
    db.exec("COMMIT");
  } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
}
const apr = (over: Row): Row => ({ approval_id: "X-APR", sequence_no: 2, target_type: "rule_variant", target_id: RV1(), target_content_hash: String(B("rule_variant", 0)["content_hash"]),
  data_release: R[0]!, decision: "approve", decided_by: "USER", decided_at: "t", scope: ALL, conditions: null, supersedes_approval_id: null, ...over });

test("DB-F-04：转录本 confidence 不得为 A", () => {
  const db = fdb();
  const e = { ...B("edition"), edition_id: "X-ED" };
  F(db, "edition", { ...e, confidence: "B" });
  rejects(() => F(db, "edition", { ...e, edition_id: "X-ED2", confidence: "A" }), "CHECK constraint failed: DB-F-04");
});

test("DB-F-05：默认值与锁定值的取值规则 (a)(b)(c)", () => {
  const db = fdb();
  const p = { ...B("parameter_registry", 0), param_id: "CFG-04", value_kind: "enum", has_default: 0, default_value: null, first_use_prompt: "首次使用强制选择" };
  F(db, "parameter_registry", p);
  assert.equal((db.prepare("SELECT locked_value FROM formal.parameter_registry WHERE param_id = 'CFG-01'").get() as { locked_value: string }).locked_value, "ye_zi_b");
  rejects(() => F(db, "parameter_registry", { ...p, param_id: "X-P1", default_value: "yh_yuelu" }), "DB-F-05a");
  rejects(() => F(db, "parameter_registry", { ...p, param_id: "X-P2", registry_status: "VERSION_LOCKED", locked_value: null }), "DB-F-05b");
  rejects(() => F(db, "parameter_registry", { ...p, param_id: "X-P3", registry_status: "ACTIVE", locked_value: "v" }), "DB-F-05c");
});

test("DB-F-06：CONDITIONAL 须有条件", () => {
  const db = fdb();
  const a = { ...B("admission_record"), admission_id: "X-ADM", component_id: RC1(), purpose: "text", previous_status: null, new_status: "CONDITIONAL",
    conditions: "{\"all\":[{\"op\":\"param_selected\",\"param\":\"CFG-01\"}],\"v\":1}", sequence_no: 2 };
  F(db, "admission_record", a);
  rejects(() => F(db, "admission_record", { ...a, admission_id: "X-ADM2", purpose: "qualitative", conditions: null, sequence_no: 3 }), "DB-F-06");
});

test("DB-F-07：批准记录字段规则 (a)(b)(c)", () => {
  const db = fdb();
  approval(db, apr({ decision: "revoke" }), { revokeReason: true });
  rejects(() => approval(db, apr({ approval_id: "X-A", sequence_no: 3, decided_by: "GPT" })), "DB-F-07a");
  rejects(() => approval(db, apr({ approval_id: "X-B", sequence_no: 3, target_type: "rule" })), "DB-F-07b");
  rejects(() => approval(db, apr({ approval_id: "X-C", sequence_no: 3, decision: "revoke" })), "DB-F-07c");
  rejects(() => approval(db, apr({ approval_id: "X-D", sequence_no: 3 }), { basis: false }), "DB-F-07d");
});

test("DB-F-08：批准序号唯一递增 (a)(b)", () => {
  const db = fdb();
  approval(db, apr({ approval_id: "X-2", sequence_no: 2 }));
  approval(db, apr({ approval_id: "X-5", sequence_no: 5 }));
  rejects(() => approval(db, apr({ approval_id: "X-5b", sequence_no: 5 })), "DB-F-08a");
  rejects(() => approval(db, apr({ approval_id: "X-4", sequence_no: 4 })), "DB-F-08b");
});

test("DB-F-09：变体版本递增与实验字段 (a)(b)(c)", () => {
  const db = fdb();
  const v = { ...B("rule_variant", 0) };
  rejects(() => F(db, "rule_variant", { ...v, rule_variant_id: "X-V2", version_no: 2 }), "DB-F-09a");
  rejects(() => F(db, "rule_variant", { ...v, rule_variant_id: "X-V1", version_no: 1 }), "DB-F-09");
  rejects(() => F(db, "rule_variant", { ...v, rule_variant_id: "X-V3", version_no: 3, non_formal_reason: "实验规则" }), "DB-F-09c");
  F(db, "rule_variant", { ...v, rule_variant_id: "X-V3", version_no: 3 });
});

test("DB-F-10：替代关系同子项、无环、允许分叉 (a)(b)(c)(d)", () => {
  const db = fdb();
  const v = { ...B("rule_variant", 0) };
  F(db, "rule_variant", { ...v, rule_variant_id: "X-C", version_no: 3 });
  const s = { ...B("variant_supersedes") };
  F(db, "variant_supersedes", { ...s, new_variant_id: "X-C", reason: "适用范围拆分", applicable_scope: "{\"kind\":\"segment\",\"module\":\"BAZI\",\"v\":1}" }); // 分叉 A→C
  assert.deepEqual(releaseChecks["Q-F-10"](db), [], "正向无环");
  F(db, "rule_component", { ...B("rule_component"), component_id: "X-RC2" });
  F(db, "rule_variant", { ...v, rule_variant_id: "X-D", component_id: "X-RC2", version_no: 1 });
  rejects(() => F(db, "variant_supersedes", { ...s, new_variant_id: "X-D" }), "DB-F-10a");
  F(db, "variant_supersedes", { ...s, old_variant_id: RV2(), new_variant_id: RV1() }); // B→A
  assert.ok(releaseChecks["Q-F-10"](db).some((r) => r["rule_variant_id"] === RV1()), "Q-F-10 返回环上的变体");
  rejects(() => F(db, "variant_supersedes", { ...s }), "DB-F-10c");
  F(db, "rule_variant", { ...v, rule_variant_id: "X-F", version_no: 4 });
  rejects(() => F(db, "variant_supersedes", { ...s, new_variant_id: "X-F", reason: null }), "NOT NULL constraint failed: variant_supersedes.reason");
});

test("DB-F-11：默认变体规则 (a)(b)(c)", () => {
  const db = fdb();
  const d = { ...B("component_default") };
  F(db, "rule_component", { ...B("rule_component"), component_id: "X-RC2" });
  F(db, "rule_variant", { ...B("rule_variant", 0), rule_variant_id: "X-D", component_id: "X-RC2", version_no: 1 });
  rejects(() => F(db, "component_default", { ...d, rule_variant_id: "X-D", sequence_no: 2 }), "DB-F-11a");
  rejects(() => F(db, "component_default", { ...d, sequence_no: 2 }), "DB-F-11b");
  addRelease(db, 1);
  rejects(() => F(db, "component_default", { ...d, data_release: R[1]!, sequence_no: 2, applicable_scope: "{\"kind\":\"range\",\"v\":1}" }), "DB-J-02");
});

test("DB-F-12：C-A 子项须标锚点", () => {
  const db = fdb();
  const c = { ...B("rule_component"), evidence_category: "C-A" };
  F(db, "rule_component", { ...c, component_id: "X-1", is_calendar_anchor: 1 });
  rejects(() => F(db, "rule_component", { ...c, component_id: "X-2", is_calendar_anchor: null }), "DB-F-12");
  rejects(() => F(db, "rule_component", { ...c, component_id: "X-3", evidence_category: null }), "NOT NULL constraint failed: rule_component.evidence_category");
});

test("DB-F-13：异文与注释的必需引用", () => {
  const db = fdb();
  const v = { ...B("text_variant") };
  rejects(() => F(db, "text_variant", { ...v, variant_id: "X-TV", passage_a: null, passage_b: null }), "DB-F-13");
  rejects(() => F(db, "annotation", { ...B("annotation"), annotation_id: "X-AN", passage_id: null }), "NOT NULL constraint failed: annotation.passage_id");
});

test("DB-F-14：争议至少两个主张（Q-F-14）", () => {
  const db = fdb();
  const d = String(B("dispute")["dispute_id"]);
  assert.deepEqual(releaseChecks["Q-F-14"](db).map((r) => r["dispute_id"]), [d], "只有 1 个主张时返回该争议");
  F(db, "dispute_claim", { dispute_id: d, claim: "乙", evidence_id: String(B("evidence")["evidence_id"]) });
  assert.deepEqual(releaseChecks["Q-F-14"](db), []);
});

test("DB-F-15：阻断变更须有用户裁决引用", () => {
  const db = fdb();
  rejects(() => F(db, "blocker_change", { ...B("blocker_change"), change_id: "X-BC", previous_status: "现行", new_status: "已解除", user_ruling_ref: null, sequence_no: 2 }),
    "NOT NULL constraint failed: blocker_change.user_ruling_ref");
});

test("DB-F-16：状态历史字段与取值配对", () => {
  const db = fdb();
  const h = { ...B("evidence_status_history"), target_id: "X-EV" };
  F(db, "evidence_status_history", { ...h, sequence_no: 2 });
  rejects(() => F(db, "evidence_status_history", { ...h, target_id: "X-EV2", new_value: "CROSS_CHECKED", sequence_no: 3 }), "DB-F-16");
});

test("DB-F-17：当前值视图取最大序号（seq 3 = A、seq 7 = B → B）", () => {
  const db = fdb();
  const h = { ...B("evidence_status_history"), target_id: "X-EV", field: "evidence_status" };
  F(db, "evidence_status_history", { ...h, previous_value: null, new_value: "UNVERIFIED", sequence_no: 3 });
  F(db, "evidence_status_history", { ...h, previous_value: "UNVERIFIED", new_value: "CROSS_CHECKED", sequence_no: 7 });
  const v = db.prepare("SELECT value FROM formal.v_evidence_status_current WHERE target_id = 'X-EV' AND field = 'evidence_status'").all() as { value: string }[];
  assert.deepEqual(v.map((x) => x.value), ["CROSS_CHECKED"]);
});

test("DB-F-18：治理索引视图——七张权威表各 1 行，共 7 行且可回连（Q-F-18）", () => {
  const db = fdb();
  const rows = db.prepare("SELECT source_table, source_id FROM formal.v_governance_record").all() as { source_table: string; source_id: string }[];
  assert.equal(rows.length, 7);
  assert.equal(new Set(rows.map((r) => r.source_table)).size, 7);
  assert.deepEqual(releaseChecks["Q-F-18"](db), []);
  const back: Record<string, string> = { admission_record: "admission_id", approval_record: "approval_id", review_record: "review_id", blocker_change: "change_id", dispute: "dispute_id" };
  for (const r of rows) if (back[r.source_table]) assert.ok(db.prepare(`SELECT 1 FROM formal.${r.source_table} WHERE ${back[r.source_table]} = ?`).get(r.source_id), `${r.source_table} 回连`);
});

test("DB-F-19：古籍原文不归一化，FTS 三字检索命中", () => {
  const db = fdb();
  const text = "峯豈之山"; // U+5CEF 与兼容字 U+F900
  F(db, "passage", { ...B("passage"), passage_id: "X-P", text });
  const got = (db.prepare("SELECT text FROM formal.passage WHERE passage_id = 'X-P'").get() as { text: string }).text;
  assert.deepEqual([...got].map((c) => c.codePointAt(0)), [...text].map((c) => c.codePointAt(0)));
  const hit = db.prepare("SELECT rowid FROM formal.passage_fts WHERE passage_fts MATCH ?").all("峯豈之");
  assert.equal(hit.length, 1);
});

test("DB-F-20：正式状态历史的对象类型（保留 RuleVariant，拒 Rule）", () => {
  const db = fdb();
  let seq = 2;
  for (const t of ["Source", "Edition", "RuleVariant"]) F(db, "formal_status_history", { target_type: t, target_id: `X-${t}`, previous_value: null, new_value: "NON_FORMAL", data_release: R[0]!, sequence_no: seq++ });
  rejects(() => F(db, "formal_status_history", { target_type: "Rule", target_id: "X-R", previous_value: null, new_value: "NON_FORMAL", data_release: R[0]!, sequence_no: seq }), "DB-F-20");
});

test("DB-F-21：审查记录的撤销触发字段", () => {
  const db = fdb();
  const r = { ...B("review_record"), role: "revocation_trigger" };
  F(db, "review_record", { ...r, review_id: "X-1", trigger_type: "证据失效", source_event: "e", disposition: "d" });
  rejects(() => F(db, "review_record", { ...r, review_id: "X-2", trigger_type: null }), "DB-F-21");
});

test("DB-F-22：参数—变体映射 (a) 外键 (b) 唯一", () => {
  const db = fdb();
  const m = { ...B("param_variant_map") };
  rejects(() => F(db, "param_variant_map", { ...m, param_value: "x", rule_variant_id: "X-NONE" }), "FOREIGN KEY constraint failed");
  rejects(() => F(db, "param_variant_map", { ...m, rule_variant_id: RV2() }), "DB-F-22b");
});

test("DB-F-23：阻断—步骤映射 (a) 外键 (b) 枚举", () => {
  const db = fdb();
  F(db, "blocker", { ...B("blocker"), block_id: "BLK-7" });
  F(db, "step_code", { step_code: "BZ-03", module: "BAZI", ordinal: 3, name: "均时差" });
  const m = { block_id: "BLK-7", step_code: "BZ-03", effect: "BLOCKED-FORMAL", condition_note: null, basis_ref: "§9.4", data_release: R[0]! };
  F(db, "blocker_step_map", m);
  rejects(() => F(db, "blocker_step_map", { ...m, step_code: "BZ-99" }), "FOREIGN KEY constraint failed");
  rejects(() => F(db, "blocker_step_map", { ...m, step_code: "LY-01", effect: "X" }), "DB-E-blocker_step_map.effect");
});

test("DB-F-24：RuleVariant 正式状态与批准一致（Q-F-24a/b/c/d、d′）", () => {
  // 正向：release 1 approve + FORMAL；release 2 revoke + NON_FORMAL
  {
    const db = fdb(); addRelease(db, 1);
    const fs = (seq: number, prev: string | null, next: string, rel: string, id = RV1()) =>
      F(db, "formal_status_history", { target_type: "RuleVariant", target_id: id, previous_value: prev, new_value: next, data_release: rel, sequence_no: seq });
    fs(2, null, "FORMAL", R[0]!);
    approval(db, apr({ approval_id: "X-REV", sequence_no: 2, decision: "revoke", data_release: R[1]! }), { revokeReason: true });
    fs(3, "FORMAL", "NON_FORMAL", R[1]!);
    for (const k of ["Q-F-24a", "Q-F-24b", "Q-F-24c", "Q-F-24d"] as const) assert.deepEqual(releaseChecks[k](db), [], `正向 ${k}`);
  }
  // (a) → FORMAL 而无现行 approve
  {
    const db = fdb();
    F(db, "formal_status_history", { target_type: "RuleVariant", target_id: RV2(), previous_value: null, new_value: "FORMAL", data_release: R[0]!, sequence_no: 2 });
    assert.equal(releaseChecks["Q-F-24a"](db).length, 1);
  }
  // (b) approve 哈希与变体不符仍 → FORMAL
  {
    const db = fdb();
    approval(db, apr({ approval_id: "X-B", sequence_no: 2, target_id: RV2(), target_content_hash: "not-the-hash" }));
    F(db, "formal_status_history", { target_type: "RuleVariant", target_id: RV2(), previous_value: null, new_value: "FORMAL", data_release: R[0]!, sequence_no: 2 });
    assert.equal(releaseChecks["Q-F-24b"](db).length, 1);
  }
  // (c) revoke 生效而仍为 FORMAL
  {
    const db = fdb(); addRelease(db, 1);
    F(db, "formal_status_history", { target_type: "RuleVariant", target_id: RV1(), previous_value: null, new_value: "FORMAL", data_release: R[0]!, sequence_no: 2 });
    approval(db, apr({ approval_id: "X-REV", sequence_no: 2, decision: "revoke", data_release: R[1]! }), { revokeReason: true });
    assert.equal(releaseChecks["Q-F-24c"](db).length, 1);
  }
  // (d) 支持性证据失效而变体未降级；(d′) 同版本追加 V → NON_FORMAL 则 0 行，且 Q-F-24c 不误报
  for (const fixD of [false, true]) {
    const db = fdb(); addRelease(db, 1);
    const ev = String(B("evidence")["evidence_id"]);
    F(db, "formal_status_history", { target_type: "RuleVariant", target_id: RV1(), previous_value: null, new_value: "FORMAL", data_release: R[0]!, sequence_no: 2 });
    F(db, "formal_status_history", { target_type: "Evidence", target_id: ev, previous_value: "FORMAL", new_value: "NON_FORMAL", data_release: R[1]!, sequence_no: 3 });
    if (fixD) F(db, "formal_status_history", { target_type: "RuleVariant", target_id: RV1(), previous_value: "FORMAL", new_value: "NON_FORMAL", data_release: R[1]!, sequence_no: 4 });
    const d = releaseChecks["Q-F-24d"](db);
    if (!fixD) { assert.equal(d.length, 1); assert.equal(d[0]!["data_release"], R[1]); assert.equal(d[0]!["evidence_id"], ev); }
    else { assert.equal(d.length, 0, "(d′) 0 行"); assert.equal(releaseChecks["Q-F-24c"](db).length, 0, "(d′) Q-F-24c 不误报"); }
  }
});

test("DB-F-25：成对阻断同步解除（Q-F-25）", () => {
  const mk = (pairA: string, pairB: string, sameRelease: boolean, onlyA: boolean) => {
    const db = fdb(); addRelease(db, 1); addRelease(db, 2);
    for (const b of [pairA, pairB]) F(db, "blocker", { ...B("blocker"), block_id: b });
    let seq = 2;
    for (const b of [pairA, pairB]) F(db, "blocker_change", { change_id: `X-${b}-0`, block_id: b, previous_status: null, new_status: "现行", user_ruling_ref: "x", data_release: R[0]!, sequence_no: seq++ });
    F(db, "blocker_change", { change_id: `X-${pairA}-1`, block_id: pairA, previous_status: "现行", new_status: "已解除", user_ruling_ref: "x", data_release: R[1]!, sequence_no: seq++ });
    if (!onlyA) F(db, "blocker_change", { change_id: `X-${pairB}-1`, block_id: pairB, previous_status: "现行", new_status: "已解除", user_ruling_ref: "x", data_release: sameRelease ? R[1]! : R[2]!, sequence_no: seq++ });
    return releaseChecks["Q-F-25"](db);
  };
  assert.deepEqual(mk("B4", "BLK-6", true, false), [], "正向：同版本各一条解除");
  assert.ok(mk("B4", "BLK-6", true, true).some((r) => r["block_id"] === "B4"), "(a) 只解除 B4");
  assert.ok(mk("B4", "BLK-6", false, false).length > 0, "(b) BLK-6 晚一个版本");
  assert.ok(mk("B1", "BLK-7", true, true).some((r) => r["block_id"] === "B1"), "B1 / BLK-7 同理");
});

// ---------------------------------------------------------------- DB-Q（§3.3 七张表）
interface HistCase { table: string; schema: string; row: (seq: number, prev: string | null, next: string, rel?: string) => Row; a: string; b: string; release: boolean }
const HIST: HistCase[] = [
  { table: "evidence_status_history", schema: "formal", a: "UNVERIFIED", b: "CROSS_CHECKED", release: true,
    row: (s, p, n, rel) => ({ target_type: "Evidence", target_id: "X-K", field: "evidence_status", previous_value: p, new_value: n, data_release: rel ?? R[0]!, sequence_no: s }) },
  { table: "admission_record", schema: "formal", a: "FORMAL_ALLOWED", b: "DEFERRED", release: true,
    row: (s, p, n, rel) => ({ admission_id: `X-ADM-${s}`, component_id: RC1(), purpose: "text", previous_status: p, new_status: n, conditions: null, basis_ref: "x", data_release: rel ?? R[0]!, sequence_no: s, decided_by: "USER" }) },
  { table: "formal_status_history", schema: "formal", a: "FORMAL", b: "NON_FORMAL", release: true,
    row: (s, p, n, rel) => ({ target_type: "Source", target_id: "X-K", previous_value: p, new_value: n, data_release: rel ?? R[0]!, sequence_no: s }) },
  { table: "blocker_change", schema: "formal", a: "现行", b: "已解除", release: true,
    row: (s, p, n, rel) => ({ change_id: `X-BC-${s}`, block_id: String(B("blocker")["block_id"]), previous_status: p, new_status: n, user_ruling_ref: "x", data_release: rel ?? R[0]!, sequence_no: s }) },
  { table: "branch_status_history", schema: "main", a: "active", b: "abandoned", release: false,
    row: (s, p, n) => ({ branch_id: "X-BR", previous_status: p, new_status: n, data_release: null, note: "n", sequence_no: s }) },
];
function histDb(h: HistCase): DatabaseSync {
  const db = fdb(); addRelease(db, 1);
  if (h.table === "blocker_change") db.exec("SELECT 1"); // 基准已有 seq 1 的现行记录（同键），下面改用新阻断
  if (h.schema === "main") db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR', 'b', NULL, ?, NULL, 'OWNER', NULL)").run(R[0]!);
  return db;
}
const insH = (db: DatabaseSync, h: HistCase, r: Row) => ins(db, h.schema, h.table, r);

for (const h of HIST) test(`DB-Q-01/02/03/04/09${h.release ? "/05" : ""}：${h.table}`, () => {
  const db = histDb(h);
  const key = h.table === "blocker_change" ? (r: Row) => ({ ...r, block_id: "X-BLK" }) : (r: Row) => r;
  if (h.table === "blocker_change") F(db, "blocker", { ...B("blocker"), block_id: "X-BLK" });
  // DB-Q-01 首条 previous 须为空
  inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(10, h.a, h.b))), "DB-Q-01"));
  insH(db, h, key(h.row(10, null, h.a)));
  // DB-Q-02 previous 须等于上一条 new
  inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(11, h.b, h.a))), "DB-Q-02"));
  // DB-Q-09 无转换行
  inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(11, h.a, h.a))), "DB-Q-09"));
  insH(db, h, key(h.row(11, h.a, h.b, h.release ? R[1] : undefined)));
  // DB-Q-03 重复序号、DB-Q-04 小于最大
  inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(11, h.b, h.a))), "DB-Q-03"));
  inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(9, h.b, h.a))), "DB-Q-04"));
  // DB-Q-05 同键版本序倒退
  if (h.release) inSavepoint(db, () => rejects(() => insH(db, h, key(h.row(12, h.b, h.a, R[0]))), "DB-Q-05"));
  // DB-Q-06 已存历史行 UPDATE / DELETE
  rejects(() => db.exec(`UPDATE ${h.schema}.${h.table} SET sequence_no = sequence_no`), `[DB-I-${h.table}]`);
  rejects(() => db.exec(`DELETE FROM ${h.schema}.${h.table}`), `[DB-I-${h.table}]`);
});

test("DB-Q-03/04/05：乙类 approval_record", () => {
  const db = fdb(); addRelease(db, 1);
  approval(db, apr({ approval_id: "X-10", sequence_no: 10, data_release: R[1]! }));
  rejects(() => approval(db, apr({ approval_id: "X-10b", sequence_no: 10 })), "DB-Q-03");
  rejects(() => approval(db, apr({ approval_id: "X-9", sequence_no: 9 })), "DB-Q-04");
  rejects(() => approval(db, apr({ approval_id: "X-11", sequence_no: 11, data_release: R[0]! })), "DB-Q-05");
});

test("DB-Q-07：supersedes_approval_id 须指向同一 target 的较早记录", () => {
  const db = fdb();
  const first = String(B("approval_record")["approval_id"]);
  approval(db, apr({ approval_id: "X-2", sequence_no: 2, supersedes_approval_id: first }));
  approval(db, apr({ approval_id: "X-OTHER", sequence_no: 3, target_id: RV2(), target_content_hash: String(B("rule_variant", 1)["content_hash"]) }));
  rejects(() => approval(db, apr({ approval_id: "X-4", sequence_no: 4, supersedes_approval_id: "X-OTHER" })), "DB-Q-07");
});

test("DB-Q-08 / DB-Q-03/04/05：丙类 component_default 引用现行 approve", () => {
  const db = fdb(); addRelease(db, 1); addRelease(db, 2);
  const d = { ...B("component_default") };
  // 引用 revoke 记录
  approval(db, apr({ approval_id: "X-REV", sequence_no: 2, decision: "revoke", data_release: R[1]! }), { revokeReason: true });
  rejects(() => F(db, "component_default", { ...d, approval_ref: "X-REV", data_release: R[1]!, sequence_no: 2 }), "DB-Q-08");
  // 现行 approve（重新批准）后可引用；序号与版本规则
  approval(db, apr({ approval_id: "X-APP", sequence_no: 3, data_release: R[1]! }));
  rejects(() => F(db, "component_default", { ...d, approval_ref: "X-APP", data_release: R[1]!, sequence_no: 1 }), "DB-Q-03");
  F(db, "component_default", { ...d, approval_ref: "X-APP", data_release: R[1]!, sequence_no: 5 });
  rejects(() => F(db, "component_default", { ...d, approval_ref: "X-APP", data_release: R[2]!, sequence_no: 4 }), "DB-Q-04");
  rejects(() => F(db, "component_default", { ...d, approval_ref: "X-APP", data_release: R[0]!, sequence_no: 6 }), /DB-Q-05|DB-F-11b/);
  // 引用他子项变体的批准
  F(db, "rule_component", { ...B("rule_component"), component_id: "X-RC2" });
  F(db, "rule_variant", { ...B("rule_variant", 0), rule_variant_id: "X-D", component_id: "X-RC2", version_no: 1 });
  approval(db, apr({ approval_id: "X-APD", sequence_no: 4, target_id: "X-D", data_release: R[1]! }));
  rejects(() => F(db, "component_default", { ...d, approval_ref: "X-APD", data_release: R[2]!, sequence_no: 7 }), "DB-Q-08");
});

// ---------------------------------------------------------------- DB-J（库层结构化 JSON）
test("DB-J-01/02/03/04/05/07/08：库层 JSON 结构校验", () => {
  const db = fdb(); addRelease(db, 1);
  const s = { ...B("variant_supersedes") };
  F(db, "rule_variant", { ...B("rule_variant", 0), rule_variant_id: "X-C", version_no: 3 });
  const seg = (o: Record<string, unknown>) => JSON.stringify({ v: 1, kind: "segment", module: "BAZI", ...o });
  const put = (scope: string) => inSavepoint(db, () => F(db, "variant_supersedes", { ...s, new_variant_id: "X-C", applicable_scope: scope }));
  put("{\"kind\":\"all\",\"v\":1}");
  rejects(() => put("not json"), "DB-J-01");
  rejects(() => put("[1]"), "DB-J-05");
  rejects(() => put("{\"kind\":\"all\"}"), "DB-J-03");
  rejects(() => put("{\"kind\":\"all\",\"v\":\"1\"}"), "DB-J-03");
  rejects(() => put("{\"kind\":\"range\",\"v\":1}"), "DB-J-02");
  rejects(() => put("{\"kind\":\"all\",\"v\":1,\"x\":1}"), "DB-J-04");
  put(seg({ from: "1900-01-01", to: "2100-12-31" }));
  rejects(() => put(seg({ from: "2100-12-31", to: "1900-01-01" })), "DB-J-07");
  rejects(() => put(JSON.stringify({ v: 1, kind: "segment" })), "DB-J-07");
  // DB-J-02：F37 写 segment 成功；F23、F27 写 segment 拒
  approval(db, apr({ approval_id: "X-SEG", sequence_no: 2, scope: seg({}) }));
  rejects(() => F(db, "component_default", { ...B("component_default"), data_release: R[1]!, sequence_no: 2, applicable_scope: seg({}) }), "DB-J-02");
  rejects(() => F(db, "param_variant_map", { ...B("param_variant_map"), param_value: "x", applicable_scope: seg({}) }), "DB-J-02");
  // DB-J-04：条件 op 白名单与未知键
  const adm = (cond: string, seq: number) => F(db, "admission_record", { ...B("admission_record"), admission_id: `X-A${seq}`, purpose: "text", new_status: "CONDITIONAL", previous_status: null, conditions: cond, sequence_no: seq });
  adm("{\"all\":[{\"op\":\"param_selected\",\"param\":\"CFG-01\"}],\"v\":1}", 5);
  rejects(() => adm("{\"all\":[{\"op\":\"expr\",\"param\":\"CFG-01\"}],\"v\":1}", 6), "DB-J-04");
  rejects(() => adm("{\"all\":[{\"op\":\"param_selected\",\"param\":\"CFG-01\",\"x\":1}],\"v\":1}", 6), "DB-J-04");
  // DB-J-08：同一旧变体两行 segment 范围重叠（分叉合法）
  F(db, "variant_supersedes", { ...s, new_variant_id: "X-C", applicable_scope: seg({ from: "1900-01-01", to: "2000-12-31" }) });
  F(db, "rule_variant", { ...B("rule_variant", 0), rule_variant_id: "X-E", version_no: 4 });
  F(db, "variant_supersedes", { ...s, new_variant_id: "X-E", applicable_scope: seg({ from: "1950-01-01", to: "2100-12-31" }) });
});
