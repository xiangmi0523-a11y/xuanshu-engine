// 生成独立机读规格 db/spec.json（E2-FIX D）。
// 输入只有两份：db/spec/checklist_s4.md（审核清单第 4 节逐字摘录）与 db/spec/sources.json（清单未逐列写明处的补充，逐条注明契约 / 清单出处）。
// 本脚本不读 DDL；DDL 与规格的双向比对在 test/db/spec.test.ts。
// 用法：node scripts/gen-spec.mjs            写出 db/spec.json
//       node scripts/gen-spec.mjs --check    只比较，不写（CI：规格须与输入一致）
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const checklistText = read("db/spec/checklist_s4.md");
const sources = JSON.parse(read("db/spec/sources.json"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- 解析清单行
const ROW = /^\| ([FU]\d+[a-z]?) \| ([^|]+) \| (.+) \| ([^|]*) \| ([^|]*) \|$/;
/** 顶层切分（不进入任何括号） */
function splitTop(s, seps) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if ("(（".includes(ch)) depth++;
    if (")）".includes(ch)) depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
/** 取 name( … ) 的括号体（配对括号） */
function subBody(fields, name) {
  const re = new RegExp(`(?:^|[^\\w])${name}\\(`, "g");
  const m = re.exec(fields);
  if (!m) return undefined;
  let i = m.index + m[0].length; const start = i; let depth = 1;
  for (; i < fields.length && depth > 0; i++) { if (fields[i] === "(") depth++; if (fields[i] === ")") depth--; }
  return { body: fields.slice(start, i - 1), from: m.index + (m[0].length - name.length - 1), to: i };
}
const RANGE = /^([A-Z]*-?)([A-Z0-9])[～–]\1([A-Z0-9])$/;
function expandValues(raw) {
  const s = raw.trim();
  const r = RANGE.exec(s.replace(/\s+/g, ""));
  if (r) {
    const [, pre, a, b] = r; const out = [];
    for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(pre + String.fromCharCode(c));
    return out;
  }
  const parts = s.split("/").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /^[\w\-（）一-鿿]+$/u.test(p))) return parts;
  return undefined;
}

const pkMap = new Map(); // 列名 -> 以该列为单列 PK 的表（清单 PK 标记）
const tables = new Map(); // name -> { schema, row, required:Set, enumTokens:[], fkCols:[] }
let schema = "formal";
for (const line of checklistText.split("\n")) {
  if (line.startsWith("### 4.1")) schema = "formal";
  if (line.startsWith("### 4.2")) schema = "main";
  const m = ROW.exec(line);
  if (!m) continue;
  const [, rid, tcell, fields] = m;
  const names = tcell.split("/").map((x) => x.trim());
  const bodies = new Map();
  let rest = fields;
  for (const n of names) {
    const sb = subBody(fields, n);
    if (sb) { bodies.set(n, sb.body); rest = rest.replace(fields.slice(sb.from, sb.to), ""); }
  }
  const unbound = names.filter((n) => !bodies.has(n));
  for (const n of unbound) bodies.set(n, unbound.length === 1 ? rest : fields);
  for (const [n, body] of bodies) {
    const t = tables.get(n) ?? { schema, row: rid, required: new Set(), enums: [], fkCols: [], cols: new Set(), pk: null, unique: [] };
    // 表级 PK(…) / UNIQUE(…)（P2-3）：“PK 三列”“PK(三列)”由 sources 补列名
    for (const m of body.matchAll(/(?:^|[；、\s(])PK\(([a-z_][\w, ]*)\)/g)) t.pk = m[1].split(",").map((x) => x.trim());
    for (const m of body.matchAll(/UNIQUE\(([a-z_][\w, ]*)\)/g)) t.unique.push(m[1].split(",").map((x) => x.trim()));
    tables.set(n, t);
    for (const seg of splitTop(body, "；")) {
      const allReq = /均必\)?\s*$/.test(seg) || /均必/.test(seg);
      for (const item of splitTop(seg.replace(/\s*均必\s*$/, ""), "、，")) {
        // “（scope 必 CHECK(…)；…）”这类括号内点名的列：枚举归括号内的列
        for (const inner of item.matchAll(/（[^（）]*?([a-z_]\w*) (必|可|条) ?CHECK\(([^()]*)\)/g)) {
          t.enums.push({ col: inner[1], values: expandValues(inner[3]), raw: inner[3], strength: inner[2], src: `清单 ${rid}` });
          if (inner[2] === "必") t.required.add(inner[1]);
        }
        const itemOuter = item.replace(/（[^（）]*）/g, "");
        const im = /^([a-z_][\w]*(?:\s*\/\s*[a-z_]\w*)*)\s*(.*)$/.exec(itemOuter) ?? /^[\u4e00-\u9fff]+\s*([a-z_]\w*)\s+((?:必|可|条).*)$/u.exec(itemOuter);
        if (!im) continue;
        const cols = im[1].split("/").map((x) => x.trim());
        const tail = im[2]; // 去掉全角括号注释后的尾部：强度、PK、FK、CHECK 由此判定
        const tailFull = item.slice(item.indexOf(im[1]) + im[1].length); // 含括号注释：延迟、可空枚举由此判定
        const strength = /^(必|可|条)/.exec(tail)?.[1] ?? (allReq ? "必" : undefined);
        for (const c of cols) {
          t.cols.add(c);
          if (/(^|\s)PK(\s|$)/.test(tail) && cols.length === 1) t.pk = [c];
          if (/(^|\s)UNIQUE(\s|$)/.test(tail) && cols.length === 1) t.unique.push([c]);
          if (strength === "必") t.required.add(c);
          if (/(^|\s)PK(\s|$)/.test(tail) && !/FK/.test(tail) && cols.length === 1 && !pkMap.has(c)) pkMap.set(c, { table: n, src: `清单 ${rid}：${n}.${c} 为 PK` });
          if (/(^|\s)FK(\s|（|$)/.test(tail) || /\bFK\b/.test(tail)) t.fkCols.push({ col: c, deferred: /FK（延迟）/.test(tailFull), src: `清单 ${rid}` });
          // CHECK 写在本列强度注释里（“skip_kind 条（未执行时 CHECK(…)）”）亦归本列；注释里点名了别的列者（F41 scope）不归
          const ckInNote = /（([^（）]*?)CHECK\(([^()]*)\)/.exec(tailFull);
          const ck = /CHECK\(([^()]*)\)/.exec(tail) ?? (ckInNote && !/[a-z_]\w* (必|可|条)/.test(ckInNote[1]) ? [ckInNote[0], ckInNote[2]] : null);
          const nullableEnum = /可空枚举\s+([^）]+)/.exec(tailFull);
          if (ck) {
            // 单值等式（= 'USER'）、IS NULL、只写一个值（用户操作）都不是多值枚举
            const single = ck[1].startsWith("=") || ck[1].trim() === "IS NULL" || /^[^/～–\s]+$/.test(ck[1].trim()) && !/值|档|类/.test(ck[1]);
            const v = single ? "FIXED" : expandValues(ck[1]);
            t.enums.push({ col: c, values: v, raw: ck[1], strength, src: `清单 ${rid}` });
          } else if (nullableEnum && cols.at(-1) === c) {
            // “image_ref / … / result 条（见 P-30；result 可空枚举 MATCH / MISMATCH / PARTIAL）”：只作用于点名的列
            const target = /(\w+) 可空枚举/.exec(tailFull)?.[1];
            if (target) t.enums.push({ col: target, values: expandValues(nullableEnum[1].replace(/）$/, "")), raw: nullableEnum[0], strength: "可", src: `清单 ${rid}` });
          } else if (/(^|\s)bool(\s|、|$)/.test(tail)) {
            t.enums.push({ col: c, values: [0, 1], raw: "bool", strength, src: `清单 ${rid}（bool）` });
          } else if (/CHECK|可枚举/.test(tail)) {
            t.enums.push({ col: c, values: undefined, raw: tail, strength, src: `清单 ${rid}` });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 组装：清单 + 补充
const problems = [];
const out = {};
const tableSet = new Set([...tables.keys(), ...Object.keys(sources.tables).filter((t) => sources.tables[t].add_table)]);
function resolveTarget(t, col) {
  const k = `${t}.${col}`;
  const map = sources.fk_targets[k] ?? sources.fk_targets[col];
  if (map) return map;
  const pk = pkMap.get(col);
  if (pk && pk.table !== t) return { table: pk.table, to: [col], src: pk.src };
  if (tableSet.has(col)) return { table: col, to: [col], src: "规则：列名即表名" };
  const base = col.replace(/_id$/, "");
  if (col.endsWith("_id") && tableSet.has(base)) return { table: base, to: [col], src: "规则：<表>_id 指向该表" };
  return undefined;
}
for (const [name, t] of tables) {
  const s = sources.tables[name] ?? {};
  if (s.drop || s.replace) continue; // replace：该表由契约修订单整体取代（如 v1.0.6 evidence_link）
  const enums = {};
  for (const e of t.enums) {
    if (e.values === "FIXED") continue; // 单值等式（= 'USER' 等）不是枚举，由专门用例检验
    const fill = s.enums?.[e.col];
    const values = fill?.values ?? e.values;
    if (!values) { problems.push(`${name}.${e.col}：清单写 CHECK 而未列值（${e.raw}），sources 未补`); continue; }
    enums[e.col] = { constraint: `DB-E-${name}.${e.col}`, values, nullable: fill?.nullable ?? e.strength !== "必", src: fill ? `${e.src}；值：${fill.src}` : e.src };
  }
  const fks = [];
  for (const f of t.fkCols) {
    if (s.fk_skip?.includes(f.col)) continue;
    const tg = resolveTarget(name, f.col);
    if (!tg) { problems.push(`${name}.${f.col}：清单写 FK 而未写目标，sources 未补`); continue; }
    fks.push({ table: tg.table, from: [f.col], to: tg.to, deferred: f.deferred || (sources.deferred[`${name}.${f.col}`] !== undefined), src: `${f.src}；目标：${tg.src}${sources.deferred[`${name}.${f.col}`] ? `；延迟：${sources.deferred[`${name}.${f.col}`]}` : ""}` });
  }
  out[name] = { schema: t.schema, required: [...t.required].sort(), supplement: s.supplement ?? null, enums, fks, src: `清单 ${t.row}`,
    columns: [...t.cols], pk: t.pk, unique: t.unique.map((u) => ({ cols: u, src: `清单 ${t.row}` })) };
}
// 补充：清单未写的枚举、外键与新增表（逐条注明出处）
for (const [name, s] of Object.entries(sources.tables)) {
  if (s.drop) { delete out[name]; continue; }
  if (s.replace || s.add_table) out[name] = { schema: s.schema, required: [...s.required].sort(), supplement: s.supplement ?? null, enums: {}, fks: [], src: s.src, columns: [...s.required], pk: null, unique: [] };
  const o = out[name];
  if (!o) { problems.push(`sources 指向清单中没有的表 ${name}，且未标 add_table`); continue; }
  if (s.required_override) o.required = [...s.required_override.cols].sort(), o.src += `；必填：${s.required_override.src}`;
  for (const [c, e] of Object.entries(s.enums ?? {})) {
    if (o.enums[c] && !s.replace && !s.add_table) continue; // 已由清单给出、此处只补值
    if (!e.values) continue;
    o.enums[c] = { constraint: e.constraint ?? `DB-E-${name}.${c}`, values: e.values, nullable: !!e.nullable, src: e.src };
  }
  for (const [c, e] of Object.entries(s.enums ?? {})) if (e.constraint && o.enums[c]) o.enums[c].constraint = e.constraint, o.enums[c].src += `；约束名：${e.constraint_src}`;
  if (s.columns_drop) o.columns = o.columns.filter((c) => !s.columns_drop.cols.includes(c)), o.columns_drop_src = s.columns_drop.src;
  if (s.columns_add) for (const c of s.columns_add.cols) if (!o.columns.includes(c)) o.columns.push(c);
  if (s.columns_add) o.columns_src = s.columns_add.src;
  if (s.pk) { if (o.pk && o.pk.join() !== s.pk.cols.join()) problems.push(`${name}：sources PK 与清单不同`); o.pk = s.pk.cols; o.pk_src = s.pk.src; }
  for (const u of s.unique_add ?? []) o.unique.push({ cols: u.cols, src: u.src });
  for (const f of s.fks ?? []) {
    if (o.fks.some((x) => x.from.join() === f.from.join())) { problems.push(`${name}(${f.from})：sources 外键与清单重复，应改用 fk_targets`); continue; }
    o.fks.push({ table: f.table, from: f.from, to: f.to, deferred: !!f.deferred, src: f.src });
  }
}
// U16 个人表“与正式同名表同构”：枚举取正式同名表（列存在于个人表者）
for (const [name, s] of Object.entries(sources.tables)) {
  if (!s.isomorphic_of) continue;
  const o = out[name]; const f = out[s.isomorphic_of];
  for (const [c, e] of Object.entries(f.enums)) {
    if (s.columns_absent?.includes(c) || o.enums[c]) continue;
    o.enums[c] = { constraint: `DB-E-${name}.${c}`, values: e.values, nullable: s.enum_not_null?.includes(c) ? false : e.nullable, src: `清单 U16：与 ${s.isomorphic_of} 同构（${e.src}）` };
  }
}
for (const [name, o] of Object.entries(out)) {
  for (const c of [...o.required, ...(o.supplement?.columns ?? []), ...Object.keys(o.enums), ...o.fks.flatMap((f) => f.from)]) if (!o.columns.includes(c)) o.columns.push(c);
  o.columns.sort();
  if (!o.pk) problems.push(`${name}：清单未写主键，sources 未补`);
}
// 约束定位（P2-3）：清单第 5 节“失败定位”所列 DB-* 编号（“DB-F-05a / b / c”展开），去掉通用族（DB-N、DB-N2、DB-E、DB-K、DB-I）
const s5 = read("db/spec/checklist_s5.md");
const locators = new Set();
for (const m of s5.matchAll(/失败定位[：|]([^\n]*)|\| (DB-[A-Z]-\d+[a-z]?) \|[^\n]*\|([^|\n]*)\|\s*$/gm)) {
  const text = m[1] ?? m[3] ?? "";
  for (const g of text.matchAll(/(DB-[A-Z]-\d+)([a-z])?((?:\s*\/\s*[a-z](?![\w-]))*)|(DB-[A-Z]-[a-z][\w-]*)/g)) {
    if (g[4]) { locators.add(g[4]); continue; } // 词形编号：DB-D-gate、DB-D-audit 等
    locators.add(g[1] + (g[2] ?? ""));
    for (const x of (g[3] ?? "").matchAll(/[a-z]/g)) locators.add(g[1] + x[0]);
  }
}
for (const x of ["DB-N", "DB-N2", "DB-E", "DB-K", "DB-I"]) locators.delete(x);
const locatorsExtra = sources.locators_extra ?? {};
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

// 批准状态（E2-FIX-2 P2-4）：按出处分四类。v1.0.6 修订单为 draft，用户未批准；“工程补充”待审查确认；E2-FIX-2 为用户任务要求、具体字段与触发器为实现方案
const approvalOf = (src) => /用户裁决 E2-FIX-2-R/.test(src) ? "已批准：用户裁决（契约 v1.0.7）" : /v1\.0\.6/.test(src) ? "待批准：v1.0.6 修订单（draft，用户未批准）" : /E2-FIX-2 P2-2/.test(src) ? "用户任务要求（E2-FIX-2 P2-2），实现方案待审"
  : /工程补充/.test(src) ? "工程补充：待审查确认" : "已批准：审核清单 / 契约 v1.0 / 授权书";
for (const o of Object.values(out)) {
  o.approval = approvalOf(o.src);
  for (const e of Object.values(o.enums)) e.approval = approvalOf(e.src);
  for (const f of o.fks) f.approval = approvalOf(f.src);
}
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const spec = {
  note: "独立机读规格（E2-FIX D）。由 scripts/gen-spec.mjs 从审核清单第 4 节逐字摘录（db/spec/checklist_s4.md）与补充出处表（db/spec/sources.json）生成，不读 DDL。required 为清单“必”列；enums 只收多值 CHECK（单值等式另有专门用例），nullable 取自清单强度或补充出处；fks 为清单 FK 标记与补充。DDL 与本规格的双向比对见 test/db/spec.test.ts。",
  inputs: { checklist_s4_sha256: sha(checklistText), checklist_s5_sha256: sha(read("db/spec/checklist_s5.md")), sources_sha256: sha(read("db/spec/sources.json")) },
  tables: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...v, enums: sortObj(v.enums), fks: v.fks.sort((a, b) => a.from.join().localeCompare(b.from.join())), unique: v.unique.sort((a, b) => a.cols.join().localeCompare(b.cols.join())) }])),
  locators: { from_checklist_s5: [...locators].sort(), extra: Object.fromEntries(Object.entries(locatorsExtra).map(([k, v]) => [k, `${v.src}【${v.approval}】`])), mapped: sources.locators_mapped ?? {} },
};
const text = JSON.stringify(spec, null, 1) + "\n";
if (process.argv.includes("--check")) {
  const cur = read("db/spec.json");
  if (cur !== text) { console.error("db/spec.json 与 gen-spec 输出不一致：请运行 npm run gen:spec"); process.exit(1); }
  console.log(`check:spec 通过：${Object.keys(spec.tables).length} 表`);
} else {
  writeFileSync(new URL("db/spec.json", root), text);
  const n = (f) => Object.values(spec.tables).reduce((a, t) => a + f(t), 0);
  console.log(`写出 db/spec.json：${Object.keys(spec.tables).length} 表，必填 ${n((t) => t.required.length)}，枚举 ${n((t) => Object.keys(t.enums).length)}，外键 ${n((t) => t.fks.length)}`);
}
