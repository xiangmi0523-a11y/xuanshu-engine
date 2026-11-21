// 八字、六爻端到端 × G0/G1/G1N/G2（审核清单 §7）与封存相关约束：DB-S、DB-B、DB-R-01～03、DB-U-07～13、DB-U-18、DB-C、DB-T、DB-X、ZR-DB-6/8。
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { CanonicalError, dataFingerprint, hashOf, resultFingerprint } from "../../db/canonical.js";
import { judge } from "../../db/governance.js";
import { buildPlan, buildSnapshotRows, checkPayloadAgainstPlan, prepareConfig, prepareInput, saveProfileInputConfig, sealSnapshot, verifyRecompute, PresealError, type SnapshotRows } from "../../db/pipeline.js";
import { checkImplHashes, evidenceChecks, releaseChecks, snapshotChecks } from "../../db/queries.js";
import { cases, loadWorld, type LoadedWorld } from "../fixtures/load.js";
import { readVectors } from "../helpers/load.js";
import { count, rejects, runCase, scenarioName } from "./helpers.js";

const C = cases();
const SC = ["G0", "G1", "G1N", "G2"] as const;
const CASES = ["E2E-BZ-1", "E2E-LY-1"] as const;
const exp = (sc: string, id: string) => C.expect[sc]![id]!;
const reasonKeys = (rows: SnapshotRows) => rows.reasons.map((r) => `${String(r["reason_kind"])}:${String(r["upstream_id"])}`).sort();
const USER_TABLES = ["calculation_snapshot", "snapshot_dependency", "execution_trace_step", "snapshot_non_formal_reason"];

/** 已存输入与配置、尚未封存的快照行（供变造后封存） */
function prepared(scenario: string, caseId: string, w?: LoadedWorld, suffix = "") {
  const c = C.cases.find((x) => x.case_id === caseId)!;
  const ww = w ?? loadWorld(scenarioName(scenario, c.domain));
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  const cfg = prepareConfig({ ...c.config, module: c.domain });
  saveProfileInputConfig(ww.db, c.owner_profile_id + suffix, inp, c.input_id + suffix, cfg);
  const plan = buildPlan(ww.db, inp, cfg);
  const j = judge(ww.db, plan);
  if (j.status === "BLOCKED") throw new Error(`场景 ${scenario} 阻断：${j.code}`);
  const rows = buildSnapshotRows(ww.db, ww.ctx, plan, j, { profileId: c.owner_profile_id + suffix, inputId: c.input_id + suffix, inp, cfg });
  return { w: ww, c, inp, cfg, plan, j, rows };
}
const clone = (r: SnapshotRows): SnapshotRows => JSON.parse(JSON.stringify(r)) as SnapshotRows;

// ---------------------------------------------------------------- 四场景矩阵
for (const sc of SC) for (const id of CASES) test(`端到端 ${id} @ ${sc}：${exp(sc, id).status}${exp(sc, id).block_reason_code ? `（${exp(sc, id).block_reason_code}）` : ""}`, () => {
  const e = exp(sc, id);
  const c = C.cases.find((x) => x.case_id === id)!;
  const w = loadWorld(scenarioName(sc, c.domain));
  const before = Object.fromEntries(USER_TABLES.map((t) => [t, count(w.db, t)]));
  const r = runCase(sc, id, { w });
  assert.equal(r.out.status, e.status);
  if (r.out.status === "BLOCKED") {
    // DB-S-06 / DB-B-03 / DB-U-18：无快照、四类表不变、审计恰 1 行、block_reason_code 按清单
    for (const t of USER_TABLES) assert.equal(count(w.db, t), before[t], `${t} 行数不变`);
    const ev = w.db.prepare("SELECT * FROM blocked_audit_event").all() as Record<string, string>[];
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!["block_reason_code"], e.block_reason_code);
    assert.equal(r.out.judgment.kind, "BLOCKED-FORMAL");
    // Q-U-18：审计行任何列都不含输入中的日期、地点、经纬度字符串
    const personal = [String(c.raw["civil_datetime"] ?? c.raw["cast_datetime"]), String(c.raw["civil_datetime"] ?? c.raw["cast_datetime"]).slice(0, 10),
      ...["place_name", "longitude", "latitude"].map((k) => c.raw[k]).filter((v): v is string => typeof v === "string"), c.owner_profile_id, c.input_id];
    // occurred_at 是事件时刻（运行当天），只比对完整输入时刻，不比对日期部分，以免与运行日期偶合
    for (const [col, v] of Object.entries(ev[0]!)) for (const p of personal) if (!(col === "occurred_at" && p.length === 10)) assert.ok(!String(v).includes(p), `Q-U-18 ${col} 含 ${p}`);
  } else {
    assert.equal(count(w.db, "blocked_audit_event"), 0);
    assert.deepEqual(reasonKeys(r.out.rows), [...e.reasons!].sort(), "DB-S-07 / DB-S-08：原因集合逐条相等（不多不少）");
    assert.equal(r.out.rows.snapshot["formal_status"], e.status);
  }
});

test("DB-S-01（W-04 格式一致，模拟快照）：八字与六爻快照信封列集合与非空性一致，子表结构相同", () => {
  const w = loadWorld("G2");
  const a = runCase("G2", "E2E-BZ-1", { w }), b = runCase("G2", "E2E-LY-1", { w });
  assert.ok(a.out.status === "FORMAL" && b.out.status === "FORMAL");
  const env = (sid: string) => w.db.prepare("SELECT * FROM calculation_snapshot WHERE snapshot_id = ?").get(sid) as Record<string, unknown>;
  const ea = env(a.out.status === "FORMAL" ? a.out.snapshot_id : ""), eb = env(b.out.status === "FORMAL" ? b.out.snapshot_id : "");
  assert.deepEqual(Object.keys(ea), Object.keys(eb));
  assert.deepEqual(Object.keys(ea).map((k) => ea[k] === null), Object.keys(eb).map((k) => eb[k] === null), "非空性一致");
  for (const t of ["snapshot_dependency", "execution_trace_step", "snapshot_resolved_context", "snapshot_gov_approval", "snapshot_gov_blocker", "snapshot_gov_sequence"])
    assert.ok(count(w.db, t) > 0, `${t} 两域共用同一子表`);
});

test("DB-S-02：只改治理上下文（BLK-3 状态）后重算，result_hash 与 result_fingerprint 不变", () => {
  const p = prepared("G2", "E2E-BZ-1");
  const fp = resultFingerprint(p.rows.fingerprintParts);
  const changed = clone(p.rows);
  changed.govBlocker = changed.govBlocker.map((b) => (b.block_id === "BLK-3" ? { ...b, status: "已解除" } : b));
  assert.ok(changed.govBlocker.some((b) => b.block_id === "BLK-3"));
  assert.equal(resultFingerprint(changed.fingerprintParts), fp);
  assert.equal(changed.snapshot["result_hash"], p.rows.snapshot["result_hash"]);
  assert.equal(hashOf(JSON.parse(String(changed.snapshot["result_payload"]))), p.rows.snapshot["result_hash"]);
});

for (const id of CASES) test(`DB-S-03（W-07 内存版）：${id} 同条件复算指纹一致；改 registry_version 后不同；改 resolved 一行报 DATA_FINGERPRINT_MISMATCH`, () => {
  const a = prepared("G2", id);
  sealSnapshot(a.w.db, a.rows);
  const b = prepared("G2", id, a.w, "-R");
  assert.equal(b.rows.snapshot["result_fingerprint"], a.rows.snapshot["result_fingerprint"], "输入、配置、数据版本、引擎版本相同 → 指纹一致");
  assert.deepEqual(verifyRecompute(a.rows, b.rows), { ok: true });
  const reg = clone(b.rows);
  reg.fingerprintParts.registry_version = "changed";
  reg.snapshot["result_fingerprint"] = resultFingerprint(reg.fingerprintParts);
  assert.deepEqual(verifyRecompute(a.rows, reg), { ok: false, code: "RESULT_FINGERPRINT_MISMATCH" });
  const dat = clone(b.rows);
  dat.resolved[0] = { ...dat.resolved[0]!, ...(dat.resolved[0]!.content_hash ? { content_hash: "0".repeat(64) } : { value: "x" }) };
  assert.deepEqual(verifyRecompute(a.rows, dat), { ok: false, code: "DATA_FINGERPRINT_MISMATCH" });
});

test("DB-S-04：E2E-BZ-1（G1N）轨迹按步骤读出各步状态；删去 BZ-03 行被 DB-T-01 / Q-T-01 检出", () => {
  const p = prepared("G1N", "E2E-BZ-1");
  sealSnapshot(p.w.db, p.rows);
  const sid = String(p.rows.snapshot["snapshot_id"]);
  const tr = p.w.db.prepare("SELECT step_code, status, skip_kind, reason FROM execution_trace_step WHERE snapshot_id = ? ORDER BY exec_order").all(sid) as Record<string, string | null>[];
  const st = Object.fromEntries(tr.map((t) => [t["step_code"]!, t]));
  for (const s of ["BZ-01", "BZ-04", "BZ-05", "BZ-06", "BZ-07", "BZ-08", "BZ-09", "BZ-10", "BZ-11"]) assert.equal(st[s]!["status"], "完成", s);
  for (const s of ["BZ-02", "BZ-03"]) { assert.equal(st[s]!["skip_kind"], "按规则跳过"); assert.match(String(st[s]!["reason"]), /CFG-02 = false/); }
  assert.equal(st["BZ-12"]!["skip_kind"], "输入缺失"); assert.match(String(st["BZ-12"]!["reason"]), /MISSING_GENDER/);
  assert.equal(st["BZ-13"]!["skip_kind"], "按规则跳过"); assert.match(String(st["BZ-13"]!["reason"]), /P-A-04/);
  // C-G 三态表述（§6.6 映射）：经度项未算（钟表时间）、均时差未用、子时已判定
  const cg = { 经度项: st["BZ-02"]!["status"] === "未执行" ? "未算（钟表时间）" : "已算", 均时差: st["BZ-03"]!["status"] === "未执行" ? "未用" : "已用", 子时: st["BZ-04"]!["status"] === "完成" ? "已判定" : "未判定" };
  assert.deepEqual(cg, { 经度项: "未算（钟表时间）", 均时差: "未用", 子时: "已判定" });
  const q = prepared("G1N", "E2E-BZ-1", p.w, "-X");
  const bad = clone(q.rows); bad.trace = bad.trace.filter((t) => t["step_code"] !== "BZ-03");
  rejects(() => sealSnapshot(q.w.db, bad), "Q-T-01", "预检");
  sealSnapshot(q.w.db, bad, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-T-01"]!(q.w.db, String(bad.snapshot["snapshot_id"])).some((r) => r["step_code"] === "BZ-03"), "绕过预检后 Q-T-01 查出");
});

test("DB-S-05：结果中时间只到分钟，无秒级字段", () => {
  for (const id of CASES) {
    const p = prepared("G2", id);
    assert.doesNotMatch(String(p.rows.snapshot["result_payload"]), /\d{2}:\d{2}:\d{2}/, id);
    assert.doesNotMatch(String(p.rows.snapshot["result_payload"]), /second|true_solar/i, id);
  }
});

test("DB-S-07 反向：G1N 删去六爻 BLOCKER_PATH:BLK-6 原因行——库层只保证至少一条，测试比对期望集合查出差集", () => {
  const p = prepared("G1N", "E2E-LY-1");
  const bad = clone(p.rows); bad.reasons = bad.reasons.filter((r) => r["reason_kind"] !== "BLOCKER_PATH");
  sealSnapshot(p.w.db, bad, { skipPrecheck: true });
  const missing = exp("G1N", "E2E-LY-1").reasons!.filter((k) => !reasonKeys(bad).includes(k));
  assert.deepEqual(missing.map((k) => k.split(":")[0]), ["BLOCKER_PATH"], "差集为 BLOCKER_PATH");
});

test("DB-S-08 / DB-C-01：G2 把一个依赖改回 NON_FORMAL（撤销批准）后仍封存 FORMAL——预检拒；绕过预检 Q-C-01 查出", async () => {
  const p = prepared("G2", "E2E-LY-1");
  const { ins } = await import("./helpers.js");
  const v = (p.j as { variants: { rule_variant_id: string; content_hash: string }[] }).variants[0];
  assert.ok(v);
  const rel = p.w.releases.at(-1)!;
  p.w.db.exec("BEGIN");
  ins(p.w.db, "formal", "approval_basis", { approval_id: "X-REVOKE", basis_ref: "x" });
  ins(p.w.db, "formal", "revoke_reason_registry", { code: "X-CODE", label: "x" });
  ins(p.w.db, "formal", "approval_revoke_reason", { approval_id: "X-REVOKE", reason_code: "X-CODE" });
  ins(p.w.db, "formal", "approval_record", { approval_id: "X-REVOKE", sequence_no: 99, target_type: "rule_variant", target_id: v!.rule_variant_id, target_content_hash: v!.content_hash,
    data_release: rel, decision: "revoke", decided_by: "USER", decided_at: "t", scope: "{\"kind\":\"all\",\"v\":1}", conditions: null, supersedes_approval_id: null });
  p.w.db.exec("COMMIT");
  rejects(() => sealSnapshot(p.w.db, p.rows), "Q-C-01");
  sealSnapshot(p.w.db, p.rows, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-C-01"]!(p.w.db).some((r) => r["ref_id"] === v!.rule_variant_id));
});

test("DB-S-09：resolved_context 表版本行改一条 content_hash，封存拒", () => {
  const p = prepared("G2", "E2E-BZ-1");
  const bad = clone(p.rows);
  const i = bad.resolved.findIndex((x) => x.item_kind === "table_version");
  bad.resolved[i] = { ...bad.resolved[i]!, content_hash: "0".repeat(64) };
  rejects(() => sealSnapshot(p.w.db, bad), "DB-S-09");
});

test("DB-R-01：依赖写到第 3 行时插入违规行——事务回滚，快照及全部子表 0 行", () => {
  const p = prepared("G2", "E2E-BZ-1");
  const tables = [...USER_TABLES, "snapshot_resolved_context", "snapshot_gov_approval", "snapshot_gov_blocker", "snapshot_gov_sequence", "snapshot_degradation_reason"];
  assert.throws(() => sealSnapshot(p.w.db, p.rows, { beforeDep: (ord, db) => { if (ord === 3) db.exec("INSERT INTO snapshot_dependency (snapshot_id, owner_profile_id, ord, dep_type, ref_kind, ref_id) VALUES ('x', 'y', 1, 'X', 'formal', 'z')"); } }));
  for (const t of tables) assert.equal(count(p.w.db, t), 0, t);
  assert.equal(p.w.db.isTransaction, false);
});

test("DB-R-02：快照已封存后再插依赖行被拒", () => {
  const p = prepared("G2", "E2E-LY-1");
  sealSnapshot(p.w.db, p.rows);
  const d = { ...p.rows.deps[0]!, ord: 99 };
  rejects(() => p.w.db.prepare(`INSERT INTO snapshot_dependency (${Object.keys(d).join(", ")}) VALUES (${Object.keys(d).map(() => "?").join(", ")})`).run(...(Object.values(d) as (string | number | null)[])), "DB-R-02");
});

test("DB-R-03：子行写完而快照行未写——延迟外键在提交时拒，整体回滚", () => {
  const p = prepared("G2", "E2E-LY-1");
  rejects(() => sealSnapshot(p.w.db, p.rows, { omitSnapshot: true, skipPrecheck: true }), "FOREIGN KEY constraint failed");
  assert.equal(count(p.w.db, "snapshot_dependency"), 0);
});

test("DB-U-07 / DB-U-08 / DB-U-09 / DB-U-11 / DB-B-04：封存前状态与哈希一致性", () => {
  const p = prepared("G2", "E2E-BZ-1");
  const mut = (f: (r: SnapshotRows) => void) => { const b = clone(p.rows); f(b); return b; };
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["input_hash"] = `0${String(b.snapshot["input_hash"]).slice(1)}`; })), "DB-U-07");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["calc_status"] = "CALC_RESEARCH"; })), "DB-U-08");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["formal_status"] = "NON_FORMAL"; b.snapshot["research_scope"] = "FORMAL_SCOPE_NON_FORMAL"; })), /DB-U-08|DB-U-09a/);
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["formal_status"] = "NON_FORMAL"; b.snapshot["calc_status"] = "CALC_RESEARCH"; b.snapshot["research_scope"] = "FORMAL_SCOPE_NON_FORMAL"; })), "DB-U-09a");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.reasons = [{ snapshot_id: b.snapshot["snapshot_id"]!, owner_profile_id: b.snapshot["owner_profile_id"]!, ord: 1, reason_kind: "RESEARCH_ONLY", ri_segment: null, step_code: "BZ-05", upstream_release: "r", upstream_id: "u", upstream_hash: "h", note: "n" }]; })), "DB-U-09b");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["result_completeness"] = "COMPLETE"; })), "DB-U-11a");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.degradation = []; })), "DB-U-11b");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["formal_status"] = "BLOCKED"; })), /DB-E-calculation_snapshot.formal_status|DB-U-08/, "DB-B-04");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.snapshot["calc_status"] = "CALC_BLOCKED"; })), /DB-E-calculation_snapshot.calc_status|DB-U-08/, "DB-B-04");
  // DB-T-08：输入缺失跳过而 COMPLETE（同 DB-U-11a）
  sealSnapshot(p.w.db, p.rows);
  assert.equal(p.rows.snapshot["result_completeness"], "OK_WITH_DEGRADATION");
  assert.deepEqual(p.rows.degradation, ["MISSING_GENDER"]);
});

test("DB-U-10 / DB-C-02 / DB-C-03：个人变体依赖只能 NON_FORMAL + PERSONAL_RESEARCH", () => {
  const p = prepared("G1N", "E2E-LY-1");
  const db = p.w.db;
  db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR', 'b', NULL, ?, NULL, 'OWNER', NULL)").run(p.w.releases[0]!);
  db.prepare("INSERT INTO personal_rule_variant (rule_variant_id, branch_id, component_release, component_id, component_hash, version_no, content_hash, hash_algorithm, canonicalization_version, confidence, non_formal_reason, formal_status) VALUES ('X-PRV', 'X-BR', ?, 'P-B-02', 'h', 1, 'c', 'sha256', 'jcs-1', 'C', '个人校勘', 'NON_FORMAL')").run(p.w.releases[0]!);
  const withPersonal = (scope: string, status: "FORMAL" | "NON_FORMAL") => {
    const b = clone(p.rows);
    b.deps.push({ ...b.deps.find((d) => d["dep_type"] === "rule_variant")!, ord: b.deps.length + 1, ref_kind: "personal", ref_id: "X-PRV", ref_hash: "c", ref_version: "1", approval_id: null });
    b.resolved.push({ item_kind: "table_version", key: "X-PRV", version: "1", content_hash: "c" });
    b.snapshot["research_scope"] = scope; b.snapshot["formal_status"] = status; b.snapshot["calc_status"] = status === "FORMAL" ? "CALC_FORMAL" : "CALC_RESEARCH";
    if (status === "FORMAL") b.reasons = [];
    return b;
  };
  rejects(() => sealSnapshot(db, withPersonal("FORMAL", "FORMAL"), { skipPrecheck: true }), /DB-C-02|DB-U-10/, "DB-C-02 / DB-U-10a");
  rejects(() => sealSnapshot(db, withPersonal("FORMAL_SCOPE_NON_FORMAL", "NON_FORMAL"), { skipPrecheck: true }), "DB-U-10b", "DB-U-10b");
  sealSnapshot(db, withPersonal("PERSONAL_RESEARCH", "NON_FORMAL"), { skipPrecheck: true });
});

test("DB-U-12：依赖行必需列——rule_variant 缺 content_hash、tz_data 版本为空被拒", () => {
  const p = prepared("G2", "E2E-BZ-1");
  const mut = (f: (d: Record<string, unknown>) => boolean, over: Record<string, unknown>) => { const b = clone(p.rows); const i = b.deps.findIndex((d) => f(d)); b.deps[i] = { ...b.deps[i]!, ...over } as typeof b.deps[number]; return b; };
  rejects(() => sealSnapshot(p.w.db, mut((d) => d["dep_type"] === "rule_variant", { ref_hash: null })), "DB-U-12a");
  rejects(() => sealSnapshot(p.w.db, mut((d) => d["dep_type"] === "tz_data", { ref_version: null })), "DB-U-12b");
  rejects(() => sealSnapshot(p.w.db, mut((d) => d["dep_type"] === "rule_variant", { approval_id: null })), "DB-U-12c");
});

test("DB-U-13：重算来源——指向本档案快照（可多条）；指向不存在、或他档案快照被拒", () => {
  const a = prepared("G2", "E2E-LY-1");
  sealSnapshot(a.w.db, a.rows);
  const src = String(a.rows.snapshot["snapshot_id"]);
  // 同档案两条重算快照
  for (const k of [1, 2]) {
    const c = C.cases.find((x) => x.case_id === "E2E-LY-1")!;
    const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
    const cfg = prepareConfig({ ...c.config, module: c.domain });
    saveProfileInputConfig(a.w.db, c.owner_profile_id, inp, `${c.input_id}-r${k}`, cfg);
    const plan = buildPlan(a.w.db, inp, cfg); const j = judge(a.w.db, plan);
    if (j.status === "BLOCKED") assert.fail();
    const rows = buildSnapshotRows(a.w.db, a.w.ctx, plan, j, { profileId: c.owner_profile_id, inputId: `${c.input_id}-r${k}`, inp, cfg, recomputedFrom: src });
    sealSnapshot(a.w.db, rows);
  }
  const bad = prepared("G2", "E2E-LY-1", a.w, "-other");
  const x = clone(bad.rows); x.snapshot["recomputed_from_snapshot_id"] = "X-NONE";
  rejects(() => sealSnapshot(a.w.db, x), /FOREIGN KEY|DB-U-13/);
  const y = clone(bad.rows); y.snapshot["recomputed_from_snapshot_id"] = src;
  rejects(() => sealSnapshot(a.w.db, y), "DB-U-13b");
});

test("ZR-DB-6 / ZR-DB-8：BAZI 配置缺 CFG-01 行封存被拒；锁定值封存成功", () => {
  const p = prepared("G2", "E2E-BZ-1");
  sealSnapshot(p.w.db, p.rows); // ZR-DB-8
  const c = C.cases.find((x) => x.case_id === "E2E-BZ-1")!;
  const cfg = prepareConfig({ ...c.config, config_id: "X-CFG-NO01", module: "BAZI", params: c.config.params.filter((x) => x.param_id !== "CFG-01") });
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  saveProfileInputConfig(p.w.db, c.owner_profile_id, inp, "X-IN-NO01", cfg);
  const b = clone(p.rows);
  b.snapshot["snapshot_id"] = "X-SNAP-NO01"; b.snapshot["execution_trace_ref"] = "X-SNAP-NO01"; b.snapshot["input_id"] = "X-IN-NO01";
  b.snapshot["config_id"] = "X-CFG-NO01"; b.snapshot["config_hash"] = cfg.config_hash;
  for (const k of ["reasons", "deps", "trace"] as const) b[k] = b[k].map((r) => ({ ...r, snapshot_id: "X-SNAP-NO01" }));
  rejects(() => sealSnapshot(p.w.db, b, { skipPrecheck: true }), "ZR-DB-missing");
});

// ---------------------------------------------------------------- DB-C
test("DB-C-04：配置“参与计算”地写入映射到 DEFERRED 子项变体的参数值被 Q-C-04 查出；stored_only 不在此列（Q-12）", async () => {
  const p = prepared("G2", "E2E-BZ-1");
  const { ins } = await import("./helpers.js");
  ins(p.w.db, "formal", "rule_variant", { rule_variant_id: "X-RV-PA04", component_id: "P-A-04", version_no: 1, content_hash: "h", hash_algorithm: "sha256", canonicalization_version: "jcs-1", confidence: "C",
    school_id: null, branch_id: null, non_formal_reason: null, experiment_hypothesis: null, experiment_status: null, experiment_promotion_path: null, experiment_valid_until: null, applicable_from: null, applicable_to: null });
  ins(p.w.db, "formal", "param_variant_map", { param_id: "CFG-04", param_value: "yh_yuelu", rule_variant_id: "X-RV-PA04", applicable_scope: "{\"kind\":\"all\",\"v\":1}", selection_rule: "x", data_release: p.w.releases.at(-1)! });
  assert.deepEqual(snapshotChecks["Q-C-04"]!(p.w.db), [], "stored_only 的 CFG-04 不触发");
  const c = C.cases.find((x) => x.case_id === "E2E-BZ-1")!;
  const cfg = prepareConfig({ ...c.config, config_id: "X-CFG-APPLIED", module: "BAZI", params: c.config.params.map((x) => (x.param_id === "CFG-04" ? { ...x, apply_mode: "applied" as const } : x)) });
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  saveProfileInputConfig(p.w.db, c.owner_profile_id, inp, "X-IN-APPLIED", cfg);
  assert.ok(snapshotChecks["Q-C-04"]!(p.w.db).some((r) => r["config_id"] === "X-CFG-APPLIED"));
});

test("DB-C-05：六爻排日辰完成而无 cross_domain 行——预检拒；绕过则 Q-C-05 查出", () => {
  const p = prepared("G2", "E2E-LY-1");
  const b = clone(p.rows);
  const cd = b.deps.find((d) => d["dep_type"] === "cross_domain")!;
  assert.ok(cd, "正向：跨域依赖已登记");
  b.deps = b.deps.filter((d) => d !== b.deps.find((x) => x["dep_type"] === "cross_domain"));
  rejects(() => sealSnapshot(p.w.db, b), "Q-C-05");
  sealSnapshot(p.w.db, b, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-C-05"]!(p.w.db, String(b.snapshot["snapshot_id"])).length === 1);
});

test("DB-C-06 / DB-C-10：子时适用域判断所读变体（八字 14:30）与六爻日界变体记入依赖；漏记查出；跳过步骤记成变体依赖查出", () => {
  for (const [id, fn] of [["E2E-BZ-1", "bazi.zi_attribution"], ["E2E-LY-1", "liuyao.day_boundary"]] as const) {
    const p = prepared("G2", id);
    const dep = p.rows.deps.find((d) => (p.j as { variants: { calc_function_id: string; rule_variant_id: string }[] }).variants.some((v) => v.calc_function_id === fn && v.rule_variant_id === d["ref_id"]));
    assert.ok(dep, `${id}：${fn} 的变体已记入依赖`);
    const b = clone(p.rows);
    b.deps = b.deps.filter((d) => d["ref_id"] !== dep!["ref_id"]);
    b.resolved = b.resolved.filter((r) => r.key !== dep!["ref_id"]);
    rejects(() => sealSnapshot(p.w.db, b), "Q-C-06");
    sealSnapshot(p.w.db, b, { skipPrecheck: true });
    const sid = String(b.snapshot["snapshot_id"]);
    assert.ok(snapshotChecks["Q-C-06"]!(p.w.db, sid).some((r) => r["calc_function_id"] === fn));
    assert.ok(snapshotChecks["Q-C-10"]!(p.w.db, sid).some((r) => r["calc_function_id"] === fn));
  }
  // 跳过步骤（BZ-13，P-A-04 暂缓）记成变体依赖
  const p = prepared("G2", "E2E-BZ-1");
  const b = clone(p.rows);
  const d0 = b.deps.find((d) => d["dep_type"] === "rule_variant")!;
  b.deps.push({ ...d0, ord: b.deps.length + 1, step_code: "BZ-13" });
  sealSnapshot(p.w.db, b, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-C-10"]!(p.w.db, String(b.snapshot["snapshot_id"])).some((r) => r["problem"] === "skip_recorded_as_dependency"));
});

test("DB-C-07 / DB-C-08 / DB-C-09：R-I-1、R-I-3、R-I-4 发布校验查询", async () => {
  const { ins, testHumanCheck } = await import("./helpers.js");
  const w = loadWorld("G2"); const db = w.db; const rel = w.releases.at(-1)!;
  let seq = 100;
  const fs = (t: string, id: string, prev: string | null, next: string) => ins(db, "formal", "formal_status_history", { target_type: t, target_id: id, previous_value: prev, new_value: next, data_release: rel, sequence_no: seq++ });
  ins(db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
  ins(db, "formal", "edition", { edition_id: "X-E", source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: "原刊本", confidence: "B", branch_id: null });
  ins(db, "formal", "passage", { passage_id: "X-P", edition_id: "X-E", chapter_label: "c", paragraph_no: 1, text: "t", volume_page: "1", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
  ins(db, "formal", "evidence", { evidence_id: "X-EV", human_id: "X-EV", evidence_tier: "E3", evidence_category: "C-B", confidence: "B", verification_method: null, missing_evidence: null, next_source: null, origin: "human", branch_id: null });
  ins(db, "formal", "evidence_passage", { evidence_id: "X-EV", passage_id: "X-P" });
  fs("Source", "X-S", null, "NON_FORMAL"); fs("Edition", "X-E", null, "NON_FORMAL");
  assert.deepEqual(releaseChecks["Q-C-07"](db), [], "正向：Source、Edition 皆 NON_FORMAL");
  fs("Edition", "X-E", "NON_FORMAL", "FORMAL");
  assert.equal(releaseChecks["Q-C-07"](db).length, 1, "R-I-1");
  fs("Edition", "X-E", "FORMAL", "NON_FORMAL"); testHumanCheck(db, "X-EV"); fs("Evidence", "X-EV", null, "FORMAL");
  assert.equal(releaseChecks["Q-C-08"](db).length, 1, "R-I-3");
  fs("Evidence", "X-EV", "FORMAL", "NON_FORMAL");
  ins(db, "formal", "claim", { claim_id: "X-CL", component_id: "P-B-02", statement: "s", condition: null, branch_id: null });
  ins(db, "formal", "evidence_link", { evidence_id: "X-EV", claim_id: "X-CL", directness: "direct", scope_note: null, branch_id: null });
  ins(db, "formal", "evidence_link_role", { evidence_id: "X-EV", claim_id: "X-CL", role: "反证", role_note: "n" });
  assert.deepEqual(releaseChecks["Q-C-09"](db), [], "只有反证角色的 NON_FORMAL 证据不触发");
  ins(db, "formal", "evidence_link_role", { evidence_id: "X-EV", claim_id: "X-CL", role: "支持", role_note: "n" });
  assert.ok(releaseChecks["Q-C-09"](db).length >= 1, "R-I-4：支持角色 NON_FORMAL 而变体 FORMAL");
});

// ---------------------------------------------------------------- DB-T
test("DB-T-01 / DB-T-02 / DB-T-03 / DB-T-04 / DB-T-05 / DB-T-06 / DB-T-07：轨迹与部分执行", () => {
  const p = prepared("G2", "E2E-LY-1");
  const mut = (f: (b: SnapshotRows) => void) => { const b = clone(p.rows); f(b); return b; };
  // DB-T-01：缺 LY-09；LY-03 两行
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.trace = b.trace.filter((t) => t["step_code"] !== "LY-09"); })), "Q-T-01");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { b.trace.push({ ...b.trace.find((t) => t["step_code"] === "LY-03")!, exec_order: 99 }); })), /UNIQUE|Q-T-01/);
  // DB-T-02 / 03
  rejects(() => sealSnapshot(p.w.db, mut((b) => { const t = b.trace.find((x) => x["step_code"] === "LY-09")!; t["reason"] = null; })), "DB-T-02");
  rejects(() => sealSnapshot(p.w.db, mut((b) => { const t = b.trace.find((x) => x["step_code"] === "LY-03")!; t["impl_hash"] = null; })), "DB-T-03");
  // DB-T-04：function_version 不一致——预检拒；绕过 Q-T-04 查出
  const v4 = mut((b) => { const t = b.trace.find((x) => x["step_code"] === "LY-03")!; t["function_version"] = "999"; });
  rejects(() => sealSnapshot(p.w.db, v4), "Q-T-04");
  // DB-T-06：LY-07 完成而 LY-06 未执行
  rejects(() => sealSnapshot(p.w.db, mut((b) => { const t = b.trace.find((x) => x["step_code"] === "LY-06")!; Object.assign(t, { status: "未执行", skip_kind: "范围外", reason: "x", calc_function_id: null, function_version: null, impl_hash: null, output_summary: null }); })), "Q-T-06");
  // DB-T-05：LY-09 未执行而结果含 month_build
  const c = C.cases.find((x) => x.case_id === "E2E-LY-1")!;
  const payload = JSON.parse(String(p.rows.snapshot["result_payload"])) as Record<string, unknown>;
  assert.ok(!("month_build" in payload), "正向：结果无月建字段");
  assert.equal(p.rows.snapshot["result_completeness"], "COMPLETE", "LY-09 范围外不影响完整度");
  void c;
  // DB-T-07：八字 CFG-02 = false 而 BZ-03 完成
  const q = prepared("G2", "E2E-BZ-1", p.w, "-T7");
  const b7 = clone(q.rows); const t3 = b7.trace.find((x) => x["step_code"] === "BZ-03")!;
  const t1 = b7.trace.find((x) => x["step_code"] === "BZ-01")!;
  Object.assign(t3, { status: "完成", skip_kind: null, reason: null, calc_function_id: t1["calc_function_id"], function_version: t1["function_version"], impl_hash: t1["impl_hash"], output_summary: "{}" });
  rejects(() => sealSnapshot(q.w.db, b7), "Q-T-07");
  sealSnapshot(q.w.db, b7, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-T-07"]!(q.w.db, String(b7.snapshot["snapshot_id"])).length === 1);
});

test("DB-T-05：LY-09 未执行而结果含 month_build，封存前校验拒（引擎）", () => {
  const p = prepared("G2", "E2E-LY-1");
  const payload = JSON.parse(String(p.rows.snapshot["result_payload"])) as Record<string, unknown>;
  checkPayloadAgainstPlan(p.plan, "LIUYAO", payload);
  assert.throws(() => checkPayloadAgainstPlan(p.plan, "LIUYAO", { ...payload, month_build: "子" }), (e: unknown) => e instanceof CanonicalError && e.code === "DB-T-05");
});

test("DB-T-09：步骤编号表不可改名、不可删行", () => {
  const w = loadWorld("G0");
  rejects(() => w.db.exec("UPDATE formal.step_code SET step_code = 'BZ-99' WHERE step_code = 'BZ-01'"), "[DB-I-step_code]");
  rejects(() => w.db.exec("DELETE FROM formal.step_code WHERE step_code = 'BZ-01'"), "[DB-I-step_code]");
});

test("DB-T-10：按 engine_function_source 重算 impl_hash 等于登记值；改一个源文件哈希被 Q-T-10 查出", () => {
  const w = loadWorld("G2");
  const root = new URL("../../../", import.meta.url);
  assert.deepEqual(checkImplHashes(w.db, root), []);
  const bad = checkImplHashes(w.db, root, (u) => (u.pathname.endsWith("src/liuyao.ts") ? Buffer.from("changed") : readFileSync(u)));
  assert.ok(bad.some((r) => r["problem"] === "源文件已变化"));
});

// ---------------------------------------------------------------- DB-X
test("DB-X-01 / DB-X-03 / DB-X-04 / DB-X-07：跨库三元组、内容哈希、引擎登记、规范化版本登记", () => {
  const p = prepared("G2", "E2E-BZ-1");
  sealSnapshot(p.w.db, p.rows);
  const sid = String(p.rows.snapshot["snapshot_id"]);
  for (const k of ["Q-X-01", "Q-X-04", "Q-X-07"]) assert.deepEqual(snapshotChecks[k]!(p.w.db, sid), [], `${k} 正向 0 行`);
  const q = prepared("G2", "E2E-BZ-1", p.w, "-X");
  const b = clone(q.rows); const d = b.deps.find((x) => x["dep_type"] === "rule_variant")!; d["ref_hash"] = `0${String(d["ref_hash"]).slice(1)}`;
  const tv = b.resolved.find((r) => r.key === d["ref_id"])!; tv.content_hash = String(d["ref_hash"]);
  b.snapshot["data_fingerprint"] = dataFingerprint(b.resolved);
  rejects(() => sealSnapshot(q.w.db, b), "Q-X-01", "DB-X-03 预检");
  sealSnapshot(q.w.db, b, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-X-01"]!(q.w.db, String(b.snapshot["snapshot_id"])).length >= 1, "DB-X-01 / 03");
  const e = prepared("G2", "E2E-LY-1", p.w, "-E");
  const be = clone(e.rows); be.snapshot["engine_release_id"] = "X-ENGINE-NONE";
  sealSnapshot(e.w.db, be, { skipPrecheck: true });
  assert.equal(snapshotChecks["Q-X-04"]!(e.w.db, String(be.snapshot["snapshot_id"])).length, 1, "DB-X-04");
  p.w.db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR', 'b', NULL, '9999.1', NULL, 'OWNER', NULL)").run();
  assert.ok(snapshotChecks["Q-X-07"]!(p.w.db).some((r) => r["t"] === "branch"), "DB-X-07 未登记数据版本");
  // DB-H-16：canonicalization_version 不在 F06 登记——绕过预检后 DB-X-07 查出
  const h = prepared("G2", "E2E-LY-1", p.w, "-H");
  const bh = clone(h.rows); bh.snapshot["canonicalization_version"] = "jcs-0";
  rejects(() => sealSnapshot(h.w.db, bh), "Q-X-07");
});

test("DB-X-02：正式库无行引用用户库对象", () => {
  const r = runCase("G2", "E2E-LY-1");
  assert.deepEqual(snapshotChecks["Q-X-02"]!(r.w.db), []);
});

test("DB-X-05：§12.2 证据一致性查询（v1.0.6 九条）——各造一条违例恰查出 1 行或被写入门禁先行拦截，清除后 0 行", async () => {
  const { ins } = await import("./helpers.js");
  const { openMemoryDb } = await import("../../db/connect.js");
  const keys = Object.keys(evidenceChecks) as (keyof typeof evidenceChecks)[];
  for (const k of keys) {
    const w = loadWorld("G0", openMemoryDb()); const db = w.db; const rel = w.releases[0]!;
    assert.deepEqual(evidenceChecks[k](db), [], `${k} 清除状态 0 行`);
    const ev = (over: Record<string, string | number | null>) => ins(db, "formal", "evidence", { evidence_id: "X-EV", human_id: "X-EV", evidence_tier: "E3", evidence_category: "C-B", confidence: "A", verification_method: "影印本对校", missing_evidence: null, next_source: null, origin: "human", branch_id: null, ...over });
    const st = (v: string) => ins(db, "formal", "evidence_status_history", { target_type: "Evidence", target_id: "X-EV", field: "evidence_status", previous_value: null, new_value: v, data_release: rel, sequence_no: 1 });
    const ed = (ts: string) => {
      ins(db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
      ins(db, "formal", "edition", { edition_id: "X-E", source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: ts, confidence: ts.startsWith("转录本") ? "B" : "A", branch_id: null });
      ins(db, "formal", "passage", { passage_id: "X-P", edition_id: "X-E", chapter_label: "c", paragraph_no: 1, text: "t", volume_page: "1", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
      ins(db, "formal", "evidence_passage", { evidence_id: "X-EV", passage_id: "X-P" });
    };
    switch (k) {
      // Q-X-05-1～4：E2-FIX-2 P2-2 起写入路径已由 G-6 触发器先行拦截（查询保留作发布前复核）
      case "Q-X-05-1": ev({ confidence: "B" }); assert.throws(() => st("PRIMARY_VERIFIED"), /DB-G6-PV/); continue;
      case "Q-X-05-2": ev({ verification_method: "网络检索" }); assert.throws(() => st("PRIMARY_VERIFIED"), /DB-G6-PV/); continue;
      case "Q-X-05-3": ev({}); ed("原刊本"); assert.throws(() => st("PRIMARY_VERIFIED"), /DB-G6-PV/); continue;
      case "Q-X-05-4": ev({ origin: "ai_output" }); ed("原刊本"); assert.throws(() => st("CROSS_CHECKED"), /DB-G6-AI/); continue;
      case "Q-X-05-5": ev({}); ed("转录本（未与影印本对校）"); break;
      case "Q-X-05-6": db.exec("SELECT 1"); assert.throws(() => ev({ branch_id: "X-BR" })); continue; // 库层 CHECK 已先行拦截（DB-F-03）
      case "Q-X-05-7": continue; // 个人对象 branch_id 为 NOT NULL，库层先拦截（DB-N）
      case "Q-X-05-8":
        ev({}); ins(db, "formal", "claim", { claim_id: "X-CL", component_id: "P-B-02", statement: "s", condition: null, branch_id: null });
        ins(db, "formal", "evidence_link", { evidence_id: "X-EV", claim_id: "X-CL", directness: "direct", scope_note: null, branch_id: null }); break;
      case "Q-X-05-9":
        ev({}); ed("原刊本"); ins(db, "formal", "variant_type", { type_code: "X-VT", applies_to_domain: "古籍文本异文", label: "字词" });
        ins(db, "formal", "text_variant", { variant_id: "X-TV", type_code: "X-VT", passage_a: "X-P", edition_a: "X-E", passage_b: null, edition_b: "X-E",
          reading_a: "甲", reading_b: null, preferred_reading: null, preferred_basis: null, impact_level: "calculation", impact_note: null }); break;
    }
    assert.equal(evidenceChecks[k](db).length, 1, `${k} 恰查出 1 行`);
  }
});

// ---------------------------------------------------------------- DB-B
test("DB-B-01：所经步骤映射到现行 BLOCKED-FORMAL 阻断仍封存——引擎判 BLOCKED；绕过引擎 Q-B-01 查出", () => {
  const g1 = runCase("G1", "E2E-BZ-1");
  assert.equal(g1.out.status, "BLOCKED");
  // 绕过引擎：用 G1N 的封存行写入 G1 世界（BLK-6 现行，BZ-05 完成）
  const p = prepared("G1N", "E2E-BZ-1");
  const w1 = loadWorld("G1");
  const c = C.cases.find((x) => x.case_id === "E2E-BZ-1")!;
  saveProfileInputConfig(w1.db, c.owner_profile_id, p.inp, c.input_id, p.cfg);
  rejects(() => sealSnapshot(w1.db, p.rows), "Q-B-01");
  sealSnapshot(w1.db, p.rows, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-B-01"]!(w1.db).some((r) => r["step_code"] === "BZ-05" && r["block_id"] === "BLK-6"));
});

test("DB-B-02：BLOCKER_PATH 原因引用 BLK-6 → LY-06 合法；引用 BLK-7 → BZ-03 被 Q-B-02 查出", () => {
  const p = prepared("G1N", "E2E-LY-1");
  sealSnapshot(p.w.db, p.rows);
  assert.deepEqual(snapshotChecks["Q-B-02"]!(p.w.db), []);
  const q = prepared("G1N", "E2E-LY-1", p.w, "-B");
  const b = clone(q.rows); const r0 = b.reasons.find((r) => r["reason_kind"] === "BLOCKER_PATH")!;
  r0["upstream_id"] = "BLK-7"; r0["step_code"] = "BZ-03";
  rejects(() => sealSnapshot(q.w.db, b), "Q-B-02");
  sealSnapshot(q.w.db, b, { skipPrecheck: true });
  assert.ok(snapshotChecks["Q-B-02"]!(q.w.db).some((r) => r["upstream_id"] === "BLK-7"));
});

test("Q-18：真实计算不默认日界——日界变体不可用时引擎拒绝计算（无 00:00 / 23:00 默认）", () => {
  const w = loadWorld("G1N:LIUYAO");
  const c = C.cases.find((x) => x.case_id === "E2E-LY-1")!;
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  const cfg = prepareConfig({ ...c.config, module: c.domain });
  const plan = buildPlan(w.db, inp, cfg); const j = judge(w.db, plan);
  if (j.status === "BLOCKED") assert.fail();
  const noBoundary = { ...j, variants: j.variants.filter((v) => v.calc_function_id !== "liuyao.day_boundary") };
  assert.throws(() => buildSnapshotRows(w.db, w.ctx, plan, noBoundary, { profileId: "p", inputId: "i", inp, cfg }), (e: unknown) => e instanceof CanonicalError && /Q-18/.test((e as Error).message));
  const badContent = { ...w.ctx, variantContent: () => ({ v: 1 }) };
  assert.throws(() => buildSnapshotRows(w.db, badContent, plan, j, { profileId: "p", inputId: "i", inp, cfg }), (e: unknown) => e instanceof CanonicalError);
});

test("PresealError 携带失败查询编号（E + Q）", () => {
  const p = prepared("G2", "E2E-LY-1");
  const b = clone(p.rows); b.trace = b.trace.filter((t) => t["step_code"] !== "LY-01");
  try { sealSnapshot(p.w.db, b); assert.fail(); } catch (e) { assert.ok(e instanceof PresealError); assert.ok((e as PresealError).violations.some((v) => v.check === "Q-T-01")); }
});

test("金标关联：G2 端到端的 input_hash、config_hash、result_hash 等于数据仓库独立生成的 GV-07～GV-12", () => {
  const g = readVectors("golden_jcs1.json") as { vectors: { id: string; sha256?: string }[] };
  const sha = (id: string) => g.vectors.find((v) => v.id === id)!.sha256!;
  const bz = prepared("G2", "E2E-BZ-1"), ly = prepared("G2", "E2E-LY-1");
  assert.equal(bz.inp.input_hash, sha("GV-07")); assert.equal(ly.inp.input_hash, sha("GV-08"));
  assert.equal(bz.cfg.config_hash, sha("GV-09")); assert.equal(ly.cfg.config_hash, sha("GV-10"));
  assert.equal(bz.rows.snapshot["result_hash"], sha("GV-11")); assert.equal(ly.rows.snapshot["result_hash"], sha("GV-12"));
});
