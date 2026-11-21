<!-- 独立规格输入（E2-FIX-2 P2-3）：逐字摘录自 xuanshu-data/review/E2_结构与约束审核清单.md 第 5 节（第 1133–1833 行）。
     来源文件提交 7388ffa8ef7847422d1d82ad6e146d3ab3aa15af；全文件 sha256 0c532370e353e41118e8a59d4ec3830a46dad422343e16128310fd3738b36e08。
     只取其中“失败定位”所列约束编号，作 CHECK / 触发器定位的双向比对输入；不得手改。 -->
## 5 约束验证清单

每条给出四项：正向输入（应成功）、反向输入（应失败或被查出）、预期结果、失败定位（第 3.1 节约定的报错标记或查询编号）。“基准行”指该表一行全部字段合法的样例；反向输入只改所列字段。

### 5.1 生成矩阵（覆盖全部表）

**DB-N 必填列 NULL**

- 正向：基准行插入成功。
- 反向：规格表中每个“必”列各置 NULL 一次。
- 预期：每次报 `NOT NULL constraint failed: <表>.<列>`。
- 失败定位：未报错的表与列。

**DB-N2 双向核对**

- 规格表必填集合与 DDL 的 notnull 集合逐列比对。
- 预期：两集合相等。
- 失败定位：差集。

**DB-E 枚举越界**

- 正向：每个枚举列取每个合法值各一次。
- 反向：取越界值 'X'；可空枚举另取 NULL（应成功），必填枚举取 NULL（应被 DB-N 拦截）。
- 预期：越界报 `CHECK constraint failed: <约束编号>`。
- 失败定位：约束编号。

**DB-K 外键**

- 每张表测试前断言 `PRAGMA foreign_keys` = 1，未开即整组失败。
- 正向：引用存在的父行。
- 反向：每个外键单独指向不存在的父行。立即外键在语句处报 FOREIGN KEY constraint failed；延迟外键在提交处报。
- 预期：每例各报一次；全部结束后 `PRAGMA foreign_key_check` 返回 0 行。
- 失败定位：用例编号（一例一个外键）与 foreign_key_check 输出。

**DB-I 不可改删**

- 反向：
  - 正式库每表 UPDATE 一列、DELETE 一行；
  - 用户库计算层每表 UPDATE 一列、未授权 DELETE 一行。
- 预期：报 `[DB-I-<表>]`。
- 失败定位：表名。

### 5.2 正式库（DB-F）

**DB-F-04 转录本 confidence 不得为 A**

- 正向：transcription_status = 转录本，confidence = B。
- 反向：同上，confidence = A。
- 预期：拒，`CHECK constraint failed: DB-F-04`。
- 失败定位：DB-F-04。

**DB-F-05 默认值与锁定值的取值规则**

- 正向：CFG-04 has_default = 0、default_value 为空；CFG-01 为 VERSION_LOCKED、locked_value = ye_zi_b。
- 反向：
  - (a) CFG-04 has_default = 0 而 default_value = yh_yuelu；
  - (b) VERSION_LOCKED 而 locked_value 为空；
  - (c) ACTIVE 而 locked_value 非空。
- 预期：三例皆拒。
- 失败定位：DB-F-05a / b / c。

**DB-F-06 CONDITIONAL 须有条件**

- 正向：new_status = CONDITIONAL，conditions = `{"v":1,"all":[{"op":"param_selected","param":"CFG-01"}]}`。
- 反向：new_status = CONDITIONAL，conditions 为空。
- 预期：拒。
- 失败定位：DB-F-06。

**DB-F-07 批准记录字段规则**

- 正向：decided_by = USER、target_type = rule_variant、decision = revoke 且有 1 条撤销原因。
- 反向：
  - (a) decided_by = GPT；
  - (b) target_type = rule；
  - (c) revoke 无撤销原因（提交时）。
- 预期：皆拒。
- 失败定位：DB-F-07a / b / c。

**DB-F-08 批准序号唯一递增**

- 正向：sequence_no 依次为 1、2、5。
- 反向：
  - (a) 再插 5；
  - (b) 插 4（小于最大值）。
- 预期：皆拒。
- 失败定位：DB-F-08a / b。

**DB-F-09 变体版本与实验字段**

- 正向：同一子项 version_no 1、2。
- 反向：
  - (a) 再插 2；
  - (b) 插 1；
  - (c) non_formal_reason = 实验规则而 experiment_hypothesis 为空。
- 预期：皆拒。
- 失败定位：DB-F-09a / b / c。

**DB-F-10 替代关系：同子项、无环、允许分叉（第 3 版）**

- 正向：
  - (1) A→B（同一子项，reason = 算法缺陷）；
  - (2) A→C（同一子项，reason = 适用范围拆分，scope kind = segment），即同一旧变体的合法分叉；
  - (3) A→B 与 A→C 的范围重叠。
- 反向：
  - (a) A→D（D 属他子项）；
  - (b) 已有 A→B、B→A；
  - (c) 重复插 A→B；
  - (d) reason 为空。
- 预期：正向三条全部成功；(a) 触发器拒；(b) 无环查询 Q-F-10 返回环上的变体；(c) UNIQUE 拒；(d) DB-N 拒。
- 失败定位：DB-F-10a、Q-F-10、DB-F-10c、DB-N。

**DB-F-11 默认变体规则**

- 正向：子项 X、TEST-G1 下一条 kind = all 的默认。
- 反向：
  - (a) 默认指向他子项变体；
  - (b) 同子项同数据版本第二条；
  - (c) scope kind = range。
- 预期：皆拒。
- 失败定位：DB-F-11a / b、DB-J-02。

**DB-F-12 C-A 子项须标锚点**

- 正向：evidence_category = C-A，is_calendar_anchor = 1。
- 反向：
  - (a) C-A 而 is_calendar_anchor 为空；
  - (b) evidence_category 为空（应被 DB-N 先拦）。
- 预期：(a) 拒。
- 失败定位：DB-F-12。

**DB-F-13 异文与注释的必需引用**

- 正向：passage_a 有值、passage_b 为空（增删类异文）。
- 反向：
  - (a) passage_a、passage_b 都为空；
  - (b) annotation 的 passage_id 为空。
- 预期：皆拒。
- 失败定位：DB-F-13、DB-N。

**DB-F-14 争议至少两个主张**

- 正向：争议有 2 个主张。
- 反向：争议只有 1 个主张。
- 预期：查询 Q-F-14 返回该争议。
- 失败定位：Q-F-14。

**DB-F-15 阻断变更须有用户裁决引用**

- 正向：user_ruling_ref = B3-1。
- 反向：user_ruling_ref 为空。
- 预期：拒。
- 失败定位：DB-N。

**DB-F-16 状态历史的字段与取值配对**

- 正向：field = claim_status、new_value = 推断。
- 反向：field = claim_status、new_value = CROSS_CHECKED。
- 预期：拒。
- 失败定位：DB-F-16。

**DB-F-17 当前值视图**

- 正向：同一键 seq 3 = A、seq 7 = B。
- 反向：无（查询型）。
- 预期：视图给 B。
- 失败定位：视图名与键。

**DB-F-18 治理索引视图**

- 正向：七张权威表各 1 行。
- 反向：无。
- 预期：v_governance_record 共 7 行，每行 source_table + source_id 唯一且能回连。
- 失败定位：Q-F-18。

**DB-F-19 古籍原文不归一化**

- 正向：存“峯”（U+5CEF）与兼容字 U+F900，FTS 检索三字词命中。
- 反向：无。
- 预期：读出码位与存入逐一相同；检索命中。
- 失败定位：码位差异位置。

**DB-F-20 正式状态历史的对象类型（第 3 版：保留 RuleVariant）**

- 正向：target_type 为 Source、Edition、Evidence、RuleVariant 各一条。
- 反向：target_type = Rule。
- 预期：反向拒。
- 失败定位：DB-F-20。

**DB-F-21 审查记录的撤销触发字段**

- 正向：role = revocation_trigger 且 trigger_type 有值。
- 反向：role = revocation_trigger、trigger_type 为空。
- 预期：拒。
- 失败定位：DB-F-21。

**DB-F-22 参数—变体映射**

- 正向：(CFG-01, ye_zi_b) → 变体 V1。
- 反向：
  - (a) 映射到不存在的变体；
  - (b) 同参数同值同数据版本映射两条 kind = all。
- 预期：(a) 外键拒；(b) 唯一约束拒。
- 失败定位：DB-K、DB-F-22。

**DB-F-23 阻断—步骤映射**

- 正向：BLK-7 → BZ-03，effect = BLOCKED-FORMAL。
- 反向：
  - (a) 引用不存在的步骤；
  - (b) effect = X。
- 预期：皆拒。
- 失败定位：DB-K、DB-E。

**DB-F-24 RuleVariant 正式状态与批准一致（第 3 版新增，第 3.3 节）**

- 正向：变体 V 在 release 1 有 approve（哈希一致），同版本 formal_status_history V → FORMAL；release 2 有 revoke，同版本 V → NON_FORMAL。
- 反向：
  - (a) V → FORMAL 而无现行 approve；
  - (b) approve 的 target_content_hash 与 V 不符，仍 → FORMAL；
  - (c) revoke 生效而 V 仍为 FORMAL（无 → NON_FORMAL 转换）；
  - (d)（第 4 版，R3）：
    - release 1：V 有现行 approve（哈希一致），V → FORMAL；其子项的支持性证据 Ev（evidence_link 角色 = 支持、branch_id 为空）为 FORMAL；
    - release 2：Ev 追加 FORMAL → NON_FORMAL；没有任何 revoke；V 没有追加 FORMAL → NON_FORMAL。
- 预期：
  - 发布校验查询 Q-F-24 对 (a)(b)(c) 各返回 1 行；
  - 对 (d)，Q-F-24d 返回 V 一行（标明 release 2 与触发证据 Ev）。
  - 补充正向 (d′)：release 2 同时追加 V → NON_FORMAL，Q-F-24d 返回 0 行，且 Q-F-24c 不误报（没有 revoke 也允许 NON_FORMAL 转换）。
- 失败定位：Q-F-24a / b / c / d。

**DB-F-25 成对阻断同步解除（第 3 版新增）**

- 正向：B4 与 BLK-6 在同一 data_release 各有一条“现行 → 已解除”。
- 反向：
  - (a) 只解除 B4；
  - (b) BLK-6 晚一个版本解除；
  - B1 与 BLK-7 同理（§9.5、BLK.4）。
- 预期：查询 Q-F-25 返回不同步的那一对。
- 失败定位：Q-F-25。

### 5.3 历史序号（DB-Q，第 3.3 节）

| 编号 | 正向 | 反向 | 预期 | 失败定位 |
| --- | --- | --- | --- | --- |
| DB-Q-01 | 某键首条 previous 为空 | 首条 previous = FORMAL_ALLOWED | 拒 | DB-Q-01 |
| DB-Q-02 | 第二条 previous 等于首条 new | 第二条 previous ≠ 首条 new | 拒 | DB-Q-02 |
| DB-Q-03 | 全表 seq 10、11 | 插 seq 11（重复） | 拒 | DB-Q-03 |
| DB-Q-04 | — | 插 seq 9（小于最大） | 拒 | DB-Q-04 |
| DB-Q-05 | release_seq 1 → 2 | 同键新记录 release_seq 1 → 0 | 拒 | DB-Q-05 |
| DB-Q-06 | — | 对已存历史行 UPDATE 或 DELETE | 拒 | DB-I |

DB-Q-01～05 对第 3.3 节的七张表逐一执行。

| 编号 | 正向 | 反向 | 预期 | 失败定位 |
| --- | --- | --- | --- | --- |
| DB-Q-07 | 乙类：approval supersedes_approval_id 指向同一 target 的较早记录 | 指向他 target，或指向较晚记录 | 拒 | DB-Q-07 |
| DB-Q-08 | 丙类：component_default 引用现行 approve | 引用 reject 或 revoke 记录；或引用他子项变体的批准 | 拒 | DB-Q-08 |
| DB-Q-09 | 甲类：previous ≠ new | 插入 previous = new 的“无转换行” | 拒 | DB-Q-09 |

第 3 版：DB-Q-01、02、09 只对甲类五张表执行；DB-Q-03、04、05 对三类全部七张表执行；DB-Q-07 只对乙类，DB-Q-08 只对丙类。

### 5.4 用户库（DB-U）

**DB-U-03 BAZI 输入的性别与时辰精度**

- 正向：BAZI，gender = UNKNOWN，time_precision = MINUTE。
- 反向：
  - (a) BAZI、gender 为空；
  - (b) gender = X；
  - (c) LIUYAO、gender 为空（应成功）。
- 预期：(a)(b) 拒，(c) 成功。
- 失败定位：DB-U-03a / b。

**DB-U-04 有出生时刻须有时区解析**

- 正向：有出生时刻且有 U03 行。
- 反向：有出生时刻而无 U03 行。
- 预期：查询 Q-U-04 返回该 input_id。
- 失败定位：Q-U-04。

**DB-U-05 配置版本与内容去重**

- 正向：(C1, 1)、(C1, 2)。
- 反向：
  - (a) 再插 (C1, 2)；
  - (b) 插 (C1, 1) 于 (C1, 2) 之后作为新行；
  - (c) 另一 config_id 而 config_hash 与 (C1, 1) 相同。
- 预期：皆拒。
- 失败定位：DB-U-05a / b / c。

**DB-U-06 value_source 与锁定参数**

- 正向：CFG-02 user_selected。
- 反向：
  - (a) CFG-02 version_locked（非锁定参数）；
  - (b) value_source = auto。
- 预期：(a) 封存前查询 Q-U-06 查出（跨库）；(b) 拒。
- 失败定位：Q-U-06、DB-E。

**DB-U-07 快照所引哈希须一致**

- 正向：快照的 input_hash、config_hash 与所引对象一致。
- 反向：input_hash 改一位。
- 预期：拒。
- 失败定位：DB-U-07。

**DB-U-08 状态组合**

- 正向：(FORMAL, CALC_FORMAL)；(NON_FORMAL, CALC_RESEARCH)。
- 反向：(FORMAL, CALC_RESEARCH)；(NON_FORMAL, CALC_FORMAL)。
- 预期：拒。
- 失败定位：DB-U-08。

**DB-U-09 非正式原因与状态一致**

- 正向：NON_FORMAL 带 1 条原因；FORMAL 不带原因。
- 反向：(a) NON_FORMAL 无原因；(b) FORMAL 带原因。
- 预期：封存拒。
- 失败定位：DB-U-09a / b。

**DB-U-10 research_scope 推导**

- 正向：FORMAL + 空分支 → research_scope = FORMAL。
- 反向：
  - (a) FORMAL 且闭包分支非空；
  - (b) NON_FORMAL + 非空分支而 research_scope = FORMAL。
- 预期：封存拒。
- 失败定位：DB-U-10a / b。

**DB-U-11 降级原因与完整度一致**

- 正向：OK_WITH_DEGRADATION + MISSING_GENDER。
- 反向：(a) COMPLETE + MISSING_GENDER；(b) OK_WITH_DEGRADATION 而无原因。
- 预期：封存拒。
- 失败定位：DB-U-11a / b。

**DB-U-12 依赖行的必需列**

- 正向：rule_variant 行带 id、version_no、content_hash、approval_id；tz_data 行写“未记录”。
- 反向：
  - (a) rule_variant 行缺 content_hash；
  - (b) tz_data 行 version 为空。
- 预期：皆拒。
- 失败定位：DB-U-12a / b。

**DB-U-13 重算来源**

- 正向：重算快照指向已存快照；一个旧快照被两条重算快照指向。
- 反向：
  - (a) 指向不存在的快照；
  - (b)（自查）指向他档案的快照。重算只能从本档案快照发起（§8.4）；跨档案引用会使删除一方时外键受阻（§10.2）。
- 预期：(a) 外键拒；(b) 触发器拒。
- 失败定位：DB-K、DB-U-13b。

**DB-U-14 个人对象**

- 正向：个人变体 branch_id = B1、formal_status = NON_FORMAL。
- 反向：(a) branch_id 为空；(b) formal_status = FORMAL。
- 预期：皆拒。
- 失败定位：DB-N、DB-U-14。

**DB-U-15 分支规则**

- 正向：active → merged（data_release 有值）。
- 反向：
  - (a) base_data_release 为空；
  - (b) parent 悬空；
  - (c) merged 无数据版本；
  - (d) merged 后再追加 active。
- 预期：皆拒。
- 失败定位：DB-N、DB-K、DB-U-15c / d。

**DB-U-18 BLOCKED 只留审计事件**

- 正向：G0 场景计算一次。
- 反向：无。
- 预期：
  - 快照、依赖、轨迹三表行数不变；
  - blocked_audit_event 加 1 行；
  - 该行任何列都不含输入中的日期、地点、经纬度字符串（逐列比对）。
- 失败定位：Q-U-18。

### 5.5 依赖闭包（DB-C，§7.3、§7.4、R-I-1～8）

| 编号 | 正向 | 反向 | 预期 | 失败定位 |
| --- | --- | --- | --- | --- |
| DB-C-01 | 闭包全 FORMAL 且无分支，封存 FORMAL | 依赖中一个正式变体在正式库为 NON_FORMAL（v_variant_formal），仍封存 FORMAL | 封存前引擎预检拒；若绕过预检，封存后查询 Q-C-01 查出 | Q-C-01 |
| DB-C-02 | — | 依赖含个人变体（branch_id 非空）而封存 FORMAL | 触发器拒 | DB-C-02 |
| DB-C-03 | 依赖含个人变体，封存 NON_FORMAL，research_scope = PERSONAL_RESEARCH | 同上而 research_scope = FORMAL | 拒 | DB-U-10 |
| DB-C-04 | 暂缓子项变体不在配置中 | 普通配置写入映射到 DEFERRED 子项变体的参数值（A-5） | 封存前查询 Q-C-04 查出；处理按 Q-12 | Q-C-04 |
| DB-C-05 | 跨域依赖已登记（cross_domain 行） | 六爻用了日柱而无 cross_domain 行（R-I-8） | 引擎预检拒；绕过则 Q-C-05 查出（自查） | Q-C-05 |
| DB-C-06 | 第 3 版（P-42）：八字 14:30 时 ye_zi_b 变体（用于子时适用域判断）记入依赖；六爻正午日界规则记入依赖 | 适用域判断所读的变体未记入依赖 | 查询 Q-C-06 查出 | Q-C-06 |
| DB-C-10 | 第 3 版：分支选择所读的变体记入依赖（例：按 time_precision 选单值或双解分支的规则变体） | 只记最终分支、漏记选择所读的变体；或把契约降级规则与准入状态作出的跳过记成变体依赖 | 查出 | Q-C-10 |
| DB-C-07 | Source NON_FORMAL → Edition NON_FORMAL | Source NON_FORMAL 而其 Edition 为 FORMAL（R-I-1） | 发布校验查出 | Q-C-07 |
| DB-C-08 | — | Edition NON_FORMAL 而引用它的 Evidence 为 FORMAL（R-I-3） | 查出 | Q-C-08 |
| DB-C-09 | 反证类证据为 NON_FORMAL，变体仍可 FORMAL | 支持类证据为 NON_FORMAL 而变体 FORMAL（R-I-4） | 查出 | Q-C-09 |

### 5.6 封存、事务与回滚（DB-R、DB-S）

**DB-R-01 依赖写入中途出错**

- 正向：完整封存。
- 反向：依赖写到第 3 行时插入一条违规行。
- 预期：事务回滚；快照及全部子表 0 行。
- 失败定位：残留行所在表。

**DB-R-02 封存后追加子行**

- 正向：无。
- 反向：快照已封存后再插依赖行。
- 预期：拒。
- 失败定位：DB-R-02。

**DB-R-03 子行写完但快照行未写**

- 正向：无。
- 反向：事务提交时快照行缺失（只有子行）。
- 预期：延迟外键在提交时拒，整体回滚。
- 失败定位：DB-K。

**DB-R-04 删除中途出错**

- 正向：完整删除。
- 反向：删除级联第 k 张表时注入失败（受保护表的触发器 RAISE）。
- 预期：审计行与已删行全部回滚。
- 失败定位：残留差异。

**DB-S-01 快照格式一致（W-04）**

- 正向：八字与六爻快照各 1 条。
- 反向：无。
- 预期：两条快照信封列集合与非空性一致；子表结构相同。
- 失败定位：差异列。

**DB-S-02 指纹与治理分离**

- 正向：重算 result_hash 与 result_fingerprint。
- 反向：只改 governance_context 一项（例如 BLK-3 状态）后重算指纹。
- 预期：指纹不变；result_hash 不变。
- 失败定位：变化项。

**DB-S-03 复算一致（W-07 内存版）**

- 正向：同输入、配置、数据版本、引擎版本复算。
- 反向：改 registry_version 后复算。
- 预期：前者 result_fingerprint 一致；后者不同。
- 失败定位：指纹差异成分。

**DB-S-04 轨迹可读出各步状态（自查补定义；§6.6、§4.2 C-G）**

- 正向：E2E-BZ-1 在 G1N 或 G2 场景下封存后（G0、G1 不封存），按 step_code 顺序读出：
  - BZ-01、BZ-04～BZ-11 为“完成”；
  - BZ-02、BZ-03 为“未执行·按规则跳过（CFG-02 = false）”；
  - BZ-12 为“未执行·输入缺失（MISSING_GENDER）”；
  - BZ-13 为“未执行·按规则跳过（P-A-04 暂缓）”。
  - C-G 类步骤（BZ-01～BZ-04）的状态可按 §6.6 映射为“经度项未算（钟表时间）、均时差未用、子时已判定”的表述。
- 反向：删去 BZ-03 的轨迹行。
- 预期：正向读出与上述逐项相等；反向被 DB-T-01 检出。
- 失败定位：步骤差集。

**DB-S-05 无秒级输出**

- 正向：结果中时间只到分钟。
- 反向：无。
- 预期：result_payload 中无秒级真太阳时字段。
- 失败定位：字段路径。

**DB-S-06 G0、G1 场景（第 3 版：G1 也为 BLOCKED）**

- 正向：无。
- 反向：G0、G1 场景两用例各算一次。
- 预期：各产生 BLOCKED-FORMAL；无快照；审计 1 行，block_reason_code 按 DB-B-03。
- 失败定位：Q-U-18。

**DB-S-07 G1N 场景（第 3 版：原 G1 的 NON_FORMAL 断言移至 G1N）**

- 正向：G1N 场景两用例。
- 反向：G1N 中删去一条应有的原因行（例如六爻的 BLOCKER_PATH:BLK-6）。
- 预期：
  - 正向 NON_FORMAL，原因行集合与第 7.3、7.4 节逐条相等（不多不少）：八字 3 条或 5 条（按 Q-12 附问的结论二选一，见第 7.3 节），六爻 2 条；
  - 反向：库层只保证 NON_FORMAL 至少一条原因（DB-U-09），完整性由测试将原因集合同第 7 节期望表比对，查出差集即失败。
- 失败定位：原因差集。

**DB-S-08 G2 场景**

- 正向：G2 场景两用例。
- 反向：G2 中把一个依赖改回 NON_FORMAL。
- 预期：正向 FORMAL 且无原因行；反向封存为 FORMAL 被拒。
- 失败定位：DB-C-01。

**DB-S-09 resolved_context 与依赖表一致**

- 正向：resolved_context 的表版本行与依赖表行逐一相等。
- 反向：改一条 resolved_context 的 content_hash。
- 预期：封存拒。
- 失败定位：DB-S-09。

### 5.7 执行轨迹与部分执行（DB-T）

| 编号 | 正向 | 反向 | 预期 | 失败定位 |
| --- | --- | --- | --- | --- |
| DB-T-01 | 每个步骤编号恰一行 | 缺 LY-09 行；或 LY-03 两行 | 引擎预检拒；绕过则 Q-T-01 查出（自查：步骤表在正式库） | Q-T-01 |
| DB-T-02 | 未执行行带 skip_kind 与 reason | 未执行无 reason | 拒 | DB-T-02 |
| DB-T-03 | 完成行带 calc_function_id、function_version、impl_hash | 完成行缺 impl_hash | 拒 | DB-T-03 |
| DB-T-04 | 完成行三者与正式库 engine_function 一致 | function_version 不一致 | 查询 Q-T-04 查出 | Q-T-04 |
| DB-T-05 | LY-09 未执行（范围外），结果无月建字段，completeness 不受影响 | LY-09 未执行而结果含 month_build 字段 | 封存前校验拒 | DB-T-05 |
| DB-T-06 | 依赖顺序 LY-06 先于 LY-07 | LY-07 完成而 LY-06 未执行 | 引擎预检拒；绕过则 Q-T-06 查出（自查） | Q-T-06 |
| DB-T-07 | 八字 CFG-02 = false：BZ-02、BZ-03 未执行（按规则跳过） | BZ-03 完成而 CFG-02 = false | 引擎预检拒；绕过则 Q-T-07 查出（自查） | Q-T-07 |
| DB-T-08 | 输入缺失跳过（BZ-12 大运，gender = UNKNOWN）→ OK_WITH_DEGRADATION + MISSING_GENDER | 输入缺失跳过而 COMPLETE | 拒 | DB-U-11 |
| DB-T-09 | 步骤编号表不可改（UPDATE 改 step_code 名） | 改名或删行 | 拒 | DB-I |
| DB-T-10 | 按 engine_function_source 重算 impl_hash 等于登记值 | 改一个源文件哈希 | 查询 Q-T-10 查出 | Q-T-10 |

### 5.8 结构化 JSON（DB-J）

| 编号 | 正向 | 反向 | 预期 | 失败定位 |
| --- | --- | --- | --- | --- |
| DB-J-01 | `{"v":1,"kind":"all"}` | 非 JSON 文本 | 拒 | DB-J-01 |
| DB-J-02 | 第 3 版：F26、F37 写 `{"v":1,"kind":"segment","module":"BAZI"}` 成功 | F23、F27 写 kind = segment；任何表写 kind = range（未定义） | 拒 | DB-J-02 |
| DB-J-07 | segment 带 from = 1900-01-01、to = 2100-12-31 | from > to；segment 缺 module | 拒 | DB-J-07 |
| DB-J-08 | 同一 old_variant_id 两行 segment 范围重叠（F26） | — | 成功（分叉合法） | DB-J-08 |
| DB-J-03 | — | `{"kind":"all"}`（缺 v）；`{"v":"1","kind":"all"}`（类型错） | 拒 | DB-J-03 |
| DB-J-04 | 条件 op = param_selected | op = expr；或多出未知键 x | 拒 | DB-J-04 |
| DB-J-05 | — | 顶层为数组 | 拒 | DB-J-05 |
| DB-J-06 | — | 文本合法但非规范化形式（键乱序、带空格） | 封存前引擎校验拒 | DB-J-06 |

### 5.9 删除授权（DB-D，第 3.6 节）

| 编号 | 反向输入（伪造或误用） | 预期 | 失败定位 |
| --- | --- | --- | --- |
| DB-D-01 | 普通路径直接 DELETE 快照行（未授权） | 拒 | DB-D-gate |
| DB-D-02 | 自建 TEMP 表 deleting_profile 并写入目标 ID 后 DELETE | 拒（TEMP 表不起作用） | DB-D-gate |
| DB-D-03 | 授权档案 A，删档案 B 的行 | 拒 | DB-D-gate |
| DB-D-04 | 已授权但未写审计行 | 拒 | DB-D-audit |
| DB-D-05 | 审计行已写，但 U20 中的 audit_id 与之不符（第 4 版：xs_del_audit 已作废，改按 U20 比对） | 拒 | DB-D-audit |
| DB-D-06 | 一次删除提交后，复用同一连接再删 | 拒（finally 已撤销授权） | DB-D-gate |
| DB-D-07 | 档案 A、B 共用配置 C，删 A | C 保留，A 的引用删除；删 B 后 C 被回收 | Q-D-07 |
| DB-D-08 | 删除事务中途失败 | 全部回滚，授权已撤销 | DB-R-04 |
| DB-D-09 | 连接上未注册 xs_del_gate 时 DELETE | 报 no such function，删除失败 | 报错文本 |
| DB-D-10 | 静态检查：在删除模块之外的文件注册 xs_del_* | CI 失败 | check 脚本输出 |
| DB-D-11 | 档案 B 的快照仍引用配置 C，删 A 时回收 C | C 不被删（快照仍引用） | DB-D-gc |
| DB-D-12 | 未授权事务外直接 DELETE 一条无引用配置 | 拒 | DB-D-gc |
| DB-D-13 | 已授权，但配置仍有 profile_config_ref | 拒 | DB-D-gc |
| DB-D-14 | 删除入口之外 UPDATE Branch.base_snapshot_id 为空 | 拒 | DB-D-branch |
| DB-D-15 | 删除入口内 UPDATE Branch，同时改 branch_name | 拒 | DB-D-branch |
| DB-D-16 | 授权档案 A，却置空指向档案 B 快照的 Branch 引用 | 拒 | DB-D-branch |
| DB-D-17 | 未置空 Branch 引用就删快照 | 外键拒，整体回滚 | DB-K |
| DB-D-18 | 已授权删除事务内 UPDATE 或 DELETE deletion_audit、deletion_audit_count | 拒（永不可改删） | DB-D-audit-immutable |
| DB-D-19 | 删除模块之外插入 deletion_audit | 拒 | DB-D-audit-writer |
| DB-D-20 | 删除中途失败 | 回滚后另写一条 success = 0 的审计；成功审计不存在；被删档案数据完整保留 | Q-D-20 |
| DB-D-21 | 删除档案 A | 计数表各 object_type 的 count 等于删除前后实际行数差 | Q-D-21 |
| DB-D-22 | 已授权但连接不在事务中（自动提交）执行 DELETE | 拒（isTransaction 为假，闸门返回 0） | DB-D-gate |
| DB-D-23 | 另一事务进行中时启动删除入口 | 入口拒绝开始，无任何写入 | 入口返回码 |
| DB-D-24 | branch_event 插入在删除事务之外；或 branch_event 某列含快照 ID、档案 ID | 拒；逐列比对无个人标识 | DB-D-branch-event |
| DB-D-25 | （第 4 版，R1）G 已授权，测试钩子把 U20 的 txn_token 改为另一随机值后 DELETE | 拒（条件 c） | DB-D-gate |
| DB-D-26 | （R1）闭包未授权，普通代码自写 U20 一行（任意 token）后 DELETE、插审计 | 皆拒（条件 a）。（终审 R1）本条只证明伪造标记无效；“真实 token 可读也无效”见 DB-D-39 | DB-D-gate、DB-D-audit-writer |
| DB-D-27 | （R1）G 已授权，U20 的 audit_id 被改 | 拒（条件 d） | DB-D-gate |
| DB-D-28 | （R1）G 已授权，U20 的 grant_seq 为上一次入口的值（模拟残留） | 拒（条件 e） | DB-D-gate |
| DB-D-29 | （R1）一次删除 commit() 之后，测试另开事务 DELETE 同档案剩余行（若有）或他档案行 | 拒（G 已撤销，U20 为空） | DB-D-gate |
| DB-D-30 | （R1）第 5 步注入异常 | finally 后 G、W 均撤销，连接不在事务中，U20 为空，被删档案数据完整；随后 DELETE 被拒 | Q-D-30 |
| DB-D-31 | （R2）W armed 窗口内（第 (4) 条第 2 步）尝试 DELETE 受保护行 | 拒（G 未 armed，互斥） | DB-D-gate |
| DB-D-32 | （R2）G armed 窗口内（第 3～6 步）尝试 INSERT deletion_audit | 拒（W 未 armed） | DB-D-audit-writer |
| DB-D-33 | （R2）失败审计（success = 0）后插入计数行 | 拒 | DB-D-audit-count |
| DB-D-34 | （R2）W armed，但插入的 audit_id ≠ U20 audit_id | 拒 | DB-D-audit-writer |
| DB-D-35 | （R1）入口开始时 U20 有残留行 | 入口拒绝开始，无任何写入 | 入口返回码 |
| DB-D-36 | （R2）失败流程：U20 kind = success 而插入 success = 0 的审计；以及失败审计 audit_id′ 与回滚掉的 audit_id 相同 | 前者拒；后者断言二者不同 | DB-D-audit-writer、Q-D-36 |
| DB-D-37 | （R1）静态检查：删除模块内包装函数之外出现字面 COMMIT、ROLLBACK、BEGIN | CI 失败 | check 脚本输出 |
| DB-D-38 | （R1）G 已授权，xs_del_gc 收到的 token 与闭包不符（回收无主配置） | 拒 | DB-D-gc |
| DB-D-39 | （终审 R1）**读取真实 U20 值后伪造调用**：测试钩子在删除事务中 G、W 均未 armed 的三个时点暂停，即 (a) begin() 写入 U20 之后、arm W 之前；(b) 撤销 W 之后、arm G 之前；(c) commit() 撤销 G 之后、删除 U20 之前。在每个时点，测试代码先 `SELECT txn_token, audit_id, grant_seq FROM deletion_txn_marker`，再用读到的真实值：① 直接执行 `SELECT xs_del_gate(本档案, token, audit_id, grant_seq)`、`xs_del_gc(…)`、`xs_audit_write(…, 'success')`；② DELETE 一条受保护行；③ INSERT 一条 deletion_audit 与一条 deletion_audit_count；④ INSERT 一条 branch_event；⑤ DELETE 一条无引用配置 | ① 三个函数均返回 0；② 至 ⑤ 全部被拒；暂停结束后流程继续，最终删除结果与不暂停时相同。测试钩子只存在于测试构建，生产代码不含此钩子（CI 检查） | DB-D-gate、DB-D-gc、DB-D-audit-writer、DB-D-branch-event |

**正向：** 完整删除档案 A（第 4 版补：全程断言 G 与 W 从不同时 armed；结束后 G、W 撤销，U20 为空，连接不在事务中）：

- 级联范围（§10.2）全部 0 行；
- 档案 B 数据不变；
- 审计行只含允许字段；
- 正式库逐表内容哈希不变（DB-X-06）。

### 5.10 哈希与规范化（DB-H，第 6.2 节）

每条的失败定位均为金标向量编号与首个差异字节。

| 编号 | 输入 | 预期 |
| --- | --- | --- |
| DB-H-01 | `{"b":1,"a":2}` 与 `{"a":2,"b":1}` | 规范化文本相同、哈希相同 |
| DB-H-02 | 键按 UTF-16 码元排序：含“甲”“a”“Z”“𠀀”（补充平面）的键 | 顺序按 RFC 8785 |
| DB-H-03 | 预组合“é”（U+00E9）与分解“e + U+0301” | 不归一化，哈希不同 |
| DB-H-04 | CJK 兼容字 U+F900 与统一字 U+8C48 | 哈希不同，原码位保留 |
| DB-H-05 | 字符串含 `"`、`\`、U+0000～U+001F、U+2028 | 转义按 RFC 8785（控制字符小写 \u00xx，U+2028 不转义） |
| DB-H-06 | 孤立代理项 U+D800 | 拒 |
| DB-H-07 | 重复键 `{"a":1,"a":2}` | 解析即拒 |
| DB-H-08 | 非整数数值 1.5（未声明为小数字符串的字段） | 拒 |
| DB-H-09 | 整数超出 ±(2^53 − 1) | 拒 |
| DB-H-10 | −0、NaN、Infinity | 拒 |
| DB-H-11 | 小数字段（经度）"116.400000"（6 位）与 "116.4" | 前者通过；后者按字段刻度规则拒 |
| DB-H-12 | `{"a":null}` 与 `{}` | 视为不同；该字段不允许 null 时拒 |
| DB-H-13 | 有序数组 [A, B] 与 [B, A] | 哈希不同；集合型数组未排序则拒 |
| DB-H-14 | 同一载荷按版本 jcs-1 计算 | 等于冻结的金标哈希 |
| DB-H-15 | 记录 canonicalization_version = jcs-1 时，用 jcs-1 实现校验 | 通过；改用其他版本标识则拒 |
| DB-H-16 | canonicalization_version 不在 F06 登记 | 引擎预检拒；绕过则 DB-X-07 查出（自查） |
| DB-H-17 | 第 6.4 节 (1)：BAZI raw_payload 中 civil_datetime 带秒、longitude 为 dec(4)、SHICHEN 而缺 shichen | 皆拒 |
| DB-H-18 | 第 6.4 节 (2)：params 未按 param_id 排序；布尔值写成 JSON true；空参数集省略 params | 皆拒 |
| DB-H-19 | 第 6.4 节 (3)：result_scope 未排序；变卦 lines 出现 liushen；三柱模式时柱省略而非 null | 皆拒 |
| DB-H-20 | GV-01～GV-14 由数据仓库独立实现生成的期望文本与哈希，同引擎输出逐字节比对 | 全部相等；拒绝集全部被拒 |

### 5.11 跨库与契约一致性（DB-X）

| 编号 | 内容 | 预期 | 失败定位 |
| --- | --- | --- | --- |
| DB-X-01 | 用户库每个三元组在正式库存在且哈希一致 | 0 行违规；造一条错误哈希应被查出 | Q-X-01 |
| DB-X-02 | 正式库无行引用用户库对象 | 0 行 | Q-X-02 |
| DB-X-03 | 依赖中 rule_variant 的 content_hash 等于正式库现值 | 0 行；改一位应查出 | Q-X-03 |
| DB-X-04 | engine_release_id 已登记 | 0 行；未登记应查出 | Q-X-04 |
| DB-X-05 | §12.2 七条查询（第 8.3 节） | 夹具各造一条违例，各条恰好查出 1 行；清除后 0 行 | Q-X-05-1～7 |
| DB-X-06 | 删除前后正式库逐表内容哈希不变 | 相等 | 差异表 |
| DB-X-07 | （自查）用户库各记录的 canonicalization_version 均在正式库 F06 登记；Branch.base_data_release 均在 F01 登记 | 0 行；各造一条未登记值应查出 | Q-X-07 |

---

### 5.12 BLOCKED 与 NON_FORMAL 的界线（DB-B，第 3 版新增，Q-6）

**DB-B-01 阻断路径不得封存为 NON_FORMAL**

- 正向：所经步骤只映射到效果为 NON_FORMAL 的现行阻断（BLK-6 锚点路径）→ 可封存 NON_FORMAL。
- 反向：轨迹中某步骤状态为“完成”，而它映射到现行阻断效果 BLOCKED-FORMAL（例：B4 现行时 BZ-05 年柱完成），仍尝试封存。
- 预期：封存前引擎判定 BLOCKED，不封存；若绕过引擎，查询 Q-B-01 查出。
- 失败定位：Q-B-01。

**DB-B-02 BLOCKER_PATH 原因只能引用 NON_FORMAL 效果**

- 正向：BLOCKER_PATH 原因引用 BLK-6 → LY-06（效果 NON_FORMAL）。
- 反向：BLOCKER_PATH 原因引用 BLK-7 → BZ-03（效果 BLOCKED-FORMAL）。
- 预期：查询 Q-B-02 查出。
- 失败定位：Q-B-02。

**DB-B-03 BLOCKED 只留审计事件**

- 正向：无。
- 反向：G0、G1 各场景执行。
- 预期：
  - 快照、依赖、轨迹、原因四类表行数均不变；
  - 审计事件恰 1 行；
  - block_reason_code 分别为 MISSING_APPROVAL（G0）、BLOCKER_PATH:BLK-6:BZ-05（G1 八字）、DISPUTE_UNRESOLVED:TEST-DSP-LY-DAYBOUND:LY-06（G1 六爻）。
- 失败定位：Q-U-18。

**DB-B-04 没有第三种快照状态**

- 正向：无。
- 反向：尝试以 formal_status = BLOCKED 或 calc_status = CALC_BLOCKED 封存。
- 预期：拒。
- 失败定位：DB-E、DB-U-08。

### 5.13 模拟记录隔离（DB-G，第 4 版新增，R4；P-36 所引 DB-G-01～05 在此补齐定义）

**DB-G-01 引擎仓库：TEST 前缀只在夹具目录**

- 正向：TEST-、TEST-SIM- 前缀的稳定 ID 只出现在 test/fixtures/。
- 反向：在 db/ 或 src/ 某文件写入一个 TEST-SIM- ID。
- 预期：引擎 CI 失败。
- 失败定位：文件与行号。

**DB-G-02 夹具的 data_release 只用 TEST-***

- 正向：夹具 data_release 全为 TEST-G0、TEST-G1、TEST-G1N、TEST-G2。
- 反向：夹具中出现 data_release = 2026.1。
- 预期：引擎 CI 失败。
- 失败定位：夹具文件与记录 ID。

**DB-G-03 夹具只能加载进隔离内存库**

- 正向：夹具加载函数先断言目标连接 `db.location()` 为空，即内存库，再加载。（自查：node:sqlite 对内存库的 location() 返回值，实施时先以内存库实测确认，确认前此条不作通过依据。）
- 反向：用一个 location() 返回文件路径的替身对象调用加载函数。替身不打开任何文件，不生成数据库文件。
- 预期：加载函数拒绝，不执行任何写入。
- 失败定位：加载函数报错。

**DB-G-04 数据仓库：数据资产不含模拟记录**

- 正向：数据仓库 verify.py 扫描数据资产目录（static/、jieqi/、eot/、日柱表所在目录、crosscheck/oracle/，以及将来的正式数据源目录），TEST-SIM-、TEST-G 字样 0 命中。
- 反向：自测用例在临时副本中植入一处 TEST-SIM-。
- 预期：verify.py 失败。
- 范围说明：review/ 中的审核文档讨论模拟项，不在扫描范围内。
- 失败定位：文件与行号。
- 此项是数据仓库 CI 改动，属代码，须用户批准实施后再写。

**DB-G-05 报告的模拟项清单与夹具一致**

- 正向：报告“模拟项清单”所列 S 编号、记录 ID、夹具 sha256，与实际加载的夹具逐项相等，并含第 7.6 节规定的声明原文。
- 反向：清单漏列 S-10，或缺声明原文。
- 预期：检查失败。
- 失败定位：差集。

**DB-G-06 无发布包、无真实治理记录**

- 正向：
  - E2 不产生任何发布包；
  - 引擎 package.json 保持 private，不设发布；
  - 构建产物中的 test/ 不进入任何打包配置；
  - 数据仓库中不新增任何 ApprovalRecord、AdmissionRecord、blocker_change 的真实数据文件。
- 反向：检查脚本发现打包配置包含 test/fixtures，或数据仓库出现上述数据文件。
- 预期：失败。
- 失败定位：配置项或文件。

---
