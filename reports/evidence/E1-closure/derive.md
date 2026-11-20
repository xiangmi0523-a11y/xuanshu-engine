# E1 收口：期望值推导脚本（独立 Python）

引擎仓库禁止 .py 文件（check:isolation），脚本全文存于此。只读 `data/frozen/` 的两个冻结 CSV，不调用引擎；运行后生成 `vectors/tz_precision.json`。

```python
# 独立推算：只读冻结 CSV（节气表、日柱表），不调用引擎。规则出处见每段注释。
import csv, json, datetime as dt
F="/home/claude/xuanshu-engine/data/frozen/"
S="甲乙丙丁戊己庚辛壬癸"; B="子丑寅卯辰巳午未申酉戌亥"
J=[]
for r in csv.DictReader(open(F+"jieqi_1900_2100_utc_skyfield.csv",encoding="utf-8")):
    J.append((dt.datetime.fromisoformat(r["term_utc_iso"].replace("Z","+00:00")), r["term"], int(float(r["ecliptic_longitude"])), int(r["year"])))
JIE=[j for j in J if j[2]%30==15]
DAYP={r["date"]:r["day_pillar"] for r in csv.DictReader(open(F+"day_pillars_1900_2100.csv",encoding="utf-8"))}
LON2BR={315:"寅",345:"卯",15:"辰",45:"巳",75:"午",105:"未",135:"申",165:"酉",195:"戌",225:"亥",255:"子",285:"丑"}
WUHU={"甲":"丙","己":"丙","乙":"戊","庚":"戊","丙":"庚","辛":"庚","丁":"壬","壬":"壬","戊":"甲","癸":"甲"}   # 五虎遁：寅月天干
WUSHU={"甲":"甲","己":"甲","乙":"丙","庚":"丙","丙":"戊","辛":"戊","丁":"庚","壬":"庚","戊":"壬","癸":"壬"}   # 五鼠遁：子时天干
ORDER="寅卯辰巳午未申酉戌亥子丑"
def gz(stem,branch_offset_from,first_stem):
    return S[(S.index(first_stem)+branch_offset_from)%10]
def year_month(t):  # t: aware UTC；节气按时刻比较（§13.4）
    lc=[j for j in JIE if j[2]==315 and j[0]<=t][-1]; Y=lc[3]
    ys=S[(Y-4)%10]; yb=B[(Y-4)%12]
    jie=[j for j in JIE if j[0]<=t][-1]; mb=LON2BR[jie[2]]; k=ORDER.index(mb)
    return ys+yb, S[(S.index(WUHU[ys])+k)%10]+mb
UTC=dt.timezone.utc; H=dt.timedelta(hours=1)
def bj(t): return t+8*H
def daystr(d): return d.strftime("%Y-%m-%d")
def hour_pillar(stem_day, br):
    ds=DAYP[daystr(stem_day)][0]; return S[(S.index(WUSHU[ds])+B.index(br))%10]+br
def shichen(local_date, sc, off_h):
    b=B.index(sc); D=dt.datetime.fromisoformat(local_date)
    ls = D-H if b==0 else D+(2*b-1)*H                      # 当地窗口起点（§13.3：子时 = [D−1 23:00, D 01:00)）
    ws=(ls-off_h*H).replace(tzinfo=UTC); we=ws+2*H        # 换成 UTC（§6.1 原始时区 → §13.10 归一）
    a0=bj(ws); a1=bj(we)-dt.timedelta(microseconds=1)
    out={"local_window":[ls.strftime("%Y-%m-%d %H:%M"),(ls+2*H).strftime("%Y-%m-%d %H:%M")],
         "utc_window":[ws.strftime("%Y-%m-%dT%H:%MZ"),we.strftime("%Y-%m-%dT%H:%MZ")],
         "utc8_window":[a0.strftime("%Y-%m-%d %H:%M"),bj(we).strftime("%Y-%m-%d %H:%M")]}
    if (a0.hour%2)!=1 or a0.minute!=0:                     # UTC+8 轴上的时辰边界在奇数整点
        out["expect"]={"blocked":"SHICHEN_OFFSET_NOT_ALIGNED"}; return out
    br=B[((a0.hour+1)//2)%12]
    d0,d1=a0.date(),a1.date()
    exp={}
    exp["day"]= [DAYP[daystr(d0)],DAYP[daystr(d1)]] if d0!=d1 else DAYP[daystr(d0)]
    exp["hour"]=hour_pillar(d1 if br=="子" else d0, br)      # 子时时干按 00:00 之后那一日（§13.3）
    inwin=[j for j in JIE if ws<=j[0]<we]
    if inwin:
        n=inwin[0][0]; bfr=year_month(n-dt.timedelta(milliseconds=1)); aft=year_month(n)
        exp["year"]= [bfr[0],aft[0]] if inwin[0][2]==315 else bfr[0]
        exp["month"]=[bfr[1],aft[1]]
    else:
        y,m=year_month(ws); exp["year"]=y; exp["month"]=m
    out["utc8_dates"]=sorted({daystr(d0),daystr(d1)}); out["expect"]=exp; return out
def unknown(local_date, off_h):
    D=dt.datetime.fromisoformat(local_date)
    ws=(D-off_h*H).replace(tzinfo=UTC); we=ws+24*H        # 当地登记日 D 的 UTC 区间
    exp={"day":DAYP[local_date]}                          # §13.3 / N-3：日柱一律按登记的钟表日期 D
    inday=[j for j in JIE if ws<=j[0]<we]
    if inday:
        n=inday[0][0]; bfr=year_month(n-dt.timedelta(milliseconds=1)); aft=year_month(n)
        exp["year"]= [bfr[0],aft[0]] if inday[0][2]==315 else bfr[0]; exp["month"]=[bfr[1],aft[1]]
        exp["warning"]="CROSS_TERM_DAY_HOUR_UNKNOWN"
    else:
        y,m=year_month(ws); exp["year"]=y; exp["month"]=m
    return {"utc_window":[ws.strftime("%Y-%m-%dT%H:%MZ"),we.strftime("%Y-%m-%dT%H:%MZ")],
            "utc8_window":[bj(ws).strftime("%Y-%m-%d %H:%M"),bj(we).strftime("%Y-%m-%d %H:%M")],"expect":exp}
cases=[]
def C(id,prec,date,off,why,sc=None,ref="clock",lon=None):
    r=shichen(date,sc,off) if prec=="SHICHEN" else unknown(date,off)
    if prec=="SHICHEN" and ref=="true_solar": r["expect"]={"blocked":"SHICHEN_TRUE_SOLAR_PENDING"}
    c={"id":id,"time_precision":prec,"local_date":date,"utc_offset_hours":off,"zi_reference_time":ref,**({"shichen":sc} if sc else {}),**({"longitude_deg":lon} if lon is not None else {}),**r,"basis":why}
    cases.append(c)
C("TZ01_SHICHEN_UTC9_ORDINARY","SHICHEN","2024-06-10",9,"当地午时 [11,13) JST = UTC+8 [10,12)，跨巳、午两个时辰；契约只定义 SHICHEN 时柱单值，未定义此情形 → 阻断待裁决",sc="午")
C("TZ02_SHICHEN_UTC9_CROSS_DATE","SHICHEN","2024-03-11",9,"当地子时 [3/10 23:00, 3/11 01:00) JST = UTC+8 [3/10 22:00, 3/11 00:00)，当地日期与 UTC+8 日期不同，且跨亥、子 → 阻断待裁决",sc="子")
C("TZ03_SHICHEN_UTCm5_CROSS_DATE","SHICHEN","2024-01-15",-5,"当地子时 [1/14 23:00, 1/15 01:00) EST = UTC+8 [1/15 12:00, 14:00)，跨午、未 → 阻断待裁决",sc="子")
C("TZ04_SHICHEN_UTCm4_ALIGNED_CROSS_DATE","SHICHEN","2024-07-10",-4,"当地子时 [7/9 23:00, 7/10 01:00) EDT = UTC+8 [7/10 11:00, 13:00) = 午时，整段落在 UTC+8 的 7/10：日柱单值、时柱午（§13.10 归一后按 00:00 换日）",sc="子")
C("TZ05_SHICHEN_UTC6_ALIGNED_TO_ZI","SHICHEN","2023-07-10",6,"当地亥时 [21,23) = UTC+8 [7/10 23:00, 7/11 01:00) = 子时，跨 UTC+8 的 00:00：日柱双解 [7/10, 7/11]、时柱单值、时干按 7/11（§13.3）",sc="亥")
C("TZ06_SHICHEN_UTC0_JIE_IN_WINDOW","SHICHEN","2024-03-05",0,"当地丑时 [01,03) UTC = UTC+8 [09,11) 巳时；惊蛰 02:22:46Z 落在窗口内 → 月柱候选（§13.4 判定层）",sc="丑")
C("TZ07_SHICHEN_UTC8_CONTROL","SHICHEN","2024-03-11",8,"UTC+8 对照：子时 [3/10 23:00, 3/11 01:00)，日柱双解、时柱单值，与原有向量 SHICHEN_ZI_CROSS_DAY_LATE 一致",sc="子")
C("TZ08_SHICHEN_TRUE_SOLAR_UTC8","SHICHEN","2024-06-10",8,"只知时辰且选真太阳时：契约未定义时辰区间如何经真太阳时映射；E1 验收第 4 项按【待定】阻断",sc="午",ref="true_solar",lon=120)
C("TZ09_SHICHEN_TRUE_SOLAR_UTC9","SHICHEN","2024-06-10",9,"同上；真太阳时阻断先于时区对齐检查",sc="午",ref="true_solar",lon=139.69)
C("TZ16_SHICHEN_UTC0530_HALF_HOUR","SHICHEN","2024-06-10",5.5,"半小时时区：当地子时 [6/9 23:00, 6/10 01:00) IST = UTC+8 [6/10 01:30, 03:30)，跨丑、寅 → 阻断待裁决",sc="子")
C("TZ10_UNKNOWN_UTC9_JIE_IN_LOCAL_DAY","UNKNOWN","2018-03-06",9,"惊蛰 2018-03-05 23:28:11 UTC+8 = 3/6 00:28 JST，落在当地登记日 3/6 内 → 交节候选；日柱按登记日 3/6（N-3）")
C("TZ11_UNKNOWN_UTC9_JIE_NOT_IN_LOCAL_DAY","UNKNOWN","2018-03-05",9,"当地 3/5 = UTC+8 [3/4 23:00, 3/5 23:00)，惊蛰 23:28 不在内 → 无候选，月柱取交节前")
C("TZ12_UNKNOWN_UTCm5_JIE_IN_LOCAL_DAY","UNKNOWN","2024-03-04",-5,"惊蛰 2024-03-05 10:22:46 UTC+8 = 3/4 21:22 EST，落在当地登记日 3/4 内 → 交节候选；日柱按登记日 3/4")
C("TZ13_UNKNOWN_UTCm5_JIE_NOT_IN_LOCAL_DAY","UNKNOWN","2024-03-05",-5,"当地 3/5 = UTC+8 [3/5 13:00, 3/6 13:00)，惊蛰 10:22 不在内 → 无候选，月柱取交节后")
C("TZ14_UNKNOWN_UTC8_CONTROL","UNKNOWN","2024-03-05",8,"UTC+8 对照：交节当日 → 候选，与原行为一致")
C("TZ15_UNKNOWN_TRUE_SOLAR_UTCm5","UNKNOWN","2024-03-04",-5,"时辰未知且选真太阳时：不阻断，日柱仍按登记日，不做真太阳时切日（§13.3、N-3）",ref="true_solar",lon=-74.0)
json.dump({"spec":"vectors/SPEC.md §7","generated_by":"独立 Python（只读冻结 CSV，不调用引擎），脚本全文见 reports/evidence/E1-closure/derive.md","cases":cases},open("tz_precision.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
for c in cases: print(c["id"], json.dumps(c["expect"],ensure_ascii=False), c.get("utc8_window"))
```
