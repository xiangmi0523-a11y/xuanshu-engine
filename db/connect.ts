// 测试进程内存库：只允许 DatabaseSync(":memory:") 与 ATTACH ':memory:'（B3-1 D1；E2 实施授权书第六节）。
// 用户库为 main，正式库挂为 formal。不生成、不打开任何 .sqlite / .db 文件。
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../../", import.meta.url);
let cache: { formal: string; user: string } | undefined;
function sql() {
  cache ??= {
    formal: readFileSync(new URL("db/sql/formal.sql", root), "utf8"),
    user: readFileSync(new URL("db/sql/user.sql", root), "utf8"),
  };
  return cache;
}

// 跨库视图只能是 TEMP 视图（清单 §3.10、Z-6）：连接 ATTACH 正式库后创建，不属于 user.sqlite 结构
export const TEMP_VIEWS = `
CREATE TEMP VIEW v_config_closure AS
  SELECT c.config_id, c.config_version, c.module, p.param_id, p.value, p.value_source, p.apply_mode,
         m.rule_variant_id, vf.formal_status AS variant_formal_status, vf.component_id
  FROM main.calculation_config c
  JOIN main.config_param_value p ON p.config_id = c.config_id AND p.config_version = c.config_version
  LEFT JOIN formal.param_variant_map m ON m.param_id = p.param_id AND m.param_value = p.value
  LEFT JOIN formal.v_variant_formal vf ON vf.rule_variant_id = m.rule_variant_id;
CREATE TEMP VIEW v_config_status AS
  SELECT c.config_id, c.config_version,
    CASE WHEN EXISTS (SELECT 1 FROM v_config_closure x WHERE x.config_id = c.config_id AND x.config_version = c.config_version
                        AND x.apply_mode = 'applied' AND x.rule_variant_id IS NOT NULL AND x.variant_formal_status <> 'FORMAL')
         THEN 'NON_FORMAL' ELSE 'FORMAL' END AS formal_status
  FROM main.calculation_config c;
`;

export interface OpenOptions {
  /** 不建结构（仅供隔离测试替身使用） */
  empty?: boolean;
  /** 只建表（去掉触发器与视图）：供 DB-N / DB-E / DB-K 生成矩阵单独检验列级约束（触发器另有专门用例） */
  tablesOnly?: boolean;
  /** 只供变异测试：以改写后的 DDL 文本建库（仍为内存库），用于证明矩阵与双向比对在约束被删除时会失败 */
  sql?: { formal: string; user: string };
}
const stripToTables = (sqlText: string) =>
  sqlText.replace(/^CREATE TRIGGER[\s\S]*?END;$/gm, "").replace(/^CREATE (?:TEMP )?VIEW[\s\S]*?;$/gm, "");

/** 打开一个测试用内存库：main = 用户库，formal = 正式库（同为内存库）。 */
/** 读取当前 DDL 文本（变异测试据此改写） */
export const ddlText = (): { formal: string; user: string } => ({ ...sql() });

export function openMemoryDb(opts: OpenOptions = {}): DatabaseSync {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true, allowExtension: false, enableDoubleQuotedStringLiterals: false });
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("ATTACH DATABASE ':memory:' AS formal");
  if (!opts.empty) {
    const s = opts.sql ?? sql();
    db.exec(opts.tablesOnly ? stripToTables(s.formal) : s.formal);
    db.exec(opts.tablesOnly ? stripToTables(s.user) : s.user);
    if (!opts.tablesOnly) db.exec(TEMP_VIEWS);
  }
  return db;
}

/** 断言连接为内存库（DB-G-03 的前置判断；location() 对内存库的返回值在测试中实测确认）。 */
export function isMemoryDb(db: { location(dbName?: string): string | null; prepare(sql: string): { all(): unknown[] } }): boolean {
  const mem = (loc: string | null) => loc === null || loc === "" || loc === ":memory:";
  const schemas = (db.prepare("PRAGMA database_list").all() as { name: string }[]).map((r) => r.name);
  return schemas.every((n) => mem(db.location(n)));
}
