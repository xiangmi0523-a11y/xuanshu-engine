<!-- 独立规格输入（E2-FIX D）：逐字摘录自 xuanshu-data/review/E2_结构与约束审核清单.md 第 4 节（第 984–1132 行）。
     来源文件提交 7388ffa8ef7847422d1d82ad6e146d3ab3aa15af；全文件 sha256 0c532370e353e41118e8a59d4ec3830a46dad422343e16128310fd3738b36e08。
     本摘录只作 scripts/gen-spec.mjs 的输入，不得手改；清单更新时整段重新摘录。 -->
## 4 建表清单

图例：

- 强度：必 = NOT NULL；条 = 条件必须（写明条件）；可 = 可空。
- E2 一栏：“建”；“建*”表示依赖第 10 节裁决；“不建”表示【待定】。
- 第 3 节规范对全部表生效，下表不重复写。
- 视图以 V 标出。

### 4.1 formal.sqlite（正式库）

#### 版本、登记与步骤

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F01 | data_release | data_release 必 PK、release_seq 必 UNIQUE、commit_sha 必、created_at 必 | §1.2、§8.1 | 建 |
| F02 | data_version | kind 必 CHECK(tz / jieqi / place / eot / day_pillar)、version 必、sha256 必、data_release 必 FK；UNIQUE(kind, version) | §1.3、§6.4、§13.4 | 建 |
| F03 | engine_release | engine_release_id 必 PK、version 必、data_release 必 FK | §6.6 | 建 |
| F04 | engine_function / engine_function_source | engine_function(engine_release_id 必 FK、calc_function_id 必、function_version 必、impl_hash 必；PK(engine_release_id, calc_function_id))；第 3 版增 engine_function_source(engine_release_id 必、calc_function_id 必、path 必、file_sha256 必；PK 三列)，impl_hash 由此计算（§3.8） | §6.6 | 建*（Q-10） |
| F05 | step_code / step_dependency | step_code(module 必、step_code 必 PK、ordinal 必、name 必)；step_dependency(step_code 必 FK、depends_on 必 FK) | §6.6 | 建*（Q-10） |
| F06 | canonicalization_version | version 必 PK、spec_ref 必、golden_vectors_sha256 必、frozen_at 必 | §1.2（P-37） | 建*（Q-11） |
| F07 | blocker_step_map | block_id 必 FK、step_code 必 FK、effect 必 CHECK(BLOCKED-HARD / BLOCKED-FORMAL / NON_FORMAL)、condition_note 可、basis_ref 必、data_release 必 | §6.6、BLK.2（P-38） | 建*（Q-16） |

#### 文献层

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F08 | source | source_id 必、human_id 必 UNIQUE、attribution_status 必 CHECK(确定 / 存疑 / 系名)、attribution_claim_status 可 CHECK(IS NULL 或四值)（触发条件契约未写） | §2.1 | 建*（Q-3） |
| F09 | edition | edition_id 必、source_id 必 FK、parent_edition_id 可 FK、base_text 条（parent_edition_id 非空时必）、transcription_status 必 CHECK、confidence 必 CHECK(A/B/C)、branch_id 可 CHECK(IS NULL)；CHECK：转录本 ⇒ confidence ≠ A | §2.2 | 建*（Q-3） |
| F10 | passage | passage_id 必、edition_id 必 FK、chapter_label 必、paragraph_no 必、text 必（原码位）、volume_page 必、image_ref / verified_by / verified_at / against_what / result 条（见 P-30；result 可空枚举 MATCH / MISMATCH / PARTIAL） | §2.3、§13.7 | 建*（Q-7） |
| F11 | passage_fts | FTS5 外部内容，tokenize = trigram | §2.3 | 建 |
| F12 | variant_type | type_code 必 PK、applies_to_domain 必、label 必 | §2.3、A-10 | 建 |
| F13 | text_variant | variant_id 必、type_code 必 FK、passage_a 可 FK、edition_a 必 FK、passage_b 可 FK、edition_b 必 FK；CHECK(passage_a IS NOT NULL OR passage_b IS NOT NULL) | §2.3 | 建 |
| F14 | text_variant_component | variant_id 必 FK、component_id 必 FK | §2.3 | 建 |
| F15 | annotation_layer / annotation | layer_code 必 PK；annotation(annotation_id 必、passage_id 必 FK、layer_code 必 FK、text 必) | §2.3 | 建 |
| — | chapter | 字段未定义 | §2.3 | 不建 |

#### 证据层

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F16 | evidence | evidence_id 必、human_id 必、evidence_tier 必 CHECK(E1～E5)、evidence_category 必 CHECK(C-A～C-G)、confidence 必、verification_method 可、missing_evidence 可、next_source 可、origin 必 CHECK(human / ai_output)（Q-7）、branch_id 可 CHECK(IS NULL) | §2.4 | 建*（Q-7） |
| V | v_evidence_current | evidence_status、claim_status（取自 F31）、formal_status（取自 F33） | §4.4 | 建 |
| F17 | evidence_passage | evidence_id 必 FK、passage_id 必 FK；PK(evidence_id, passage_id) | §2.4 | 建 |
| F18 | evidence_link | evidence_id 必 FK、component_id 必 FK、evidence_role 必 CHECK（Q-7）、branch_id 可 CHECK(IS NULL) | §2.5、R-I-4 | 建*（Q-7） |
| F19 | manual_check_record | check_id 必、evidence_id 必 FK、checked_by 必、checked_at 必、page_range 必 | §12.2（P-06） | 建*（Q-7） |

#### 规则层

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F20 | rule | rule_id 必 PK、track 必 CHECK(A–D)、tier 必 CHECK(T0–T2)、default_scope 必 CHECK(进默认 / 多版本 / 暂缓)、system_id 可 FK、school_id 可 FK | §3.1 | 建 |
| V | v_rule_aggregate | claim_status 集合（MIXED）、admission 聚合 | §3.1、A-6 | 建 |
| F21 | rule_component | component_id 必 PK、rule_id 必 FK、evidence_category 必、is_calendar_anchor 条（evidence_category = C-A 时 NOT NULL）、calc_function_id 条（参与计算时）、applicability_domain 可（Q-17） | §3.2 | 建 |
| V | v_component_current | claim_status、admission_calc、admission_text、admission_qualitative（取自 F31、F32） | §3.2、S-2 | 建 |
| F22 | component_blocker | component_id 必 FK、block_id 必 FK | §3.2 | 建 |
| F23 | component_default | component_id 必 FK、applicable_scope 必（scope v1）、rule_variant_id 必 FK、approval_ref 必 FK、data_release 必、sequence_no 必；触发器：变体同属该子项；approval_ref 须为现行批准（第 3.3 节丙类）；只许 scope kind = all；UNIQUE(component_id, data_release) | §3.2 | 建*（Q-9） |
| F24 | rule_variant | rule_variant_id 必 PK、component_id 必 FK、version_no 必、content_hash 必、hash_algorithm 必、canonicalization_version 必 FK、confidence 必、school_id 可、branch_id 可 CHECK(IS NULL)、non_formal_reason 可枚举、experiment_* 条（non_formal_reason = 实验规则时）、applicable_from、applicable_to 可；UNIQUE(component_id, version_no)；版本递增触发器 | §3.3、§7.5 | 建 |
| V | v_variant_formal | 由 F37 推出：存在现行 approve 且 target_content_hash = content_hash 为 FORMAL（§8.2，要件核查留发布校验） | §8.2（Q-5） | 建 |
| F25 | rule_variant_edition | rule_variant_id 必 FK、edition_id 必 FK | §3.3 | 建 |
| F26 | variant_supersedes | old_variant_id 必 FK、new_variant_id 必 FK、reason 必、applicable_scope 必（scope v1，kind = all 或 segment）、approval_ref 可 FK、data_release 必；UNIQUE(old_variant_id, new_variant_id)；**同一 old_variant_id 允许多行（合法分叉），范围可重叠**（第 3 版）；同子项触发器；无环发布校验 | §3.3、A-11 | 建*（Q-9） |
| F27 | param_variant_map | param_id 必 FK、param_value 必、rule_variant_id 必 FK、applicable_scope 必（只许 kind = all）、selection_rule 必、data_release 必；UNIQUE(param_id, param_value, data_release) | §3.4 | 建*（Q-9） |
| F28 | term / term_alias | term(term_id 必、name 必、system_id 必、homonym_of 可)；term_alias(term_id 必、alias 必) | §3.5 | 建 |
| F29 | dispute / dispute_claim | dispute(dispute_id 必、object_ref 必、status 必 CHECK(未裁决 / 已裁决)、ruling_ref 条（已裁决时）)；dispute_claim(dispute_id 必、claim 必、evidence_id 必)；至少 2 个主张由发布校验检查 | §3.5 | 建 |
| F30 | judgment / system_school | judgment(judgment_id、conclusion、basis_evidence_id、actor_role、decided_at 均必)；system_school(id 必、name 必、parent_id 可、level_note 可) | §3.5 | 建 |

#### 状态历史（按第 3.3 节规则）

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F31 | evidence_status_history | target_type 必 CHECK(Evidence / RuleComponent)、target_id 必、field 必 CHECK(evidence_status / claim_status)、previous_value 可、new_value 必、data_release 必、sequence_no 必；CHECK：field 与取值集合配对 | §4.4、A-7 | 建 |
| F32 | admission_record | admission_id 必、component_id 必、purpose 必 CHECK(calc / text / qualitative)、previous_status 可、new_status 必 CHECK(五档)、conditions 条（new_status = CONDITIONAL 时；conditions v1）、basis_ref 必、data_release 必、sequence_no 必、decided_by 必 CHECK(= 'USER') | §4.4 | 建*（Q-8） |
| F33 | formal_status_history | target_type 必 CHECK(Source / Edition / Evidence / RuleVariant)（第 3 版：照 §4.4 保留 RuleVariant，与 F37 以 DB-F-24 约束一致）、target_id 必、previous_value 可、new_value 必 CHECK(FORMAL / NON_FORMAL)、data_release 必、sequence_no 必 | §4.4（Q-5） | 建*（Q-5） |

#### 参数层

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F34 | parameter_registry | param_id 必 PK、registry_origin 必 CHECK、module 必 CHECK、value_kind 必 CHECK(enum / numeric / bool)、has_default 必 bool、default_value 条（has_default = 1 时必，= 0 时必须为空）、follows_param 可 FK、parent_param 可 FK、first_use_prompt 条（has_default = 0 且非锁定时必）、registry_status 必 CHECK（Q-8）、locked_value 条（VERSION_LOCKED 时必，否则为空）、registry_version 必 | §5.1、N-6 | 建*（Q-8） |
| F35 | param_allowed_value | param_id 必 FK、value 必、evidence_status 必、claim_status 必；PK(param_id, value) | §5.1 | 建 |
| F36 | param_dependency | param_id 必 FK、depends_on 必 FK | §5.1 | 建 |

#### 治理层

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| F37 | approval_record | approval_id 必、sequence_no 必 UNIQUE、target_type 必 CHECK(= rule_variant)、target_id 必 FK、target_content_hash 必、data_release 必、decision 必 CHECK(四值)、decided_by 必 CHECK(= 'USER')、decided_at 必、scope 必（scope v1，kind = all 或 segment）、conditions 条（approve_conditional 时）、supersedes_approval_id 可 FK（须指向同一 target 的较早记录）；第 3.3 节乙类（批准事件，不适用 previous/new 衔接） | §8.2 | 建*（Q-8） |
| F38 | approval_basis / approval_review / approval_revoke_reason | approval_basis(approval_id、basis_ref 均必)，每条批准至少一行；approval_review(approval_id、review_id)；approval_revoke_reason(approval_id、reason_code)，revoke 至少一行 | §8.2、§8.4 | 建 |
| F39 | revoke_reason_registry | code 必 PK、label 必 | §8.4 | 建 |
| F40 | review_record | review_id 必、role 必 CHECK(research / architecture / revocation_trigger)、target_type 必、target_id 必、body 必、created_at 必、trigger_type / source_event / disposition 条（revocation_trigger 时） | §8.1、§8.4、§2.5（Q-5） | 建*（Q-5） |
| F41 | blocker | block_id 必 PK 及 §9.6 全部字段（scope 必 CHECK(GLOBAL / MODULE / PATH)；其余文本字段必） | §9.6 | 建 |
| V | v_blocker_current | status 取自 F42 | §9.6 | 建 |
| F42 | blocker_change | change_id 必、block_id 必 FK、previous_status 可、new_status 必 CHECK(现行 / 已解除)、user_ruling_ref 必、data_release 必、sequence_no 必 | §9.6 | 建 |
| V | v_governance_record | 由 F23、F29、F31、F32、F37、F40、F42 生成，字段为 source_table、source_id、object、previous_state、new_state、data_release | §8.5 | 建 |
| — | t3_entry | 字段未定义 | §3.1 | 不建 |

### 4.2 user.sqlite（用户库）

三元组引用列的写法统一为 ref_release、ref_id、ref_hash，均为必。下表“三元组”即指这三列。

#### 档案与输入

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| U01 | profile | owner_profile_id 必 PK、created_at 必 | §6.1、§10.2 | 建*（Q-2） |
| U02 | calculation_input | input_id 必 PK、input_hash 必、owner_profile_id 必 FK、domain 必 CHECK、raw_payload 必（JSON v1）、gender 条（domain = BAZI 时必）CHECK(IS NULL 或三值)、time_precision 条（同上）、normalized_payload 必、normalizer_version 必、place 三元组条（有地点时） | §6.1、G-1、G-2 | 建 |
| U03 | input_tz_resolution | input_id 必 PK FK、owner_profile_id 必、tz_id 必、utc_offset_seconds 必、dst_flag 必 bool、tzdata_version 必、tz_table_version 必、offset_source 必、confirmation_record 可、ambiguity_reason 可 | §6.1、§11.1 | 建 |

#### 配置（内容与档案引用分离，P-23）

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| U04 | calculation_config | config_id 必、config_version 必、config_hash 必 UNIQUE、module 必、registry_version 必、hash_algorithm 必、canonicalization_version 必；PK(config_id, config_version)；**不含 owner_profile_id，不含 formal_status 与 research_scope** | §5.4、A-3（Q-6、Q-13） | 建 |
| U05 | config_param_value | config_id 必、config_version 必、param_id 必、value 必、value_source 必 CHECK(四值)；PK(config_id, config_version, param_id)；CFG-01 拦截见第 8.1 节 | §5.4、N-6 | 建 |
| U06 | profile_config_ref | owner_profile_id 必 FK、config_id 必、config_version 必；PK(三列) | §10.2（Q-13） | 建*（Q-13） |
| V | v_config_closure（TEMP 视图，自查） | 配置 → 参数 → 变体（经正式库 F27）→ 个人对象的闭包，及推导出的 formal_status、research_scope、branch_id（§7.3、§7.4）；因跨库，只能是连接 ATTACH 正式库后创建的 TEMP 视图，不属于 user.sqlite 结构（第 3.10 节） | §5.4、R-I-5（Q-6） | 建* |

#### 快照（按第 3.5 节封存）

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| U07 | calculation_snapshot | 第 6.1 节全部字段 | §6.3 | 建 |
| U08 | snapshot_non_formal_reason | snapshot_id 必 FK、owner_profile_id 必、ord 必、reason_kind 必 CHECK(R-I / PARAM_PROVISIONAL / RULE_PROVISIONAL / BLOCKER_PATH / RESEARCH_ONLY)、ri_segment 条（reason_kind = R-I 时）、upstream 三元组必、note 必 | §6.3、§5.3（Q-6） | 建*（Q-6） |
| U09 | snapshot_degradation_reason | snapshot_id 必 FK、owner_profile_id 必、reason_code 必 CHECK(MISSING_GENDER / HOUR_UNKNOWN / …契约已列者) | §13.1～§13.3 | 建 |
| U10 | snapshot_dependency | snapshot_id 必 FK、owner_profile_id 必、ord 必、dep_type 必 CHECK（8 类）；按 dep_type 的必需列 CHECK（第 6.4 节） | §6.4 | 建 |
| U11 | snapshot_gov_approval / snapshot_gov_blocker / snapshot_gov_sequence | 三表均含 snapshot_id 必 FK（延迟）、owner_profile_id 必（自查补：封存协议与删除入口都需要）；内容为计算当时每个变体的批准 ID、各阻断状态、证据与准入序号，均为必 | §6.5 | 建 |
| U12 | snapshot_resolved_context | snapshot_id 必 FK、owner_profile_id 必、item_kind 必 CHECK(jieqi_prev / jieqi_next / table_version)、key 必、version 条、content_hash 条、value 条 | §13.6（第 6.3 节） | 建 |
| U13 | execution_trace_step | snapshot_id 必 FK、owner_profile_id 必、step_code 必、calc_function_id 条（完成时）、function_version 条、impl_hash 条、input_summary 条、output_summary 条、status 必 CHECK(完成 / 未执行)、skip_kind 条（未执行时 CHECK(范围外 / 输入缺失 / 按规则跳过)）、reason 条（未执行时） | §6.6（P-34、P-39） | 建*（Q-10、Q-15） |

#### 个人研究

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| U14 | branch | branch_id 必 PK、branch_name 必、parent_branch_id 可 FK、base_data_release 必、base_snapshot_id 可 FK（不级联）、owner 必 CHECK(= 'OWNER')、branch_note 可；UPDATE 只许删除入口内置空 base_snapshot_id（第 3.6 节第 (4) 条） | §7.1、§10.2 | 建 |
| U15 | branch_status_history | branch_id 必 FK、previous_status 可、new_status 必 CHECK(四值)、data_release 条（merged 时）、note 必、sequence_no 必 | §7.1 | 建 |
| U16 | personal_edition / personal_evidence / personal_rule_variant / personal_text_variant / personal_evidence_link | 与正式同名表同构；branch_id 必 FK；formal_status 必 CHECK(= NON_FORMAL)；对正式对象用三元组 | §1.3、R-I-2、§7.2 | 建 |

#### 审计与草稿

| # | 表 | 字段（强度）与库层约束 | 依据 | E2 |
| --- | --- | --- | --- | --- |
| U17 | blocked_audit_event | event_id 必、occurred_at 必、module 必、block_reason_code 必、app_version 必、data_release 必；不设任何个人列 | §6.3、K-4（Q-2） | 建*（Q-2） |
| U18 | deletion_audit / deletion_audit_count | deletion_audit(audit_id、deleted_at、trigger CHECK(用户操作)、app_version（GLOB 格式）、data_release（GLOB 格式）、success 均必)；deletion_audit_count(audit_id、object_type CHECK 枚举、count ≥ 0 均必)；永不可改删；插入须审计写入授权（第 3.6 节第 (5) 条） | §10.4 | 建 |
| U19 | branch_event | event_id 必、branch_id 必 FK、kind 必 CHECK(= base_snapshot_cleared)、occurred_at 必、audit_id 必 FK；只追加；插入须在已授权删除事务内；不含快照 ID、档案 ID、哈希（第 3 版） | §10.2 | 建*（Q-2） |
| U20 | deletion_txn_marker | id 必 PK CHECK(= 1)（至多一行）、txn_token 必、audit_id 必、grant_seq 必、kind 必 CHECK(success / failure)；只在删除模块的事务内存在，提交前删除、回滚即消失；非授权依据，只用于绑定本次事务（第 4 版，R1） | §10.3（工程方案） | 建*（Q-13） |
| — | config_draft、派生数据、个人笔记、用户 FTS | 字段未定义 | §9.1、§7.6 | 不建 |

---
