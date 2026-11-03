import { flows, batches, customers, DEMO_DATE, SKU_X, CUST_A, CUST_B, CUST_NEW, CUST_RETURN_ONLY, duplicateConflicts, rawFlowRecords, initialAuthorizations } from '../data/mock';
import { netSalesAmount, monthPeriod, inPeriod, compareBy, contribution, coverageDays, expiringBatchCount, batchSellThrough, authBizStatus, findOverlaps, changeRate } from './index';

const inM = (m: string) => flows.filter(f => inPeriod(f.biz_date, monthPeriod(m)));

describe('演示数据主线', () => {
  it('9月120万、10月96万净销售额', () => {
    expect(netSalesAmount(inM('2026-09'))).toBe(1200000);
    expect(netSalesAmount(inM('2026-10'))).toBe(960000);
  });
  it('客户A -15万, 客户B -6万, 其他 -3万', () => {
    const rows = compareBy(flows, monthPeriod('2026-10'), monthPeriod('2026-09'), f => f.customer_id!);
    const get = (id: string) => rows.find(r => r.key === id)!;
    expect(get(CUST_A).delta).toBe(-150000);
    expect(get(CUST_B).delta).toBe(-60000);
    const c = contribution(rows, 2);
    expect(c.total).toBe(-240000);
    expect(c.topSum).toBe(-210000);
    expect(c.share).toBeCloseTo(0.875);
    expect(get(CUST_NEW).base).toBe(0);
    expect(get(CUST_NEW).rate).toBeNull();
    const ro = inM('2026-10').filter(f => f.customer_id === CUST_RETURN_ONLY);
    expect(ro.every(f => f.type === '销售退货')).toBe(true);
  });
  it('SKU-X 近30天日均8盒，批次25天预计消化200盒', () => {
    const cov = coverageDays(SKU_X, batches, flows, DEMO_DATE);
    expect(cov.net30).toBe(240);
    expect(cov.daily).toBe(8);
    const b = batches.find(x => x.batch_no === 'B2511X1')!;
    expect(batchSellThrough(b, cov.daily, DEMO_DATE)).toEqual({ days: 25, expectedSold: 200, remaining: 100 });
  });
  it('跨仓同批次计1次；重复导入去重', () => {
    const recs = batches.filter(b => b.batch_no === 'B2512A');
    expect(recs.length).toBe(2);
    expect(expiringBatchCount(recs, DEMO_DATE, 90)).toBe(1);
    expect(duplicateConflicts.length).toBe(2);
    expect(rawFlowRecords.length - flows.length).toBe(2);
  });
  it('规模', () => {
    expect(customers.length).toBe(40);
    expect(batches.length).toBeGreaterThan(70);
    expect(flows.length).toBeGreaterThan(1700);
  });
  it('授权状态', () => {
    const st = Object.fromEntries(initialAuthorizations.map(a => [a.authorization_id, authBizStatus(a, DEMO_DATE)]));
    expect(st).toMatchObject({ 'AUTH-001': '生效中', 'AUTH-002': '未生效', 'AUTH-003': '已暂停', 'AUTH-004': '已到期', 'AUTH-005': '生效中', 'AUTH-006': '未生效', 'AUTH-008': '生效中' });
    const a1 = initialAuthorizations[0];
    expect(findOverlaps(a1, initialAuthorizations, DEMO_DATE).map(o => o.other.authorization_id)).toContain('AUTH-005');
    expect(changeRate(10, 0)).toBeNull();
  });
});
