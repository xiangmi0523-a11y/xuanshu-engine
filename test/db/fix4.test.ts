// E2-FIX-4：F3-1～F3-7 反例。只在隔离内存库内构造；“X-”前缀为测试构造。
import test from "node:test";
import assert from "node:assert/strict";
import { judge, type Plan } from "../../db/governance.js";
import { BAZI_STEPS, LIUYAO_STEPS, buildPlan, prepareConfig, prepareInput } from "../../db/pipeline.js";
import { evidenceChecks, releaseChecks } from "../../db/queries.js";
import { blockerCoverage } from "../../db/constants.js";
import { coverageReview } from "../../db/coverage_review.js";
import { cases, loadWorld, type LoadedWorld, type WorldEdit } from "../fixtures/load.js";
import { openMemoryDb } from "../../db/connect.js";
import { count, ins, rejects, runCase, testHumanCheck } from "./helpers.js";

const CASE = (id: string) => cases().cases.find((x) => x.case_id === id)!;
function planOf(w: LoadedWorld, id: string, raw: (r: Record<string, unknown>) => Record<string, unknown> = (r) => r): Plan {
  const c = CASE(id);
  const inp = prepareInput({ domain: c.domain, raw: raw({ ...c.raw }), tz: c.tz, normalizer_version: c.normalizer_version });
  return buildPlan(w.db, inp, prepareConfig({ ...c.config, module: c.domain }));
}
const J = (w: LoadedWorld, id: string, raw?: (r: Record<string, unknown>) => Record<string, unknown>) => judge(w.db, planOf(w, id, raw));
const code = (j: ReturnType<typeof judge>) => (j.status === "BLOCKED" ? `${j.kind}|${j.code}` : j.status);

// ---------------------------------------------------------------- F3-1 南半球与缺坐标
test("F3-1 反例：八字输入缺纬度（字段缺失，或纬度恰为 0.000000）且 BLK-5 现行——修复前 FORMAL 并封存；修复后不得 FORMAL、不封存（临时 BLOCKED-FORMAL，产品口径待裁决）", () => {
  const w = loadWorld("G2");
  const noLat = (r: Record<string, unknown>) => { delete r["latitude"]; delete r["longitude"]; return r; };
  assert.equal(code(J(w, "E2E-BZ-1", noLat)), "BLOCKED-FORMAL|BLOCKER_INPUT_UNKNOWN:BLK-5:BZ-01", "缺失");
  assert.equal(code(J(w, "E2E-BZ-1", (r) => ({ ...r, latitude: "0.000000" }))), "BLOCKED-FORMAL|BLOCKER_INPUT_UNKNOWN:BLK-5:BZ-01", "赤道 0");
  // 存在但格式不合（空串、空白、非数）在输入规范化层即被拒（DB-H-11），不进入判定
  for (const v of ["", "  ", "北纬", "-33.8"]) assert.throws(() => planOf(w, "E2E-BZ-1", (r) => ({ ...r, latitude: v })), /DB-H-11/, `格式不合：${JSON.stringify(v)}`);
  assert.equal(code(J(w, "E2E-BZ-1", (r) => ({ ...r, latitude: "-33.868800" }))), "BLOCKED-HARD|BLOCKER_INPUT_PATH:BLK-5:BZ-01", "南半球");
  assert.equal(J(w, "E2E-BZ-1").status, "FORMAL", "北半球不受影响");
  assert.equal(J(w, "E2E-LY-1").status, "FORMAL", "六爻不读出生地，不受影响");
  const before = count(w.db, "calculation_snapshot");
  const raw = noLat({ ...CASE("E2E-BZ-1").raw } as Record<string, unknown>);
  const r = runCase("G2", "E2E-BZ-1", { w, raw, inputId: "X-IN-NOLAT" });
  assert.equal(r.out.status, "BLOCKED");
  assert.equal(count(w.db, "calculation_snapshot"), before, "不封存");
});

test("F3-1：BLK-5 已解除（隔离库内模拟）时缺纬度照常计算——临时措施只在 BLK-5 现行时生效", () => {
  const w = loadWorld("G2");
  const s = (w.db.prepare("SELECT max(sequence_no) + 1 AS s FROM formal.blocker_change").get() as { s: number }).s;
  w.db.prepare("INSERT INTO formal.blocker_change (change_id, block_id, previous_status, new_status, user_ruling_ref, data_release, sequence_no) VALUES ('X-CH5', 'BLK-5', '现行', '已解除', 'X-模拟', ?, ?)").run(w.releases.at(-1)!, s);
  assert.equal(J(w, "E2E-BZ-1", (r) => { delete r["latitude"]; delete r["longitude"]; return r; }).status, "FORMAL");
});

// ---------------------------------------------------------------- F3-2 映射逐步骤、逐效果
/** G2 中让 BLK-6、B4 同为现行（pair 一致），再施以变造 */
const pairCurrent = (more: WorldEdit["exclude"] = () => false): WorldEdit => ({ exclude: (r) =>
  (r.t === "blocker_change" && ["BLK-6", "B4"].includes(String(r.r["block_id"])) && r.r["new_status"] === "已解除") || more(r) });
const mapRow = (b: string, s: string) => (r: { t: string; r: Record<string, unknown> }) => r.t === "blocker_step_map" && r.r["block_id"] === b && r.r["step_code"] === s;
function addMap(w: LoadedWorld, b: string, step: string, effect: string) {
  w.db.prepare("INSERT INTO formal.blocker_step_map (block_id, step_code, effect, condition_note, basis_ref, data_release) VALUES (?, ?, ?, NULL, 'X-变造', ?)").run(b, step, effect, w.releases[0]!);
}
const f26 = (w: LoadedWorld) => releaseChecks["Q-F-26"](w.db).map((r) => `${r["code"]}:${r["block_id"]}`);

test("F3-2 反例：单行映射效果错误（BLK-6 → BZ-05 写成 NON_FORMAL）——修复前八字 NON_FORMAL；修复后 BLOCKED-FORMAL，发布检查报出", () => {
  const w = loadWorld("G2", openMemoryDb(), pairCurrent(mapRow("BLK-6", "BZ-05")));
  addMap(w, "BLK-6", "BZ-05", "NON_FORMAL");
  assert.match(code(J(w, "E2E-BZ-1")), /^BLOCKED-FORMAL\|BLOCKER_MAP_EFFECT:/);
  assert.ok(f26(w).some((x) => x.startsWith("BLOCKER_MAP_EFFECT")));
});

test("F3-2 反例：双重漏导（BZ-05 映射与 P-D-02 子项关联同时缺失）——修复前 NON_FORMAL；修复后 BLOCKED-FORMAL，发布检查报出两项", () => {
  const w = loadWorld("G2", openMemoryDb(), pairCurrent((r) => mapRow("BLK-6", "BZ-05")(r) || (r.t === "component_blocker" && r.r["component_id"] === "P-D-02")));
  assert.match(code(J(w, "E2E-BZ-1")), /^BLOCKED-FORMAL\|BLOCKER_(MAP|LINK)_MISSING:/);
  const p = f26(w);
  assert.ok(p.some((x) => x.startsWith("BLOCKER_MAP_MISSING")) && p.some((x) => x.startsWith("BLOCKER_LINK_MISSING")), JSON.stringify(p));
});

test("F3-2 反例：pair 冲突——BLK-6 映射正确而 B4 自身另登记 BZ-05 为 NON_FORMAL；B4 现行、BLK-6 已解除时漏导 BZ-05", () => {
  const w = loadWorld("G2", openMemoryDb(), pairCurrent());
  addMap(w, "B4", "BZ-05", "NON_FORMAL");
  assert.match(code(J(w, "E2E-BZ-1")), /BLOCKER_MAP_EFFECT:B4/);
  const w2 = loadWorld("G2", openMemoryDb(), { exclude: (r) => (r.t === "blocker_change" && r.r["block_id"] === "B4" && r.r["new_status"] === "已解除") || mapRow("BLK-6", "BZ-05")(r) });
  assert.match(code(J(w2, "E2E-BZ-1")), /^BLOCKED-FORMAL\|BLOCKER_(PAIR_STATE|MAP_MISSING):/);
  assert.match(code(J(w2, "E2E-LY-1")), /^BLOCKED-FORMAL\|/);
});

test("F3-2：未列入必备清单的映射、只缺子项关联、映射全对时——前两者阻断，最后者照常（G2 FORMAL）", () => {
  const w = loadWorld("G2", openMemoryDb(), pairCurrent());
  addMap(w, "BLK-6", "BZ-08", "NON_FORMAL");
  assert.match(code(J(w, "E2E-BZ-1")), /BLOCKER_MAP_UNLISTED/);
  const w2 = loadWorld("G2", openMemoryDb(), pairCurrent((r) => r.t === "component_blocker" && r.r["component_id"] === "P-D-04"));
  assert.match(code(J(w2, "E2E-LY-1")), /BLOCKER_LINK_MISSING/);
  const ok = loadWorld("G2");
  assert.equal(J(ok, "E2E-BZ-1").status, "FORMAL");
  assert.deepEqual(f26(ok), []);
});

test("F3-2：已解除的阻断映射有误时判定不受影响（只核验现行），但发布前检查照样报出", () => {
  const w = loadWorld("G2", openMemoryDb(), { exclude: mapRow("BLK-6", "BZ-07") }); // G2 中 BLK-6、B4 已解除
  assert.equal(J(w, "E2E-BZ-1").status, "FORMAL");
  assert.ok(f26(w).some((x) => x.startsWith("BLOCKER_MAP_MISSING")));
});

// ---------------------------------------------------------------- F3-3 新增入口须复核
test("F3-3：覆盖复核清单与引擎步骤表、所读函数、[blocker_coverage] 逐项相等（新增或改动即失败）", () => {
  const rev = coverageReview();
  const inv = (steps: typeof BAZI_STEPS) => Object.fromEntries(steps.map((d) => [d.step, d.reads]));
  assert.deepEqual(rev.modules, { BAZI: inv(BAZI_STEPS), LIUYAO: inv(LIUYAO_STEPS) }, "引擎步骤 / 函数有变动：须复核 no_entry 与 input_path 阻断并更新 db/spec/coverage_review.json");
  assert.deepEqual(rev.reviewed_coverage, Object.fromEntries(blockerCoverage()), "[blocker_coverage] 有变动：须重新复核");
  for (const [b, k] of blockerCoverage()) if (k === "no_entry") assert.ok(rev.no_entry[b]?.trim(), `${b} 缺复核结论`);
  // 允许跳过的步骤须与 buildPlan 实际会跳过的一致（G2 两用例 + CFG-02 = false）
  const w = loadWorld("G2");
  for (const [id, mod] of [["E2E-BZ-1", "BAZI"], ["E2E-LY-1", "LIUYAO"]] as const) {
    const skipped = planOf(w, id).steps.filter((s) => s.status !== "完成").map((s) => s.step_code);
    for (const s of skipped) assert.ok(rev.skippable[mod]!.includes(s), `${s} 被跳过而未列入 skippable`);
  }
  assert.deepEqual(Object.keys(rev.no_entry).sort(), [...blockerCoverage()].filter(([, k]) => k === "no_entry").map(([b]) => b).sort());
});

test("F3-3 反例：计划中出现未经复核的步骤、计算函数或模块——判定 BLOCKED-FORMAL（不靠注释提醒）", () => {
  const w = loadWorld("G2");
  const p = planOf(w, "E2E-BZ-1");
  const extraStep: Plan = { ...p, steps: [...p.steps, { step_code: "BZ-14", status: "完成", rule_functions: ["bazi.xiaoyun"], params: [], trace_function: "bazi.xiaoyun" } as never] };
  assert.match(code(judge(w.db, extraStep)), /COVERAGE_REVIEW_MISSING:BZ-14/);
  const extraFn: Plan = { ...p, steps: p.steps.map((s) => (s.step_code === "BZ-09" ? { ...s, rule_functions: [...s.rule_functions, "bazi.mangpai"] } : s)) };
  assert.match(code(judge(w.db, extraFn)), /COVERAGE_REVIEW_MISSING:bazi\.mangpai:BZ-09/);
  // 以“跳过”绕开阻断：把 BZ-05（BLK-6 公式路径所在步骤）标为未执行
  const skip05: Plan = { ...p, steps: p.steps.map((s) => (s.step_code === "BZ-05" ? { ...s, status: "未执行", skip_kind: "范围外", reason: "x", rule_functions: [] } as never : s)) };
  assert.match(code(judge(w.db, skip05)), /COVERAGE_REVIEW_SKIP:BZ-05/);
  const fengshui = { ...p, module: "FENGSHUI" } as unknown as Plan;
  assert.match(code(judge(w.db, fengshui)), /COVERAGE_REVIEW_MISSING:FENGSHUI/);
});

// ---------------------------------------------------------------- F3-4 发布前兜底
function g6World() {
  const w = loadWorld("G0");
  const db = w.db;
  ins(db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
  ins(db, "formal", "edition", { edition_id: "X-E", source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: "原刊本", confidence: "A", branch_id: null });
  ins(db, "formal", "passage", { passage_id: "X-P", edition_id: "X-E", chapter_label: "卷一", paragraph_no: 1, text: "t", volume_page: "n30", image_ref: "img", verified_by: "X-影像", verified_at: "2026-05-07",
    against_what: JSON.stringify({ v: 1, edition: "X-E", image: "n30" }), result: "MISMATCH" });
  ins(db, "formal", "evidence", { evidence_id: "X-EV", human_id: "X-EV", evidence_tier: "E1", evidence_category: "C-B", confidence: "A", verification_method: "影印本对校", missing_evidence: null, next_source: null, origin: "human", branch_id: null });
  ins(db, "formal", "evidence_passage", { evidence_id: "X-EV", passage_id: "X-P" });
  return w;
}
let seq = 800;
const fsh = (w: LoadedWorld, v: string) => ins(w.db, "formal", "formal_status_history", { target_type: "Evidence", target_id: "X-EV", previous_value: null, new_value: v, data_release: w.releases[0]!, sequence_no: seq++ });
const esh = (w: LoadedWorld, v: string) => ins(w.db, "formal", "evidence_status_history", { target_type: "Evidence", target_id: "X-EV", field: "evidence_status", previous_value: null, new_value: v, data_release: w.releases[0]!, sequence_no: seq++ });

test("F3-4 反例：写入门禁被绕过（触发器缺失）时，发布前查询仍查出 FORMAL 缺有效人工核验、PRIMARY_VERIFIED 段落非 MATCH", () => {
  const w = g6World();
  w.db.exec("DROP TRIGGER formal.formal_status_g6_bi; DROP TRIGGER formal.evidence_status_g6_bi;");
  fsh(w, "FORMAL");
  assert.deepEqual(evidenceChecks["Q-X-05-10"](w.db).map((r) => r["evidence_id"]), ["X-EV"], "FORMAL 无核验记录");
  esh(w, "PRIMARY_VERIFIED");
  assert.deepEqual(evidenceChecks["Q-X-05-11"](w.db).map((r) => r["evidence_id"]), ["X-EV"], "段落 MISMATCH");
  assert.deepEqual(evidenceChecks["Q-X-05-3"](w.db).map((r) => r["evidence_id"]), ["X-EV"], "七项查询同样认 MATCH");
  // 核验日期晚于 FORMAL 记录所属数据版本日期：仍查出
  ins(w.db, "formal", "manual_check_record", { check_id: "X-MC", evidence_id: "X-EV", edition_id: "X-E", checked_by: "X-测试核对员", checked_at: "2099-01-01", page_range: "n30", evidence_scope: "X-P|X-E|n30" });
  assert.equal(evidenceChecks["Q-X-05-10"](w.db).length, 1, "核验日期晚于版本日期不算");
  testHumanCheck(w.db, "X-EV");
  assert.deepEqual(evidenceChecks["Q-X-05-10"](w.db), [], "相符且日期不晚：清零");
});

// ---------------------------------------------------------------- F3-5 核对人与日期
test("F3-5 反例：空串、纯空白（含全角空格、制表符）核对人被拒；日期格式错误或无效被拒；核验日期晚于数据版本日期不能用于 FORMAL", () => {
  const w = g6World();
  const rec = { check_id: "X-MC", evidence_id: "X-EV", edition_id: "X-E", checked_by: "X-测试核对员", checked_at: "2026-11-21", page_range: "n30", evidence_scope: "X-P|X-E|n30" };
  for (const who of ["", "   ", "\t", "　　"]) rejects(() => ins(w.db, "formal", "manual_check_record", { ...rec, checked_by: who }), "DB-G6-checker-empty");
  for (const d of ["2026/11/21", "2026-13-01", "2026-02-30", "", "20261121", "2026-11-21T08:00"]) rejects(() => ins(w.db, "formal", "manual_check_record", { ...rec, checked_at: d }), "DB-G6-date");
  ins(w.db, "formal", "manual_check_record", { ...rec, checked_at: "2026-11-22" }); // G0 数据版本日期为 2026-11-21
  rejects(() => fsh(w, "FORMAL"), "DB-G6-FORMAL");
  ins(w.db, "formal", "manual_check_record", { ...rec, check_id: "X-MC2", checked_at: "2026-11-20" });
  fsh(w, "FORMAL");
});

// ---------------------------------------------------------------- F3-6 当前阻断状态
test("F3-6 反例：B4、BLK-6 同版解除后 BLK-6 又改回现行（B4 仍已解除）——修复前 Q-F-25 不报；修复后报出当前状态不一致，判定失效关闭", () => {
  const w = loadWorld("G2");
  const last = w.releases.at(-1)!;
  const s = (w.db.prepare("SELECT max(sequence_no) + 1 AS s FROM formal.blocker_change").get() as { s: number }).s;
  w.db.prepare("INSERT INTO formal.blocker_change (change_id, block_id, previous_status, new_status, user_ruling_ref, data_release, sequence_no) VALUES ('X-CH', 'BLK-6', '已解除', '现行', 'X-变造', ?, ?)").run(last, s);
  const r = releaseChecks["Q-F-25"](w.db);
  assert.ok(r.some((x) => String(x["data_release"]).startsWith("CURRENT:")), JSON.stringify(r));
  assert.match(code(J(w, "E2E-LY-1")), /^BLOCKED-FORMAL\|BLOCKER_PAIR_STATE/);
});

// ---------------------------------------------------------------- F3-7 发布前静态检查
test("F3-7：覆盖缺失、映射效果错误、子项关联缺失、pair 不一致都在发布前检查（Q-F-26）报出，不必等到计算；真实夹具各场景为 0 行", () => {
  for (const sc of ["G0", "G1", "G1N:BAZI", "G1N:LIUYAO", "G2"]) assert.deepEqual(releaseChecks["Q-F-26"](loadWorld(sc).db), [], sc);
  const w = loadWorld("G0", openMemoryDb(), { exclude: (r) => mapRow("BLK-7", "BZ-03")(r) || (r.t === "component_blocker" && r.r["component_id"] === "P-D-08-b") });
  const p = f26(w);
  assert.ok(p.includes("BLOCKER_MAP_MISSING:BLK-7") && p.includes("BLOCKER_MAP_MISSING:B1") && p.includes("BLOCKER_LINK_MISSING:BLK-7"), JSON.stringify(p));
  const w2 = loadWorld("G0", openMemoryDb(), { exclude: (r) => r.t === "blocker" && r.r["block_id"] === "BLK-5" || (r.t === "blocker_change" && r.r["block_id"] === "BLK-5") });
  assert.ok(f26(w2).includes("BLOCKER_REGISTRY_MISSING:BLK-5"));
});
