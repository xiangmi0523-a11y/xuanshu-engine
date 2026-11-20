# 测试向量输入输出规范（语言无关）

依据【用户裁决 B3-1】D2：测试向量须附明确的输入输出规范；任何语言的实现都按本规范解释同一份 JSON。

## 1. 时间

- 所有时刻按 **UTC 毫秒整数**（自 1970-01-01T00:00:00Z，可为负）在内部表示；秒以下不参与历法判断。
- `fixed_utc8_datetime`：ISO 8601，带 `+08:00`，表示北京钟表时间。
- `fixed_utc8_date`：`YYYY-MM-DD`，北京日期 D。
- 节气时刻取冻结节气表（`data/frozen/jieqi_1900_2100_utc_skyfield.csv`）的 `term_utc_iso` 列；1972 年前该列为 UT1，按契约 B4-12 视作民用时间坐标。

## 2. 由“节气 + 偏移”构造出生时刻

- `{year, term, offset}`：出生时刻 = 该年该节气的交节时刻 + `offset`。
- `offset` 语法：`^[+-]((\d+)h)?((\d+)m)?$`，总分钟 = 符号 ×（时 × 60 + 分），不得时、分都缺省（契约 §13.11.1 文件头）。
- 交节时刻带秒；加偏移后秒数保留，不取整。
- `time_precision = UNKNOWN` 时只取北京日期 D（出生时刻所在北京日期）。
- `offset_mode = AT_TERM_MINUS_1M` 且 `time_precision = SHICHEN`：只用 `fixed_utc8_date` 与 `shichen`，时刻本身不参与。

## 3. 时辰窗口（SHICHEN）

- 时辰按北京钟表时间：子 = [D−1 23:00, D 01:00)，丑 = [D 01:00, D 03:00)，依次类推，左闭右开（契约 §13.3、B4-14）。
- 用 `fixed_utc8_datetime` 表示时辰时，D 取（该时刻 + 1 小时）的北京日期，使该时刻落在所给时辰的窗口内（如 2024-03-10T23:30 + 子时 → D = 2024-03-11，与契约 group 3 注释“D-1 晚子时，D = 2024-03-11”一致）。

## 4. 默认配置

- `utc_offset_seconds = 28800`；`zi_rule = ye_zi_b`；`zi_reference_time = clock`（见 JSON 中 `assumptions`）。

## 5. 断言键

| 键 | 含义 |
| --- | --- |
| `expected_status` | `result_completeness` 相等 |
| `expected_reasons` | `degradation_reasons` 按集合相等 |
| `expected_luck_status` | `luck_cycle.status` 相等 |
| `chart_type` | 相等 |
| `expected_{year,month,day,hour}_pillar` | 对应柱为单值且等于该值 |
| `{year,month,day,hour}_ambiguous` | 对应柱 `ambiguous` 相等（时柱为空时视为 false） |
| `{year,month,day}_candidates` | 对应柱候选 `[A, B]` 相等（A = 交节前 / 换日前） |
| `primary_candidate_{year,month}` | `primary_candidate` 中对应值相等 |
| `primary_candidate_includes` / `_excludes` | `primary_candidate` 的键包含 / 不包含 |
| `requires_user_confirmation` | 相等 |
| `expected_warnings` / `expected_warnings_not_containing` | `warnings` 包含 / 不包含 |
| `expected_flag` | 为字符串时 `flags` 包含；为 `null` 时 `flags` 不含 `SOLAR_TERM_BOUNDARY_AMBIGUOUS` |
| `month_after_term` / `year_after_term` | `true`：该柱单值等于交节后一侧；`false`：等于交节前一侧 |
| `hour_pillar: null` | 时柱值为 null |
| `next_hour_expected` + `next_hour_adjacent` | 出生时刻 +1 小时的时柱等于该值，且与本时柱在六十甲子中相邻 |

## 6. 比对

引擎单元测试可以运行这些向量；与冻结基准的全量比对由 `xuanshu-data/harness/` 独立执行（B4-11、B3-1 D4）。
