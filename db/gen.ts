// DDL 生成脚本 —— 审核清单 §11 第 2 条：DDL 由脚本生成，放 db/。
// 输入：db/sql/formal.sql.in、db/sql/user.sql.in、data/contract/constants.toml（[cfg01] locked_value，清单 §8.1）。
// 输出：db/sql/formal.sql、db/sql/user.sql。CI 以 --check 模式比对已提交文件与重新生成结果，防止手改。
// 本脚本只读写文本文件，不创建、不打开任何数据库（B3-1 D1）。
import { readFileSync, writeFileSync } from "node:fs";
import { NORMALIZED, RAW_BAZI, RAW_LIUYAO, RESULT_BAZI, RESULT_LIUYAO } from "./canonical.js";

const root = new URL("../../", import.meta.url); // dist/db → 仓库根
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");

export function cfg01Locked(): string {
  const toml = read("data/contract/constants.toml");
  const sec = /\n\[cfg01\]\n([\s\S]*?)(\n\[|$)/.exec(toml);
  const m = sec && /locked_value\s*=\s*"([a-z_]+)"/.exec(sec[1]!);
  if (!m) throw new Error("data/contract/constants.toml 缺 [cfg01] locked_value");
  return m[1]!;
}

// ---- 只读与只追加（清单 §3.4；DB-I）
const FORMAL_TABLES_SKIP = new Set(["passage_fts"]); // 虚拟表不可建触发器，由外部内容表 passage 的只读保护覆盖
const HISTORY_A = [ // 清单 §3.3 甲类：状态转换历史
  { schema: "formal", table: "evidence_status_history", key: ["target_type", "target_id", "field"], prev: "previous_value", next: "new_value", release: true },
  { schema: "formal", table: "admission_record", key: ["component_id", "purpose"], prev: "previous_status", next: "new_status", release: true },
  { schema: "formal", table: "formal_status_history", key: ["target_type", "target_id"], prev: "previous_value", next: "new_value", release: true },
  { schema: "formal", table: "blocker_change", key: ["block_id"], prev: "previous_status", next: "new_status", release: true },
  // 用户库 branch_status_history：data_release 在正式库，按 §3.10 不在用户库触发器中比对版本序（由查询复核）
  { schema: "main", table: "branch_status_history", key: ["branch_id"], prev: "previous_status", next: "new_status", release: false },
] as const;
// 用户库：拒绝 UPDATE 的表（计算层、审计、事件、历史、标记行、个人变体）
const USER_NO_UPDATE = ["profile", "calculation_input", "input_tz_resolution", "calculation_config", "config_param_value", "profile_config_ref",
  "calculation_snapshot", "snapshot_non_formal_reason", "snapshot_degradation_reason", "snapshot_dependency", "snapshot_gov_approval",
  "snapshot_gov_blocker", "snapshot_gov_sequence", "snapshot_resolved_context", "execution_trace_step", "blocked_audit_event",
  "deletion_audit", "deletion_audit_count", "branch_event", "branch_status_history", "deletion_txn_marker", "personal_rule_variant"];
// 用户库：DELETE 只放行删除入口（清单 §3.6 第 (6) 条受保护表）
export const USER_PROTECTED = ["profile", "calculation_input", "input_tz_resolution", "profile_config_ref", "calculation_snapshot",
  "snapshot_non_formal_reason", "snapshot_degradation_reason", "snapshot_dependency", "snapshot_gov_approval", "snapshot_gov_blocker",
  "snapshot_gov_sequence", "snapshot_resolved_context", "execution_trace_step"];
// 用户库：永不可删
const USER_NEVER_DELETE = ["deletion_audit", "deletion_audit_count", "branch_event", "branch_status_history", "blocked_audit_event", "personal_rule_variant"];

function tableNames(sql: string): string[] {
  return [...sql.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]!);
}

function historyTriggers(h: (typeof HISTORY_A)[number]): string {
  const keyEq = (a: string) => h.key.map((k) => `${a}.${k} = NEW.${k}`).join(" AND ");
  const lines = [
    `CREATE TRIGGER ${h.table}_seq_bi BEFORE INSERT ON ${h.table} BEGIN`,
    `  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM ${h.table} WHERE sequence_no = NEW.sequence_no);`,
    `  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM ${h.table} WHERE sequence_no > NEW.sequence_no);`,
    `  SELECT RAISE(ABORT, '[DB-Q-01] 该键首条记录的 previous 须为空') WHERE NEW.${h.prev} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${h.table} t WHERE ${keyEq("t")});`,
    `  SELECT RAISE(ABORT, '[DB-Q-02] previous 须等于同键上一条的 new') WHERE EXISTS (SELECT 1 FROM ${h.table} t WHERE ${keyEq("t")})`,
    `    AND NEW.${h.prev} IS NOT (SELECT t.${h.next} FROM ${h.table} t WHERE ${keyEq("t")} ORDER BY t.sequence_no DESC LIMIT 1);`,
    `  SELECT RAISE(ABORT, '[DB-Q-09] previous = new 的无转换行') WHERE NEW.${h.prev} IS NEW.${h.next};`,
  ];
  if (h.release) lines.push(
    `  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退') WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <`,
    `    (SELECT max(d.release_seq) FROM ${h.table} t JOIN data_release d ON d.data_release = t.data_release WHERE ${keyEq("t")});`);
  lines.push("END;");
  return lines.join("\n");
}

// ---- 结构化 JSON 列（清单 §3.9；DB-J-01～05、07）。BEFORE INSERT 触发器先于 CHECK 执行，给出分项定位；CHECK 保留为兜底。
const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const SEGMENT_KEYS = ["v", "kind", "module", "school_id", "edition_id", "from", "to"] as const;
const YMD = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
function jsonHead(t: string, c: string): string[] {
  return [
    `  SELECT RAISE(ABORT, '[DB-J-01] ${t}.${c} 不是合法 JSON') WHERE NOT json_valid(NEW.${c});`,
    `  SELECT RAISE(ABORT, '[DB-J-05] ${t}.${c} 顶层须为对象') WHERE json_type(NEW.${c}) <> 'object';`,
    `  SELECT RAISE(ABORT, '[DB-J-03] ${t}.${c} 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.${c}, '$.v') IS NOT 'integer' OR json_extract(NEW.${c}, '$.v') <> 1;`,
  ];
}
function scopeTrigger(t: string, c: string, kinds: readonly ("all" | "segment")[]): string {
  return [
    `CREATE TRIGGER ${t}_${c}_json_bi BEFORE INSERT ON ${t} WHEN NEW.${c} IS NOT NULL BEGIN`,
    ...jsonHead(t, c),
    `  SELECT RAISE(ABORT, '[DB-J-02] ${t}.${c} 的 kind 只许 ${kinds.join(" / ")}') WHERE json_type(NEW.${c}, '$.kind') IS NOT 'text' OR json_extract(NEW.${c}, '$.kind') NOT IN (${q(kinds)});`,
    `  SELECT RAISE(ABORT, '[DB-J-04] ${t}.${c} 含未知键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.${c}) e WHERE`,
    `    (json_extract(NEW.${c}, '$.kind') = 'all' AND e.key NOT IN ('v', 'kind')) OR (json_extract(NEW.${c}, '$.kind') = 'segment' AND e.key NOT IN (${q(SEGMENT_KEYS)})));`,
    `  SELECT RAISE(ABORT, '[DB-J-07] ${t}.${c} 分段范围不合规（module 必填；from、to 为 YYYY-MM-DD 且 from ≤ to；school_id、edition_id 为文本）') WHERE json_extract(NEW.${c}, '$.kind') = 'segment' AND (`,
    `    json_type(NEW.${c}, '$.module') IS NOT 'text'`,
    `    OR (json_type(NEW.${c}, '$.school_id') IS NOT NULL AND json_type(NEW.${c}, '$.school_id') <> 'text')`,
    `    OR (json_type(NEW.${c}, '$.edition_id') IS NOT NULL AND json_type(NEW.${c}, '$.edition_id') <> 'text')`,
    `    OR (json_type(NEW.${c}, '$.from') IS NOT NULL AND (json_type(NEW.${c}, '$.from') <> 'text' OR json_extract(NEW.${c}, '$.from') NOT GLOB ${YMD}))`,
    `    OR (json_type(NEW.${c}, '$.to') IS NOT NULL AND (json_type(NEW.${c}, '$.to') <> 'text' OR json_extract(NEW.${c}, '$.to') NOT GLOB ${YMD}))`,
    `    OR (json_type(NEW.${c}, '$.from') = 'text' AND json_type(NEW.${c}, '$.to') = 'text' AND json_extract(NEW.${c}, '$.from') > json_extract(NEW.${c}, '$.to')));`,
    "END;"].join("\n");
}
function conditionsTrigger(t: string, c: string): string {
  return [
    `CREATE TRIGGER ${t}_${c}_json_bi BEFORE INSERT ON ${t} WHEN NEW.${c} IS NOT NULL BEGIN`,
    ...jsonHead(t, c),
    `  SELECT RAISE(ABORT, '[DB-J-04] ${t}.${c} 结构不合规（只许 v、all；all 为数组；每项只许 op、param、value；op 只许 param_selected、param_equals）') WHERE`,
    `    EXISTS (SELECT 1 FROM json_each(NEW.${c}) e WHERE e.key NOT IN ('v', 'all')) OR json_type(NEW.${c}, '$.all') IS NOT 'array'`,
    `    OR EXISTS (SELECT 1 FROM json_each(NEW.${c}, '$.all') i WHERE i.type <> 'object'`,
    `      OR json_extract(i.value, '$.op') IS NULL OR json_extract(i.value, '$.op') NOT IN ('param_selected', 'param_equals')`,
    `      OR json_type(i.value, '$.param') IS NOT 'text'`,
    `      OR (json_extract(i.value, '$.op') = 'param_equals' AND json_type(i.value, '$.value') IS NOT 'text')`,
    `      OR (json_extract(i.value, '$.op') = 'param_selected' AND json_type(i.value, '$.value') IS NOT NULL)`,
    `      OR EXISTS (SELECT 1 FROM json_each(i.value) k WHERE k.key NOT IN ('op', 'param', 'value')));`,
    "END;"].join("\n");
}
const topKeys = (r: unknown) => Object.keys((r as { fields: Record<string, unknown> }).fields);
function payloadTrigger(t: string, c: string, byDomain: Record<string, string[]> | string[]): string {
  const cond = Array.isArray(byDomain)
    ? `e.key NOT IN (${q(byDomain)})`
    : [...Object.entries(byDomain).map(([d, ks]) => `(NEW.domain = '${d}' AND e.key NOT IN (${q(ks)}))`),
       `(NEW.domain NOT IN (${q(Object.keys(byDomain))}) AND e.key <> 'v')`].join(" OR ");
  return [
    `CREATE TRIGGER ${t}_${c}_json_bi BEFORE INSERT ON ${t} WHEN NEW.${c} IS NOT NULL BEGIN`,
    ...jsonHead(t, c),
    `  SELECT RAISE(ABORT, '[DB-J-04] ${t}.${c} 含该结构版本未定义的顶层键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.${c}) e WHERE ${cond});`,
    "END;"].join("\n");
}
export const JSON_COLUMNS = {
  formal: [
    scopeTrigger("component_default", "applicable_scope", ["all"]),
    scopeTrigger("param_variant_map", "applicable_scope", ["all"]),
    scopeTrigger("variant_supersedes", "applicable_scope", ["all", "segment"]),
    scopeTrigger("approval_record", "scope", ["all", "segment"]),
    conditionsTrigger("approval_record", "conditions"),
    conditionsTrigger("admission_record", "conditions"),
    payloadTrigger("passage", "against_what", ["v", "edition", "image"]),
  ],
  user: [
    // 风水、历法载荷结构未定义（【待定】）：该两域只许 v，即暂不可写入
    payloadTrigger("calculation_input", "raw_payload", { BAZI: topKeys(RAW_BAZI), LIUYAO: topKeys(RAW_LIUYAO) }),
    payloadTrigger("calculation_input", "normalized_payload", topKeys(NORMALIZED)),
    payloadTrigger("calculation_snapshot", "result_payload", { BAZI: topKeys(RESULT_BAZI), LIUYAO: topKeys(RESULT_LIUYAO) }),
  ],
};

const MARKER = (col: string) => `(SELECT ${col} FROM deletion_txn_marker WHERE id = 1)`;

export function generate(): { formal: string; user: string } {
  const locked = cfg01Locked();
  const head = (src: string) => `-- 由 db/gen.ts 从 ${src} 生成，请勿手改（CI 以 --check 比对）。\n`;

  // ---- 正式库
  const fIn = read("db/sql/formal.sql.in");
  const fTables = tableNames(fIn).filter((t) => !FORMAL_TABLES_SKIP.has(t));
  const formalBody = fIn
    .replace(/^CREATE TABLE (\w+)/gm, "CREATE TABLE formal.$1")
    .replace(/^CREATE VIRTUAL TABLE (\w+)/gm, "CREATE VIRTUAL TABLE formal.$1")
    .replace(/^CREATE VIEW (\w+)/gm, "CREATE VIEW formal.$1")
    .replace(/^CREATE TRIGGER (\w+)/gm, "CREATE TRIGGER formal.$1");
  const fGen: string[] = ["", "-- ===================================================================== 生成：甲类状态转换历史（清单 §3.3）"];
  for (const h of HISTORY_A.filter((x) => x.schema === "formal")) fGen.push(historyTriggers(h).replace(/^CREATE TRIGGER (\w+)/, "CREATE TRIGGER formal.$1"));
  fGen.push("", "-- ===================================================================== 生成：结构化 JSON 列（清单 §3.9）");
  for (const tr of JSON_COLUMNS.formal) fGen.push(tr.replace(/^CREATE TRIGGER (\w+)/, "CREATE TRIGGER formal.$1"));
  fGen.push("", "-- ===================================================================== 生成：正式库只读、只追加（DB-I；§1.2、§1.1 第 5 条）");
  for (const t of fTables) {
    fGen.push(`CREATE TRIGGER formal.${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '[DB-I-${t}] 正式库只读、只追加，拒绝 UPDATE'); END;`);
    fGen.push(`CREATE TRIGGER formal.${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '[DB-I-${t}] 正式库只读、只追加，拒绝 DELETE'); END;`);
  }

  // ---- 用户库
  const uIn = read("db/sql/user.sql.in");
  if (!uIn.includes("{{CFG01_LOCKED}}")) throw new Error("user.sql.in 缺 {{CFG01_LOCKED}} 占位符");
  const uTables = new Set(tableNames(uIn));
  for (const t of [...USER_NO_UPDATE, ...USER_PROTECTED, ...USER_NEVER_DELETE]) if (!uTables.has(t)) throw new Error(`生成清单引用了不存在的表 ${t}`);
  const userBody = uIn.replaceAll("{{CFG01_LOCKED}}", locked);
  const uGen: string[] = ["", "-- ===================================================================== 生成：甲类状态转换历史（清单 §3.3）"];
  for (const h of HISTORY_A.filter((x) => x.schema === "main")) uGen.push(historyTriggers(h));
  uGen.push("", "-- ===================================================================== 生成：结构化 JSON 列（清单 §3.9）");
  for (const tr of JSON_COLUMNS.user) uGen.push(tr);
  uGen.push("", "-- ===================================================================== 生成：拒绝 UPDATE（DB-I；§1.2）");
  const tag = (t: string) => (t === "deletion_audit" || t === "deletion_audit_count" ? "[DB-D-audit-immutable]" : ""); // DB-D-18
  for (const t of USER_NO_UPDATE) uGen.push(`CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${tag(t)}[DB-I-${t}] 用户库计算层与审计记录拒绝 UPDATE'); END;`);
  uGen.push("", "-- ===================================================================== 生成：DELETE 只放行删除个人资料入口（清单 §3.6 第 (6) 条）");
  for (const t of USER_PROTECTED) uGen.push([
    `CREATE TRIGGER ${t}_bd BEFORE DELETE ON ${t} BEGIN`,
    `  SELECT RAISE(ABORT, '[DB-D-gate][DB-I-${t}] 删除未经授权（只开放删除个人资料入口）')`,
    `    WHERE coalesce(xs_del_gate(OLD.owner_profile_id, ${MARKER("txn_token")}, ${MARKER("audit_id")}, ${MARKER("grant_seq")}), 0) <> 1;`,
    `  SELECT RAISE(ABORT, '[DB-D-audit] 删除前须先写本次成功审计')`,
    `    WHERE NOT EXISTS (SELECT 1 FROM deletion_audit WHERE audit_id = ${MARKER("audit_id")} AND success = 1);`,
    "END;"].join("\n"));
  uGen.push("", "-- ===================================================================== 生成：永不可删（§10.4 审计、只追加记录）");
  for (const t of USER_NEVER_DELETE) uGen.push(`CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${tag(t)}[DB-I-${t}] 永不可删'); END;`);

  return {
    formal: head("db/sql/formal.sql.in") + formalBody + fGen.join("\n") + "\n",
    user: head("db/sql/user.sql.in + data/contract/constants.toml [cfg01]") + userBody + uGen.join("\n") + "\n",
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const out = generate();
  const files = { "db/sql/formal.sql": out.formal, "db/sql/user.sql": out.user };
  if (process.argv.includes("--check")) {
    let bad = 0;
    for (const [rel, text] of Object.entries(files)) {
      let cur = "";
      try { cur = read(rel); } catch { /* 缺文件 */ }
      if (cur !== text) { console.log(`❌ ${rel} 与生成结果不一致（请运行 npm run gen:ddl）`); bad++; }
      else console.log(`✅ ${rel} 与生成结果一致`);
    }
    process.exit(bad ? 1 : 0);
  }
  for (const [rel, text] of Object.entries(files)) { writeFileSync(new URL(rel, root), text); console.log(`写出 ${rel}`); }
}
