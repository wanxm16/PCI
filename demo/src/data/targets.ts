/**
 * 销售目标与客户负责人（演示数据，虚构）。
 * 独立于 mock.ts 的随机序列，不影响已锁定的演示主线数字。
 */
import type { Customer, Region } from './types';

export interface SalesTarget { owner: string; region: Region; area: string; month: string; amount: number }

/** 负责人划分：杭州 → 陈晓；宁波/温州/绍兴 → 林悦；江苏、上海 → 赵宁 */
export function customerOwner(c: Customer): string {
  if (c.region === '浙江') return c.city === '杭州' ? '陈晓' : '林悦';
  return '赵宁';
}

const AREAS: { owner: string; region: Region; area: string; monthly: number }[] = [
  { owner: '陈晓', region: '浙江', area: '浙江·杭州', monthly: 330000 },
  { owner: '林悦', region: '浙江', area: '浙江·宁波/温州/绍兴', monthly: 270000 },
  { owner: '赵宁', region: '江苏', area: '江苏', monthly: 300000 },
  { owner: '赵宁', region: '上海', area: '上海', monthly: 300000 },
];
const MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
/** 12月旺季目标上浮 5% */
export const salesTargets: SalesTarget[] = MONTHS.flatMap(month => AREAS.map(a => ({ owner: a.owner, region: a.region, area: a.area, month, amount: month === '2026-12' ? Math.round(a.monthly * 1.05) : a.monthly })));

export const TARGET_NOTE = '销售目标为演示数据（净销售额口径，未税），按负责人×区域设定';
