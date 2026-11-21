// 数据库测试公用工具。测试文件不写任何夹具稳定 ID（DB-G-01）：夹具 ID 一律从 test/fixtures/ 读取。
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openMemoryDb } from "../../db/connect.js";
import { calculate, prepareConfig, prepareInput, saveProfileInputConfig, type CalcOutcome, type SealHooks } from "../../db/pipeline.js";
import { cases, loadWorld, world, type CaseSpec, type LoadedWorld } from "../fixtures/load.js";
import { readRepo } from "../helpers/load.js";

export type Val = string | number | null;
export type Row = Record<string, Val>;
export interface Spec {
  locators?: SpecLocators;
  tables: Record<string, {
    schema: "formal" | "main"; required: string[]; supplement: { columns: string[]; source: string } | null;
    enums: Record<string, { constraint: string; values: (string | number)[]; nullable: boolean; src: string; approval?: string }>;
    approval?: string; src?: string;
    fks: { table: string; from: string[]; to: string[]; deferred: boolean; src: string; approval?: string }[];
    columns: string[]; pk: string[]; unique: { cols: string[]; src: string }[];
  }>;
}
export interface SpecLocators { from_checklist_s5: string[]; extra: Record<string, string>; mapped?: Record<string, string> }
export const spec = (): Spec => JSON.parse(readRepo("db/spec.json")) as Spec;
export const baseRows = (): [("formal" | "main"), string, Row][] =>
  (JSON.parse(readRepo("test/fixtures/base_rows.json")) as { rows: [("formal" | "main"), string, Row][] }).rows;
/** 夹具中的数据版本号（按 release_seq） */
export const releases = (): string[] => world().releases.map((r) => String(r["data_release"]));

export function ins(db: DatabaseSync, schema: string, t: string, row: Row): void {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${schema}.${t} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]!));
}

/** 只建表的内存库，并写入全部基准行（DB-N / DB-E / DB-K 矩阵用） */
export function tablesWithBase(sql?: { formal: string; user: string }): DatabaseSync {
  const db = openMemoryDb(sql ? { tablesOnly: true, sql } : { tablesOnly: true });
  db.exec("BEGIN");
  for (const [s, t, r] of baseRows()) ins(db, s, t, r);
  db.exec("COMMIT");
  return db;
}
/** 完整结构的内存库 */
export const fullDb = () => openMemoryDb();

/** 断言抛错且信息含定位编号 */
export function rejects(fn: () => unknown, locator: string | RegExp, msg?: string): void {
  assert.throws(fn, (e: unknown) => {
    const m = (e as Error).message;
    const okk = typeof locator === "string" ? m.includes(locator) : locator.test(m);
    if (!okk) throw new assert.AssertionError({ message: `${msg ?? ""} 期望定位 ${String(locator)}，实际：${m}` });
    return true;
  });
}
/** 在保存点内执行，结束后回滚（不留痕） */
export function inSavepoint<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("SAVEPOINT sp");
  try { return fn(); } finally { db.exec("ROLLBACK TO sp"); db.exec("RELEASE sp"); }
}

// ---------------------------------------------------------------- 端到端
export interface E2ERun { w: LoadedWorld; c: CaseSpec; out: CalcOutcome; inp: ReturnType<typeof prepareInput>; cfg: ReturnType<typeof prepareConfig> }
export function scenarioName(sc: string, domain: string): string { return sc === "G1N" ? `G1N:${domain}` : sc; }
export function runCase(scenario: string, caseId: string, opts: { w?: LoadedWorld; hooks?: SealHooks; profileId?: string; inputId?: string } = {}): E2ERun {
  const c = cases().cases.find((x) => x.case_id === caseId)!;
  const w = opts.w ?? loadWorld(scenarioName(scenario, c.domain));
  const inp = prepareInput({ domain: c.domain, raw: c.raw, tz: c.tz, normalizer_version: c.normalizer_version });
  const cfg = prepareConfig({ ...c.config, module: c.domain });
  const profileId = opts.profileId ?? c.owner_profile_id, inputId = opts.inputId ?? c.input_id;
  saveProfileInputConfig(w.db, profileId, inp, inputId, cfg);
  const out = calculate(w.db, w.ctx, { profileId, inputId, inp, cfg }, opts.hooks);
  return { w, c, out, inp, cfg };
}
export const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;

/**
 * 隔离库内为某证据补“相符的人工核验记录”（每个所引版本一条）。只供测试构造 G-6 门禁的正向对照；
 * 核对人为测试占位名，不代表任何真实核验，不得用于真实证据（E2-FIX-2 P2-2：不得伪造人工核验记录）。
 */
export function testHumanCheck(db: DatabaseSync, evidenceId: string, checker = "X-测试核对员"): void {
  const eds = db.prepare(`SELECT DISTINCT p.edition_id FROM formal.evidence_passage ep JOIN formal.passage p ON p.passage_id = ep.passage_id WHERE ep.evidence_id = ? ORDER BY p.edition_id`).all(evidenceId) as { edition_id: string }[];
  const scope = (db.prepare(`SELECT group_concat(p.passage_id || '|' || p.edition_id || '|' || p.volume_page, ';' ORDER BY p.passage_id) AS s FROM formal.evidence_passage ep JOIN formal.passage p ON p.passage_id = ep.passage_id WHERE ep.evidence_id = ?`).get(evidenceId) as { s: string }).s;
  for (const { edition_id } of eds) {
    const pages = (db.prepare(`SELECT group_concat(p.volume_page, ',' ORDER BY p.volume_page) AS s FROM formal.evidence_passage ep JOIN formal.passage p ON p.passage_id = ep.passage_id WHERE ep.evidence_id = ? AND p.edition_id = ?`).get(evidenceId, edition_id) as { s: string }).s;
    const n = (db.prepare("SELECT count(*) AS n FROM formal.manual_check_record").get() as { n: number }).n;
    ins(db, "formal", "manual_check_record", { check_id: `X-MC-${evidenceId}-${n + 1}`, evidence_id: evidenceId, edition_id, checked_by: checker, checked_at: "2026-11-21", page_range: pages, evidence_scope: scope });
  }
}
