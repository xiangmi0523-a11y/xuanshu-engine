// 审核清单 §5.4 用户库 DB-U-03～06、14、15；§8.1 ZR-DB-1～5、7；DB-Q-05（分支状态历史，跨库查询复核）。
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openMemoryDb } from "../../db/connect.js";
import { snapshotChecks } from "../../db/queries.js";
import { loadWorld } from "../fixtures/load.js";
import { baseRows, ins, rejects, releases, type Row } from "./helpers.js";

const B = (t: string): Row => baseRows().find((r) => r[1] === t)![2];
const R = releases();
function udb(): DatabaseSync {
  const db = loadWorld("G0").db; // 正式库带真实登记（参数注册表、数据版本）
  ins(db, "main", "profile", { ...B("profile") });
  return db;
}
const P = () => String(B("profile")["owner_profile_id"]);
const input = (over: Row): Row => ({ ...B("calculation_input"), ...over });
const BAZI_RAW = "{\"civil_datetime\":\"1990-06-15T14:30\",\"dst_included\":true,\"gender\":\"UNKNOWN\",\"time_precision\":\"MINUTE\",\"tz_id\":\"Asia/Shanghai\",\"v\":1}";

test("DB-U-03：BAZI 输入须有性别与时辰精度；性别取值受限；LIUYAO 可无性别", () => {
  const db = udb();
  ins(db, "main", "calculation_input", input({ input_id: "X-1", domain: "BAZI", raw_payload: BAZI_RAW, gender: "UNKNOWN", time_precision: "MINUTE" }));
  rejects(() => ins(db, "main", "calculation_input", input({ input_id: "X-2", domain: "BAZI", raw_payload: BAZI_RAW, gender: null, time_precision: "MINUTE" })), "DB-U-03a");
  rejects(() => ins(db, "main", "calculation_input", input({ input_id: "X-3", domain: "BAZI", raw_payload: BAZI_RAW, gender: "X", time_precision: "MINUTE" })), "DB-E-calculation_input.gender");
  ins(db, "main", "calculation_input", input({ input_id: "X-4", gender: null }));
});

test("DB-U-04：有时刻的输入缺时区解析，Q-U-04 返回该 input_id", () => {
  const db = udb();
  ins(db, "main", "calculation_input", input({ input_id: "X-OK" }));
  ins(db, "main", "input_tz_resolution", { ...B("input_tz_resolution"), input_id: "X-OK" });
  assert.deepEqual(snapshotChecks["Q-U-04"]!(db), []);
  ins(db, "main", "calculation_input", input({ input_id: "X-NO" }));
  assert.deepEqual(snapshotChecks["Q-U-04"]!(db).map((r) => r["input_id"]), ["X-NO"]);
});

test("DB-U-05：配置版本递增与内容去重 (a)(b)(c)", () => {
  const db = udb();
  const cfg = (id: string, ver: number, hash: string) => { db.exec("BEGIN"); try { ins(db, "main", "calculation_config", { ...B("calculation_config"), config_id: id, config_version: ver, config_hash: hash }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  cfg("C1", 1, "h1"); cfg("C1", 2, "h2");
  rejects(() => cfg("C1", 2, "h3"), /DB-U-05a|UNIQUE constraint failed: calculation_config.config_id, calculation_config.config_version/);
  rejects(() => cfg("C1", 1, "h4"), /DB-U-05b|UNIQUE/);
  rejects(() => cfg("C2", 1, "h1"), "DB-U-05c");
});

test("DB-U-06：value_source——非锁定参数写 version_locked 由 Q-U-06 查出；value_source = auto 被 CHECK 拒", () => {
  const db = udb();
  const put = (cid: string, p: Row) => { db.exec("BEGIN"); try { ins(db, "main", "config_param_value", { config_id: cid, config_version: 1, ...p }); ins(db, "main", "calculation_config", { ...B("calculation_config"), config_id: cid, config_hash: `h-${cid}` }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  put("X-OK", { param_id: "CFG-02", value: "false", value_source: "user_selected", apply_mode: "applied" });
  assert.deepEqual(snapshotChecks["Q-U-06"]!(db), []);
  put("X-BAD", { param_id: "CFG-02", value: "false", value_source: "version_locked", apply_mode: "applied" });
  assert.deepEqual(snapshotChecks["Q-U-06"]!(db).map((r) => r["config_id"]), ["X-BAD"]);
  rejects(() => put("X-AUTO", { param_id: "CFG-02", value: "false", value_source: "auto", apply_mode: "applied" }), "DB-E-config_param_value.value_source");
});

test("ZR-DB-1 / ZR-DB-2 / ZR-DB-3 / ZR-DB-4 / ZR-DB-5 / ZR-DB-7：CFG-01 第一版只许 (ye_zi_b, version_locked)", () => {
  const db = udb();
  const put = (value: string | null, source: string) => () => { db.exec("BEGIN"); try { ins(db, "main", "config_param_value", { config_id: "X-Z", config_version: 1, param_id: "CFG-01", value, value_source: source, apply_mode: "applied" }); db.exec("ROLLBACK"); } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } };
  for (const v of ["zi_zheng", "zi_chu", "ye_zi_c"]) {
    rejects(put(v, "version_locked"), "ZR-DB-value", `${v} version_locked`);
    rejects(put(v, "user_selected"), "ZR-DB-value", `${v} user_selected`);
  }
  rejects(put("ye_zi_b", "user_selected"), "ZR-DB-source");
  rejects(put(null, "version_locked"), "NOT NULL constraint failed: config_param_value.value");
  put("ye_zi_b", "version_locked")();
  // CFG-01 锁定值来自 constants.toml（生成脚本读取，不手写进 DDL 模板）
  const ddl = (db.prepare("SELECT sql FROM main.sqlite_master WHERE name = 'config_param_value'").get() as { sql: string }).sql;
  assert.match(ddl, /value = 'ye_zi_b'/);
});

test("DB-U-14：个人对象 branch_id 必填、formal_status 只许 NON_FORMAL", () => {
  const db = openMemoryDb({ tablesOnly: true });
  ins(db, "main", "branch", { ...B("branch"), base_snapshot_id: null });
  const v = { ...B("personal_rule_variant") };
  ins(db, "main", "personal_rule_variant", v);
  rejects(() => ins(db, "main", "personal_rule_variant", { ...v, rule_variant_id: "X-1", branch_id: null }), "NOT NULL constraint failed: personal_rule_variant.branch_id");
  rejects(() => ins(db, "main", "personal_rule_variant", { ...v, rule_variant_id: "X-2", formal_status: "FORMAL" }), "DB-U-14");
});

test("DB-U-15 / DB-Q-05（分支）：active → merged 须有数据版本；base_data_release 必填；parent 悬空拒；merged 后不得再追加", () => {
  const db = loadWorld("G1").db;
  const br: Row = { ...B("branch"), base_snapshot_id: null, base_data_release: R[0]! };
  ins(db, "main", "branch", br);
  rejects(() => ins(db, "main", "branch", { ...br, branch_id: "X-B1", base_data_release: null }), "NOT NULL constraint failed: branch.base_data_release");
  rejects(() => ins(db, "main", "branch", { ...br, branch_id: "X-B2", parent_branch_id: "X-NONE" }), "FOREIGN KEY constraint failed");
  const h = (seq: number, prev: string | null, next: string, rel: string | null) => ins(db, "main", "branch_status_history", { branch_id: String(br["branch_id"]), previous_status: prev, new_status: next, data_release: rel, note: "n", sequence_no: seq });
  h(1, null, "active", null);
  rejects(() => h(2, "active", "merged", null), "DB-U-15c");
  h(2, "active", "merged", R[1]!);
  rejects(() => h(3, "merged", "active", null), "DB-U-15d");
  assert.deepEqual(snapshotChecks["Q-Q-05-branch"]!(db), [], "分支历史的数据版本序不倒退（merged 为终态，跨库查询复核）");
});
