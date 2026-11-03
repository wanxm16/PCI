import { initialAuthorizations, initialOpportunities, initialPromotions, initialTasks } from '../data/mock';
import { scopeFor } from '../data/query';
import { authHealth, clearancePlan, funnelStats } from './tier2';

const biz = { opportunities: initialOpportunities, tasks: initialTasks, authorizations: initialAuthorizations, promotions: initialPromotions };
const all = scopeFor('经营负责人');

describe('第二梯队规则', () => {
  it('临期去化：B2511X1 到期前约剩 100 盒，并有候选客户', () => {
    const x = clearancePlan(all).find(p => p.b.batch_no === 'B2511X1');
    expect(x?.remaining).toBe(100);
    expect(x?.cands.length).toBeGreaterThan(0);
  });
  it('临期去化：区域权限下不出现上海仓批次', () => {
    expect(clearancePlan(scopeFor('区域业务人员')).every(p => p.b.warehouse_id !== 'WH3')).toBe(true);
  });
  it('招商漏斗：阶段累计到达数单调不增', () => {
    const s = funnelStats(biz).stages.map(x => x.reached);
    s.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(s[i]));
  });
  it('授权健康：AUTH-008 30天内到期被标记为高', () => {
    const a = authHealth(all, biz).find(x => x.a.authorization_id === 'AUTH-008');
    expect(a?.issues.some(i => i.level === '高' && i.text.includes('到期'))).toBe(true);
  });
});
