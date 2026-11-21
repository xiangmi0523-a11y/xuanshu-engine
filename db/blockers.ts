// 阻断完整性（E2-FIX-4 F3-2、F3-6、F3-7）：计算判定与发布前检查共用同一套静态核验，失效关闭。
// 依据：constants.toml [blockers]、[blocker_coverage]、[blocker_step_maps]、[blocker_component_links]（均由 verify.py 核对契约 / 审核清单）。
import type { DatabaseSync } from "node:sqlite";
import { blockerCoverage, requiredBlockerLinks, requiredBlockerMaps, requiredBlockers } from "./constants.js";
import { isMemoryDb } from "./connect.js";

export interface IntegrityProblem { block_id: string; code: string; detail: string }
const get = <T>(db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as T | undefined;
const rows = <T>(db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as T[];
/** 失效关闭：只有明确“已解除”才算不生效 */
export const isActive = (status: string | null | undefined) => status !== "已解除";
export const statusOf = (db: DatabaseSync, b: string) => get<{ status: string }>(db, "SELECT status FROM formal.v_blocker_current WHERE block_id = ?", b)?.status;
/** pair 关系（BLK.4 同一事项），双向 */
export function pairOf(b: string): string | undefined {
  const cov = blockerCoverage();
  const k = cov.get(b);
  if (k?.startsWith("pair:")) return k.slice(5);
  for (const [x, kx] of cov) if (kx === `pair:${b}`) return x;
  return undefined;
}

/**
 * 静态核验。onlyActive = true 时只核验未解除的阻断（计算判定用）；false 时核验全部（发布前检查用）。
 * 1 覆盖方式须已定义；2 step_map / pair：有效映射（自身 ∪ pair 对方）须逐条含必备“步骤:效果”，效果一致，且无未列步骤；
 * 3 必备子项须挂上该阻断（自身或 pair 对方）；4 pair 双方当前状态须一致（B4-25 同步解除）；5 global 覆盖机制须存在。
 */
export function blockerIntegrity(db: DatabaseSync, onlyActive: boolean): IntegrityProblem[] {
  const out: IntegrityProblem[] = [];
  const cov = blockerCoverage(); const reqMaps = requiredBlockerMaps(); const reqLinks = requiredBlockerLinks();
  const registered = new Set(rows<{ block_id: string }>(db, "SELECT block_id FROM formal.blocker").map((r) => r.block_id));
  for (const b of requiredBlockers()) {
    if (!registered.has(b)) { out.push({ block_id: b, code: "BLOCKER_REGISTRY_MISSING", detail: "必备阻断未登记" }); continue; }
    if (onlyActive && !isActive(statusOf(db, b))) continue;
    const kind = cov.get(b);
    if (!kind) { out.push({ block_id: b, code: "BLOCKER_COVERAGE_UNDEFINED", detail: "覆盖方式未定义" }); continue; }
    const pair = pairOf(b);
    if (pair && statusOf(db, b) !== statusOf(db, pair))
      out.push({ block_id: b, code: "BLOCKER_PAIR_STATE", detail: `与 ${pair} 当前状态不一致（${statusOf(db, b)} / ${statusOf(db, pair)}），B4-25 要求同步` });
    if (kind === "step_map" || kind.startsWith("pair:")) {
      const owner = kind === "step_map" ? b : kind.slice(5); // 必备清单登记在 step_map 一方
      const req = reqMaps.get(owner);
      if (!req) { out.push({ block_id: b, code: "BLOCKER_MAP_UNDEFINED", detail: `${owner} 无必备映射清单` }); continue; }
      const ids = pair ? [b, pair] : [b];
      const have = rows<{ block_id: string; step_code: string; effect: string }>(db,
        `SELECT block_id, step_code, effect FROM formal.blocker_step_map WHERE block_id IN (${ids.map(() => "?").join(",")}) ORDER BY step_code, block_id`, ...ids);
      for (const r of req) {
        const at = have.filter((h) => h.step_code === r.step);
        if (at.length === 0) out.push({ block_id: b, code: "BLOCKER_MAP_MISSING", detail: `${r.step} 缺映射（应为 ${r.effect}）` });
        for (const h of at) if (h.effect !== r.effect) out.push({ block_id: b, code: "BLOCKER_MAP_EFFECT", detail: `${h.block_id} → ${r.step} 效果为 ${h.effect}，应为 ${r.effect}` });
      }
      for (const h of have) if (!req.some((r) => r.step === h.step_code)) out.push({ block_id: b, code: "BLOCKER_MAP_UNLISTED", detail: `${h.block_id} → ${h.step_code} 不在必备清单` });
      for (const c of reqLinks.get(owner) ?? []) {
        const linked = get(db, `SELECT 1 FROM formal.component_blocker WHERE component_id = ? AND block_id IN (${ids.map(() => "?").join(",")})`, c, ...ids);
        if (!linked) out.push({ block_id: b, code: "BLOCKER_LINK_MISSING", detail: `子项 ${c} 未挂 ${ids.join(" / ")}` });
      }
    } else if (kind === "global:ZR-DB") {
      if (!get(db, "SELECT 1 FROM main.sqlite_master WHERE sql LIKE '%ZR-DB-missing%'")) out.push({ block_id: b, code: "BLOCKER_COVERAGE_MISSING", detail: "库层 ZR-DB-* 约束缺失" });
    } else if (kind === "global:isolation") {
      if (!isMemoryDb(db)) out.push({ block_id: b, code: "BLOCKER_COVERAGE_MISSING", detail: "非内存库" });
    } else if (!kind.startsWith("input_path:") && kind !== "no_entry") out.push({ block_id: b, code: "BLOCKER_COVERAGE_UNDEFINED", detail: `未知覆盖方式 ${kind}` });
  }
  return out;
}
