import { flows } from '../data/mock';
import { analyzeFlows, previousRange } from './flowAnalysis';

const sales = (from: string, to: string) => flows.filter(f => (f.type === '销售' || f.type === '销售退货') && f.biz_date >= from && f.biz_date <= to);

describe('流向查询页 AI 分析', () => {
  it('对比期：整月按月平移，非整月按天数前移', () => {
    expect(previousRange('2026-10-01', '2026-10-31')).toEqual(['2026-09-01', '2026-09-30']);
    expect(previousRange('2026-09-01', '2026-10-31')).toEqual(['2026-07-01', '2026-08-31']);
    expect(previousRange('2026-10-11', '2026-10-20')).toEqual(['2026-10-01', '2026-10-10']);
  });
  it('10月销售：96万 vs 120万，前2名贡献 87.5%', () => {
    const a = analyzeFlows('sales', sales('2026-10-01', '2026-10-31'), sales('2026-09-01', '2026-09-30'), ['2026-10-01', '2026-10-31'], null);
    expect(a.answer.text).toContain('¥960,000.00');
    expect(a.movers[0].delta).toBeCloseTo(-150000, 2);
    expect(a.movers[1].delta).toBeCloseTo(-60000, 2);
    expect(a.answer.observed!.join('')).toContain('87.5%');
  });
});
