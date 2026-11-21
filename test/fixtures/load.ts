// 夹具加载（审核清单 §3.7、DB-G-03）：只向隔离 :memory: 库写入；加载前断言连接为内存库，否则拒绝。
import type { DatabaseSync } from "node:sqlite";
import { hashOf } from "../../db/canonical.js";
import { isMemoryDb, openMemoryDb } from "../../db/connect.js";
import type { EngineContext } from "../../db/pipeline.js";
import { loadStatic, loadTables, readRepo, sha256Of } from "../helpers/load.js";

type Row = Record<string, string | number | null>;
export interface Rec {
  t: string; r: Row; sim?: string | null; note?: string; content?: Record<string, unknown>; variant?: string; basis?: string[];
  replaces?: { t: string; match: Row };
}
export interface World {
  note: string;
  releases: Row[];
  scenarios: Record<string, { releases: string[]; layers: string[] }>;
  engine: { engine_release_id: string; version: string; app_version: string; functions: Record<string, string[]> };
  layers: Record<string, Rec[]>;
}
export const WORLD_PATH = "test/fixtures/world.json";
export const CASES_PATH = "test/fixtures/cases.json";
export const world = (): World => JSON.parse(readRepo(WORLD_PATH)) as World;
export const fileSha = (path: string) => sha256Of(path);

const frozenManifest = () => JSON.parse(readRepo("data/frozen/MANIFEST.json")) as { files: Record<string, { sha256: string }> } | Record<string, unknown>;
function frozenSha(file: string): string {
  const m = frozenManifest() as Record<string, unknown>;
  const files = (m["files"] ?? m) as Record<string, unknown>;
  const e = files[file] as { sha256?: string } | string | undefined;
  const sha = typeof e === "string" ? e : e?.sha256;
  if (!sha) throw new Error(`冻结清单无 ${file}`);
  if (fileSha(`data/frozen/${file}`) !== sha) throw new Error(`冻结文件 ${file} 哈希与清单不符`);
  return sha;
}
function resolvePlaceholder(v: string | number | null): string | number | null {
  if (typeof v !== "string") return v;
  if (v.startsWith("@frozen:")) return frozenSha(v.slice(8));
  if (v.startsWith("@file:")) return fileSha(v.slice(6));
  return v;
}

/** 变体内容：加上 v、component_id，文件路径补 sha256（读仓库文件现值） */
export function variantContent(rec: Rec): Record<string, unknown> {
  const c = rec.content!;
  const out: Record<string, unknown> = { v: 1, component_id: rec.r["component_id"], ...c };
  if (Array.isArray(c["files"])) out["files"] = (c["files"] as { path: string }[]).map((f) => ({ path: f.path, sha256: fileSha(f.path) }));
  return out;
}

export interface LoadedWorld {
  db: DatabaseSync; scenario: string; records: Rec[]; ctx: EngineContext; contents: Map<string, Record<string, unknown>>;
  releases: string[]; sims: { sim: string; table: string; id: string }[];
}

function selectRecords(w: World, scenario: string): Rec[] {
  const sc = w.scenarios[scenario];
  if (!sc) throw new Error(`未知场景 ${scenario}`);
  let recs: Rec[] = [];
  for (const l of sc.layers) for (const r of w.layers[l] ?? []) {
    if (r.replaces) {
      // 替换就地进行：模拟版本占据被替换记录的位置（其子行如 dispute_claim 仍在其后）
      const { t, match } = r.replaces;
      const i = recs.findIndex((x) => x.t === t && Object.entries(match).every(([k, v]) => x.r[k] === v));
      if (i < 0) throw new Error(`替换目标不存在：${t} ${JSON.stringify(match)}`);
      recs[i] = r;
      continue;
    }
    recs.push(r);
  }
  return recs;
}

const ins = (db: DatabaseSync, schema: string, t: string, row: Row) => {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${schema}.${t} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]!));
};

/** 测试变造：排除某些夹具记录、追加记录（只用于构造反向用例） */
export interface WorldEdit { exclude?: (rec: { t: string; r: Row }) => boolean; extra?: Rec[] }

/** 建一个场景的隔离内存库并加载夹具 */
export function loadWorld(scenario: string, db: DatabaseSync = openMemoryDb(), edit: WorldEdit = {}): LoadedWorld {
  if (!isMemoryDb(db)) throw new Error("[DB-G-03] 夹具只允许写入 :memory: 库");
  const w = world();
  const sc = w.scenarios[scenario]!;
  const recs = [...selectRecords(w, scenario).filter((r) => !edit.exclude?.(r)), ...(edit.extra ?? [])];
  for (const rel of w.releases.filter((r) => sc.releases.includes(String(r["data_release"])))) ins(db, "formal", "data_release", rel);
  const contents = new Map<string, Record<string, unknown>>();
  const sims: LoadedWorld["sims"] = [];
  for (const rec of recs) {
    const row: Row = {};
    for (const [k, v] of Object.entries(rec.r)) row[k] = resolvePlaceholder(v);
    if (rec.t === "rule_variant") {
      const c = variantContent(rec);
      contents.set(String(row["rule_variant_id"]), c);
      row["content_hash"] = hashOf(c); row["hash_algorithm"] = "sha256"; row["canonicalization_version"] = "jcs-1";
    }
    if (rec.t === "approval_record") {
      db.exec("BEGIN");
      try {
        const aid = String(row["approval_id"]);
        for (const b of rec.basis ?? []) ins(db, "formal", "approval_basis", { approval_id: aid, basis_ref: b });
        if (row["target_content_hash"] === undefined) {
          const c = contents.get(String(rec.variant));
          if (!c) throw new Error(`批准目标变体未加载：${rec.variant}`);
          row["target_content_hash"] = hashOf(c);
        }
        ins(db, "formal", "approval_record", row);
        db.exec("COMMIT");
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    } else if (rec.t === "engine_release") {
      ins(db, "formal", "engine_release", row);
      for (const [fn, paths] of Object.entries(w.engine.functions)) {
        const src = paths.map((p) => ({ path: p, file_sha256: fileSha(p) }));
        ins(db, "formal", "engine_function", { engine_release_id: String(row["engine_release_id"]), calc_function_id: fn, function_version: "1", impl_hash: hashOf(src) });
        for (const s of src) ins(db, "formal", "engine_function_source", { engine_release_id: String(row["engine_release_id"]), calc_function_id: fn, ...s });
      }
    } else ins(db, "formal", rec.t, row);
    if (rec.sim) sims.push({ sim: rec.sim, table: rec.t, id: String(Object.values(rec.r)[0]) });
  }
  const tables = loadTables(), st = loadStatic();
  const ctx: EngineContext = { engine_release_id: w.engine.engine_release_id, app_version: w.engine.app_version, tables, static: st,
    variantContent: (id) => contents.get(id) };
  return { db, scenario, records: recs, ctx, contents, releases: sc.releases, sims };
}

// ---------------------------------------------------------------- 端到端用例
export interface CaseSpec {
  case_id: string; domain: "BAZI" | "LIUYAO"; owner_profile_id: string; input_id: string;
  raw: Record<string, unknown>; tz: { tz_id: string; utc_offset_seconds: number; dst_flag: boolean; tzdata_version: string; tz_table_version: string; offset_source: string };
  normalizer_version: string;
  config: { config_id: string; config_version: number; registry_version: string; params: { param_id: string; value: string; value_source: string; apply_mode: "applied" | "stored_only" }[] };
}
export interface Expectation { status: "BLOCKED" | "NON_FORMAL" | "FORMAL"; block_reason_code?: string; reasons?: string[] }
export interface Cases {
  cases: CaseSpec[];
  expect: Record<string, Record<string, Expectation>>;
}
export const cases = (): Cases => JSON.parse(readRepo(CASES_PATH)) as Cases;
