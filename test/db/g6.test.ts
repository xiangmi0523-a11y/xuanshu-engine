// E2-FIX-2 P2-2：G-6 人工核验写入门禁。只在隔离内存库内构造；“X-测试核对员”为测试占位，不代表任何真实核验。
// E-B13 用例按契约 R-39.13 的范围（1787 重刊本、卷一 n30 / n31）构造，不写入任何真实核验记录。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { evidenceChecks } from "../../db/queries.js";
import { loadWorld } from "../fixtures/load.js";
import { ins, rejects, testHumanCheck, type Row } from "./helpers.js";

let seq = 700;
function world(): { db: DatabaseSync; rel: string } {
  const w = loadWorld("G0");
  const db = w.db;
  ins(db, "formal", "source", { source_id: "X-S", human_id: "X-S", attribution_status: "确定", attribution_claim_status: null });
  for (const [id, st] of [["X-E1787", "原刊本"], ["X-EMOD", "转录本（未与影印本对校）"]] as const)
    ins(db, "formal", "edition", { edition_id: id, source_id: "X-S", parent_edition_id: null, base_text: null, transcription_status: st, confidence: st === "原刊本" ? "A" : "B", branch_id: null });
  const seven = (page: string): Row => ({ image_ref: `archive.org/20260507_20260507_0428/page/${page}`, verified_by: "X-影像记录", verified_at: "2026-05-07",
    against_what: JSON.stringify({ v: 1, edition: "X-E1787", image: page }), result: "MATCH" });
  ins(db, "formal", "passage", { passage_id: "X-P30", edition_id: "X-E1787", chapter_label: "卷一", paragraph_no: 1, text: "月破定例", volume_page: "n30", ...seven("n30") });
  ins(db, "formal", "passage", { passage_id: "X-P31", edition_id: "X-E1787", chapter_label: "卷一", paragraph_no: 2, text: "月破定例（续）", volume_page: "n31", ...seven("n31") });
  ins(db, "formal", "passage", { passage_id: "X-PM", edition_id: "X-EMOD", chapter_label: "卷一", paragraph_no: 1, text: "月破定例", volume_page: "12", ...seven("12") });
  return { db, rel: w.releases.at(-1)! };
}
/** 按 E-B13 的形态建证据：1787 刊本 n30、n31；E1；confidence A；核对方式含影印本对校；来源为 AI 输出（M-6 由 Muse 完成） */
function eb13(db: DatabaseSync, id = "X-EB13", over: Row = {}) {
  ins(db, "formal", "evidence", { evidence_id: id, human_id: id, evidence_tier: "E1", evidence_category: "C-B", confidence: "A", verification_method: "影印本对校（IA 扫描叶直读）",
    missing_evidence: null, next_source: null, origin: "ai_output", branch_id: null, ...over });
  ins(db, "formal", "evidence_passage", { evidence_id: id, passage_id: "X-P30" });
  ins(db, "formal", "evidence_passage", { evidence_id: id, passage_id: "X-P31" });
}
const status = (w: { db: DatabaseSync; rel: string }, id: string, v: string, prev: string | null = null) =>
  ins(w.db, "formal", "evidence_status_history", { target_type: "Evidence", target_id: id, field: "evidence_status", previous_value: prev, new_value: v, data_release: w.rel, sequence_no: seq++ });
const formal = (w: { db: DatabaseSync; rel: string }, id: string, v: string) =>
  ins(w.db, "formal", "formal_status_history", { target_type: "Evidence", target_id: id, previous_value: null, new_value: v, data_release: w.rel, sequence_no: seq++ });
const check = (db: DatabaseSync, over: Row = {}) => ins(db, "formal", "manual_check_record", { check_id: "X-MC", evidence_id: "X-EB13", edition_id: "X-E1787",
  checked_by: "X-测试核对员", checked_at: "2026-11-21", page_range: "n30,n31", evidence_scope: "X-P30|X-E1787|n30;X-P31|X-E1787|n31", ...over });

test("G6-1 E-B13：G-6 未满足（无人工核验记录）时不能 PRIMARY_VERIFIED，不能 FORMAL，AI 来源也不能升到 SINGLE_SOURCE", () => {
  const w = world(); eb13(w.db);
  rejects(() => status(w, "X-EB13", "PRIMARY_VERIFIED"), "DB-G6-PV");
  rejects(() => formal(w, "X-EB13", "FORMAL"), "DB-G6-FORMAL");
  rejects(() => status(w, "X-EB13", "SINGLE_SOURCE"), "DB-G6-AI");
  status(w, "X-EB13", "UNVERIFIED"); // 停在 UNVERIFIED 可以
  formal(w, "X-EB13", "NON_FORMAL");
});

test("G6-2：核验记录指错版本（核了现代本而证据引 1787 刊本）被拒；证据引两版本时缺一个版本的记录仍不能 PRIMARY_VERIFIED", () => {
  const w = world(); eb13(w.db);
  rejects(() => check(w.db, { edition_id: "X-EMOD", page_range: "12" }), "DB-G6-edition");
  const w2 = world(); eb13(w2.db, "X-EB13", { origin: "human" });
  ins(w2.db, "formal", "evidence_passage", { evidence_id: "X-EB13", passage_id: "X-PM" });
  ins(w2.db, "formal", "manual_check_record", { check_id: "X-MC", evidence_id: "X-EB13", edition_id: "X-E1787", checked_by: "X-测试核对员", checked_at: "2026-11-21",
    page_range: "n30,n31", evidence_scope: "X-P30|X-E1787|n30;X-P31|X-E1787|n31;X-PM|X-EMOD|12" });
  rejects(() => status(w2, "X-EB13", "PRIMARY_VERIFIED"), "DB-G6-PV");
});

test("G6-3：核验叶号与证据所引叶号不一致（只核 n30、或写成卷一第 18 叶）被拒", () => {
  const w = world(); eb13(w.db);
  rejects(() => check(w.db, { page_range: "n30" }), "DB-G6-page");
  rejects(() => check(w.db, { page_range: "卷一18,卷一19" }), "DB-G6-page");
});

test("G6-4：伪造来源——核对人为 AI 代理被拒；证据自报 origin = human 也绕不过 PRIMARY_VERIFIED 的核验要求", () => {
  const w = world(); eb13(w.db);
  for (const who of ["Muse", "Claude B", "chatgpt", "GPT-5"]) rejects(() => check(w.db, { checked_by: who }), "DB-G6-checker");
  const w2 = world(); eb13(w2.db, "X-EB13", { origin: "human" });
  rejects(() => status(w2, "X-EB13", "PRIMARY_VERIFIED"), "DB-G6-PV");
  rejects(() => formal(w2, "X-EB13", "FORMAL"), "DB-G6-FORMAL");
});

test("G6-5：核验记录过期——核验后证据又追加引文段，范围指纹不再相符，不能 PRIMARY_VERIFIED / FORMAL", () => {
  const w = world(); eb13(w.db, "X-EB13", { origin: "human" });
  check(w.db);
  ins(w.db, "formal", "evidence_passage", { evidence_id: "X-EB13", passage_id: "X-PM" }); // 尚未核验、尚未正式，追加允许
  rejects(() => status(w, "X-EB13", "PRIMARY_VERIFIED"), "DB-G6-PV");
  rejects(() => formal(w, "X-EB13", "FORMAL"), "DB-G6-FORMAL");
  rejects(() => check(w.db, { check_id: "X-MC2" }), "DB-G6-scope"); // 旧指纹不能再登记
});

test("G6-6：证据被替换——核验并正式后不得再追加引文段；别的证据的核验记录不能顶替", () => {
  const w = world(); eb13(w.db, "X-EB13", { origin: "human" });
  check(w.db);
  status(w, "X-EB13", "PRIMARY_VERIFIED");
  formal(w, "X-EB13", "FORMAL");
  rejects(() => ins(w.db, "formal", "evidence_passage", { evidence_id: "X-EB13", passage_id: "X-PM" }), "DB-G6-replace");
  // 新证据引同样两叶：须有自己的核验记录
  eb13(w.db, "X-EB13B", { origin: "human" });
  rejects(() => formal(w, "X-EB13B", "FORMAL"), "DB-G6-FORMAL");
  testHumanCheck(w.db, "X-EB13B");
  formal(w, "X-EB13B", "FORMAL");
});

test("G6-7 对照：版本、叶号、范围都相符且核对人非 AI 时，PRIMARY_VERIFIED 与 FORMAL 才可写入；七项缺一仍拒", () => {
  const w = world(); eb13(w.db);
  check(w.db);
  status(w, "X-EB13", "PRIMARY_VERIFIED");
  formal(w, "X-EB13", "FORMAL");
  assert.deepEqual(evidenceChecks["Q-X-05-4"](w.db), [], "发布前复核查询同样无违例");
  const w2 = world();
  ins(w2.db, "formal", "passage", { passage_id: "X-P32", edition_id: "X-E1787", chapter_label: "卷一", paragraph_no: 3, text: "t", volume_page: "n32", image_ref: null, verified_by: null, verified_at: null, against_what: null, result: null });
  ins(w2.db, "formal", "evidence", { evidence_id: "X-EV7", human_id: "X-EV7", evidence_tier: "E1", evidence_category: "C-B", confidence: "A", verification_method: "影印本对校", missing_evidence: null, next_source: null, origin: "human", branch_id: null });
  ins(w2.db, "formal", "evidence_passage", { evidence_id: "X-EV7", passage_id: "X-P32" });
  testHumanCheck(w2.db, "X-EV7");
  rejects(() => status(w2, "X-EV7", "PRIMARY_VERIFIED"), "DB-G6-PV"); // 段落缺 §13.7 七项
});
