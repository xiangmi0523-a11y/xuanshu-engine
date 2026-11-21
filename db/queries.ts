// 验证查询（发布校验与连接级复核；审核清单 §3.10“E + Q”、第 5 节各 Q-* 编号）。
// 每个查询返回违规行（结果为空即通过）。需读正式库者在 ATTACH 后执行（main = 用户库，formal = 正式库）。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { hashOf } from "./canonical.js";

type Row = Record<string, unknown>;
const q = (db: DatabaseSync, sql: string, ...a: (string | number | null)[]): Row[] => db.prepare(sql).all(...a) as Row[];
const snapFilter = (col: string, id?: string) => (id ? ` AND ${col} = '${id.replace(/'/g, "''")}'` : "");

// ---------------------------------------------------------------- 正式库发布校验
export const releaseChecks = {
  /** Q-F-10 替代关系无环 */
  "Q-F-10": (db: DatabaseSync) => q(db, `
    WITH RECURSIVE walk(start, cur, depth) AS (
      SELECT old_variant_id, new_variant_id, 1 FROM formal.variant_supersedes
      UNION ALL SELECT w.start, s.new_variant_id, w.depth + 1 FROM walk w JOIN formal.variant_supersedes s ON s.old_variant_id = w.cur WHERE w.depth < 64)
    SELECT DISTINCT start AS rule_variant_id FROM walk WHERE start = cur`),
  /** Q-F-14 争议至少两个主张 */
  "Q-F-14": (db: DatabaseSync) => q(db, `SELECT d.dispute_id, count(c.claim) AS n FROM formal.dispute d LEFT JOIN formal.dispute_claim c ON c.dispute_id = d.dispute_id GROUP BY d.dispute_id HAVING n < 2`),
  /** Q-F-18 治理索引每行指向且仅指向一条权威记录 */
  "Q-F-18": (db: DatabaseSync) => q(db, `SELECT source_table, source_id, count(*) AS n FROM formal.v_governance_record GROUP BY source_table, source_id HAVING n <> 1`),
  /** Q-F-24 RuleVariant 正式状态转换与批准一致（清单 §3.3；(d) 为终审 R3 增补的证据失效情形） */
  "Q-F-24a": (db: DatabaseSync) => q(db, `
    SELECT h.target_id AS rule_variant_id, h.data_release FROM formal.formal_status_history h JOIN formal.data_release r ON r.data_release = h.data_release
    WHERE h.target_type = 'RuleVariant' AND h.new_value = 'FORMAL' AND NOT EXISTS (
      SELECT 1 FROM formal.approval_record a JOIN formal.data_release ar ON ar.data_release = a.data_release
      WHERE a.target_id = h.target_id AND ar.release_seq <= r.release_seq AND a.decision = 'approve'
        AND a.sequence_no = (SELECT max(x.sequence_no) FROM formal.approval_record x JOIN formal.data_release xr ON xr.data_release = x.data_release
                             WHERE x.target_id = h.target_id AND xr.release_seq <= r.release_seq))`),
  "Q-F-24b": (db: DatabaseSync) => q(db, `
    SELECT h.target_id AS rule_variant_id, h.data_release FROM formal.formal_status_history h JOIN formal.data_release r ON r.data_release = h.data_release
    JOIN formal.rule_variant v ON v.rule_variant_id = h.target_id
    WHERE h.target_type = 'RuleVariant' AND h.new_value = 'FORMAL' AND EXISTS (
      SELECT 1 FROM formal.approval_record a JOIN formal.data_release ar ON ar.data_release = a.data_release
      WHERE a.target_id = h.target_id AND ar.release_seq <= r.release_seq AND a.decision = 'approve' AND a.target_content_hash <> v.content_hash
        AND a.sequence_no = (SELECT max(x.sequence_no) FROM formal.approval_record x WHERE x.target_id = h.target_id))`),
  "Q-F-24c": (db: DatabaseSync) => q(db, `
    SELECT a.target_id AS rule_variant_id, a.data_release FROM formal.approval_record a JOIN formal.data_release r ON r.data_release = a.data_release
    WHERE a.decision = 'revoke' AND (
      SELECT h.new_value FROM formal.formal_status_history h JOIN formal.data_release hr ON hr.data_release = h.data_release
      WHERE h.target_type = 'RuleVariant' AND h.target_id = a.target_id AND hr.release_seq <= r.release_seq ORDER BY h.sequence_no DESC LIMIT 1) = 'FORMAL'`),
  "Q-F-24d": (db: DatabaseSync) => q(db, `
    SELECT v.rule_variant_id, eh.data_release, eh.target_id AS evidence_id
    FROM formal.formal_status_history eh JOIN formal.data_release er ON er.data_release = eh.data_release
    JOIN formal.evidence_link l ON l.evidence_id = eh.target_id AND l.evidence_role = '支持' AND l.branch_id IS NULL
    JOIN formal.rule_variant v ON v.component_id = l.component_id
    WHERE eh.target_type = 'Evidence' AND eh.new_value = 'NON_FORMAL' AND (
      SELECT h.new_value FROM formal.formal_status_history h JOIN formal.data_release hr ON hr.data_release = h.data_release
      WHERE h.target_type = 'RuleVariant' AND h.target_id = v.rule_variant_id AND hr.release_seq <= er.release_seq ORDER BY h.sequence_no DESC LIMIT 1) = 'FORMAL'`),
  /** Q-F-25 成对阻断同步解除（B4 与 BLK-6、B1 与 BLK-7；§9.5、BLK.4） */
  "Q-F-25": (db: DatabaseSync) => q(db, `
    WITH pairs(a, b) AS (VALUES ('B4','BLK-6'), ('BLK-6','B4'), ('B1','BLK-7'), ('BLK-7','B1'))
    SELECT p.a AS block_id, c.data_release FROM pairs p JOIN formal.blocker_change c ON c.block_id = p.a AND c.new_status = '已解除'
    WHERE NOT EXISTS (SELECT 1 FROM formal.blocker_change d WHERE d.block_id = p.b AND d.new_status = '已解除' AND d.data_release = c.data_release)`),
  /** Q-C-07 R-I-1：Source NON_FORMAL 而其 Edition 为 FORMAL */
  "Q-C-07": (db: DatabaseSync) => q(db, `
    SELECT e.edition_id FROM formal.edition e
    JOIN formal.v_formal_status_current fs ON fs.target_type = 'Source' AND fs.target_id = e.source_id AND fs.value = 'NON_FORMAL'
    JOIN formal.v_formal_status_current fe ON fe.target_type = 'Edition' AND fe.target_id = e.edition_id AND fe.value = 'FORMAL'`),
  /** Q-C-08 R-I-3：Edition NON_FORMAL 而引用它的 Evidence 为 FORMAL */
  "Q-C-08": (db: DatabaseSync) => q(db, `
    SELECT DISTINCT ep.evidence_id FROM formal.evidence_passage ep JOIN formal.passage p ON p.passage_id = ep.passage_id
    JOIN formal.v_formal_status_current fe ON fe.target_type = 'Edition' AND fe.target_id = p.edition_id AND fe.value = 'NON_FORMAL'
    JOIN formal.v_formal_status_current fv ON fv.target_type = 'Evidence' AND fv.target_id = ep.evidence_id AND fv.value = 'FORMAL'`),
  /** Q-C-09 R-I-4：支持类证据 NON_FORMAL 而变体（按 §8.2 推出）为 FORMAL；反证、限定、异文记录不触发 */
  "Q-C-09": (db: DatabaseSync) => q(db, `
    SELECT DISTINCT vf.rule_variant_id FROM formal.v_variant_formal vf
    JOIN formal.evidence_link l ON l.component_id = vf.component_id AND l.evidence_role = '支持' AND l.branch_id IS NULL
    JOIN formal.v_formal_status_current fe ON fe.target_type = 'Evidence' AND fe.target_id = l.evidence_id AND fe.value = 'NON_FORMAL'
    WHERE vf.formal_status = 'FORMAL'`),
};

// ---------------------------------------------------------------- §12.2 证据一致性查询（W-02，DB-X-05）
export const evidenceChecks = {
  "Q-X-05-1": (db: DatabaseSync) => q(db, `SELECT e.evidence_id FROM formal.evidence e JOIN formal.v_evidence_current c ON c.evidence_id = e.evidence_id
                                           WHERE c.evidence_status = 'PRIMARY_VERIFIED' AND e.confidence <> 'A'`),
  "Q-X-05-2": (db: DatabaseSync) => q(db, `SELECT e.evidence_id FROM formal.evidence e JOIN formal.v_evidence_current c ON c.evidence_id = e.evidence_id
                                           WHERE c.evidence_status = 'PRIMARY_VERIFIED' AND (e.verification_method IS NULL
                                             OR (instr(e.verification_method, '影印本对校') = 0 AND instr(e.verification_method, '馆藏版本核对') = 0))`),
  "Q-X-05-3": (db: DatabaseSync) => q(db, `SELECT DISTINCT e.evidence_id FROM formal.evidence e JOIN formal.v_evidence_current c ON c.evidence_id = e.evidence_id
                                           JOIN formal.evidence_passage ep ON ep.evidence_id = e.evidence_id JOIN formal.passage p ON p.passage_id = ep.passage_id
                                           WHERE c.evidence_status = 'PRIMARY_VERIFIED' AND (p.image_ref IS NULL OR p.verified_by IS NULL OR p.verified_at IS NULL
                                             OR p.against_what IS NULL OR p.result IS NULL)`),
  "Q-X-05-4": (db: DatabaseSync) => q(db, `SELECT e.evidence_id FROM formal.evidence e JOIN formal.v_evidence_current c ON c.evidence_id = e.evidence_id
                                           WHERE e.origin = 'ai_output' AND c.evidence_status <> 'UNVERIFIED'
                                             AND NOT EXISTS (SELECT 1 FROM formal.manual_check_record m WHERE m.evidence_id = e.evidence_id)`),
  "Q-X-05-5": (db: DatabaseSync) => q(db, `SELECT DISTINCT e.evidence_id FROM formal.evidence e JOIN formal.evidence_passage ep ON ep.evidence_id = e.evidence_id
                                           JOIN formal.passage p ON p.passage_id = ep.passage_id JOIN formal.edition ed ON ed.edition_id = p.edition_id
                                           WHERE ed.transcription_status = '转录本（未与影印本对校）' AND e.confidence = 'A'`),
  /** 正式对象引用 branch_id 非空的对象：正式表的 branch_id 列均须为空 */
  "Q-X-05-6": (db: DatabaseSync) => q(db, `SELECT 'edition' AS t, edition_id AS id FROM formal.edition WHERE branch_id IS NOT NULL
                                           UNION ALL SELECT 'evidence', evidence_id FROM formal.evidence WHERE branch_id IS NOT NULL
                                           UNION ALL SELECT 'rule_variant', rule_variant_id FROM formal.rule_variant WHERE branch_id IS NOT NULL
                                           UNION ALL SELECT 'evidence_link', evidence_id FROM formal.evidence_link WHERE branch_id IS NOT NULL`),
  /** 个人对象缺 branch_id */
  "Q-X-05-7": (db: DatabaseSync) => q(db, `SELECT 'personal_edition' AS t, edition_id AS id FROM main.personal_edition WHERE branch_id IS NULL
                                           UNION ALL SELECT 'personal_evidence', evidence_id FROM main.personal_evidence WHERE branch_id IS NULL
                                           UNION ALL SELECT 'personal_rule_variant', rule_variant_id FROM main.personal_rule_variant WHERE branch_id IS NULL
                                           UNION ALL SELECT 'personal_text_variant', variant_id FROM main.personal_text_variant WHERE branch_id IS NULL
                                           UNION ALL SELECT 'personal_evidence_link', evidence_id FROM main.personal_evidence_link WHERE branch_id IS NULL`),
};

// ---------------------------------------------------------------- 用户库与跨库复核（可按快照过滤）
export const snapshotChecks: Record<string, (db: DatabaseSync, sid?: string) => Row[]> = {
  /** Q-U-04 有时刻的输入缺时区解析 */
  "Q-U-04": (db: DatabaseSync) => q(db, `SELECT i.input_id FROM main.calculation_input i
    WHERE (i.domain = 'LIUYAO' OR i.time_precision IN ('MINUTE','SHICHEN')) AND NOT EXISTS (SELECT 1 FROM main.input_tz_resolution t WHERE t.input_id = i.input_id)`),
  /** Q-U-06 version_locked 只用于 VERSION_LOCKED 参数，且取值等于登记的锁定值（可按快照所引配置过滤） */
  "Q-U-06": (db: DatabaseSync, sid?: string) => q(db, `SELECT p.config_id, p.param_id FROM main.config_param_value p LEFT JOIN formal.parameter_registry r ON r.param_id = p.param_id
    WHERE ((p.value_source = 'version_locked' AND (r.registry_status IS NOT 'VERSION_LOCKED' OR p.value IS NOT r.locked_value))
       OR (r.registry_status = 'VERSION_LOCKED' AND p.value_source <> 'version_locked'))${sid ? ` AND EXISTS (SELECT 1 FROM main.calculation_snapshot s WHERE s.config_id = p.config_id AND s.config_version = p.config_version${snapFilter("s.snapshot_id", sid)})` : ""}`),
  /** Q-Q-05-branch 分支状态历史的 data_release（merged 时，属正式库）版本序不得倒退（DB-Q-05；跨库按 §3.10 由查询复核） */
  "Q-Q-05-branch": (db: DatabaseSync) => q(db, `SELECT h.branch_id, h.sequence_no, h.data_release FROM main.branch_status_history h
    JOIN formal.data_release r ON r.data_release = h.data_release
    WHERE EXISTS (SELECT 1 FROM main.branch_status_history e JOIN formal.data_release er ON er.data_release = e.data_release
                  WHERE e.branch_id = h.branch_id AND e.sequence_no < h.sequence_no AND er.release_seq > r.release_seq)`),
  /** Q-C-01 FORMAL 快照的依赖中有变体在正式库为 NON_FORMAL（§8.2） */
  "Q-C-01": (db: DatabaseSync, sid?: string) => q(db, `SELECT d.snapshot_id, d.ref_id FROM main.snapshot_dependency d JOIN main.calculation_snapshot s ON s.snapshot_id = d.snapshot_id
    JOIN formal.v_variant_formal vf ON vf.rule_variant_id = d.ref_id
    WHERE s.formal_status = 'FORMAL' AND d.dep_type IN ('rule_variant','cross_domain') AND d.ref_kind = 'formal' AND vf.formal_status <> 'FORMAL'${snapFilter("d.snapshot_id", sid)}`),
  /** Q-C-04 普通配置“参与计算”地使用映射到暂缓子项变体的参数值（A-5；Q-12：stored_only 不在此列） */
  "Q-C-04": (db: DatabaseSync, sid?: string) => q(db, `SELECT p.config_id, p.param_id, p.value FROM main.config_param_value p
    JOIN formal.param_variant_map m ON m.param_id = p.param_id AND m.param_value = p.value
    JOIN formal.rule_variant v ON v.rule_variant_id = m.rule_variant_id
    JOIN formal.v_admission_current a ON a.component_id = v.component_id AND a.purpose = 'calc'
    WHERE p.apply_mode = 'applied' AND a.status = 'DEFERRED'${sid ? ` AND EXISTS (SELECT 1 FROM main.calculation_snapshot s WHERE s.config_id = p.config_id AND s.config_version = p.config_version${snapFilter("s.snapshot_id", sid)})` : ""}`),
  /** Q-C-05 六爻排日辰完成却无跨域依赖登记（R-I-8） */
  "Q-C-05": (db: DatabaseSync, sid?: string) => q(db, `SELECT s.snapshot_id FROM main.calculation_snapshot s JOIN main.execution_trace_step t ON t.snapshot_id = s.snapshot_id
    WHERE s.domain = 'LIUYAO' AND t.step_code = 'LY-06' AND t.status = '完成'
      AND NOT EXISTS (SELECT 1 FROM main.snapshot_dependency d WHERE d.snapshot_id = s.snapshot_id AND d.dep_type = 'cross_domain')${snapFilter("s.snapshot_id", sid)}`),
  /** Q-C-06 实际依赖（P-42）：每步轨迹 input_summary.reads 所列规则函数，其登记子项的变体须以同一步骤记入依赖；所读函数须已登记子项（R-I-8） */
  "Q-C-06": (db: DatabaseSync, sid?: string) => q(db, `
    SELECT t.snapshot_id, t.step_code, r.value AS calc_function_id, c.component_id, 'missing_dependency' AS problem
    FROM main.execution_trace_step t, json_each(t.input_summary, '$.reads') r JOIN formal.rule_component c ON c.calc_function_id = r.value
    WHERE NOT EXISTS (SELECT 1 FROM main.snapshot_dependency d JOIN formal.rule_variant v ON v.rule_variant_id = d.ref_id
                      WHERE d.snapshot_id = t.snapshot_id AND d.step_code = t.step_code AND d.dep_type IN ('rule_variant','cross_domain') AND v.component_id = c.component_id)${snapFilter("t.snapshot_id", sid)}
    UNION ALL
    SELECT t.snapshot_id, t.step_code, r.value, NULL, 'unregistered_function' FROM main.execution_trace_step t, json_each(t.input_summary, '$.reads') r
    WHERE NOT EXISTS (SELECT 1 FROM formal.rule_component c WHERE c.calc_function_id = r.value)${snapFilter("t.snapshot_id", sid)}`),
  /** Q-C-10 分支选择所读的变体须记入依赖（同 Q-C-06）；未执行步骤上不得出现该步未读取的变体依赖（契约降级规则、准入状态或范围外作出的跳过不是变体依赖） */
  "Q-C-10": (db: DatabaseSync, sid?: string) => [
    ...(snapshotChecks["Q-C-06"]!(db, sid)),
    ...q(db, `SELECT d.snapshot_id, d.step_code, d.ref_id, 'skip_recorded_as_dependency' AS problem FROM main.snapshot_dependency d
      JOIN main.execution_trace_step t ON t.snapshot_id = d.snapshot_id AND t.step_code = d.step_code
      LEFT JOIN formal.rule_variant v ON v.rule_variant_id = d.ref_id LEFT JOIN formal.rule_component c ON c.component_id = v.component_id
      WHERE d.dep_type IN ('rule_variant','cross_domain') AND t.status = '未执行'
        AND NOT EXISTS (SELECT 1 FROM json_each(t.input_summary, '$.reads') r WHERE r.value = c.calc_function_id)${snapFilter("d.snapshot_id", sid)}`)],
  /** Q-T-01 每个步骤编号恰一行（以正式库步骤表为准，不含已废止编号） */
  "Q-T-01": (db: DatabaseSync, sid?: string) => q(db, `
    SELECT s.snapshot_id, c.step_code, 'missing' AS problem FROM main.calculation_snapshot s JOIN formal.step_code c ON c.module = s.domain
    WHERE NOT EXISTS (SELECT 1 FROM formal.step_code_retirement r WHERE r.step_code = c.step_code)
      AND NOT EXISTS (SELECT 1 FROM main.execution_trace_step t WHERE t.snapshot_id = s.snapshot_id AND t.step_code = c.step_code)${snapFilter("s.snapshot_id", sid)}
    UNION ALL
    SELECT t.snapshot_id, t.step_code, 'unknown' FROM main.execution_trace_step t JOIN main.calculation_snapshot s ON s.snapshot_id = t.snapshot_id
    WHERE NOT EXISTS (SELECT 1 FROM formal.step_code c WHERE c.step_code = t.step_code AND c.module = s.domain)${snapFilter("t.snapshot_id", sid)}`),
  /** Q-T-04 完成步骤的函数三元与正式库引擎登记一致 */
  "Q-T-04": (db: DatabaseSync, sid?: string) => q(db, `SELECT t.snapshot_id, t.step_code FROM main.execution_trace_step t JOIN main.calculation_snapshot s ON s.snapshot_id = t.snapshot_id
    WHERE t.status = '完成' AND NOT EXISTS (SELECT 1 FROM formal.engine_function f WHERE f.engine_release_id = s.engine_release_id
      AND f.calc_function_id = t.calc_function_id AND f.function_version = t.function_version AND f.impl_hash = t.impl_hash)${snapFilter("t.snapshot_id", sid)}`),
  /** Q-T-06 完成步骤所依赖的步骤也须完成 */
  "Q-T-06": (db: DatabaseSync, sid?: string) => q(db, `SELECT t.snapshot_id, t.step_code, d.depends_on FROM main.execution_trace_step t
    JOIN formal.step_dependency d ON d.step_code = t.step_code
    JOIN main.execution_trace_step u ON u.snapshot_id = t.snapshot_id AND u.step_code = d.depends_on
    WHERE t.status = '完成' AND u.status <> '完成'${snapFilter("t.snapshot_id", sid)}`),
  /** Q-T-07 CFG-02 = false 时经度换算与均时差不得完成 */
  "Q-T-07": (db: DatabaseSync, sid?: string) => q(db, `SELECT s.snapshot_id, t.step_code FROM main.calculation_snapshot s
    JOIN main.config_param_value p ON p.config_id = s.config_id AND p.config_version = s.config_version AND p.param_id = 'CFG-02' AND p.value = 'false'
    JOIN main.execution_trace_step t ON t.snapshot_id = s.snapshot_id AND t.step_code IN ('BZ-02','BZ-03') AND t.status = '完成'
    WHERE 1 = 1${snapFilter("s.snapshot_id", sid)}`),
  /** Q-B-01 所经步骤映射到现行阻断的 BLOCKED-FORMAL / BLOCKED-HARD 却已封存（不得记为 NON_FORMAL，Q-6） */
  "Q-B-01": (db: DatabaseSync, sid?: string) => q(db, `SELECT t.snapshot_id, t.step_code, m.block_id FROM main.execution_trace_step t
    JOIN formal.blocker_step_map m ON m.step_code = t.step_code JOIN formal.v_blocker_current b ON b.block_id = m.block_id
    WHERE t.status = '完成' AND b.status = '现行' AND m.effect IN ('BLOCKED-FORMAL','BLOCKED-HARD')${snapFilter("t.snapshot_id", sid)}`),
  /** Q-B-02 BLOCKER_PATH 原因只能引用效果为 NON_FORMAL 的映射 */
  "Q-B-02": (db: DatabaseSync, sid?: string) => q(db, `SELECT r.snapshot_id, r.upstream_id, r.step_code FROM main.snapshot_non_formal_reason r
    WHERE r.reason_kind = 'BLOCKER_PATH' AND NOT EXISTS (SELECT 1 FROM formal.blocker_step_map m
      WHERE m.block_id = r.upstream_id AND m.step_code = r.step_code AND m.effect = 'NON_FORMAL')${snapFilter("r.snapshot_id", sid)}`),
  /** Q-X-01 / Q-X-03 用户库三元组在正式库存在且哈希一致 */
  "Q-X-01": (db: DatabaseSync, sid?: string) => q(db, `
    SELECT d.snapshot_id, d.dep_type, d.ref_id FROM main.snapshot_dependency d
    WHERE d.ref_kind = 'formal' AND d.dep_type IN ('rule_variant','cross_domain')
      AND NOT EXISTS (SELECT 1 FROM formal.rule_variant v WHERE v.rule_variant_id = d.ref_id AND v.content_hash = d.ref_hash AND CAST(v.version_no AS TEXT) = d.ref_version)${snapFilter("d.snapshot_id", sid)}
    UNION ALL SELECT d.snapshot_id, d.dep_type, d.ref_id FROM main.snapshot_dependency d
    WHERE d.ref_kind = 'formal' AND d.dep_type = 'calendar_data'
      AND NOT EXISTS (SELECT 1 FROM formal.data_version v WHERE v.kind = d.ref_id AND v.version = d.ref_version AND v.sha256 = d.ref_hash)${snapFilter("d.snapshot_id", sid)}
    UNION ALL SELECT d.snapshot_id, d.dep_type, d.ref_id FROM main.snapshot_dependency d
    WHERE d.ref_kind = 'formal' AND d.dep_type = 'parameter'
      AND NOT EXISTS (SELECT 1 FROM formal.parameter_registry r WHERE r.param_id = d.ref_id AND r.registry_version = d.registry_version)${snapFilter("d.snapshot_id", sid)}
    UNION ALL SELECT d.snapshot_id, d.dep_type, d.ref_id FROM main.snapshot_dependency d
    WHERE d.ref_kind = 'formal' AND d.ref_release IS NOT NULL AND NOT EXISTS (SELECT 1 FROM formal.data_release r WHERE r.data_release = d.ref_release)${snapFilter("d.snapshot_id", sid)}
    UNION ALL SELECT d.snapshot_id, d.dep_type, d.ref_id FROM main.snapshot_dependency d
    WHERE d.ref_kind = 'formal' AND d.dep_type = 'rule_variant' AND d.approval_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM formal.approval_record a WHERE a.approval_id = d.approval_id AND a.target_id = d.ref_id)${snapFilter("d.snapshot_id", sid)}
    UNION ALL SELECT NULL, 'personal_rule_variant', p.rule_variant_id FROM main.personal_rule_variant p
    WHERE NOT EXISTS (SELECT 1 FROM formal.rule_component c WHERE c.component_id = p.component_id)`),
  /** Q-X-02 正式库无行引用用户库对象（正式表的引用列不得出现用户库的快照、档案、个人对象 ID） */
  "Q-X-02": (db: DatabaseSync) => q(db, `
    SELECT 'review_record' AS t, review_id AS id FROM formal.review_record WHERE target_id IN (SELECT snapshot_id FROM main.calculation_snapshot UNION SELECT owner_profile_id FROM main.profile
      UNION SELECT rule_variant_id FROM main.personal_rule_variant UNION SELECT evidence_id FROM main.personal_evidence UNION SELECT edition_id FROM main.personal_edition)
    UNION ALL SELECT 'dispute', dispute_id FROM formal.dispute WHERE substr(object_ref, instr(object_ref, ':') + 1) IN (SELECT rule_variant_id FROM main.personal_rule_variant UNION SELECT snapshot_id FROM main.calculation_snapshot)
    UNION ALL SELECT 'formal_status_history', target_id FROM formal.formal_status_history WHERE target_id IN (SELECT rule_variant_id FROM main.personal_rule_variant UNION SELECT evidence_id FROM main.personal_evidence UNION SELECT edition_id FROM main.personal_edition)`),
  /** Q-X-04 engine_release_id 已登记 */
  "Q-X-04": (db: DatabaseSync, sid?: string) => q(db, `SELECT s.snapshot_id, s.engine_release_id FROM main.calculation_snapshot s
    WHERE NOT EXISTS (SELECT 1 FROM formal.engine_release e WHERE e.engine_release_id = s.engine_release_id)${snapFilter("s.snapshot_id", sid)}`),
  /** Q-X-07 canonicalization_version 已在 F06 登记；Branch.base_data_release 已在 F01 登记（自查 Z-6） */
  "Q-X-07": (db: DatabaseSync, sid?: string) => q(db, `
    SELECT 'calculation_snapshot' AS t, snapshot_id AS id, canonicalization_version AS v FROM main.calculation_snapshot
      WHERE canonicalization_version NOT IN (SELECT version FROM formal.canonicalization_version)${snapFilter("snapshot_id", sid)}
    UNION ALL SELECT 'calculation_config', config_id, canonicalization_version FROM main.calculation_config WHERE canonicalization_version NOT IN (SELECT version FROM formal.canonicalization_version)
    UNION ALL SELECT 'personal_rule_variant', rule_variant_id, canonicalization_version FROM main.personal_rule_variant WHERE canonicalization_version NOT IN (SELECT version FROM formal.canonicalization_version)
    UNION ALL SELECT 'snapshot_dependency', snapshot_id, canonicalization_version FROM main.snapshot_dependency WHERE dep_type = 'engine' AND canonicalization_version NOT IN (SELECT version FROM formal.canonicalization_version)${snapFilter("snapshot_id", sid)}
    UNION ALL SELECT 'branch', branch_id, base_data_release FROM main.branch WHERE base_data_release NOT IN (SELECT data_release FROM formal.data_release)`),
};

/** Q-T-10 按 engine_function_source 重算 impl_hash 并与登记值比对；同时核对源文件现值（读仓库文件） */
export function checkImplHashes(db: DatabaseSync, repoRoot: URL, readFile: (u: URL) => Buffer = (u) => readFileSync(u)): Row[] {
  const fns = q(db, "SELECT engine_release_id, calc_function_id, impl_hash FROM formal.engine_function ORDER BY engine_release_id, calc_function_id");
  const bad: Row[] = [];
  for (const f of fns) {
    const src = q(db, "SELECT path, file_sha256 FROM formal.engine_function_source WHERE engine_release_id = ? AND calc_function_id = ? ORDER BY path",
      String(f["engine_release_id"]), String(f["calc_function_id"]));
    const recomputed = hashOf(src.map((s) => ({ path: s["path"], file_sha256: s["file_sha256"] })));
    if (recomputed !== f["impl_hash"]) bad.push({ ...f, problem: "impl_hash 与源文件清单不符" });
    for (const s of src) {
      const cur = sha256File(readFile(new URL(String(s["path"]), repoRoot)));
      if (cur !== s["file_sha256"]) bad.push({ ...f, path: s["path"], problem: "源文件已变化" });
    }
  }
  return bad;
}
export const sha256File = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** 封存前复核（引擎预检，清单 §3.10“E + Q”）：只看指定快照 */
export const PRESEAL_CHECKS = ["Q-T-01", "Q-T-04", "Q-T-06", "Q-T-07", "Q-C-04", "Q-C-05", "Q-C-06", "Q-C-10", "Q-U-06", "Q-B-01", "Q-B-02", "Q-X-01", "Q-X-04", "Q-X-07", "Q-C-01"] as const;
export function presealViolations(db: DatabaseSync, snapshotId: string): { check: string; rows: Row[] }[] {
  const out: { check: string; rows: Row[] }[] = [];
  for (const k of PRESEAL_CHECKS) {
    const rows = snapshotChecks[k]!(db, snapshotId).filter((r) => !("snapshot_id" in r) || r["snapshot_id"] === snapshotId || r["snapshot_id"] === null);
    if (rows.length) out.push({ check: k, rows });
  }
  return out;
}
