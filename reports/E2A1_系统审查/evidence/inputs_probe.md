# 证据：输入约束修复前后（probe）

修复前（2ba5820）：
```
非法干支 甲丑 → 返回 [{"pillar":"庚午","stem_shishen":"偏印","hidden_stems":[{"stem":"丁","shishen":"正财"},{"stem":"己
单字柱 → TypeError  Cannot read properties of undefined (reading 'length')
空数组 → BlockedError PILLARS_INVALID 须给出年、月、日柱（时柱可缺）
两柱 → BlockedError PILLARS_INVALID 须给出年、月、日柱（时柱可缺）
五柱 → 返回 [{"pillar":"庚午","stem_shishen":"偏印","hidden_stems":[{"stem":"丁","shishen":"正财"},{"stem":"己
日柱非法 → 返回 [{"pillar":"庚午","stem_shishen":"偏印","hidden_stems":[{"stem":"丁","shishen":"正财"},{"stem":"己
null 时柱 → TypeError  Cannot read properties of null (reading '0')
yao [7,7,7,7,7] → YAO_INVALID
yao [7,7,7,7,7,5] → YAO_INVALID
yao [7,7,7,7,7,"7"] → YAO_INVALID
null TypeError
```
修复后（6a5a417）：
```
非法干支 甲丑 → BlockedError PILLARS_INVALID [IN-BZ-02] 第 2 柱不是六十甲子之一：甲丑
单字柱 → BlockedError PILLARS_INVALID [IN-BZ-02] 第 2 柱不是六十甲子之一：甲
空数组 → BlockedError PILLARS_INVALID [IN-BZ-01] 须给出 3 柱（年、月、日；时柱未知时不传）或 4 柱
两柱 → BlockedError PILLARS_INVALID [IN-BZ-01] 须给出 3 柱（年、月、日；时柱未知时不传）或 4 柱
五柱 → BlockedError PILLARS_INVALID [IN-BZ-01] 须给出 3 柱（年、月、日；时柱未知时不传）或 4 柱
日柱非法 → BlockedError PILLARS_INVALID [IN-BZ-02] 第 3 柱不是六十甲子之一：壬丑
null 时柱 → BlockedError PILLARS_INVALID [IN-BZ-02] 第 4 柱不是六十甲子之一：null
yao [7,7,7,7,7] → YAO_INVALID
yao [7,7,7,7,7,5] → YAO_INVALID
yao [7,7,7,7,7,"7"] → YAO_INVALID
null DAY_GANZHI_INVALID
```
