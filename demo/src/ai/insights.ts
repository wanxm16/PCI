/**
 * AI 经营洞察：规则引擎主动扫描指标层，产出"观察 + 依据 + 待核实 + 下一步"的洞察卡。
 * 数字全部来自指标层；原因不做推断，只列为待核实。
 */
import dayjs from 'dayjs';
import { batches, customers, DEMO_DATE, duplicateConflicts, flows, skus } from '../data/mock';
import { customerOwner, salesTargets } from '../data/targets';
import { custMap, flowInScope, fmtMoney, fmtPct, partnerMap, skuLabelById, type PermissionScope } from '../data/query';
import { batchSellThrough, compareBy, contribution, coverageDays, expiringBatchCount, isSalesFlow, monthPeriod, netSalesAmount, inPeriod } from '../metrics';
import { customerRisks, targetProgress, timeProgress } from '../metrics/salesMgmt';
import type { Authorization, Opportunity, Promotion, Task } from '../data/types';
import { authHealth, clearancePlan, funnelStats, FUNNEL_RULES } from './tier2';

export type InsightCat = '销售' | '目标' | '客户' | '库存' | '招商授权' | '数据质量';
export type InsightLevel = '高' | '中' | '提示';
export interface Insight {
  id: string;
  cat: InsightCat;
  level: InsightLevel;
  title: string;
  metric?: { value: string; unit?: string; label: string };
  points: string[];
  verify?: string;
  ask?: string; // 交给 AI 深入分析的问题
  link?: { label: string; to: string };
  basis: string; // 数据依据（口径简述）
}

const MONTH = '2026-10';
const BASE = '2026-09';
const wan = (n: number) => `${(n / 10000).toFixed(1)}万`;
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

export function buildInsights(scope: PermissionScope, biz: { opportunities: Opportunity[]; tasks: Task[]; authorizations: Authorization[]; promotions?: Promotion[] }): Insight[] {
  const out: Insight[] = [];
  const sf = flows.filter(f => f.customer_id && flowInScope(f, scope));
  const cur = monthPeriod(MONTH), base = monthPeriod(BASE);

  // —— 销售变化 ——
  const net = netSalesAmount(sf.filter(f => inPeriod(f.biz_date, cur)));
  const netB = netSalesAmount(sf.filter(f => inPeriod(f.biz_date, base)));
  const delta = net - netB;
  const byCust = compareBy(sf, cur, base, f => f.customer_id!);
  const c = contribution(byCust, 2);
  out.push({
    id: 'sales-change', cat: '销售', level: netB > 0 && delta / netB <= -0.1 ? '高' : '中',
    title: `10月净销售额环比${delta < 0 ? '下降' : '增长'} ${wan(Math.abs(delta))}，变化集中在 ${c.top.length} 家客户`,
    metric: { value: fmtPct(netB > 0 ? delta / netB : null), label: '环比' },
    points: [
      `本期 ${fmtMoney(net)}，对比期 ${fmtMoney(netB)}，差额 ${fmtMoney(delta)}。`,
      ...c.top.map(r => `${custMap.get(r.key)!.name}：${fmtMoney(r.delta)}`),
      `前2家合计占净变化 ${c.share === null ? '—' : (c.share * 100).toFixed(1) + '%'}。`,
    ],
    verify: '采购计划调整、竞品替代等原因需回访核实。',
    ask: '10月销售下降主要在哪', link: { label: '销售对比', to: `/sales-compare?cur=${MONTH}&base=${BASE}&dim=customer` },
    basis: '净销售额 = 销售 − 退货（未税）；2026-10 vs 2026-09',
  });

  // —— 客户风险 ——
  const rk = customerRisks(sf, customers.filter(x => scope.regions.includes(x.region)), customerOwner, MONTH, DEMO_DATE);
  const high = rk.filter(r => r.level === '高');
  const spike = rk.filter(r => r.cur >= r.baseAvg && r.momDelta < 0);
  if (spike.length) out.push({
    id: 'spike', cat: '销售', level: '提示',
    title: `${spike.map(r => custMap.get(r.customer_id)!.name).join('、')} 9月可能存在集中采购`,
    metric: { value: String(spike.length), unit: '家', label: '涉及客户' },
    points: spike.map(r => `${custMap.get(r.customer_id)!.name}：上月 ${wan(r.prevMonth)} → 本月 ${wan(r.cur)}，仍不低于自身6月均值 ${wan(r.baseAvg)}。`),
    verify: '若9月为一次性备货，10月下降不代表需求流失；需与客户确认。',
    ask: '10月销售下降主要在哪', link: { label: '客户汇总', to: '/customers' },
    basis: '本月、上月与前6个月月均净销售额对比',
  });
  if (rk.length) out.push({
    id: 'churn', cat: '客户', level: high.length ? '高' : '中',
    title: `${rk.length} 家客户出现流失/下滑信号，其中高风险 ${high.length} 家`,
    metric: { value: String(high.length), unit: '家', label: '高风险' },
    points: [
      ...high.slice(0, 3).map(r => `${custMap.get(r.customer_id)!.name}（${r.owner}）：${r.signals.slice(0, 2).join('，')}`),
      `按6月均值估算潜在缺口约 ${wan(rk.reduce((a, r) => a + r.atRisk, 0))}/月。`,
    ],
    verify: '"未进货"也可能是流向上报延迟，回访前先核对数据接收。',
    ask: '哪些客户有流失风险', link: { label: '客户汇总', to: '/customers' },
    basis: '本月对比前6个月均值；仅退货、大额环比下降、超常规间隔未进货等信号评分',
  });
  const silent = rk.filter(r => (r.daysSinceSale ?? 0) >= 30);
  if (silent.length) out.push({
    id: 'silent', cat: '客户', level: '中',
    title: `${silent.length} 家常规客户超过30天未进货`,
    metric: { value: String(silent.length), unit: '家', label: '超30天' },
    points: silent.slice(0, 4).map(r => `${custMap.get(r.customer_id)!.name}：${r.daysSinceSale} 天未进货（常规约 ${r.usualInterval ?? '—'} 天）`),
    ask: '哪些客户有流失风险', link: { label: '销售流向', to: '/flows/sales' },
    basis: '最后一次销售日期距演示日期的天数，与该客户进货间隔中位数对比',
  });

  // —— 目标 ——
  const info = new Map(customers.map(x => [x.customer_id, { region: x.region, owner: customerOwner(x) }]));
  const ts = salesTargets.filter(t => scope.regions.includes(t.region));
  const m = targetProgress(sf, ts, id => info.get(id), cur, [MONTH]);
  const q4p = { from: '2026-10-01', to: '2027-01-01' };
  const q = targetProgress(sf, ts, id => info.get(id), q4p, ['2026-10', '2026-11', '2026-12']);
  const tp = timeProgress(q4p, DEMO_DATE);
  const mT = m.reduce((a, r) => a + r.target, 0), mA = m.reduce((a, r) => a + r.actual, 0);
  const qT = q.reduce((a, r) => a + r.target, 0), qA = q.reduce((a, r) => a + r.actual, 0);
  if (mT > 0) {
    const worst = [...m].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0];
    out.push({
      id: 'target', cat: '目标', level: mA / mT < 0.9 ? '高' : '中',
      title: `10月目标达成 ${pct(mA / mT)}，四季度落后时间进度 ${wan(Math.max(0, qT * tp.ratio - qA))}`,
      metric: { value: pct(mA / mT), label: '10月达成' },
      points: [
        `10月目标 ${fmtMoney(mT)}，实际 ${fmtMoney(mA)}，缺口 ${fmtMoney(mT - mA)}。`,
        `Q4 完成 ${pct(qT > 0 ? qA / qT : null)}，时间进度 ${pct(tp.ratio)}；剩余 ${tp.remaining} 天需日均 ${wan((qT - qA) / Math.max(1, tp.remaining))}。`,
        `达成率最低：${worst.owner} · ${worst.area}（${pct(worst.rate)}）。`,
      ],
      verify: '目标为演示数据，口径需与业务确认。',
      ask: '10月目标完成情况和缺口', link: { label: '销售对比', to: `/sales-compare?cur=${MONTH}&base=${BASE}&dim=region` },
      basis: '目标按负责人×区域设定；实际为同口径净销售额',
    });
  }

  // —— 库存 ——
  const bs = batches.filter(b => scope.warehouses.includes(b.warehouse_id));
  const fAll = flows.filter(f => flowInScope(f, scope));
  const exp90 = expiringBatchCount(bs, DEMO_DATE, 90), exp30 = expiringBatchCount(bs, DEMO_DATE, 30);
  const x = bs.find(b => b.batch_no === 'B2511X1');
  const xs = x ? batchSellThrough(x, coverageDays(x.sku_id, bs, fAll, DEMO_DATE).daily, DEMO_DATE) : null;
  out.push({
    id: 'expiry', cat: '库存', level: exp30 > 0 ? '高' : '中',
    title: `${exp90} 个批次将在90天内到期，其中 ${exp30} 个不足30天`,
    metric: { value: String(exp90), unit: '个', label: '临期批次' },
    points: [
      ...(x && xs ? [`${skuLabelById(x.sku_id)} 批次 B2511X1：${x.qty}${skus.find(s => s.sku_id === x.sku_id)!.unit}，${x.expiry_date} 到期；按近30日日均估算到期前约剩 ${xs.remaining}${skus.find(s => s.sku_id === x.sku_id)!.unit}。`] : []),
      '同一货权+SKU+批号跨仓只计1次。',
    ],
    verify: '估算忽略其他批次优先占用，非销量预测。',
    ask: '查看90天内临期批次', link: { label: '批号库存', to: '/inventory?tab=batch&window=90' },
    basis: '各仓库存快照；日均 = 近30天对外净销量 ÷ 30',
  });
  const skuIds = [...new Set(bs.map(b => b.sku_id))];
  const short = skuIds.map(id => ({ id, c: coverageDays(id, bs, fAll, DEMO_DATE) })).filter(r => r.c.days !== null && r.c.days < 15).sort((a, b) => a.c.days! - b.c.days!);
  if (short.length) out.push({
    id: 'coverage', cat: '库存', level: '中',
    title: `${short.length} 个品种可用库存覆盖不足15天`,
    metric: { value: String(short.length), unit: '个', label: '覆盖<15天' },
    points: short.slice(0, 4).map(r => `${skuLabelById(r.id)}：约 ${r.c.days!.toFixed(0)} 天（可用 ${r.c.available}${skus.find(s => s.sku_id === r.id)!.unit}）`),
    verify: short.some(r => r.c.available === 0) ? '可用库存为 0 可能因冻结/待验，需核对库存状态。' : '按近30天日均估算，销售波动时会有偏差。',
    ask: '这些药品现在有多少库存', link: { label: '药品库存', to: '/inventory' },
    basis: '覆盖天数 = 可用库存 ÷ 近30天日均对外净销量；分母≤0 不估算',
  });
  const lastSale = new Map<string, string>();
  flows.filter(isSalesFlow).forEach(f => { if ((lastSale.get(f.sku_id) ?? '') < f.biz_date) lastSale.set(f.sku_id, f.biz_date); });
  const noSales = skuIds.filter(id => (lastSale.get(id) ?? '') < '2026-08-05');
  if (noSales.length) out.push({
    id: 'nosales', cat: '库存', level: '提示',
    title: `${noSales.length} 个有库存品种近90天无销售`,
    metric: { value: String(noSales.length), unit: '个', label: '无近期销售' },
    points: noSales.map(id => `${skuLabelById(id)}：最后销售 ${lastSale.get(id) ?? '无记录'}`),
    link: { label: '药品库存', to: '/inventory' },
    basis: '近90天（2026-08-05 起）无销售/退货流向',
  });

  // —— 招商授权 ——
  const active = biz.opportunities.filter(o => !['合作确认', '关闭未达成'].includes(o.stage));
  const overdue = active.filter(o => o.next_date && o.next_date < DEMO_DATE);
  if (overdue.length) out.push({
    id: 'opp', cat: '招商授权', level: '中',
    title: `${overdue.length} 个招商机会跟进逾期`,
    metric: { value: String(overdue.length), unit: '个', label: '逾期' },
    points: overdue.map(o => `${o.opportunity_id} ${o.name}（${o.owner}）：计划 ${o.next_date}，已逾期 ${dayjs(DEMO_DATE).diff(o.next_date, 'day')} 天`),
    link: { label: '招商进度', to: '/opportunities?overdue=1' },
    basis: '下次跟进日期早于演示日期，且未合作确认或关闭',
  });

  // —— 第二梯队：去化、漏斗、授权健康 ——
  const plan = clearancePlan(scope);
  if (plan.length) out.push({
    id: 'clearance', cat: '库存', level: plan[0].left <= 30 ? '高' : '中',
    title: `${plan.length} 个临期批次预计到期前消化不完，已匹配候选客户`,
    metric: { value: String(plan.length), unit: '个', label: '需去化' },
    points: plan.slice(0, 3).map(p => `${skuLabelById(p.b.sku_id)} ${p.b.batch_no}：${p.left}天后到期，预计剩余 ${p.remaining}${skus.find(x => x.sku_id === p.b.sku_id)!.unit}；候选 ${p.cands.map(c => c.name).slice(0, 2).join('、') || '无'}`),
    verify: '候选客户的增量需求与近效期接受度需业务确认。',
    ask: '临期库存去化建议', link: { label: '批号库存', to: '/inventory?tab=batch&window=90' },
    basis: '合格、90天内到期；按近30日日均估算剩余；候选=近6个月买过同SKU的客户',
  });
  const fu = funnelStats({ ...biz, promotions: biz.promotions ?? [] });
  if (fu.stuck.length || fu.bottleneck) out.push({
    id: 'funnel', cat: '招商授权', level: fu.stuck.length >= 2 ? '中' : '提示',
    title: `招商漏斗：${fu.stuck.length} 个机会卡在当前阶段超过${FUNNEL_RULES.stuckDays}天${fu.bottleneck ? `，"→${fu.bottleneck.stage}"转化最低` : ''}`,
    metric: { value: String(fu.stuck.length), unit: '个', label: '卡点' },
    points: [`进行中 ${fu.active.length}、合作确认 ${fu.won.length}、关闭 ${fu.closed.length}。`, ...fu.stuck.slice(0, 3).map(x => `${x.o.opportunity_id} ${x.o.name}（${x.o.owner}）：${x.o.stage} ${x.dwell} 天`)],
    verify: '样本较小，转化率仅作趋势参考。',
    ask: '招商漏斗诊断', link: { label: '招商进度', to: '/opportunities' },
    basis: '阶段记录与当前阶段；卡点=进行中且当前阶段停留超阈值',
  });
  const ah = authHealth(scope, { ...biz, promotions: biz.promotions ?? [] });
  const idle = ah.filter(x => x.biz === '生效中' && !x.running.length);
  const badAuth = ah.filter(x => x.issues.some(i => i.level !== '提示'));
  if (badAuth.length) out.push({
    id: 'authhealth', cat: '招商授权', level: badAuth.some(x => x.issues.some(i => i.level === '高')) ? '高' : '中',
    title: `${badAuth.length} 份授权健康度偏低，其中 ${idle.length} 份生效中但无推广`,
    metric: { value: String(badAuth.length), unit: '份', label: '需处理' },
    points: badAuth.slice(0, 3).map(x => `${x.a.authorization_id} ${partnerMap.get(x.a.partner_id)?.name}：${x.issues.map(i => i.text).join('；')}`),
    verify: '范围内销售按授权范围匹配全部流向，不代表合伙人贡献。',
    ask: '授权与推广健康度', link: { label: '合伙人授权', to: '/authorizations' },
    basis: '授权状态、推广执行、范围内近90天销售流向、范围重叠',
  });

  // —— 数据质量 ——
  out.push({
    id: 'dq', cat: '数据质量', level: '提示',
    title: '3 项数据质量事项可能影响统计',
    metric: { value: '3', unit: '项', label: '待复核' },
    points: [`8月文件导入重复 ${duplicateConflicts.length} 条，已按来源ID去重。`, `${skus.filter(s => !s.conversion).map(s => s.sku_id).join('、')} 缺少单位转换规则。`, '上海前置仓快照 11-02 22:00，与其他仓不同时点。'],
    link: { label: '任务中心', to: '/tasks' },
    basis: '导入去重记录、主数据完整性、快照时点',
  });

  const order: Record<InsightLevel, number> = { 高: 0, 中: 1, 提示: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
