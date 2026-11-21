// E2-FIX A（Q-7）：证据—主张模型。契约 v1.0.6 §2.3、§2.5、R-I-4、§12.2。
// 只在隔离内存库内构造数据；P-B-02 / P-B-03 为契约规则编号（G2 场景下两者变体均为 FORMAL）。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { evidenceChecks, releaseChecks } from "../../db/queries.js";
import { loadWorld } from "../fixtures/load.js";
import { ins, rejects, type Row } from "./helpers.js";

interface W { db: DatabaseSync; rel: string; seq: { n: number } }
function world(): W {
  const w = loadWorld("G2");
  const db = w.db;
  ins(db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
  ins(db, "formal", "edition", { edition_id: "X-E", source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: "原刊本", confidence: "A", branch_id: null });
  ins(db, "formal", "edition", { edition_id: "X-E2", source_id: "X-S", parent_edition_id: "X-E", base_text: "X-E", transcription_status: "转录本（未与影印本对校）", confidence: "B", branch_id: null });
  ins(db, "formal", "passage", { passage_id: "X-P", edition_id: "X-E", chapter_label: "卷一", paragraph_no: 1, text: "月破定例", volume_page: "n30", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
  ins(db, "formal", "passage", { passage_id: "X-P2", edition_id: "X-E2", chapter_label: "卷一", paragraph_no: 1, text: "月破定例", volume_page: "1", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
  ins(db, "formal", "variant_type", { type_code: "X-VT", applies_to_domain: "古籍文本异文", label: "字词" });
  return { db, rel: w.releases.at(-1)!, seq: { n: 500 } };
}
const ev = (w: W, id: string, over: Row = {}) => {
  ins(w.db, "formal", "evidence", { evidence_id: id, human_id: id, evidence_tier: "E1", evidence_category: "C-B", confidence: "A", verification_method: null, missing_evidence: null, next_source: null, origin: "human", branch_id: null, ...over });
  ins(w.db, "formal", "evidence_passage", { evidence_id: id, passage_id: "X-P" });
};
const formal = (w: W, t: string, id: string, v: "FORMAL" | "NON_FORMAL") =>
  ins(w.db, "formal", "formal_status_history", { target_type: t, target_id: id, previous_value: null, new_value: v, data_release: w.rel, sequence_no: w.seq.n++ });
const claim = (w: W, id: string, component: string, condition: string | null = null) =>
  ins(w.db, "formal", "claim", { claim_id: id, component_id: component, statement: `${id} 命题`, condition, branch_id: null });
const link = (w: W, e: string, c: string, directness = "direct", scope: string | null = null) =>
  ins(w.db, "formal", "evidence_link", { evidence_id: e, claim_id: c, directness, scope_note: scope, branch_id: null });
const role = (w: W, e: string, c: string, r: string, note = `${r}：针对 ${c}`) =>
  ins(w.db, "formal", "evidence_link_role", { evidence_id: e, claim_id: c, role: r, role_note: note });
const variantOf = (w: W, component: string) =>
  (w.db.prepare("SELECT rule_variant_id FROM formal.rule_variant WHERE component_id = ?").get(component) as { rule_variant_id: string }).rule_variant_id;
const flagged = (w: W) => releaseChecks["Q-C-09"](w.db).map((r) => String(r["rule_variant_id"]));

test("A-1：同一证据对同一主张可兼具支持与反证，各附角色说明；同一角色不得重复；角色说明不得为空；角色只有两值", () => {
  const w = world();
  ev(w, "X-EV"); claim(w, "X-C1", "P-B-02"); link(w, "X-EV", "X-C1");
  role(w, "X-EV", "X-C1", "支持", "十二节对应十二月建，支持按节换月");
  role(w, "X-EV", "X-C1", "反证", "条文只列节，不支持“以交节瞬间为界”的说法");
  const roles = w.db.prepare("SELECT role, role_note FROM formal.evidence_link_role WHERE evidence_id = 'X-EV' AND claim_id = 'X-C1' ORDER BY role").all();
  assert.equal(roles.length, 2);
  rejects(() => role(w, "X-EV", "X-C1", "支持", "重复"), "UNIQUE constraint failed: evidence_link_role");
  rejects(() => role(w, "X-EV", "X-C1", "限定", "x"), "DB-E-evidence_link_role.role");
  rejects(() => role(w, "X-EV", "X-C1", "异文记录", "x"), "DB-E-evidence_link_role.role");
  claim(w, "X-C9", "P-B-02"); link(w, "X-EV", "X-C9");
  rejects(() => role(w, "X-EV", "X-C9", "反证", "   "), "DB-F-18b");
  // 反证必须指向具体主张：没有链接 / 主张不存在即被外键拒
  rejects(() => role(w, "X-EV", "X-NOPE", "反证"), "FOREIGN KEY constraint failed");
});

test("A-2：同一证据对不同主张取不同角色；R-I-4 只按“支持”所在主张的子项传播", () => {
  const w = world();
  ev(w, "X-EV"); formal(w, "Evidence", "X-EV", "NON_FORMAL");
  claim(w, "X-C1", "P-B-02"); claim(w, "X-C2", "P-B-03");
  link(w, "X-EV", "X-C1"); role(w, "X-EV", "X-C1", "支持");
  link(w, "X-EV", "X-C2"); role(w, "X-EV", "X-C2", "反证");
  const f = flagged(w);
  assert.ok(f.includes(variantOf(w, "P-B-02")), "支持 P-B-02 主张的 NON_FORMAL 证据使其变体被查出");
  assert.ok(!f.includes(variantOf(w, "P-B-03")), "对 P-B-03 只有反证，不触发");
});

test("A-3：R-I-4——只要有一个真实支持角色就触发（兼有反证也触发；间接支持也触发）；只有反证不触发；FORMAL 证据不触发", () => {
  const w = world();
  ev(w, "X-EVa"); formal(w, "Evidence", "X-EVa", "NON_FORMAL");
  claim(w, "X-C1", "P-B-02"); link(w, "X-EVa", "X-C1"); role(w, "X-EVa", "X-C1", "反证");
  assert.deepEqual(flagged(w), [], "只有反证");
  role(w, "X-EVa", "X-C1", "支持");
  assert.deepEqual(flagged(w), [variantOf(w, "P-B-02")], "兼有支持与反证 → 触发");

  const w2 = world();
  ev(w2, "X-EVb"); formal(w2, "Evidence", "X-EVb", "NON_FORMAL");
  claim(w2, "X-C1", "P-B-02"); link(w2, "X-EVb", "X-C1", "indirect"); role(w2, "X-EVb", "X-C1", "支持");
  assert.deepEqual(flagged(w2), [variantOf(w2, "P-B-02")], "间接支持同样触发（直接 / 间接与支持 / 反证是独立维度）");

  const w3 = world();
  ev(w3, "X-EVc"); formal(w3, "Evidence", "X-EVc", "FORMAL");
  claim(w3, "X-C1", "P-B-02"); link(w3, "X-EVc", "X-C1"); role(w3, "X-EVc", "X-C1", "支持");
  assert.deepEqual(flagged(w3), [], "FORMAL 证据支持不触发");
});

test("A-4：异文、检索记录、引用记录与 R-I-4 隔离——即使所用证据为 NON_FORMAL，也不能充当支持", () => {
  const w = world();
  ev(w, "X-EV"); formal(w, "Evidence", "X-EV", "NON_FORMAL");
  claim(w, "X-C1", "P-B-02");
  // 异文：独立模型，影响计算并关联子项，引用 NON_FORMAL 证据
  ins(w.db, "formal", "text_variant", { variant_id: "X-TV", type_code: "X-VT", passage_a: "X-P", edition_a: "X-E", passage_b: "X-P2", edition_b: "X-E2",
    reading_a: "正月立春節建寅", reading_b: "正月立春建寅", preferred_reading: "a", preferred_basis: "1787 刊本直读（M-6）", impact_level: "wording_only", impact_note: "脱“節”字，不改对应关系" });
  ins(w.db, "formal", "text_variant_component", { variant_id: "X-TV", component_id: "P-B-02" });
  ins(w.db, "formal", "text_variant_evidence", { variant_id: "X-TV", evidence_id: "X-EV" });
  // 缺席检索与引用行为
  ins(w.db, "formal", "search_record", { search_id: "X-SR", claim_id: "X-C1", search_scope: "卷一全卷", search_terms: "交节 时刻", searched_at: "2026-11-21", expected_find_premise: "若以交节时刻为界，应在月破定例中写明", outcome: "未找到", outcome_note: null });
  ins(w.db, "formal", "citation_record", { citation_id: "X-CR", passage_id: "X-P2", cited_ref: "某书引《卜筮正宗》", verdict: "不属实", basis_evidence_id: "X-EV", note: null });
  assert.deepEqual(flagged(w), [], "异文 / 检索 / 引用都不进角色表，不触发 R-I-4");
  // 结构保证：链接表与角色表没有可放异文、检索、可信度的列
  const cols = (t: string) => (w.db.prepare(`PRAGMA formal.table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols("evidence_link_role"), ["evidence_id", "claim_id", "role", "role_note"]);
  assert.ok(!cols("evidence_link").includes("confidence") && !cols("evidence_link").includes("evidence_role"));
  // 异文自身约束：两侧读法不得同时为空；首选读法须有依据；影响等级固定三值
  const tv = { variant_id: "X-TV2", type_code: "X-VT", passage_a: "X-P", edition_a: "X-E", passage_b: null, edition_b: "X-E2", reading_a: "甲", reading_b: null, preferred_reading: null, preferred_basis: null, impact_level: "none", impact_note: null };
  rejects(() => ins(w.db, "formal", "text_variant", { ...tv, reading_a: null }), "DB-F-13b");
  rejects(() => ins(w.db, "formal", "text_variant", { ...tv, preferred_reading: "a" }), "DB-F-13c");
  rejects(() => ins(w.db, "formal", "text_variant", { ...tv, impact_level: "major" }), "DB-E-text_variant.impact_level");
  // 影响计算的异文须关联子项（§12.2 追加项）
  ins(w.db, "formal", "text_variant", { ...tv, impact_level: "calculation" });
  assert.deepEqual(evidenceChecks["Q-X-05-9"](w.db).map((r) => r["variant_id"]), ["X-TV2"]);
});

test("A-5：适用范围、证据可信度、主张条件分别独立表达，互不折算", () => {
  const w = world();
  ev(w, "X-EVA", { confidence: "A" }); ev(w, "X-EVC", { confidence: "C", evidence_tier: "E3" });
  claim(w, "X-C1", "P-B-07", "以何者为界（交节当日或瞬间）未决");
  claim(w, "X-C2", "P-B-07");
  link(w, "X-EVA", "X-C1", "direct", "1787 金閶綠蔭堂藏板重刊本");
  link(w, "X-EVC", "X-C1", "direct", null);
  link(w, "X-EVA", "X-C2", "indirect", "卷一");
  for (const [e, c] of [["X-EVA", "X-C1"], ["X-EVC", "X-C1"], ["X-EVA", "X-C2"]] as const) role(w, e, c, "支持");
  const rows = w.db.prepare(`SELECT l.evidence_id, l.claim_id, l.scope_note, e.confidence, c.condition FROM formal.evidence_link l
    JOIN formal.evidence e ON e.evidence_id = l.evidence_id JOIN formal.claim c ON c.claim_id = l.claim_id ORDER BY l.evidence_id, l.claim_id`).all() as Row[];
  assert.deepEqual(rows.map((r) => [r["evidence_id"], r["claim_id"], r["scope_note"], r["confidence"], r["condition"]]), [
    ["X-EVA", "X-C1", "1787 金閶綠蔭堂藏板重刊本", "A", "以何者为界（交节当日或瞬间）未决"],
    ["X-EVA", "X-C2", "卷一", "A", null],
    ["X-EVC", "X-C1", null, "C", "以何者为界（交节当日或瞬间）未决"],
  ], "同一证据对两主张范围不同而可信度相同；同一主张两证据可信度不同而条件相同");
  rejects(() => link(w, "X-EVA", "X-C2", "partial"), "DB-E-evidence_link.directness");
});

test("A-6：§12.2 追加查询——链接没有任何角色被查出；补上角色后清零", () => {
  const w = world();
  ev(w, "X-EV"); claim(w, "X-C1", "P-B-02"); link(w, "X-EV", "X-C1");
  assert.deepEqual(evidenceChecks["Q-X-05-8"](w.db).map((r) => r["id"]), ["X-EV|X-C1"]);
  role(w, "X-EV", "X-C1", "支持");
  assert.deepEqual(evidenceChecks["Q-X-05-8"](w.db), []);
});

test("A-7：个人证据链到正式主张，正式 R-I-4 不计入；个人链接同构（角色两值、角色说明必填）", () => {
  const w = world();
  claim(w, "X-C1", "P-B-02");
  const db = w.db;
  db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR', 'b', NULL, ?, NULL, 'OWNER', NULL)").run(w.rel);
  ins(db, "main", "personal_evidence", { evidence_id: "X-PEV", branch_id: "X-BR", evidence_tier: "E4", evidence_category: "C-B", evidence_status: "UNVERIFIED", claim_status: "推断", confidence: "C", origin: "human", formal_status: "NON_FORMAL",
    ...Object.fromEntries((db.prepare("PRAGMA main.table_info(personal_evidence)").all() as { name: string }[]).map((c) => c.name)
      .filter((c) => !["evidence_id", "branch_id", "evidence_tier", "evidence_category", "evidence_status", "claim_status", "confidence", "origin", "formal_status"].includes(c)).map((c) => [c, null])) });
  ins(db, "main", "personal_evidence_link", { evidence_id: "X-PEV", claim_release: w.rel, claim_id: "X-C1", claim_hash: "h", directness: "direct", scope_note: null, branch_id: "X-BR" });
  ins(db, "main", "personal_evidence_link_role", { evidence_id: "X-PEV", claim_id: "X-C1", role: "支持", role_note: "个人研究支持" });
  rejects(() => ins(db, "main", "personal_evidence_link_role", { evidence_id: "X-PEV", claim_id: "X-C1", role: "限定", role_note: "x" }), "DB-E-personal_evidence_link_role.role");
  rejects(() => ins(db, "main", "personal_evidence_link_role", { evidence_id: "X-PEV", claim_id: "X-C1", role: "反证", role_note: "" }), "DB-F-18b-personal");
  assert.deepEqual(flagged(w), [], "个人证据不进正式判定");
});
