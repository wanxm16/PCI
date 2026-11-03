import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Row, Segmented, Select, Space, Statistic, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_DATE, PEOPLE, partners } from '../data/mock';
import { makeMeta, partnerMap, skuLabelById, type QueryMeta } from '../data/query';
import { OPP_STAGES, type Opportunity, type OppStage, type Region } from '../data/types';
import { useStore } from '../data/store';
import { authBizStatus, latestVersion } from '../metrics';
import { MetaBar, PageTitle, ResultTable, StatusTag, showResult, DrawerTitle } from '../components/common';
import { summarizeFollowups } from '../ai/engine';
import { usePageAiContext } from '../ai/AiPanel';
import { AiDiagPanel } from '../components/AiDiag';
import { funnelStats, runFunnel, FUNNEL_RULES } from '../ai/tier2';

const ACTIVE = (o: Opportunity) => !['合作确认', '关闭未达成'].includes(o.stage);
const overdue = (o: Opportunity) => !!o.next_date && o.next_date < DEMO_DATE && ACTIVE(o);

interface F { kw?: string; catalogue?: string; partner?: string; region?: string; channel?: string; owner?: string; stage?: string; created?: [dayjs.Dayjs, dayjs.Dayjs]; lastFollow?: [dayjs.Dayjs, dayjs.Dayjs]; overdue?: boolean }

export default function Opportunities() {
  const st = useStore();
  const { opportunities, catalogue, scope } = st;
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [view, setView] = useState<'列表' | '看板'>('列表');
  const [mainTab, setMainTab] = useState<'list' | 'funnel'>(() => (params.get('diag') ? 'funnel' : 'list'));
  const [applied, setApplied] = useState<F>({});
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [detail, setDetail] = useState<string | null>(params.get('id'));
  const [creating, setCreating] = useState(false);
  const [presetCat, setPresetCat] = useState<string | undefined>();
  const [stageReq, setStageReq] = useState<{ id: string; to: OppStage } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const search = (v: F) => {
    setApplied(v);
    setMeta(makeMeta(scope, { 关键字: v.kw ?? '', 品种: v.catalogue ?? '', 合伙人: v.partner ? partnerMap.get(v.partner)!.name : '', 区域: v.region ?? '', 渠道: v.channel ?? '', 负责人: v.owner ?? '', 阶段: v.stage ?? '', 创建日期: v.created ? `${v.created[0].format('YYYY-MM-DD')} 至 ${v.created[1].format('YYYY-MM-DD')}` : '', 下次跟进逾期: v.overdue ? '是' : '' }));
  };
  useEffect(() => { const v: F = params.get('overdue') ? { overdue: true } : {}; form.setFieldsValue(v); search(v); if (params.get('id')) setDetail(params.get('id')); if (params.get('create')) { setPresetCat(params.get('create')!); setCreating(true); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P03 招商进度管理', filters: meta?.applied_filters, selected: detail ? [detail] : [] });

  const data = useMemo(() => opportunities.filter(o => {
    const v = applied;
    const lastF = o.followups[0]?.at.slice(0, 10);
    return (!v.kw || o.name.includes(v.kw) || o.opportunity_id.includes(v.kw)) && (!v.catalogue || o.catalogue_id === v.catalogue) && (!v.partner || o.partner_id === v.partner)
      && (!v.region || o.region === v.region) && (!v.channel || o.channel === v.channel) && (!v.owner || o.owner === v.owner) && (!v.stage || o.stage === v.stage)
      && (!v.created || (o.created_at >= v.created[0].format('YYYY-MM-DD') && o.created_at <= v.created[1].format('YYYY-MM-DD')))
      && (!v.lastFollow || (!!lastF && lastF >= v.lastFollow[0].format('YYYY-MM-DD') && lastF <= v.lastFollow[1].format('YYYY-MM-DD')))
      && (!v.overdue || overdue(o));
  }), [opportunities, applied]);

  const from30 = dayjs(DEMO_DATE).subtract(30, 'day').format('YYYY-MM-DD');
  const stats = {
    active: opportunities.filter(ACTIVE).length,
    newly: opportunities.filter(o => o.created_at >= from30).length,
    todo: opportunities.filter(o => ACTIVE(o) && o.next_date).length,
    overdue: opportunities.filter(overdue).length,
    confirmed: opportunities.filter(o => o.stage === '合作确认' && (o.confirmed_at ?? '') >= '2026-01-01').length,
  };
  const biz = { opportunities, tasks: st.tasks, authorizations: st.authorizations, promotions: st.promotions };
  const fu = useMemo(() => funnelStats(biz), [opportunities, st.tasks, st.authorizations, st.promotions]); // eslint-disable-line react-hooks/exhaustive-deps
  const fuAns = useMemo(() => runFunnel(scope, biz), [opportunities, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const fuDrafts = fuAns.taskDrafts ?? [];
  const dwellOf = new Map(fu.active.map(x => [x.o.opportunity_id, x.dwell]));
  const maxReached = Math.max(1, fu.stages[0]?.reached ?? 1);
  const catName = (id: string) => catalogue.find(c => c.catalogue_id === id)?.name ?? id;
  const authOf = (o: Opportunity) => st.authorizations.filter(a => a.opportunity_id === o.opportunity_id);
  const target = (o: Opportunity) => (o.partner_id ? partnerMap.get(o.partner_id)!.name : <span>{o.prospect_name} <Tag>潜在线索</Tag></span>);

  return (
    <div>
      <PageTitle title="招商进度管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新增机会</Button>} />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        {[
          { t: '进行中机会数', v: stats.active, d: '口径：当前阶段非"合作确认/关闭"', f: {} },
          { t: '本期新增机会数', v: stats.newly, d: `口径：创建日期 ${from30} 至 ${DEMO_DATE}`, f: { created: [dayjs(from30), dayjs(DEMO_DATE)] } },
          { t: '待跟进机会数', v: stats.todo, d: `口径：进行中且有下次跟进计划；逾期 ${stats.overdue} 条`, f: { overdue: true } },
          { t: '已合作确认机会数', v: stats.confirmed, d: '口径：合作确认日期在2026年内', f: { stage: '合作确认' } },
        ].map(k => (
          <Col span={6} key={k.t}><Card size="small" className="clickable" onClick={() => { form.setFieldsValue(k.f as F); search(k.f as F); setMainTab('list'); }}>
            <Statistic title={k.t} value={k.v} /><span className="stat-note" title={k.d}>{k.d}</span>
          </Card></Col>
        ))}
      </Row>
      <Tabs className="page-main-tabs" activeKey={mainTab} onChange={k => setMainTab(k as any)} items={[
        { key: 'list', label: <span className="seg-label">机会列表<b>{data.length}</b></span>, children: <>
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" onFinish={search}>
          <Form.Item name="kw" label="机会"><Input allowClear placeholder="名称/编号" style={{ width: 140 }} /></Form.Item>
          <Form.Item name="catalogue" label="招商品种"><Select allowClear style={{ width: 200 }} options={catalogue.map(c => ({ value: c.catalogue_id, label: c.name }))} /></Form.Item>
          <Form.Item name="partner" label="意向合伙人"><Select allowClear style={{ width: 180 }} options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item>
          <Form.Item name="region" label="区域"><Select allowClear style={{ width: 90 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道"><Select allowClear style={{ width: 110 }} options={['医院', '药店', '商业公司', '全部渠道'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="owner" label="负责人"><Select allowClear style={{ width: 90 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="stage" label="阶段"><Select allowClear style={{ width: 110 }} options={OPP_STAGES.map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="created" label="创建日期"><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="lastFollow" label="最近跟进"><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="overdue" valuePropName="checked"><Checkbox>仅下次跟进逾期</Checkbox></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search({}); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <MetaBar meta={meta} extra={<Segmented size="small" value={view} onChange={v => setView(v as any)} options={['列表', '看板']} />} />
        {view === '列表' ? (
          <ResultTable<Opportunity> rowKey="opportunity_id" data={data} meta={meta} exportName="招商机会"
            exportCols={[{ key: 'opportunity_id', title: '机会编号' }, { key: 'name', title: '机会名称' }, { key: 'region', title: '区域' }, { key: 'channel', title: '渠道' }, { key: 'owner', title: '负责人' }, { key: 'stage', title: '阶段' }, { key: 'next_action', title: '下一步' }, { key: 'next_date', title: '下次跟进' }]}
            onRow={o => ({ onClick: () => setDetail(o.opportunity_id), style: { cursor: 'pointer' } })}
            columns={[
              { title: '机会编号', dataIndex: 'opportunity_id', fixed: 'left' },
              { title: '机会名称', dataIndex: 'name' },
              { title: '品种与规格', render: (_, o) => catName(o.catalogue_id) },
              { title: '意向合作对象', render: (_, o) => target(o) },
              { title: '区域/渠道', render: (_, o) => `${o.region} / ${o.channel}` },
              { title: '负责人', dataIndex: 'owner' },
              { title: '当前阶段', dataIndex: 'stage', render: s => <StatusTag value={s} /> },
              { title: '阶段停留', align: 'right', render: (_, o) => { const d = dwellOf.get(o.opportunity_id); return d === undefined ? '—' : d > FUNNEL_RULES.stuckDays ? <Tag color="warning" bordered={false} style={{ marginInlineEnd: 0 }}>卡点 {d}天</Tag> : `${d}天`; } },
              { title: '最近跟进', render: (_, o) => o.followups[0]?.at ?? '—' },
              { title: '下一步动作', dataIndex: 'next_action' },
              { title: '下次跟进', render: (_, o) => (o.next_date ? <span className={overdue(o) ? 'text-down' : ''}>{o.next_date}{overdue(o) && ' 逾期'}</span> : '—') },
              { title: '关联授权', render: (_, o) => authOf(o).map(a => <Tag key={a.authorization_id}>{a.authorization_id} {latestVersion(a).review === '已通过' ? authBizStatus(a, DEMO_DATE) : latestVersion(a).review}</Tag>) },
            ]} />
        ) : (
          <div className="kanban">
            {OPP_STAGES.map(s => (
              <div key={s} className={`kanban-col ${dragOver === s ? 'drop' : ''}`} onDragOver={e => { e.preventDefault(); setDragOver(s); }} onDragLeave={() => setDragOver(null)}
                onDrop={e => { setDragOver(null); const id = e.dataTransfer.getData('text'); const o = opportunities.find(x => x.opportunity_id === id); if (o && o.stage !== s) setStageReq({ id, to: s }); }}>
                <Space style={{ marginBottom: 8 }}><StatusTag value={s} /><Typography.Text type="secondary">{data.filter(o => o.stage === s).length}</Typography.Text></Space>
                {data.filter(o => o.stage === s).map(o => (
                  <div key={o.opportunity_id} className="kanban-card" draggable onDragStart={e => e.dataTransfer.setData('text', o.opportunity_id)} onClick={() => setDetail(o.opportunity_id)}>
                    <div><b>{o.opportunity_id}</b></div><div>{o.name}</div>
                    <Typography.Text type="secondary">{o.owner} · {o.region}/{o.channel}</Typography.Text>
                    {o.next_date && <div className={overdue(o) ? 'text-down' : ''}>下次：{o.next_date}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {view === '看板' && <Typography.Text type="secondary">拖动卡片等同申请阶段变更，仍需填写变更依据；看板与列表使用同一查询条件。</Typography.Text>}
      </div>
        </> },
        { key: 'funnel', label: <span className="seg-label"><RobotOutlined /> AI 漏斗诊断{fu.stuck.length + stats.overdue > 0 && <b className="warn">{fu.stuck.length + stats.overdue}</b>}</span>, children:
      <AiDiagPanel flat id="funnel" title="AI 漏斗诊断" ask="招商漏斗诊断" drafts={fuDrafts} analysis={fuAns} observed={fuAns.observed?.slice(1)}
        summary={<>进行中 {fu.active.length} 个，{fu.bottleneck ? <>转化最低环节 <b className="text-down">→{fu.bottleneck.stage}（{fu.bottleneck.conv === null ? '—' : `${Math.round(fu.bottleneck.conv * 100)}%`}）</b>，</> : null}{fu.stuck.length} 个机会停留超过 {FUNNEL_RULES.stuckDays} 天</>}
        kpis={[
          { label: '成交率', value: fu.won.length + fu.closed.length ? `${Math.round((fu.won.length / (fu.won.length + fu.closed.length)) * 100)}%` : '—' },
          { label: '卡点机会', value: fu.stuck.length, tone: fu.stuck.length ? 'warn' : undefined },
          { label: '跟进逾期', value: stats.overdue, tone: stats.overdue ? 'down' : undefined },
        ]}>
        <div className="diag-cols">
          <div>
            <div className="diag-sub">阶段转化</div>
            <div className="funnel">
              {fu.stages.map((s, i) => {
                const weak = fu.bottleneck?.stage === s.stage;
                return (
                  <div key={s.stage} style={{ display: 'contents' }}>
                    {i > 0 && <div className={`funnel-arrow ${weak ? 'weak' : ''}`}>→<span>{s.conv === null ? '—' : `${Math.round(s.conv * 100)}%`}</span></div>}
                    <div className={`funnel-step ${weak ? 'weak' : ''}`} onClick={() => { form.setFieldsValue({ stage: s.stage }); search({ stage: s.stage }); setMainTab('list'); }} style={{ cursor: 'pointer' }}>
                      <div className="funnel-bar" style={{ width: `${40 + (s.reached / maxReached) * 60}%` }}>{s.reached}</div>
                      <div className="funnel-name">{s.stage}</div>
                      <div className="funnel-sub">当前 {s.current}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="diag-sub">需要推进的机会</div>
            <div className="diag-list">
              {[...fu.stuck, ...fu.active.filter(x => !fu.stuck.includes(x) && x.o.next_date && x.o.next_date < DEMO_DATE)].slice(0, 4).map(x => (
                <div key={x.o.opportunity_id} className="diag-row" onClick={() => setDetail(x.o.opportunity_id)}>
                  <StatusTag value={x.o.stage} />
                  <span className="diag-row-main">{x.o.name}</span>
                  <span className="diag-row-side">{x.o.owner} · 停留 <b className={x.dwell > FUNNEL_RULES.stuckDays ? 'text-down' : ''}>{x.dwell}</b> 天{x.o.next_date && x.o.next_date < DEMO_DATE ? ' · 逾期' : ''}</span>
                </div>
              ))}
              {!fu.stuck.length && !stats.overdue && <span className="diag-row-side">暂无需要推进的机会</span>}
            </div>
          </div>
        </div>
      </AiDiagPanel>
        },
      ]} />
      <OppDetail id={detail} onClose={() => setDetail(null)} onStage={(id, to) => setStageReq({ id, to })} />
      <StageModal req={stageReq} onClose={() => setStageReq(null)} />
      <CreateOpp open={creating} preset={presetCat} onClose={() => { setCreating(false); setPresetCat(undefined); }} />
    </div>
  );
}

function StageModal({ req, onClose }: { req: { id: string; to: OppStage } | null; onClose: () => void }) {
  const { changeStage, opportunities } = useStore();
  const [form] = Form.useForm();
  const o = opportunities.find(x => x.opportunity_id === req?.id);
  useEffect(() => { form.resetFields(); if (req) form.setFieldsValue({ to: req.to }); }, [req, form]);
  return (
    <Modal open={!!req} title={`变更阶段：${o?.opportunity_id}`} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const reason = v.to === '关闭未达成' ? `${v.closeType}：${v.reason}` : v.reason;
      if (showResult(changeStage(req!.id, v.to, reason, o?.version))) onClose();
    }}>
      <Form form={form} layout="vertical">
        <Form.Item label="当前阶段"><StatusTag value={o?.stage ?? ''} /></Form.Item>
        <Form.Item name="to" label="目标阶段" rules={[{ required: true }]}><Select options={OPP_STAGES.filter(s => s !== o?.stage).map(v => ({ value: v }))} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{() => form.getFieldValue('to') === '关闭未达成' && <Form.Item name="closeType" label="关闭原因" rules={[{ required: true }]}><Select options={['暂缓', '无意向', '范围不匹配', '其他'].map(v => ({ value: v }))} /></Form.Item>}</Form.Item>
        <Form.Item noStyle shouldUpdate>{() => form.getFieldValue('to') === '合作确认' && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="合作确认须由有权人员登记确认日期与依据；确认后只能生成授权草稿，授权仍需独立确认。" />}</Form.Item>
        <Form.Item name="reason" label="变更依据" rules={[{ required: true, message: '阶段变更必须填写依据' }]}><Input.TextArea rows={3} placeholder="例如：会议纪要、沟通记录" /></Form.Item>
      </Form>
    </Modal>
  );
}

function CreateOpp({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: string }) {
  const { createOpportunity, catalogue, user } = useStore();
  const [form] = Form.useForm();
  useEffect(() => { if (open && preset) form.setFieldsValue({ catalogue_id: preset }); }, [open, preset, form]);
  return (
    <Modal open={open} title="新增招商机会" width={640} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const r = createOpportunity({ name: v.name, catalogue_id: v.catalogue_id, partner_id: v.targetType === 'partner' ? v.partner_id : null, prospect_name: v.targetType === 'lead' ? v.prospect_name : null, region: v.region as Region, channel: v.channel, owner: v.owner, source: v.source ?? '', need: v.need ?? '', expected_date: v.expected?.format('YYYY-MM-DD'), next_action: v.next_action ?? '', next_date: v.next_date?.format('YYYY-MM-DD') });
      if (showResult(r)) { form.resetFields(); onClose(); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ targetType: 'partner', owner: user }}>
        <Form.Item name="catalogue_id" label="招商品种" rules={[{ required: true }]} extra="仅“招商中”目录可新建机会"><Select options={catalogue.map(c => ({ value: c.catalogue_id, label: <span>{c.name} <StatusTag value={c.status} /></span>, disabled: c.status !== '招商中' }))} /></Form.Item>
        <Form.Item name="name" label="机会名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="targetType" label="意向合作对象"><Segmented options={[{ value: 'partner', label: '已建档合伙人' }, { value: 'lead', label: '潜在线索' }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{() => form.getFieldValue('targetType') === 'partner'
          ? <Form.Item name="partner_id" label="合伙人" rules={[{ required: true }]}><Select options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item>
          : <Form.Item name="prospect_name" label="线索名称（未建档）" rules={[{ required: true }]}><Input /></Form.Item>}</Form.Item>
        <Space>
          <Form.Item name="region" label="目标区域" rules={[{ required: true }]}><Select style={{ width: 120 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道" rules={[{ required: true }]}><Select style={{ width: 130 }} options={['医院', '药店', '商业公司', '全部渠道'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true }]}><Select style={{ width: 110 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
        </Space>
        <Form.Item name="source" label="来源"><Input /></Form.Item>
        <Form.Item name="need" label="需求说明"><Input.TextArea rows={2} /></Form.Item>
        <Space>
          <Form.Item name="expected" label="预计完成日期"><DatePicker /></Form.Item>
          <Form.Item name="next_action" label="下一步计划"><Input /></Form.Item>
          <Form.Item name="next_date" label="计划日期"><DatePicker /></Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

function OppDetail({ id, onClose, onStage }: { id: string | null; onClose: () => void; onStage: (id: string, to: OppStage) => void }) {
  const st = useStore();
  const nav = useNavigate();
  const o = st.opportunities.find(x => x.opportunity_id === id);
  const [fuOpen, setFuOpen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [reopen, setReopen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  if (!o) return <Drawer open={!!id} onClose={onClose}><Empty /></Drawer>;
  const cat = st.catalogue.find(c => c.catalogue_id === o.catalogue_id)!;
  const auths = st.authorizations.filter(a => a.opportunity_id === o.opportunity_id);
  const tasks = st.tasks.filter(t => t.object_ids.includes(o.opportunity_id));
  const closed = o.stage === '关闭未达成';
  return (
    <Drawer open={!!id} onClose={onClose} width={860} title={<DrawerTitle id={o.opportunity_id} name={o.name} tags={<StatusTag value={o.stage} />} sub={`负责人 ${o.owner} · ${o.region} / ${o.channel}`} />}>
      <div className="drawer-actions">
        <Space wrap size={8}>
          <Button onClick={() => setFuOpen(true)} disabled={closed}>添加跟进</Button>
          <Button onClick={() => onStage(o.opportunity_id, OPP_STAGES[Math.min(OPP_STAGES.indexOf(o.stage) + 1, 4)])} disabled={closed}>变更阶段</Button>
          <Button onClick={() => setOwnerOpen(true)}>变更负责人</Button>
          {o.stage === '合作确认' && <Button type="primary" onClick={() => { const r = st.generateAuthDraft(o.opportunity_id); if (showResult(r) && r.id) nav(`/authorizations?id=${r.id}`); }}>生成授权草稿</Button>}
          {closed ? <Button onClick={() => setReopen(true)}>重新开启</Button> : <Button danger onClick={() => onStage(o.opportunity_id, '关闭未达成')}>关闭</Button>}
        </Space>
        <Button type="primary" ghost icon={<RobotOutlined />} onClick={() => setAiText(summarizeFollowups(o))}>AI 进展摘要</Button>
      </div>
      {aiText && <Alert closable onClose={() => setAiText(null)} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} type="info" message="AI 草稿（规则解析模式，需人工确认）" description={aiText}
        action={o.next_date ? <Button size="small" onClick={() => showResult(st.addTask({ title: `${o.name}：${o.next_action}`, object_type: '招商机会', object_ids: [o.opportunity_id], suggestion: o.next_action, assignee: o.owner, due_at: o.next_date!, source: 'AI草稿确认', idemKey: `opp-${o.opportunity_id}-${o.next_date}` }))}>保存为待办</Button> : undefined} />}
      <Tabs items={[
        { key: 'info', label: '基本信息', children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2} items={[
              { label: '机会编号', children: o.opportunity_id }, { label: '创建日期', children: o.created_at },
              { label: '意向合作对象', children: o.partner_id ? partnerMap.get(o.partner_id)!.name : `${o.prospect_name}（潜在线索，未建档）` }, { label: '负责人', children: o.owner },
              { label: '目标区域/渠道', children: `${o.region} / ${o.channel}` }, { label: '来源', children: o.source },
              { label: '需求说明', children: o.need, span: 2 }, { label: '下一步', children: `${o.next_action} ${o.next_date ?? ''}` }, { label: '预计完成', children: o.expected_date ?? '—' },
              { label: '合作确认日期', children: o.confirmed_at ?? '—' }, { label: '关闭原因', children: o.close_reason ?? '—' },
            ]} />
            <Typography.Text strong>品种明细</Typography.Text>
            <Table size="small" pagination={false} rowKey="s" dataSource={cat.sku_ids.map(s => ({ s }))} columns={[{ title: '目录', render: () => <a onClick={() => nav(`/catalogue?id=${cat.catalogue_id}`)}>{cat.catalogue_id} {cat.name}</a> }, { title: 'SKU', render: (_, r) => skuLabelById(r.s) }, { title: '目录状态', render: () => <StatusTag value={cat.status} /> }]} />
          </Space>) },
        { key: 'fu', label: `跟进时间线（${o.followups.length}）`, children: o.followups.length ? (
          <Timeline items={o.followups.map(f => ({ children: <div><b>{f.at}</b> · {f.method} · 对象：{f.target} · {f.by}<div>沟通要点：{f.content}</div><div>反馈：{f.feedback}</div><div>下一步：{f.next_action} {f.next_date ?? ''}</div></div> }))} />) : <Empty description="暂无跟进" /> },
        { key: 'sc', label: '阶段变更', children: <Timeline items={[...o.stage_changes].reverse().map(c => ({ color: c.to === '关闭未达成' ? 'red' : 'blue', children: <div><b>{c.at}</b> · {c.by}<div>{c.from ?? '—'} → <StatusTag value={c.to} /></div><Typography.Text type="secondary">依据：{c.reason}</Typography.Text></div> }))} /> },
        { key: 'auth', label: `关联授权（${auths.length}）`, children: auths.length ? auths.map(a => <div key={a.authorization_id}><a onClick={() => nav(`/authorizations?id=${a.authorization_id}`)}>{a.authorization_id}</a> 审核：<StatusTag value={latestVersion(a).review} /> 业务：<StatusTag value={authBizStatus(a, DEMO_DATE)} /></div>) : <Empty description="暂无授权；合作确认后可生成授权草稿" /> },
        { key: 'mat', label: '资料附件', children: cat.materials.length ? cat.materials.map((m, i) => <div key={i}>{m.name} {m.version}（生效 {m.effective_date}）</div>) : <Empty /> },
        { key: 'task', label: `待办（${tasks.length}）`, children: tasks.length ? tasks.map(t => <div key={t.task_id}>{t.task_id} {t.title} · {t.due_at} <StatusTag value={t.status} /></div>) : <Empty /> },
      ]} />
      <FollowupModal open={fuOpen} onClose={() => setFuOpen(false)} opp={o} />
      <Modal open={reopen} title="重新开启机会" onCancel={() => setReopen(false)} onOk={() => { const el = document.getElementById('reopen-reason') as HTMLTextAreaElement; if (showResult(st.reopenOpportunity(o.opportunity_id, el?.value ?? ''))) setReopen(false); }}>
        <Typography.Paragraph type="secondary">重新开启保留关闭历史，不改变创建时间。</Typography.Paragraph>
        <Input.TextArea id="reopen-reason" rows={3} placeholder="重开原因（必填）" />
      </Modal>
      <Modal open={ownerOpen} title="变更负责人" footer={null} onCancel={() => setOwnerOpen(false)}>
        <Select style={{ width: 200 }} value={o.owner} options={PEOPLE.map(v => ({ value: v }))} onChange={v => { showResult(st.changeOwner(o.opportunity_id, v)); setOwnerOpen(false); }} />
      </Modal>
    </Drawer>
  );
}

function FollowupModal({ open, onClose, opp }: { open: boolean; onClose: () => void; opp: Opportunity }) {
  const { addFollowup } = useStore();
  const [form] = Form.useForm();
  return (
    <Modal open={open} title="添加跟进" width={600} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const r = addFollowup(opp.opportunity_id, { at: v.at.format('YYYY-MM-DD HH:mm'), method: v.method, target: v.target, content: v.content, feedback: v.feedback, next_action: v.next_action, next_date: v.next_date?.format('YYYY-MM-DD') }, v.sync);
      if (showResult(r)) { form.resetFields(); onClose(); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ at: dayjs(`${DEMO_DATE} 10:00`), method: '电话沟通', sync: true }}>
        <Space>
          <Form.Item name="at" label="发生时间" rules={[{ required: true }]}><DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="method" label="跟进方式" rules={[{ required: true }]}><Select style={{ width: 120 }} options={['业务拜访', '电话沟通', '资料介绍', '会议'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="target" label="对象" rules={[{ required: true }]}><Input /></Form.Item>
        </Space>
        <Form.Item name="content" label="沟通要点" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="feedback" label="反馈" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        <Space>
          <Form.Item name="next_action" label="下一步动作" rules={[{ required: true }]}><Input style={{ width: 260 }} /></Form.Item>
          <Form.Item name="next_date" label="下一步日期"><DatePicker /></Form.Item>
        </Space>
        <Form.Item name="sync" valuePropName="checked"><Checkbox>设置了下一步日期时，同步生成任务中心待办</Checkbox></Form.Item>
        <Typography.Text type="secondary">跟进记录与阶段变更是不同记录；如需变更阶段请使用"变更阶段"。</Typography.Text>
      </Form>
    </Modal>
  );
}
