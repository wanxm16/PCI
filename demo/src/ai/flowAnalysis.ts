import dayjs from 'dayjs';
import type { FlowRecord } from '../data/types';
import { custMap, fmtMoney, skuMap, whMap, type QueryMeta } from '../data/query';
import { changeRate } from '../metrics';
import type { AiAnswer } from './engine';

export type FlowKind = 'purchase' | 'sales' | 'warehouse';

/** 规则阈值（演示配置） */
export const FLOW_RULES = { lateImportDays: 3, shortExpiryDays: 180, topN: 5 };

/** 对比期：整月区间按月平移，否则按相同天数向前平移。输入/输出均为界面含端点日期 */
export function previousRange(from: string, to: string): [string, string] {
  const f = dayjs(from); const t = dayjs(to);
  const wholeMonths = f.date() === 1 && t.isSame(t.endOf('month'), 'day');
  if (wholeMonths) {
    const n = t.diff(f, 'month') + 1;
    const pf = f.subtract(n, 'month');
    return [pf.format('YYYY-MM-DD'), pf.add(n, 'month').subtract(1, 'day').format('YYYY-MM-DD')];
  }
  const days = t.diff(f, 'day') + 1;
  return [f.subtract(days, 'day').format('YYYY-MM-DD'), f.subtract(1, 'day').format('YYYY-MM-DD')];
}

export interface FlowTopRow { key: string; label: string; cur: number; base: number; delta: number; rate: number | null; unit?: string; skuId?: string; customerId?: string | null }
export interface FlowAnalysis {
  kpis: { label: string; value: string; tone?: 'up' | 'down' | 'warn' }[];
  bySku: FlowTopRow[];
  byParty: FlowTopRow[];
  partyTitle: string;
  movers: FlowTopRow[]; // 变化贡献最大的对象（金额口径，仅进货/销售）
  answer: AiAnswer;
  prev: [string, string];
}

const partyOf = (f: FlowRecord) => (f.customer_id ? custMap.get(f.customer_id)?.name ?? f.customer_id : f.raw_customer_name || '（未填写）');
const skuName = (id: string) => { const s = skuMap.get(id); return s ? `${s.trade_name} ${s.generic_name}` : id; };

function group(cur: FlowRecord[], base: FlowRecord[], keyOf: (f: FlowRecord) => string, val: (f: FlowRecord) => number) {
  const m = new Map<string, { cur: number; base: number; f: FlowRecord }>();
  cur.forEach(f => { const k = keyOf(f); const x = m.get(k) ?? { cur: 0, base: 0, f }; x.cur += val(f); m.set(k, x); });
  base.forEach(f => { const k = keyOf(f); const x = m.get(k) ?? { cur: 0, base: 0, f }; x.base += val(f); m.set(k, x); });
  return [...m.entries()].map(([k, x]) => ({ k, ...x, delta: x.cur - x.base, rate: changeRate(x.cur, x.base) }));
}

/**
 * 当前查询结果分析：与查询页使用同一筛选结果（cur）和同条件对比期结果（base）。
 * 金额按记录符号累加（退货为负）；数量只按 SKU 汇总、不跨 SKU/单位相加；仓储流向不计金额。
 */
export function analyzeFlows(kind: FlowKind, cur: FlowRecord[], base: FlowRecord[], range: [string, string], meta: QueryMeta | null): FlowAnalysis {
  const prev = previousRange(range[0], range[1]);
  const curLabel = `${range[0]} 至 ${range[1]}`; const prevLabel = `${prev[0]} 至 ${prev[1]}`;
  const money = kind !== 'warehouse';
  const amt = (fs: FlowRecord[]) => fs.reduce((a, f) => a + f.amount, 0);
  const total = amt(cur); const totalBase = amt(base); const rate = changeRate(total, totalBase);
  const pct = (r: number | null) => (r === null ? '—' : `${r > 0 ? '+' : ''}${(r * 100).toFixed(1)}%`);
  const N = FLOW_RULES.topN;

  // 构成：金额口径按 SKU；仓储按 SKU 数量（带单位，各 SKU 单独列示）
  const skuRows = group(cur, base, f => f.sku_id, f => (money ? f.amount : Math.abs(f.qty)))
    .map(r => ({ key: r.k, label: skuName(r.k), cur: r.cur, base: r.base, delta: r.delta, rate: r.rate, unit: skuMap.get(r.k)?.unit, skuId: r.k }))
    .sort((a, b) => Math.abs(b.cur) - Math.abs(a.cur));
  const partyTitle = kind === 'purchase' ? '供应方' : kind === 'sales' ? '客户' : '仓库';
  const partyRows = (kind === 'warehouse'
    ? group(cur, base, f => f.warehouse_id, () => 1).map(r => ({ key: r.k, label: whMap.get(r.k)?.name ?? r.k, cur: r.cur, base: r.base, delta: r.delta, rate: r.rate, unit: '条' }))
    : group(cur, base, partyOf, f => f.amount).map(r => ({ key: r.k, label: r.k, cur: r.cur, base: r.base, delta: r.delta, rate: r.rate, customerId: r.f.customer_id })))
    .sort((a, b) => Math.abs(b.cur) - Math.abs(a.cur));
  const movers = money ? [...partyRows].sort((a, b) => (total - totalBase < 0 ? a.delta - b.delta : b.delta - a.delta)).slice(0, 3) : [];

  // 数据质量
  const late = cur.filter(f => dayjs(f.import_date).diff(f.biz_date, 'day') > FLOW_RULES.lateImportDays);
  const noExpiry = cur.filter(f => !f.expiry_date);
  const unmapped = kind === 'sales' ? cur.filter(f => !f.customer_id) : [];
  const alias = kind === 'sales' ? cur.filter(f => f.customer_id && custMap.get(f.customer_id)?.name !== f.raw_customer_name) : [];
  const returns = cur.filter(f => f.amount < 0);
  const shortExp = kind === 'purchase' ? cur.filter(f => f.expiry_date && dayjs(f.expiry_date).diff(f.biz_date, 'day') < FLOW_RULES.shortExpiryDays) : [];
  const evSources = new Map<string, Set<string>>();
  cur.forEach(f => { const s = evSources.get(f.event_id) ?? new Set(); s.add(f.source_id); evSources.set(f.event_id, s); });
  const multiSource = [...evSources.values()].filter(s => s.size > 1).length;
  const priceSpread = kind === 'purchase' ? [...new Set(cur.map(f => f.sku_id))].map(id => {
    const ps = cur.filter(f => f.sku_id === id).map(f => f.unit_price); const lo = Math.min(...ps); const hi = Math.max(...ps);
    return { id, lo, hi, spread: lo > 0 ? (hi - lo) / lo : 0 };
  }).filter(x => x.spread >= 0.05).sort((a, b) => b.spread - a.spread) : [];

  const observed: string[] = [];
  const toVerify: string[] = [];
  if (!cur.length) observed.push('当前条件下没有记录；可放宽日期或筛选条件。');
  if (money && cur.length) {
    const word = kind === 'sales' ? '净销售额' : '进货金额';
    observed.push(`${word} ${fmtMoney(total)}，对比期（${prevLabel}）${fmtMoney(totalBase)}，${rate === null ? '对比期为0或负，不计算变化率' : `变化 ${pct(rate)}（${fmtMoney(total - totalBase)}）`}。`);
    const top = skuRows.slice(0, 3);
    if (top.length && total > 0) observed.push(`金额前三的药品：${top.map(r => `${r.label} ${fmtMoney(r.cur)}`).join('；')}，合计占 ${((top.reduce((a, r) => a + r.cur, 0) / total) * 100).toFixed(1)}%。`);
    const d = total - totalBase;
    if (d !== 0 && movers.length) {
      const share = movers.slice(0, 2).reduce((a, r) => a + r.delta, 0) / d;
      observed.push(`${d < 0 ? '下降' : '增长'}主要来自：${movers.slice(0, 2).map(r => `${r.label}（${fmtMoney(r.delta)}）`).join('、')}${share > 0 && share <= 1.5 ? `，前2名贡献 ${(share * 100).toFixed(1)}%` : ''}。`);
    }
  }
  if (kind === 'sales' && returns.length) observed.push(`退货 ${returns.length} 条，金额 ${fmtMoney(-amt(returns))}，已按负数计入净销售额。`);
  if (kind === 'warehouse') {
    const inN = cur.filter(f => f.type === '仓储入库').length; const outN = cur.length - inN;
    observed.push(`入库 ${inN} 条、出库 ${outN} 条，涉及 ${skuRows.length} 个SKU；数量按SKU各自单位列示，不跨SKU合计。`);
    if (multiSource) observed.push(`${multiSource} 个业务事件在多个来源系统出现，同一事件的不同视图不能直接相加。`);
  }
  if (shortExp.length) observed.push(`${shortExp.length} 条进货记录到货时剩余效期不足 ${FLOW_RULES.shortExpiryDays} 天（${[...new Set(shortExp.map(f => f.batch_no))].slice(0, 3).join('、')}）。`);
  if (priceSpread.length) observed.push(`同一药品进货单价差异 ≥5%：${priceSpread.slice(0, 2).map(x => `${skuName(x.id)} ${fmtMoney(x.lo)}~${fmtMoney(x.hi)}`).join('；')}。`);
  const dq: string[] = [];
  if (late.length) dq.push(`${late.length} 条导入晚于业务日期 ${FLOW_RULES.lateImportDays} 天以上`);
  if (noExpiry.length) dq.push(`${noExpiry.length} 条有效期缺失`);
  if (unmapped.length) dq.push(`${unmapped.length} 条客户未映射`);
  if (alias.length) dq.push(`${alias.length} 条使用客户别名（已映射到标准客户）`);
  if (dq.length) observed.push(`数据质量：${dq.join('；')}。`);

  if (money && rate !== null && Math.abs(rate) >= 0.1) toVerify.push(`变化原因（客户需求、竞品、断货、开票时点等）不能从流向数据直接得出，需负责人核实。`);
  if (late.length) toVerify.push('迟到导入可能导致近期数据偏低，月初查看上月数据时尤其注意。');
  if (shortExp.length) toVerify.push('短效期到货是否经过特批，需采购确认。');
  if (priceSpread.length) toVerify.push('单价差异可能来自不同供货协议或促销政策，需核对合同。');
  if (kind === 'warehouse') toVerify.push('仓储流向仅用于记录追溯，不作为销售或库存口径。');

  const head = !cur.length ? '当前条件下没有记录。'
    : money ? `${curLabel} 共 ${cur.length} 条${kind === 'sales' ? '销售流向' : '进货记录'}，${kind === 'sales' ? '净销售额' : '金额'} ${fmtMoney(total)}，较对比期 ${pct(rate)}。`
    : `${curLabel} 共 ${cur.length} 条仓储记录，涉及 ${skuRows.length} 个SKU。`;

  const kpis: FlowAnalysis['kpis'] = money
    ? [
      { label: kind === 'sales' ? '净销售额' : '进货金额', value: total >= 10000 || total <= -10000 ? `${(total / 10000).toFixed(1)}万` : fmtMoney(total) },
      { label: '较对比期', value: pct(rate), tone: rate === null ? undefined : rate < 0 ? 'down' : 'up' },
      { label: kind === 'sales' ? '客户数' : '供应方数', value: String(new Set(cur.map(partyOf)).size) },
      { label: '数据质量', value: String(late.length + noExpiry.length + unmapped.length), tone: late.length + noExpiry.length + unmapped.length ? 'warn' : undefined },
    ]
    : [
      { label: '记录数', value: String(cur.length) },
      { label: 'SKU数', value: String(skuRows.length) },
      { label: '多来源事件', value: String(multiSource), tone: multiSource ? 'warn' : undefined },
      { label: '数据质量', value: String(late.length + noExpiry.length), tone: late.length + noExpiry.length ? 'warn' : undefined },
    ];

  return {
    kpis, bySku: skuRows.slice(0, N), byParty: partyRows.slice(0, N), partyTitle, movers, prev,
    answer: {
      text: head, observed, toVerify, meta: meta ?? undefined,
      caliber: [
        `本期 ${curLabel}；对比期 ${prevLabel}（整月按月平移，否则按相同天数前移），其他筛选条件相同`,
        ...(money ? ['金额为未税金额，销售为正、退货为负'] : ['仓储流向不计金额']),
        '数量只按 SKU 及其单位汇总，不跨 SKU 或单位相加',
        `迟到导入：导入日期晚于业务日期 >${FLOW_RULES.lateImportDays} 天（演示配置）`,
        ...(meta ? [`权限：${meta.permission_scope_summary}`] : []),
      ],
    },
  };
}
