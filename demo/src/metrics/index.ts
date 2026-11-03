/**
 * 指标与规则层（设计文档第5、6章）：网页与AI共用，确定性计算。
 */
import dayjs from 'dayjs';
import type { Authorization, AuthBiz, AuthVersion, BatchStock, FlowRecord, Region, ScopeItem, Customer } from '../data/types';

export const SALES_TYPES = ['销售', '销售退货'] as const;
export const isSalesFlow = (f: FlowRecord) => f.type === '销售' || f.type === '销售退货';

/** 半开区间 [from, to) */
export interface Period { from: string; to: string }
export const inPeriod = (d: string, p: Period) => d >= p.from && d < p.to;
export const monthPeriod = (m: string): Period => ({ from: `${m}-01`, to: dayjs(`${m}-01`).add(1, 'month').format('YYYY-MM-DD') });
export const periodLabel = (p: Period) => `${p.from} 至 ${dayjs(p.to).subtract(1, 'day').format('YYYY-MM-DD')}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 净销售额：销售为正、退货为负，对带符号金额求和 */
export function netSalesAmount(fs: FlowRecord[]) {
  return r2(fs.filter(isSalesFlow).reduce((a, f) => a + f.amount, 0));
}

/** 净销售量：必须同SKU同单位，返回按SKU的结果 */
export function netQtyBySku(fs: FlowRecord[]) {
  const m = new Map<string, number>();
  fs.filter(isSalesFlow).forEach(f => m.set(f.sku_id, (m.get(f.sku_id) ?? 0) + f.qty));
  return m;
}

export function activeCustomerCount(fs: FlowRecord[], excludeReturnOnly = true) {
  const pos = new Set<string>();
  const any = new Set<string>();
  fs.filter(isSalesFlow).forEach(f => {
    if (!f.customer_id) return;
    any.add(f.customer_id);
    if (f.type === '销售') pos.add(f.customer_id);
  });
  return excludeReturnOnly ? pos.size : any.size;
}

/** 变化率：基期>0才计算；否则返回 null，界面显示"基期为0/负" */
export function changeRate(cur: number, base: number): number | null {
  return base > 0 ? (cur - base) / base : null;
}

export interface CompareRow { key: string; cur: number; base: number; delta: number; rate: number | null; curQty: number; baseQty: number }

/** 两期同口径对比，按维度分解 */
export function compareBy(fs: FlowRecord[], cur: Period, base: Period, keyOf: (f: FlowRecord) => string): CompareRow[] {
  const m = new Map<string, CompareRow>();
  for (const f of fs) {
    if (!isSalesFlow(f)) continue;
    const isCur = inPeriod(f.biz_date, cur);
    const isBase = inPeriod(f.biz_date, base);
    if (!isCur && !isBase) continue;
    const k = keyOf(f);
    const row = m.get(k) ?? { key: k, cur: 0, base: 0, delta: 0, rate: null, curQty: 0, baseQty: 0 };
    if (isCur) { row.cur += f.amount; row.curQty += f.qty; }
    if (isBase) { row.base += f.amount; row.baseQty += f.qty; }
    m.set(k, row);
  }
  return [...m.values()].map(r => {
    const cur = r2(r.cur); const b = r2(r.base);
    return { ...r, cur, base: b, delta: r2(cur - b), rate: changeRate(cur, b) };
  });
}

/** 贡献分解：返回正负贡献，以及前N对象占净变化比例（含抵消项） */
export function contribution(rows: CompareRow[], topN = 2) {
  const total = r2(rows.reduce((a, r) => a + r.delta, 0));
  const sorted = [...rows].sort((a, b) => (total < 0 ? a.delta - b.delta : b.delta - a.delta));
  const top = sorted.slice(0, topN);
  const topSum = r2(top.reduce((a, r) => a + r.delta, 0));
  const offsets = rows.filter(r => Math.sign(r.delta) !== Math.sign(total) && r.delta !== 0);
  const rest = r2(total - topSum);
  return { total, top, topSum, share: total !== 0 ? topSum / total : null, rest, offsetsSum: r2(offsets.reduce((a, r) => a + r.delta, 0)), offsetsCount: offsets.length };
}

// —— 库存规则 ——
export type ExpiryState = '已过期' | '临期' | '正常' | '未知';

export function daysLeft(expiry: string | null, asOf: string) {
  return expiry ? dayjs(expiry).diff(dayjs(asOf), 'day') : null;
}

/** 到期当天是否视为有效，由业务配置（默认：到期当天视为已过期） */
export function expiryState(expiry: string | null, asOf: string, windowDays: number, dueDayValid = false): ExpiryState {
  const d = daysLeft(expiry, asOf);
  if (d === null) return '未知';
  if (d < 0 || (d === 0 && !dueDayValid)) return '已过期';
  if (d <= windowDays) return '临期';
  return '正常';
}

/** 演示口径：可用库存 = 合格且未过期的 (库存 - 已占用)。与原系统"有效库存"不互相替换。 */
export function availableQty(b: BatchStock, asOf: string) {
  const st = expiryState(b.expiry_date, asOf, 0);
  if (b.status !== '合格' || st === '已过期') return 0;
  return Math.max(0, b.qty - b.reserved_qty);
}

/** 临期批次数：按货权+SKU+批号去重，跨仓同批次计1次 */
export function expiringBatchCount(bs: BatchStock[], asOf: string, windowDays: number) {
  const keys = new Set<string>();
  bs.forEach(b => { if (expiryState(b.expiry_date, asOf, windowDays) === '临期') keys.add(`${b.owner_id}|${b.sku_id}|${b.batch_no}`); });
  return keys.size;
}

/** 库存覆盖天数：同SKU可用量 ÷ 近30天日均对外净销量（内部调拨不计）；分母≤0不估算 */
export function coverageDays(skuId: string, bs: BatchStock[], fs: FlowRecord[], asOf: string) {
  const win: Period = { from: dayjs(asOf).subtract(30, 'day').format('YYYY-MM-DD'), to: asOf };
  const net = fs.filter(f => f.sku_id === skuId && isSalesFlow(f) && inPeriod(f.biz_date, win)).reduce((a, f) => a + f.qty, 0);
  const avail = bs.filter(b => b.sku_id === skuId).reduce((a, b) => a + availableQty(b, asOf), 0);
  const daily = net / 30;
  return { window: win, net30: net, daily, available: avail, days: daily > 0 ? avail / daily : null };
}

/** 简化估算：忽略其他批次优先占用，批次到期前预计消化量 */
export function batchSellThrough(b: BatchStock, daily: number, asOf: string) {
  const d = daysLeft(b.expiry_date, asOf) ?? 0;
  const sold = Math.min(b.qty, Math.max(0, Math.round(daily * Math.max(0, d))));
  return { days: d, expectedSold: sold, remaining: b.qty - sold };
}

// —— 授权规则 ——
export function currentVersion(a: Authorization): AuthVersion | undefined {
  return a.versions.find(v => v.version === a.current_version);
}
export function latestVersion(a: Authorization): AuthVersion {
  return a.versions[a.versions.length - 1];
}
/** 业务状态由审核状态、日期和暂停/终止标记推导 */
export function authBizStatus(a: Authorization, asOf: string): AuthBiz {
  if (a.terminated) return '已终止';
  const v = currentVersion(a);
  if (!v || v.review !== '已通过') return '未生效';
  if (asOf > v.valid_to) return '已到期';
  if (asOf < v.valid_from) return '未生效';
  if (a.suspended) return '已暂停';
  return '生效中';
}
/** 授权审核状态：展示最新版本的审核状态 */
export function authReviewStatus(a: Authorization) { return latestVersion(a).review; }

export function scopeComplete(s: ScopeItem) {
  return s.sku_ids.length > 0 && s.regions !== null && s.channels !== null && s.customers !== null && (s.regions === 'ALL' || s.regions.length > 0) && (s.channels === 'ALL' || s.channels.length > 0);
}

export function validateAuthVersion(v: AuthVersion): string[] {
  const errs: string[] = [];
  if (!v.valid_from || !v.valid_to) errs.push('有效期起止必填');
  else if (v.valid_from > v.valid_to) errs.push('有效期起始日期晚于结束日期');
  if (!v.scope_items.length) errs.push('至少需要一条授权范围明细');
  v.scope_items.forEach((s, i) => {
    if (!s.sku_ids.length) errs.push(`第${i + 1}条明细未选择SKU`);
    if (s.regions === null || (Array.isArray(s.regions) && !s.regions.length)) errs.push(`第${i + 1}条明细区域未填写（"全部"需明确选择）`);
    if (s.channels === null || (Array.isArray(s.channels) && !s.channels.length)) errs.push(`第${i + 1}条明细渠道未填写（"全部"需明确选择）`);
    if (s.customers === null) errs.push(`第${i + 1}条明细客户范围未选择`);
  });
  if (!v.basis) errs.push('依据说明必填');
  return errs;
}

/** 单条明细内各维度同时满足才算命中；多条明细取并集 */
export function scopeHit(v: AuthVersion, q: { sku_id: string; region: Region; channel: string; customer_id?: string }) {
  return v.scope_items.some(s => {
    if (!s.sku_ids.includes(q.sku_id)) return false;
    if (s.regions === null || (s.regions !== 'ALL' && !s.regions.includes(q.region))) return false;
    if (s.channels === null || (s.channels !== 'ALL' && !s.channels.includes(q.channel))) return false;
    if (s.customers === null) return false;
    if (s.customers.mode === 'LIST' && q.customer_id && !s.customers.ids.includes(q.customer_id)) return false;
    return true;
  });
}

const overlapArr = <T,>(a: T[] | 'ALL' | null, b: T[] | 'ALL' | null) => {
  if (a === null || b === null) return false;
  if (a === 'ALL' || b === 'ALL') return true;
  return a.some(x => b.includes(x));
};
/** 同主体或不同主体在相同产品/区域/渠道/期限重叠时提示核查（不认定无效） */
export function findOverlaps(target: Authorization, all: Authorization[], asOf: string) {
  const tv = latestVersion(target);
  const res: { other: Authorization; samePartner: boolean }[] = [];
  for (const o of all) {
    if (o.authorization_id === target.authorization_id || o.terminated) continue;
    const ov = currentVersion(o) ?? latestVersion(o);
    if (authBizStatus(o, asOf) === '已到期') continue;
    const dateOverlap = tv.valid_from <= ov.valid_to && ov.valid_from <= tv.valid_to;
    if (!dateOverlap) continue;
    const hit = tv.scope_items.some(a => ov.scope_items.some(b => a.sku_ids.some(s => b.sku_ids.includes(s)) && overlapArr(a.regions, b.regions) && overlapArr(a.channels, b.channels)));
    if (hit) res.push({ other: o, samePartner: o.partner_id === target.partner_id });
  }
  return res;
}

/** 推广客户是否在授权范围内 */
export function customerInScope(v: AuthVersion | undefined, c: Customer, sku_ids: string[]) {
  if (!v) return false;
  return sku_ids.some(sku_id => scopeHit(v, { sku_id, region: c.region, channel: c.type, customer_id: c.customer_id }));
}
