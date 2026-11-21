// E2-FIX-3（用户 2026-11-21 对 E2-FIX-2 的答复）：阻断映射完整性（失效关闭）与 evidence_link 版本记录核查。
// 只用 0e9b295 已有的公共接口，以便在修复前代码上运行同一文件。
import test from "node:test";
import assert from "node:assert/strict";
import { judge } from "../../db/governance.js";
import { buildPlan, prepareConfig, prepareInput } from "../../db/pipeline.js";
import { cases, loadWorld, type LoadedWorld, type WorldEdit } from "../fixtures/load.js";
import { openMemoryDb } from "../../db/connect.js";
import { count, runCase } from "./helpers.js";

const CASE = (id: string) => cases().cases.find((x) => x.case_id === id)!;
function judgeCase(w: LoadedWorld, id: string, rawOver: Record<string, unknown> = {}) {
  const c = CASE(id);
  const inp = prepareInput({ domain: c.domain, raw: { ...c.raw, ...rawOver }, tz: c.tz, normalizer_version: c.normalizer_version });
  return judge(w.db, buildPlan(w.db, inp, prepareConfig({ ...c.config, module: c.domain })));
}
/** G2 中让 BLK-6 回到现行（去掉其“已解除”记录），并按需去掉它的步骤映射 */
const blk6Current = (dropMaps: (step: string) => boolean): WorldEdit => ({ exclude: (rec) =>
  (rec.t === "blocker_change" && rec.r["block_id"] === "BLK-6" && rec.r["new_status"] === "已解除") ||
  (rec.t === "blocker_change" && rec.r["block_id"] === "B4" && rec.r["new_status"] === "已解除") ||
  (rec.t === "blocker_step_map" && rec.r["block_id"] === "BLK-6" && dropMaps(String(rec.r["step_code"]))) });

test("4a-1 反例：BLK-6 现行而全部步骤映射漏导——修复前八字为 FORMAL（失效开放）；修复后 BLOCKED-FORMAL，且不生成快照", () => {
  const w = loadWorld("G2", openMemoryDb(), blk6Current(() => true));
  assert.equal(count(w.db, "formal.blocker_step_map WHERE block_id = 'BLK-6'"), 0);
  const j = judgeCase(w, "E2E-BZ-1");
  assert.equal(j.status, "BLOCKED", `判定：${JSON.stringify(j).slice(0, 200)}`);
  if (j.status === "BLOCKED") { assert.equal(j.kind, "BLOCKED-FORMAL"); assert.match(j.code, /BLK-6/); }
  const before = count(w.db, "calculation_snapshot");
  runCase("G2", "E2E-BZ-1", { w });
  assert.equal(count(w.db, "calculation_snapshot"), before);
});

test("4a-2 反例：只漏导 BLK-6 → BZ-05 一条映射（其余映射仍在）——子项 P-D-02 挂 BLK-6 而该步无映射，查出映射漏导", () => {
  const w = loadWorld("G2", openMemoryDb(), blk6Current((s) => s === "BZ-05"));
  assert.ok(count(w.db, "formal.blocker_step_map WHERE block_id = 'BLK-6'") > 0);
  const j = judgeCase(w, "E2E-BZ-1");
  assert.equal(j.status, "BLOCKED");
  if (j.status === "BLOCKED") assert.match(j.code, /BLK-6:BZ-05/);
});

test("4a-3 反例：B4 现行而 BLK-6 已解除（导入不一致）——B4 自身无映射，修复前放行；修复后按 BLK.4 同一事项沿用 BLK-6 映射而阻断", () => {
  const w = loadWorld("G2", openMemoryDb(), { exclude: (rec) => rec.t === "blocker_change" && rec.r["block_id"] === "B4" && rec.r["new_status"] === "已解除" });
  assert.equal((w.db.prepare("SELECT status FROM formal.v_blocker_current WHERE block_id = 'B4'").get() as { status: string }).status, "现行");
  assert.equal(count(w.db, "formal.blocker_step_map WHERE block_id = 'B4'"), 0);
  const j = judgeCase(w, "E2E-BZ-1");
  assert.equal(j.status, "BLOCKED");
  if (j.status === "BLOCKED") assert.match(j.code, /B4/);
  const ly = judgeCase(w, "E2E-LY-1");
  assert.equal(ly.status, "NON_FORMAL");
  if (ly.status === "NON_FORMAL") assert.ok(ly.reasons.some((r) => r.reason_kind === "BLOCKER_PATH" && r.upstream_id === "B4"));
});

test("4a-4 反例：BLK-5 现行而南半球出生（纬度为负）——修复前 FORMAL（无映射即放行）；修复后输入路径 BLOCKED-HARD；北半球不受影响", () => {
  const w = loadWorld("G2");
  assert.equal(judgeCase(w, "E2E-BZ-1").status, "FORMAL", "对照：北京（北纬）");
  const j = judgeCase(w, "E2E-BZ-1", { latitude: "-33.868800", longitude: "151.209300", place_name: "悉尼" });
  assert.equal(j.status, "BLOCKED");
  if (j.status === "BLOCKED") { assert.equal(j.kind, "BLOCKED-HARD"); assert.match(j.code, /BLK-5/); }
});

test("4a-5：B2 的覆盖方式（库层 ZR-DB-* 约束）缺失时失效关闭——去掉 ZR-DB-missing 约束后判定 BLOCKED-FORMAL", async () => {
  const { ddlText } = await import("../../db/connect.js");
  const t = ddlText();
  const m = /CREATE TRIGGER [^\n]*\n(?:[^\n]*\n)*?[^\n]*ZR-DB-missing[^\n]*\n(?:[^\n]*\n)*?END;\n/.exec(t.user);
  assert.ok(m, "找到 ZR-DB-missing 所在触发器");
  const db = openMemoryDb({ sql: { ...t, user: t.user.replace(m![0], "") } });
  const w = loadWorld("G2", db);
  const j = judgeCase(w, "E2E-BZ-1");
  assert.equal(j.status, "BLOCKED");
  if (j.status === "BLOCKED") assert.match(j.code, /B2/);
});

test("4b 核查：evidence_link / evidence_link_role / claim 不带数据版本，库内无法还原链接首次加入的版本（已知缺口，模型修复方案待批准）", () => {
  const cols = (db: ReturnType<typeof openMemoryDb>, t: string) => (db.prepare(`PRAGMA formal.table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const db = openMemoryDb();
  for (const t of ["claim", "evidence_link", "evidence_link_role"]) assert.ok(!cols(db, t).includes("data_release"), `${t} 无 data_release`);
  // 两个世界：同一链接分别在最早、最晚数据版本之后写入——库内可见内容完全相同，无从区分
  const dump = (w: LoadedWorld) => JSON.stringify(w.db.prepare("SELECT * FROM formal.evidence_link ORDER BY evidence_id, claim_id").all());
  const mk = () => { const w = loadWorld("G2"); return w; };
  const a = mk(); const b = mk();
  for (const w of [a, b]) {
    w.db.prepare("INSERT INTO formal.claim (claim_id, component_id, statement, condition, branch_id) VALUES ('X-C', 'P-B-02', 's', NULL, NULL)").run();
    w.db.prepare("INSERT INTO formal.source (source_id, human_id, attribution_status, attribution_claim_status) VALUES ('X-S', 'X-S', '确定', NULL)").run();
    w.db.prepare("INSERT INTO formal.evidence (evidence_id, human_id, evidence_tier, evidence_category, confidence, verification_method, missing_evidence, next_source, origin, branch_id) VALUES ('X-EV','X-EV','E3','C-B','B',NULL,NULL,NULL,'human',NULL)").run();
    w.db.prepare("INSERT INTO formal.evidence_link (evidence_id, claim_id, directness, scope_note, branch_id) VALUES ('X-EV','X-C','direct',NULL,NULL)").run();
  }
  assert.equal(dump(a), dump(b), "链接行不含任何版本信息");
});
