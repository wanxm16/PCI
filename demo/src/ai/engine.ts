/**
 * AI编排层（演示：规则解析模式，未接入大模型）。
 * 流程：识别问题与页面上下文 → 构建结构化 query_spec → 服务端注入权限 → 指标层计算 → 组织解释。
 * 模型/解析器只产出 query_spec，不做数值计算；所有数字来自指标层。
 */
import dayjs from 'dayjs';
import { batches, DEMO_DATE, flows, knowledgeDocs, METRIC_VERSION, DATA_AS_OF } from '../data/mock';
import { custMap, flowInScope, fmtMoney, fmtPct, makeMeta, skuLabelById, skuMap, whMap, type PermissionScope, type QueryMeta } from '../data/query';
import { batchSellThrough, compareBy, contribution, coverageDays, daysLeft, expiryState, monthPeriod, netSalesAmount, inPeriod, periodLabel, type Period } from '../metrics';
import type { CustomerType, Region } from '../data/types';
import { runChurn, runMeeting, runRep, runTarget, runTeam, type BizContext } from './manager';
import { runAuthHealth, runClearance, runFunnel } from './tier2';

export interface QuerySpec {
  domain: 'sales' | 'inventory' | 'knowledge' | 'brief';
  metric?: 'net_sales_amount' | 'expiring_batches' | 'stock_qty' | 'trend';
  group_by?: ('sku_id' | 'customer_id' | 'customer_province')[];
  period?: [string, string];
  comparison?: [string, string];
  filters?: { customer_province?: Region; customer_type?: CustomerType; sku_ids?: string[]; window_days?: number };
  sort?: string;
  limit?: number;
  metric_version: string;
  analysis?: 'contribution';
}

export interface AiTable { columns: { key: string; title: string; align?: 'right' }[]; rows: Record<string, any>[] }
export interface TaskDraft { title: string; object_type: string; object_ids: string[]; suggestion: string; assignee: string; due_at: string; evidence_desc: string }
export interface AiAnswer {
  text: string;
  observed?: string[]; // 数据支持的观察
  toVerify?: string[]; // 待核实的解释
  spec?: QuerySpec;
  meta?: QueryMeta;
  caliber?: string[];
  table?: AiTable;
  chart?: { x: string; y: number }[];
  chartUnit?: string; // 缺省为金额（万）；计数类图表传单位，如 '个'
  taskDrafts?: TaskDraft[];
  links?: { label: string; to: string }[];
  resultSkuIds?: string[];
  brief?: string;
  citations?: { title: string; version: string; date: string; snippet: string }[];
  kpis?: { label: string; value: string; note?: string; tone?: 'up' | 'down' | 'warn' }[];
}

const NUM_CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
function parseMonths(q: string): string[] {
  const res: string[] = [];
  const re = /(?:(20\d{2})年)?(十[一二]?|[一二三四五六七八九]|1[0-2]|[1-9])月/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const mon = /\d/.test(m[2]) ? Number(m[2]) : NUM_CN[m[2]];
    const year = m[1] ? Number(m[1]) : mon <= 10 ? 2026 : 2025;
    res.push(`${year}-${String(mon).padStart(2, '0')}`);
  }
  if (/上月|上个月|本月|这个月/.test(q) && !res.length) res.push('2026-10');
  return res;
}
const prevMonth = (m: string) => dayjs(`${m}-01`).subtract(1, 'month').format('YYYY-MM');
const toRange = (p: Period): [string, string] => [p.from, p.to];

function parseRegion(q: string): Region | undefined { return (['浙江', '江苏', '上海'] as Region[]).find(r => q.includes(r)); }
function parseCType(q: string): CustomerType | undefined { return (['医院', '药店', '商业公司'] as CustomerType[]).find(t => q.includes(t)); }

export interface Conversation { lastSpec?: QuerySpec; lastSkuIds?: string[] }
export interface PageContext { page: string; filters?: Record<string, string>; selected?: string[] }

export function ask(question: string, conv: Conversation, scope: PermissionScope, page?: PageContext, biz?: BizContext): AiAnswer {
  const q = question.trim();
  // —— 销售主管视角 ——
  if (/周会|月会|例会|会议材料|开会/.test(q)) return runMeeting(scope, biz, q);
  if (/漏斗|招商转化|卡点|招商机会.*(分析|诊断|推进)/.test(q)) return runFunnel(scope, biz);
  if (/去化|消化不完|处理临期|临期.*(建议|怎么办|客户|处理)/.test(q)) return runClearance(scope);
  if (/健康度|授权.*(健康|闲置|推广)|推广.*(效果|健康|授权)/.test(q)) return runAuthHealth(scope, biz);
  const rep = ['陈晓', '林悦', '赵宁'].find(p => q.includes(p));
  if (rep && !/流失|风险客户/.test(q)) return runRep(scope, biz, rep);
  if (/流失|风险客户|预警客户|下滑客户|不进货|未进货|断货客户/.test(q)) return runChurn(scope, q);
  if (/目标|达成|完成率|缺口|时间进度/.test(q)) return runTarget(scope);
  if (/团队|负责人|业务员|谁需要|人员业绩/.test(q)) return runTeam(scope, biz);
  // —— 多轮追问：只修改对应条件 ——
  const ctype = parseCType(q);
  const region = parseRegion(q);
  if (conv.lastSpec?.domain === 'sales' && /^(只看|仅看|换成|改为|那)/.test(q) && (ctype || region) && !/库存/.test(q)) {
    const spec: QuerySpec = structuredClone(conv.lastSpec);
    spec.filters = { ...spec.filters };
    const changed: string[] = [];
    if (ctype) { spec.filters.customer_type = ctype; changed.push(`客户类型 = ${ctype}`); }
    if (region) { spec.filters.customer_province = region; changed.push(`客户地区 = ${region}`); }
    const ans = runSales(spec, scope);
    ans.text = `已在上一轮条件基础上仅修改：${changed.join('，')}。时间、指标与分组保持不变。\n` + ans.text;
    return ans;
  }
  if (/库存/.test(q) && /(这些|上述|刚才)/.test(q) && conv.lastSkuIds?.length) return runStockForSkus(conv.lastSkuIds, scope, conv.lastSpec);
  if (/简报|报告|周报|月报/.test(q)) return runBrief(scope);
  if (/临期|效期|过期|到期/.test(q) && !/授权/.test(q)) {
    const w = Number(/(\d+)\s*天/.exec(q)?.[1] ?? 90);
    return runExpiry(w, scope);
  }
  if (/制度|手册|政策|资料|规范|怎么|如何|规定/.test(q)) return runKnowledge(q);
  if (/趋势|近12|走势/.test(q)) return runTrend(scope, region);
  if (/销售|销量|净额|下降|增长|变化|对比|比较|贡献/.test(q) || page?.page === 'P09') {
    const months = parseMonths(q);
    const cur = months[0] ?? '2026-10';
    const base = months[1] ?? prevMonth(cur);
    const [c, b] = cur < base ? [base, cur] : [cur, base];
    const groupBy: QuerySpec['group_by'] = /SKU|药品|品种|产品/i.test(q) ? ['sku_id'] : /地区|省/.test(q) ? ['customer_province'] : ['customer_id'];
    const limit = Number(/前\s*(\d+)/.exec(q)?.[1] ?? (/前十/.test(q) ? 10 : 10));
    const spec: QuerySpec = {
      domain: 'sales', metric: 'net_sales_amount', group_by: groupBy,
      period: toRange(monthPeriod(c)), comparison: toRange(monthPeriod(b)),
      filters: { ...(region ? { customer_province: region } : {}), ...(ctype ? { customer_type: ctype } : {}), ...(page?.filters?.region && !region ? { customer_province: page.filters.region as Region } : {}) },
      sort: /增长|上升/.test(q) ? 'delta_amount descending' : 'delta_amount ascending', limit, metric_version: METRIC_VERSION,
      analysis: /主要|原因|为什么|贡献|在哪/.test(q) ? 'contribution' : undefined,
    };
    return runSales(spec, scope);
  }
  return {
    text: '当前为规则解析演示模式，暂未理解该问题。可尝试：\n· 哪些客户有流失风险\n· 10月目标完成情况和缺口\n· 生成本周销售周会材料\n· 比较浙江地区2026年10月和9月的药品净销售额，列出下降最多的前10个SKU\n· 10月销售下降主要在哪\n· 查看90天内临期批次\n· 生成本月经营简报\n· 授权到期了怎么处理（制度检索）',
  };
}

function scopedSalesFlows(scope: PermissionScope, spec: QuerySpec) {
  return flows.filter(f => {
    if (!flowInScope(f, scope) || !f.customer_id) return false;
    const c = custMap.get(f.customer_id)!;
    if (spec.filters?.customer_province && c.region !== spec.filters.customer_province) return false;
    if (spec.filters?.customer_type && c.type !== spec.filters.customer_type) return false;
    return true;
  });
}

function caliberSales(spec: QuerySpec, scope: PermissionScope) {
  return [
    '指标：净销售额 = 销售金额（正）+ 退货金额（负），未税，演示口径 demo_v1',
    `本期：${periodLabel({ from: spec.period![0], to: spec.period![1] })}；对比期：${periodLabel({ from: spec.comparison![0], to: spec.comparison![1] })}`,
    `过滤：${[spec.filters?.customer_province && `客户地区=${spec.filters.customer_province}`, spec.filters?.customer_type && `客户类型=${spec.filters.customer_type}`].filter(Boolean).join('，') || '无'}`,
    `权限：${scope.summary}（服务端注入，不采信模型传入范围）`,
    '变化率：对比期>0时计算；基期为0或负值单独标注',
  ];
}

export function runSales(spec: QuerySpec, scope: PermissionScope): AiAnswer {
  const fs = scopedSalesFlows(scope, spec);
  const cur = { from: spec.period![0], to: spec.period![1] };
  const base = { from: spec.comparison![0], to: spec.comparison![1] };
  const g = spec.group_by![0];
  const keyOf = (f: any) => (g === 'sku_id' ? f.sku_id : g === 'customer_id' ? f.customer_id : custMap.get(f.customer_id)!.region);
  const rows = compareBy(fs, cur, base, keyOf);
  const totalCur = netSalesAmount(fs.filter(f => inPeriod(f.biz_date, cur)));
  const totalBase = netSalesAmount(fs.filter(f => inPeriod(f.biz_date, base)));
  const name = (k: string) => (g === 'sku_id' ? skuLabelById(k) : g === 'customer_id' ? custMap.get(k)?.name ?? k : k);
  const sorted = [...rows].sort((a, b) => (spec.sort?.includes('descending') ? b.delta - a.delta : a.delta - b.delta)).slice(0, spec.limit ?? 10);
  const meta = makeMeta(scope, { 本期: periodLabel(cur), 对比期: periodLabel(base), 分组: g, ...(spec.filters?.customer_province ? { 地区: spec.filters.customer_province } : {}), ...(spec.filters?.customer_type ? { 客户类型: spec.filters.customer_type } : {}) });
  const delta = totalCur - totalBase;
  const ans: AiAnswer = {
    text: `净销售额：本期 ${fmtMoney(totalCur)}，对比期 ${fmtMoney(totalBase)}，变化 ${fmtMoney(delta)}（${fmtPct(totalBase > 0 ? delta / totalBase : null)}）。`,
    spec, meta, caliber: caliberSales(spec, scope),
    table: {
      columns: [{ key: 'name', title: g === 'sku_id' ? 'SKU' : g === 'customer_id' ? '客户' : '地区' }, { key: 'base', title: '对比期', align: 'right' }, { key: 'cur', title: '本期', align: 'right' }, { key: 'delta', title: '差额', align: 'right' }, { key: 'rate', title: '变化率', align: 'right' }],
      rows: sorted.map(r => ({ key: r.key, name: name(r.key), base: fmtMoney(r.base), cur: fmtMoney(r.cur), delta: fmtMoney(r.delta), rate: fmtPct(r.rate) })),
    },
    chart: sorted.map(r => ({ x: name(r.key).slice(0, 12), y: r.delta })),
    resultSkuIds: g === 'sku_id' ? sorted.map(r => r.key) : undefined,
    links: [{ label: '在销售对比中查看', to: `/sales-compare?cur=${cur.from.slice(0, 7)}&base=${base.from.slice(0, 7)}&dim=${g === 'sku_id' ? 'sku' : g === 'customer_id' ? 'customer' : 'region'}${spec.filters?.customer_province ? `&region=${spec.filters.customer_province}` : ''}` }],
  };
  if (spec.analysis === 'contribution') {
    const c = contribution(rows, 2);
    ans.observed = [
      `净变化 ${fmtMoney(c.total)}。`,
      ...c.top.map(r => `${name(r.key)}：${fmtMoney(r.delta)}`),
      `前2个对象合计 ${fmtMoney(c.topSum)}，占净变化 ${c.share === null ? '—' : (c.share * 100).toFixed(1) + '%'}；其他对象合计 ${fmtMoney(c.rest)}。`,
      c.offsetsCount ? `存在 ${c.offsetsCount} 个反向变化对象（抵消项合计 ${fmtMoney(c.offsetsSum)}），已计入"其他"。` : '无反向抵消项。',
    ];
    ans.toVerify = ['客户采购计划调整、竞争品替代、业务跟进情况等原因需拜访或调查资料核实，当前数据不能证明。'];
    if (g === 'customer_id') {
      ans.taskDrafts = c.top.filter(r => r.delta < 0).map(r => ({ title: `核实 ${name(r.key)} 销售下降原因`, object_type: '客户', object_ids: [r.key], suggestion: '联系客户了解采购变化，核对退货与订单', assignee: '陈晓', due_at: dayjs(DEMO_DATE).add(7, 'day').format('YYYY-MM-DD'), evidence_desc: `${meta.query_id}：${periodLabel(cur)} vs ${periodLabel(base)} 差额 ${fmtMoney(r.delta)}` }));
    }
  }
  return ans;
}

function runTrend(scope: PermissionScope, region?: Region): AiAnswer {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(dayjs('2026-10-01').subtract(i, 'month').format('YYYY-MM'));
  const fs = flows.filter(f => flowInScope(f, scope) && f.customer_id && (!region || custMap.get(f.customer_id)!.region === region));
  const data = months.map(m => ({ x: m, y: netSalesAmount(fs.filter(f => inPeriod(f.biz_date, monthPeriod(m)))) }));
  const meta = makeMeta(scope, { 期间: '2025-11 至 2026-10', ...(region ? { 地区: region } : {}) });
  return { text: `近12个完整自然月净销售额趋势${region ? `（${region}）` : ''}。`, chart: data, meta, caliber: ['净销售额 = 销售 − 退货（未税）', `权限：${scope.summary}`], links: [{ label: '打开经营工作台', to: '/' }] };
}

export function runExpiry(windowDays: number, scope: PermissionScope): AiAnswer {
  const bs = batches.filter(b => scope.warehouses.includes(b.warehouse_id));
  const list = bs.filter(b => ['临期', '已过期', '未知'].includes(expiryState(b.expiry_date, DEMO_DATE, windowDays)));
  const keys = new Set(list.filter(b => expiryState(b.expiry_date, DEMO_DATE, windowDays) === '临期').map(b => `${b.owner_id}|${b.sku_id}|${b.batch_no}`));
  const meta = makeMeta(scope, { 窗口: `${windowDays}天`, 快照: '各仓快照时点（见列表）' }, DATA_AS_OF);
  const rows = list.sort((a, b) => (daysLeft(a.expiry_date, DEMO_DATE) ?? 9999) - (daysLeft(b.expiry_date, DEMO_DATE) ?? 9999)).map(b => {
    const cov = coverageDays(b.sku_id, bs, flows.filter(f => flowInScope(f, scope)), DEMO_DATE);
    const st = batchSellThrough(b, cov.daily, DEMO_DATE);
    return { key: `${b.warehouse_id}${b.batch_no}${b.sku_id}`, sku: skuLabelById(b.sku_id), batch: b.batch_no, wh: whMap.get(b.warehouse_id)?.name, status: b.status, exp: b.expiry_date ?? '未知', left: daysLeft(b.expiry_date, DEMO_DATE) ?? '—', state: expiryState(b.expiry_date, DEMO_DATE, windowDays), qty: `${b.qty}${skuMap.get(b.sku_id)!.unit}`, daily: cov.daily > 0 ? cov.daily.toFixed(1) : '近30天净销量非正，暂不估算', est: cov.daily > 0 && st.days > 0 ? `约消化${st.expectedSold}${skuMap.get(b.sku_id)!.unit}，剩余${st.remaining}${skuMap.get(b.sku_id)!.unit}` : '—', snap: b.snapshot_at };
  });
  const x = rows.find(r => r.batch === 'B2511X1');
  return {
    text: `按固定演示日期 ${DEMO_DATE}、${windowDays}天窗口：临期批次 ${keys.size} 个（按货权+SKU+批号去重，跨仓同批次计1次），另含已过期/未知效期记录供核查。`,
    observed: x ? [`${x.sku} 批次 B2511X1 于 2026-11-28 到期，快照库存 ${x.qty}；同口径近30日日均对外净销售 ${x.daily} 盒。忽略其他批次优先占用时，${x.left}天内${x.est}需要核查处理（简化估算，非销量预测）。`] : undefined,
    meta,
    caliber: [`效期状态：已过期 / 临期（≤${windowDays}天）/ 正常 / 未知；到期当天按"已过期"处理（演示配置）`, '日均销量：同SKU近30天对外净销量÷30，内部调拨不计入', '库存为各仓快照，杭州/宁波 11-03 08:00，上海 11-02 22:00', `权限：${scope.summary}`],
    table: { columns: [{ key: 'sku', title: 'SKU' }, { key: 'batch', title: '批号' }, { key: 'wh', title: '仓库' }, { key: 'status', title: '库存状态' }, { key: 'exp', title: '有效期' }, { key: 'left', title: '剩余天数', align: 'right' }, { key: 'state', title: '效期状态' }, { key: 'qty', title: '库存', align: 'right' }, { key: 'daily', title: '近30日日均', align: 'right' }, { key: 'est', title: '到期前估算' }], rows },
    taskDrafts: x ? [{ title: '核查芬舒批次 B2511X1 临期库存', object_type: '批次', object_ids: ['B2511X1'], suggestion: '核查库存状态；联系既有客户核实需求；评估调拨条件', assignee: '陈晓', due_at: '2026-11-10', evidence_desc: `${meta.query_id}：临期批次清单（${windowDays}天窗口）` }] : undefined,
    links: [{ label: '在库存管理中查看批号', to: `/inventory?tab=batch&window=${windowDays}` }],
  };
}

function runStockForSkus(skuIds: string[], scope: PermissionScope, last?: QuerySpec): AiAnswer {
  const bs = batches.filter(b => scope.warehouses.includes(b.warehouse_id) && skuIds.includes(b.sku_id));
  const rows = skuIds.map(id => {
    const list = bs.filter(b => b.sku_id === id);
    const qty = list.reduce((a, b) => a + b.qty, 0);
    return { key: id, sku: skuLabelById(id), qty: `${qty} ${skuMap.get(id)!.unit}`, batches: list.length, snap: [...new Set(list.map(b => b.snapshot_at))].join(' / ') || '—' };
  });
  return {
    text: `以上一轮返回的 ${skuIds.length} 个SKU为目标，读取最新库存快照。注意：库存为快照时点数量，与上一轮销售期间（${last?.period ? periodLabel({ from: last.period[0], to: last.period[1] }) : '—'}）不同。不同SKU单位不同，不做跨SKU合计。`,
    meta: makeMeta(scope, { SKU: `${skuIds.length}个（来自上一轮）` }),
    caliber: ['当前库存：指定快照下的库存记录数量（含冻结、待验），未扣减占用', `权限：${scope.summary}`],
    table: { columns: [{ key: 'sku', title: 'SKU' }, { key: 'qty', title: '当前库存', align: 'right' }, { key: 'batches', title: '批次记录数', align: 'right' }, { key: 'snap', title: '快照时点' }], rows },
    links: [{ label: '打开库存管理', to: '/inventory' }],
  };
}

export function runBrief(scope: PermissionScope): AiAnswer {
  const spec: QuerySpec = { domain: 'sales', metric: 'net_sales_amount', group_by: ['customer_id'], period: toRange(monthPeriod('2026-10')), comparison: toRange(monthPeriod('2026-09')), filters: {}, sort: 'delta_amount ascending', limit: 5, metric_version: METRIC_VERSION, analysis: 'contribution' };
  const s = runSales(spec, scope);
  const e = runExpiry(90, scope);
  const brief = [
    `# 经营简报（草稿）`,
    `统计范围：2026-10-01 至 2026-10-31；对比期 2026-09-01 至 2026-09-30；库存快照 ${DATA_AS_OF}；${scope.summary}`,
    `## 经营概况`, s.text,
    `## 变化贡献`, ...(s.observed ?? []).map(x => `- ${x}`),
    `## 待核实`, ...(s.toVerify ?? []).map(x => `- ${x}`),
    `## 库存风险`, e.text, ...(e.observed ?? []).map(x => `- ${x}`),
    `## 数据质量`, '- 8月文件导入存在2条重复记录，已按来源ID去重（见任务中心）', '- SKU-026 莫匹罗星软膏缺少单位转换规则', '- 上海前置仓快照时点（11-02 22:00）与其他仓不同',
    `## 建议跟进事项`, ...[...(s.taskDrafts ?? []), ...(e.taskDrafts ?? [])].map(t => `- ${t.title}（${t.assignee}，${t.due_at}）`),
    '', `数据来源：查询 ${s.meta?.query_id}、${e.meta?.query_id}；文中数字均引用查询结果。本简报为草稿，未发送。`,
  ].join('\n');
  return { text: '已基于查询结果生成经营简报草稿，可编辑后导出；不会自动发送。', brief, meta: s.meta, taskDrafts: [...(s.taskDrafts ?? []), ...(e.taskDrafts ?? [])], caliber: s.caliber };
}

function runKnowledge(q: string): AiAnswer {
  const terms = ['授权', '到期', '续期', '临期', '导入', '去重', '招商', '资料', '规格', '渠道', '合作确认'].filter(t => q.includes(t));
  const hits = knowledgeDocs.filter(d => d.status === '有效').flatMap(d => d.snippets.filter(s => terms.some(t => s.includes(t) || d.title.includes(t))).map(s => ({ title: d.title, version: d.version, date: d.effective_date, snippet: s })));
  if (!hits.length) return { text: '未在当前有效版本的知识资料中找到依据。请补充资料或联系业务负责人。', citations: [] };
  return { text: `在当前有效资料中找到 ${hits.length} 条依据（已排除失效版本）：`, citations: hits.slice(0, 5) };
}

// —— 招商四页 AI 草稿 ——
export function summarizeFollowups(o: { name: string; followups: { at: string; content: string; feedback: string; next_action: string; next_date?: string }[]; stage: string; next_date?: string; next_action: string }) {
  const overdue = o.next_date && o.next_date < DEMO_DATE;
  const last = o.followups[0];
  return [
    `【进展摘要 · AI草稿】${o.name}`,
    `当前阶段：${o.stage}；共 ${o.followups.length} 次跟进${last ? `，最近一次 ${last.at}：${last.content}，反馈"${last.feedback}"` : '，尚无跟进记录'}。`,
    `下一步：${o.next_action || '未设置'}${o.next_date ? `（计划 ${o.next_date}${overdue ? `，已逾期 ${dayjs(DEMO_DATE).diff(o.next_date, 'day')} 天` : ''}）` : ''}。`,
    `未决事项：${o.followups.filter(f => /缺|待|需/.test(f.feedback)).map(f => f.feedback).join('；') || '无明显未决事项'}`,
    '沟通准备：确认对方关注点、准备目录有效资料版本、明确授权范围边界。',
    '说明：AI不会自动标记合作确认，也不根据文字推断签约。',
  ].join('\n');
}
