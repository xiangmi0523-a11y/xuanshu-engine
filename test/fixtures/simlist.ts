// 模拟项清单（审核清单 §7.6 末段、DB-G-05）：由夹具内容生成；验收报告中的清单须与此逐字相同（测试比对）。
import { world, fileSha, WORLD_PATH, CASES_PATH } from "./load.js";

export const SIM_LIST_PATH = "reports/E2_数据库结构准备/模拟项清单.md";
export const DECLARATION = "以上均为模拟，不代表任何真实裁决、准入、批准或阻断解除";

interface Rec { t: string; r: Record<string, unknown>; sim?: string | null; replaces?: unknown }
const idOf = (r: Rec) => String(Object.values(r.r)[0]);

export function buildSimList(): string {
  const w = world() as unknown as {
    scenarios: Record<string, { releases: string[]; layers: string[] }>; layers: Record<string, Rec[]>;
    sim_clauses: Record<string, string>; sim_without_records: { sim: string; with?: string; scenarios?: string[]; record?: string }[];
    engine: { engine_release_id: string; functions: Record<string, string[]> };
  };
  const out: string[] = [
    "# E2 模拟项清单（DB-G-05：由夹具生成，测试逐字比对）",
    "",
    "夹具文件 sha256：",
    "",
    `- ${WORLD_PATH}：${fileSha(WORLD_PATH)}`,
    `- ${CASES_PATH}：${fileSha(CASES_PATH)}`,
    `- test/fixtures/base_rows.json：${fileSha("test/fixtures/base_rows.json")}（约束矩阵基准行：只供列级约束测试，不是治理模拟，不参与端到端判定）`,
    "",
    "全部记录只加载进测试进程的隔离 :memory: 库，测试结束随进程销毁；不写入数据仓库、正式库、用户库或发布包。",
    "",
  ];
  for (const [name, sc] of Object.entries(w.scenarios)) {
    const recs: Rec[] = [];
    for (const l of sc.layers) for (const r of w.layers[l] ?? []) recs.push(r);
    const bySim = new Map<string, string[]>();
    for (const r of recs) if (r.sim) {
      const ids = bySim.get(r.sim) ?? [];
      ids.push(r.t === "engine_release" ? `${r.t}:${idOf(r)}（另展开 engine_function、engine_function_source 各 ${Object.keys(w.engine.functions).length} 个函数）` : `${r.t}:${idOf(r)}`);
      bySim.set(r.sim, ids);
    }
    for (const x of w.sim_without_records) {
      if (x.with && bySim.has(x.with)) bySim.set(x.sim, [`不另建记录（见 ${x.with}）`]);
      if (x.scenarios?.includes(name)) bySim.set(x.sim, [`不另建记录：${x.record}`]);
    }
    const order = [...bySim.keys()].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    out.push(`## 场景 ${name}（数据版本 ${sc.releases.join("、")}）`, "");
    if (!order.length) { out.push("- 无模拟项（只有照真实映射的登记与阻断状态）", ""); continue; }
    out.push("| S 编号 | 对应契约条款 | 夹具记录 ID |", "| --- | --- | --- |");
    for (const s of order) out.push(`| ${s} | ${w.sim_clauses[s] ?? "【待补条款】"} | ${bySim.get(s)!.join("；")} |`);
    out.push("");
  }
  out.push(`${DECLARATION}。`, "");
  return out.join("\n");
}
