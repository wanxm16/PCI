import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_DATE, PEOPLE, customers, partners } from '../data/mock';
import { custMap, fmtMoney, makeMeta, partnerMap, scopedFlows, type QueryMeta } from '../data/query';
import type { Promotion, Region } from '../data/types';
import { useStore, type Store } from '../data/store';
import { authBizStatus, currentVersion, customerInScope, latestVersion, netSalesAmount } from '../metrics';
import { MetaBar, PageTitle, ResultTable, StatusTag, showResult, DrawerTitle } from '../components/common';
import { CustomerLink } from '../components/drill';
import { usePageAiContext } from '../ai/AiPanel';

const followedCustomers = (p: Promotion) => new Set(p.activities.filter(a => a.customer_id).map(a => a.customer_id!)).size;
const lastActivity = (p: Promotion) => p.activities.map(a => a.at).sort().reverse()[0];

function reminders(p: Promotion, st: Store) {
  const out: { text: string; rule: string; color: string }[] = [];
  const a = st.authorizations.find(x => x.authorization_id === p.authorization_id);
  const biz = a ? authBizStatus(a, DEMO_DATE) : '未生效';
  const live = ['草稿', '待执行', '执行中', '已暂停'].includes(p.status);
  if (live && biz !== '生效中') out.push({ text: `授权${biz}`, rule: `关联授权 ${p.authorization_id} 当前业务状态为"${biz}"，正式推广需有效授权`, color: 'error' });
  if (p.status === '执行中' && p.end < DEMO_DATE) out.push({ text: '计划逾期', rule: `计划结束日期 ${p.end} 早于演示日期，状态仍为执行中`, color: 'warning' });
  const last = lastActivity(p);
  if (p.status === '执行中' && (!last || dayjs(DEMO_DATE).diff(last.slice(0, 10), 'day') > 30)) out.push({ text: '长期未跟进', rule: '执行中计划超过30天无活动记录（演示阈值）', color: 'warning' });
  const cat = st.catalogue.find(c => c.catalogue_id === p.catalogue_id);
  if (live && cat && !cat.materials.length) out.push({ text: '资料待补充', rule: '目录无已确认资料版本', color: 'warning' });
  if (live && a && biz === '生效中') {
    const cv = currentVersion(a);
    const outside = p.target_customer_ids.filter(id => !customerInScope(cv, custMap.get(id)!, cat?.sku_ids ?? []));
    if (outside.length) out.push({ text: `范围外客户${outside.length}`, rule: `目标客户超出授权范围：${outside.map(i => custMap.get(i)?.name).join('、')}`, color: 'error' });
  }
  return out;
}

interface F { kw?: string; partner?: string; catalogue?: string; auth?: string; region?: string; channel?: string; owner?: string; status?: string; period?: [dayjs.Dayjs, dayjs.Dayjs] }

export default function Promotions() {
  const st = useStore();
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F>({});
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [detail, setDetail] = useState<string | null>(params.get('id'));
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params.get('id')) setDetail(params.get('id')); }, [params]);
  const search = (v: F) => { setApplied(v); setMeta(makeMeta(st.scope, { 计划: v.kw ?? '', 合伙人: v.partner ? partnerMap.get(v.partner)!.name : '', 品种: v.catalogue ?? '', 授权: v.auth ?? '', 区域: v.region ?? '', 渠道: v.channel ?? '', 负责人: v.owner ?? '', 状态: v.status ?? '', 计划期间: v.period ? `${v.period[0].format('YYYY-MM-DD')} 至 ${v.period[1].format('YYYY-MM-DD')}` : '' })); };
  useEffect(() => { search({}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P14 合伙人推广', filters: meta?.applied_filters, selected: detail ? [detail] : [] });

  const data = useMemo(() => st.promotions.filter(p => (!applied.kw || p.name.includes(applied.kw) || p.promotion_id.includes(applied.kw)) && (!applied.partner || p.partner_id === applied.partner)
    && (!applied.catalogue || p.catalogue_id === applied.catalogue) && (!applied.auth || p.authorization_id === applied.auth) && (!applied.region || p.region === applied.region)
    && (!applied.channel || p.channel === applied.channel) && (!applied.owner || p.owner === applied.owner) && (!applied.status || p.status === applied.status)
    && (!applied.period || (p.start <= applied.period[1].format('YYYY-MM-DD') && p.end >= applied.period[0].format('YYYY-MM-DD')))), [st.promotions, applied]);
  const catName = (id: string) => st.catalogue.find(c => c.catalogue_id === id)?.name ?? id;

  return (
    <div>
      <PageTitle title="合伙人推广" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建推广计划</Button>} />
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" onFinish={search}>
          <Form.Item name="kw" label="计划"><Input allowClear placeholder="编号/名称" style={{ width: 140 }} /></Form.Item>
          <Form.Item name="partner" label="合伙人"><Select allowClear style={{ width: 180 }} options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item>
          <Form.Item name="catalogue" label="招商品种"><Select allowClear style={{ width: 200 }} options={st.catalogue.map(c => ({ value: c.catalogue_id, label: c.name }))} /></Form.Item>
          <Form.Item name="auth" label="授权编号"><Select allowClear style={{ width: 120 }} options={st.authorizations.map(a => ({ value: a.authorization_id }))} /></Form.Item>
          <Form.Item name="region" label="区域"><Select allowClear style={{ width: 90 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道"><Select allowClear style={{ width: 110 }} options={['医院', '药店', '商业公司', '全部渠道'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="owner" label="负责人"><Select allowClear style={{ width: 90 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="status" label="状态"><Select allowClear style={{ width: 100 }} options={['草稿', '待执行', '执行中', '已暂停', '已完成', '已取消'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="period" label="计划期间"><DatePicker.RangePicker /></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search({}); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <MetaBar meta={meta} />
        <ResultTable<Promotion> rowKey="promotion_id" data={data} meta={meta} exportName="合伙人推广"
          exportCols={[{ key: 'promotion_id', title: '计划编号' }, { key: 'name', title: '名称' }, { key: 'status', title: '状态' }, { key: 'targets', title: '目标客户数' }, { key: 'followed', title: '已跟进客户数' }]}
          exportRow={p => ({ ...p, targets: p.target_customer_ids.length, followed: followedCustomers(p) })}
          onRow={p => ({ onClick: () => setDetail(p.promotion_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: '计划编号', dataIndex: 'promotion_id', fixed: 'left' }, { title: '名称', dataIndex: 'name' },
            { title: '合伙人', render: (_, p) => partnerMap.get(p.partner_id)?.name }, { title: '品种', render: (_, p) => catName(p.catalogue_id) },
            { title: '区域/渠道', render: (_, p) => `${p.region} / ${p.channel}` }, { title: '计划起止', render: (_, p) => `${p.start} ~ ${p.end}` },
            { title: '负责人', dataIndex: 'owner' },
            { title: '授权摘要', render: (_, p) => { const a = st.authorizations.find(x => x.authorization_id === p.authorization_id); return <Space size={2}>{p.authorization_id} v{p.authorization_version}{a && <StatusTag value={authBizStatus(a, DEMO_DATE)} />}</Space>; } },
            { title: '状态', dataIndex: 'status', render: s => <StatusTag value={s} /> },
            { title: '目标客户', align: 'right', render: (_, p) => p.target_customer_ids.length + p.leads.length },
            { title: <Tooltip title="按客户去重：同一客户多次跟进计1家">已跟进客户</Tooltip>, align: 'right', render: (_, p) => followedCustomers(p) },
            { title: '关联机会', align: 'right', render: (_, p) => p.opportunity_ids.length },
            { title: '最近跟进', render: (_, p) => lastActivity(p) ?? '—' },
            { title: '下一步计划', render: (_, p) => { const n = p.activities.find(a => a.next_date); return n ? `${n.next_action} ${n.next_date}` : '—'; } },
            { title: '提醒', render: (_, p) => reminders(p, st).map(r => <Tooltip key={r.text} title={`规则：${r.rule}`}><Tag color={r.color}>{r.text}</Tag></Tooltip>) },
          ]} />
      </div>
      <PromoDetail id={detail} onClose={() => setDetail(null)} />
      <CreatePromo open={creating} onClose={() => setCreating(false)} onCreated={id => setDetail(id)} />
    </div>
  );
}

function PromoDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const st = useStore();
  const nav = useNavigate();
  const p = st.promotions.find(x => x.promotion_id === id);
  const [actOpen, setActOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [reasonAct, setReasonAct] = useState<null | '暂停' | '取消'>(null);
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => setSummary(null), [id]);
  if (!p) return <Drawer open={!!id} onClose={onClose}><Empty /></Drawer>;
  const a = st.authorizations.find(x => x.authorization_id === p.authorization_id);
  const cat = st.catalogue.find(c => c.catalogue_id === p.catalogue_id)!;
  const cv = a ? currentVersion(a) : undefined;
  const usedV = a?.versions.find(v => v.version === p.authorization_version);
  const biz = a ? authBizStatus(a, DEMO_DATE) : '未生效';
  const rem = reminders(p, st);
  const errs = st.validatePromoStart(p);
  const custRows = p.target_customer_ids.map(cid => { const acts = p.activities.filter(x => x.customer_id === cid); return { cid, inScope: customerInScope(cv ?? usedV, custMap.get(cid)!, cat.sku_ids), count: acts.length, last: acts.map(x => x.at).sort().reverse()[0] }; });
  const fs = scopedFlows(st.scope).filter(f => f.customer_id && p.target_customer_ids.includes(f.customer_id) && cat.sku_ids.includes(f.sku_id) && f.biz_date >= p.start && f.biz_date <= (p.end < DEMO_DATE ? p.end : DEMO_DATE));
  const genSummary = () => setSummary([
    `【推广周报草稿 · 规则模板】${p.name}`,
    `计划期间 ${p.start}~${p.end}，状态"${p.status}"；目标客户 ${p.target_customer_ids.length} 家、潜在线索 ${p.leads.length} 个。`,
    `已记录活动 ${p.activities.length} 次，覆盖客户 ${followedCustomers(p)} 家（按客户去重）${p.activities.some(x => x.backfilled) ? '，含历史补录' : ''}。`,
    `最近活动：${p.activities[0] ? `${p.activities[0].at} ${p.activities[0].method}，反馈"${p.activities[0].feedback}"` : '无'}。`,
    `提醒：${rem.map(r => r.text).join('、') || '无'}。`,
    `目标客户同期净销售额（参考）${fmtMoney(netSalesAmount(fs))}；缺少归属证据，不计为推广贡献。`,
    '下一步建议：对未跟进客户安排拜访，使用目录现行资料版本。本草稿不会自动外发。',
  ].join('\n'));

  return (
    <Drawer open={!!id} onClose={onClose} width={920} title={<DrawerTitle id={p.promotion_id} name={p.name} tags={<StatusTag value={p.status} />} />}>
      <div className="drawer-actions">
        <Space wrap size={8}>
          {p.status === '草稿' && <Button onClick={() => showResult(st.promotionAction(p.promotion_id, '提交待执行'))}>提交待执行</Button>}
          {p.status === '待执行' && <Button type="primary" onClick={() => showResult(st.promotionAction(p.promotion_id, '启动'))}>启动（校验授权）</Button>}
          {p.status === '执行中' && <><Button type="primary" onClick={() => setActOpen(true)}>记录跟进</Button><Button onClick={() => { setReason(''); setReasonAct('暂停'); }}>暂停</Button></>}
          {p.status === '已暂停' && <Button onClick={() => showResult(st.promotionAction(p.promotion_id, '恢复'))}>恢复（重新校验）</Button>}
          {!['已完成', '已取消'].includes(p.status) && <Button onClick={() => setCustOpen(true)}>添加目标客户</Button>}
          {['执行中', '已暂停'].includes(p.status) && <Button onClick={() => showResult(st.promotionAction(p.promotion_id, '完成'))}>完成</Button>}
          {!['已完成', '已取消'].includes(p.status) && <Button danger onClick={() => { setReason(''); setReasonAct('取消'); }}>取消</Button>}
          {p.status !== '执行中' && <Button onClick={() => setActOpen(true)}>历史补录</Button>}
        </Space>
        <Button type="primary" ghost icon={<RobotOutlined />} onClick={genSummary}>AI 生成总结</Button>
      </div>
      {summary && <Alert closable onClose={() => setSummary(null)} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} type="info" message="AI 草稿（需审核，不自动外发）" description={summary} />}
      {rem.length > 0 && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="提醒" description={<ul className="tight">{rem.map(r => <li key={r.text}><b>{r.text}</b> — 规则：{r.rule}</li>)}</ul>} />}
      {['草稿', '待执行', '已暂停'].includes(p.status) && errs.length > 0 && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="启动/恢复前校验未通过" description={<ul className="tight">{errs.map(e => <li key={e}>{e}</li>)}</ul>} />}
      <Tabs items={[
        { key: 'o', label: '计划概况', children: <Descriptions bordered size="small" column={2} items={[
          { label: '合伙人', children: partnerMap.get(p.partner_id)?.name }, { label: '品种', children: <a onClick={() => nav(`/catalogue?id=${cat.catalogue_id}`)}>{cat.name}</a> },
          { label: '区域/渠道', children: `${p.region} / ${p.channel}` }, { label: '计划期间', children: `${p.start} ~ ${p.end}` },
          { label: '负责人', children: p.owner }, { label: '计划目标', children: p.goal },
          { label: '潜在线索', children: p.leads.join('、') || '—', span: 2 },
        ]} /> },
        { key: 'a', label: '授权与范围', children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>授权 <a onClick={() => nav(`/authorizations?id=${p.authorization_id}`)}>{p.authorization_id}</a> 计划引用 v{p.authorization_version} · 现行 {cv ? `v${cv.version}` : '无'} · 业务状态 <StatusTag value={biz} /></div>
            {usedV && <Typography.Text>引用版本范围：{usedV.scope_items.map((s, i) => <Tag key={i}>{s.catalogue_id} · {s.regions === 'ALL' ? '全部区域' : (s.regions ?? []).join('/')} · {s.channels === 'ALL' ? '全部渠道' : (s.channels ?? ['未填']).join('/')}</Tag>)} 有效期 {usedV.valid_from}~{usedV.valid_to}</Typography.Text>}
            <Typography.Text type="secondary">启动、恢复及记录活动时按当前有效授权复核；历史补录按计划引用的授权版本校验。</Typography.Text>
          </Space>) },
        { key: 'c', label: `客户清单（${p.target_customer_ids.length}）`, children: (
          <Table size="small" pagination={false} rowKey="cid" dataSource={custRows} columns={[
            { title: '客户', render: (_, r) => <CustomerLink id={r.cid} /> }, { title: '地区/类型', render: (_, r) => `${custMap.get(r.cid)!.region}/${custMap.get(r.cid)!.type}` },
            { title: '授权范围内', render: (_, r) => (r.inScope ? <Tag color="success">是</Tag> : <Tag color="error">范围外</Tag>) },
            { title: '跟进次数', align: 'right', dataIndex: 'count' }, { title: '最近跟进', render: (_, r) => r.last ?? '—' },
          ]} />) },
        { key: 't', label: `跟进时间线（${p.activities.length}）`, children: p.activities.length ? <Timeline items={[...p.activities].sort((x, y) => y.at.localeCompare(x.at)).map(x => ({ color: x.backfilled ? 'gray' : 'blue', children: <div><b>{x.at}</b> · {x.method} · {x.customer_id ? custMap.get(x.customer_id)?.name : `线索：${x.lead_name}`} · {x.by} {x.backfilled && <Tag>历史补录</Tag>}<div>事项：{x.content}；反馈：{x.feedback}</div>{x.material_version && <Typography.Text type="secondary">资料：{x.material_version}</Typography.Text>}{x.next_action && <div>下一步：{x.next_action} {x.next_date}</div>}</div> }))} /> : <Empty /> },
        { key: 'opp', label: `关联机会（${p.opportunity_ids.length}）`, children: p.opportunity_ids.length ? p.opportunity_ids.map(o => { const op = st.opportunities.find(x => x.opportunity_id === o); return <div key={o}><a onClick={() => nav(`/opportunities?id=${o}`)}>{o} {op?.name}</a> {op && <StatusTag value={op.stage} />}</div>; }) : <Empty description="暂无关联机会" /> },
        { key: 'm', label: '资料版本', children: cat.materials.length ? cat.materials.map((m, i) => <div key={i}>{m.name} {m.version}（生效 {m.effective_date}）{i === 0 && <Tag color="green" style={{ marginLeft: 6 }}>现行</Tag>}</div>) : <Empty description="目录暂无资料" /> },
        { key: 'r', label: '活动及经营结果', children: (
          <Space direction="vertical">
            <Typography.Text>活动 {p.activities.length} 次；已跟进客户 {followedCustomers(p)} 家（去重）；目标客户 {p.target_customer_ids.length} 家。</Typography.Text>
            <Typography.Text>目标客户在计划期内对该品种的净销售额（参考）：<b>{fmtMoney(netSalesAmount(fs))}</b></Typography.Text>
            <Alert type="info" showIcon message="缺少归属证据时，不将客户销售自动记为推广贡献；推广完成不等于成交。" />
          </Space>) },
        { key: 'h', label: '操作记录', children: <Timeline items={[...p.history].reverse().map(h => ({ children: `${h.at} ${h.by} · ${h.action}${h.detail ? ' · ' + h.detail : ''}` }))} /> },
      ]} />
      <ActivityModal open={actOpen} onClose={() => setActOpen(false)} p={p} backfill={p.status !== '执行中'} materials={cat.materials.map(m => `${m.name} ${m.version}`)} />
      <Modal open={custOpen} title="添加目标客户" onCancel={() => setCustOpen(false)} footer={null} destroyOnHidden>
        <AddCustomers p={p} onDone={() => setCustOpen(false)} />
      </Modal>
      <Modal open={!!reasonAct} title={reasonAct ?? ''} onCancel={() => setReasonAct(null)} onOk={() => { if (showResult(st.promotionAction(p.promotion_id, reasonAct!, reason))) setReasonAct(null); }}>
        <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="原因（必填）" />
      </Modal>
    </Drawer>
  );
}

function AddCustomers({ p, onDone }: { p: Promotion; onDone: () => void }) {
  const st = useStore();
  const [ids, setIds] = useState<string[]>([]);
  const [lead, setLead] = useState('');
  const a = st.authorizations.find(x => x.authorization_id === p.authorization_id);
  const cat = st.catalogue.find(c => c.catalogue_id === p.catalogue_id)!;
  const v = a ? currentVersion(a) ?? latestVersion(a) : undefined;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select mode="multiple" style={{ width: '100%' }} value={ids} onChange={setIds} placeholder="从统一客户档案选择" optionFilterProp="label"
        options={customers.filter(c => !p.target_customer_ids.includes(c.customer_id)).map(c => ({ value: c.customer_id, label: `${c.name}（${c.region}/${c.type}）${customerInScope(v, c, cat.sku_ids) ? '' : ' · 范围外'}` }))} />
      <Input value={lead} onChange={e => setLead(e.target.value)} placeholder="尚未建档的对象作为潜在线索（可选）" />
      <Button type="primary" onClick={() => { if (showResult(st.addPromoTarget(p.promotion_id, ids, lead ? [lead] : []))) onDone(); }}>添加</Button>
    </Space>
  );
}

function ActivityModal({ open, onClose, p, backfill, materials }: { open: boolean; onClose: () => void; p: Promotion; backfill: boolean; materials: string[] }) {
  const st = useStore();
  const [form] = Form.useForm();
  return (
    <Modal open={open} title={backfill ? '历史补录活动' : '记录跟进'} width={620} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const r = st.addActivity(p.promotion_id, { at: v.at.format('YYYY-MM-DD HH:mm'), customer_id: v.target?.startsWith('LEAD:') ? null : v.target, lead_name: v.target?.startsWith('LEAD:') ? v.target.slice(5) : undefined, method: v.method, content: v.content, feedback: v.feedback, material_version: v.material, next_action: v.next_action, next_date: v.next_date?.format('YYYY-MM-DD'), backfilled: backfill || v.backfilled });
      if (showResult(r)) { form.resetFields(); onClose(); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ at: dayjs(`${DEMO_DATE} 10:00`), method: '业务拜访', material: materials[0] }}>
        {backfill && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="计划当前非执行中，仅可历史补录；按计划引用的授权版本校验。" />}
        <Space>
          <Form.Item name="at" label="实际时间" rules={[{ required: true }]}><DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="method" label="方式" rules={[{ required: true }]}><Select style={{ width: 120 }} options={['业务拜访', '电话沟通', '资料介绍', '学术会议'].map(v => ({ value: v }))} /></Form.Item>
        </Space>
        <Form.Item name="target" label="客户或线索" rules={[{ required: true }]}><Select options={[...p.target_customer_ids.map(id => ({ value: id, label: custMap.get(id)!.name })), ...p.leads.map(l => ({ value: `LEAD:${l}`, label: `线索：${l}` }))]} /></Form.Item>
        <Form.Item name="content" label="事项" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="feedback" label="客户反馈" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="material" label="使用资料版本"><Select allowClear options={materials.map(m => ({ value: m }))} /></Form.Item>
        <Space>
          <Form.Item name="next_action" label="下一步动作"><Input /></Form.Item>
          <Form.Item name="next_date" label="日期"><DatePicker /></Form.Item>
        </Space>
        {!backfill && <Form.Item name="backfilled" valuePropName="checked"><Checkbox>标记为历史补录</Checkbox></Form.Item>}
      </Form>
    </Modal>
  );
}

function CreatePromo({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const st = useStore();
  const [form] = Form.useForm();
  return (
    <Modal open={open} title="新建推广计划（草稿）" width={680} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const r = st.createPromotion({ name: v.name, partner_id: v.partner_id, catalogue_id: v.catalogue_id, authorization_id: v.authorization_id, region: v.region as Region, channel: v.channel, start: v.range[0].format('YYYY-MM-DD'), end: v.range[1].format('YYYY-MM-DD'), owner: v.owner, goal: v.goal, target_customer_ids: v.customers ?? [], leads: v.leads ? [v.leads] : [], opportunity_ids: v.opps ?? [] });
      if (showResult(r)) { form.resetFields(); onClose(); if (r.id) onCreated(r.id); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ owner: st.user }}>
        <Form.Item name="name" label="计划名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Space style={{ display: 'flex' }}>
          <Form.Item name="partner_id" label="合伙人" rules={[{ required: true }]}><Select style={{ width: 220 }} options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item>
          <Form.Item name="catalogue_id" label="品种" rules={[{ required: true }]}><Select style={{ width: 300 }} options={st.catalogue.map(c => ({ value: c.catalogue_id, label: c.name }))} /></Form.Item>
        </Space>
        <Form.Item noStyle shouldUpdate>{() => {
          const pid = form.getFieldValue('partner_id'); const cid = form.getFieldValue('catalogue_id');
          const list = st.authorizations.filter(a => a.partner_id === pid && a.versions.some(v => v.scope_items.some(s => s.catalogue_id === cid)));
          return <Form.Item name="authorization_id" label="授权记录/版本" rules={[{ required: true }]} extra="可选择未生效授权筹备草稿，启动前需有效授权">
            <Select placeholder={pid && cid ? (list.length ? '' : '该合伙人无此品种授权') : '先选择合伙人与品种'} options={list.map(a => ({ value: a.authorization_id, label: <span>{a.authorization_id} v{a.current_version || latestVersion(a).version} <StatusTag value={authBizStatus(a, DEMO_DATE)} /></span> }))} />
          </Form.Item>;
        }}</Form.Item>
        <Space style={{ display: 'flex' }}>
          <Form.Item name="region" label="区域" rules={[{ required: true }]}><Select style={{ width: 110 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道" rules={[{ required: true }]}><Select style={{ width: 120 }} options={['医院', '药店', '商业公司', '全部渠道'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="range" label="起止日期" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true }]}><Select style={{ width: 100 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
        </Space>
        <Form.Item name="goal" label="计划目标与主要动作" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="customers" label="目标客户（统一客户档案）"><Select mode="multiple" optionFilterProp="label" options={customers.map(c => ({ value: c.customer_id, label: `${c.name}（${c.region}/${c.type}）` }))} /></Form.Item>
        <Form.Item name="leads" label="潜在线索（未建档）"><Input /></Form.Item>
        <Form.Item name="opps" label="关联招商机会"><Select mode="multiple" options={st.opportunities.map(o => ({ value: o.opportunity_id, label: `${o.opportunity_id} ${o.name}` }))} /></Form.Item>
      </Form>
    </Modal>
  );
}
