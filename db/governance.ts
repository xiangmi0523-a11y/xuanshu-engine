// 计算状态判定（契约 §9.3；审核清单 §7、P-38、P-42、Q-6、Q-16、Q-17）。
// 读取正式库（formal 模式）中的登记、准入、批准、争议与阻断，逐步骤判定 BLOCKED / NON_FORMAL / FORMAL。
// 判定顺序（E2 实施约定，验收报告载明）：
//   1 BLOCKED-HARD（所经步骤映射到现行阻断的 BLOCKED-HARD）
//   2 争议未裁决且无可选变体（§9.3 第 2 步“争议变体未选”；§5.3“缺选择 → BLOCKED”）；缺必选参数
//   3 逐步骤：函数未登记子项 / 缺现行批准而非 RESEARCH_ONLY / 准入 CALC_BLOCKED（§9.3 第 3 步，K-2）
//   3b 所经步骤映射到现行阻断的 BLOCKED-FORMAL（P-38：§9.3 未单列 PATH 阻断，按审核清单 §7.1 置于批准核查之后）
//   4 NON_FORMAL：PATH 阻断效果为 NON_FORMAL（BLK.2 第二列）、暂按口径（争议未裁决但已有选定变体，裁决 4、§5.3）、
//     参数待裁决口径、RESEARCH_ONLY、变体正式状态记录为 NON_FORMAL（R-I-4）
//   5 FORMAL
// BLOCKED 一律不生成快照（Q-6）。
import type { DatabaseSync } from "node:sqlite";
import { hashOf } from "./canonical.js";

export interface PlannedStep {
  step_code: string;
  status: "完成" | "未执行";
  skip_kind?: "范围外" | "输入缺失" | "按规则跳过";
  reason?: string;
  /** 本步实际读取、调用或用于适用域判断、分支选择、跳过决策的规则函数（P-42 / Q-17），经 rule_component.calc_function_id 找到子项 */
  rule_functions: string[];
  /** 本步读取的参数（含跳过决策所读参数，如 CFG-02） */
  params: string[];
  /** 轨迹登记的执行函数 */
  trace_function: string;
  input_summary?: string;
  output_summary?: string;
}
export interface ConfigParam { param_id: string; value: string; value_source: string; apply_mode: "applied" | "stored_only" }
export interface Plan { module: "BAZI" | "LIUYAO"; steps: PlannedStep[]; config: ConfigParam[] }

export interface UsedVariant {
  step_code: string; calc_function_id: string; component_id: string; rule_variant_id: string; version_no: number;
  content_hash: string; data_release: string; approval_id: string | null;
}
export interface Reason {
  reason_kind: "R-I" | "PARAM_PROVISIONAL" | "RULE_PROVISIONAL" | "BLOCKER_PATH" | "RESEARCH_ONLY";
  ri_segment?: string; step_code: string; upstream_release: string; upstream_id: string; upstream_hash: string; note: string;
}
export type Judgment =
  /** code：审计事件的 block_reason_code。MISSING_APPROVAL 按清单 DB-B-03 写裸码，所缺批准的变体另见 object_id；其余写“类别:对象:步骤” */
  | { status: "BLOCKED"; kind: "BLOCKED-HARD" | "BLOCKED-FORMAL"; code: string; step_code: string; object_id?: string }
  | { status: "NON_FORMAL" | "FORMAL"; reasons: Reason[]; variants: UsedVariant[]; blockers: { block_id: string; status: string }[] };

const one = <T>(db: DatabaseSync, sql: string, ...a: (string | number | null)[]): T | undefined => db.prepare(sql).get(...a) as T | undefined;
const all = <T>(db: DatabaseSync, sql: string, ...a: (string | number | null)[]): T[] => db.prepare(sql).all(...a) as T[];

interface MapRow { block_id: string; step_code: string; effect: string; status: string; basis_ref: string }
function stepBlockers(db: DatabaseSync, step: string): MapRow[] {
  return all<MapRow>(db, `SELECT m.block_id, m.step_code, m.effect, b.status, m.basis_ref
    FROM formal.blocker_step_map m JOIN formal.v_blocker_current b ON b.block_id = m.block_id
    WHERE m.step_code = ? ORDER BY m.block_id`, step);
}
interface DisputeRow { dispute_id: string; object_ref: string; status: string }
function disputesFor(db: DatabaseSync, ref: string): DisputeRow[] {
  return all<DisputeRow>(db, "SELECT dispute_id, object_ref, status FROM formal.dispute WHERE object_ref = ? ORDER BY dispute_id", ref);
}
interface VariantRow { rule_variant_id: string; component_id: string; version_no: number; content_hash: string }

/** 正式库当前数据版本（release_seq 最大者）；跨库三元组的“数据版本号”取此值（§1.2） */
export function currentRelease(db: DatabaseSync): string {
  return one<{ r: string }>(db, "SELECT data_release AS r FROM formal.data_release ORDER BY release_seq DESC LIMIT 1")?.r ?? "";
}

/**
 * 子项的变体状态（逐子项判定，不以他子项代替）：
 * - DEFAULT：有现行默认（丙类）；
 * - SINGLE：无默认、恰登记一个变体（判定其批准状态）；
 * - UNSELECTED：登记多个变体而无默认，须选择；
 * - NONE：没有任何变体。
 */
export type VariantState =
  | { state: "DEFAULT" | "SINGLE"; variant: VariantRow }
  | { state: "UNSELECTED"; count: number }
  | { state: "NONE" };
export function variantState(db: DatabaseSync, component: string): VariantState {
  const d = one<VariantRow>(db, `SELECT v.rule_variant_id, v.component_id, v.version_no, v.content_hash
    FROM formal.v_current_default d JOIN formal.rule_variant v ON v.rule_variant_id = d.rule_variant_id WHERE d.component_id = ?`, component);
  if (d) return { state: "DEFAULT", variant: d };
  const vs = all<VariantRow>(db, "SELECT rule_variant_id, component_id, version_no, content_hash FROM formal.rule_variant WHERE component_id = ? ORDER BY version_no", component);
  if (vs.length === 1) return { state: "SINGLE", variant: vs[0]! };
  return vs.length === 0 ? { state: "NONE" } : { state: "UNSELECTED", count: vs.length };
}
const selectable = (v: VariantState): v is { state: "DEFAULT" | "SINGLE"; variant: VariantRow } => v.state === "DEFAULT" || v.state === "SINGLE";
const componentsOf = (db: DatabaseSync, fn: string) =>
  all<{ component_id: string }>(db, "SELECT component_id FROM formal.rule_component WHERE calc_function_id = ? ORDER BY component_id", fn).map((c) => c.component_id);

export function judge(db: DatabaseSync, plan: Plan): Judgment {
  const executed = plan.steps.filter((s) => s.status === "完成");
  const release = currentRelease(db);
  const blocked = (kind: "BLOCKED-HARD" | "BLOCKED-FORMAL", code: string, step_code: string, object_id?: string): Judgment =>
    (object_id === undefined ? { status: "BLOCKED", kind, code, step_code } : { status: "BLOCKED", kind, code, step_code, object_id });

  // 1 BLOCKED-HARD
  for (const s of executed) for (const m of stepBlockers(db, s.step_code)) {
    if (m.status === "现行" && m.effect === "BLOCKED-HARD") return blocked("BLOCKED-HARD", `BLOCKER_HARD:${m.block_id}:${s.step_code}`, s.step_code);
  }
  // 2 争议未裁决且无可选变体；变体缺失或未选；缺必选参数（逐子项检查，任一必需子项不可用即阻断，不以他子项掩盖）
  for (const s of executed) {
    for (const fn of s.rule_functions) {
      const comps = componentsOf(db, fn);
      const states = new Map(comps.map((c) => [c, variantState(db, c)] as const));
      const allSelectable = comps.length > 0 && comps.every((c) => selectable(states.get(c)!));
      // 函数级争议：只要该函数没有登记子项、或任一子项不可选，即阻断
      for (const d of disputesFor(db, `function:${fn}`)) {
        if (d.status === "未裁决" && !allSelectable) return blocked("BLOCKED-FORMAL", `DISPUTE_UNRESOLVED:${d.dispute_id}:${s.step_code}`, s.step_code);
      }
      for (const c of comps) {
        const st = states.get(c)!;
        // 子项级争议：该子项本身不可选即阻断
        for (const d of disputesFor(db, `component:${c}`)) {
          if (d.status === "未裁决" && !selectable(st)) return blocked("BLOCKED-FORMAL", `DISPUTE_UNRESOLVED:${d.dispute_id}:${s.step_code}`, s.step_code);
        }
        if (st.state === "NONE") return blocked("BLOCKED-FORMAL", `VARIANT_MISSING:${c}:${s.step_code}`, s.step_code, c);
        if (st.state === "UNSELECTED") return blocked("BLOCKED-FORMAL", `VARIANT_UNSELECTED:${c}:${s.step_code}`, s.step_code, c);
      }
    }
    for (const p of s.params) {
      const cp = plan.config.find((x) => x.param_id === p);
      if (!cp || cp.apply_mode !== "applied") return blocked("BLOCKED-FORMAL", `PARAM_MISSING:${p}:${s.step_code}`, s.step_code);
    }
  }
  // 3 逐步骤：登记、批准、准入
  const variants: UsedVariant[] = [];
  const reasons: Reason[] = [];
  for (const s of executed) for (const fn of s.rule_functions) {
    const comps = componentsOf(db, fn);
    if (comps.length === 0) return blocked("BLOCKED-FORMAL", `RULE_UNREGISTERED:${fn}:${s.step_code}`, s.step_code);
    for (const cid of comps) {
      const st = variantState(db, cid);
      // 第 2 步已逐子项拦截 NONE / UNSELECTED；此处再断言一次，杜绝隐式回退（不得因异常、默认值生成正式快照）
      if (!selectable(st)) return blocked("BLOCKED-FORMAL", `VARIANT_${st.state === "NONE" ? "MISSING" : "UNSELECTED"}:${cid}:${s.step_code}`, s.step_code, cid);
      const v = st.variant;
      const c = { component_id: cid };
      const appr = one<{ approval_id: string | null; formal_status: string }>(db,
        "SELECT current_approval_id AS approval_id, formal_status FROM formal.v_variant_formal WHERE rule_variant_id = ?", v.rule_variant_id);
      const adm = one<{ status: string; conditions: string | null }>(db, "SELECT status, conditions FROM formal.v_admission_current WHERE component_id = ? AND purpose = 'calc'", c.component_id);
      const approved = appr?.formal_status === "FORMAL";
      if (!approved && adm?.status !== "RESEARCH_ONLY") return blocked("BLOCKED-FORMAL", "MISSING_APPROVAL", s.step_code, v.rule_variant_id);
      if (!adm) return blocked("BLOCKED-FORMAL", `ADMISSION_MISSING:${c.component_id}:${s.step_code}`, s.step_code);
      if (adm.status === "DEFERRED" || adm.status === "PROHIBITED") return blocked("BLOCKED-FORMAL", `ADMISSION_${adm.status}:${c.component_id}:${s.step_code}`, s.step_code);
      if (adm.status === "CONDITIONAL") {
        const cond = JSON.parse(adm.conditions ?? "{\"all\":[]}") as { all: { op: string; param: string; value?: string }[] };
        const unmet = cond.all.find((k) => {
          const cp = plan.config.find((x) => x.param_id === k.param && x.apply_mode === "applied");
          return k.op === "param_selected" ? !cp : k.op === "param_equals" ? cp?.value !== k.value : true;
        });
        if (unmet) return blocked("BLOCKED-FORMAL", `CONDITION_UNMET:${c.component_id}:${unmet.param}:${s.step_code}`, s.step_code);
      }
      if (adm.status === "RESEARCH_ONLY") reasons.push({ reason_kind: "RESEARCH_ONLY", step_code: s.step_code, upstream_release: release, upstream_id: v.rule_variant_id, upstream_hash: v.content_hash, note: `子项 ${c.component_id} 计算准入为 RESEARCH_ONLY` });
      variants.push({ step_code: s.step_code, calc_function_id: fn, component_id: c.component_id, rule_variant_id: v.rule_variant_id, version_no: v.version_no,
        content_hash: v.content_hash, data_release: release, approval_id: appr?.approval_id ?? null });
    }
  }
  // 3b PATH 阻断：BLOCKED-FORMAL
  for (const s of executed) for (const m of stepBlockers(db, s.step_code)) {
    if (m.status === "现行" && m.effect === "BLOCKED-FORMAL") return blocked("BLOCKED-FORMAL", `BLOCKER_PATH:${m.block_id}:${s.step_code}`, s.step_code);
  }
  // 4 NON_FORMAL 原因
  for (const s of executed) for (const m of stepBlockers(db, s.step_code)) {
    if (m.status === "现行" && m.effect === "NON_FORMAL") reasons.push({ reason_kind: "BLOCKER_PATH", step_code: s.step_code, upstream_release: release,
      upstream_id: m.block_id, upstream_hash: hashOf({ block_id: m.block_id, step_code: s.step_code, effect: m.effect, status: m.status }), note: `${m.block_id} 现行，${s.step_code} 按 BLK.2 第二列为 NON_FORMAL（${m.basis_ref}）` });
  }
  for (const v of variants) {
    for (const d of disputesFor(db, `component:${v.component_id}`)) if (d.status === "未裁决") reasons.push({ reason_kind: "RULE_PROVISIONAL", step_code: v.step_code,
      upstream_release: v.data_release, upstream_id: v.rule_variant_id, upstream_hash: v.content_hash, note: `子项 ${v.component_id} 有未裁决事项 ${d.dispute_id}，所用变体属暂按口径（裁决 4、§5.3）` });
    const fs = one<{ value: string }>(db, "SELECT value FROM formal.v_formal_status_current WHERE target_type = 'RuleVariant' AND target_id = ?", v.rule_variant_id);
    if (fs?.value === "NON_FORMAL") reasons.push({ reason_kind: "R-I", ri_segment: "R-I-4", step_code: v.step_code, upstream_release: v.data_release,
      upstream_id: v.rule_variant_id, upstream_hash: v.content_hash, note: `变体 ${v.rule_variant_id} 的正式状态记录为 NON_FORMAL` });
  }
  const registryVersion = one<{ v: string }>(db, "SELECT registry_version AS v FROM formal.parameter_registry ORDER BY param_id LIMIT 1")?.v ?? "";
  const seenParam = new Set<string>();
  for (const s of executed) for (const p of s.params) {
    if (seenParam.has(p)) continue; seenParam.add(p);
    for (const d of disputesFor(db, `param:${p}`)) if (d.status === "未裁决") {
      const cp = plan.config.find((x) => x.param_id === p)!;
      reasons.push({ reason_kind: "PARAM_PROVISIONAL", step_code: s.step_code, upstream_release: release, upstream_id: p,
        upstream_hash: hashOf({ param_id: p, value: cp.value, registry_version: registryVersion }), note: `参数 ${p} 属待裁决口径（${d.dispute_id}；§5.3）` });
    }
  }
  // 去重（同类、同上游只记一次）
  const uniq = new Map<string, Reason>();
  for (const r of reasons) { const k = `${r.reason_kind}|${r.upstream_id}`; if (!uniq.has(k)) uniq.set(k, r); }
  const blockers = all<{ block_id: string; status: string }>(db, "SELECT block_id, status FROM formal.v_blocker_current ORDER BY block_id");
  const rs = [...uniq.values()];
  return { status: rs.length ? "NON_FORMAL" : "FORMAL", reasons: rs, variants, blockers };
}
