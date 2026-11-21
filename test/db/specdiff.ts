// 独立规格与 DDL 的双向比对（E2-FIX D）：从内存库的 sqlite_master 读出实际结构，与 db/spec.json 逐项比较。
// 缺失 = 规格要求而 DDL 没有；多出 = DDL 有而规格未要求；变更 = 两边都有但内容不同。
import type { DatabaseSync } from "node:sqlite";
import type { Spec } from "./helpers.js";

export interface DdlEnum { constraint: string; values: (string | number)[]; nullable: boolean }
export interface DdlFk { table: string; from: string[]; to: string[]; deferred: boolean }
export interface DdlTable { schema: string; enums: Map<string, DdlEnum>; fks: DdlFk[]; columns: string[]; pk: string[]; unique: string[][]; checks: string[]; raises: string[]; triggers: string[] }
export interface DdlModel { tables: Map<string, DdlTable>; raises: Set<string>; constraints: Set<string> }

/** 顶层逗号切分 */
function splitDefs(body: string): string[] {
  const out: string[] = []; let d = 0; let cur = ""; let q = false;
  for (const ch of body) {
    if (ch === "'") q = !q;
    if (!q && ch === "(") d++;
    if (!q && ch === ")") d--;
    if (!q && d === 0 && ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const parseVals = (s: string) => s.split(",").map((x) => x.trim()).map((x) => (x.startsWith("'") ? x.slice(1, -1) : Number(x)));

export function ddlModel(db: DatabaseSync): DdlModel {
  const tables = new Map<string, DdlTable>();
  const raises = new Set<string>(); const constraints = new Set<string>();
  for (const schema of ["formal", "main"]) {
    const rows = db.prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'passage_fts%'`).all() as { name: string; sql: string }[];
    for (const r of rows) {
      const body = r.sql.slice(r.sql.indexOf("(") + 1, r.sql.lastIndexOf(")"));
      const enums = new Map<string, DdlEnum>();
      const fks: DdlFk[] = [];
      for (const def of splitDefs(body)) {
        // 枚举：任何命名约束，形如 CHECK (c IN (…)) 或 CHECK (c IS NULL OR c IN (…))（不限 DB-E 前缀，防止枚举换名漏检）
        const em = /CONSTRAINT "([^"]+)" CHECK \((?:(\w+) IS NULL OR )?(\w+) IN \(([^)]*)\)\)/.exec(def);
        if (em) enums.set(em[3]!, { constraint: em[1]!, values: parseVals(em[4]!), nullable: em[2] !== undefined });
        const fm = /REFERENCES (\w+)\(([^)]*)\)/.exec(def);
        if (fm) {
          const from = def.startsWith("FOREIGN KEY") ? /FOREIGN KEY \(([^)]*)\)/.exec(def)![1]!.split(",").map((x) => x.trim()) : [def.split(/\s+/)[0]!];
          fks.push({ table: fm[1]!, from, to: fm[2]!.split(",").map((x) => x.trim()), deferred: /DEFERRABLE INITIALLY DEFERRED/.test(def) });
        }
      }
      const cols = db.prepare(`PRAGMA ${schema}.table_info("${r.name}")`).all() as { name: string; pk: number }[];
      const unique = (db.prepare(`PRAGMA ${schema}.index_list("${r.name}")`).all() as { name: string; unique: number; origin: string }[])
        .filter((i) => i.unique && i.origin !== "pk").map((i) => (db.prepare(`PRAGMA ${schema}.index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name));
      const checks = [...r.sql.matchAll(/CONSTRAINT "([^"]+)" CHECK/g)].map((m) => m[1]!);
      for (const c of checks) constraints.add(c);
      const trig = db.prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = 'trigger' AND tbl_name = ?`).all(r.name) as { name: string; sql: string }[];
      const rz = trig.flatMap((t) => [...t.sql.matchAll(/RAISE\(ABORT, '((?:\[[^\]]+\])+)/g)].flatMap((m) => [...m[1]!.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]!)));
      for (const x of rz) raises.add(x);
      tables.set(r.name, { schema, enums, fks, columns: cols.map((c) => c.name).sort(), pk: cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name),
        unique, checks, raises: [...new Set(rz)], triggers: trig.map((t) => t.name).sort() });
    }
  }
  return { tables, raises, constraints };
}

export interface SpecDiff { missing: string[]; extra: string[]; changed: string[] }
/** 约束编号的基码：DB-F-05a → DB-F-05a；DB-F-03-claim → DB-F-03；DB-F-13b-personal → DB-F-13b；DB-U-14-edition → DB-U-14 */
export const baseCode = (c: string) => /^(DB-[A-Z]-\d+[a-z]?)/.exec(c)?.[1] ?? c;
const fkKey = (f: { from: string[] }) => f.from.join(",");
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 规格 ↔ DDL 双向比对：表、枚举（值与可空）、外键（目标、列、延迟） */
export function diffSpec(m: DdlModel, sp: Spec, implCodes?: Set<string>): SpecDiff {
  const d: SpecDiff = { missing: [], extra: [], changed: [] };
  for (const [t, s] of Object.entries(sp.tables)) {
    const got = m.tables.get(t);
    if (!got) { d.missing.push(`表 ${t}`); continue; }
    if (got.schema !== s.schema) d.changed.push(`表 ${t}：库 规格 ${s.schema} / DDL ${got.schema}`);
    for (const [c, e] of Object.entries(s.enums)) {
      const g = got.enums.get(c);
      if (!g) { d.missing.push(`枚举 ${t}.${c}`); continue; }
      if (!same([...e.values].map(String).sort(), [...g.values].map(String).sort())) d.changed.push(`枚举 ${t}.${c}：值 规格 [${e.values.join("/")}] / DDL [${g.values.join("/")}]`);
      if (e.nullable !== g.nullable) d.changed.push(`枚举 ${t}.${c}：可空 规格 ${e.nullable} / DDL ${g.nullable}`);
      if (e.constraint !== g.constraint) d.changed.push(`枚举 ${t}.${c}：约束名 规格 ${e.constraint} / DDL ${g.constraint}`);
    }
    for (const c of got.enums.keys()) if (!(c in s.enums)) d.extra.push(`枚举 ${t}.${c}`);
    for (const f of s.fks) {
      const g = got.fks.find((x) => fkKey(x) === fkKey(f));
      if (!g) { d.missing.push(`外键 ${t}(${fkKey(f)}) → ${f.table}`); continue; }
      if (g.table !== f.table || !same(g.to, f.to)) d.changed.push(`外键 ${t}(${fkKey(f)})：目标 规格 ${f.table}(${f.to}) / DDL ${g.table}(${g.to})`);
      if (g.deferred !== f.deferred) d.changed.push(`外键 ${t}(${fkKey(f)})：延迟 规格 ${f.deferred} / DDL ${g.deferred}`);
    }
    for (const g of got.fks) if (!s.fks.some((f) => fkKey(f) === fkKey(g))) d.extra.push(`外键 ${t}(${fkKey(g)}) → ${g.table}`);
    // 列集合、主键、唯一约束（E2-FIX-2 P2-3）
    for (const c of s.columns ?? []) if (!got.columns.includes(c)) d.missing.push(`列 ${t}.${c}`);
    for (const c of got.columns) if (!(s.columns ?? []).includes(c)) d.extra.push(`列 ${t}.${c}`);
    if (s.pk && !same(s.pk, got.pk)) d.changed.push(`主键 ${t}：规格 (${s.pk.join(",")}) / DDL (${got.pk.join(",")})`);
    const uk = (u: string[]) => [...u].sort().join(",");
    for (const u of s.unique ?? []) if (!got.unique.some((g) => uk(g) === uk(u.cols)) && uk(got.pk) !== uk(u.cols)) d.missing.push(`唯一 ${t}(${u.cols.join(",")})`);
    for (const g of got.unique) if (!(s.unique ?? []).some((u) => uk(u.cols) === uk(g))) d.extra.push(`唯一 ${t}(${g.join(",")})`);
    // 规格写成 UNIQUE、DDL 取作主键者视为满足（主键蕴含唯一）
  }
  // CHECK 与触发器的定位编号（P2-3）：DDL 中每个命名 CHECK 与触发器 RAISE 编号须能对应到清单第 5 节“失败定位”或补充表；
  // 反向：清单第 5 节列为失败定位的编号，须在 DDL 或实现代码中出现（实现代码中的编号由调用方传入）
  if (sp.locators) {
    const listed = new Set(sp.locators.from_checklist_s5);
    // 已列：编号本身在清单第 5 节，或其为清单编号加后缀（DB-U-07 → DB-U-07a；DB-U-15 → DB-U-15-owner），或补充表逐条列出
    // 已列：编号本身在清单第 5 节；或为清单编号加“-后缀”（DB-U-15 → DB-U-15-owner）；或清单只写无字母编号而 DDL 分出字母（DB-U-07 → DB-U-07a，
    // 但清单已逐字母列出时，多出的字母不算已列，如清单列 DB-F-05a/b/c 而 DDL 有 DB-F-05d）；或补充表逐条列出
    // 已列 = 编号恰在清单第 5 节，或补充表逐条列出（不按前缀推断，删掉任一列出的编号都能查出）
    const known = (c: string) => listed.has(c) || c in sp.locators!.extra;
    const generated = (c: string) => c.startsWith("DB-E-") || c.startsWith("DB-I-") || c.startsWith("DB-J-") || c === "<约束编号>";
    for (const c of [...m.constraints, ...m.raises]) if (!generated(c) && !known(c)) d.extra.push(`定位 ${c}（DDL 有而清单第 5 节与补充表均无）`);
  }
  for (const t of m.tables.keys()) if (!sp.tables[t]) d.extra.push(`表 ${t}`);
  // DB-I：正式库每表须有拒 UPDATE、拒 DELETE 两个触发器（清单 §5.1 DB-I）
  for (const [t, g] of m.tables) if (g.schema === "formal" && !t.startsWith("passage_fts"))
    for (const k of ["no_update", "no_delete"]) if (!g.triggers.includes(`${t}_${k}`)) d.missing.push(`触发器 ${t}_${k}（DB-I）`);
  if (sp.locators && implCodes) {
    const have = [...m.constraints, ...m.raises, ...implCodes];
    // “DB-U-07”由 DB-U-07a～e 实现、“DB-F-22”由 DB-F-22b 实现：编号本身或以其为前缀加字母 / “-”的编号出现即算实现
    const implemented = (c: string) => have.some((h) => h === c || (h.startsWith(c) && /^[a-z-]/.test(h.slice(c.length))));
    // 补充表列出的编号也须真实存在（删除触发器 / CHECK 后可被查出）
    for (const c of Object.keys(sp.locators.extra)) if (!have.includes(c)) d.missing.push(`定位 ${c}（补充表列出，DDL 与实现均无）`);
    for (const c of sp.locators.from_checklist_s5) if (!implemented(c) && !(c in (sp.locators.mapped ?? {}))) d.missing.push(`定位 ${c}（清单第 5 节列为失败定位，DDL 与实现均无）`);
  }
  return d;
}
