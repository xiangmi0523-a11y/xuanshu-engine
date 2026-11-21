// E2-FIX D：矩阵自证。db/spec.json 为独立规格（清单第 4 节摘录 + 补充出处表生成，不读 DDL）；
// 本文件检验 (1) 规格与 DDL 双向一致；(2) 删除 / 改动约束的变异 DDL 必然被比对与矩阵查出。
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ddlText, openMemoryDb } from "../../db/connect.js";
import { readRepo } from "../helpers/load.js";
import { spec, tablesWithBase } from "./helpers.js";
import { runDbE, runDbK, runDbN2 } from "./matrix_lib.js";
import { ddlModel, diffSpec } from "./specdiff.js";

type Sql = { formal: string; user: string };
/** 变异：在某个 DDL 文件中把恰好出现一次的片段替换掉 */
function mutate(file: keyof Sql, from: string, to: string): Sql {
  const s = ddlText();
  const n = s[file].split(from).length - 1;
  assert.equal(n, 1, `变异片段在 ${file}.sql 中应恰出现一次：${from}`);
  return { ...s, [file]: s[file].replace(from, to) };
}
const diffOf = (sql: Sql) => diffSpec(ddlModel(openMemoryDb({ sql })), spec());

test("D-1：独立规格与 DDL 双向一致——缺失、多出、变更均为 0（表、枚举值与可空、约束名、外键目标与延迟）", () => {
  const d = diffSpec(ddlModel(openMemoryDb()), spec());
  assert.deepEqual(d, { missing: [], extra: [], changed: [] });
});

test("D-2：规格来源独立——每个枚举、外键都有出处；出处与补充表不引用 DDL；规格输入摘要与当前输入一致", () => {
  const sp = spec() as ReturnType<typeof spec> & { inputs: { checklist_s4_sha256: string; sources_sha256: string } };
  let enums = 0, fks = 0, fromChecklist = 0, engineering = 0;
  for (const [t, s] of Object.entries(sp.tables)) {
    for (const [c, e] of Object.entries(s.enums)) { enums++; assert.ok(e.src && e.src.length > 0, `${t}.${c} 缺出处`); if (/^清单 [FU]\d/.test(e.src)) fromChecklist++; if (e.src.includes("工程补充")) engineering++; }
    for (const f of s.fks) { fks++; assert.ok(f.src && f.src.length > 0, `${t}(${f.from}) 缺出处`); if (/^清单 [FU]\d/.test(f.src)) fromChecklist++; if (f.src.includes("工程补充")) engineering++; }
  }
  const sources = readRepo("db/spec/sources.json");
  assert.doesNotMatch(sources, /formal\.sql|user\.sql|sqlite_master|DDL 取/, "补充出处表不得以 DDL 为出处");
  assert.ok(enums >= 85 && fks >= 105, `枚举 ${enums}、外键 ${fks}`);
  assert.ok(fromChecklist > 100, `直接取自清单第 4 节的条目 ${fromChecklist}`);
  assert.ok(engineering < 40, `工程补充条目 ${engineering}（逐条列入验收报告）`);
  assert.equal(sp.inputs.checklist_s4_sha256, createHash("sha256").update(readRepo("db/spec/checklist_s4.md")).digest("hex"));
  assert.equal(sp.inputs.sources_sha256, createHash("sha256").update(sources).digest("hex"));
});

// ---------------------------------------------------------------- 变异测试：每一种都必须被查出
const mutations: { name: string; file: keyof Sql; from: string; to: string; expect: (d: ReturnType<typeof diffSpec>) => boolean; matrix: "E" | "K" | "N2" | "diff" }[] = [
  { name: "删除必填枚举 CHECK（evidence_link_role.role）", file: "formal", from: `CONSTRAINT "DB-E-evidence_link_role.role" CHECK (role IN ('支持','反证'))`, to: "",
    expect: (d) => d.missing.includes("枚举 evidence_link_role.role"), matrix: "E" },
  { name: "删除可空枚举 CHECK（passage.result）", file: "formal", from: `CONSTRAINT "DB-E-passage.result" CHECK (result IS NULL OR result IN ('MATCH','MISMATCH','PARTIAL'))`, to: "",
    expect: (d) => d.missing.includes("枚举 passage.result"), matrix: "E" },
  { name: "枚举多放一个值（text_variant.impact_level 加 'other'）", file: "formal", from: `CHECK (impact_level IN ('none','wording_only','calculation'))`, to: `CHECK (impact_level IN ('none','wording_only','calculation','other'))`,
    expect: (d) => d.changed.some((x) => x.startsWith("枚举 text_variant.impact_level：值")), matrix: "diff" }, // 多放的值不在规格内，行为矩阵无从得知，只能靠静态比对
  { name: "枚举少一个值（branch_status_history.new_status 去掉 merged）", file: "user", from: `CHECK (new_status IN ('active','promoted','merged','abandoned'))`, to: `CHECK (new_status IN ('active','promoted','abandoned'))`,
    expect: (d) => d.changed.some((x) => x.startsWith("枚举 branch_status_history.new_status：值")), matrix: "E" },
  { name: "可空枚举改为不许 NULL（text_variant.preferred_reading）", file: "formal", from: `CHECK (preferred_reading IS NULL OR preferred_reading IN ('a','b'))`, to: `CHECK (preferred_reading IN ('a','b'))`,
    expect: (d) => d.changed.some((x) => x.startsWith("枚举 text_variant.preferred_reading：可空")), matrix: "diff" }, // SQLite 的 CHECK 对 NULL 视为通过，去掉 IS NULL OR 行为不变，静态比对查出写法偏离
  { name: "枚举约束换名（formal_status_history.target_type 的 DB-F-20）", file: "formal", from: `CONSTRAINT "DB-F-20" CHECK`, to: `CONSTRAINT "DB-X-20" CHECK`,
    expect: (d) => d.changed.some((x) => x.startsWith("枚举 formal_status_history.target_type：约束名")), matrix: "E" },
  { name: "删除单列外键（claim.component_id）", file: "formal", from: `  component_id TEXT NOT NULL REFERENCES rule_component(component_id),\n  statement`, to: `  component_id TEXT NOT NULL,\n  statement`,
    expect: (d) => d.missing.includes("外键 claim(component_id) → rule_component"), matrix: "K" },
  { name: "删除复合外键（evidence_link_role → evidence_link）", file: "formal", from: `,\n  FOREIGN KEY (evidence_id, claim_id) REFERENCES evidence_link(evidence_id, claim_id)`, to: "",
    expect: (d) => d.missing.includes("外键 evidence_link_role(evidence_id,claim_id) → evidence_link"), matrix: "K" },
  { name: "延迟外键改为立即（snapshot_dependency.snapshot_id）", file: "user", from: `CREATE TABLE snapshot_dependency (\n  snapshot_id              TEXT NOT NULL REFERENCES calculation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED,`,
    to: `CREATE TABLE snapshot_dependency (\n  snapshot_id              TEXT NOT NULL REFERENCES calculation_snapshot(snapshot_id),`,
    expect: (d) => d.changed.includes("外键 snapshot_dependency(snapshot_id)：延迟 规格 true / DDL false"), matrix: "K" },
  { name: "外键改指别的表（search_record.claim_id → evidence）", file: "formal", from: `  claim_id              TEXT NOT NULL REFERENCES claim(claim_id),`, to: `  claim_id              TEXT NOT NULL REFERENCES evidence(evidence_id),`,
    expect: (d) => d.changed.some((x) => x.startsWith("外键 search_record(claim_id)：目标")), matrix: "K" },
  { name: "DDL 多出规格未要求的外键（claim.condition → passage）", file: "formal", from: `  condition    TEXT,\n  branch_id    TEXT CONSTRAINT "DB-F-03-claim"`, to: `  condition    TEXT REFERENCES passage(passage_id),\n  branch_id    TEXT CONSTRAINT "DB-F-03-claim"`,
    expect: (d) => d.extra.includes("外键 claim(condition) → passage"), matrix: "N2" },
  { name: "必填列改可空（evidence_link.directness 去 NOT NULL）", file: "formal", from: `  directness  TEXT NOT NULL CONSTRAINT "DB-E-evidence_link.directness"`, to: `  directness  TEXT CONSTRAINT "DB-E-evidence_link.directness"`,
    expect: () => true, matrix: "N2" }, // NOT NULL 不在枚举 / 外键比对内，由 DB-N2 双向比对查出
];

const how = (m: (typeof mutations)[number]) => m.name.startsWith("必填列改可空") ? "DB-N2 查出" : m.matrix === "diff" || m.matrix === "N2" ? "双向比对查出" : `双向比对与 DB-${m.matrix} 矩阵均查出`;
for (const m of mutations) test(`D-3 变异：${m.name} → ${how(m)}`, () => {
  const sql = mutate(m.file, m.from, m.to);
  const d = diffOf(sql);
  const total = d.missing.length + d.extra.length + d.changed.length;
  if (!m.name.startsWith("必填列改可空")) {
    assert.ok(total > 0, "双向比对应报差异");
    assert.ok(m.expect(d), `比对结果未含预期差异：${JSON.stringify(d)}`);
  }
  /** 矩阵失败 = 报出失败项，或基准行在变异结构上已无法写入（同样是被查出） */
  const detected = (run: () => { failures: string[] }) => { try { return run().failures.length > 0; } catch { return true; } };
  if (m.matrix === "E") assert.ok(detected(() => runDbE(() => tablesWithBase(sql), spec())), "DB-E 矩阵应失败");
  else if (m.matrix === "K") assert.ok(detected(() => runDbK(() => tablesWithBase(sql), spec())), "DB-K 矩阵应失败");
  else if (m.matrix === "N2") {
    const n2 = runDbN2(openMemoryDb({ sql }), spec());
    if (m.name.startsWith("必填列改可空")) assert.ok(n2.includes("evidence_link.directness：规格必填而 DDL 可空"), `DB-N2 应失败：${JSON.stringify(n2)}`);
  }
});

test("D-4：未变异的 DDL 上三套矩阵全部通过（对照组）", () => {
  assert.deepEqual(runDbE(() => tablesWithBase(), spec()).failures, []);
  assert.deepEqual(runDbK(() => tablesWithBase(), spec()).failures, []);
  assert.deepEqual(runDbN2(openMemoryDb(), spec()), []);
});
