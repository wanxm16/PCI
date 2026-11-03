/**
 * 招商四页、任务中心的可写状态与受控动作（模拟业务服务层）。
 * 每个动作校验当前状态并返回结果；状态变化写入历史，不删除原记录。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEMO_DATE, initialAuthorizations, initialCatalogue, initialJobs, initialOpportunities, initialPromotions, initialTasks,
} from './mock';
import type {
  Authorization, AuthVersion, CatalogueItem, Followup, JobRecord, Opportunity, OppStage, PromoActivity, Promotion, Role, Task,
} from './types';
import { authBizStatus, currentVersion, customerInScope, latestVersion, validateAuthVersion } from '../metrics';
import { custMap, demoNow, scopeFor, type PermissionScope } from './query';

export interface Result { ok: boolean; msg: string; warnings?: string[]; id?: string }
const ok = (msg: string, extra: Partial<Result> = {}): Result => ({ ok: true, msg, ...extra });
const fail = (msg: string, warnings?: string[]): Result => ({ ok: false, msg, warnings });

interface State {
  role: Role;
  user: string;
  catalogue: CatalogueItem[];
  opportunities: Opportunity[];
  authorizations: Authorization[];
  promotions: Promotion[];
  tasks: Task[];
  jobs: JobRecord[];
  idem: string[]; // 已处理的幂等键
}
const KEY = 'pharma-bd-demo-v1';
const fresh = (): State => structuredClone({
  role: '经营负责人' as Role, user: '陈晓', catalogue: initialCatalogue, opportunities: initialOpportunities,
  authorizations: initialAuthorizations, promotions: initialPromotions, tasks: initialTasks, jobs: initialJobs, idem: [],
});
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* 存储不可用时使用初始数据 */ }
  return fresh();
}

function useStoreImpl() {
  const [s, setS] = useState<State>(load);
  const ref = useRef(s);
  ref.current = s;
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);

  /** 基于当前状态的受控修改：fn 修改副本并返回结果；失败时不提交 */
  const mutate = useCallback((fn: (d: State) => Result): Result => {
    const draft = structuredClone(ref.current);
    const r = fn(draft);
    if (r.ok) { ref.current = draft; setS(draft); }
    return r;
  }, []);

  const scope: PermissionScope = useMemo(() => scopeFor(s.role), [s.role]);
  const by = s.user;
  const seq = (prefix: string, list: { [k: string]: any }[], field: string) => {
    const nums = list.map(x => Number(String(x[field]).replace(/\D/g, '').slice(-3)) || 0);
    return `${prefix}${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
  };

  // —— 任务 ——
  const addTask = (t: Omit<Task, 'task_id' | 'created_at' | 'kind' | 'status'> & { idemKey?: string }) => mutate(d => {
    if (t.idemKey && d.idem.includes(t.idemKey)) return fail('该任务已保存，重复提交已忽略');
    const task: Task = { ...t, task_id: seq('T', d.tasks, 'task_id'), kind: '业务待办', status: '待处理', created_at: DEMO_DATE };
    delete (task as any).idemKey;
    d.tasks.unshift(task);
    if (t.idemKey) d.idem.push(t.idemKey);
    return ok(`已保存任务 ${task.task_id}`, { id: task.task_id });
  });
  const setTaskStatus = (id: string, status: Task['status']) => mutate(d => {
    const t = d.tasks.find(x => x.task_id === id); if (!t) return fail('任务不存在');
    t.status = status; return ok('任务状态已更新（不改变关联业务对象状态）');
  });
  const addJob = (j: Omit<JobRecord, 'job_id' | 'created_at'>) => mutate(d => {
    const job: JobRecord = { ...j, job_id: seq('J', d.jobs, 'job_id'), created_at: demoNow() };
    d.jobs.unshift(job); return ok('导出任务已创建', { id: job.job_id });
  });

  // —— 招商目录 ——
  const saveCatalogue = (c: Partial<CatalogueItem> & { catalogue_id?: string }) => mutate(d => {
    if (c.catalogue_id) {
      const it = d.catalogue.find(x => x.catalogue_id === c.catalogue_id); if (!it) return fail('目录不存在');
      Object.assign(it, c, { updated_at: DEMO_DATE });
      it.history.push({ at: demoNow(), by, action: '编辑' });
      return ok('目录已保存');
    }
    const id = seq('CAT-', d.catalogue, 'catalogue_id').replace('CAT-0', 'CAT-');
    const item: CatalogueItem = { catalogue_id: id, name: '', sku_ids: [], status: '草稿', regions: [], channels: [], owner: by, supply_note: '', policy_ref: '', materials: [], updated_at: DEMO_DATE, history: [{ at: demoNow(), by, action: '新增草稿' }], ...c } as CatalogueItem;
    d.catalogue.push(item);
    return ok(`已新增目录草稿 ${id}`, { id });
  });
  const catalogueAction = (id: string, action: '发布' | '暂停' | '恢复' | '终止', reason = '') => mutate(d => {
    const it = d.catalogue.find(x => x.catalogue_id === id); if (!it) return fail('目录不存在');
    if (action === '发布' || action === '恢复') {
      const errs: string[] = [];
      if (!it.sku_ids.length) errs.push('未关联交易SKU');
      if (!it.owner) errs.push('未指定负责人');
      if (!it.regions.length || !it.channels.length) errs.push('招商范围（区域/渠道）不完整');
      if (!it.materials.length) errs.push('缺少必要资料');
      if (errs.length) return fail('发布前核对未通过', errs);
      if (it.status === '已终止') return fail('已终止目录不能重新发布');
      it.status = '招商中';
    } else if (action === '暂停') {
      if (it.status !== '招商中') return fail('仅招商中的目录可暂停');
      it.status = '暂停招商';
    } else {
      if (!reason) return fail('终止需填写原因');
      it.status = '已终止';
    }
    it.updated_at = DEMO_DATE;
    it.history.push({ at: demoNow(), by, action, detail: reason });
    const extra = action === '暂停' || action === '终止' ? '；已有授权不会被自动撤销，按授权状态继续判断' : '';
    return ok(`目录已${action}${extra}`);
  });
  const addMaterial = (id: string, m: CatalogueItem['materials'][number]) => mutate(d => {
    const it = d.catalogue.find(x => x.catalogue_id === id)!;
    it.materials.unshift(m); it.history.push({ at: demoNow(), by, action: '新增资料版本', detail: `${m.name} ${m.version}` });
    return ok('资料新版本已保存；历史版本保留，已引用旧版本的推广记录不受影响');
  });

  // —— 招商机会 ——
  const createOpportunity = (o: Omit<Opportunity, 'opportunity_id' | 'stage' | 'created_at' | 'followups' | 'stage_changes' | 'version'>) => mutate(d => {
    const cat = d.catalogue.find(c => c.catalogue_id === o.catalogue_id);
    if (!cat) return fail('请选择招商品种');
    if (cat.status !== '招商中') return fail(`目录状态为"${cat.status}"，限制新建招商机会`);
    const id = `OPP-2026-${String(d.opportunities.length + 1).padStart(3, '0')}`;
    const similar = d.opportunities.filter(x => x.catalogue_id === o.catalogue_id && x.region === o.region && (x.partner_id === o.partner_id && !!o.partner_id) && !['合作确认', '关闭未达成'].includes(x.stage));
    d.opportunities.unshift({ ...o, opportunity_id: id, stage: '线索登记', created_at: DEMO_DATE, followups: [], stage_changes: [{ at: demoNow(), by, from: null, to: '线索登记', reason: '新增机会' }], version: 1 });
    return ok(`已新增机会 ${id}`, { id, warnings: similar.length ? [`存在相似未关闭机会：${similar.map(x => x.opportunity_id).join('、')}，请核查`] : undefined });
  });
  const addFollowup = (id: string, f: Omit<Followup, 'followup_id' | 'by'>, syncTask: boolean) => mutate(d => {
    const o = d.opportunities.find(x => x.opportunity_id === id); if (!o) return fail('机会不存在');
    const fid = `F${String(d.opportunities.reduce((a, x) => a + x.followups.length, 0) + 1).padStart(3, '0')}${Date.now() % 1000}`;
    o.followups.unshift({ ...f, followup_id: fid, by });
    o.next_action = f.next_action; o.next_date = f.next_date; o.version++;
    if (syncTask && f.next_date) d.tasks.unshift({ task_id: seq('T', d.tasks, 'task_id'), title: `${o.name}：${f.next_action}`, kind: '业务待办', object_type: '招商机会', object_ids: [id], suggestion: f.next_action, assignee: o.owner, due_at: f.next_date, status: '待处理', created_at: DEMO_DATE, source: '招商跟进' });
    return ok(syncTask && f.next_date ? '跟进已记录，并同步生成任务中心待办' : '跟进已记录');
  });
  const changeStage = (id: string, to: OppStage, reason: string, expectedVersion?: number) => mutate(d => {
    const o = d.opportunities.find(x => x.opportunity_id === id); if (!o) return fail('机会不存在');
    if (expectedVersion !== undefined && expectedVersion !== o.version) return fail('记录已被修改，请刷新后重试');
    if (!reason) return fail('阶段变更须填写依据');
    if (o.stage === to) return fail('阶段未变化');
    if (o.stage === '关闭未达成') return fail('已关闭机会需先重新开启');
    if (to === '关闭未达成') o.close_reason = reason;
    if (to === '合作确认') o.confirmed_at = DEMO_DATE;
    o.stage_changes.push({ at: demoNow(), by, from: o.stage, to, reason });
    o.stage = to; o.version++;
    return ok(to === '合作确认' ? '已登记合作确认。授权仍需独立确认，可"生成授权草稿"' : `阶段已变更为"${to}"`);
  });
  const reopenOpportunity = (id: string, reason: string) => mutate(d => {
    const o = d.opportunities.find(x => x.opportunity_id === id)!;
    if (o.stage !== '关闭未达成') return fail('仅关闭的机会可重新开启');
    if (!reason) return fail('请填写重开原因');
    const prev = [...o.stage_changes].reverse().find(c => c.to === '关闭未达成')?.from ?? '需求沟通';
    o.stage_changes.push({ at: demoNow(), by, from: o.stage, to: prev, reason: `重新开启：${reason}` });
    o.stage = prev; o.close_reason = undefined; o.version++;
    return ok(`已重新开启，恢复到"${prev}"（创建时间保持 ${o.created_at}）`);
  });
  const changeOwner = (id: string, owner: string) => mutate(d => {
    const o = d.opportunities.find(x => x.opportunity_id === id)!;
    o.stage_changes.push({ at: demoNow(), by, from: o.stage, to: o.stage, reason: `负责人 ${o.owner} → ${owner}` });
    o.owner = owner; o.version++; return ok('负责人已变更');
  });
  const generateAuthDraft = (oppId: string) => mutate(d => {
    const o = d.opportunities.find(x => x.opportunity_id === oppId)!;
    if (o.stage !== '合作确认') return fail('仅"合作确认"阶段可生成授权草稿');
    if (!o.partner_id) return fail('意向对象尚未建档为合伙人，请先转档');
    const open = d.authorizations.find(a => a.opportunity_id === oppId && ['草稿', '待确认'].includes(latestVersion(a).review));
    if (open) return fail(`该机会已有未完成的授权 ${open.authorization_id}（${latestVersion(open).review}），请勿重复生成`);
    const cat = d.catalogue.find(c => c.catalogue_id === o.catalogue_id)!;
    if (cat.status !== '招商中') return fail(`目录状态为"${cat.status}"，限制新授权草稿`);
    const id = seq('AUTH-', d.authorizations, 'authorization_id');
    const v: AuthVersion = { version: 1, scope_items: [{ catalogue_id: cat.catalogue_id, sku_ids: [...cat.sku_ids], regions: [o.region], channels: o.channel === '全部渠道' ? 'ALL' : [o.channel], customers: { mode: 'ALL_MATCHING' } }], valid_from: '', valid_to: '', review: '草稿', basis: '', created_at: DEMO_DATE, created_by: by, change_note: `由招商机会 ${oppId} 预填` };
    d.authorizations.unshift({ authorization_id: id, partner_id: o.partner_id, opportunity_id: oppId, owner: o.owner, current_version: 0, versions: [v], suspended: false, terminated: false, attachments: [], history: [{ at: demoNow(), by, action: '生成授权草稿', detail: `来源 ${oppId}` }], updated_at: DEMO_DATE });
    return ok(`已生成授权草稿 ${id}（未生效，需补全有效期、依据并确认）`, { id });
  });

  // —— 合伙人授权 ——
  const saveAuthDraft = (a: { authorization_id?: string; partner_id: string; owner: string; opportunity_id?: string; version: Omit<AuthVersion, 'version' | 'review' | 'created_at' | 'created_by'>; attachments?: string[] }) => mutate(d => {
    if (a.authorization_id) {
      const x = d.authorizations.find(y => y.authorization_id === a.authorization_id)!;
      const lv = latestVersion(x);
      if (!['草稿', '已退回', '已撤回'].includes(lv.review)) return fail('仅草稿/退回/撤回状态可编辑');
      Object.assign(lv, a.version); x.partner_id = a.partner_id; x.owner = a.owner; x.updated_at = DEMO_DATE;
      if (a.attachments) x.attachments = a.attachments;
      x.history.push({ at: demoNow(), by, action: '编辑草稿' });
      return ok('草稿已保存');
    }
    const id = seq('AUTH-', d.authorizations, 'authorization_id');
    d.authorizations.unshift({ authorization_id: id, partner_id: a.partner_id, opportunity_id: a.opportunity_id, owner: a.owner, current_version: 0, versions: [{ ...a.version, version: 1, review: '草稿', created_at: DEMO_DATE, created_by: by }], suspended: false, terminated: false, attachments: a.attachments ?? [], history: [{ at: demoNow(), by, action: '新增草稿' }], updated_at: DEMO_DATE });
    return ok(`已新增授权草稿 ${id}`, { id });
  });

  type AuthAct = '提交确认' | '撤回' | '模拟通过' | '模拟退回' | '暂停' | '恢复' | '终止' | '续期' | '变更范围';
  const authAction = (id: string, act: AuthAct, payload: { reason?: string; valid_to?: string; version?: Partial<AuthVersion>; expectedVersion?: number } = {}) => mutate(d => {
    const a = d.authorizations.find(x => x.authorization_id === id); if (!a) return fail('授权不存在');
    const lv = latestVersion(a);
    if (payload.expectedVersion !== undefined && payload.expectedVersion !== lv.version) return fail('授权已被修改，请刷新后重试');
    const biz = authBizStatus(a, DEMO_DATE);
    const log = (detail?: string) => { a.history.push({ at: demoNow(), by, action: act, detail }); a.updated_at = DEMO_DATE; };
    switch (act) {
      case '提交确认': {
        if (!['草稿', '已退回', '已撤回'].includes(lv.review)) return fail('当前版本不可提交');
        const errs = validateAuthVersion(lv); if (errs.length) return fail('校验未通过', errs);
        lv.review = '待确认'; log(); return ok('已提交确认');
      }
      case '撤回': if (lv.review !== '待确认') return fail('仅待确认可撤回'); lv.review = '已撤回'; log(); return ok('已撤回');
      case '模拟通过': {
        if (lv.review !== '待确认') return fail('仅待确认可通过');
        if (d.role !== '经营负责人') return fail('演示规则：仅"经营负责人"角色可模拟确认');
        lv.review = '已通过'; a.current_version = lv.version; log('单层模拟确认');
        const nb = authBizStatus(a, DEMO_DATE);
        return ok(`已通过（版本 v${lv.version}）。业务状态：${nb}${nb === '未生效' ? '（未到起始日期）' : ''}`);
      }
      case '模拟退回': if (lv.review !== '待确认') return fail('仅待确认可退回'); if (!payload.reason) return fail('请填写退回原因'); lv.review = '已退回'; log(payload.reason); return ok('已退回，可补充后重提');
      case '暂停': {
        if (biz !== '生效中') return fail('仅生效中的授权可暂停');
        if (!payload.reason) return fail('暂停须说明原因');
        a.suspended = true; log(payload.reason);
        const affected = d.promotions.filter(p => p.authorization_id === id && p.status === '执行中');
        affected.forEach(p => { p.status = '已暂停'; p.history.push({ at: demoNow(), by: '系统', action: '暂停', detail: `关联授权 ${id} 已暂停` }); });
        return ok(`授权已暂停${affected.length ? `；${affected.length} 个执行中推广计划已同步暂停` : ''}`);
      }
      case '恢复': {
        if (!a.suspended) return fail('授权未暂停');
        const cv = currentVersion(a)!;
        if (DEMO_DATE > cv.valid_to) return fail('授权已到期，需通过续期产生新版本，不能通过恢复重新生效');
        a.suspended = false; log(payload.reason); return ok('已恢复，期限与范围已重新校验；关联推广需在推广页手动恢复');
      }
      case '终止': if (a.terminated) return fail('已终止'); if (!payload.reason) return fail('终止须说明原因'); a.terminated = true; a.terminate_reason = payload.reason; log(payload.reason); return ok('授权已终止，记录保留');
      case '续期':
      case '变更范围': {
        if (a.terminated) return fail('已终止授权不能续期或变更');
        if (['草稿', '待确认'].includes(lv.review) && lv.version !== a.current_version && a.current_version !== 0) return fail('已有待处理的新版本');
        const base = currentVersion(a) ?? lv;
        const nv: AuthVersion = { ...structuredClone(base), ...payload.version, version: lv.version + 1, review: '草稿', created_at: DEMO_DATE, created_by: by, change_note: act === '续期' ? `续期至 ${payload.valid_to}` : (payload.reason || '范围变更') };
        if (act === '续期') { if (!payload.valid_to || payload.valid_to <= base.valid_to) return fail('续期结束日期须晚于现有结束日期'); nv.valid_to = payload.valid_to; if (DEMO_DATE > base.valid_to) nv.valid_from = DEMO_DATE; }
        a.versions.push(nv); log(nv.change_note);
        return ok(`已创建新版本 v${nv.version}（草稿），确认前不覆盖现行有效版本`);
      }
    }
  });

  // —— 合伙人推广 ——
  const validatePromoStart = (d: State, p: Promotion): string[] => {
    const errs: string[] = [];
    const a = d.authorizations.find(x => x.authorization_id === p.authorization_id);
    if (!a) return ['未关联授权'];
    const st = authBizStatus(a, DEMO_DATE);
    if (st !== '生效中') errs.push(`关联授权当前为"${st}"，不能启动正式推广`);
    const cv = currentVersion(a);
    const cat = d.catalogue.find(c => c.catalogue_id === p.catalogue_id)!;
    if (cv && (p.start < cv.valid_from || p.end > cv.valid_to)) errs.push(`计划期间 ${p.start}~${p.end} 超出授权有效期 ${cv.valid_from}~${cv.valid_to}`);
    const outside = p.target_customer_ids.filter(id => !customerInScope(cv, custMap.get(id)!, cat.sku_ids));
    if (outside.length) errs.push(`目标客户超出授权范围：${outside.map(id => custMap.get(id)?.name).join('、')}`);
    if (!p.target_customer_ids.length && !p.leads.length) errs.push('尚未添加目标客户');
    return errs;
  };
  const createPromotion = (p: Omit<Promotion, 'promotion_id' | 'status' | 'activities' | 'history' | 'version' | 'authorization_version'>) => mutate(d => {
    const a = d.authorizations.find(x => x.authorization_id === p.authorization_id);
    const id = seq('PRM-', d.promotions, 'promotion_id');
    d.promotions.unshift({ ...p, promotion_id: id, authorization_version: a?.current_version || latestVersion(a!).version, status: '草稿', activities: [], history: [{ at: demoNow(), by, action: '新建草稿' }], version: 1 });
    const st = a ? authBizStatus(a, DEMO_DATE) : '未生效';
    return ok(`已新建推广草稿 ${id}`, { id, warnings: st !== '生效中' ? [`关联授权当前"${st}"：可筹备草稿，启动前需有效授权`] : undefined });
  });
  type PromoAct = '提交待执行' | '启动' | '暂停' | '恢复' | '完成' | '取消';
  const promotionAction = (id: string, act: PromoAct, reason = '') => mutate(d => {
    const p = d.promotions.find(x => x.promotion_id === id); if (!p) return fail('计划不存在');
    const log = () => { p.history.push({ at: demoNow(), by, action: act, detail: reason }); p.version++; };
    if (act === '提交待执行') {
      if (p.status !== '草稿') return fail('仅草稿可提交');
      if (!p.name || !p.start || !p.end || !p.goal) return fail('计划信息不完整');
      p.status = '待执行'; log(); return ok('计划信息完整，已转为待执行');
    }
    if (act === '启动' || act === '恢复') {
      if (act === '启动' && p.status !== '待执行') return fail('仅待执行计划可启动');
      if (act === '恢复' && p.status !== '已暂停') return fail('仅已暂停计划可恢复');
      const errs = validatePromoStart(d, p);
      if (errs.length) return fail('授权范围校验未通过', errs);
      const a = d.authorizations.find(x => x.authorization_id === p.authorization_id)!;
      p.authorization_version = a.current_version;
      p.status = '执行中'; log(); return ok(`已${act}，引用授权 ${a.authorization_id} v${a.current_version}`);
    }
    if (act === '暂停') { if (p.status !== '执行中') return fail('仅执行中可暂停'); if (!reason) return fail('请填写原因'); p.status = '已暂停'; log(); return ok('已暂停'); }
    if (act === '完成') { if (!['执行中', '已暂停'].includes(p.status)) return fail('仅执行中/已暂停计划可完成'); p.status = '已完成'; log(); return ok('计划已完成。注意：推广完成不等于客户成交'); }
    if (['已完成', '已取消'].includes(p.status)) return fail('计划已结束');
    if (!reason) return fail('请填写取消原因');
    p.status = '已取消'; log(); return ok('计划已取消，历史活动保留');
  });
  const addPromoTarget = (id: string, customerIds: string[], leads: string[]) => mutate(d => {
    const p = d.promotions.find(x => x.promotion_id === id)!;
    const a = d.authorizations.find(x => x.authorization_id === p.authorization_id);
    const cat = d.catalogue.find(c => c.catalogue_id === p.catalogue_id)!;
    const cv = a ? currentVersion(a) ?? latestVersion(a) : undefined;
    const outside = customerIds.filter(cid => !customerInScope(cv, custMap.get(cid)!, cat.sku_ids));
    if (p.status === '执行中' && outside.length) return fail('执行中计划新增客户超出授权范围，请调整', outside.map(c => custMap.get(c)!.name));
    p.target_customer_ids = [...new Set([...p.target_customer_ids, ...customerIds])];
    p.leads = [...new Set([...p.leads, ...leads])];
    p.version++;
    return ok('目标客户已添加', { warnings: outside.length ? [`以下客户超出授权范围，启动前需调整：${outside.map(c => custMap.get(c)!.name).join('、')}`] : undefined });
  });
  const addActivity = (id: string, act: Omit<PromoActivity, 'activity_id' | 'by'>) => mutate(d => {
    const p = d.promotions.find(x => x.promotion_id === id)!;
    if (p.status !== '执行中' && !act.backfilled) return fail(`计划当前"${p.status}"，仅执行中可记录活动（历史补录除外）`);
    const a = d.authorizations.find(x => x.authorization_id === p.authorization_id)!;
    const cat = d.catalogue.find(c => c.catalogue_id === p.catalogue_id)!;
    const warnings: string[] = [];
    if (act.customer_id) {
      const usedVersion = act.backfilled ? a.versions.find(v => v.version === p.authorization_version) : currentVersion(a);
      if (!customerInScope(usedVersion, custMap.get(act.customer_id)!, cat.sku_ids)) return fail('该客户不在授权范围内，不能记录正式推广活动');
    }
    if (act.backfilled) warnings.push(`历史补录：按计划引用的授权 v${p.authorization_version} 校验`);
    p.activities.unshift({ ...act, activity_id: `A${Date.now() % 100000}`, by });
    if (act.next_date && act.next_action) d.tasks.unshift({ task_id: seq('T', d.tasks, 'task_id'), title: `${p.name}：${act.next_action}`, kind: '业务待办', object_type: '推广计划', object_ids: [id], suggestion: act.next_action, assignee: p.owner, due_at: act.next_date, status: '待处理', created_at: DEMO_DATE, source: '推广计划' });
    p.version++;
    return ok('活动已记录', { warnings });
  });

  const setRole = (role: Role) => setS(x => ({ ...x, role }));
  const reset = () => { const f = fresh(); f.role = ref.current.role; ref.current = f; setS(f); };

  return {
    ...s, scope, setRole, reset, addTask, setTaskStatus, addJob,
    saveCatalogue, catalogueAction, addMaterial,
    createOpportunity, addFollowup, changeStage, reopenOpportunity, changeOwner, generateAuthDraft,
    saveAuthDraft, authAction,
    createPromotion, promotionAction, addPromoTarget, addActivity, validatePromoStart: (p: Promotion) => validatePromoStart(ref.current, p),
  };
}

export type Store = ReturnType<typeof useStoreImpl>;
const Ctx = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const store = useStoreImpl();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
