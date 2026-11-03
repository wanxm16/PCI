/**
 * 第二梯队 AI 分析（规则解析模式）：
 * 招商漏斗诊断、临期库存去化建议、授权与推广健康度。
 * 数字全部由确定性规则计算；建议仅为排查方向与草稿，不自动执行。
 */
import dayjs from 'dayjs';
import { batches, DEMO_DATE, flows, METRIC_VERSION } from '../data/mock';
import { custMap, flowInScope, fmtMoney, makeMeta, partnerMap, skuLabelById, skuMap, whMap, type PermissionScope } from '../data/query';
import { authBizStatus, batchSellThrough, coverageDays, currentVersion, daysLeft, expiryState, findOverlaps, inPeriod, isSalesFlow, latestVersion, scopeHit } from '../metrics';
import { OPP_STAGES, type OppStage } from '../data/types';
import type { AiAnswer, TaskDraft } from './engine';
import type { BizContext } from './manager';

const due = (d: number) => dayjs(DEMO_DATE).add(d, 'day').format('YYYY-MM-DD');
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(0)}%`);
export const FUNNEL_RULES = { stuckDays: 30 }; // 当前阶段停留 >30 天视为卡点（演示阈值）

// —— 5. 招商漏斗诊断 ——
export function funnelStats(biz: BizContext) {
  const flow = OPP_STAGES.filter(s => s !== '关闭未达成') as OppStage[];
  const opps = biz.opportunities;
  const reached = (o: typeof opps[number], s: OppStage) => o.stage === s || o.stage_changes.some(c => c.to === s) || flow.indexOf(o.stage) > flow.indexOf(s);
  const stages = flow.map((s, i) => {
    const n = opps.filter(o => reached(o, s)).length;
    const prev = i === 0 ? opps.length : opps.filter(o => reached(o, flow[i - 1])).length;
    return { stage: s, reached: n, current: opps.filter(o => o.stage === s).length, conv: prev > 0 ? n / prev : null };
  });
  const enteredAt = (o: typeof opps[number]) => [...o.stage_changes].filter(c => c.to === o.stage).map(c => c.at).sort().pop() ?? o.created_at;
  const active = opps.filter(o => !['合作确认', '关闭未达成'].includes(o.stage)).map(o => ({ o, dwell: dayjs(DEMO_DATE).diff(enteredAt(o).slice(0, 10), 'day') }));
  const stuck = active.filter(x => x.dwell > FUNNEL_RULES.stuckDays).sort((a, b) => b.dwell - a.dwell);
  const closed = opps.filter(o => o.stage === '关闭未达成');
  const won = opps.filter(o => o.stage === '合作确认');
  const owners = [...new Set(opps.map(o => o.owner))].map(owner => {
    const mine = opps.filter(o => o.owner === owner);
    const done = mine.filter(o => ['合作确认', '关闭未达成'].includes(o.stage));
    return { owner, total: mine.length, won: mine.filter(o => o.stage === '合作确认').length, closed: mine.filter(o => o.stage === '关闭未达成').length, active: mine.length - done.length, winRate: done.length ? mine.filter(o => o.stage === '合作确认').length / done.length : null };
  });
  const bottleneck = [...stages].slice(1).filter(s => s.conv !== null).sort((a, b) => (a.conv ?? 1) - (b.conv ?? 1))[0];
  return { stages, active, stuck, closed, won, owners, bottleneck };
}

export function runFunnel(scope: PermissionScope, biz?: BizContext): AiAnswer {
  if (!biz) return { text: '缺少招商机会数据。' };
  const f = funnelStats(biz);
  const meta = makeMeta(scope, { 对象: '招商机会', 截至: DEMO_DATE, 卡点阈值: `${FUNNEL_RULES.stuckDays}天` });
  const reasons = [...new Set(f.closed.map(o => o.close_reason ?? '未填写'))].map(r => `${r}（${f.closed.filter(o => (o.close_reason ?? '未填写') === r).length}）`);
  const drafts: TaskDraft[] = f.stuck.slice(0, 3).map(x => ({ title: `推进招商机会 ${x.o.opportunity_id}（${x.o.stage}已停留${x.dwell}天）`, object_type: '招商机会', object_ids: [x.o.opportunity_id], suggestion: `确认卡点：${x.o.next_action || '下一步未设置'}；明确下次跟进时间或关闭原因`, assignee: x.o.owner, due_at: due(5), evidence_desc: `${meta.query_id}：招商漏斗卡点` }));
  return {
    text: `共 ${biz.opportunities.length} 个招商机会：进行中 ${f.active.length}、合作确认 ${f.won.length}、关闭未达成 ${f.closed.length}。${f.bottleneck ? `转化最低的环节是"→${f.bottleneck.stage}"（${pct(f.bottleneck.conv)}）。` : ''}${f.stuck.length ? `有 ${f.stuck.length} 个机会在当前阶段停留超过 ${FUNNEL_RULES.stuckDays} 天。` : ''}`,
    kpis: [
      { label: '进行中', value: `${f.active.length} 个` },
      { label: '成交率（已结束）', value: pct(f.won.length + f.closed.length ? f.won.length / (f.won.length + f.closed.length) : null), note: `确认 ${f.won.length} · 关闭 ${f.closed.length}` },
      { label: '卡点机会', value: `${f.stuck.length} 个`, note: `停留>${FUNNEL_RULES.stuckDays}天`, tone: f.stuck.length ? 'warn' : undefined },
    ],
    observed: [
      `阶段到达与转化：${f.stages.map(s => `${s.stage} ${s.reached}${s.conv !== null && s.stage !== '线索登记' ? `（${pct(s.conv)}）` : ''}`).join(' → ')}。`,
      ...f.stuck.slice(0, 4).map(x => `${x.o.opportunity_id} ${x.o.name}（${x.o.owner}）：${x.o.stage} 已 ${x.dwell} 天${x.o.next_date && x.o.next_date < DEMO_DATE ? `，下次跟进已逾期` : ''}。`),
      `负责人：${f.owners.map(o => `${o.owner} 共${o.total}个，进行中${o.active}，确认${o.won}，关闭${o.closed}`).join('；')}。`,
      ...(reasons.length ? [`关闭原因：${reasons.join('、')}。`] : []),
    ],
    toVerify: ['停留时间长可能因对方内部流程或资料审批，需负责人说明；AI 不会自动变更阶段或关闭机会。', '样本量较小（演示数据），转化率仅作趋势参考。'],
    table: { columns: [{ key: 'stage', title: '阶段' }, { key: 'reached', title: '累计到达', align: 'right' }, { key: 'conv', title: '上一环节转化', align: 'right' }, { key: 'current', title: '当前停留', align: 'right' }], rows: f.stages.map(s => ({ key: s.stage, stage: s.stage, reached: s.reached, conv: s.stage === '线索登记' ? '—' : pct(s.conv), current: s.current })) },
    chart: f.stages.map(s => ({ x: s.stage, y: s.reached })),
    chartUnit: '个',
    meta, taskDrafts: drafts,
    caliber: ['累计到达：当前阶段或阶段记录曾到达该阶段（含后续阶段）', '上一环节转化 = 到达本阶段数 ÷ 到达上一阶段数', `卡点：进行中且当前阶段停留 >${FUNNEL_RULES.stuckDays} 天（自进入该阶段起算）`, '成交率 = 合作确认 ÷（合作确认 + 关闭未达成）', `权限：${scope.summary}`],
    links: [{ label: '打开招商进度管理', to: '/opportunities' }],
  };
}

// —— 6. 临期库存去化建议 ——
export function clearancePlan(scope: PermissionScope, windowDays = 90) {
  const bs = batches.filter(b => scope.warehouses.includes(b.warehouse_id));
  const fs = flows.filter(f => flowInScope(f, scope));
  const sixM = { from: dayjs(DEMO_DATE).subtract(6, 'month').format('YYYY-MM-DD'), to: DEMO_DATE };
  return bs.filter(b => b.status === '合格' && expiryState(b.expiry_date, DEMO_DATE, windowDays) === '临期').map(b => {
    const cov = coverageDays(b.sku_id, bs, fs, DEMO_DATE);
    const st = batchSellThrough(b, cov.daily, DEMO_DATE);
    const left = daysLeft(b.expiry_date, DEMO_DATE) ?? 0;
    const wh = whMap.get(b.warehouse_id)!;
    // 候选客户：近6个月买过该SKU、在数据权限内；优先与仓库同省
    const byCust = new Map<string, number>();
    fs.filter(f => f.sku_id === b.sku_id && f.customer_id && isSalesFlow(f) && inPeriod(f.biz_date, sixM)).forEach(f => byCust.set(f.customer_id!, (byCust.get(f.customer_id!) ?? 0) + f.qty));
    const months = Math.max(0.5, left / 30);
    const cands = [...byCust.entries()].filter(([, q]) => q > 0).map(([id, q]) => {
      const c = custMap.get(id)!;
      return { id, name: c.name, region: c.region, sameRegion: c.region === wh.region, monthly: q / 6, capacity: Math.round((q / 6) * months * 0.3) };
    }).sort((a, b) => Number(b.sameRegion) - Number(a.sameRegion) || b.monthly - a.monthly).slice(0, 3);
    const extra = cands.reduce((a, c) => a + c.capacity, 0);
    return { b, left, daily: cov.daily, expectedSold: st.expectedSold, remaining: st.remaining, cands, extra, gapAfter: Math.max(0, st.remaining - extra) };
  }).filter(x => x.remaining > 0).sort((a, b) => a.left - b.left);
}

export function runClearance(scope: PermissionScope): AiAnswer {
  const plan = clearancePlan(scope);
  const meta = makeMeta(scope, { 窗口: '90天', 库存状态: '合格', 候选客户: '近6个月购买过同SKU' });
  const unit = (id: string) => skuMap.get(id)!.unit;
  const drafts: TaskDraft[] = plan.slice(0, 3).map(p => ({ title: `临期去化：${skuLabelById(p.b.sku_id)} ${p.b.batch_no}`, object_type: '批次', object_ids: [p.b.batch_no], suggestion: `${p.left}天后到期，预计剩余 ${p.remaining}${unit(p.b.sku_id)}；优先联系 ${p.cands.map(c => c.name).join('、') || '（无候选客户）'} 了解增量需求，评估调拨条件`, assignee: '陈晓', due_at: due(Math.min(7, Math.max(2, Math.floor(p.left / 4)))), evidence_desc: `${meta.query_id}：临期去化建议` }));
  return {
    text: plan.length ? `90天内临期且自然消化不完的合格批次 ${plan.length} 个（按近30日日均估算）。已为每个批次匹配近6个月买过同品种的客户作为候选，优先同省。` : '当前没有预计到期前消化不完的临期批次。',
    kpis: [
      { label: '需去化批次', value: `${plan.length} 个`, tone: plan.length ? 'warn' : undefined },
      { label: '最近到期', value: plan[0] ? `${plan[0].left} 天` : '—', note: plan[0] ? `${plan[0].b.batch_no}` : undefined, tone: 'down' },
      { label: '有候选客户', value: `${plan.filter(p => p.cands.length).length} 个`, note: '批次' },
    ],
    observed: plan.slice(0, 4).map(p => `${skuLabelById(p.b.sku_id)} ${p.b.batch_no}（${whMap.get(p.b.warehouse_id)?.name}）：${p.b.qty}${unit(p.b.sku_id)}，${p.left}天后到期；日均 ${p.daily.toFixed(1)}，预计剩余 ${p.remaining}${unit(p.b.sku_id)}${p.cands.length ? `；候选 ${p.cands.map(c => `${c.name}（月均${c.monthly.toFixed(0)}${unit(p.b.sku_id)}）`).join('、')}` : '；暂无候选客户'}。`),
    toVerify: ['候选客户的增量需求、近效期接受度需业务确认；AI 不会自动下单、调拨或联系客户。', '"可承接量"按客户月均购买量的30%估算，只用于排序，不是承诺量。', '跨仓调拨需满足货权一致与运输条件。'],
    table: { columns: [{ key: 'sku', title: '药品 / 批号' }, { key: 'wh', title: '仓库' }, { key: 'left', title: '剩余天数', align: 'right' }, { key: 'qty', title: '库存', align: 'right' }, { key: 'rem', title: '预计剩余', align: 'right' }, { key: 'cands', title: '候选客户（同省优先）' }, { key: 'gap', title: '承接后仍剩', align: 'right' }],
      rows: plan.map(p => ({ key: `${p.b.warehouse_id}${p.b.batch_no}`, sku: `${skuLabelById(p.b.sku_id)} / ${p.b.batch_no}`, wh: whMap.get(p.b.warehouse_id)?.name, left: p.left, qty: `${p.b.qty}${unit(p.b.sku_id)}`, rem: `${p.remaining}${unit(p.b.sku_id)}`, cands: p.cands.map(c => `${c.name}${c.sameRegion ? '' : '（跨省）'}`).join('、') || '—', gap: `${p.gapAfter}${unit(p.b.sku_id)}` })) },
    meta, taskDrafts: drafts,
    caliber: ['范围：合格状态、90天内到期、按近30日日均估算到期前消化不完的批次', '候选客户：数据权限内近6个月有该SKU销售的客户，同省优先、月均量降序，取前3', '可承接量 = 客户月均购买量 × 剩余月数 × 30%（演示假设）', `权限：${scope.summary}`, `口径版本：${METRIC_VERSION}`],
    links: [{ label: '在库存管理中查看批号', to: '/inventory?tab=batch&window=90' }],
  };
}

// —— 7. 授权与推广健康度 ——
export function authHealth(scope: PermissionScope, biz: BizContext) {
  const fs = flows.filter(f => f.customer_id && flowInScope(f, scope) && isSalesFlow(f));
  const p90 = { from: dayjs(DEMO_DATE).subtract(90, 'day').format('YYYY-MM-DD'), to: DEMO_DATE };
  return biz.authorizations.filter(a => !a.terminated).map(a => {
    const biz0 = authBizStatus(a, DEMO_DATE);
    const v = currentVersion(a) ?? latestVersion(a);
    const promos = (biz.promotions ?? []).filter(p => p.authorization_id === a.authorization_id);
    const running = promos.filter(p => p.status === '执行中');
    const inScope = fs.filter(f => inPeriod(f.biz_date, p90) && scopeHit(v, { sku_id: f.sku_id, region: custMap.get(f.customer_id!)!.region, channel: custMap.get(f.customer_id!)!.type, customer_id: f.customer_id! }));
    const sales90 = inScope.reduce((a, f) => a + f.amount, 0);
    const toExpire = biz0 === '生效中' ? dayjs(v.valid_to).diff(DEMO_DATE, 'day') : null;
    const overlaps = findOverlaps(a, biz.authorizations, DEMO_DATE);
    const issues: { level: '高' | '中' | '提示'; text: string }[] = [];
    if (latestVersion(a).review === '待确认') issues.push({ level: '中', text: '新版本待确认' });
    if (toExpire !== null && toExpire <= 30) issues.push({ level: '高', text: `${toExpire} 天后到期` });
    if (biz0 === '生效中' && !running.length) issues.push({ level: '中', text: '生效中但无执行中推广' });
    if (running.length && sales90 <= 0) issues.push({ level: '中', text: '有推广但范围内近90天无销售流向' });
    if (biz0 === '已暂停' && promos.some(p => p.status === '执行中')) issues.push({ level: '高', text: '授权暂停但仍有推广执行中' });
    if (overlaps.length) issues.push({ level: '提示', text: `与 ${overlaps.map(o => o.other.authorization_id).join('、')} 范围重叠` });
    if (biz0 === '已到期') issues.push({ level: '提示', text: '已到期，如需继续合作应续期' });
    const score = issues.reduce((s, i) => s - (i.level === '高' ? 35 : i.level === '中' ? 20 : 8), 100);
    return { a, biz: biz0, v, promos, running, sales90, toExpire, overlaps, issues, score: Math.max(0, score) };
  }).sort((x, y) => x.score - y.score);
}

export function runAuthHealth(scope: PermissionScope, biz?: BizContext): AiAnswer {
  if (!biz) return { text: '缺少授权数据。' };
  const h = authHealth(scope, biz);
  const meta = makeMeta(scope, { 对象: '合伙人授权与推广', 截至: DEMO_DATE });
  const bad = h.filter(x => x.issues.some(i => i.level !== '提示'));
  return {
    text: `共 ${h.length} 份未终止授权，其中 ${bad.length} 份存在需处理事项。健康分按问题扣分（高 −35、中 −20、提示 −8），仅用于排序。`,
    kpis: [
      { label: '需处理授权', value: `${bad.length} 份`, tone: bad.length ? 'warn' : undefined },
      { label: '执行中推广', value: `${h.reduce((a, x) => a + x.running.length, 0)} 个` },
      { label: '生效无推广', value: `${h.filter(x => x.biz === '生效中' && !x.running.length).length} 份`, note: '授权闲置' },
    ],
    observed: bad.slice(0, 5).map(x => `${x.a.authorization_id} ${partnerMap.get(x.a.partner_id)?.name}（${x.biz}）：${x.issues.map(i => i.text).join('；')}。范围内近90天销售流向 ${fmtMoney(Math.round(x.sales90 * 100) / 100)}。`),
    toVerify: ['"范围内销售流向"按授权范围匹配全部客户流向，不代表该合伙人的贡献（流向未标记合伙人来源）。', '范围重叠仅提示核查，不认定授权无效；AI 不会自动续期、暂停或审批。'],
    table: { columns: [{ key: 'id', title: '授权' }, { key: 'partner', title: '合伙人' }, { key: 'status', title: '状态' }, { key: 'promo', title: '推广（执行中）', align: 'right' }, { key: 'sales', title: '范围内近90天销售', align: 'right' }, { key: 'issues', title: '健康提示' }, { key: 'score', title: '健康分', align: 'right' }],
      rows: h.map(x => ({ key: x.a.authorization_id, id: x.a.authorization_id, partner: partnerMap.get(x.a.partner_id)?.name, status: `${latestVersion(x.a).review} / ${x.biz}`, promo: `${x.promos.length}（${x.running.length}）`, sales: fmtMoney(Math.round(x.sales90 * 100) / 100), issues: x.issues.map(i => i.text).join('；') || '—', score: x.score })) },
    meta,
    taskDrafts: bad.slice(0, 3).map(x => ({ title: `处理授权 ${x.a.authorization_id}：${x.issues[0].text}`, object_type: '授权', object_ids: [x.a.authorization_id], suggestion: x.issues.map(i => i.text).join('；'), assignee: '陈晓', due_at: due(7), evidence_desc: `${meta.query_id}：授权与推广健康度` })),
    caliber: ['授权状态取当前生效版本；待确认看最新版本审核状态', '范围内销售：近90天销售/退货流向中，SKU、客户地区、客户类型（渠道）命中授权当前版本范围的金额合计', '健康分 = 100 − 各问题扣分（高35/中20/提示8），演示规则', `权限：${scope.summary}`],
    links: [{ label: '打开合伙人授权', to: '/authorizations' }, { label: '打开合伙人推广', to: '/promotions' }],
  };
}

