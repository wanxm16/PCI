/**
 * 销售主管视角的确定性规则（指标层，网页与AI共用）：
 * 客户流失/下滑预警、目标达成与缺口、负责人业绩。
 * 所有阈值为演示配置，可调整；结论只陈述数据观察，原因需核实。
 */
import dayjs from 'dayjs';
import type { Customer, FlowRecord } from '../data/types';
import type { SalesTarget } from '../data/targets';
import { inPeriod, monthPeriod, netSalesAmount, type Period } from './index';

export const RISK_RULES = {
  baseMonths: 6, // 基准：本月前6个完整月
  regularMonths: 4, // 基准期内≥4个月有净销售 → 视为常规客户
  momDropRate: -0.3, // 较上月下降 ≥30%
  momDropMid: 20000, // 且降幅 ≥2万 → +2
  momDropHigh: 50000, // 且降幅 ≥5万 → +3
  avgDropMid: -0.3, // 较6月均值下降 ≥30% → +1（常规客户）
  avgDropHigh: -0.5, // ≥50% → +2
  silentDays: 30, // 常规客户 ≥30天且超过常规间隔2倍未进货 → +2；≥45天 → +3
  silentHigh: 45,
  highScore: 4,
};

export type RiskLevel = '高' | '中';
export interface CustomerRisk {
  customer_id: string;
  owner: string;
  baseAvg: number; // 近6个月月均净销售额（不含本月）
  prevMonth: number; // 上月净销售额
  cur: number; // 本月净销售额
  change: number | null; // 较均值变化率
  momDelta: number; // 较上月差额
  activeMonths: number; // 基准期有净销售的月份数
  lastSaleDate: string | null;
  daysSinceSale: number | null;
  usualInterval: number | null; // 常规进货间隔（中位数，天）
  signals: string[];
  score: number;
  level: RiskLevel;
  atRisk: number; // 潜在缺口 = max(0, 6月均值 − 本月)
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 客户风险：以 month 为本月，前6个完整月为基准；只纳入基准期有交易（均值>0）的客户，
 * 基期为0的新客户不判风险。评分≥2纳入名单，≥4为高风险。
 */
export function customerRisks(fs: FlowRecord[], customers: Customer[], ownerOf: (c: Customer) => string, month: string, asOf: string): CustomerRisk[] {
  const R = RISK_RULES;
  const prev = Array.from({ length: R.baseMonths }, (_, i) => dayjs(`${month}-01`).subtract(R.baseMonths - i, 'month').format('YYYY-MM'));
  const byCust = new Map<string, FlowRecord[]>();
  fs.forEach(f => { if (f.customer_id && (f.type === '销售' || f.type === '销售退货')) { const l = byCust.get(f.customer_id) ?? []; l.push(f); byCust.set(f.customer_id, l); } });
  const out: CustomerRisk[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const wan = (x: number) => `${(x / 10000).toFixed(1)}万`;
  customers.forEach(c => {
    const list = byCust.get(c.customer_id);
    if (!list) return;
    const monthly = prev.map(m => netSalesAmount(list.filter(f => inPeriod(f.biz_date, monthPeriod(m)))));
    const baseAvg = r2(monthly.reduce((a, b) => a + b, 0) / monthly.length);
    if (baseAvg <= 0) return;
    const activeMonths = monthly.filter(v => v > 0).length;
    const regular = activeMonths >= R.regularMonths;
    const prevMonth = monthly[monthly.length - 1];
    const cf = list.filter(f => inPeriod(f.biz_date, monthPeriod(month)));
    const cur = netSalesAmount(cf);
    const curSales = cf.filter(f => f.type === '销售').reduce((a, f) => a + f.amount, 0);
    const curReturns = cf.filter(f => f.type === '销售退货').reduce((a, f) => a + f.amount, 0);
    const saleDates = [...new Set(list.filter(f => f.type === '销售' && f.biz_date < asOf).map(f => f.biz_date))].sort();
    const lastSaleDate = saleDates[saleDates.length - 1] ?? null;
    const daysSinceSale = lastSaleDate ? dayjs(asOf).diff(lastSaleDate, 'day') : null;
    const usualInterval = median(saleDates.slice(1).map((d, i) => dayjs(d).diff(saleDates[i], 'day')));
    const change = (cur - baseAvg) / baseAvg;
    const momDelta = r2(cur - prevMonth);
    const momRate = prevMonth > 0 ? momDelta / prevMonth : null;

    const signals: string[] = [];
    let score = 0;
    if (curSales === 0 && curReturns < 0) { signals.push('本月仅有退货'); score += 3; }
    if (momRate !== null && momRate <= R.momDropRate && -momDelta >= R.momDropMid) { signals.push(`较上月 -${wan(-momDelta)}（${pct(momRate)}）`); score += -momDelta >= R.momDropHigh ? 3 : 2; }
    if (regular && change <= R.avgDropHigh) { signals.push(`较6月均值 ${pct(change)}`); score += 2; }
    else if (regular && change <= R.avgDropMid) { signals.push(`较6月均值 ${pct(change)}`); score += 1; }
    const silentLimit = Math.max(R.silentDays, (usualInterval ?? 0) * 2);
    if (regular && daysSinceSale !== null && daysSinceSale >= silentLimit) { signals.push(`已 ${daysSinceSale} 天未进货${usualInterval ? `（常规约 ${usualInterval} 天）` : ''}`); score += daysSinceSale >= R.silentHigh ? 3 : 2; }
    if (monthly[monthly.length - 2] > prevMonth && prevMonth > cur && cur < baseAvg) { signals.push('连续2个月下滑'); score += 1; }
    if (score < 2) return;
    out.push({ customer_id: c.customer_id, owner: ownerOf(c), baseAvg, prevMonth, cur, change: r2(change), momDelta, activeMonths, lastSaleDate, daysSinceSale, usualInterval, signals, score, level: score >= R.highScore ? '高' : '中', atRisk: r2(Math.max(0, baseAvg - cur)) });
  });
  return out.sort((a, b) => b.score - a.score || b.atRisk - a.atRisk);
}

export interface TargetRow { key: string; owner: string; area: string; target: number; actual: number; rate: number | null; gap: number }

/** 目标达成：按负责人×区域，实际为同口径净销售额；目标≤0 不计算达成率 */
export function targetProgress(fs: FlowRecord[], targets: SalesTarget[], custRegionOwner: (customerId: string) => { region: string; owner: string } | undefined, period: Period, months: string[]): TargetRow[] {
  const ts = targets.filter(t => months.includes(t.month));
  const keys = [...new Set(ts.map(t => `${t.owner}|${t.area}|${t.region}`))];
  const inP = fs.filter(f => f.customer_id && inPeriod(f.biz_date, period));
  return keys.map(k => {
    const [owner, area, region] = k.split('|');
    const target = ts.filter(t => t.owner === owner && t.area === area).reduce((a, t) => a + t.amount, 0);
    const actual = netSalesAmount(inP.filter(f => { const x = custRegionOwner(f.customer_id!); return x?.owner === owner && x.region === region; }));
    return { key: k, owner, area, target, actual, rate: target > 0 ? r2(actual / target) : null, gap: r2(target - actual) };
  });
}

/** 时间进度：[from, to) 中截至 asOf（不含）已过天数占比 */
export function timeProgress(p: Period, asOf: string) {
  const total = dayjs(p.to).diff(p.from, 'day');
  const elapsed = Math.min(total, Math.max(0, dayjs(asOf).diff(p.from, 'day')));
  return { total, elapsed, remaining: total - elapsed, ratio: total > 0 ? elapsed / total : 0 };
}
