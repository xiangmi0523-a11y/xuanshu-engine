// 删除个人资料入口 —— 审核清单 §3.6（连接级控制）；契约 §10.2～§10.4。
// 要点：
// - 授权只依赖本模块 JS 闭包中的删除授权 G / 审计写入授权 W（armed）、连接处于事务中、以及触发器传入的全部参数与闭包逐项一致。
// - U20 deletion_txn_marker 中的 txn_token、audit_id、grant_seq 对 SQL 调用者可见，不是凭证；只用于把触发器调用绑定到本次事务（终审 R1）。
// - G 与 W 互斥；事务只经 begin() / commit() / rollback() 三个包装函数开启与结束；整个入口为一次同步调用，finally 无条件撤销授权。
// - 本模块是唯一注册 xs_del_gate、xs_del_gc、xs_audit_write 的地方（CI 静态检查）。
// 限度：本进程内的代码仍可注册同名函数或删除触发器（契约 §1.2、ENG.1：只能防程序错误、发现篡改，不能阻止篡改）。
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "./ids.js";

export type HookPoint = "after_begin" | "in_w" | "between_w_and_g" | "in_g" | "cascade" | "before_commit" | "after_revoke_g";
/** 测试钩子：只在测试中传入（CI 检查非测试代码不得传入 hooks）。cascade 时 info 为即将删除的表名。 */
export interface DeletionHooks { at?: (point: HookPoint, db: DatabaseSync, info?: string) => void }

export interface DeleteOptions { appVersion: string; dataRelease: string; hooks?: DeletionHooks }
export type DeleteResult =
  | { ok: true; auditId: string; counts: Record<string, number> }
  | { ok: false; error: string; failureAuditId: string | null };

interface Grant { armed: boolean; profileId: string | null; grantSeq: number; auditId: string | null; txnToken: string | null }
interface WriteGrant { armed: boolean; kind: "success" | "failure" | null; grantSeq: number; auditId: string | null; txnToken: string | null }

export const PROTECTED_ORDER = [ // 子到父（§10.2 级联范围）
  "execution_trace_step", "snapshot_resolved_context", "snapshot_gov_sequence", "snapshot_gov_blocker", "snapshot_gov_approval",
  "snapshot_dependency", "snapshot_degradation_reason", "snapshot_non_formal_reason", "calculation_snapshot",
  "profile_config_ref", "input_tz_resolution", "calculation_input",
] as const;

export class DeletionModule {
  private G: Grant = { armed: false, profileId: null, grantSeq: 0, auditId: null, txnToken: null };
  private W: WriteGrant = { armed: false, kind: null, grantSeq: 0, auditId: null, txnToken: null };
  private txnToken: string | null = null;
  private seq = 0;

  constructor(private readonly db: DatabaseSync) {
    const self = this;
    const txnOk = (token: unknown, audit: unknown, seq: unknown, g: { txnToken: string | null; auditId: string | null; grantSeq: number }) =>
      self.db.isTransaction && typeof token === "string" && token === g.txnToken && token === self.txnToken
      && typeof audit === "string" && audit === g.auditId && typeof seq === "number" && seq === g.grantSeq;
    db.function("xs_del_gate", { deterministic: false, directOnly: false }, (profileId, token, audit, seq) => {
      try { return self.G.armed && !self.W.armed && txnOk(token, audit, seq, self.G) && typeof profileId === "string" && profileId === self.G.profileId ? 1 : 0; }
      catch { return 0; }
    });
    db.function("xs_del_gc", { deterministic: false, directOnly: false }, (token, audit, seq) => {
      try { return self.G.armed && !self.W.armed && txnOk(token, audit, seq, self.G) ? 1 : 0; }
      catch { return 0; }
    });
    db.function("xs_audit_write", { deterministic: false, directOnly: false }, (token, audit, seq, kind) => {
      try { return self.W.armed && !self.G.armed && txnOk(token, audit, seq, self.W) && kind === self.W.kind ? 1 : 0; }
      catch { return 0; }
    });
  }

  /** 只读状态（测试断言 G、W 从不同时 armed；不含任何可用作凭证的值） */
  state(): { G: boolean; W: boolean; inTransaction: boolean } { return { G: this.G.armed, W: this.W.armed, inTransaction: this.db.isTransaction }; }

  private revokeAll(): void {
    this.G = { armed: false, profileId: null, grantSeq: 0, auditId: null, txnToken: null };
    this.W = { armed: false, kind: null, grantSeq: 0, auditId: null, txnToken: null };
  }
  private assertExclusive(): void { if (this.G.armed && this.W.armed) throw new Error("G 与 W 不得同时 armed"); }

  // <tx-wrappers>  删除模块中开启与结束事务的语句只允许出现在这三个包装函数内（DB-D-37）
  private begin(auditId: string, grantSeq: number, kind: "success" | "failure"): string {
    if (this.db.isTransaction) throw new Error("连接已在事务中，拒绝开始删除");
    this.db.exec("BEGIN IMMEDIATE");
    const token = randomBytes(16).toString("hex");
    this.txnToken = token;
    this.db.prepare("INSERT INTO deletion_txn_marker (id, txn_token, audit_id, grant_seq, kind) VALUES (1, ?, ?, ?, ?)").run(token, auditId, grantSeq, kind);
    return token;
  }
  private commit(hooks?: DeletionHooks): void {
    this.revokeAll();
    hooks?.at?.("after_revoke_g", this.db);
    this.db.exec("DELETE FROM deletion_txn_marker");
    this.db.exec("COMMIT");
    this.txnToken = null;
  }
  private rollback(): void {
    this.revokeAll();
    if (this.db.isTransaction) this.db.exec("ROLLBACK");
    this.txnToken = null;
  }
  // </tx-wrappers>

  private markerEmpty(): boolean {
    return (this.db.prepare("SELECT count(*) AS n FROM deletion_txn_marker").get() as { n: number }).n === 0;
  }

  /** 删除前统计各对象类型条数（写入成功审计的计数行） */
  countsFor(profileId: string): Record<string, number> {
    const one = (sql: string, ...a: string[]) => (this.db.prepare(sql).get(...a) as { n: number }).n;
    const counts: Record<string, number> = { profile: one("SELECT count(*) AS n FROM profile WHERE owner_profile_id = ?", profileId) };
    for (const t of PROTECTED_ORDER) counts[t] = one(`SELECT count(*) AS n FROM ${t} WHERE owner_profile_id = ?`, profileId);
    const gc = this.gcCandidates(profileId);
    counts["calculation_config"] = gc.length;
    counts["config_param_value"] = gc.reduce((s, c) => s + one("SELECT count(*) AS n FROM config_param_value WHERE config_id = ? AND config_version = ?", c.config_id, String(c.config_version)), 0);
    counts["branch_base_snapshot_cleared"] = one(
      "SELECT count(*) AS n FROM branch WHERE base_snapshot_id IN (SELECT snapshot_id FROM calculation_snapshot WHERE owner_profile_id = ?)", profileId);
    return counts;
  }
  /** 删除该档案后将无人引用的配置（只回收这些；仍被其他档案或其快照引用者保留） */
  gcCandidates(profileId: string): { config_id: string; config_version: number }[] {
    return this.db.prepare(`
      SELECT DISTINCT r.config_id, r.config_version FROM profile_config_ref r
      WHERE r.owner_profile_id = ?
        AND NOT EXISTS (SELECT 1 FROM profile_config_ref o WHERE o.config_id = r.config_id AND o.config_version = r.config_version AND o.owner_profile_id <> r.owner_profile_id)
        AND NOT EXISTS (SELECT 1 FROM calculation_snapshot s WHERE s.config_id = r.config_id AND s.config_version = r.config_version AND s.owner_profile_id <> r.owner_profile_id)
      ORDER BY r.config_id, r.config_version`).all(profileId) as { config_id: string; config_version: number }[];
  }

  /** 删除个人资料（§10.2 唯一的 DELETE 路径）。同步执行；返回成功或失败（失败另写失败审计）。 */
  deleteProfile(profileId: string, opts: DeleteOptions): DeleteResult {
    const hooks = opts.hooks;
    if (this.db.isTransaction) return { ok: false, error: "连接已在事务中，拒绝开始删除（DB-D-23）", failureAuditId: null };
    if (!this.markerEmpty()) return { ok: false, error: "残留事务标记，拒绝开始删除（DB-D-35）", failureAuditId: null };
    const grantSeq = ++this.seq;
    const auditId = uuidv7();
    let counts: Record<string, number> = {};
    try {
      // (4) 第 1 步
      const token = this.begin(auditId, grantSeq, "success");
      hooks?.at?.("after_begin", this.db);
      // (4) 第 2 步：审计写入授权 W → 成功审计与计数 → 立即撤销 W
      counts = this.countsFor(profileId);
      this.W = { armed: true, kind: "success", grantSeq, auditId, txnToken: token }; this.assertExclusive();
      hooks?.at?.("in_w", this.db);
      this.db.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES (?, ?, '用户操作', ?, ?, 1)")
        .run(auditId, new Date().toISOString(), opts.appVersion, opts.dataRelease);
      const ins = this.db.prepare("INSERT INTO deletion_audit_count (audit_id, object_type, count) VALUES (?, ?, ?)");
      for (const [k, v] of Object.entries(counts)) ins.run(auditId, k, v);
      this.W = { armed: false, kind: null, grantSeq: 0, auditId: null, txnToken: null };
      hooks?.at?.("between_w_and_g", this.db);
      // (4) 第 3 步：删除授权 G
      this.G = { armed: true, profileId, grantSeq, auditId, txnToken: token }; this.assertExclusive();
      hooks?.at?.("in_g", this.db);
      // (4) 第 4 步：置空 Branch 引用 + branch_event
      const branches = this.db.prepare(
        "SELECT branch_id FROM branch WHERE base_snapshot_id IN (SELECT snapshot_id FROM calculation_snapshot WHERE owner_profile_id = ?) ORDER BY branch_id").all(profileId) as { branch_id: string }[];
      for (const b of branches) {
        this.db.prepare("UPDATE branch SET base_snapshot_id = NULL WHERE branch_id = ?").run(b.branch_id);
        this.db.prepare("INSERT INTO branch_event (event_id, branch_id, kind, occurred_at, audit_id) VALUES (?, ?, 'base_snapshot_cleared', ?, ?)")
          .run(uuidv7(), b.branch_id, new Date().toISOString(), auditId);
      }
      // (4) 第 5 步：子到父删除级联范围
      const gc = this.gcCandidates(profileId);
      for (const t of PROTECTED_ORDER) {
        hooks?.at?.("cascade", this.db, t);
        this.db.prepare(`DELETE FROM ${t} WHERE owner_profile_id = ?`).run(profileId);
      }
      // (4) 第 6 步：回收无主配置
      for (const c of gc) {
        this.db.prepare("DELETE FROM config_param_value WHERE config_id = ? AND config_version = ?").run(c.config_id, c.config_version);
        this.db.prepare("DELETE FROM calculation_config WHERE config_id = ? AND config_version = ?").run(c.config_id, c.config_version);
      }
      this.db.prepare("DELETE FROM profile WHERE owner_profile_id = ?").run(profileId);
      hooks?.at?.("before_commit", this.db);
      // (4) 第 7 步
      this.commit(hooks);
      if (!this.markerEmpty()) throw new Error("提交后事务标记未清空");
      return { ok: true, auditId, counts };
    } catch (e) {
      // (5) 失败流程
      this.rollback();
      const failureAuditId = this.writeFailureAudit(grantSeq, opts);
      return { ok: false, error: (e as Error).message, failureAuditId };
    } finally {
      this.revokeAll();
      if (this.db.isTransaction) this.rollback();
      this.txnToken = null;
    }
  }

  private writeFailureAudit(grantSeq: number, opts: DeleteOptions): string | null {
    const auditId = uuidv7();
    try {
      const token = this.begin(auditId, grantSeq, "failure");
      this.W = { armed: true, kind: "failure", grantSeq, auditId, txnToken: token }; this.assertExclusive();
      this.db.prepare("INSERT INTO deletion_audit (audit_id, deleted_at, \"trigger\", app_version, data_release, success) VALUES (?, ?, '用户操作', ?, ?, 0)")
        .run(auditId, new Date().toISOString(), opts.appVersion, opts.dataRelease);
      this.W = { armed: false, kind: null, grantSeq: 0, auditId: null, txnToken: null };
      this.commit();
      return auditId;
    } catch {
      this.rollback();
      return null; // 删除失败且失败审计未写入：向调用方报告（第 (5) 条第 5 步）
    }
  }
}
