/**
 * 销售主管视角的 AI 分析（规则解析模式）：
 * 客户流失/下滑预警、目标达成与缺口、团队业绩、周会/月会材料。
 * 数字全部来自指标层（metrics/salesMgmt），AI 只做组织与表述；原因一律列为待核实。
 */
import dayjs from 'dayjs';
import { customers, DEMO_DATE, flows, METRIC_VERSION } from '../data/mock';
import { customerOwner, salesTargets, TARGET_NOTE } from '../data/targets';
import { custMap, flowInScope, fmtMoney, fmtPct, makeMeta, skuLabelById, type PermissionScope } from '../data/query';
import { authBizStatus, compareBy, contribution, currentVersion, latestVersion, monthPeriod, netSalesAmount, inPeriod, periodLabel, type Period } from '../metrics';
import { customerRisks, RISK_RULES, targetProgress, timeProgress, type CustomerRisk, type TargetRow } from '../metrics/salesMgmt';
import type { Authorization, Opportunity, Promotion, Task } from '../data/types';
import type { AiAnswer, AiTable, QuerySpec, TaskDraft } from './engine';
import { runExpiry, runSales } from './engine';

export interface BizContext { opportunities: Opportunity[]; tasks: Task[]; authorizations: Authorization[]; promotions?: Promotion[] }

const MONTH = '2026-10'; // 最近完整自然月
const Q4: Period = { from: '2026-10-01', to: '2027-01-01' };
const Q4_MONTHS = ['2026-10', '2026-11', '2026-12'];
const wan = (n: number) => `${(n / 10000).toFixed(1)}万`;
const pct0 = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);
const due = (d: number) => dayjs(DEMO_DATE).add(d, 'day').format('YYYY-MM-DD');

const custInfo = new Map(customers.map(c => [c.customer_id, { region: c.region, owner: customerOwner(c) }]));
const scopedSales = (scope: PermissionScope) => flows.filter(f => f.customer_id && flowInScope(f, scope));
const scopedTargets = (scope: PermissionScope) => salesTargets.filter(t => scope.regions.includes(t.region));
const scopedCustomers = (scope: PermissionScope) => customers.filter(c => scope.regions.includes(c.region));

function risks(scope: PermissionScope) { return customerRisks(scopedSales(scope), scopedCustomers(scope), customerOwner, MONTH, DEMO_DATE); }
function monthTargets(scope: PermissionScope, month = MONTH) { return targetProgress(scopedSales(scope), scopedTargets(scope), id => custInfo.get(id), monthPeriod(month), [month]); }
function q4Targets(scope: PermissionScope) { return targetProgress(scopedSales(scope), scopedTargets(scope), id => custInfo.get(id), Q4, Q4_MONTHS); }
const sum = (rows: TargetRow[], k: 'target' | 'actual') => rows.reduce((a, r) => a + r[k], 0);

function riskDraft(r: CustomerRisk, qid: string): TaskDraft {
  const c = custMap.get(r.customer_id)!;
  return { title: `回访 ${c.name}（${r.level}风险）`, object_type: '客户', object_ids: [r.customer_id], suggestion: `了解采购与库存变化，确认是否有竞品替代或付款、配送问题；信号：${r.signals.join('；')}`, assignee: r.owner, due_at: due(r.level === '高' ? 3 : 7), evidence_desc: `${qid}：客户风险预警（${MONTH}，规则 demo_v1）` };
}
const riskCaliber = (scope: PermissionScope) => [
  `本月：${periodLabel(monthPeriod(MONTH))}；基准：前${RISK_RULES.baseMonths}个完整月的月均净销售额`,
  `常规客户：基准期内 ≥${RISK_RULES.regularMonths} 个月有净销售；基期为0的新客户不判风险`,
  `信号与分值：仅退货 +3；较上月降≥30%且≥2万 +2（≥5万 +3）；常规客户较均值降≥30% +1（≥50% +2）；常规客户超过 max(30天, 常规间隔×2) 未进货 +2（≥45天 +3）；连续2个月下滑 +1`,
  `风险等级：总分 ≥${RISK_RULES.highScore} 为高，2–3 为中（演示阈值，可配置）`,
  '负责人：按客户所在区域映射（演示数据）',
  `权限：${scope.summary}（服务端注入）`,
];

/** 客户流失 / 下滑预警 */
export function runChurn(scope: PermissionScope, q: string): AiAnswer {
  const all = risks(scope);
  const owner = ['陈晓', '林悦', '赵宁'].find(p => q.includes(p));
  const list = owner ? all.filter(r => r.owner === owner) : all;
  const high = list.filter(r => r.level === '高');
  const meta = makeMeta(scope, { 本月: MONTH, 基准: `前${RISK_RULES.baseMonths}个月`, ...(owner ? { 负责人: owner } : {}) });
  const spec: QuerySpec = { domain: 'sales', metric: 'net_sales_amount', group_by: ['customer_id'], period: [monthPeriod(MONTH).from, monthPeriod(MONTH).to], filters: {}, sort: 'risk_score descending', metric_version: METRIC_VERSION };
  const atRisk = list.reduce((a, r) => a + r.atRisk, 0);
  const byOwner = [...new Set(list.map(r => r.owner))].map(o => `${o} ${list.filter(r => r.owner === o).length} 家（高 ${list.filter(r => r.owner === o && r.level === '高').length}）`);
  const spike = list.filter(r => r.cur >= r.baseAvg && r.momDelta < 0);
  const table: AiTable = {
    columns: [{ key: 'level', title: '风险' }, { key: 'name', title: '客户' }, { key: 'owner', title: '负责人' }, { key: 'avg', title: '6月均值', align: 'right' }, { key: 'prev', title: '上月', align: 'right' }, { key: 'cur', title: '本月', align: 'right' }, { key: 'last', title: '最后进货' }, { key: 'signals', title: '触发信号' }],
    rows: list.map(r => ({ key: r.customer_id, level: r.level === '高' ? '▲ 高' : '● 中', name: custMap.get(r.customer_id)!.name, owner: r.owner, avg: fmtMoney(r.baseAvg), prev: fmtMoney(r.prevMonth), cur: fmtMoney(r.cur), last: r.lastSaleDate ? `${r.lastSaleDate}（${r.daysSinceSale}天前）` : '—', signals: r.signals.join('；') })),
  };
  return {
    text: list.length
      ? `${owner ? `${owner}名下` : '当前范围内'}识别到 ${list.length} 家风险客户：高风险 ${high.length} 家、中风险 ${list.length - high.length} 家。按近6月均值估算的潜在缺口合计 ${fmtMoney(atRisk)}。${owner ? '' : `\n分布：${byOwner.join('；')}。`}`
      : '当前范围内未识别到触发预警规则的客户。',
    kpis: [
      { label: '风险客户', value: `${list.length} 家`, note: `高 ${high.length} · 中 ${list.length - high.length}`, tone: 'warn' },
      { label: '潜在缺口（月）', value: wan(atRisk), note: '6月均值 − 本月', tone: 'down' },
      { label: '超30天未进货', value: `${list.filter(r => (r.daysSinceSale ?? 0) >= 30).length} 家`, note: '常规客户' },
    ],
    observed: [
      ...high.slice(0, 4).map(r => `${custMap.get(r.customer_id)!.name}（${r.owner}）：${r.signals.join('，')}。`),
      ...(spike.length ? [`${spike.map(r => custMap.get(r.customer_id)!.name).join('、')} 本月较上月明显下降，但仍不低于自身6月均值，上月可能存在集中采购。`] : []),
    ],
    toVerify: ['客户采购计划调整、竞品替代、回款或配送问题、院内政策变化等原因无法从流向数据得出，需要负责人回访核实。', '流向数据存在上报延迟时，"未进货"可能是数据未到，建议同时核对数据接收情况。'],
    table, spec, meta, caliber: riskCaliber(scope),
    taskDrafts: high.slice(0, 3).map(r => riskDraft(r, meta.query_id)),
    links: [{ label: '在销售对比中按客户查看', to: `/sales-compare?cur=${MONTH}&base=2026-09&dim=customer` }, { label: '打开客户汇总', to: '/customers' }],
  };
}

/** 目标达成与缺口 */
export function runTarget(scope: PermissionScope): AiAnswer {
  const m = monthTargets(scope);
  const qRows = q4Targets(scope);
  const tp = timeProgress(Q4, DEMO_DATE);
  const mT = sum(m, 'target'), mA = sum(m, 'actual');
  const qT = sum(qRows, 'target'), qA = sum(qRows, 'actual');
  const qExpected = qT * tp.ratio;
  const needDaily = tp.remaining > 0 ? (qT - qA) / tp.remaining : 0;
  const rk = risks(scope);
  const meta = makeMeta(scope, { 月度: MONTH, 季度: '2026Q4', 时间进度截至: DEMO_DATE });
  const rows = m.map(r => {
    const q = qRows.find(x => x.key === r.key)!;
    const pot = rk.filter(x => x.owner === r.owner && custInfo.get(x.customer_id)?.region === r.key.split('|')[2]).reduce((a, x) => a + x.atRisk, 0);
    return { key: r.key, area: `${r.owner} · ${r.area}`, target: fmtMoney(r.target), actual: fmtMoney(r.actual), rate: pct0(r.rate), gap: r.gap > 0 ? fmtMoney(r.gap) : '已达成', q4: `${pct0(q.rate)}（时间 ${pct0(tp.ratio)}）`, pot: pot ? fmtMoney(pot) : '—', _rate: r.rate ?? 0 };
  }).sort((a, b) => a._rate - b._rate);
  const worst = rows[0];
  const recover = rk.filter(r => r.atRisk > 0).sort((a, b) => b.atRisk - a.atRisk).slice(0, 6);
  const recoverSum = recover.reduce((a, r) => a + r.atRisk, 0);
  const mGap = mT - mA;
  return {
    text: `${MONTH.replace('-', '年')}月目标 ${fmtMoney(mT)}，实际 ${fmtMoney(mA)}，达成率 ${pct0(mT > 0 ? mA / mT : null)}，缺口 ${fmtMoney(mGap)}。\n四季度目标 ${fmtMoney(qT)}，截至 ${DEMO_DATE} 完成 ${fmtMoney(qA)}（${pct0(qT > 0 ? qA / qT : null)}），时间进度 ${pct0(tp.ratio)}，${qA >= qExpected ? `领先时间进度 ${fmtMoney(qA - qExpected)}` : `落后时间进度 ${fmtMoney(qExpected - qA)}`}；剩余 ${tp.remaining} 天需日均 ${fmtMoney(Math.round(needDaily))}。`,
    kpis: [
      { label: '10月达成率', value: pct0(mT > 0 ? mA / mT : null), note: `缺口 ${wan(mGap)}`, tone: mA >= mT ? 'up' : 'down' },
      { label: 'Q4 完成进度', value: pct0(qT > 0 ? qA / qT : null), note: `时间进度 ${pct0(tp.ratio)}`, tone: qA >= qExpected ? 'up' : 'warn' },
      { label: '剩余需日均', value: wan(needDaily), note: `剩余 ${tp.remaining} 天` },
    ],
    observed: [
      `达成率最低：${worst.area}，${worst.rate}，缺口 ${worst.gap}。`,
      `风险客户恢复潜力（回到自身6月均值）前6家合计 ${fmtMoney(recoverSum)}，可覆盖10月缺口的 ${pct0(mGap > 0 ? Math.min(1, recoverSum / mGap) : null)}：${recover.map(r => `${custMap.get(r.customer_id)!.name} ${wan(r.atRisk)}`).join('、')}。`,
    ],
    toVerify: ['恢复潜力按客户自身6月均值估算，是补缺口的优先排查方向，不是销量预测；能否恢复取决于回访结果。', '目标为演示数据，实际目标口径（含税/未税、是否含商业调拨）需与业务确认。'],
    table: { columns: [{ key: 'area', title: '负责人 · 区域' }, { key: 'target', title: '10月目标', align: 'right' }, { key: 'actual', title: '实际', align: 'right' }, { key: 'rate', title: '达成率', align: 'right' }, { key: 'gap', title: '缺口', align: 'right' }, { key: 'q4', title: 'Q4进度' }, { key: 'pot', title: '风险客户恢复潜力', align: 'right' }], rows },
    meta,
    caliber: [TARGET_NOTE, '实际：同口径净销售额 = 销售 − 退货（未税），按客户所属区域与负责人归集', `时间进度：${periodLabel(Q4)} 共 ${tp.total} 天，截至 ${DEMO_DATE} 已过 ${tp.elapsed} 天（流向数据至 11-02）`, '达成率：目标>0 时计算', `权限：${scope.summary}（服务端注入）`],
    taskDrafts: recover.slice(0, 2).map(r => ({ ...riskDraft(r, meta.query_id), title: `补缺口：回访 ${custMap.get(r.customer_id)!.name}`, suggestion: `恢复潜力约 ${wan(r.atRisk)}（回到6月均值）；了解本月采购下降原因与11月需求` })),
    links: [{ label: '打开销售对比', to: `/sales-compare?cur=${MONTH}&base=2026-09&dim=customer` }],
  };
}

function teamRows(scope: PermissionScope, biz?: BizContext) {
  const m = monthTargets(scope);
  const rk = risks(scope);
  const owners = [...new Set(m.map(r => r.owner))];
  const prev = monthPeriod(dayjs(`${MONTH}-01`).subtract(1, 'month').format('YYYY-MM'));
  const fs = scopedSales(scope);
  return owners.map(o => {
    const rows = m.filter(r => r.owner === o);
    const target = sum(rows, 'target'), actual = sum(rows, 'actual');
    const prevAmt = netSalesAmount(fs.filter(f => custInfo.get(f.customer_id!)?.owner === o && inPeriod(f.biz_date, prev)));
    const opps = biz?.opportunities.filter(x => x.owner === o && !['合作确认', '关闭未达成'].includes(x.stage)) ?? [];
    const overdueOpp = opps.filter(x => x.next_date && x.next_date < DEMO_DATE).length;
    const tasks = biz?.tasks.filter(t => t.assignee === o && (t.status === '待处理' || t.status === '处理中')) ?? [];
    const overdueTask = tasks.filter(t => t.due_at < DEMO_DATE).length;
    return { owner: o, target, actual, rate: target > 0 ? actual / target : null, mom: prevAmt > 0 ? (actual - prevAmt) / prevAmt : null, risk: rk.filter(r => r.owner === o).length, high: rk.filter(r => r.owner === o && r.level === '高').length, opps: opps.length, overdueOpp, tasks: tasks.length, overdueTask };
  });
}

/** 团队 / 负责人业绩 */
export function runTeam(scope: PermissionScope, biz?: BizContext): AiAnswer {
  const t = teamRows(scope, biz);
  const meta = makeMeta(scope, { 月份: MONTH, 维度: '负责人' });
  const attention = t.filter(r => (r.rate ?? 1) < 0.85 || r.high >= 3 || r.overdueOpp + r.overdueTask >= 2);
  return {
    text: `${MONTH} 共 ${t.length} 位负责人。${attention.length ? `需要关注：${attention.map(r => r.owner).join('、')}。` : '暂无需要重点关注的负责人。'}`,
    observed: t.map(r => `${r.owner}：达成 ${pct0(r.rate)}，环比 ${fmtPct(r.mom)}；风险客户 ${r.risk} 家（高 ${r.high}）；在跟招商机会 ${r.opps} 个，逾期跟进 ${r.overdueOpp}；待办 ${r.tasks} 个，逾期 ${r.overdueTask}。`),
    toVerify: ['业绩差异可能受区域客户结构、目标分配和上月集中采购影响，不宜直接作为个人评价依据。'],
    table: { columns: [{ key: 'owner', title: '负责人' }, { key: 'target', title: '10月目标', align: 'right' }, { key: 'actual', title: '实际', align: 'right' }, { key: 'rate', title: '达成率', align: 'right' }, { key: 'mom', title: '环比', align: 'right' }, { key: 'risk', title: '风险客户', align: 'right' }, { key: 'opps', title: '招商机会(逾期)', align: 'right' }, { key: 'tasks', title: '待办(逾期)', align: 'right' }],
      rows: t.map(r => ({ key: r.owner, owner: r.owner, target: fmtMoney(r.target), actual: fmtMoney(r.actual), rate: pct0(r.rate), mom: fmtPct(r.mom), risk: `${r.risk}（高${r.high}）`, opps: `${r.opps}（${r.overdueOpp}）`, tasks: `${r.tasks}（${r.overdueTask}）` })) },
    meta,
    caliber: [TARGET_NOTE, '客户归属：按区域映射负责人；招商机会与待办按记录上的负责人统计', '"需要关注"规则：达成率<85%、高风险客户≥3家或逾期事项≥2项（演示阈值）', `权限：${scope.summary}`],
  };
}

/** 周会 / 月会材料 */
export function runMeeting(scope: PermissionScope, biz: BizContext | undefined, q: string): AiAnswer {
  const kind = /月会/.test(q) ? '月度经营会' : '销售周会';
  const target = runTarget(scope);
  const churn = runChurn(scope, '');
  const team = teamRows(scope, biz);
  const sales = runSales({ domain: 'sales', metric: 'net_sales_amount', group_by: ['customer_id'], period: [monthPeriod(MONTH).from, monthPeriod(MONTH).to], comparison: [monthPeriod('2026-09').from, monthPeriod('2026-09').to], filters: {}, sort: 'delta_amount ascending', limit: 5, metric_version: METRIC_VERSION, analysis: 'contribution' }, scope);
  const exp = runExpiry(90, scope);
  const opps = biz?.opportunities ?? [];
  const active = opps.filter(o => !['合作确认', '关闭未达成'].includes(o.stage));
  const stages = [...new Set(active.map(o => o.stage))].map(s => `${s} ${active.filter(o => o.stage === s).length}`);
  const overdueOpps = active.filter(o => o.next_date && o.next_date < DEMO_DATE);
  const auths = biz?.authorizations ?? [];
  const expAuth = auths.filter(a => authBizStatus(a, DEMO_DATE) === '生效中' && dayjs(currentVersion(a)!.valid_to).diff(DEMO_DATE, 'day') <= 30);
  const pendAuth = auths.filter(a => latestVersion(a).review === '待确认');
  const tasks = (biz?.tasks ?? []).filter(t => t.status === '待处理' || t.status === '处理中');
  const overdueTasks = tasks.filter(t => t.due_at < DEMO_DATE);
  const highRisk = (churn.table?.rows ?? []).filter(r => String(r.level).includes('高'));
  const drafts = [...(churn.taskDrafts ?? []).slice(0, 2), ...(exp.taskDrafts ?? [])];
  const meta = makeMeta(scope, { 材料: kind, 月份: MONTH, 生成日: DEMO_DATE });
  const brief = [
    `# ${kind}材料（AI 草稿）`,
    `会议日期：${DEMO_DATE}｜统计期：${periodLabel(monthPeriod(MONTH))}｜${scope.summary}`,
    '',
    '## 一、业绩与目标',
    ...target.text.split('\n').map(x => `- ${x}`),
    ...(target.table?.rows ?? []).map(r => `  - ${r.area}：目标 ${r.target}，实际 ${r.actual}，达成 ${r.rate}，缺口 ${r.gap}`),
    '',
    '## 二、变化归因（环比 9 月）',
    `- ${sales.text}`,
    ...(sales.observed ?? []).map(x => `- ${x}`),
    '',
    '## 三、风险客户',
    `- ${churn.text.split('\n')[0]}`,
    ...highRisk.slice(0, 6).map(r => `  - ▲ ${r.name}（${r.owner}）：${r.signals}`),
    '',
    '## 四、库存风险',
    `- ${exp.text}`,
    ...(exp.observed ?? []).map(x => `- ${x}`),
    '',
    '## 五、招商与授权',
    `- 在跟招商机会 ${active.length} 个：${stages.join('、') || '无'}`,
    `- 跟进逾期 ${overdueOpps.length} 个${overdueOpps.length ? `：${overdueOpps.map(o => `${o.opportunity_id}（${o.owner}）`).join('、')}` : ''}`,
    `- 授权 30 天内到期 ${expAuth.length} 份，待确认 ${pendAuth.length} 份`,
    '',
    '## 六、团队情况',
    ...team.map(r => `- ${r.owner}：达成 ${pct0(r.rate)}，风险客户 ${r.risk}（高 ${r.high}），招商逾期 ${r.overdueOpp}，待办逾期 ${r.overdueTask}`),
    `- 全部待办 ${tasks.length} 个，已逾期 ${overdueTasks.length} 个`,
    '',
    '## 七、下周重点（建议，待会上确认）',
    ...drafts.map((t, i) => `${i + 1}. ${t.title}（${t.assignee}，${t.due_at} 前）`),
    `${drafts.length + 1}. 逾期招商跟进逐项确认下一步与时间`,
    '',
    '## 待核实',
    ...[...(churn.toVerify ?? []), ...(target.toVerify ?? []).slice(0, 1)].map(x => `- ${x}`),
    '',
    `数据来源：查询 ${target.meta?.query_id}、${churn.meta?.query_id}、${sales.meta?.query_id}、${exp.meta?.query_id}；文中数字均引用查询结果。本材料为草稿，未发送。`,
  ].join('\n');
  return {
    text: `已生成${kind}材料草稿，共 7 个部分：业绩与目标、变化归因、风险客户、库存风险、招商与授权、团队情况、下周重点。可编辑后导出，不会自动发送。`,
    kpis: [...(target.kpis ?? []).slice(0, 2), { label: '高风险客户', value: `${highRisk.length} 家`, tone: 'warn' }, { label: '逾期事项', value: `${overdueOpps.length + overdueTasks.length} 项`, note: `招商 ${overdueOpps.length} · 待办 ${overdueTasks.length}` }],
    brief, meta, taskDrafts: drafts,
    caliber: [...(target.caliber ?? []).slice(0, 3), '风险客户、库存与招商口径同各专项分析', `权限：${scope.summary}`],
  };
}

// —— 销售个人业绩（洞察页与 AI 共用）——
export interface RepCard {
  owner: string; areas: string[]; rank: number;
  target: number; actual: number; rate: number | null; prevActual: number; mom: number | null;
  q4Target: number; q4Actual: number; q4Rate: number | null; timeRatio: number;
  activeCust: number; activeCustPrev: number; lostCust: string[]; newCust: string[];
  risk: number; highRisk: number; riskIds: string[];
  topDown: { id: string; delta: number }[]; topSkuDown: { id: string; delta: number }[];
  trend: { month: string; amount: number }[];
  opps: number; overdueOpps: number; promos: number; tasks: number; overdueTasks: number;
}

export function repScorecards(scope: PermissionScope, biz?: BizContext): RepCard[] {
  const fs = scopedSales(scope);
  const mt = monthTargets(scope), qt = q4Targets(scope);
  const rk = risks(scope);
  const tp = timeProgress(Q4, DEMO_DATE);
  const cur = monthPeriod(MONTH), base = monthPeriod('2026-09');
  const months = Array.from({ length: 6 }, (_, i) => dayjs(`${MONTH}-01`).subtract(5 - i, 'month').format('YYYY-MM'));
  const prior6 = { from: dayjs(`${MONTH}-01`).subtract(6, 'month').format('YYYY-MM-DD'), to: cur.from };
  const owners = [...new Set(mt.map(r => r.owner))];
  const cards = owners.map(o => {
    const of = fs.filter(f => custInfo.get(f.customer_id!)?.owner === o);
    const rows = mt.filter(r => r.owner === o), q = qt.filter(r => r.owner === o);
    const target = sum(rows, 'target'), actual = sum(rows, 'actual');
    const prevActual = netSalesAmount(of.filter(f => inPeriod(f.biz_date, base)));
    const q4Target = sum(q, 'target'), q4Actual = sum(q, 'actual');
    const salesCust = (p: Period) => new Set(of.filter(f => f.type === '销售' && inPeriod(f.biz_date, p)).map(f => f.customer_id!));
    const curC = salesCust(cur), prevC = salesCust(base), histC = salesCust(prior6);
    const byCust = compareBy(of, cur, base, f => f.customer_id!).sort((a, b) => a.delta - b.delta);
    const bySku = compareBy(of, cur, base, f => f.sku_id).sort((a, b) => a.delta - b.delta);
    const mine = rk.filter(r => r.owner === o);
    const opps = biz?.opportunities.filter(x => x.owner === o && !['合作确认', '关闭未达成'].includes(x.stage)) ?? [];
    const tasks = biz?.tasks.filter(t => t.assignee === o && (t.status === '待处理' || t.status === '处理中')) ?? [];
    return {
      owner: o, areas: rows.map(r => r.area), rank: 0,
      target, actual, rate: target > 0 ? actual / target : null, prevActual, mom: prevActual > 0 ? (actual - prevActual) / prevActual : null,
      q4Target, q4Actual, q4Rate: q4Target > 0 ? q4Actual / q4Target : null, timeRatio: tp.ratio,
      activeCust: curC.size, activeCustPrev: prevC.size,
      lostCust: [...prevC].filter(id => !curC.has(id)), newCust: [...curC].filter(id => !histC.has(id)),
      risk: mine.length, highRisk: mine.filter(r => r.level === '高').length, riskIds: mine.map(r => r.customer_id),
      topDown: byCust.filter(r => r.delta < 0).slice(0, 3).map(r => ({ id: r.key, delta: r.delta })),
      topSkuDown: bySku.filter(r => r.delta < 0).slice(0, 3).map(r => ({ id: r.key, delta: r.delta })),
      trend: months.map(m => ({ month: m, amount: netSalesAmount(of.filter(f => inPeriod(f.biz_date, monthPeriod(m)))) })),
      opps: opps.length, overdueOpps: opps.filter(x => x.next_date && x.next_date < DEMO_DATE).length,
      promos: biz?.promotions?.filter(p => p.owner === o && p.status === '执行中').length ?? 0,
      tasks: tasks.length, overdueTasks: tasks.filter(t => t.due_at < DEMO_DATE).length,
    };
  });
  [...cards].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).forEach((c, i) => { c.rank = i + 1; });
  return cards;
}

/** 单个销售的业绩分析 */
export function runRep(scope: PermissionScope, biz: BizContext | undefined, owner: string): AiAnswer {
  const card = repScorecards(scope, biz).find(c => c.owner === owner);
  if (!card) return { text: `当前权限范围内没有 ${owner} 负责的区域数据（${scope.summary}）。` };
  const fs = scopedSales(scope).filter(f => custInfo.get(f.customer_id!)?.owner === owner);
  const cur = monthPeriod(MONTH), base = monthPeriod('2026-09');
  const rows = compareBy(fs, cur, base, f => f.customer_id!).sort((a, b) => a.delta - b.delta);
  const c = contribution(rows, 2);
  const delta = card.actual - card.prevActual;
  const rk = risks(scope).filter(r => r.owner === owner);
  const meta = makeMeta(scope, { 负责人: owner, 区域: card.areas.join('、'), 本期: MONTH, 对比期: '2026-09' });
  const n = (id: string) => custMap.get(id)?.name ?? id;
  const qGapToTime = card.q4Actual - card.q4Target * card.timeRatio;
  return {
    text: `${owner}（${card.areas.join('、')}）10月净销售额 ${fmtMoney(card.actual)}，目标 ${fmtMoney(card.target)}，达成 ${pct0(card.rate)}，团队排名第 ${card.rank}；环比 ${fmtMoney(delta)}（${fmtPct(card.mom)}）。\n四季度完成 ${pct0(card.q4Rate)}，${qGapToTime >= 0 ? `领先时间进度 ${fmtMoney(qGapToTime)}` : `落后时间进度 ${fmtMoney(-qGapToTime)}`}。`,
    kpis: [
      { label: '10月达成', value: pct0(card.rate), note: `排名 ${card.rank}`, tone: (card.rate ?? 0) >= 1 ? 'up' : 'down' },
      { label: '环比', value: fmtPct(card.mom), note: wan(delta), tone: delta < 0 ? 'down' : 'up' },
      { label: 'Q4进度', value: pct0(card.q4Rate), note: `时间 ${pct0(card.timeRatio)}`, tone: qGapToTime >= 0 ? 'up' : 'warn' },
      { label: '风险客户', value: `${card.risk} 家`, note: `高风险 ${card.highRisk}`, tone: card.highRisk ? 'warn' : undefined },
    ],
    observed: [
      `变化归因：${c.top.map(r => `${n(r.key)} ${fmtMoney(r.delta)}`).join('、')}，合计占净变化 ${c.share === null ? '—' : (c.share * 100).toFixed(1) + '%'}。`,
      card.topSkuDown.length ? `下降最多的品种：${card.topSkuDown.map(s => `${skuLabelById(s.id)} ${wan(s.delta)}`).join('、')}。` : '无下降品种。',
      `客户结构：10月有销售客户 ${card.activeCust} 家（上月 ${card.activeCustPrev}）；上月有、本月无 ${card.lostCust.length} 家${card.lostCust.length ? `（${card.lostCust.slice(0, 4).map(n).join('、')}）` : ''}；新增 ${card.newCust.length} 家${card.newCust.length ? `（${card.newCust.map(n).join('、')}）` : ''}。`,
      ...(rk.filter(r => r.level === '高').slice(0, 3).map(r => `高风险：${n(r.customer_id)}，${r.signals.slice(0, 2).join('，')}。`)),
      `过程指标：在跟招商机会 ${card.opps} 个（逾期 ${card.overdueOpps}）；执行中推广 ${card.promos} 个；待办 ${card.tasks} 个（逾期 ${card.overdueTasks}）。`,
    ],
    toVerify: ['下降原因（客户采购计划、竞品、配送或回款）需与该负责人沟通及回访核实；数据无法证明个人原因。', '业绩受区域客户结构和目标分配影响，不宜单独作为个人评价依据。'],
    chart: card.trend.map(t => ({ x: t.month, y: t.amount })),
    table: { columns: [{ key: 'name', title: '客户' }, { key: 'base', title: '9月', align: 'right' }, { key: 'cur', title: '10月', align: 'right' }, { key: 'delta', title: '差额', align: 'right' }, { key: 'rate', title: '变化率', align: 'right' }, { key: 'risk', title: '风险' }],
      rows: rows.slice(0, 10).map(r => { const x = rk.find(y => y.customer_id === r.key); return { key: r.key, name: n(r.key), base: fmtMoney(r.base), cur: fmtMoney(r.cur), delta: fmtMoney(r.delta), rate: fmtPct(r.rate), risk: x ? `${x.level === '高' ? '▲ 高' : '● 中'}` : '—' }; }) },
    meta,
    caliber: [TARGET_NOTE, '实际：同口径净销售额（销售 − 退货，未税），按客户归属负责人汇总', '有销售客户：期间内有销售记录的去重客户；新增 = 前6个月无销售', `权限：${scope.summary}`],
    taskDrafts: [
      { title: `与${owner}进行10月业绩1对1沟通`, object_type: '负责人', object_ids: [owner], suggestion: `对齐缺口 ${wan(Math.max(0, card.target - card.actual))} 的补救计划；逐个确认高风险客户回访安排`, assignee: '陈晓', due_at: due(3), evidence_desc: `${meta.query_id}：${owner} 10月业绩分析` },
      ...rk.filter(r => r.level === '高').slice(0, 2).map(r => riskDraft(r, meta.query_id)),
    ],
    links: [{ label: '在销售对比中查看', to: `/sales-compare?cur=${MONTH}&base=2026-09&dim=customer` }],
  };
}
