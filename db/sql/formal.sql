-- 由 db/gen.ts 从 db/sql/formal.sql.in 生成，请勿手改（CI 以 --check 比对）。
-- 玄枢正式库（formal.sqlite）表结构模板 —— E2 数据库结构准备
-- 依据：数据仓库 review/E2_结构与约束审核清单.md（最终审核通过基线 7388ffa）第 3、4 节；契约 v1.0 §1～§10。
-- 本文件是模板：db/gen.ts 读取后为每个对象加 "formal." 前缀、追加只读触发器，输出 db/sql/formal.sql。
-- E2 只在测试进程内存库中执行（B3-1 D1）；不生成任何数据库文件。
-- 约定：具名约束 CONSTRAINT "<约束编号>"，触发器报错 RAISE(ABORT, '[<约束编号>] …')（清单 §3.1）。
-- 状态类“当前值”一律为视图，不建可写列（清单 §3.3、Q-5）。

-- ===================================================================== 版本、登记与步骤
-- F01 data_release（§1.2、§8.1）
CREATE TABLE formal.data_release (
  data_release TEXT NOT NULL PRIMARY KEY,
  release_seq  INTEGER NOT NULL UNIQUE,
  commit_sha   TEXT NOT NULL,
  created_at   TEXT NOT NULL
) STRICT;

-- F02 data_version（§1.3 引擎层、§6.4、§13.4）
CREATE TABLE formal.data_version (
  kind         TEXT NOT NULL CONSTRAINT "DB-E-data_version.kind" CHECK (kind IN ('tz','jieqi','place','eot','day_pillar')),
  version      TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  data_release TEXT NOT NULL REFERENCES data_release(data_release),
  PRIMARY KEY (kind, version)
) STRICT;

-- F03 engine_release（§6.6）
CREATE TABLE formal.engine_release (
  engine_release_id TEXT NOT NULL PRIMARY KEY,
  version           TEXT NOT NULL,
  data_release      TEXT NOT NULL REFERENCES data_release(data_release)
) STRICT;

-- F04 engine_function / engine_function_source（§6.6；清单 §3.8 Q-10）
CREATE TABLE formal.engine_function (
  engine_release_id TEXT NOT NULL REFERENCES engine_release(engine_release_id),
  calc_function_id  TEXT NOT NULL,
  function_version  TEXT NOT NULL,
  impl_hash         TEXT NOT NULL,
  PRIMARY KEY (engine_release_id, calc_function_id)
) STRICT;
CREATE TABLE formal.engine_function_source (
  engine_release_id TEXT NOT NULL,
  calc_function_id  TEXT NOT NULL,
  path              TEXT NOT NULL,
  file_sha256       TEXT NOT NULL,
  PRIMARY KEY (engine_release_id, calc_function_id, path),
  FOREIGN KEY (engine_release_id, calc_function_id) REFERENCES engine_function(engine_release_id, calc_function_id)
) STRICT;

-- F05 step_code / step_dependency / step_code_retirement（§6.6；清单 §3.8：编号稳定，废止只追加标记）
CREATE TABLE formal.step_code (
  step_code TEXT NOT NULL PRIMARY KEY,
  module    TEXT NOT NULL CONSTRAINT "DB-E-step_code.module" CHECK (module IN ('BAZI','LIUYAO','FENGSHUI','CALENDAR','TEXT')),
  ordinal   INTEGER NOT NULL,
  name      TEXT NOT NULL,
  UNIQUE (module, ordinal)
) STRICT;
CREATE TABLE formal.step_dependency (
  step_code  TEXT NOT NULL REFERENCES step_code(step_code),
  depends_on TEXT NOT NULL REFERENCES step_code(step_code),
  PRIMARY KEY (step_code, depends_on)
) STRICT;
CREATE TABLE formal.step_code_retirement (
  step_code    TEXT NOT NULL PRIMARY KEY REFERENCES step_code(step_code),
  data_release TEXT NOT NULL REFERENCES data_release(data_release)
) STRICT;

-- F06 canonicalization_version（§1.2；清单 §6.2 第 9 条、P-37）
CREATE TABLE formal.canonicalization_version (
  version               TEXT NOT NULL PRIMARY KEY,
  spec_ref              TEXT NOT NULL,
  golden_vectors_sha256 TEXT NOT NULL,
  frozen_at             TEXT NOT NULL
) STRICT;

-- ===================================================================== 文献层
-- F08 source（§2.1；Q-3：v0.1.1 基础书目字段未提供，暂不建，不编造）
CREATE TABLE formal.source (
  source_id                TEXT NOT NULL PRIMARY KEY,
  human_id                 TEXT NOT NULL UNIQUE,
  attribution_status       TEXT NOT NULL CONSTRAINT "DB-E-source.attribution_status" CHECK (attribution_status IN ('确定','存疑','系名')),
  attribution_claim_status TEXT CONSTRAINT "DB-E-source.attribution_claim_status" CHECK (attribution_claim_status IS NULL OR attribution_claim_status IN ('已证实','推断','未知','已证伪'))
) STRICT;

-- F09 edition（§2.2；transcription_status 取值见清单 P-08）
CREATE TABLE formal.edition (
  edition_id           TEXT NOT NULL PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES source(source_id),
  parent_edition_id    TEXT REFERENCES edition(edition_id),
  base_text            TEXT,
  transcription_status TEXT NOT NULL CONSTRAINT "DB-E-edition.transcription_status" CHECK (transcription_status IN ('原刊本','转录本（未与影印本对校）','个人校勘')),
  confidence           TEXT NOT NULL CONSTRAINT "DB-E-edition.confidence" CHECK (confidence IN ('A','B','C')),
  branch_id            TEXT CONSTRAINT "DB-F-03-edition" CHECK (branch_id IS NULL),
  CONSTRAINT "DB-F-04" CHECK (transcription_status <> '转录本（未与影印本对校）' OR confidence <> 'A'),
  CONSTRAINT "DB-F-09-base_text" CHECK (parent_edition_id IS NULL OR base_text IS NOT NULL)
) STRICT;

-- F10 passage（§2.3、§13.7；七项中后五项为条件必须，见 §12.2 查询；Q-7）
CREATE TABLE formal.passage (
  passage_id    TEXT NOT NULL PRIMARY KEY,
  edition_id    TEXT NOT NULL REFERENCES edition(edition_id),
  chapter_label TEXT NOT NULL,
  paragraph_no  INTEGER NOT NULL,
  text          TEXT NOT NULL,
  volume_page   TEXT NOT NULL,
  image_ref     TEXT,
  verified_by   TEXT,
  verified_at   TEXT,
  against_what  TEXT CONSTRAINT "DB-J-against_what" CHECK (against_what IS NULL OR (json_valid(against_what) AND json_type(against_what) = 'object'
                  AND json_extract(against_what, '$.v') = 1 AND json_type(against_what, '$.edition') = 'text' AND json_type(against_what, '$.image') = 'text')),
  result        TEXT CONSTRAINT "DB-E-passage.result" CHECK (result IS NULL OR result IN ('MATCH','MISMATCH','PARTIAL'))
) STRICT;

-- F11 passage_fts（§2.3：FTS5 trigram 外部内容表）
CREATE VIRTUAL TABLE formal.passage_fts USING fts5(text, content='passage', content_rowid='rowid', tokenize='trigram');

-- F12 variant_type（§2.3、A-10）
CREATE TABLE formal.variant_type (
  type_code         TEXT NOT NULL PRIMARY KEY,
  applies_to_domain TEXT NOT NULL,
  label             TEXT NOT NULL
) STRICT;

-- F13 text_variant（§2.3）
CREATE TABLE formal.text_variant (
  variant_id TEXT NOT NULL PRIMARY KEY,
  type_code  TEXT NOT NULL REFERENCES variant_type(type_code),
  passage_a  TEXT REFERENCES passage(passage_id),
  edition_a  TEXT NOT NULL REFERENCES edition(edition_id),
  passage_b  TEXT REFERENCES passage(passage_id),
  edition_b  TEXT NOT NULL REFERENCES edition(edition_id),
  CONSTRAINT "DB-F-13" CHECK (passage_a IS NOT NULL OR passage_b IS NOT NULL)
) STRICT;

-- F15 annotation_layer / annotation（§2.3）
CREATE TABLE formal.annotation_layer (
  layer_code TEXT NOT NULL PRIMARY KEY,
  label      TEXT  -- 清单 F15 只列 layer_code；名称可空
) STRICT;
CREATE TABLE formal.annotation (
  annotation_id TEXT NOT NULL PRIMARY KEY,
  passage_id    TEXT NOT NULL REFERENCES passage(passage_id),
  layer_code    TEXT NOT NULL REFERENCES annotation_layer(layer_code),
  text          TEXT NOT NULL
) STRICT;

-- ===================================================================== 证据层
-- F16 evidence（§2.4；Q-7 origin）
CREATE TABLE formal.evidence (
  evidence_id         TEXT NOT NULL PRIMARY KEY,
  human_id            TEXT NOT NULL UNIQUE,
  evidence_tier       TEXT NOT NULL CONSTRAINT "DB-E-evidence.evidence_tier" CHECK (evidence_tier IN ('E1','E2','E3','E4','E5')),
  evidence_category   TEXT NOT NULL CONSTRAINT "DB-E-evidence.evidence_category" CHECK (evidence_category IN ('C-A','C-B','C-C','C-D','C-E','C-F','C-G')),
  confidence          TEXT NOT NULL CONSTRAINT "DB-E-evidence.confidence" CHECK (confidence IN ('A','B','C')),
  verification_method TEXT,
  missing_evidence    TEXT,
  next_source         TEXT,
  origin              TEXT NOT NULL CONSTRAINT "DB-E-evidence.origin" CHECK (origin IN ('human','ai_output')),
  branch_id           TEXT CONSTRAINT "DB-F-03-evidence" CHECK (branch_id IS NULL)
) STRICT;

-- F17 evidence_passage（§2.4 passage_refs）
CREATE TABLE formal.evidence_passage (
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  passage_id  TEXT NOT NULL REFERENCES passage(passage_id),
  PRIMARY KEY (evidence_id, passage_id)
) STRICT;

-- F19 manual_check_record（§12.2 第 4 条；Q-7）
CREATE TABLE formal.manual_check_record (
  check_id    TEXT NOT NULL PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  checked_by  TEXT NOT NULL,
  checked_at  TEXT NOT NULL,
  page_range  TEXT NOT NULL
) STRICT;

-- ===================================================================== 规则层
-- F30 system_school（§3.5）
CREATE TABLE formal.system_school (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES system_school(id),
  level_note TEXT
) STRICT;

-- F20 rule（§3.1；claim_status、admission_status、formal_status 为派生视图）
CREATE TABLE formal.rule (
  rule_id       TEXT NOT NULL PRIMARY KEY,
  track         TEXT NOT NULL CONSTRAINT "DB-E-rule.track" CHECK (track IN ('A','B','C','D')),
  tier          TEXT NOT NULL CONSTRAINT "DB-E-rule.tier" CHECK (tier IN ('T0','T1','T2')),
  default_scope TEXT NOT NULL CONSTRAINT "DB-E-rule.default_scope" CHECK (default_scope IN ('进默认','多版本','暂缓')),
  system_id     TEXT REFERENCES system_school(id),
  school_id     TEXT REFERENCES system_school(id)
) STRICT;

-- F21 rule_component（§3.2）
CREATE TABLE formal.rule_component (
  component_id         TEXT NOT NULL PRIMARY KEY,
  rule_id              TEXT NOT NULL REFERENCES rule(rule_id),
  evidence_category    TEXT NOT NULL CONSTRAINT "DB-E-rule_component.evidence_category" CHECK (evidence_category IN ('C-A','C-B','C-C','C-D','C-E','C-F','C-G')),
  is_calendar_anchor   INTEGER CONSTRAINT "DB-E-rule_component.is_calendar_anchor" CHECK (is_calendar_anchor IS NULL OR is_calendar_anchor IN (0,1)),
  calc_function_id     TEXT,
  applicability_domain TEXT,
  CONSTRAINT "DB-F-12" CHECK (evidence_category <> 'C-A' OR is_calendar_anchor IS NOT NULL)
) STRICT;

-- F18 evidence_link（§2.5、R-I-4；evidence_role 四值暂按 Q-7）
CREATE TABLE formal.evidence_link (
  evidence_id   TEXT NOT NULL REFERENCES evidence(evidence_id),
  component_id  TEXT NOT NULL REFERENCES rule_component(component_id),
  evidence_role TEXT NOT NULL CONSTRAINT "DB-E-evidence_link.evidence_role" CHECK (evidence_role IN ('支持','反证','限定','异文记录')),
  branch_id     TEXT CONSTRAINT "DB-F-03-evidence_link" CHECK (branch_id IS NULL),
  PRIMARY KEY (evidence_id, component_id, evidence_role)
) STRICT;

-- F14 text_variant_component（§2.3）
CREATE TABLE formal.text_variant_component (
  variant_id   TEXT NOT NULL REFERENCES text_variant(variant_id),
  component_id TEXT NOT NULL REFERENCES rule_component(component_id),
  PRIMARY KEY (variant_id, component_id)
) STRICT;

-- F41 blocker（§9.6；status 为视图）
CREATE TABLE formal.blocker (
  block_id             TEXT NOT NULL PRIMARY KEY,
  source_issue         TEXT NOT NULL,
  blocked_module       TEXT NOT NULL,
  "trigger"            TEXT NOT NULL,
  scope                TEXT NOT NULL CONSTRAINT "DB-E-blocker.scope" CHECK (scope IN ('GLOBAL','MODULE','PATH')),
  scope_path           TEXT NOT NULL,
  blocked_effect       TEXT NOT NULL,
  unblock_condition    TEXT NOT NULL,
  allowed_during_block TEXT NOT NULL,
  state_s1             TEXT NOT NULL,
  state_s2             TEXT NOT NULL,
  state_s3             TEXT NOT NULL,
  b_mapping            TEXT NOT NULL,
  report_ref           TEXT NOT NULL,
  contract_ref         TEXT NOT NULL
) STRICT;

-- F22 component_blocker（§3.2 blocker_refs）
CREATE TABLE formal.component_blocker (
  component_id TEXT NOT NULL REFERENCES rule_component(component_id),
  block_id     TEXT NOT NULL REFERENCES blocker(block_id),
  PRIMARY KEY (component_id, block_id)
) STRICT;

-- F07 blocker_step_map（§6.6；Q-16）
CREATE TABLE formal.blocker_step_map (
  block_id       TEXT NOT NULL REFERENCES blocker(block_id),
  step_code      TEXT NOT NULL REFERENCES step_code(step_code),
  effect         TEXT NOT NULL CONSTRAINT "DB-E-blocker_step_map.effect" CHECK (effect IN ('BLOCKED-HARD','BLOCKED-FORMAL','NON_FORMAL')),
  condition_note TEXT,
  basis_ref      TEXT NOT NULL,
  data_release   TEXT NOT NULL REFERENCES data_release(data_release),
  PRIMARY KEY (block_id, step_code, data_release)
) STRICT;

-- F24 rule_variant（§3.3；不可变；formal_status 由 F37 推出并以 F33 记录转换，二者以 DB-F-24 约束一致）
CREATE TABLE formal.rule_variant (
  rule_variant_id           TEXT NOT NULL PRIMARY KEY,
  component_id              TEXT NOT NULL REFERENCES rule_component(component_id),
  version_no                INTEGER NOT NULL,
  content_hash              TEXT NOT NULL,
  hash_algorithm            TEXT NOT NULL,
  canonicalization_version  TEXT NOT NULL REFERENCES canonicalization_version(version),
  confidence                TEXT NOT NULL CONSTRAINT "DB-E-rule_variant.confidence" CHECK (confidence IN ('A','B','C')),
  school_id                 TEXT REFERENCES system_school(id),
  branch_id                 TEXT CONSTRAINT "DB-F-03-rule_variant" CHECK (branch_id IS NULL),
  non_formal_reason         TEXT CONSTRAINT "DB-E-rule_variant.non_formal_reason" CHECK (non_formal_reason IS NULL OR non_formal_reason IN ('实验规则','个人校勘','未核验','暂缓规则','依赖非正式','其他')),
  experiment_hypothesis     TEXT,
  experiment_status         TEXT,
  experiment_promotion_path TEXT,
  experiment_valid_until    TEXT,
  applicable_from           TEXT,
  applicable_to             TEXT,
  UNIQUE (component_id, version_no),
  CONSTRAINT "DB-F-09c" CHECK (non_formal_reason IS NOT '实验规则' OR (experiment_hypothesis IS NOT NULL AND experiment_status IS NOT NULL
    AND experiment_promotion_path IS NOT NULL AND experiment_valid_until IS NOT NULL))
) STRICT;

-- F25 rule_variant_edition（§3.3 edition_refs）
CREATE TABLE formal.rule_variant_edition (
  rule_variant_id TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  edition_id      TEXT NOT NULL REFERENCES edition(edition_id),
  PRIMARY KEY (rule_variant_id, edition_id)
) STRICT;

-- ===================================================================== 治理层（批准事件：清单 §3.3 乙类）
-- F39 revoke_reason_registry（§8.4、A-13）
CREATE TABLE formal.revoke_reason_registry (
  code  TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL
) STRICT;

-- F40 review_record（§8.1、§8.4；evidence_review 并入，Q-5）
CREATE TABLE formal.review_record (
  review_id     TEXT NOT NULL PRIMARY KEY,
  role          TEXT NOT NULL CONSTRAINT "DB-E-review_record.role" CHECK (role IN ('research','architecture','revocation_trigger')),
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  trigger_type  TEXT,
  source_event  TEXT,
  disposition   TEXT,
  CONSTRAINT "DB-F-21" CHECK (role <> 'revocation_trigger' OR (trigger_type IS NOT NULL AND source_event IS NOT NULL AND disposition IS NOT NULL))
) STRICT;

-- F37 approval_record（§8.2；乙类：批准事件，不适用 previous/new 衔接）
CREATE TABLE formal.approval_record (
  approval_id            TEXT NOT NULL PRIMARY KEY,
  sequence_no            INTEGER NOT NULL UNIQUE,
  target_type            TEXT NOT NULL CONSTRAINT "DB-F-07b" CHECK (target_type = 'rule_variant'),
  target_id              TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  target_content_hash    TEXT NOT NULL,
  data_release           TEXT NOT NULL REFERENCES data_release(data_release),
  decision               TEXT NOT NULL CONSTRAINT "DB-E-approval_record.decision" CHECK (decision IN ('approve','approve_conditional','reject','revoke')),
  decided_by             TEXT NOT NULL CONSTRAINT "DB-F-07a" CHECK (decided_by = 'USER'),
  decided_at             TEXT NOT NULL,
  scope                  TEXT NOT NULL CONSTRAINT "DB-J-scope-approval" CHECK (json_valid(scope) AND json_type(scope) = 'object' AND json_type(scope, '$.v') = 'integer' AND json_extract(scope, '$.v') = 1 AND json_extract(scope, '$.kind') IN ('all','segment')),
  conditions             TEXT CONSTRAINT "DB-J-conditions-approval" CHECK (conditions IS NULL OR (json_valid(conditions) AND json_type(conditions) = 'object' AND json_extract(conditions, '$.v') = 1 AND json_type(conditions, '$.all') = 'array')),
  supersedes_approval_id TEXT REFERENCES approval_record(approval_id),
  CONSTRAINT "DB-F-07-conditions" CHECK (decision <> 'approve_conditional' OR conditions IS NOT NULL)
) STRICT;

-- F38 approval_basis / approval_review / approval_revoke_reason（§8.2、§8.4；子行先写、批准行后写，外键延迟）
CREATE TABLE formal.approval_basis (
  approval_id TEXT NOT NULL REFERENCES approval_record(approval_id) DEFERRABLE INITIALLY DEFERRED,
  basis_ref   TEXT NOT NULL,
  PRIMARY KEY (approval_id, basis_ref)
) STRICT;
CREATE TABLE formal.approval_review (
  approval_id TEXT NOT NULL REFERENCES approval_record(approval_id) DEFERRABLE INITIALLY DEFERRED,
  review_id   TEXT NOT NULL REFERENCES review_record(review_id),
  PRIMARY KEY (approval_id, review_id)
) STRICT;
CREATE TABLE formal.approval_revoke_reason (
  approval_id TEXT NOT NULL REFERENCES approval_record(approval_id) DEFERRABLE INITIALLY DEFERRED,
  reason_code TEXT NOT NULL REFERENCES revoke_reason_registry(code),
  PRIMARY KEY (approval_id, reason_code)
) STRICT;

-- F23 component_default（§3.2、A-9、A-11；丙类：默认配置追加历史）
CREATE TABLE formal.component_default (
  component_id     TEXT NOT NULL REFERENCES rule_component(component_id),
  applicable_scope TEXT NOT NULL CONSTRAINT "DB-J-02-component_default" CHECK (json_valid(applicable_scope) AND json_type(applicable_scope) = 'object'
                     AND json_type(applicable_scope, '$.v') = 'integer' AND json_extract(applicable_scope, '$.v') = 1 AND json_extract(applicable_scope, '$.kind') = 'all'),
  rule_variant_id  TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  approval_ref     TEXT NOT NULL REFERENCES approval_record(approval_id),
  data_release     TEXT NOT NULL REFERENCES data_release(data_release),
  sequence_no      INTEGER NOT NULL UNIQUE,
  CONSTRAINT "DB-F-11b" UNIQUE (component_id, data_release)
) STRICT;

-- F26 variant_supersedes（§3.3、A-11：保留合法分叉，范围可重叠；Q-9）
CREATE TABLE formal.variant_supersedes (
  old_variant_id   TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  new_variant_id   TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  reason           TEXT NOT NULL,
  applicable_scope TEXT NOT NULL CONSTRAINT "DB-J-02-variant_supersedes" CHECK (json_valid(applicable_scope) AND json_type(applicable_scope) = 'object'
                     AND json_type(applicable_scope, '$.v') = 'integer' AND json_extract(applicable_scope, '$.v') = 1 AND json_extract(applicable_scope, '$.kind') IN ('all','segment')),
  approval_ref     TEXT REFERENCES approval_record(approval_id),
  data_release     TEXT NOT NULL REFERENCES data_release(data_release),
  CONSTRAINT "DB-F-10c" UNIQUE (old_variant_id, new_variant_id)
) STRICT;

-- ===================================================================== 参数层
-- F34 parameter_registry（§5.1、N-6；value_to_variant 按 §3.4 用独立表 F27，Q-5）
CREATE TABLE formal.parameter_registry (
  param_id          TEXT NOT NULL PRIMARY KEY,
  registry_origin   TEXT NOT NULL CONSTRAINT "DB-E-parameter_registry.registry_origin" CHECK (registry_origin IN ('第 8 章 §5 表内','补充来源登记')),
  module            TEXT NOT NULL CONSTRAINT "DB-E-parameter_registry.module" CHECK (module IN ('BAZI','LIUYAO','CALENDAR','FENGSHUI','TEXT')),
  value_kind        TEXT NOT NULL CONSTRAINT "DB-E-parameter_registry.value_kind" CHECK (value_kind IN ('enum','numeric','bool')),
  has_default       INTEGER NOT NULL CONSTRAINT "DB-E-parameter_registry.has_default" CHECK (has_default IN (0,1)),
  default_value     TEXT,
  follows_param     TEXT REFERENCES parameter_registry(param_id),
  parent_param      TEXT REFERENCES parameter_registry(param_id),
  first_use_prompt  TEXT,
  registry_status   TEXT NOT NULL CONSTRAINT "DB-E-parameter_registry.registry_status" CHECK (registry_status IN ('ACTIVE','VERSION_LOCKED')),
  locked_value      TEXT,
  registry_version  TEXT NOT NULL,
  CONSTRAINT "DB-F-05a" CHECK (has_default = 1 OR default_value IS NULL),
  CONSTRAINT "DB-F-05d" CHECK (has_default = 0 OR default_value IS NOT NULL OR follows_param IS NOT NULL),
  CONSTRAINT "DB-F-05b" CHECK (registry_status <> 'VERSION_LOCKED' OR locked_value IS NOT NULL),
  CONSTRAINT "DB-F-05c" CHECK (registry_status = 'VERSION_LOCKED' OR locked_value IS NULL),
  CONSTRAINT "DB-F-05e" CHECK (has_default = 1 OR registry_status = 'VERSION_LOCKED' OR first_use_prompt IS NOT NULL)
) STRICT;

-- F35 param_allowed_value（§5.1：每个枚举值写明证据状态）
CREATE TABLE formal.param_allowed_value (
  param_id        TEXT NOT NULL REFERENCES parameter_registry(param_id),
  value           TEXT NOT NULL,
  evidence_status TEXT NOT NULL CONSTRAINT "DB-E-param_allowed_value.evidence_status" CHECK (evidence_status IN ('UNVERIFIED','SINGLE_SOURCE','CROSS_CHECKED','PRIMARY_VERIFIED','DISPUTED','REJECTED')),
  claim_status    TEXT NOT NULL CONSTRAINT "DB-E-param_allowed_value.claim_status" CHECK (claim_status IN ('已证实','推断','未知','已证伪')),
  PRIMARY KEY (param_id, value)
) STRICT;

-- F36 param_dependency（§5.1）
CREATE TABLE formal.param_dependency (
  param_id   TEXT NOT NULL REFERENCES parameter_registry(param_id),
  depends_on TEXT NOT NULL REFERENCES parameter_registry(param_id),
  PRIMARY KEY (param_id, depends_on)
) STRICT;

-- F27 param_variant_map（§3.4；只许 kind = all，Q-9）
CREATE TABLE formal.param_variant_map (
  param_id         TEXT NOT NULL REFERENCES parameter_registry(param_id),
  param_value      TEXT NOT NULL,
  rule_variant_id  TEXT NOT NULL REFERENCES rule_variant(rule_variant_id),
  applicable_scope TEXT NOT NULL CONSTRAINT "DB-J-02-param_variant_map" CHECK (json_valid(applicable_scope) AND json_type(applicable_scope) = 'object'
                     AND json_type(applicable_scope, '$.v') = 'integer' AND json_extract(applicable_scope, '$.v') = 1 AND json_extract(applicable_scope, '$.kind') = 'all'),
  selection_rule   TEXT NOT NULL,
  data_release     TEXT NOT NULL REFERENCES data_release(data_release),
  CONSTRAINT "DB-F-22b" UNIQUE (param_id, param_value, data_release)
) STRICT;

-- ===================================================================== 术语、争议、判断（§3.5）
CREATE TABLE formal.term (
  term_id    TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  system_id  TEXT NOT NULL REFERENCES system_school(id),
  homonym_of TEXT REFERENCES term(term_id)
) STRICT;
CREATE TABLE formal.term_alias (
  term_id TEXT NOT NULL REFERENCES term(term_id),
  alias   TEXT NOT NULL,
  PRIMARY KEY (term_id, alias)
) STRICT;
-- dispute.object_ref 约定：component:<id> / param:<id> / function:<calc_function_id>（E2 实施约定，见验收报告）
CREATE TABLE formal.dispute (
  dispute_id TEXT NOT NULL PRIMARY KEY,
  object_ref TEXT NOT NULL,
  status     TEXT NOT NULL CONSTRAINT "DB-E-dispute.status" CHECK (status IN ('未裁决','已裁决')),
  ruling_ref TEXT,
  CONSTRAINT "DB-F-14-ruling" CHECK (status <> '已裁决' OR ruling_ref IS NOT NULL)
) STRICT;
CREATE TABLE formal.dispute_claim (
  dispute_id  TEXT NOT NULL REFERENCES dispute(dispute_id),
  claim       TEXT NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  PRIMARY KEY (dispute_id, claim)
) STRICT;
CREATE TABLE formal.judgment (
  judgment_id       TEXT NOT NULL PRIMARY KEY,
  conclusion        TEXT NOT NULL,
  basis_evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  actor_role        TEXT NOT NULL,
  decided_at        TEXT NOT NULL
) STRICT;

-- ===================================================================== 状态转换历史（清单 §3.3 甲类；衔接触发器由 gen.ts 生成）
-- F31 evidence_status_history（§4.4、A-7：两维分列）
CREATE TABLE formal.evidence_status_history (
  target_type    TEXT NOT NULL CONSTRAINT "DB-E-evidence_status_history.target_type" CHECK (target_type IN ('Evidence','RuleComponent')),
  target_id      TEXT NOT NULL,
  field          TEXT NOT NULL CONSTRAINT "DB-E-evidence_status_history.field" CHECK (field IN ('evidence_status','claim_status')),
  previous_value TEXT,
  new_value      TEXT NOT NULL,
  data_release   TEXT NOT NULL REFERENCES data_release(data_release),
  sequence_no    INTEGER NOT NULL UNIQUE,
  CONSTRAINT "DB-F-16" CHECK (
    (field = 'evidence_status' AND new_value IN ('UNVERIFIED','SINGLE_SOURCE','CROSS_CHECKED','PRIMARY_VERIFIED','DISPUTED','REJECTED')
      AND (previous_value IS NULL OR previous_value IN ('UNVERIFIED','SINGLE_SOURCE','CROSS_CHECKED','PRIMARY_VERIFIED','DISPUTED','REJECTED')))
    OR (field = 'claim_status' AND new_value IN ('已证实','推断','未知','已证伪')
      AND (previous_value IS NULL OR previous_value IN ('已证实','推断','未知','已证伪'))))
) STRICT;

-- F32 admission_record（§4.4；decided_by 仅用户）
CREATE TABLE formal.admission_record (
  admission_id    TEXT NOT NULL PRIMARY KEY,
  component_id    TEXT NOT NULL REFERENCES rule_component(component_id),
  purpose         TEXT NOT NULL CONSTRAINT "DB-E-admission_record.purpose" CHECK (purpose IN ('calc','text','qualitative')),
  previous_status TEXT CONSTRAINT "DB-E-admission_record.previous_status" CHECK (previous_status IS NULL OR previous_status IN ('FORMAL_ALLOWED','CONDITIONAL','RESEARCH_ONLY','DEFERRED','PROHIBITED')),
  new_status      TEXT NOT NULL CONSTRAINT "DB-E-admission_record.new_status" CHECK (new_status IN ('FORMAL_ALLOWED','CONDITIONAL','RESEARCH_ONLY','DEFERRED','PROHIBITED')),
  conditions      TEXT CONSTRAINT "DB-J-conditions-admission" CHECK (conditions IS NULL OR (json_valid(conditions) AND json_type(conditions) = 'object' AND json_extract(conditions, '$.v') = 1 AND json_type(conditions, '$.all') = 'array')),
  basis_ref       TEXT NOT NULL,
  data_release    TEXT NOT NULL REFERENCES data_release(data_release),
  sequence_no     INTEGER NOT NULL UNIQUE,
  decided_by      TEXT NOT NULL CONSTRAINT "DB-F-07a-admission" CHECK (decided_by = 'USER'),
  CONSTRAINT "DB-F-06" CHECK (new_status <> 'CONDITIONAL' OR conditions IS NOT NULL)
) STRICT;

-- F33 formal_status_history（§4.4：照契约保留 RuleVariant；与 F37 以 DB-F-24 约束一致）
CREATE TABLE formal.formal_status_history (
  target_type    TEXT NOT NULL CONSTRAINT "DB-F-20" CHECK (target_type IN ('Source','Edition','Evidence','RuleVariant')),
  target_id      TEXT NOT NULL,
  previous_value TEXT CONSTRAINT "DB-E-formal_status_history.previous_value" CHECK (previous_value IS NULL OR previous_value IN ('FORMAL','NON_FORMAL')),
  new_value      TEXT NOT NULL CONSTRAINT "DB-E-formal_status_history.new_value" CHECK (new_value IN ('FORMAL','NON_FORMAL')),
  data_release   TEXT NOT NULL REFERENCES data_release(data_release),
  sequence_no    INTEGER NOT NULL UNIQUE
) STRICT;

-- F42 blocker_change（§9.6、§8.5：须附用户裁决引用）
CREATE TABLE formal.blocker_change (
  change_id       TEXT NOT NULL PRIMARY KEY,
  block_id        TEXT NOT NULL REFERENCES blocker(block_id),
  previous_status TEXT CONSTRAINT "DB-E-blocker_change.previous_status" CHECK (previous_status IS NULL OR previous_status IN ('现行','已解除')),
  new_status      TEXT NOT NULL CONSTRAINT "DB-E-blocker_change.new_status" CHECK (new_status IN ('现行','已解除')),
  user_ruling_ref TEXT NOT NULL,
  data_release    TEXT NOT NULL REFERENCES data_release(data_release),
  sequence_no     INTEGER NOT NULL UNIQUE
) STRICT;

-- ===================================================================== 行级触发器（同库可见；清单 §3.10）
-- FTS 同步（只追加：只需插入）
CREATE TRIGGER formal.passage_fts_ai AFTER INSERT ON passage BEGIN
  INSERT INTO passage_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
END;

-- DB-F-09a/b：同一子项 version_no 严格递增
CREATE TRIGGER formal.rule_variant_version_bi BEFORE INSERT ON rule_variant BEGIN
  SELECT RAISE(ABORT, '[DB-F-09a] 同一子项 version_no 重复')
    WHERE EXISTS (SELECT 1 FROM rule_variant WHERE component_id = NEW.component_id AND version_no = NEW.version_no);
  SELECT RAISE(ABORT, '[DB-F-09b] 同一子项 version_no 未递增')
    WHERE EXISTS (SELECT 1 FROM rule_variant WHERE component_id = NEW.component_id AND version_no > NEW.version_no);
END;

-- DB-F-10a：替代关系新旧须同属一个子项
CREATE TRIGGER formal.variant_supersedes_bi BEFORE INSERT ON variant_supersedes BEGIN
  SELECT RAISE(ABORT, '[DB-F-10c] 同一新旧变体对重复登记')
    WHERE EXISTS (SELECT 1 FROM variant_supersedes WHERE old_variant_id = NEW.old_variant_id AND new_variant_id = NEW.new_variant_id);
  SELECT RAISE(ABORT, '[DB-F-10a] 替代关系新旧变体不属同一子项')
    WHERE (SELECT component_id FROM rule_variant WHERE rule_variant_id = NEW.old_variant_id)
       IS NOT (SELECT component_id FROM rule_variant WHERE rule_variant_id = NEW.new_variant_id);
END;

-- 乙类批准事件：子行先写（DB-F-07c、basis 至少一行）；supersedes 同 target 较早（DB-Q-07）
CREATE TRIGGER formal.approval_record_bi BEFORE INSERT ON approval_record BEGIN
  SELECT RAISE(ABORT, '[DB-F-07d] 批准缺依据（approval_basis 须先写入）')
    WHERE NOT EXISTS (SELECT 1 FROM approval_basis WHERE approval_id = NEW.approval_id);
  SELECT RAISE(ABORT, '[DB-F-07c] revoke 缺撤销原因（approval_revoke_reason 须先写入）')
    WHERE NEW.decision = 'revoke' AND NOT EXISTS (SELECT 1 FROM approval_revoke_reason WHERE approval_id = NEW.approval_id);
  SELECT RAISE(ABORT, '[DB-Q-07] supersedes_approval_id 须指向同一 target 的较早记录')
    WHERE NEW.supersedes_approval_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM approval_record a WHERE a.approval_id = NEW.supersedes_approval_id AND a.target_id = NEW.target_id AND a.sequence_no < NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-F-08a][DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM approval_record WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-F-08b][DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM approval_record WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退')
    WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
          (SELECT max(d.release_seq) FROM approval_record a JOIN data_release d ON d.data_release = a.data_release WHERE a.target_id = NEW.target_id);
END;
CREATE TRIGGER formal.approval_basis_bi BEFORE INSERT ON approval_basis BEGIN
  SELECT RAISE(ABORT, '[DB-R-02] 批准已写入，不得追加依据') WHERE EXISTS (SELECT 1 FROM approval_record WHERE approval_id = NEW.approval_id);
END;
CREATE TRIGGER formal.approval_review_bi BEFORE INSERT ON approval_review BEGIN
  SELECT RAISE(ABORT, '[DB-R-02] 批准已写入，不得追加审查引用') WHERE EXISTS (SELECT 1 FROM approval_record WHERE approval_id = NEW.approval_id);
END;
CREATE TRIGGER formal.approval_revoke_reason_bi BEFORE INSERT ON approval_revoke_reason BEGIN
  SELECT RAISE(ABORT, '[DB-R-02] 批准已写入，不得追加撤销原因') WHERE EXISTS (SELECT 1 FROM approval_record WHERE approval_id = NEW.approval_id);
END;

-- 丙类默认配置：变体同属子项（DB-F-11a）；须引用该变体的现行批准（DB-Q-08）；序号（DB-Q-03/04）
-- UNIQUE 冲突的报错不带约束名，另以触发器给出定位编号（唯一约束保留为兜底）
CREATE TRIGGER formal.param_variant_map_bi BEFORE INSERT ON param_variant_map BEGIN
  SELECT RAISE(ABORT, '[DB-F-22b] 同参数同取值同数据版本只许一条映射')
    WHERE EXISTS (SELECT 1 FROM param_variant_map WHERE param_id = NEW.param_id AND param_value = NEW.param_value AND data_release = NEW.data_release);
END;
CREATE TRIGGER formal.component_default_bi BEFORE INSERT ON component_default BEGIN
  SELECT RAISE(ABORT, '[DB-F-11a] 默认变体不属该子项')
    WHERE (SELECT component_id FROM rule_variant WHERE rule_variant_id = NEW.rule_variant_id) IS NOT NEW.component_id;
  SELECT RAISE(ABORT, '[DB-F-11b] 同一子项同一数据版本只许一条默认')
    WHERE EXISTS (SELECT 1 FROM component_default WHERE component_id = NEW.component_id AND data_release = NEW.data_release);
  SELECT RAISE(ABORT, '[DB-Q-08] approval_ref 须为该变体的现行批准（最新一条、decision = approve、哈希一致）')
    WHERE NOT EXISTS (
      SELECT 1 FROM approval_record a JOIN rule_variant v ON v.rule_variant_id = a.target_id
      WHERE a.approval_id = NEW.approval_ref AND a.target_id = NEW.rule_variant_id AND a.decision = 'approve'
        AND a.target_content_hash = v.content_hash
        AND a.sequence_no = (SELECT max(sequence_no) FROM approval_record WHERE target_id = NEW.rule_variant_id));
  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM component_default WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM component_default WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退')
    WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
          (SELECT max(d.release_seq) FROM component_default c JOIN data_release d ON d.data_release = c.data_release WHERE c.component_id = NEW.component_id);
END;

-- 变体类型、撤销原因注册表：类型码不删不改义（只读触发器由 gen.ts 统一生成）

-- ===================================================================== 视图（同库）
-- 当前状态：各键 sequence_no 最大者（清单 §3.3）
CREATE VIEW formal.v_evidence_status_current AS
  SELECT h.target_type, h.target_id, h.field, h.new_value AS value, h.data_release, h.sequence_no
  FROM evidence_status_history h
  WHERE h.sequence_no = (SELECT max(sequence_no) FROM evidence_status_history x
                         WHERE x.target_type = h.target_type AND x.target_id = h.target_id AND x.field = h.field);
CREATE VIEW formal.v_formal_status_current AS
  SELECT h.target_type, h.target_id, h.new_value AS value, h.data_release, h.sequence_no
  FROM formal_status_history h
  WHERE h.sequence_no = (SELECT max(sequence_no) FROM formal_status_history x WHERE x.target_type = h.target_type AND x.target_id = h.target_id);
CREATE VIEW formal.v_evidence_current AS
  SELECT e.evidence_id,
    (SELECT value FROM v_evidence_status_current s WHERE s.target_type = 'Evidence' AND s.target_id = e.evidence_id AND s.field = 'evidence_status') AS evidence_status,
    (SELECT value FROM v_evidence_status_current s WHERE s.target_type = 'Evidence' AND s.target_id = e.evidence_id AND s.field = 'claim_status') AS claim_status,
    (SELECT value FROM v_formal_status_current f WHERE f.target_type = 'Evidence' AND f.target_id = e.evidence_id) AS formal_status
  FROM evidence e;
CREATE VIEW formal.v_admission_current AS
  SELECT a.component_id, a.purpose, a.new_status AS status, a.conditions, a.data_release, a.sequence_no
  FROM admission_record a
  WHERE a.sequence_no = (SELECT max(sequence_no) FROM admission_record x WHERE x.component_id = a.component_id AND x.purpose = a.purpose);
CREATE VIEW formal.v_component_current AS
  SELECT c.component_id, c.rule_id,
    (SELECT value FROM v_evidence_status_current s WHERE s.target_type = 'RuleComponent' AND s.target_id = c.component_id AND s.field = 'claim_status') AS claim_status,
    (SELECT status FROM v_admission_current a WHERE a.component_id = c.component_id AND a.purpose = 'calc') AS admission_calc,
    (SELECT status FROM v_admission_current a WHERE a.component_id = c.component_id AND a.purpose = 'text') AS admission_text,
    (SELECT status FROM v_admission_current a WHERE a.component_id = c.component_id AND a.purpose = 'qualitative') AS admission_qualitative
  FROM rule_component c;
CREATE VIEW formal.v_rule_aggregate AS
  SELECT r.rule_id,
    CASE WHEN count(DISTINCT cc.claim_status) > 1 THEN 'MIXED' ELSE max(cc.claim_status) END AS claim_status,
    group_concat(cc.component_id || ':' || coalesce(cc.admission_calc, '无记录'), ',') AS admission_status
  FROM rule r LEFT JOIN v_component_current cc ON cc.rule_id = r.rule_id
  GROUP BY r.rule_id;
-- 现行批准（§8.2；R-E4：附条件批准不构成现行批准，确认记录即新的 approve）
CREATE VIEW formal.v_current_approval AS
  SELECT a.* FROM approval_record a
  WHERE a.sequence_no = (SELECT max(sequence_no) FROM approval_record x WHERE x.target_id = a.target_id);
CREATE VIEW formal.v_variant_formal AS
  SELECT v.rule_variant_id, v.component_id,
    CASE WHEN a.decision = 'approve' AND a.target_content_hash = v.content_hash THEN 'FORMAL' ELSE 'NON_FORMAL' END AS formal_status,
    a.approval_id AS current_approval_id
  FROM rule_variant v LEFT JOIN v_current_approval a ON a.target_id = v.rule_variant_id;
CREATE VIEW formal.v_current_default AS
  SELECT d.* FROM component_default d
  WHERE d.sequence_no = (SELECT max(sequence_no) FROM component_default x WHERE x.component_id = d.component_id);
CREATE VIEW formal.v_blocker_current AS
  SELECT b.block_id, b.scope,
    coalesce((SELECT c.new_status FROM blocker_change c WHERE c.block_id = b.block_id ORDER BY c.sequence_no DESC LIMIT 1), '无记录') AS status
  FROM blocker b;
-- 治理索引（§8.5）：由权威记录生成，不设可写表
CREATE VIEW formal.v_governance_record AS
  SELECT 'evidence_status_history' AS source_table, target_type || ':' || target_id || ':' || field || ':' || sequence_no AS source_id,
         target_type || ':' || target_id AS object, previous_value AS previous_state, new_value AS new_state, data_release FROM evidence_status_history
  UNION ALL SELECT 'admission_record', admission_id, 'RuleComponent:' || component_id || ':' || purpose, previous_status, new_status, data_release FROM admission_record
  UNION ALL SELECT 'approval_record', approval_id, 'RuleVariant:' || target_id, NULL, decision, data_release FROM approval_record
  UNION ALL SELECT 'component_default', component_id || ':' || sequence_no, 'RuleComponent:' || component_id, NULL, rule_variant_id, data_release FROM component_default
  UNION ALL SELECT 'blocker_change', change_id, 'Blocker:' || block_id, previous_status, new_status, data_release FROM blocker_change
  UNION ALL SELECT 'review_record', review_id, target_type || ':' || target_id, NULL, role, NULL FROM review_record
  UNION ALL SELECT 'dispute', dispute_id, object_ref, NULL, status, NULL FROM dispute;

-- ===================================================================== 生成：甲类状态转换历史（清单 §3.3）
CREATE TRIGGER formal.evidence_status_history_seq_bi BEFORE INSERT ON evidence_status_history BEGIN
  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM evidence_status_history WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM evidence_status_history WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-01] 该键首条记录的 previous 须为空') WHERE NEW.previous_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id AND t.field = NEW.field);
  SELECT RAISE(ABORT, '[DB-Q-02] previous 须等于同键上一条的 new') WHERE EXISTS (SELECT 1 FROM evidence_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id AND t.field = NEW.field)
    AND NEW.previous_value IS NOT (SELECT t.new_value FROM evidence_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id AND t.field = NEW.field ORDER BY t.sequence_no DESC LIMIT 1);
  SELECT RAISE(ABORT, '[DB-Q-09] previous = new 的无转换行') WHERE NEW.previous_value IS NEW.new_value;
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退') WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
    (SELECT max(d.release_seq) FROM evidence_status_history t JOIN data_release d ON d.data_release = t.data_release WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id AND t.field = NEW.field);
END;
CREATE TRIGGER formal.admission_record_seq_bi BEFORE INSERT ON admission_record BEGIN
  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM admission_record WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM admission_record WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-01] 该键首条记录的 previous 须为空') WHERE NEW.previous_status IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admission_record t WHERE t.component_id = NEW.component_id AND t.purpose = NEW.purpose);
  SELECT RAISE(ABORT, '[DB-Q-02] previous 须等于同键上一条的 new') WHERE EXISTS (SELECT 1 FROM admission_record t WHERE t.component_id = NEW.component_id AND t.purpose = NEW.purpose)
    AND NEW.previous_status IS NOT (SELECT t.new_status FROM admission_record t WHERE t.component_id = NEW.component_id AND t.purpose = NEW.purpose ORDER BY t.sequence_no DESC LIMIT 1);
  SELECT RAISE(ABORT, '[DB-Q-09] previous = new 的无转换行') WHERE NEW.previous_status IS NEW.new_status;
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退') WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
    (SELECT max(d.release_seq) FROM admission_record t JOIN data_release d ON d.data_release = t.data_release WHERE t.component_id = NEW.component_id AND t.purpose = NEW.purpose);
END;
CREATE TRIGGER formal.formal_status_history_seq_bi BEFORE INSERT ON formal_status_history BEGIN
  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM formal_status_history WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM formal_status_history WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-01] 该键首条记录的 previous 须为空') WHERE NEW.previous_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM formal_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id);
  SELECT RAISE(ABORT, '[DB-Q-02] previous 须等于同键上一条的 new') WHERE EXISTS (SELECT 1 FROM formal_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id)
    AND NEW.previous_value IS NOT (SELECT t.new_value FROM formal_status_history t WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id ORDER BY t.sequence_no DESC LIMIT 1);
  SELECT RAISE(ABORT, '[DB-Q-09] previous = new 的无转换行') WHERE NEW.previous_value IS NEW.new_value;
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退') WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
    (SELECT max(d.release_seq) FROM formal_status_history t JOIN data_release d ON d.data_release = t.data_release WHERE t.target_type = NEW.target_type AND t.target_id = NEW.target_id);
END;
CREATE TRIGGER formal.blocker_change_seq_bi BEFORE INSERT ON blocker_change BEGIN
  SELECT RAISE(ABORT, '[DB-Q-03] sequence_no 重复') WHERE EXISTS (SELECT 1 FROM blocker_change WHERE sequence_no = NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-04] sequence_no 未递增') WHERE EXISTS (SELECT 1 FROM blocker_change WHERE sequence_no > NEW.sequence_no);
  SELECT RAISE(ABORT, '[DB-Q-01] 该键首条记录的 previous 须为空') WHERE NEW.previous_status IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blocker_change t WHERE t.block_id = NEW.block_id);
  SELECT RAISE(ABORT, '[DB-Q-02] previous 须等于同键上一条的 new') WHERE EXISTS (SELECT 1 FROM blocker_change t WHERE t.block_id = NEW.block_id)
    AND NEW.previous_status IS NOT (SELECT t.new_status FROM blocker_change t WHERE t.block_id = NEW.block_id ORDER BY t.sequence_no DESC LIMIT 1);
  SELECT RAISE(ABORT, '[DB-Q-09] previous = new 的无转换行') WHERE NEW.previous_status IS NEW.new_status;
  SELECT RAISE(ABORT, '[DB-Q-05] data_release 倒退') WHERE (SELECT release_seq FROM data_release WHERE data_release = NEW.data_release) <
    (SELECT max(d.release_seq) FROM blocker_change t JOIN data_release d ON d.data_release = t.data_release WHERE t.block_id = NEW.block_id);
END;

-- ===================================================================== 生成：结构化 JSON 列（清单 §3.9）
CREATE TRIGGER formal.component_default_applicable_scope_json_bi BEFORE INSERT ON component_default WHEN NEW.applicable_scope IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] component_default.applicable_scope 不是合法 JSON') WHERE NOT json_valid(NEW.applicable_scope);
  SELECT RAISE(ABORT, '[DB-J-05] component_default.applicable_scope 顶层须为对象') WHERE json_type(NEW.applicable_scope) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] component_default.applicable_scope 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.applicable_scope, '$.v') IS NOT 'integer' OR json_extract(NEW.applicable_scope, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-02] component_default.applicable_scope 的 kind 只许 all') WHERE json_type(NEW.applicable_scope, '$.kind') IS NOT 'text' OR json_extract(NEW.applicable_scope, '$.kind') NOT IN ('all');
  SELECT RAISE(ABORT, '[DB-J-04] component_default.applicable_scope 含未知键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.applicable_scope) e WHERE
    (json_extract(NEW.applicable_scope, '$.kind') = 'all' AND e.key NOT IN ('v', 'kind')) OR (json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND e.key NOT IN ('v', 'kind', 'module', 'school_id', 'edition_id', 'from', 'to')));
  SELECT RAISE(ABORT, '[DB-J-07] component_default.applicable_scope 分段范围不合规（module 必填；from、to 为 YYYY-MM-DD 且 from ≤ to；school_id、edition_id 为文本）') WHERE json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND (
    json_type(NEW.applicable_scope, '$.module') IS NOT 'text'
    OR (json_type(NEW.applicable_scope, '$.school_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.school_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.edition_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.edition_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.from') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.from') <> 'text' OR json_extract(NEW.applicable_scope, '$.from') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.to') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.to') <> 'text' OR json_extract(NEW.applicable_scope, '$.to') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.from') = 'text' AND json_type(NEW.applicable_scope, '$.to') = 'text' AND json_extract(NEW.applicable_scope, '$.from') > json_extract(NEW.applicable_scope, '$.to')));
END;
CREATE TRIGGER formal.param_variant_map_applicable_scope_json_bi BEFORE INSERT ON param_variant_map WHEN NEW.applicable_scope IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] param_variant_map.applicable_scope 不是合法 JSON') WHERE NOT json_valid(NEW.applicable_scope);
  SELECT RAISE(ABORT, '[DB-J-05] param_variant_map.applicable_scope 顶层须为对象') WHERE json_type(NEW.applicable_scope) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] param_variant_map.applicable_scope 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.applicable_scope, '$.v') IS NOT 'integer' OR json_extract(NEW.applicable_scope, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-02] param_variant_map.applicable_scope 的 kind 只许 all') WHERE json_type(NEW.applicable_scope, '$.kind') IS NOT 'text' OR json_extract(NEW.applicable_scope, '$.kind') NOT IN ('all');
  SELECT RAISE(ABORT, '[DB-J-04] param_variant_map.applicable_scope 含未知键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.applicable_scope) e WHERE
    (json_extract(NEW.applicable_scope, '$.kind') = 'all' AND e.key NOT IN ('v', 'kind')) OR (json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND e.key NOT IN ('v', 'kind', 'module', 'school_id', 'edition_id', 'from', 'to')));
  SELECT RAISE(ABORT, '[DB-J-07] param_variant_map.applicable_scope 分段范围不合规（module 必填；from、to 为 YYYY-MM-DD 且 from ≤ to；school_id、edition_id 为文本）') WHERE json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND (
    json_type(NEW.applicable_scope, '$.module') IS NOT 'text'
    OR (json_type(NEW.applicable_scope, '$.school_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.school_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.edition_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.edition_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.from') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.from') <> 'text' OR json_extract(NEW.applicable_scope, '$.from') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.to') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.to') <> 'text' OR json_extract(NEW.applicable_scope, '$.to') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.from') = 'text' AND json_type(NEW.applicable_scope, '$.to') = 'text' AND json_extract(NEW.applicable_scope, '$.from') > json_extract(NEW.applicable_scope, '$.to')));
END;
CREATE TRIGGER formal.variant_supersedes_applicable_scope_json_bi BEFORE INSERT ON variant_supersedes WHEN NEW.applicable_scope IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] variant_supersedes.applicable_scope 不是合法 JSON') WHERE NOT json_valid(NEW.applicable_scope);
  SELECT RAISE(ABORT, '[DB-J-05] variant_supersedes.applicable_scope 顶层须为对象') WHERE json_type(NEW.applicable_scope) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] variant_supersedes.applicable_scope 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.applicable_scope, '$.v') IS NOT 'integer' OR json_extract(NEW.applicable_scope, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-02] variant_supersedes.applicable_scope 的 kind 只许 all / segment') WHERE json_type(NEW.applicable_scope, '$.kind') IS NOT 'text' OR json_extract(NEW.applicable_scope, '$.kind') NOT IN ('all', 'segment');
  SELECT RAISE(ABORT, '[DB-J-04] variant_supersedes.applicable_scope 含未知键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.applicable_scope) e WHERE
    (json_extract(NEW.applicable_scope, '$.kind') = 'all' AND e.key NOT IN ('v', 'kind')) OR (json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND e.key NOT IN ('v', 'kind', 'module', 'school_id', 'edition_id', 'from', 'to')));
  SELECT RAISE(ABORT, '[DB-J-07] variant_supersedes.applicable_scope 分段范围不合规（module 必填；from、to 为 YYYY-MM-DD 且 from ≤ to；school_id、edition_id 为文本）') WHERE json_extract(NEW.applicable_scope, '$.kind') = 'segment' AND (
    json_type(NEW.applicable_scope, '$.module') IS NOT 'text'
    OR (json_type(NEW.applicable_scope, '$.school_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.school_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.edition_id') IS NOT NULL AND json_type(NEW.applicable_scope, '$.edition_id') <> 'text')
    OR (json_type(NEW.applicable_scope, '$.from') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.from') <> 'text' OR json_extract(NEW.applicable_scope, '$.from') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.to') IS NOT NULL AND (json_type(NEW.applicable_scope, '$.to') <> 'text' OR json_extract(NEW.applicable_scope, '$.to') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.applicable_scope, '$.from') = 'text' AND json_type(NEW.applicable_scope, '$.to') = 'text' AND json_extract(NEW.applicable_scope, '$.from') > json_extract(NEW.applicable_scope, '$.to')));
END;
CREATE TRIGGER formal.approval_record_scope_json_bi BEFORE INSERT ON approval_record WHEN NEW.scope IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] approval_record.scope 不是合法 JSON') WHERE NOT json_valid(NEW.scope);
  SELECT RAISE(ABORT, '[DB-J-05] approval_record.scope 顶层须为对象') WHERE json_type(NEW.scope) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] approval_record.scope 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.scope, '$.v') IS NOT 'integer' OR json_extract(NEW.scope, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-02] approval_record.scope 的 kind 只许 all / segment') WHERE json_type(NEW.scope, '$.kind') IS NOT 'text' OR json_extract(NEW.scope, '$.kind') NOT IN ('all', 'segment');
  SELECT RAISE(ABORT, '[DB-J-04] approval_record.scope 含未知键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.scope) e WHERE
    (json_extract(NEW.scope, '$.kind') = 'all' AND e.key NOT IN ('v', 'kind')) OR (json_extract(NEW.scope, '$.kind') = 'segment' AND e.key NOT IN ('v', 'kind', 'module', 'school_id', 'edition_id', 'from', 'to')));
  SELECT RAISE(ABORT, '[DB-J-07] approval_record.scope 分段范围不合规（module 必填；from、to 为 YYYY-MM-DD 且 from ≤ to；school_id、edition_id 为文本）') WHERE json_extract(NEW.scope, '$.kind') = 'segment' AND (
    json_type(NEW.scope, '$.module') IS NOT 'text'
    OR (json_type(NEW.scope, '$.school_id') IS NOT NULL AND json_type(NEW.scope, '$.school_id') <> 'text')
    OR (json_type(NEW.scope, '$.edition_id') IS NOT NULL AND json_type(NEW.scope, '$.edition_id') <> 'text')
    OR (json_type(NEW.scope, '$.from') IS NOT NULL AND (json_type(NEW.scope, '$.from') <> 'text' OR json_extract(NEW.scope, '$.from') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.scope, '$.to') IS NOT NULL AND (json_type(NEW.scope, '$.to') <> 'text' OR json_extract(NEW.scope, '$.to') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
    OR (json_type(NEW.scope, '$.from') = 'text' AND json_type(NEW.scope, '$.to') = 'text' AND json_extract(NEW.scope, '$.from') > json_extract(NEW.scope, '$.to')));
END;
CREATE TRIGGER formal.approval_record_conditions_json_bi BEFORE INSERT ON approval_record WHEN NEW.conditions IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] approval_record.conditions 不是合法 JSON') WHERE NOT json_valid(NEW.conditions);
  SELECT RAISE(ABORT, '[DB-J-05] approval_record.conditions 顶层须为对象') WHERE json_type(NEW.conditions) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] approval_record.conditions 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.conditions, '$.v') IS NOT 'integer' OR json_extract(NEW.conditions, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-04] approval_record.conditions 结构不合规（只许 v、all；all 为数组；每项只许 op、param、value；op 只许 param_selected、param_equals）') WHERE
    EXISTS (SELECT 1 FROM json_each(NEW.conditions) e WHERE e.key NOT IN ('v', 'all')) OR json_type(NEW.conditions, '$.all') IS NOT 'array'
    OR EXISTS (SELECT 1 FROM json_each(NEW.conditions, '$.all') i WHERE i.type <> 'object'
      OR json_extract(i.value, '$.op') IS NULL OR json_extract(i.value, '$.op') NOT IN ('param_selected', 'param_equals')
      OR json_type(i.value, '$.param') IS NOT 'text'
      OR (json_extract(i.value, '$.op') = 'param_equals' AND json_type(i.value, '$.value') IS NOT 'text')
      OR (json_extract(i.value, '$.op') = 'param_selected' AND json_type(i.value, '$.value') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM json_each(i.value) k WHERE k.key NOT IN ('op', 'param', 'value')));
END;
CREATE TRIGGER formal.admission_record_conditions_json_bi BEFORE INSERT ON admission_record WHEN NEW.conditions IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] admission_record.conditions 不是合法 JSON') WHERE NOT json_valid(NEW.conditions);
  SELECT RAISE(ABORT, '[DB-J-05] admission_record.conditions 顶层须为对象') WHERE json_type(NEW.conditions) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] admission_record.conditions 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.conditions, '$.v') IS NOT 'integer' OR json_extract(NEW.conditions, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-04] admission_record.conditions 结构不合规（只许 v、all；all 为数组；每项只许 op、param、value；op 只许 param_selected、param_equals）') WHERE
    EXISTS (SELECT 1 FROM json_each(NEW.conditions) e WHERE e.key NOT IN ('v', 'all')) OR json_type(NEW.conditions, '$.all') IS NOT 'array'
    OR EXISTS (SELECT 1 FROM json_each(NEW.conditions, '$.all') i WHERE i.type <> 'object'
      OR json_extract(i.value, '$.op') IS NULL OR json_extract(i.value, '$.op') NOT IN ('param_selected', 'param_equals')
      OR json_type(i.value, '$.param') IS NOT 'text'
      OR (json_extract(i.value, '$.op') = 'param_equals' AND json_type(i.value, '$.value') IS NOT 'text')
      OR (json_extract(i.value, '$.op') = 'param_selected' AND json_type(i.value, '$.value') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM json_each(i.value) k WHERE k.key NOT IN ('op', 'param', 'value')));
END;
CREATE TRIGGER formal.passage_against_what_json_bi BEFORE INSERT ON passage WHEN NEW.against_what IS NOT NULL BEGIN
  SELECT RAISE(ABORT, '[DB-J-01] passage.against_what 不是合法 JSON') WHERE NOT json_valid(NEW.against_what);
  SELECT RAISE(ABORT, '[DB-J-05] passage.against_what 顶层须为对象') WHERE json_type(NEW.against_what) <> 'object';
  SELECT RAISE(ABORT, '[DB-J-03] passage.against_what 缺整数结构版本 v 或 v ≠ 1') WHERE json_type(NEW.against_what, '$.v') IS NOT 'integer' OR json_extract(NEW.against_what, '$.v') <> 1;
  SELECT RAISE(ABORT, '[DB-J-04] passage.against_what 含该结构版本未定义的顶层键') WHERE EXISTS (SELECT 1 FROM json_each(NEW.against_what) e WHERE e.key NOT IN ('v', 'edition', 'image'));
END;

-- ===================================================================== 生成：正式库只读、只追加（DB-I；§1.2、§1.1 第 5 条）
CREATE TRIGGER formal.data_release_no_update BEFORE UPDATE ON data_release BEGIN SELECT RAISE(ABORT, '[DB-I-data_release] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.data_release_no_delete BEFORE DELETE ON data_release BEGIN SELECT RAISE(ABORT, '[DB-I-data_release] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.data_version_no_update BEFORE UPDATE ON data_version BEGIN SELECT RAISE(ABORT, '[DB-I-data_version] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.data_version_no_delete BEFORE DELETE ON data_version BEGIN SELECT RAISE(ABORT, '[DB-I-data_version] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.engine_release_no_update BEFORE UPDATE ON engine_release BEGIN SELECT RAISE(ABORT, '[DB-I-engine_release] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.engine_release_no_delete BEFORE DELETE ON engine_release BEGIN SELECT RAISE(ABORT, '[DB-I-engine_release] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.engine_function_no_update BEFORE UPDATE ON engine_function BEGIN SELECT RAISE(ABORT, '[DB-I-engine_function] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.engine_function_no_delete BEFORE DELETE ON engine_function BEGIN SELECT RAISE(ABORT, '[DB-I-engine_function] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.engine_function_source_no_update BEFORE UPDATE ON engine_function_source BEGIN SELECT RAISE(ABORT, '[DB-I-engine_function_source] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.engine_function_source_no_delete BEFORE DELETE ON engine_function_source BEGIN SELECT RAISE(ABORT, '[DB-I-engine_function_source] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.step_code_no_update BEFORE UPDATE ON step_code BEGIN SELECT RAISE(ABORT, '[DB-I-step_code] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.step_code_no_delete BEFORE DELETE ON step_code BEGIN SELECT RAISE(ABORT, '[DB-I-step_code] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.step_dependency_no_update BEFORE UPDATE ON step_dependency BEGIN SELECT RAISE(ABORT, '[DB-I-step_dependency] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.step_dependency_no_delete BEFORE DELETE ON step_dependency BEGIN SELECT RAISE(ABORT, '[DB-I-step_dependency] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.step_code_retirement_no_update BEFORE UPDATE ON step_code_retirement BEGIN SELECT RAISE(ABORT, '[DB-I-step_code_retirement] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.step_code_retirement_no_delete BEFORE DELETE ON step_code_retirement BEGIN SELECT RAISE(ABORT, '[DB-I-step_code_retirement] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.canonicalization_version_no_update BEFORE UPDATE ON canonicalization_version BEGIN SELECT RAISE(ABORT, '[DB-I-canonicalization_version] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.canonicalization_version_no_delete BEFORE DELETE ON canonicalization_version BEGIN SELECT RAISE(ABORT, '[DB-I-canonicalization_version] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.source_no_update BEFORE UPDATE ON source BEGIN SELECT RAISE(ABORT, '[DB-I-source] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.source_no_delete BEFORE DELETE ON source BEGIN SELECT RAISE(ABORT, '[DB-I-source] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.edition_no_update BEFORE UPDATE ON edition BEGIN SELECT RAISE(ABORT, '[DB-I-edition] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.edition_no_delete BEFORE DELETE ON edition BEGIN SELECT RAISE(ABORT, '[DB-I-edition] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.passage_no_update BEFORE UPDATE ON passage BEGIN SELECT RAISE(ABORT, '[DB-I-passage] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.passage_no_delete BEFORE DELETE ON passage BEGIN SELECT RAISE(ABORT, '[DB-I-passage] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.variant_type_no_update BEFORE UPDATE ON variant_type BEGIN SELECT RAISE(ABORT, '[DB-I-variant_type] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.variant_type_no_delete BEFORE DELETE ON variant_type BEGIN SELECT RAISE(ABORT, '[DB-I-variant_type] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.text_variant_no_update BEFORE UPDATE ON text_variant BEGIN SELECT RAISE(ABORT, '[DB-I-text_variant] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.text_variant_no_delete BEFORE DELETE ON text_variant BEGIN SELECT RAISE(ABORT, '[DB-I-text_variant] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.annotation_layer_no_update BEFORE UPDATE ON annotation_layer BEGIN SELECT RAISE(ABORT, '[DB-I-annotation_layer] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.annotation_layer_no_delete BEFORE DELETE ON annotation_layer BEGIN SELECT RAISE(ABORT, '[DB-I-annotation_layer] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.annotation_no_update BEFORE UPDATE ON annotation BEGIN SELECT RAISE(ABORT, '[DB-I-annotation] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.annotation_no_delete BEFORE DELETE ON annotation BEGIN SELECT RAISE(ABORT, '[DB-I-annotation] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.evidence_no_update BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, '[DB-I-evidence] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, '[DB-I-evidence] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.evidence_passage_no_update BEFORE UPDATE ON evidence_passage BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_passage] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.evidence_passage_no_delete BEFORE DELETE ON evidence_passage BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_passage] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.manual_check_record_no_update BEFORE UPDATE ON manual_check_record BEGIN SELECT RAISE(ABORT, '[DB-I-manual_check_record] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.manual_check_record_no_delete BEFORE DELETE ON manual_check_record BEGIN SELECT RAISE(ABORT, '[DB-I-manual_check_record] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.system_school_no_update BEFORE UPDATE ON system_school BEGIN SELECT RAISE(ABORT, '[DB-I-system_school] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.system_school_no_delete BEFORE DELETE ON system_school BEGIN SELECT RAISE(ABORT, '[DB-I-system_school] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.rule_no_update BEFORE UPDATE ON rule BEGIN SELECT RAISE(ABORT, '[DB-I-rule] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.rule_no_delete BEFORE DELETE ON rule BEGIN SELECT RAISE(ABORT, '[DB-I-rule] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.rule_component_no_update BEFORE UPDATE ON rule_component BEGIN SELECT RAISE(ABORT, '[DB-I-rule_component] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.rule_component_no_delete BEFORE DELETE ON rule_component BEGIN SELECT RAISE(ABORT, '[DB-I-rule_component] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.evidence_link_no_update BEFORE UPDATE ON evidence_link BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_link] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.evidence_link_no_delete BEFORE DELETE ON evidence_link BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_link] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.text_variant_component_no_update BEFORE UPDATE ON text_variant_component BEGIN SELECT RAISE(ABORT, '[DB-I-text_variant_component] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.text_variant_component_no_delete BEFORE DELETE ON text_variant_component BEGIN SELECT RAISE(ABORT, '[DB-I-text_variant_component] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.blocker_no_update BEFORE UPDATE ON blocker BEGIN SELECT RAISE(ABORT, '[DB-I-blocker] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.blocker_no_delete BEFORE DELETE ON blocker BEGIN SELECT RAISE(ABORT, '[DB-I-blocker] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.component_blocker_no_update BEFORE UPDATE ON component_blocker BEGIN SELECT RAISE(ABORT, '[DB-I-component_blocker] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.component_blocker_no_delete BEFORE DELETE ON component_blocker BEGIN SELECT RAISE(ABORT, '[DB-I-component_blocker] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.blocker_step_map_no_update BEFORE UPDATE ON blocker_step_map BEGIN SELECT RAISE(ABORT, '[DB-I-blocker_step_map] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.blocker_step_map_no_delete BEFORE DELETE ON blocker_step_map BEGIN SELECT RAISE(ABORT, '[DB-I-blocker_step_map] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.rule_variant_no_update BEFORE UPDATE ON rule_variant BEGIN SELECT RAISE(ABORT, '[DB-I-rule_variant] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.rule_variant_no_delete BEFORE DELETE ON rule_variant BEGIN SELECT RAISE(ABORT, '[DB-I-rule_variant] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.rule_variant_edition_no_update BEFORE UPDATE ON rule_variant_edition BEGIN SELECT RAISE(ABORT, '[DB-I-rule_variant_edition] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.rule_variant_edition_no_delete BEFORE DELETE ON rule_variant_edition BEGIN SELECT RAISE(ABORT, '[DB-I-rule_variant_edition] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.revoke_reason_registry_no_update BEFORE UPDATE ON revoke_reason_registry BEGIN SELECT RAISE(ABORT, '[DB-I-revoke_reason_registry] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.revoke_reason_registry_no_delete BEFORE DELETE ON revoke_reason_registry BEGIN SELECT RAISE(ABORT, '[DB-I-revoke_reason_registry] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.review_record_no_update BEFORE UPDATE ON review_record BEGIN SELECT RAISE(ABORT, '[DB-I-review_record] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.review_record_no_delete BEFORE DELETE ON review_record BEGIN SELECT RAISE(ABORT, '[DB-I-review_record] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.approval_record_no_update BEFORE UPDATE ON approval_record BEGIN SELECT RAISE(ABORT, '[DB-I-approval_record] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.approval_record_no_delete BEFORE DELETE ON approval_record BEGIN SELECT RAISE(ABORT, '[DB-I-approval_record] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.approval_basis_no_update BEFORE UPDATE ON approval_basis BEGIN SELECT RAISE(ABORT, '[DB-I-approval_basis] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.approval_basis_no_delete BEFORE DELETE ON approval_basis BEGIN SELECT RAISE(ABORT, '[DB-I-approval_basis] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.approval_review_no_update BEFORE UPDATE ON approval_review BEGIN SELECT RAISE(ABORT, '[DB-I-approval_review] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.approval_review_no_delete BEFORE DELETE ON approval_review BEGIN SELECT RAISE(ABORT, '[DB-I-approval_review] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.approval_revoke_reason_no_update BEFORE UPDATE ON approval_revoke_reason BEGIN SELECT RAISE(ABORT, '[DB-I-approval_revoke_reason] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.approval_revoke_reason_no_delete BEFORE DELETE ON approval_revoke_reason BEGIN SELECT RAISE(ABORT, '[DB-I-approval_revoke_reason] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.component_default_no_update BEFORE UPDATE ON component_default BEGIN SELECT RAISE(ABORT, '[DB-I-component_default] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.component_default_no_delete BEFORE DELETE ON component_default BEGIN SELECT RAISE(ABORT, '[DB-I-component_default] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.variant_supersedes_no_update BEFORE UPDATE ON variant_supersedes BEGIN SELECT RAISE(ABORT, '[DB-I-variant_supersedes] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.variant_supersedes_no_delete BEFORE DELETE ON variant_supersedes BEGIN SELECT RAISE(ABORT, '[DB-I-variant_supersedes] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.parameter_registry_no_update BEFORE UPDATE ON parameter_registry BEGIN SELECT RAISE(ABORT, '[DB-I-parameter_registry] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.parameter_registry_no_delete BEFORE DELETE ON parameter_registry BEGIN SELECT RAISE(ABORT, '[DB-I-parameter_registry] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.param_allowed_value_no_update BEFORE UPDATE ON param_allowed_value BEGIN SELECT RAISE(ABORT, '[DB-I-param_allowed_value] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.param_allowed_value_no_delete BEFORE DELETE ON param_allowed_value BEGIN SELECT RAISE(ABORT, '[DB-I-param_allowed_value] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.param_dependency_no_update BEFORE UPDATE ON param_dependency BEGIN SELECT RAISE(ABORT, '[DB-I-param_dependency] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.param_dependency_no_delete BEFORE DELETE ON param_dependency BEGIN SELECT RAISE(ABORT, '[DB-I-param_dependency] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.param_variant_map_no_update BEFORE UPDATE ON param_variant_map BEGIN SELECT RAISE(ABORT, '[DB-I-param_variant_map] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.param_variant_map_no_delete BEFORE DELETE ON param_variant_map BEGIN SELECT RAISE(ABORT, '[DB-I-param_variant_map] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.term_no_update BEFORE UPDATE ON term BEGIN SELECT RAISE(ABORT, '[DB-I-term] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.term_no_delete BEFORE DELETE ON term BEGIN SELECT RAISE(ABORT, '[DB-I-term] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.term_alias_no_update BEFORE UPDATE ON term_alias BEGIN SELECT RAISE(ABORT, '[DB-I-term_alias] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.term_alias_no_delete BEFORE DELETE ON term_alias BEGIN SELECT RAISE(ABORT, '[DB-I-term_alias] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.dispute_no_update BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, '[DB-I-dispute] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.dispute_no_delete BEFORE DELETE ON dispute BEGIN SELECT RAISE(ABORT, '[DB-I-dispute] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.dispute_claim_no_update BEFORE UPDATE ON dispute_claim BEGIN SELECT RAISE(ABORT, '[DB-I-dispute_claim] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.dispute_claim_no_delete BEFORE DELETE ON dispute_claim BEGIN SELECT RAISE(ABORT, '[DB-I-dispute_claim] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.judgment_no_update BEFORE UPDATE ON judgment BEGIN SELECT RAISE(ABORT, '[DB-I-judgment] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.judgment_no_delete BEFORE DELETE ON judgment BEGIN SELECT RAISE(ABORT, '[DB-I-judgment] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.evidence_status_history_no_update BEFORE UPDATE ON evidence_status_history BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_status_history] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.evidence_status_history_no_delete BEFORE DELETE ON evidence_status_history BEGIN SELECT RAISE(ABORT, '[DB-I-evidence_status_history] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.admission_record_no_update BEFORE UPDATE ON admission_record BEGIN SELECT RAISE(ABORT, '[DB-I-admission_record] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.admission_record_no_delete BEFORE DELETE ON admission_record BEGIN SELECT RAISE(ABORT, '[DB-I-admission_record] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.formal_status_history_no_update BEFORE UPDATE ON formal_status_history BEGIN SELECT RAISE(ABORT, '[DB-I-formal_status_history] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.formal_status_history_no_delete BEFORE DELETE ON formal_status_history BEGIN SELECT RAISE(ABORT, '[DB-I-formal_status_history] 正式库只读、只追加，拒绝 DELETE'); END;
CREATE TRIGGER formal.blocker_change_no_update BEFORE UPDATE ON blocker_change BEGIN SELECT RAISE(ABORT, '[DB-I-blocker_change] 正式库只读、只追加，拒绝 UPDATE'); END;
CREATE TRIGGER formal.blocker_change_no_delete BEFORE DELETE ON blocker_change BEGIN SELECT RAISE(ABORT, '[DB-I-blocker_change] 正式库只读、只追加，拒绝 DELETE'); END;
