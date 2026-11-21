// 审核清单 §5.9 删除授权 DB-D-01～39、§5.6 DB-R-04、§5.11 DB-X-06；§3.6 正向完整删除。
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { DeletionModule, PROTECTED_ORDER, type DeletionHooks, type HookPoint } from "../../db/deletion.js";
import { count, rejects, runCase } from "./helpers.js";

const A = "X-PROFILE-A", Bp = "X-PROFILE-B";
const OPTS = { appVersion: "0.0.0", dataRelease: "" };
/** G2 世界：档案 A、B 各有一个八字快照（共用配置 C），B 另有一个六爻快照；一条分支指向 A 的快照 */
function setup() {
  const r = runCase("G2", "E2E-BZ-1", { profileId: A, inputId: "X-IN-A" });
  const db = r.w.db;
  runCase("G2", "E2E-BZ-1", { w: r.w, profileId: Bp, inputId: "X-IN-B" });
  runCase("G2", "E2E-LY-1", { w: r.w, profileId: Bp, inputId: "X-IN-B2" });
  const snapA = (db.prepare("SELECT snapshot_id FROM calculation_snapshot WHERE owner_profile_id = ?").get(A) as { snapshot_id: string }).snapshot_id;
  const snapB = (db.prepare("SELECT snapshot_id FROM calculation_snapshot WHERE owner_profile_id = ? ORDER BY domain LIMIT 1").get(Bp) as { snapshot_id: string }).snapshot_id;
  db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR-A', 'a', NULL, ?, ?, 'OWNER', NULL)").run(r.w.releases[0]!, snapA);
  db.prepare("INSERT INTO branch (branch_id, branch_name, parent_branch_id, base_data_release, base_snapshot_id, owner, branch_note) VALUES ('X-BR-B', 'b', NULL, ?, ?, 'OWNER', NULL)").run(r.w.releases[0]!, snapB);
  const del = new DeletionModule(db);
  const opts = { ...OPTS, dataRelease: r.w.releases.at(-1)! };
  const cfg = r.cfg;
  return { db, del, opts, snapA, snapB, cfg, w: r.w };
}
const marker = (db: DatabaseSync) => db.prepare("SELECT txn_token, audit_id, grant_seq, kind FROM deletion_txn_marker WHERE id = 1").get() as { txn_token: string; audit_id: string; grant_seq: number; kind: string } | undefined;
const profileRows = (db: DatabaseSync, p: string) => Object.fromEntries(["profile", ...PROTECTED_ORDER].map((t) => [t, (db.prepare(`SELECT count(*) AS n FROM ${t} WHERE owner_profile_id = ?`).get(p) as { n: number }).n]));
function formalHash(db: DatabaseSync): string {
  const h = createHash("sha256");
  for (const { name } of db.prepare("SELECT name FROM formal.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    h.update(name).update(JSON.stringify((db.prepare(`SELECT * FROM formal."${name}"`).all() as unknown[]).map((r) => JSON.stringify(r)).sort()));
  return h.digest("hex");
}
const delSnapRow = (db: DatabaseSync, p: string) => db.exec(`DELETE FROM calculation_snapshot WHERE owner_profile_id = '${p}'`);
/** 钩子：在指定时点执行 fn（一次） */
const at = (point: HookPoint, fn: (db: DatabaseSync, info?: string) => void, onTable?: string): DeletionHooks => {
  let done = false;
  return { at: (p, db, info) => { if (!done && p === point && (!onTable || info === onTable)) { done = true; fn(db, info); } } };
};

test("正向：完整删除档案 A——级联 0 行、B 不变、G/W 从不同时 armed、结束后撤销且 U20 为空、正式库不变（DB-X-06）、计数一致（DB-D-21）", () => {
  const { db, del, opts } = setup();
  const before = profileRows(db, A), bBefore = profileRows(db, Bp), fBefore = formalHash(db);
  const states: { G: boolean; W: boolean }[] = [];
  const hooks: DeletionHooks = { at: () => { const s = del.state(); states.push(s); assert.ok(!(s.G && s.W), "G 与 W 不同时 armed"); } };
  const r = del.deleteProfile(A, { ...opts, hooks });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(states.some((s) => s.G) && states.some((s) => s.W));
  assert.deepEqual(Object.values(profileRows(db, A)), Object.values(profileRows(db, A)).map(() => 0), "级联范围 0 行");
  assert.deepEqual(profileRows(db, Bp), bBefore, "档案 B 不变");
  assert.deepEqual(del.state(), { G: false, W: false, inTransaction: false });
  assert.equal(marker(db), undefined, "U20 为空");
  assert.equal(formalHash(db), fBefore, "DB-X-06 正式库逐表内容哈希不变");
  // DB-D-21：计数表等于删除前后实际差值（Q-D-21）
  if (r.ok) {
    const cnt = Object.fromEntries((db.prepare("SELECT object_type, count FROM deletion_audit_count WHERE audit_id = ?").all(r.auditId) as { object_type: string; count: number }[]).map((x) => [x.object_type, x.count]));
    for (const [t, n] of Object.entries(before)) assert.equal(cnt[t], n, `Q-D-21 ${t}`);
    assert.equal(cnt["branch_base_snapshot_cleared"], 1);
    // 审计只含允许字段（§10.4）
    const a = db.prepare("SELECT * FROM deletion_audit WHERE audit_id = ?").get(r.auditId) as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), ["app_version", "audit_id", "data_release", "deleted_at", "success", "trigger"]);
    // DB-D-24：每个被置空分支恰一条 branch_event；逐列不含快照 ID、档案 ID
    const ev = db.prepare("SELECT * FROM branch_event").all() as Record<string, unknown>[];
    assert.equal(ev.length, 1);
    for (const v of Object.values(ev[0]!)) assert.ok(!String(v).includes(A) && !String(v).includes("X-IN-A"));
    assert.equal((db.prepare("SELECT base_snapshot_id FROM branch WHERE branch_id = 'X-BR-A'").get() as { base_snapshot_id: string | null }).base_snapshot_id, null);
  }
});

test("DB-D-01 / DB-D-02 / DB-D-22：未授权、TEMP 表伪造、自动提交下 DELETE 均被闸门拒", () => {
  const { db } = setup();
  rejects(() => delSnapRow(db, A), "DB-D-gate");
  db.exec("CREATE TEMP TABLE deleting_profile (id TEXT)"); db.exec(`INSERT INTO deleting_profile VALUES ('${A}')`);
  rejects(() => delSnapRow(db, A), "DB-D-gate");
  assert.equal(db.isTransaction, false);
  rejects(() => db.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${A}'`), "DB-D-gate");
});

test("DB-D-03：授权档案 A，删档案 B 的行被拒", () => {
  const { db, del, opts } = setup();
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => rejects(() => d.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${Bp}'`), "DB-D-gate")) });
  assert.ok(r.ok);
});

test("DB-D-04 / DB-D-05：已授权但无本次成功审计、或 U20 audit_id 与审计不符，报 DB-D-audit", () => {
  // 边界（E2-FIX E）：本用例只检验触发器第二道条件 DB-D-audit 本身——用测试替身让闸门放行，再看审计缺失 / 不符是否被拒。
  // 它不检验真实授权流程，也不构成端到端安全证明；真实流程的“成功审计 ↔ U20 绑定 ↔ 删除”一致性见 E-1、E-2（不用替身）。
  // 以注入方式构造：G armed 时把 U20 换成“审计不存在”的 audit_id 会被闸门条件 d 先拒（DB-D-27），故真实流程到不了这第二道条件。
  const { db } = setup();
  // DB-D-10 测试替身：只在本连接、本测试中以同名同参数个数函数替换闸门，证明库层审计条件独立于闸门（契约 §1.2：进程内代码可替换函数，只能防错、发现篡改）
  db.function("xs_del_gate", { deterministic: false }, (_p, _t, _a, _s) => 1);
  db.exec("BEGIN");
  db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, 't', 'X-NO-AUDIT', 1, 'success')").run();
  rejects(() => db.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${A}'`), "DB-D-audit", "DB-D-04");
  db.exec("ROLLBACK");
  // DB-D-05：存在成功审计 X-AUD，但 U20 的 audit_id 指向另一个
  db.function("xs_audit_write", { deterministic: false }, (_t, _a, _s, _k) => 1); // DB-D-10 测试替身
  db.exec("BEGIN");
  db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, 't', 'X-AUD', 1, 'success')").run();
  db.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES ('X-AUD', 't', '用户操作', '0', 'r', 1)").run();
  db.exec("DELETE FROM deletion_txn_marker");
  db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, 't', 'X-OTHER', 1, 'success')").run();
  rejects(() => db.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${A}'`), "DB-D-audit", "DB-D-05");
  db.exec("ROLLBACK");
});

test("DB-D-06 / DB-D-29：一次删除提交后复用同一连接再删被拒（授权已撤销、U20 为空）", () => {
  const { db, del, opts } = setup();
  assert.ok(del.deleteProfile(A, opts).ok);
  rejects(() => delSnapRow(db, Bp), "DB-D-gate");
  db.exec("BEGIN");
  rejects(() => delSnapRow(db, Bp), "DB-D-gate");
  db.exec("ROLLBACK");
});

test("DB-D-07 / DB-D-11 / DB-D-13：共用配置——删 A 保留 C；B 仍引用时回收被拒；删 B 后 C 被回收（Q-D-07）", () => {
  const { db, del, opts, cfg } = setup();
  const cfgCount = () => (db.prepare("SELECT count(*) AS n FROM calculation_config WHERE config_id = ?").get(cfg.config_id) as { n: number }).n;
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => {
    rejects(() => d.prepare("DELETE FROM calculation_config WHERE config_id = ?").run(cfg.config_id), "DB-D-gc", "DB-D-11/13 仍被引用");
  }) });
  assert.ok(r.ok);
  assert.equal(cfgCount(), 1, "C 保留");
  assert.equal((db.prepare("SELECT count(*) AS n FROM profile_config_ref WHERE owner_profile_id = ?").get(A) as { n: number }).n, 0, "A 的引用删除");
  assert.ok(del.deleteProfile(Bp, opts).ok);
  assert.equal(cfgCount(), 0, "删 B 后 C 被回收");
});

test("DB-D-08 / DB-D-20 / DB-D-30 / DB-R-04：级联中途注入失败——全部回滚、另写失败审计、授权撤销、档案完整、随后 DELETE 被拒（Q-D-20、Q-D-30）", () => {
  for (const t of ["snapshot_dependency", "calculation_snapshot", "calculation_input"]) {
    const { db, del, opts } = setup();
    const before = profileRows(db, A), auditsBefore = count(db, "deletion_audit");
    const r = del.deleteProfile(A, { ...opts, hooks: at("cascade", () => { throw new Error("注入失败"); }, t) });
    assert.equal(r.ok, false);
    assert.deepEqual(profileRows(db, A), before, `第 ${t} 表注入：被删档案数据完整`);
    const audits = db.prepare("SELECT audit_id, success FROM deletion_audit").all() as { audit_id: string; success: number }[];
    assert.equal(audits.length, auditsBefore + 1, "只多一条审计");
    assert.equal(audits.at(-1)!.success, 0, "失败审计 success = 0，成功审计不存在");
    if (!r.ok) assert.equal(r.failureAuditId, audits.at(-1)!.audit_id);
    assert.equal(count(db, "deletion_audit_count"), 0, "失败审计无计数行");
    assert.deepEqual(del.state(), { G: false, W: false, inTransaction: false });
    assert.equal(marker(db), undefined);
    rejects(() => delSnapRow(db, A), "DB-D-gate");
  }
});

test("DB-D-09：连接未注册 xs_del_gate 时 DELETE 报 no such function", async () => {
  const { openMemoryDb } = await import("../../db/connect.js");
  const db = openMemoryDb();
  rejects(() => db.exec("DELETE FROM calculation_snapshot"), "no such function: xs_del_gate");
});

test("DB-D-12：未授权事务外直接 DELETE 无引用配置被拒", () => {
  const { db, del, opts, cfg } = setup();
  assert.ok(del.deleteProfile(A, opts).ok);
  rejects(() => db.prepare("DELETE FROM config_param_value WHERE config_id = ?").run(cfg.config_id), "DB-D-gc");
  rejects(() => db.prepare("DELETE FROM calculation_config WHERE config_id = ?").run(cfg.config_id), "DB-D-gc");
});

test("DB-D-14 / DB-D-15 / DB-D-16 / DB-D-17：Branch 引用只在入口内、只许置空本档案快照的引用", () => {
  const { db, del, opts } = setup();
  rejects(() => db.exec("UPDATE branch SET base_snapshot_id = NULL WHERE branch_id = 'X-BR-A'"), "DB-D-branch", "DB-D-14");
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => {
    rejects(() => d.exec("UPDATE branch SET base_snapshot_id = NULL, branch_name = 'z' WHERE branch_id = 'X-BR-A'"), "DB-D-branch", "DB-D-15");
    rejects(() => d.exec("UPDATE branch SET base_snapshot_id = NULL WHERE branch_id = 'X-BR-B'"), "DB-D-branch", "DB-D-16");
    rejects(() => d.exec(`DELETE FROM calculation_snapshot WHERE owner_profile_id = '${A}'`), "FOREIGN KEY constraint failed", "DB-D-17 未置空就删快照");
  }) });
  assert.ok(r.ok, "注入的违规语句均被拒，入口本身完成");
});

test("DB-D-18 / DB-D-19 / DB-D-32 / DB-D-33：审计永不可改删；入口之外、G 窗口内写审计均被拒；失败审计不得有计数行", () => {
  const { db, del, opts } = setup();
  rejects(() => db.exec("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES ('X', 't', '用户操作', '0', 'r', 1)"), "DB-D-audit-writer", "DB-D-19");
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => {
    const m = marker(d)!;
    rejects(() => d.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES (?, 't', '用户操作', '0', 'r', 1)").run(m.audit_id), "DB-D-audit", "DB-D-32");
    rejects(() => d.exec("UPDATE deletion_audit SET app_version = 'x'"), "DB-D-audit-immutable", "DB-D-18");
    rejects(() => d.exec("DELETE FROM deletion_audit_count"), "DB-D-audit-immutable", "DB-D-18");
  }) });
  assert.ok(r.ok);
  // DB-D-33：失败审计后插入计数行
  const f = del.deleteProfile(A, opts); // A 已删：仍按流程写成功审计（计数为 0），不失败
  assert.ok(f.ok);
  const { db: db2, del: del2, opts: o2 } = setup();
  const g = del2.deleteProfile(A, { ...o2, hooks: at("cascade", () => { throw new Error("x"); }) });
  assert.ok(!g.ok && g.failureAuditId);
  if (!g.ok) rejects(() => db2.prepare("INSERT INTO deletion_audit_count (audit_id, object_type, count) VALUES (?, 'profile', 0)").run(g.failureAuditId!), "DB-D-audit-count");
});

test("DB-D-23 / DB-D-35：另一事务进行中、或 U20 有残留时入口拒绝开始，无任何写入", () => {
  const { db, del, opts } = setup();
  const n = count(db, "deletion_audit");
  db.exec("BEGIN");
  const r1 = del.deleteProfile(A, opts);
  assert.ok(!r1.ok && r1.failureAuditId === null);
  db.exec("ROLLBACK");
  db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, 't', 'a', 1, 'success')").run();
  const r2 = del.deleteProfile(A, opts);
  assert.ok(!r2.ok && r2.failureAuditId === null);
  assert.equal(count(db, "deletion_audit"), n);
});

test("DB-D-24：branch_event 在删除事务之外插入被拒", () => {
  const { db, w } = setup();
  db.prepare("INSERT INTO deletion_audit_count (audit_id, object_type, count) SELECT 'x', 'profile', 0 WHERE 0").run();
  rejects(() => db.prepare("INSERT INTO branch_event (event_id, branch_id, kind, occurred_at, audit_id) VALUES ('X-E', 'X-BR-A', 'base_snapshot_cleared', 't', 'a')").run(), /DB-D-branch-event|FOREIGN KEY/);
  void w;
});

test("DB-D-25 / DB-D-27 / DB-D-28：G 已授权而 U20 的 token、audit_id、grant_seq 被换，DELETE 被闸门拒（条件 c、d、e）", () => {
  for (const field of ["txn_token", "audit_id", "grant_seq"] as const) {
    const { db, del, opts } = setup();
    const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => {
      const m = marker(d)!;
      const swapped = { ...m, [field]: field === "grant_seq" ? m.grant_seq - 1 : `${String(m[field])}-x` };
      d.exec("DELETE FROM deletion_txn_marker");
      d.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, ?, ?, ?, ?)").run(swapped.txn_token, swapped.audit_id, swapped.grant_seq, swapped.kind);
      rejects(() => d.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${A}'`), "DB-D-gate", field);
      d.exec("DELETE FROM deletion_txn_marker");
      d.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, ?, ?, ?, ?)").run(m.txn_token, m.audit_id, m.grant_seq, m.kind);
    }) });
    assert.ok(r.ok, "恢复真实标记后流程完成");
  }
});

test("DB-D-26：闭包未授权时自写 U20 后 DELETE、插审计皆拒", () => {
  const { db } = setup();
  db.exec("BEGIN");
  db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, 'forged', 'X-A', 1, 'success')").run();
  rejects(() => delSnapRow(db, A), "DB-D-gate");
  rejects(() => db.exec("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES ('X-A', 't', '用户操作', '0', 'r', 1)"), "DB-D-audit-writer");
  db.exec("ROLLBACK");
});

test("DB-D-31 / DB-D-34：W 窗口内 DELETE 受保护行被拒（互斥）；W armed 而 audit_id ≠ U20 被拒", () => {
  const { db, del, opts } = setup();
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_w", (d) => {
    assert.deepEqual(del.state(), { G: false, W: true, inTransaction: true });
    rejects(() => d.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${A}'`), "DB-D-gate", "DB-D-31");
    rejects(() => d.exec("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES ('X-OTHER', 't', '用户操作', '0', 'r', 1)"), "DB-D-audit-writer", "DB-D-34");
  }) });
  assert.ok(r.ok);
  void db;
});

test("DB-D-36：U20 kind = success 时插 success = 0 审计被拒；失败审计 ID 与回滚掉的成功审计 ID 不同（Q-D-36）", () => {
  const { db, del, opts } = setup();
  let rolledBack = "";
  const r = del.deleteProfile(A, { ...opts, hooks: { at: (p, d) => {
    if (p === "in_w") {
      const m = marker(d)!; rolledBack = m.audit_id;
      rejects(() => d.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES (?, 't', '用户操作', '0', 'r', 0)").run(m.audit_id), "DB-D-audit-writer");
    }
    if (p === "cascade") throw new Error("x");
  } } });
  assert.ok(!r.ok && r.failureAuditId && r.failureAuditId !== rolledBack);
  void db;
});

test("DB-D-38：G 已授权而 xs_del_gc 收到的 token 与闭包不符，返回 0（回收被拒）", () => {
  const { db, del, opts } = setup();
  const r = del.deleteProfile(A, { ...opts, hooks: at("in_g", (d) => {
    const m = marker(d)!;
    assert.equal((d.prepare("SELECT xs_del_gc(?, ?, ?) AS v").get(`${m.txn_token}-x`, m.audit_id, m.grant_seq) as { v: number }).v, 0);
    assert.equal((d.prepare("SELECT xs_del_gc(?, ?, ?) AS v").get(m.txn_token, m.audit_id, m.grant_seq) as { v: number }).v, 1, "对照：真实值在 G 窗口内为 1");
  }) });
  assert.ok(r.ok);
  void db;
});

test("DB-D-39：在 G、W 均未 armed 的三个时点读取真实 U20 值伪造调用——函数返回 0，②～⑤ 全部被拒，最终结果与不暂停相同", () => {
  const ref = setup();
  assert.ok(ref.del.deleteProfile(A, ref.opts).ok);
  const refRows = profileRows(ref.db, Bp);
  const { db, del, opts, cfg } = setup();
  const points: HookPoint[] = ["after_begin", "between_w_and_g", "after_revoke_g"];
  const seen: string[] = [];
  const hooks: DeletionHooks = { at: (p, d) => {
    if (!points.includes(p)) return;
    seen.push(p);
    assert.deepEqual([del.state().G, del.state().W], [false, false], p);
    const m = marker(d)!;
    const one = (sql: string, ...a: (string | number)[]) => (d.prepare(sql).get(...a) as { v: number }).v;
    assert.equal(one("SELECT xs_del_gate(?, ?, ?, ?) AS v", A, m.txn_token, m.audit_id, m.grant_seq), 0, `${p} ① xs_del_gate`);
    assert.equal(one("SELECT xs_del_gc(?, ?, ?) AS v", m.txn_token, m.audit_id, m.grant_seq), 0, `${p} ① xs_del_gc`);
    assert.equal(one("SELECT xs_audit_write(?, ?, ?, 'success') AS v", m.txn_token, m.audit_id, m.grant_seq), 0, `${p} ① xs_audit_write`);
    rejects(() => d.exec(`DELETE FROM execution_trace_step WHERE owner_profile_id = '${Bp}'`), "DB-D-gate", `${p} ②`);
    rejects(() => d.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES (?, 't', '用户操作', '0', 'r', 1)").run(`${m.audit_id}-f`), "DB-D-audit-writer", `${p} ③`);
    rejects(() => d.prepare("INSERT INTO deletion_audit_count (audit_id, object_type, count) VALUES (?, 'profile', 1)").run(m.audit_id), /DB-D-audit-(writer|count)/, `${p} ③ 计数`);
    rejects(() => d.prepare("INSERT INTO branch_event (event_id, branch_id, kind, occurred_at, audit_id) VALUES ('X-EV', 'X-BR-B', 'base_snapshot_cleared', 't', ?)").run(m.audit_id), "DB-D-branch-event", `${p} ④`);
    rejects(() => d.prepare("DELETE FROM config_param_value WHERE config_id = ?").run(cfg.config_id), "DB-D-gc", `${p} ⑤`);
  } };
  const r = del.deleteProfile(A, { ...opts, hooks });
  assert.deepEqual(seen, points);
  assert.ok(r.ok, "暂停结束后流程继续完成");
  assert.deepEqual(profileRows(db, Bp), refRows, "最终结果与不暂停时相同");
  assert.deepEqual(Object.values(profileRows(db, A)).every((n) => n === 0), true);
});

// ---------------------------------------------------------------- E2-FIX E：真实授权流程的一致性（不使用任何测试替身）
// DB-D-04 / DB-D-05 用测试替身单独检验触发器第二道条件（见该用例注释）；以下用例只走 DeletionModule 真实流程，
// 检验“成功审计 ↔ U20 绑定 ↔ 实际删除”三者在同一事务内一致。它们证明工程实现的一致性，不是端到端安全证明（§1.2：进程内代码可替换函数）。
test("E-1：真实流程——成功审计、U20 标记、branch_event 与实际删除在同一事务内绑定同一 audit_id；提交后 U20 清空、审计留存", () => {
  const { db, del, opts } = setup();
  const seen: Record<string, { marker: ReturnType<typeof marker>; audits: { audit_id: string; success: number }[]; snapRows: number }> = {};
  const snap = (p: HookPoint) => (d: DatabaseSync) => {
    seen[p] = { marker: marker(d), audits: d.prepare("SELECT audit_id, success FROM deletion_audit ORDER BY audit_id").all() as { audit_id: string; success: number }[],
      snapRows: (d.prepare("SELECT count(*) AS n FROM calculation_snapshot WHERE owner_profile_id = ?").get(A) as { n: number }).n };
  };
  const hooks: DeletionHooks = { at: (p, d, info) => { if (p === "in_w" || p === "in_g" || p === "before_commit" || (p === "cascade" && info === "calculation_snapshot")) snap(p)(d); } };
  const r = del.deleteProfile(A, { ...opts, hooks });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  // W 窗口：U20 已绑定本次 audit_id，成功审计尚未写入
  assert.equal(seen["in_w"]!.marker?.audit_id, r.auditId);
  assert.equal(seen["in_w"]!.marker?.kind, "success");
  assert.ok(!seen["in_w"]!.audits.some((a) => a.audit_id === r.auditId), "W 窗口内成功审计尚未写入");
  // G 窗口与级联、提交前：U20 与成功审计指向同一 audit_id，成功标记为 1
  for (const p of ["in_g", "cascade", "before_commit"]) {
    assert.equal(seen[p]!.marker?.audit_id, r.auditId, `${p}：U20.audit_id = 本次审计`);
    assert.equal(seen[p]!.marker?.kind, "success");
    assert.deepEqual(seen[p]!.audits.filter((a) => a.audit_id === r.auditId).map((a) => [a.audit_id, a.success]), [[r.auditId, 1]], `${p}：本次成功审计存在且唯一`);
  }
  assert.ok(seen["cascade"]!.snapRows > 0 && seen["before_commit"]!.snapRows === 0, "级联在审计绑定之后执行");
  // 提交后：U20 清空；审计、计数、branch_event 指向同一 audit_id；档案行已删
  assert.equal(marker(db), undefined);
  assert.equal((db.prepare("SELECT count(*) AS n FROM deletion_audit WHERE audit_id = ? AND success = 1").get(r.auditId) as { n: number }).n, 1);
  assert.ok((db.prepare("SELECT count(*) AS n FROM deletion_audit_count WHERE audit_id = ?").get(r.auditId) as { n: number }).n > 0);
  assert.deepEqual((db.prepare("SELECT DISTINCT audit_id FROM branch_event").all() as { audit_id: string }[]).map((x) => x.audit_id), [r.auditId]);
  assert.ok(Object.values(profileRows(db, A)).every((n) => n === 0));
});

test("E-2：真实流程——第二次删除不能沿用第一次的审计：U20 绑定新 audit_id；把 U20 改回旧审计 ID 后 DELETE 被真实闸门拒，整次删除回滚", () => {
  const { db, del, opts } = setup();
  const r1 = del.deleteProfile(A, opts);
  assert.ok(r1.ok);
  if (!r1.ok) return;
  let swapped = "";
  const r2 = del.deleteProfile(Bp, { ...opts, hooks: at("in_g", (d) => {
    const m = marker(d)!;
    assert.notEqual(m.audit_id, r1.auditId, "U20 绑定本次新审计");
    d.exec("DELETE FROM deletion_txn_marker");
    d.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, ?, ?, ?, 'success')").run(m.txn_token, r1.auditId, m.grant_seq);
    swapped = r1.auditId;
  }) });
  assert.equal(swapped, r1.auditId);
  assert.equal(r2.ok, false, "沿用旧审计的删除失败");
  assert.match(r2.ok ? "" : r2.error, /DB-D-/);
  assert.ok(Object.values(profileRows(db, Bp)).some((n) => n > 0), "档案 B 完整（整次回滚）");
  assert.equal(marker(db), undefined);
  // 只留：第一次成功审计 + 第二次失败审计；第二次的成功审计随回滚消失
  const audits = db.prepare("SELECT audit_id, success FROM deletion_audit ORDER BY success DESC").all() as { audit_id: string; success: number }[];
  assert.deepEqual(audits.map((a) => a.success), [1, 0]);
  assert.equal(audits[0]!.audit_id, r1.auditId);
  assert.equal(audits[1]!.audit_id, r2.ok ? "" : r2.failureAuditId);
});

test("E-3：真实流程——连接上的 xs_del_gate / xs_audit_write 为删除模块注册的真实实现（非替身），本文件只有 DB-D-04/05 一处使用替身", () => {
  const src = readFileSync(new URL("../../../test/db/deletion.test.ts", import.meta.url), "utf8");
  const doubles = src.split("\n").filter((l) => /db\.function\("xs_(del_gate|audit_write)"/.test(l));
  assert.equal(doubles.length, 2, "只在 DB-D-04/05 中替换两次");
  assert.ok(doubles.every((l) => src.indexOf(l) > src.indexOf('test("DB-D-04 / DB-D-05') && src.indexOf(l) < src.indexOf('test("DB-D-06')), "替身只出现在 DB-D-04/05 用例内");
});
