// 定点修订 C：计算状态判定逐子项检查变体状态（无变体、多个未选、唯一可选），任一必需子项不可用即 BLOCKED-FORMAL，
// 不得被他子项掩盖；阻断时只留审计事件，不生成快照、依赖、轨迹或原因行。
import test from "node:test";
import assert from "node:assert/strict";
import { judge, variantState } from "../../db/governance.js";
import { buildPlan, prepareConfig, prepareInput } from "../../db/pipeline.js";
import { cases, loadWorld, type Rec, type WorldEdit } from "../fixtures/load.js";
import { openMemoryDb } from "../../db/connect.js";
import { count, runCase } from "./helpers.js";

const LY = () => cases().cases.find((x) => x.case_id === "E2E-LY-1")!;
const variantRow = (id: string, component: string, version = 1): Rec => ({ t: "rule_variant", r: { rule_variant_id: id, component_id: component, version_no: version, confidence: "C" },
  content: { kind: "algorithm", calc_function_id: "x", note: id } });
const compRow = (id: string, fn: string): Rec => ({ t: "rule_component", r: { component_id: id, rule_id: "P-B-02", evidence_category: "C-B", is_calendar_anchor: null, calc_function_id: fn, applicability_domain: "LIUYAO" } });

function blockedOnly(edit: WorldEdit, expected: RegExp) {
  const w = loadWorld("G2", openMemoryDb(), edit);
  const before = ["calculation_snapshot", "snapshot_dependency", "execution_trace_step", "snapshot_non_formal_reason", "snapshot_resolved_context"].map((t) => count(w.db, t));
  const r = runCase("G2", "E2E-LY-1", { w });
  assert.equal(r.out.status, "BLOCKED");
  if (r.out.status === "BLOCKED") { assert.equal(r.out.judgment.kind, "BLOCKED-FORMAL"); assert.match(r.out.judgment.code, expected); }
  const after = ["calculation_snapshot", "snapshot_dependency", "execution_trace_step", "snapshot_non_formal_reason", "snapshot_resolved_context"].map((t) => count(w.db, t));
  assert.deepEqual(after, before, "不生成快照、依赖、轨迹、原因、解析上下文");
  assert.equal(count(w.db, "blocked_audit_event"), 1, "只留一条阻断审计事件");
  return r;
}

test("C-1：单个子项没有任何变体 → BLOCKED-FORMAL VARIANT_MISSING（不抛异常、不生成快照）", () => {
  const ex: WorldEdit["exclude"] = (rec) => (rec.t === "rule_variant" && rec.r["component_id"] === "P-B-02") || (rec.t === "approval_record" && rec.r["target_id"] === variantIdOf("P-B-02"));
  const w = loadWorld("G2", openMemoryDb(), { exclude: ex });
  assert.deepEqual(variantState(w.db, "P-B-02"), { state: "NONE" });
  blockedOnly({ exclude: ex }, /^VARIANT_MISSING:P-B-02:LY-03$/);
});

test("C-2：同一函数两个子项，一个有变体、另一个没有 → 不被有变体者掩盖，BLOCKED-FORMAL", () => {
  blockedOnly({ extra: [compRow("X-RC-NAJIA-2", "liuyao.najia")] }, /^VARIANT_MISSING:X-RC-NAJIA-2:LY-03$/);
});

test("C-3：多个变体但没有完成选择（无现行默认）→ BLOCKED-FORMAL VARIANT_UNSELECTED", () => {
  const w = loadWorld("G2", openMemoryDb(), { extra: [variantRow("X-RV-PB02-2", "P-B-02", 2)] });
  assert.deepEqual(variantState(w.db, "P-B-02"), { state: "UNSELECTED", count: 2 });
  blockedOnly({ extra: [variantRow("X-RV-PB02-2", "P-B-02", 2)] }, /^VARIANT_UNSELECTED:P-B-02:LY-03$/);
});

test("C-4：多子项组合中变体状态不一致（唯一可选 + 未选 + 缺失）→ 逐子项检查，按子项序报第一个不可用者", () => {
  const extra = [compRow("X-RC-A", "liuyao.najia"), variantRow("X-RV-A1", "X-RC-A", 1), variantRow("X-RV-A2", "X-RC-A", 2), compRow("X-RC-B", "liuyao.najia")];
  const w = loadWorld("G2", openMemoryDb(), { extra });
  assert.equal(variantState(w.db, "P-B-02").state, "SINGLE");
  assert.equal(variantState(w.db, "X-RC-A").state, "UNSELECTED");
  assert.equal(variantState(w.db, "X-RC-B").state, "NONE");
  blockedOnly({ extra }, /^VARIANT_UNSELECTED:X-RC-A:LY-03$/); // 子项按 ID 排序：P-B-02（可选）→ X-RC-A（未选，先报）→ X-RC-B（缺失）
  // 只留可选者以外的一个缺失：仍阻断
  blockedOnly({ extra: [compRow("X-RC-B", "liuyao.najia")] }, /^VARIANT_MISSING:X-RC-B:LY-03$/);
});

test("C-5：函数级未裁决争议在“任一子项不可选”时阻断，不因其他子项可选而放行", () => {
  // G1 原有用例：日界函数没有登记子项 → DISPUTE_UNRESOLVED（保持）
  const g1 = runCase("G1", "E2E-LY-1");
  assert.ok(g1.out.status === "BLOCKED" && /^DISPUTE_UNRESOLVED:.*:LY-06$/.test(g1.out.judgment.code));
  // G1N 六爻：日界子项唯一可选、争议已裁决 → 放行（NON_FORMAL）
  assert.equal(runCase("G1N", "E2E-LY-1").out.status, "NON_FORMAL");
});

test("C-6：正常路径不受影响——唯一可选或现行默认的子项照常判定；judge 不抛异常", () => {
  const c = LY();
  const w = loadWorld("G2");
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  const cfg = prepareConfig({ ...c.config, module: c.domain });
  const j = judge(w.db, buildPlan(w.db, inp, cfg));
  assert.equal(j.status, "FORMAL");
});

/** 夹具中某子项唯一变体的 ID（读夹具，不写字面 ID） */
function variantIdOf(component: string): string {
  const w = loadWorld("G2");
  return (w.db.prepare("SELECT rule_variant_id FROM formal.rule_variant WHERE component_id = ?").get(component) as { rule_variant_id: string }).rule_variant_id;
}

test("复核 Q-16：P-D-06（节气查表，经 BZ-06 读取）不在 BLK-6 映射内；但其他现行阻断映射到同一步骤时照常阻断，不被绕过", () => {
  const BZ = () => cases().cases.find((x) => x.case_id === "E2E-BZ-1")!;
  const w = loadWorld("G2");
  const blk6 = w.db.prepare("SELECT step_code FROM formal.blocker_step_map WHERE block_id = 'BLK-6' ORDER BY step_code").all() as { step_code: string }[];
  assert.ok(!blk6.some((r) => r.step_code === "BZ-06"), "BLK-6 不映射 BZ-06");
  const c = BZ();
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  const cfg = prepareConfig({ ...c.config, module: c.domain });
  const plan = buildPlan(w.db, inp, cfg);
  assert.ok(plan.steps.some((s) => s.step_code === "BZ-06" && s.status === "完成" && s.rule_functions.includes("calendar.jieqi_lookup")));
  assert.equal(judge(w.db, plan).status, "FORMAL", "G2 下不受 BLK-6 影响");
  const live = w.db.prepare("SELECT block_id FROM formal.v_blocker_current WHERE status = '现行' ORDER BY block_id LIMIT 1").get() as { block_id: string } | undefined;
  assert.ok(live, "G2 仍有现行阻断（B1～B4 / BLK-1～BLK-7 未全部解除）");
  const rel = w.releases.at(-1)!;
  w.db.prepare("INSERT INTO formal.blocker_step_map (block_id, step_code, effect, condition_note, basis_ref, data_release) VALUES (?, 'BZ-06', 'BLOCKED-FORMAL', NULL, '复核 Q-16 构造', ?)").run(live.block_id, rel);
  const j = judge(w.db, buildPlan(w.db, inp, cfg));
  assert.equal(j.status, "BLOCKED");
  // E2-FIX-4 起：未列入必备清单的映射本身即被拦（BLOCKER_MAP_UNLISTED），同样不放行
  if (j.status === "BLOCKED") assert.match(j.code, new RegExp(`${live.block_id}`));
});
