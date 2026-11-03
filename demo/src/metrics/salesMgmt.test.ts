import { customers, DEMO_DATE, flows } from '../data/mock';
import { customerOwner, salesTargets } from '../data/targets';
import { monthPeriod } from './index';
import { customerRisks, targetProgress, timeProgress } from './salesMgmt';

describe('销售主管规则', () => {
  const risks = customerRisks(flows, customers, customerOwner, '2026-10', DEMO_DATE);
  const get = (id: string) => risks.find(r => r.customer_id === id);
  it('仅退货客户 C040 为高风险', () => { expect(get('C040')?.level).toBe('高'); expect(get('C040')?.signals).toContain('本月仅有退货'); });
  it('客户A/B 触发较上月大额下降', () => {
    expect(get('C001')?.signals.some(s => s.startsWith('较上月'))).toBe(true);
    expect(get('C001')?.momDelta).toBe(-150000);
    expect(get('C002')?.momDelta).toBe(-60000);
  });
  it('基期为0的新客户 C039 不判风险', () => { expect(get('C039')).toBeUndefined(); });
  it('10月目标 120万、实际 96万', () => {
    const cm = new Map(customers.map(c => [c.customer_id, { region: c.region, owner: customerOwner(c) }]));
    const rows = targetProgress(flows, salesTargets, id => cm.get(id), monthPeriod('2026-10'), ['2026-10']);
    expect(rows.reduce((a, r) => a + r.target, 0)).toBe(1200000);
    expect(Math.round(rows.reduce((a, r) => a + r.actual, 0))).toBe(960000);
  });
  it('Q4 时间进度截至 11-03 为 33/92 天', () => {
    const t = timeProgress({ from: '2026-10-01', to: '2027-01-01' }, DEMO_DATE);
    expect([t.elapsed, t.total]).toEqual([33, 92]);
  });
});
