import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Tooltip, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Radio, Row, Select, Space, Statistic, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_DATE, PEOPLE, customers, partners } from '../data/mock';
import { custMap, makeMeta, partnerMap, skuLabelById, type QueryMeta } from '../data/query';
import type { Authorization, AuthVersion, ScopeItem } from '../data/types';
import { useStore } from '../data/store';
import { authBizStatus, currentVersion, findOverlaps, latestVersion, validateAuthVersion } from '../metrics';
import { MetaBar, PageTitle, ResultTable, StatusTag, showResult, DrawerTitle } from '../components/common';
import { usePageAiContext } from '../ai/AiPanel';
import { AiDiagPanel } from '../components/AiDiag';
import { authHealth, runAuthHealth } from '../ai/tier2';
import { fmtMoney } from '../data/query';

const hsClass = (n: number) => (n >= 80 ? 'good' : n >= 60 ? 'mid' : 'bad');

const fmtArr = (v: string[] | 'ALL' | null) => (v === null ? <Tag color="error">未填写</Tag> : v === 'ALL' ? <Tag color="blue">全部</Tag> : v.join('、'));
const fmtCust = (c: ScopeItem['customers']) => (c === null ? <Tag color="error">未选择</Tag> : c.mode === 'ALL_MATCHING' ? '全部符合区域渠道的客户' : `指定清单：${c.ids.map(i => custMap.get(i)?.name).join('、')}`);
const daysLeftTo = (a: Authorization) => { const v = currentVersion(a); return v ? dayjs(v.valid_to).diff(DEMO_DATE, 'day') : null; };

interface F { kw?: string; partner?: string; catalogue?: string; region?: string; channel?: string; review?: string; biz?: string; owner?: string; validOn?: dayjs.Dayjs }

export default function Authorizations() {
  const st = useStore();
  const { authorizations, catalogue, scope } = st;
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F>({});
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [detail, setDetail] = useState<string | null>(params.get('id'));
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit' | 'scope'; id?: string } | null>(null);
  useEffect(() => { if (params.get('id')) setDetail(params.get('id')); }, [params]);
  const search = (v: F) => { setApplied(v); setMeta(makeMeta(scope, { 关键字: v.kw ?? '', 合伙人: v.partner ? partnerMap.get(v.partner)!.name : '', 品种: v.catalogue ?? '', 区域: v.region ?? '', 渠道: v.channel ?? '', 审核状态: v.review ?? '', 业务状态: v.biz ?? '', 负责人: v.owner ?? '', 有效日: v.validOn?.format('YYYY-MM-DD') ?? '' })); };
  useEffect(() => { search({}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P13 合伙人授权', filters: meta?.applied_filters, selected: detail ? [detail] : [] });

  const data = useMemo(() => authorizations.filter(a => {
    const v = latestVersion(a); const v0 = currentVersion(a) ?? v; const biz = authBizStatus(a, DEMO_DATE);
    const items = v0.scope_items;
    return (!applied.kw || a.authorization_id.includes(applied.kw) || (a.opportunity_id ?? '').includes(applied.kw)) && (!applied.partner || a.partner_id === applied.partner)
      && (!applied.catalogue || items.some(s => s.catalogue_id === applied.catalogue)) && (!applied.region || items.some(s => s.regions === 'ALL' || s.regions?.includes(applied.region as any)))
      && (!applied.channel || items.some(s => s.channels === 'ALL' || s.channels?.includes(applied.channel!))) && (!applied.review || v.review === applied.review)
      && (!applied.biz || biz === applied.biz) && (!applied.owner || a.owner === applied.owner)
      && (!applied.validOn || (v0.valid_from <= applied.validOn.format('YYYY-MM-DD') && v0.valid_to >= applied.validOn.format('YYYY-MM-DD')));
  }), [authorizations, applied]);

  const stats = {
    active: authorizations.filter(a => authBizStatus(a, DEMO_DATE) === '生效中').length,
    expiring: authorizations.filter(a => authBizStatus(a, DEMO_DATE) === '生效中' && (daysLeftTo(a) ?? 99) <= 30).length,
    pending: authorizations.filter(a => latestVersion(a).review === '待确认').length,
  };
  const catName = (id: string) => catalogue.find(c => c.catalogue_id === id)?.name ?? id;
  const biz = { opportunities: st.opportunities, tasks: st.tasks, authorizations, promotions: st.promotions };
  const health = useMemo(() => authHealth(scope, biz), [scope, authorizations, st.promotions]); // eslint-disable-line react-hooks/exhaustive-deps
  const hAns = useMemo(() => runAuthHealth(scope, biz), [scope, authorizations, st.promotions]); // eslint-disable-line react-hooks/exhaustive-deps
  const hDrafts = hAns.taskDrafts ?? [];
  const [mainTab, setMainTab] = useState<'list' | 'health'>(() => (params.get('diag') ? 'health' : 'list'));
  const hMap = new Map(health.map(h => [h.a.authorization_id, h]));
  const needFix = health.filter(h => h.issues.some(i => i.level !== '提示'));

  return (
    <div>
      <PageTitle title="合伙人授权" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: 'new' })}>新增授权草稿</Button>} />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={8}><Card size="small" className="clickable" onClick={() => { form.setFieldsValue({ biz: '生效中' }); search({ biz: '生效中' }); setMainTab('list'); }}><Statistic title="生效中授权数" value={stats.active} /></Card></Col>
        <Col span={8}><Card size="small" className="clickable" onClick={() => { form.setFieldsValue({ biz: '生效中' }); search({ biz: '生效中' }); setMainTab('list'); }}><Statistic title="未来30天内到期数（演示阈值）" value={stats.expiring} valueStyle={{ color: '#d48806' }} /></Card></Col>
        <Col span={8}><Card size="small" className="clickable" onClick={() => { form.setFieldsValue({ review: '待确认' }); search({ review: '待确认' }); setMainTab('list'); }}><Statistic title="待确认数" value={stats.pending} /></Card></Col>
      </Row>
      <Tabs className="page-main-tabs" activeKey={mainTab} onChange={k => setMainTab(k as any)} items={[
        { key: 'list', label: <span className="seg-label">授权列表<b>{data.length}</b></span>, children: <>
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" onFinish={search}>
          <Form.Item name="kw" label="编号"><Input allowClear placeholder="授权编号/关联机会" style={{ width: 150 }} /></Form.Item>
          <Form.Item name="partner" label="合伙人"><Select allowClear style={{ width: 180 }} options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item>
          <Form.Item name="catalogue" label="招商品种"><Select allowClear style={{ width: 200 }} options={catalogue.map(c => ({ value: c.catalogue_id, label: c.name }))} /></Form.Item>
          <Form.Item name="region" label="区域"><Select allowClear style={{ width: 90 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道"><Select allowClear style={{ width: 100 }} options={['医院', '药店', '商业公司'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="review" label="审核状态"><Select allowClear style={{ width: 100 }} options={['草稿', '待确认', '已通过', '已退回', '已撤回'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="biz" label="业务状态"><Select allowClear style={{ width: 100 }} options={['未生效', '生效中', '已暂停', '已到期', '已终止'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="validOn" label="在该日有效"><DatePicker /></Form.Item>
          <Form.Item name="owner" label="负责人"><Select allowClear style={{ width: 90 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search({}); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <MetaBar meta={meta} />
        <ResultTable<Authorization> rowKey="authorization_id" data={data} meta={meta} exportName="合伙人授权"
          exportCols={[{ key: 'authorization_id', title: '授权编号' }, { key: 'partner', title: '合伙人' }, { key: 'from', title: '起' }, { key: 'to', title: '止' }, { key: 'review', title: '审核状态' }, { key: 'biz', title: '业务状态' }]}
          exportRow={a => { const v = currentVersion(a) ?? latestVersion(a); return { authorization_id: a.authorization_id, partner: partnerMap.get(a.partner_id)!.name, from: v.valid_from, to: v.valid_to, review: latestVersion(a).review, biz: authBizStatus(a, DEMO_DATE) }; }}
          onRow={a => ({ onClick: () => setDetail(a.authorization_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: '授权编号', dataIndex: 'authorization_id', fixed: 'left' },
            { title: '合伙人', render: (_, a) => partnerMap.get(a.partner_id)?.name },
            { title: '品种/SKU摘要', render: (_, a) => (currentVersion(a) ?? latestVersion(a)).scope_items.map(s => <div key={s.catalogue_id}>{catName(s.catalogue_id)}（{s.sku_ids.length}个SKU）</div>) },
            { title: '区域/渠道/客户范围', render: (_, a) => (currentVersion(a) ?? latestVersion(a)).scope_items.map((s, i) => <div key={i}>{fmtArr(s.regions as any)} / {fmtArr(s.channels)} / {s.customers?.mode === 'LIST' ? '指定客户' : s.customers ? '全部符合' : '未选'}</div>) },
            { title: '有效期', render: (_, a) => { const v = currentVersion(a) ?? latestVersion(a); return v.valid_from ? `${v.valid_from} ~ ${v.valid_to}` : <Tag color="error">未填写</Tag>; } },
            { title: '审核状态', render: (_, a) => <Space size={2}><StatusTag value={latestVersion(a).review} />{a.current_version > 0 && latestVersion(a).version !== a.current_version && <Tag>现行 v{a.current_version}</Tag>}</Space> },
            { title: '业务状态', render: (_, a) => <StatusTag value={authBizStatus(a, DEMO_DATE)} /> },
            { title: '剩余天数', align: 'right', render: (_, a) => { const d = daysLeftTo(a); const b = authBizStatus(a, DEMO_DATE); return d === null || b === '已到期' || b === '已终止' ? '—' : <span className={d <= 30 ? 'text-down' : ''}>{d}</span>; } },
            { title: '重叠提示', render: (_, a) => { const o = findOverlaps(a, authorizations, DEMO_DATE); return o.length ? <Tag color="gold">与 {o.map(x => x.other.authorization_id).join('、')} 重叠</Tag> : null; } },
            { title: 'AI 健康分', align: 'right', sorter: (x, y) => (hMap.get(x.authorization_id)?.score ?? 100) - (hMap.get(y.authorization_id)?.score ?? 100), render: (_, a) => { const h = hMap.get(a.authorization_id); return h ? <Tooltip title={h.issues.map(i => i.text).join('；') || '无问题'}><span className={`hs ${hsClass(h.score)}`}>{h.score}</span></Tooltip> : '—'; } },
            { title: '负责人', dataIndex: 'owner' }, { title: '更新时间', dataIndex: 'updated_at' },
          ]} />
      </div>
        </> },
        { key: 'health', label: <span className="seg-label"><RobotOutlined /> AI 健康诊断{needFix.length > 0 && <b className="warn">{needFix.length}</b>}</span>, children:
      <AiDiagPanel flat id="authhealth" title="AI 授权健康诊断" ask="授权与推广健康度" drafts={hDrafts} analysis={hAns} observed={[]}
        summary={<>{health.length} 份未终止授权，<b className={needFix.length ? 'text-down' : ''}>{needFix.length} 份需处理</b>；检查到期、待确认、生效无推广、暂停仍推广、范围重叠等情况</>}
        kpis={[
          { label: '需处理', value: needFix.length, tone: needFix.length ? 'down' : undefined },
          { label: '生效无推广', value: health.filter(h => h.biz === '生效中' && !h.running.length).length, tone: 'warn' },
          { label: '平均健康分', value: health.length ? Math.round(health.reduce((a, h) => a + h.score, 0) / health.length) : '—' },
        ]}>
        <div className="health-grid">
          {health.filter(h => h.issues.length).map(h => (
            <div key={h.a.authorization_id} className="health-card" onClick={() => setDetail(h.a.authorization_id)}>
              <div className="health-card-top">
                <span><b>{h.a.authorization_id}</b> {partnerMap.get(h.a.partner_id)?.name}</span>
                <span className={`hs ${hsClass(h.score)}`}>{h.score}</span>
              </div>
              <Space size={4}><StatusTag value={h.biz} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>推广 {h.promos.length}（执行中 {h.running.length}）· 范围内90天 {fmtMoney(Math.round(h.sales90))}</Typography.Text></Space>
              <ul>{h.issues.map(i => <li key={i.text} className={i.level === '高' ? 'text-down' : ''}>{i.text}</li>)}</ul>
            </div>
          ))}
        </div>
      </AiDiagPanel>
        },
      ]} />
      <AuthDetail id={detail} onClose={() => setDetail(null)} onEdit={(mode, id) => setEditing({ mode, id })} />
      <AuthForm req={editing} onClose={() => setEditing(null)} onCreated={id => setDetail(id)} />
    </div>
  );
}

function versionDiff(a?: AuthVersion, b?: AuthVersion): string[] {
  if (!a || !b) return [];
  const d: string[] = [];
  if (a.valid_from !== b.valid_from || a.valid_to !== b.valid_to) d.push(`有效期：${a.valid_from}~${a.valid_to} → ${b.valid_from}~${b.valid_to}`);
  const sa = JSON.stringify(a.scope_items); const sb = JSON.stringify(b.scope_items);
  if (sa !== sb) {
    a.scope_items.forEach((x, i) => {
      const y = b.scope_items[i];
      if (!y) { d.push(`删除范围明细 ${i + 1}`); return; }
      if (JSON.stringify(x.regions) !== JSON.stringify(y.regions)) d.push(`明细${i + 1} 区域：${JSON.stringify(x.regions)} → ${JSON.stringify(y.regions)}`);
      if (JSON.stringify(x.channels) !== JSON.stringify(y.channels)) d.push(`明细${i + 1} 渠道：${JSON.stringify(x.channels)} → ${JSON.stringify(y.channels)}`);
      if (JSON.stringify(x.customers) !== JSON.stringify(y.customers)) d.push(`明细${i + 1} 客户范围：${x.customers?.mode === 'LIST' ? '指定清单' : '全部符合'} → ${y.customers?.mode === 'LIST' ? '指定清单' : '全部符合'}`);
      if (JSON.stringify(x.sku_ids) !== JSON.stringify(y.sku_ids)) d.push(`明细${i + 1} SKU：${x.sku_ids.join(',')} → ${y.sku_ids.join(',')}`);
    });
    if (b.scope_items.length > a.scope_items.length) d.push(`新增范围明细 ${b.scope_items.length - a.scope_items.length} 条`);
  }
  return d.length ? d : ['无实质差异'];
}

function AuthDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (mode: 'edit' | 'scope', id: string) => void }) {
  const st = useStore();
  const nav = useNavigate();
  const a = st.authorizations.find(x => x.authorization_id === id);
  const [verSel, setVerSel] = useState<number | null>(null);
  const [act, setAct] = useState<null | '模拟退回' | '暂停' | '恢复' | '终止' | '续期'>(null);
  const [reason, setReason] = useState('');
  const [renewTo, setRenewTo] = useState<dayjs.Dayjs | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  useEffect(() => { setVerSel(null); setAiText(null); }, [id]);
  if (!a) return <Drawer open={!!id} onClose={onClose}><Empty /></Drawer>;
  const lv = latestVersion(a); const cv = currentVersion(a); const biz = authBizStatus(a, DEMO_DATE);
  const shown = a.versions.find(v => v.version === (verSel ?? lv.version))!;
  const overlaps = findOverlaps(a, st.authorizations, DEMO_DATE);
  const promos = st.promotions.filter(p => p.authorization_id === a.authorization_id);
  const errs = validateAuthVersion(lv);
  const run = (x: Parameters<typeof st.authAction>[1], payload: Parameters<typeof st.authAction>[2] = {}) => showResult(st.authAction(a.authorization_id, x, { ...payload, expectedVersion: lv.version }));
  const editable = ['草稿', '已退回', '已撤回'].includes(lv.review);

  const aiSummary = () => {
    const lines = [`【AI草稿 · 规则解释】${a.authorization_id}`, `业务状态"${biz}"：审核${lv.review}${cv ? `，现行 v${cv.version} 有效期 ${cv.valid_from}~${cv.valid_to}` : '，尚无已通过版本'}${a.suspended ? '，已暂停' : ''}。`];
    if (cv && biz === '生效中') lines.push(`距到期 ${dayjs(cv.valid_to).diff(DEMO_DATE, 'day')} 天${dayjs(cv.valid_to).diff(DEMO_DATE, 'day') <= 30 ? '，建议评估续期（续期产生新版本，需确认）' : ''}。`);
    if (a.versions.length > 1) lines.push(`最近变更（v${a.versions[a.versions.length - 2].version} → v${lv.version}）：${versionDiff(a.versions[a.versions.length - 2], lv).join('；')}`);
    if (errs.length && editable) lines.push(`缺项：${errs.join('；')}`);
    if (overlaps.length) lines.push(`范围重叠：${overlaps.map(o => o.other.authorization_id).join('、')}（无独家规则时不认定为无效，请核查）`);
    lines.push('说明：AI不自动批准授权；范围、日期和冲突检查由规则程序执行。');
    setAiText(lines.join('\n'));
  };

  return (
    <Drawer open={!!id} onClose={onClose} width={900} title={<DrawerTitle id={a.authorization_id} name={partnerMap.get(a.partner_id)?.name} tags={<><span>审核</span><StatusTag value={lv.review} /><span>业务</span><StatusTag value={biz} /></>} />}>
      <div className="drawer-actions">
        <Space wrap size={8}>
          {editable && <Button onClick={() => onEdit('edit', a.authorization_id)}>编辑</Button>}
          {editable && <Button type="primary" onClick={() => run('提交确认')}>提交确认</Button>}
          {lv.review === '待确认' && <><Button onClick={() => run('撤回')}>撤回</Button><Button type="primary" onClick={() => run('模拟通过')}>模拟通过</Button><Button danger onClick={() => { setReason(''); setAct('模拟退回'); }}>模拟退回</Button></>}
          {biz === '生效中' && <Button onClick={() => { setReason(''); setAct('暂停'); }}>暂停</Button>}
          {a.suspended && !a.terminated && <Button onClick={() => { setReason(''); setAct('恢复'); }}>恢复</Button>}
          {cv && !a.terminated && lv.review === '已通过' && <><Button onClick={() => { setRenewTo(dayjs(cv.valid_to).add(1, 'year')); setAct('续期'); }}>续期</Button><Button onClick={() => onEdit('scope', a.authorization_id)}>变更范围</Button></>}
          {!a.terminated && cv && <Button danger onClick={() => { setReason(''); setAct('终止'); }}>终止</Button>}
        </Space>
        <Button type="primary" ghost icon={<RobotOutlined />} onClick={aiSummary}>AI 解释</Button>
      </div>
      {aiText && <Alert closable onClose={() => setAiText(null)} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} type="info" message="AI 草稿（需人工确认）" description={aiText} />}
      <AuthHealthInline id={a.authorization_id} />
      {overlaps.length > 0 && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={`范围重叠提示：与 ${overlaps.map(o => `${o.other.authorization_id}（${partnerMap.get(o.other.partner_id)?.name}${o.samePartner ? '，同一主体' : ''}）`).join('、')} 在产品/区域/渠道/期限上重叠，请核查。是否独家待客户确认，当前不认定为无效。`} />}
      {editable && errs.length > 0 && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="提交前需补全" description={<ul className="tight">{errs.map(e => <li key={e}>{e}</li>)}</ul>} />}
      {cv && lv.version !== cv.version && <Alert style={{ marginBottom: 12 }} type="info" showIcon message={`存在待处理的新版本 v${lv.version}（${lv.review}），确认前现行有效版本仍为 v${cv.version}。`} />}
      <Tabs items={[
        { key: 'o', label: '授权概况', children: (
          <Descriptions bordered size="small" column={2} items={[
            { label: '授权编号', children: a.authorization_id }, { label: '合伙人', children: partnerMap.get(a.partner_id)?.name },
            { label: '内部负责人', children: a.owner }, { label: '关联机会', children: a.opportunity_id ? <a onClick={() => nav(`/opportunities?id=${a.opportunity_id}`)}>{a.opportunity_id}</a> : '—' },
            { label: '现行版本', children: cv ? `v${cv.version}` : '无（未通过）' }, { label: '现行有效期', children: cv ? `${cv.valid_from} ~ ${cv.valid_to}` : '—' },
            { label: '审核状态（最新版本）', children: <StatusTag value={lv.review} /> }, { label: '业务状态', children: <StatusTag value={biz} /> },
            { label: '依据说明', children: (cv ?? lv).basis || '—', span: 2 }, { label: '终止原因', children: a.terminate_reason ?? '—', span: 2 },
            { label: '系统数据权限', span: 2, children: <Typography.Text type="secondary">商业授权不自动开放客户、价格、库存或销售明细；登录用户数据权限由系统权限单独配置。</Typography.Text> },
          ]} />) },
        { key: 's', label: '结构化授权范围', children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>查看版本：<Select size="small" value={shown.version} onChange={setVerSel} options={a.versions.map(v => ({ value: v.version, label: `v${v.version}（${v.review}${v.version === a.current_version ? '·现行' : ''}）` }))} /></Space>
            <Typography.Text type="secondary">同一条明细中产品、区域、渠道、客户限制同时满足才算命中；多条明细取并集。SKU为明确集合，目录后续新增SKU不自动扩大授权。</Typography.Text>
            <Table size="small" pagination={false} rowKey={(_, i) => String(i)} dataSource={shown.scope_items} columns={[
              { title: '#', render: (_, __, i) => i + 1 }, { title: '目录品种', render: (_, s) => s.catalogue_id },
              { title: 'SKU集合', render: (_, s) => s.sku_ids.map(x => <div key={x}>{skuLabelById(x)}</div>) },
              { title: '区域', render: (_, s) => fmtArr(s.regions as any) }, { title: '渠道', render: (_, s) => fmtArr(s.channels) }, { title: '客户范围', render: (_, s) => fmtCust(s.customers) },
            ]} />
            <Typography.Text>有效期：{shown.valid_from || '未填'} ~ {shown.valid_to || '未填'}</Typography.Text>
          </Space>) },
        { key: 'r', label: `关联机会与推广（${promos.length}）`, children: (
          <Space direction="vertical">
            {a.opportunity_id && <div>招商机会：<a onClick={() => nav(`/opportunities?id=${a.opportunity_id}`)}>{a.opportunity_id}</a></div>}
            {promos.length ? promos.map(p => <div key={p.promotion_id}>推广：<a onClick={() => nav(`/promotions?id=${p.promotion_id}`)}>{p.promotion_id} {p.name}</a> <StatusTag value={p.status} /> 引用 v{p.authorization_version}</div>) : <Typography.Text type="secondary">暂无推广计划</Typography.Text>}
            {biz !== '生效中' && <Alert type="warning" showIcon message={`授权当前"${biz}"：不能启动正式推广（草稿可筹备）`} />}
          </Space>) },
        { key: 'f', label: '附件依据', children: (
          <Space direction="vertical">
            {a.attachments.length ? a.attachments.map(f => <Tag key={f}>📎 {f}</Tag>) : <Typography.Text type="secondary">暂无附件</Typography.Text>}
            <Button disabled icon={<RobotOutlined />}>AI 附件抽取候选表单 <Tag style={{ marginLeft: 6 }}>P1</Tag></Button>
          </Space>) },
        { key: 'h', label: '版本及操作历史', children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Table size="small" pagination={false} rowKey="version" dataSource={a.versions} columns={[
              { title: '版本', render: (_, v) => <Space>v{v.version}{v.version === a.current_version && <Tag color="green">现行</Tag>}</Space> },
              { title: '审核', render: (_, v) => <StatusTag value={v.review} /> }, { title: '有效期', render: (_, v) => `${v.valid_from || '—'} ~ ${v.valid_to || '—'}` },
              { title: '说明', dataIndex: 'change_note' }, { title: '创建', render: (_, v) => `${v.created_at} ${v.created_by}` },
              { title: '与上一版差异', render: (_, v) => { const i = a.versions.indexOf(v); return i === 0 ? '—' : versionDiff(a.versions[i - 1], v).map(d => <div key={d} style={{ fontSize: 12 }}>{d}</div>); } },
            ]} />
            <Timeline items={[...a.history].reverse().map(h => ({ children: <span><b>{h.at}</b> {h.by} · {h.action}{h.detail ? ` · ${h.detail}` : ''}</span> }))} />
          </Space>) },
      ]} />
      <Modal open={!!act} title={act ?? ''} onCancel={() => setAct(null)} onOk={() => {
        const okd = act === '续期' ? run('续期', { valid_to: renewTo?.format('YYYY-MM-DD') }) : run(act!, { reason });
        if (okd) setAct(null);
      }}>
        {act === '续期' ? <Space direction="vertical"><Typography.Text>续期将创建新版本（草稿），确认通过后成为现行版本。</Typography.Text><Space>新结束日期<DatePicker value={renewTo} onChange={setRenewTo} /></Space></Space>
          : <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={act === '恢复' ? '恢复说明（恢复时重新校验期限和范围）' : '原因（必填）'} />}
        {act === '暂停' && <Typography.Paragraph type="warning" style={{ marginTop: 8 }}>暂停后，引用该授权的执行中推广计划将同步暂停。</Typography.Paragraph>}
      </Modal>
    </Drawer>
  );
}

const toArr = (v?: string[]) => (!v || !v.length ? null : v.includes('ALL') ? 'ALL' : v);
function AuthForm({ req, onClose, onCreated }: { req: { mode: 'new' | 'edit' | 'scope'; id?: string } | null; onClose: () => void; onCreated: (id: string) => void }) {
  const st = useStore();
  const [form] = Form.useForm();
  const a = req?.id ? st.authorizations.find(x => x.authorization_id === req.id) : undefined;
  useEffect(() => {
    form.resetFields();
    if (!req) return;
    if (a) {
      const v = req.mode === 'scope' ? currentVersion(a)! : latestVersion(a);
      form.setFieldsValue({
        partner_id: a.partner_id, owner: a.owner, opportunity_id: a.opportunity_id, basis: v.basis, attachments: a.attachments, note: '',
        range: v.valid_from ? [dayjs(v.valid_from), dayjs(v.valid_to)] : undefined,
        items: v.scope_items.map(s => ({ catalogue_id: s.catalogue_id, sku_ids: s.sku_ids, regions: s.regions === 'ALL' ? ['ALL'] : s.regions ?? [], channels: s.channels === 'ALL' ? ['ALL'] : s.channels ?? [], custMode: s.customers?.mode, custIds: s.customers?.mode === 'LIST' ? s.customers.ids : [] })),
      });
    } else form.setFieldsValue({ owner: st.user, items: [{ custMode: 'ALL_MATCHING', regions: [], channels: [] }] });
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const v = await form.validateFields();
    const scope_items: ScopeItem[] = v.items.map((i: any) => ({ catalogue_id: i.catalogue_id, sku_ids: i.sku_ids ?? [], regions: toArr(i.regions), channels: toArr(i.channels), customers: !i.custMode ? null : i.custMode === 'LIST' ? { mode: 'LIST', ids: i.custIds ?? [] } : { mode: 'ALL_MATCHING' } }));
    const version = { scope_items, valid_from: v.range?.[0].format('YYYY-MM-DD') ?? '', valid_to: v.range?.[1].format('YYYY-MM-DD') ?? '', basis: v.basis ?? '', change_note: v.note || (req!.mode === 'new' ? '首次授权' : '编辑') };
    let r;
    if (req!.mode === 'scope') r = st.authAction(a!.authorization_id, '变更范围', { reason: v.note, version });
    else r = st.saveAuthDraft({ authorization_id: a?.authorization_id, partner_id: v.partner_id, owner: v.owner, opportunity_id: v.opportunity_id, version, attachments: v.attachments });
    if (showResult(r)) { onClose(); if (r.id) onCreated(r.id); }
  };
  const confirmedOpps = st.opportunities.filter(o => o.stage === '合作确认');
  return (
    <Modal open={!!req} width={860} title={req?.mode === 'new' ? '新增授权草稿' : req?.mode === 'scope' ? `变更范围（将创建新版本，确认前不覆盖现行版本）` : '编辑授权草稿'} onCancel={onClose} onOk={submit} okText="保存草稿">
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={8}><Form.Item name="partner_id" label="合伙人" rules={[{ required: true }]}><Select disabled={req?.mode === 'scope'} options={partners.map(p => ({ value: p.partner_id, label: p.name }))} /></Form.Item></Col>
          <Col span={6}><Form.Item name="owner" label="内部负责人" rules={[{ required: true }]}><Select options={PEOPLE.map(v => ({ value: v }))} /></Form.Item></Col>
          <Col span={10}><Form.Item name="opportunity_id" label="关联招商机会（可选）"><Select allowClear disabled={req?.mode === 'scope'} options={confirmedOpps.map(o => ({ value: o.opportunity_id, label: `${o.opportunity_id} ${o.name}` }))} /></Form.Item></Col>
          <Col span={10}><Form.Item name="range" label="有效期起止" extra="可暂存为空，提交确认时必填"><DatePicker.RangePicker /></Form.Item></Col>
          <Col span={14}><Form.Item name="basis" label="依据说明" extra="提交确认时必填"><Input placeholder="例如：合作协议、会议纪要" /></Form.Item></Col>
          <Col span={24}><Form.Item name="attachments" label="附件（演示：选择预置附件）"><Select mode="tags" options={['合作协议_演示.pdf', '会议纪要_演示.pdf', '合作意向书_演示.pdf'].map(v => ({ value: v }))} /></Form.Item></Col>
          {req?.mode === 'scope' && <Col span={24}><Form.Item name="note" label="变更说明" rules={[{ required: true }]}><Input /></Form.Item></Col>}
        </Row>
        <Typography.Text strong>授权范围明细</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>区域与渠道可明确选择"全部"；未填写表示未完成，不会被解释为不限范围。</Typography.Paragraph>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map(f => (
                <Card key={f.key} size="small" style={{ marginBottom: 8 }} extra={fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />} title={`明细 ${f.name + 1}`}>
                  <Row gutter={8}>
                    <Col span={10}><Form.Item name={[f.name, 'catalogue_id']} label="目录品种" rules={[{ required: true }]}>
                      <Select onChange={id => { const c = st.catalogue.find(x => x.catalogue_id === id)!; const items = form.getFieldValue('items'); items[f.name].sku_ids = c.sku_ids; form.setFieldsValue({ items }); }}
                        options={st.catalogue.map(c => ({ value: c.catalogue_id, label: `${c.catalogue_id} ${c.name}`, disabled: c.status !== '招商中' }))} />
                    </Form.Item></Col>
                    <Col span={14}><Form.Item noStyle shouldUpdate>{() => { const cid = form.getFieldValue(['items', f.name, 'catalogue_id']); const c = st.catalogue.find(x => x.catalogue_id === cid); return (
                      <Form.Item name={[f.name, 'sku_ids']} label="明确SKU集合"><Select mode="multiple" options={(c?.sku_ids ?? []).map(s => ({ value: s, label: skuLabelById(s) }))} /></Form.Item>); }}</Form.Item></Col>
                    <Col span={8}><Form.Item name={[f.name, 'regions']} label="区域"><Select mode="multiple" placeholder="未填写" options={[{ value: 'ALL', label: '全部' }, ...['浙江', '江苏', '上海'].map(v => ({ value: v }))]} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[f.name, 'channels']} label="渠道"><Select mode="multiple" placeholder="未填写" options={[{ value: 'ALL', label: '全部' }, ...['医院', '药店', '商业公司'].map(v => ({ value: v }))]} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[f.name, 'custMode']} label="客户范围"><Radio.Group options={[{ value: 'ALL_MATCHING', label: '全部符合' }, { value: 'LIST', label: '指定清单' }]} /></Form.Item></Col>
                    <Form.Item noStyle shouldUpdate>{() => form.getFieldValue(['items', f.name, 'custMode']) === 'LIST' && (
                      <Col span={24}><Form.Item name={[f.name, 'custIds']} label="指定客户"><Select mode="multiple" options={customers.map(c => ({ value: c.customer_id, label: `${c.name}（${c.region}/${c.type}）` }))} /></Form.Item></Col>)}</Form.Item>
                  </Row>
                </Card>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ custMode: 'ALL_MATCHING', regions: [], channels: [] })}>添加范围明细</Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

function AuthHealthInline({ id }: { id: string }) {
  const st = useStore();
  const h = authHealth(st.scope, { opportunities: st.opportunities, tasks: st.tasks, authorizations: st.authorizations, promotions: st.promotions }).find(x => x.a.authorization_id === id);
  if (!h) return null;
  return (
    <div className="diag" style={{ marginBottom: 12 }}>
      <div className="diag-head" style={{ padding: '10px 14px' }}>
        <span className="ai-logo diag-logo"><RobotOutlined /></span>
        <div className="diag-title">
          <div><b>AI 健康诊断</b><span className={`hs ${hsClass(h.score)}`}>{h.score} 分</span></div>
          <div className="diag-summary">{h.issues.length ? h.issues.map(i => i.text).join('；') : '未发现问题'}｜推广 {h.promos.length} 个（执行中 {h.running.length}）｜范围内近90天销售流向 {fmtMoney(Math.round(h.sales90))}</div>
        </div>
      </div>
    </div>
  );
}
