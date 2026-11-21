// 审核清单 §5.13 模拟记录隔离 DB-G-01～06；E2 实施授权书第六节持久化隔离；DB-D-10、DB-D-37 静态检查的反向用例。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMemoryDb, openMemoryDb } from "../../db/connect.js";
import { loadWorld } from "../fixtures/load.js";
import { buildSimList, DECLARATION, SIM_LIST_PATH } from "../fixtures/simlist.js";
import { readRepo } from "../helpers/load.js";
import { runCase } from "./helpers.js";

const root = new URL("../../../", import.meta.url).pathname;
const T = "TEST" + "-";
/** 在临时目录中以最小副本运行隔离检查脚本（只写普通文本文件，不生成任何数据库文件） */
function runIsolationCheck(files: Record<string, string>): { ok: boolean; out: string } {
  const d = mkdtempSync(join(tmpdir(), "xs-iso-"));
  try {
    mkdirSync(join(d, "scripts"));
    copyFileSync(join(root, "scripts/check-isolation.mjs"), join(d, "scripts/check-isolation.mjs"));
    const pkg = { name: "x", private: true, devDependencies: { typescript: "*", "@types/node": "*" } };
    writeFileSync(join(d, "package.json"), JSON.stringify(pkg));
    for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), c); }
    try { return { ok: true, out: execFileSync(process.execPath, ["scripts/check-isolation.mjs"], { cwd: d, encoding: "utf8" }) }; }
    catch (e) { return { ok: false, out: String((e as { stdout?: string }).stdout ?? "") }; }
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test("持久化隔离：所有连接只有内存库（main / formal / temp 的文件路径均为空），location() 为空，PRAGMA foreign_keys = 1", () => {
  const r = runCase("G2", "E2E-BZ-1");
  const dbs = r.w.db.prepare("PRAGMA database_list").all() as { name: string; file: string }[];
  assert.deepEqual(dbs.map((x) => x.name).sort(), ["formal", "main"].concat(dbs.some((x) => x.name === "temp") ? ["temp"] : []).sort());
  for (const x of dbs) assert.equal(x.file, "", `${x.name} 无文件`);
  assert.equal(r.w.db.location(), null);
  assert.equal(r.w.db.location("formal"), null);
  assert.ok(isMemoryDb(r.w.db));
  assert.equal((r.w.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
  assert.equal((r.w.db.prepare("PRAGMA main.journal_mode").get() as { journal_mode: string }).journal_mode, "memory");
});

test("持久化隔离：仓库内无任何 .sqlite / .db / -wal / -shm 文件（测试全部运行之后再查一遍由 CI 的隔离检查承担）", () => {
  const found: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { if (["node_modules", ".git"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(sqlite|db|sqlite-wal|sqlite-shm|db-wal|db-journal)$/.test(f)) found.push(p); } };
  walk(root);
  assert.deepEqual(found, []);
});

test("DB-G-01 反向：在 db/ 或 src/ 写入一个模拟 ID，隔离检查失败并给出文件与行号", () => {
  assert.equal(runIsolationCheck({ "db/x.ts": "export const a = 1;\n" }).ok, true, "正向");
  const r = runIsolationCheck({ "db/x.ts": `export const a = "${T}SIM-X";\n` });
  assert.equal(r.ok, false); assert.match(r.out, /db\/x\.ts:1/);
  assert.equal(runIsolationCheck({ "src/y.ts": `// ${T}SIM-Y\n` }).ok, false);
});

test("DB-G-02 反向：夹具中出现 data_release = 2026.1，隔离检查失败", () => {
  assert.equal(runIsolationCheck({ "test/fixtures/w.json": JSON.stringify({ rows: [{ data_release: `${T}G0` }] }) }).ok, true);
  const r = runIsolationCheck({ "test/fixtures/w.json": JSON.stringify({ rows: [{ data_release: "2026.1" }] }) });
  assert.equal(r.ok, false); assert.match(r.out, /DB-G-02/);
});

test("DB-G-03：夹具加载函数遇 location() 返回文件路径的替身即拒绝，不执行任何写入", () => {
  const calls: string[] = [];
  const fake = {
    location: () => "/nonexistent/fake.sqlite",
    prepare: (sql: string) => { calls.push(sql); return { all: () => [{ name: "main", file: "/nonexistent/fake.sqlite" }], run: () => { calls.push(`RUN ${sql}`); }, get: () => undefined }; },
    exec: (sql: string) => { calls.push(`EXEC ${sql}`); },
  };
  assert.throws(() => loadWorld("G0", fake as never), /DB-G-03/);
  assert.ok(calls.every((c) => c.startsWith("PRAGMA database_list")), `只有只读探测：${calls.join(" | ")}`);
  // 正向：内存库
  assert.doesNotThrow(() => loadWorld("G0", openMemoryDb()));
});

test("DB-G-04：数据仓库扫描由 verify.py 承担（check_no_sim_records 与自测）；引擎侧确认 vectors/ 与 data/ 无模拟前缀", () => {
  const scan = (d: string): string[] => readdirSync(join(root, d)).flatMap((f) => { const p = join(d, f); return statSync(join(root, p)).isDirectory() ? scan(p) : [p]; });
  for (const f of [...scan("vectors"), ...scan("data")]) assert.ok(!readRepo(f).includes(`${T}SIM-`) && !new RegExp(`${T}G[0-9]`).test(readRepo(f)), f);
});

test("DB-G-05：报告“模拟项清单”与夹具生成结果逐字相同，且含声明原文", () => {
  const want = buildSimList();
  assert.ok(want.includes(DECLARATION));
  for (const s of ["S-1", "S-2", "S-3", "S-4", "S-5", "S-6", "S-8", "S-10", "S-11", "S-12", "S-13"]) assert.ok(want.includes(`| ${s} |`), `清单含 ${s}`);
  const got = readRepo(SIM_LIST_PATH);
  assert.equal(got, want, "报告清单与夹具不一致：运行 npm run gen:simlist 重新生成");
  // 反向：漏列 S-10 或缺声明原文即不相等
  assert.notEqual(want.replace(/\| S-10 \|[^\n]*\n/g, ""), got);
  assert.notEqual(want.replace(DECLARATION, ""), got);
});

test("DB-G-06：无发布包——package.json private、无打包字段；隔离检查对打包字段报错", () => {
  const pkg = JSON.parse(readRepo("package.json")) as Record<string, unknown>;
  assert.equal(pkg["private"], true);
  for (const k of ["files", "publishConfig", "bin", "main", "exports"]) assert.ok(!(k in pkg), k);
  const d = mkdtempSync(join(tmpdir(), "xs-pkg-"));
  try {
    mkdirSync(join(d, "scripts")); copyFileSync(join(root, "scripts/check-isolation.mjs"), join(d, "scripts/check-isolation.mjs"));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", private: true, files: ["test/fixtures"] }));
    assert.throws(() => execFileSync(process.execPath, ["scripts/check-isolation.mjs"], { cwd: d, encoding: "utf8" }));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("DB-D-10 / DB-D-37 反向：删除模块之外注册 xs_del_*、或包装函数之外出现事务语句，隔离检查失败", () => {
  const r1 = runIsolationCheck({ "db/other.ts": "db.function(\"xs_del_gate\", {}, () => 1);\n" });
  assert.equal(r1.ok, false); assert.match(r1.out, /DB-D-10/);
  const del = readFileSync(join(root, "db/deletion.ts"), "utf8");
  assert.equal(runIsolationCheck({ "db/deletion.ts": del }).ok, true, "正向：现行删除模块通过");
  const r2 = runIsolationCheck({ "db/deletion.ts": `${del}\nfunction x(db: any) { db.exec("COMMIT"); }\n` });
  assert.equal(r2.ok, false); assert.match(r2.out, /DB-D-37/);
});

test("禁止的数据库 API 反向：文件库、backup、扩展加载、非内存 ATTACH，隔离检查失败", () => {
  // 反向样本以拼接构造，避免本测试文件自身命中静态检查
  const J = (...x: string[]) => x.join("");
  for (const line of [
    J("new Database", "Sync(\"x.sqlite\");"), J("db.back", "up(\"x\");"), J("new Database", "Sync(\":memory:\", { allow", "Extension: true });"),
    J("db.exec(\"ATT", "ACH DATABASE 'f.db' AS f\");"), J("db.exec(\"VAC", "UUM INTO 'f.db'\");"), J("db.enableLoad", "Extension(true);"),
  ]) assert.equal(runIsolationCheck({ "db/bad.ts": `${line}\n` }).ok, false, line);
});
