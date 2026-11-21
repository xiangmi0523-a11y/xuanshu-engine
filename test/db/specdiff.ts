// 独立规格与 DDL 的双向比对（E2-FIX D）：从内存库的 sqlite_master 读出实际结构，与 db/spec.json 逐项比较。
// 缺失 = 规格要求而 DDL 没有；多出 = DDL 有而规格未要求；变更 = 两边都有但内容不同。
import type { DatabaseSync } from "node:sqlite";
import type { Spec } from "./helpers.js";

export interface DdlEnum { constraint: string; values: (string | number)[]; nullable: boolean }
export interface DdlFk { table: string; from: string[]; to: string[]; deferred: boolean }
export interface DdlModel { tables: Map<string, { schema: string; enums: Map<string, DdlEnum>; fks: DdlFk[] }> }

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
  const tables = new Map<string, { schema: string; enums: Map<string, DdlEnum>; fks: DdlFk[] }>();
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
      tables.set(r.name, { schema, enums, fks });
    }
  }
  return { tables };
}

export interface SpecDiff { missing: string[]; extra: string[]; changed: string[] }
const fkKey = (f: { from: string[] }) => f.from.join(",");
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 规格 ↔ DDL 双向比对：表、枚举（值与可空）、外键（目标、列、延迟） */
export function diffSpec(m: DdlModel, sp: Spec): SpecDiff {
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
  }
  for (const t of m.tables.keys()) if (!sp.tables[t]) d.extra.push(`表 ${t}`);
  return d;
}
