// E2-FIX-2：三个 P1 的反例测试。只用 a807621 已有的公共接口（judge、buildPlan、runCase、loadWorld 变造），
// 以便在修复前代码上运行同一文件、证明“修复前失败、修复后通过”（见定点修订报告二第 1 节）。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { judge } from "../../db/governance.js";
import { buildPlan, prepareConfig, prepareInput } from "../../db/pipeline.js";
import { releaseChecks } from "../../db/queries.js";
import { cases, loadWorld, world, type LoadedWorld, type WorldEdit } from "../fixtures/load.js";
import { openMemoryDb } from "../../db/connect.js";
import { count, ins, runCase, testHumanCheck, type Row } from "./helpers.js";

const CASE = (id: string) => cases().cases.find((x) => x.case_id === id)!;
function judgeCase(w: LoadedWorld, id: string) {
  const c = CASE(id);
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  return judge(w.db, buildPlan(w.db, inp, prepareConfig({ ...c.config, module: c.domain })));
}
const reasonRows = (db: DatabaseSync, sid: string) =>
  db.prepare("SELECT reason_kind, ri_segment, note FROM snapshot_non_formal_reason WHERE snapshot_id = ? ORDER BY ord").all(sid) as { reason_kind: string; ri_segment: string | null; note: string }[];
const snapStatus = (db: DatabaseSync, sid: string) => (db.prepare("SELECT formal_status FROM calculation_snapshot WHERE snapshot_id = ?").get(sid) as { formal_status: string }).formal_status;
const lastRelease = (w: LoadedWorld) => w.releases.at(-1)!;
let seqN = 900;
const fsh = (w: LoadedWorld, t: string, id: string, prev: string | null, next: string, rel = lastRelease(w)) => {
  if (t === "Evidence" && next === "FORMAL" && count(w.db, `formal.manual_check_record WHERE evidence_id = '${id}'`) === 0) testHumanCheck(w.db, id); // G-6 门禁的测试构造
  ins(w.db, "formal", "formal_status_history", { target_type: t, target_id: id, previous_value: prev, new_value: next, data_release: rel, sequence_no: seqN++ });
};

// ---------------------------------------------------------------- P1-1：R-I-4 进入计算判定
function evidenceWorld(scenario = "G2", edit: WorldEdit = {}) {
  const w = loadWorld(scenario, openMemoryDb(), edit);
  ins(w.db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
  ins(w.db, "formal", "edition", { edition_id: "X-E", source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: "原刊本", confidence: "A", branch_id: null });
  ins(w.db, "formal", "passage", { passage_id: "X-P", edition_id: "X-E", chapter_label: "卷一", paragraph_no: 1, text: "t", volume_page: "n30", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
  ins(w.db, "formal", "claim", { claim_id: "X-C1", component_id: "P-B-02", statement: "纳甲依京房", condition: null, branch_id: null });
  return w;
}
function addEvidence(w: LoadedWorld, id: string, role: "支持" | "反证" | null, over: Row = {}) {
  ins(w.db, "formal", "evidence", { evidence_id: id, human_id: id, evidence_tier: "E3", evidence_category: "C-B", confidence: "B", verification_method: null, missing_evidence: null, next_source: null, origin: "human", branch_id: null, ...over });
  ins(w.db, "formal", "evidence_passage", { evidence_id: id, passage_id: "X-P" });
  if (role) {
    ins(w.db, "formal", "evidence_link", { evidence_id: id, claim_id: "X-C1", directness: "direct", scope_note: null, branch_id: null });
    ins(w.db, "formal", "evidence_link_role", { evidence_id: id, claim_id: "X-C1", role, role_note: `${role}说明` });
  }
}

test("P1-1 反例：发布检测查出 R-I-4 违例时，judge() 拒绝 FORMAL，calculate() 生成的快照为 NON_FORMAL 并写明 R-I-4", () => {
  const w = evidenceWorld();
  addEvidence(w, "X-EV", "支持"); fsh(w, "Evidence", "X-EV", null, "NON_FORMAL");
  assert.ok(releaseChecks["Q-C-09"](w.db).length > 0, "检测查询发现违例");
  const j = judgeCase(w, "E2E-LY-1");
  assert.equal(j.status, "NON_FORMAL", "judge 不得为 FORMAL");
  if (j.status === "NON_FORMAL") assert.ok(j.reasons.some((r) => r.reason_kind === "R-I" && r.ri_segment === "R-I-4"));
  const r = runCase("G2", "E2E-LY-1", { w });
  assert.equal(r.out.status, "NON_FORMAL");
  if (r.out.status === "NON_FORMAL") {
    assert.equal(snapStatus(w.db, r.out.snapshot_id), "NON_FORMAL", "已封存快照为 NON_FORMAL");
    assert.ok(reasonRows(w.db, r.out.snapshot_id).some((x) => x.reason_kind === "R-I" && x.ri_segment === "R-I-4" && x.note.includes("X-EV")), "原因行写明 R-I-4 与证据");
  }
});

test("P1-1：支持证据没有任何正式状态记录——按非正式处理（失效关闭），不得 FORMAL", () => {
  const w = evidenceWorld();
  addEvidence(w, "X-EV", "支持");
  assert.equal(judgeCase(w, "E2E-LY-1").status, "NON_FORMAL");
});

test("P1-1：反证、异文、检索、引用与低可信度均不误触发 R-I-4（FORMAL 不变）", () => {
  const w = evidenceWorld();
  addEvidence(w, "X-EVR", "反证"); fsh(w, "Evidence", "X-EVR", null, "NON_FORMAL");
  addEvidence(w, "X-EVV", null); fsh(w, "Evidence", "X-EVV", null, "NON_FORMAL");
  ins(w.db, "formal", "variant_type", { type_code: "X-VT", applies_to_domain: "古籍文本异文", label: "字词" });
  ins(w.db, "formal", "text_variant", { variant_id: "X-TV", type_code: "X-VT", passage_a: "X-P", edition_a: "X-E", passage_b: null, edition_b: "X-E", reading_a: "甲", reading_b: null, preferred_reading: null, preferred_basis: null, impact_level: "calculation", impact_note: null });
  ins(w.db, "formal", "text_variant_component", { variant_id: "X-TV", component_id: "P-B-02" });
  ins(w.db, "formal", "text_variant_evidence", { variant_id: "X-TV", evidence_id: "X-EVV" });
  ins(w.db, "formal", "search_record", { search_id: "X-SR", claim_id: "X-C1", search_scope: "s", search_terms: "t", searched_at: "2026-11-21", expected_find_premise: "p", outcome: "未找到", outcome_note: null });
  ins(w.db, "formal", "citation_record", { citation_id: "X-CR", passage_id: "X-P", cited_ref: "r", verdict: "不属实", basis_evidence_id: "X-EVV", note: null });
  addEvidence(w, "X-EVC", "支持", { confidence: "C", evidence_tier: "E4" }); fsh(w, "Evidence", "X-EVC", null, "FORMAL"); // 低可信度但为 FORMAL 的支持证据
  assert.deepEqual(releaseChecks["Q-C-09"](w.db), []);
  assert.equal(judgeCase(w, "E2E-LY-1").status, "FORMAL");
});

test("P1-1 时序：证据在后续数据版本失效 → NON_FORMAL；先失效后恢复 → FORMAL；证据先失效、变体后转 FORMAL → Q-F-24d 查出", () => {
  const w = evidenceWorld();
  addEvidence(w, "X-EV", "支持");
  const [r0, rLast] = [w.releases[0]!, lastRelease(w)];
  fsh(w, "Evidence", "X-EV", null, "FORMAL", r0);
  assert.equal(judgeCase(w, "E2E-LY-1").status, "FORMAL");
  fsh(w, "Evidence", "X-EV", "FORMAL", "NON_FORMAL", rLast);
  assert.equal(judgeCase(w, "E2E-LY-1").status, "NON_FORMAL", "最新版本中证据为 NON_FORMAL");
  fsh(w, "Evidence", "X-EV", "NON_FORMAL", "FORMAL", rLast);
  assert.equal(judgeCase(w, "E2E-LY-1").status, "FORMAL", "恢复后 FORMAL");

  const w2 = evidenceWorld();
  addEvidence(w2, "X-EV", "支持");
  const pb02 = (w2.db.prepare("SELECT rule_variant_id FROM formal.rule_variant WHERE component_id = 'P-B-02'").get() as { rule_variant_id: string }).rule_variant_id;
  fsh(w2, "Evidence", "X-EV", null, "NON_FORMAL", w2.releases[0]!);
  const hasVar = w2.db.prepare("SELECT count(*) AS n FROM formal.formal_status_history WHERE target_type = 'RuleVariant' AND target_id = ?").get(pb02) as { n: number };
  if (hasVar.n === 0) fsh(w2, "RuleVariant", pb02, null, "FORMAL", lastRelease(w2));
  const d = releaseChecks["Q-F-24d"](w2.db);
  assert.ok(d.some((x) => x["rule_variant_id"] === pb02 && x["evidence_id"] === "X-EV"), `证据先失效、变体后转 FORMAL 须查出：${JSON.stringify(d)}`);
});

test("P1-1 粒度边界（P2-6，保守阻断）：主张挂在子项上，一条非正式支持证据使该子项全部变体（含竞争变体）都不为 FORMAL", () => {
  const w = evidenceWorld();
  ins(w.db, "formal", "rule_variant", { ...(w.db.prepare("SELECT * FROM formal.rule_variant WHERE component_id = 'P-B-02'").get() as Row), rule_variant_id: "X-RV-ALT", version_no: 2, content_hash: "alt" });
  addEvidence(w, "X-EV", "支持"); fsh(w, "Evidence", "X-EV", null, "NON_FORMAL");
  const rows = w.db.prepare("SELECT rule_variant_id, ri4_blocked, formal_status FROM formal.v_variant_formal WHERE component_id = 'P-B-02' ORDER BY rule_variant_id").all() as { rule_variant_id: string; ri4_blocked: number; formal_status: string }[];
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.ri4_blocked === 1 && r.formal_status === "NON_FORMAL"), "两个变体都受影响（过度阻断边界，已记录）");
});

// ---------------------------------------------------------------- P1-2：函数级未裁决争议
/** 保留日界函数的原始“未裁决”争议（场景以就地替换记为“已裁决”；这里去掉该争议及其主张，再按原始记录追加回去），子项与变体照常存在 */
const keepDayBoundaryUnresolved: WorldEdit = (() => {
  const all = Object.values(world().layers).flat();
  const orig = all.find((r) => r.t === "dispute" && r.r["object_ref"] === "function:liuyao.day_boundary" && r.r["status"] === "未裁决")!;
  const id = orig.r["dispute_id"];
  const claims = all.filter((r) => r.t === "dispute_claim" && r.r["dispute_id"] === id && !r.sim);
  return { exclude: (rec) => (rec.t === "dispute" || rec.t === "dispute_claim") && rec.r["dispute_id"] === id, extra: [orig, ...claims] };
})();

test("P1-2 反例：function:liuyao.day_boundary 未裁决而日界子项唯一可选（SINGLE）→ NON_FORMAL（RULE_PROVISIONAL），不得 FORMAL；快照与原因行一致", () => {
  const w = loadWorld("G2", openMemoryDb(), keepDayBoundaryUnresolved);
  assert.equal((w.db.prepare("SELECT status FROM formal.dispute WHERE object_ref = 'function:liuyao.day_boundary'").get() as { status: string }).status, "未裁决");
  const j = judgeCase(w, "E2E-LY-1");
  assert.equal(j.status, "NON_FORMAL");
  if (j.status === "NON_FORMAL") assert.ok(j.reasons.some((r) => r.reason_kind === "RULE_PROVISIONAL" && r.note.includes("liuyao.day_boundary")));
  const r = runCase("G2", "E2E-LY-1", { w });
  assert.equal(r.out.status, "NON_FORMAL");
  if (r.out.status === "NON_FORMAL" && j.status === "NON_FORMAL") {
    assert.equal(snapStatus(w.db, r.out.snapshot_id), "NON_FORMAL");
    assert.deepEqual(reasonRows(w.db, r.out.snapshot_id).map((x) => [x.reason_kind, x.note]), j.reasons.map((x) => [x.reason_kind, x.note]), "原因行与 judge 一致");
  }
});

test("P1-2：函数级未裁决争议 + 子项为 DEFAULT（有现行默认）→ 仍 NON_FORMAL（有默认不等于已裁决）", () => {
  const w = loadWorld("G2");
  const v = w.db.prepare("SELECT v.rule_variant_id, a.approval_id FROM formal.rule_variant v JOIN formal.v_current_approval a ON a.target_id = v.rule_variant_id WHERE v.component_id = 'P-B-02'").get() as { rule_variant_id: string; approval_id: string };
  ins(w.db, "formal", "component_default", { component_id: "P-B-02", applicable_scope: "{\"kind\":\"all\",\"v\":1}", rule_variant_id: v.rule_variant_id, approval_ref: v.approval_id, data_release: lastRelease(w), sequence_no: 1 });
  assert.equal((w.db.prepare("SELECT count(*) AS n FROM formal.v_current_default WHERE component_id = 'P-B-02'").get() as { n: number }).n, 1);
  ins(w.db, "formal", "dispute", { dispute_id: "X-DSP-NAJIA", object_ref: "function:liuyao.najia", status: "未裁决", ruling_ref: null });
  const j = judgeCase(w, "E2E-LY-1");
  assert.equal(j.status, "NON_FORMAL");
  if (j.status === "NON_FORMAL") assert.ok(j.reasons.some((r) => r.reason_kind === "RULE_PROVISIONAL" && r.note.includes("X-DSP-NAJIA")));
});

/** 给新子项补齐现行批准与计算准入（隔离库内的构造，供混合状态用例） */
function approveAndAdmit(w: LoadedWorld, variant: string, component: string) {
  const db = w.db; const rel = lastRelease(w);
  const hash = (db.prepare("SELECT content_hash FROM formal.rule_variant WHERE rule_variant_id = ?").get(variant) as { content_hash: string }).content_hash;
  const nextSeq = (t: string) => ((db.prepare(`SELECT max(sequence_no) AS m FROM formal.${t}`).get() as { m: number | null }).m ?? 0) + 1;
  db.exec("BEGIN");
  ins(db, "formal", "approval_basis", { approval_id: `X-APR-${variant}`, basis_ref: "隔离库构造" });
  ins(db, "formal", "approval_record", { approval_id: `X-APR-${variant}`, sequence_no: nextSeq("approval_record"), target_type: "rule_variant", target_id: variant, target_content_hash: hash,
    data_release: rel, decision: "approve", decided_by: "USER", decided_at: "t", scope: "{\"kind\":\"all\",\"v\":1}", conditions: null, supersedes_approval_id: null });
  db.exec("COMMIT");
  ins(db, "formal", "admission_record", { admission_id: `X-ADM-${component}`, component_id: component, purpose: "calc", previous_status: null, new_status: "FORMAL_ALLOWED", conditions: null,
    basis_ref: "隔离库构造", data_release: rel, sequence_no: nextSeq("admission_record"), decided_by: "USER" });
}

test("P1-2：函数级争议 + 多子项混合（P-B-02 为 DEFAULT、新子项为 SINGLE，皆可选且已批准）→ NON_FORMAL，每个所用变体各写一条原因", () => {
  const extra = [
    { t: "rule_component", r: { component_id: "X-RC-NAJIA-2", rule_id: "P-B-02", evidence_category: "C-B", is_calendar_anchor: null, calc_function_id: "liuyao.najia", applicability_domain: "LIUYAO" } },
    { t: "rule_variant", r: { rule_variant_id: "X-RV-NAJIA-2", component_id: "X-RC-NAJIA-2", version_no: 1, confidence: "C" }, content: { kind: "algorithm", calc_function_id: "liuyao.najia", note: "x" } },
  ];
  const w = loadWorld("G2", openMemoryDb(), { extra });
  approveAndAdmit(w, "X-RV-NAJIA-2", "X-RC-NAJIA-2");
  const v = w.db.prepare("SELECT v.rule_variant_id, a.approval_id FROM formal.rule_variant v JOIN formal.v_current_approval a ON a.target_id = v.rule_variant_id WHERE v.component_id = 'P-B-02'").get() as { rule_variant_id: string; approval_id: string };
  ins(w.db, "formal", "component_default", { component_id: "P-B-02", applicable_scope: "{\"kind\":\"all\",\"v\":1}", rule_variant_id: v.rule_variant_id, approval_ref: v.approval_id, data_release: lastRelease(w), sequence_no: 1 });
  assert.equal(judgeCase(w, "E2E-LY-1").status, "FORMAL", "对照：无争议时混合可选状态为 FORMAL");
  ins(w.db, "formal", "dispute", { dispute_id: "X-DSP-NAJIA", object_ref: "function:liuyao.najia", status: "未裁决", ruling_ref: null });
  const j = judgeCase(w, "E2E-LY-1");
  assert.equal(j.status, "NON_FORMAL");
  if (j.status === "NON_FORMAL") {
    const ups = j.reasons.filter((r) => r.reason_kind === "RULE_PROVISIONAL" && r.note.includes("X-DSP-NAJIA")).map((r) => r.upstream_id).sort();
    assert.deepEqual(ups, [v.rule_variant_id, "X-RV-NAJIA-2"].sort());
  }
});

test("P1-2：函数级争议 + 子项缺变体 → BLOCKED-FORMAL；函数无子项 → BLOCKED-FORMAL（G1 日界，Q-18 真实路径不变）", () => {
  const w2 = loadWorld("G2", openMemoryDb(), { extra: [{ t: "rule_component", r: { component_id: "X-RC-NAJIA-3", rule_id: "P-B-02", evidence_category: "C-B", is_calendar_anchor: null, calc_function_id: "liuyao.najia", applicability_domain: "LIUYAO" } }] });
  ins(w2.db, "formal", "dispute", { dispute_id: "X-DSP-NAJIA", object_ref: "function:liuyao.najia", status: "未裁决", ruling_ref: null });
  const j2 = judgeCase(w2, "E2E-LY-1");
  assert.ok(j2.status === "BLOCKED" && j2.kind === "BLOCKED-FORMAL");
  const g1 = judgeCase(loadWorld("G1"), "E2E-LY-1");
  assert.ok(g1.status === "BLOCKED" && g1.kind === "BLOCKED-FORMAL" && /^DISPUTE_UNRESOLVED:.*:LY-06$/.test(g1.code));
});

// ---------------------------------------------------------------- P1-3：阻断失效关闭
// BLK-6 与 B4 为 pair（BLK.4、B4-25 同步）：两者一起去掉，避免 E2-FIX-4 的 pair 状态检查先行拦截
const dropChanges = (block: string): WorldEdit => ({ exclude: (rec) => rec.t === "blocker_change" && (rec.r["block_id"] === block || (block === "BLK-6" && rec.r["block_id"] === "B4")) });

test("P1-3 反例：删除 BLK-6 的全部 blocker_change 记录后，BLK-6 仍按现行生效（G2：八字 BZ-05 BLOCKED，六爻 LY-06 NON_FORMAL）", () => {
  const w = loadWorld("G2", openMemoryDb(), dropChanges("BLK-6"));
  assert.equal(count(w.db, "formal.blocker_change WHERE block_id = 'BLK-6'"), 0);
  assert.equal((w.db.prepare("SELECT status FROM formal.v_blocker_current WHERE block_id = 'BLK-6'").get() as { status: string }).status, "现行");
  const bz = judgeCase(w, "E2E-BZ-1");
  assert.ok(bz.status === "BLOCKED" && /BLK-6/.test(bz.code), `八字：${JSON.stringify(bz).slice(0, 160)}`);
  const ly = judgeCase(w, "E2E-LY-1");
  assert.equal(ly.status, "NON_FORMAL");
  if (ly.status === "NON_FORMAL") assert.ok(ly.reasons.some((r) => r.reason_kind === "BLOCKER_PATH" && r.upstream_id === "BLK-6"));
});

test("P1-3：历史变更缺失（只丢最新一条“已解除”）→ 回到现行；导入遗漏（整条阻断未登记）→ BLOCKED-FORMAL，不生成快照", () => {
  const w = loadWorld("G2", openMemoryDb(), { exclude: (rec) => rec.t === "blocker_change" && ["BLK-6", "B4"].includes(String(rec.r["block_id"])) && rec.r["new_status"] === "已解除" });
  assert.equal((w.db.prepare("SELECT status FROM formal.v_blocker_current WHERE block_id = 'BLK-6'").get() as { status: string }).status, "现行");
  assert.equal(judgeCase(w, "E2E-LY-1").status, "NON_FORMAL");
  // 只丢 BLK-6 一侧的“已解除”：pair 状态不一致 → 整次 BLOCKED-FORMAL（E2-FIX-4 F3-2 / F3-6）
  const w1 = loadWorld("G2", openMemoryDb(), { exclude: (rec) => rec.t === "blocker_change" && rec.r["block_id"] === "BLK-6" && rec.r["new_status"] === "已解除" });
  const j1 = judgeCase(w1, "E2E-LY-1");
  assert.ok(j1.status === "BLOCKED" && /BLOCKER_PAIR_STATE/.test(j1.code), JSON.stringify(j1).slice(0, 160));
  const omit: WorldEdit = { exclude: (rec) => ["blocker", "blocker_change", "blocker_step_map", "component_blocker"].includes(rec.t) && rec.r["block_id"] === "BLK-6" };
  const w2 = loadWorld("G2", openMemoryDb(), omit);
  assert.equal(count(w2.db, "formal.blocker WHERE block_id = 'BLK-6'"), 0);
  const before = count(w2.db, "calculation_snapshot");
  const r = runCase("G2", "E2E-LY-1", { w: w2 });
  assert.equal(r.out.status, "BLOCKED", "必备阻断未登记不得放行");
  if (r.out.status === "BLOCKED") assert.match(r.out.judgment.code, /BLK-6/);
  assert.equal(count(w2.db, "calculation_snapshot"), before);
});

test("P1-3：状态查询异常（阻断视图不可用）→ 判定抛错，不生成快照，不落 FORMAL", () => {
  const w = loadWorld("G2");
  w.db.exec("DROP VIEW formal.v_blocker_current");
  const before = count(w.db, "calculation_snapshot");
  assert.throws(() => runCase("G2", "E2E-LY-1", { w }));
  assert.equal(count(w.db, "calculation_snapshot"), before);
});

test("P1-3：B1～B4、BLK-1～BLK-7 逐个去掉全部变更记录，均为现行（G0 / G1 / G1N / G2）", () => {
  const ids = ["B1", "B2", "B3", "B4", "BLK-1", "BLK-2", "BLK-3", "BLK-4", "BLK-5", "BLK-6", "BLK-7"];
  for (const sc of ["G0", "G1", "G1N:BAZI", "G1N:LIUYAO", "G2"]) {
    const w = loadWorld(sc, openMemoryDb(), { exclude: (rec) => rec.t === "blocker_change" });
    const st = Object.fromEntries((w.db.prepare("SELECT block_id, status FROM formal.v_blocker_current").all() as { block_id: string; status: string }[]).map((r) => [r.block_id, r.status]));
    for (const id of ids) assert.equal(st[id], "现行", `${sc} ${id}`);
  }
});
