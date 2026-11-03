import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import { Column } from '@ant-design/plots';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_DATE, PEOPLE, skus, CHANNELS } from '../data/mock';
import { makeMeta, partnerMap, scopedBatches, scopedFlows, skuLabelById, skuMap, type QueryMeta } from '../data/query';
import type { CatalogueItem, Region } from '../data/types';
import { useStore } from '../data/store';
import { authBizStatus, inPeriod, latestVersion, monthPeriod, netSalesAmount } from '../metrics';
import { Definition, MetaBar, PageTitle, ResultTable, StatusTag, showResult, DrawerTitle } from '../components/common';
import { SkuLink } from '../components/drill';
import { usePageAiContext } from '../ai/AiPanel';

interface F { status?: string; kw?: string; form?: string; mfr?: string; region?: string; channel?: string; owner?: string }
const STOCK_DEF = { cur: '当前库存：库存快照中该目录关联SKU的库存记录数量合计（同SKU同单位）；只读，来自库存快照', eff: '有效库存：原系统名称，定义待确认；保留原值，不替换为可用库存' };

export default function Catalogue() {
  const st = useStore();
  const { catalogue, scope } = st;
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F>({});
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [detail, setDetail] = useState<string | null>(params.get('id'));
  const [edit, setEdit] = useState<CatalogueItem | 'new' | null>(null);
  useEffect(() => { if (params.get('id')) setDetail(params.get('id')); }, [params]);
  const search = (v: F) => { setApplied(v); setMeta(makeMeta(scope, { 招商状态: v.status ?? '', 品种: v.kw ?? '', 剂型: v.form ?? '', 厂家: v.mfr ?? '', 可招商区域: v.region ?? '', 渠道: v.channel ?? '', 负责人: v.owner ?? '' })); };
  useEffect(() => { search({}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P02 招商目录管理', filters: meta?.applied_filters, selected: detail ? [detail] : [] });

  const bs = scopedBatches(scope);
  const stockOf = (c: CatalogueItem) => c.sku_ids.map(id => { const list = bs.filter(b => b.sku_id === id); return { id, qty: list.reduce((a, b) => a + b.qty, 0), eff: list.some(b => b.effective_qty_src === null) ? null : list.reduce((a, b) => a + (b.effective_qty_src ?? 0), 0), snap: [...new Set(list.map(b => b.snapshot_at))] }; });

  const data = useMemo(() => catalogue.filter(c => {
    const ss = c.sku_ids.map(id => skuMap.get(id)!);
    return (!applied.status || c.status === applied.status) && (!applied.kw || c.name.includes(applied.kw) || c.catalogue_id.includes(applied.kw) || ss.some(s => s.source_code.includes(applied.kw!) || s.pinyin.includes(applied.kw!.toUpperCase()) || s.generic_name.includes(applied.kw!)))
      && (!applied.form || ss.some(s => s.dosage_form === applied.form)) && (!applied.mfr || ss.some(s => s.manufacturer.includes(applied.mfr!)))
      && (!applied.region || c.regions.includes(applied.region as Region)) && (!applied.channel || c.channels.includes(applied.channel)) && (!applied.owner || c.owner === applied.owner);
  }), [catalogue, applied]);

  return (
    <div>
      <PageTitle title="招商目录管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEdit('new')}>新增目录草稿</Button>} />
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" onFinish={search}>
          <Form.Item name="status" label="招商状态"><Select allowClear style={{ width: 110 }} options={['草稿', '招商中', '暂停招商', '已终止'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="kw" label="品种"><Input allowClear style={{ width: 180 }} placeholder="编码/商品名/通用名/首拼" /></Form.Item>
          <Form.Item name="form" label="剂型"><Select allowClear style={{ width: 110 }} options={[...new Set(skus.map(s => s.dosage_form))].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="mfr" label="厂家"><Input allowClear style={{ width: 120 }} /></Form.Item>
          <Form.Item name="region" label="可招商区域"><Select allowClear style={{ width: 90 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channel" label="渠道"><Select allowClear style={{ width: 100 }} options={CHANNELS.map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="owner" label="负责人"><Select allowClear style={{ width: 90 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search({}); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <MetaBar meta={meta} />
        <ResultTable<CatalogueItem> rowKey="catalogue_id" data={data} meta={meta} exportName="招商目录"
          exportCols={[{ key: 'catalogue_id', title: '目录编号' }, { key: 'name', title: '名称' }, { key: 'status', title: '状态' }, { key: 'owner', title: '负责人' }, { key: 'updated_at', title: '更新' }]}
          onRow={c => ({ onClick: () => setDetail(c.catalogue_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: '目录编号', dataIndex: 'catalogue_id', fixed: 'left' },
            { title: '商品编码', render: (_, c) => c.sku_ids.map(id => <div key={id}>{skuMap.get(id)!.source_code}</div>) },
            { title: '商品名', render: (_, c) => c.sku_ids.map(id => <div key={id}>{skuMap.get(id)!.trade_name}</div>) },
            { title: '通用名', render: (_, c) => [...new Set(c.sku_ids.map(id => skuMap.get(id)!.generic_name))].join('、') },
            { title: '规格/转换比', render: (_, c) => c.sku_ids.map(id => { const s = skuMap.get(id)!; return <div key={id}>{s.spec} · {s.conversion ? `1${s.unit}=${s.conversion.factor}${s.conversion.minUnit}` : <Tag color="red">缺转换</Tag>}</div>; }) },
            { title: '剂型', render: (_, c) => skuMap.get(c.sku_ids[0])?.dosage_form },
            { title: '单位', render: (_, c) => [...new Set(c.sku_ids.map(id => skuMap.get(id)!.unit))].join('/') },
            { title: '厂家', render: (_, c) => [...new Set(c.sku_ids.map(id => skuMap.get(id)!.manufacturer))].join('、') },
            { title: '招商状态', dataIndex: 'status', render: s => <StatusTag value={s} /> },
            { title: '可招商范围', render: (_, c) => `${c.regions.join('、') || '—'} / ${c.channels.join('、') || '—'}` },
            { title: <Definition label="当前库存（快照）" def={STOCK_DEF.cur} />, align: 'right', render: (_, c) => stockOf(c).map(s => <div key={s.id}>{s.qty} {skuMap.get(s.id)!.unit}</div>) },
            { title: <Definition label="有效库存（原系统）" def={STOCK_DEF.eff} />, align: 'right', render: (_, c) => stockOf(c).map(s => <div key={s.id}>{s.eff === null ? <Tag>部分缺失</Tag> : `${s.eff} ${skuMap.get(s.id)!.unit}`}</div>) },
            { title: '负责人', dataIndex: 'owner' }, { title: '资料更新时间', dataIndex: 'updated_at' },
          ]}
          summary={<span>库存为只读快照（杭州/宁波 2026-11-03 08:00，上海 2026-11-02 22:00），不在本页维护库存。</span>} />
      </div>
      <CatDetail id={detail} onClose={() => setDetail(null)} onEdit={c => setEdit(c)} nav={nav} stockOf={stockOf} />
      <CatForm item={edit} onClose={() => setEdit(null)} onSaved={id => setDetail(id)} />
    </div>
  );
}

function CatDetail({ id, onClose, onEdit, nav, stockOf }: { id: string | null; onClose: () => void; onEdit: (c: CatalogueItem) => void; nav: (to: string) => void; stockOf: (c: CatalogueItem) => { id: string; qty: number; eff: number | null; snap: string[] }[] }) {
  const st = useStore();
  const c = st.catalogue.find(x => x.catalogue_id === id);
  const [act, setAct] = useState<null | '暂停' | '终止'>(null);
  const [reason, setReason] = useState('');
  const [matOpen, setMatOpen] = useState(false);
  const [ai, setAi] = useState<string | null>(null);
  useEffect(() => setAi(null), [id]);
  if (!c) return <Drawer open={!!id} onClose={onClose}><Empty /></Drawer>;
  const opps = st.opportunities.filter(o => o.catalogue_id === c.catalogue_id);
  const auths = st.authorizations.filter(a => a.versions.some(v => v.scope_items.some(s => s.catalogue_id === c.catalogue_id)));
  const promos = st.promotions.filter(p => p.catalogue_id === c.catalogue_id);
  const fs = scopedFlows(st.scope).filter(f => c.sku_ids.includes(f.sku_id));
  const months = Array.from({ length: 12 }, (_, i) => dayjs('2026-10-01').subtract(11 - i, 'month').format('YYYY-MM'));
  const trend = months.map(m => ({ month: m, amount: netSalesAmount(fs.filter(f => inPeriod(f.biz_date, monthPeriod(m)))) }));
  const missing = [!c.sku_ids.length && '未关联SKU', !c.regions.length && '未设置可招商区域', !c.channels.length && '未设置渠道', !c.materials.length && '缺少招商资料', !c.policy_ref && '未引用价格政策', c.sku_ids.some(s => !skuMap.get(s)!.conversion) && 'SKU缺少单位转换规则'].filter(Boolean) as string[];
  const genAi = () => {
    const s = c.sku_ids.map(x => skuMap.get(x)!);
    setAi([`【招商简介草稿 · 基于已确认资料】`, `${c.name}：${s.map(x => `${x.generic_name}（${x.spec}，${x.dosage_form}，${x.manufacturer}）`).join('；')}。`,
      `可招商范围：${c.regions.join('、') || '待定'}；适用渠道：${c.channels.join('、') || '待定'}。供货说明：${c.supply_note || '待补充'}。`,
      `资料：${c.materials.length ? c.materials.slice(0, 1).map(m => `${m.name} ${m.version}`).join('') : '暂无'}。价格与商业条款按权限另行提供，不在简介中披露。`,
      `资料缺项：${missing.length ? missing.join('；') : '无'}`, '说明：内容供用户审核；名称、规格与厂家匹配由主数据规则约束，AI不自动合并目录。'].join('\n'));
  };
  return (
    <Drawer open={!!id} onClose={onClose} width={900} title={<DrawerTitle id={c.catalogue_id} name={c.name} tags={<StatusTag value={c.status} />} />}>
      <div className="drawer-actions">
        <Space wrap size={8}>
          {c.status !== '已终止' && <Button onClick={() => onEdit(c)}>编辑</Button>}
          {(c.status === '草稿' || c.status === '暂停招商') && <Button type="primary" onClick={() => showResult(st.catalogueAction(c.catalogue_id, c.status === '草稿' ? '发布' : '恢复'))}>{c.status === '草稿' ? '发布招商' : '恢复招商'}</Button>}
          {c.status === '招商中' && <Button onClick={() => { setReason(''); setAct('暂停'); }}>暂停招商</Button>}
          {c.status !== '已终止' && <Button danger onClick={() => { setReason(''); setAct('终止'); }}>终止招商</Button>}
          <Button onClick={() => setMatOpen(true)} disabled={c.status === '已终止'}>维护资料</Button>
          <Button disabled={c.status !== '招商中'} onClick={() => nav(`/opportunities?create=${c.catalogue_id}`)}>发起招商机会</Button>
        </Space>
        <Button type="primary" ghost icon={<RobotOutlined />} onClick={genAi}>AI 招商简介</Button>
      </div>
      {ai && <Alert closable onClose={() => setAi(null)} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} type="info" message="AI 草稿（规则模板 · 需审核）" description={ai} />}
      {c.status === '暂停招商' && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="暂停招商：限制新建机会和新授权草稿；存续授权按授权自身状态继续判断，不自动撤销。" />}
      <Tabs items={[
        { key: 'd', label: '药品资料', children: (
          <Descriptions bordered size="small" column={2} items={[
            { label: '目录名称', children: c.name, span: 2 }, { label: '负责人', children: c.owner }, { label: '更新时间', children: c.updated_at },
            { label: '供货说明', children: c.supply_note || '—', span: 2 }, { label: '价格政策引用', children: c.policy_ref || '—', span: 2 },
            { label: '资料缺项', span: 2, children: missing.length ? missing.map(m => <Tag key={m} color="warning">{m}</Tag>) : <Tag color="success">无</Tag> },
          ]} />) },
        { key: 'sku', label: `关联SKU（${c.sku_ids.length}）`, children: (
          <Table size="small" pagination={false} rowKey="id" dataSource={stockOf(c)} columns={[
            { title: 'SKU', render: (_, r) => <SkuLink id={r.id} /> }, { title: '规格', render: (_, r) => skuMap.get(r.id)!.spec }, { title: '厂家', render: (_, r) => skuMap.get(r.id)!.manufacturer },
            { title: <Definition label="当前库存" def={STOCK_DEF.cur} />, align: 'right', render: (_, r) => `${r.qty} ${skuMap.get(r.id)!.unit}` },
            { title: <Definition label="有效库存（原系统）" def={STOCK_DEF.eff} />, align: 'right', render: (_, r) => (r.eff === null ? '部分缺失' : r.eff) },
            { title: '快照时点', render: (_, r) => r.snap.join(' / ') },
          ]} />) },
        { key: 'scope', label: '招商范围与条件', children: <Descriptions bordered size="small" column={1} items={[{ label: '可招商区域', children: c.regions.join('、') || '—' }, { label: '适用渠道', children: c.channels.join('、') || '—' }, { label: '供货', children: c.supply_note || '—' }, { label: '价格政策', children: <span>{c.policy_ref || '—'} <Typography.Text type="secondary">（演示示例，不代表真实结算价、佣金或返利）</Typography.Text></span> }]} /> },
        { key: 'mat', label: `政策及附件版本（${c.materials.length}）`, children: (
          <Table size="small" pagination={false} rowKey={(m, i) => `${m.doc_id}${m.version}${i}`} dataSource={c.materials} columns={[{ title: '资料', dataIndex: 'name' }, { title: '版本', dataIndex: 'version' }, { title: '生效日期', dataIndex: 'effective_date' }, { title: '可见范围', dataIndex: 'visibility' }, { title: '状态', render: (_, m, i) => (c.materials.findIndex(x => x.name === m.name) === i ? <Tag color="green">现行</Tag> : <Tag>历史版本</Tag>) }]} />) },
        { key: 'opp', label: `招商机会（${opps.length}）`, children: opps.length ? opps.map(o => <div key={o.opportunity_id}><a onClick={() => nav(`/opportunities?id=${o.opportunity_id}`)}>{o.opportunity_id} {o.name}</a> <StatusTag value={o.stage} /></div>) : <Empty /> },
        { key: 'ap', label: '授权与推广摘要', children: (
          <Space direction="vertical">
            {auths.map(a => <div key={a.authorization_id}>授权 <a onClick={() => nav(`/authorizations?id=${a.authorization_id}`)}>{a.authorization_id}</a> {partnerMap.get(a.partner_id)?.name} <StatusTag value={latestVersion(a).review} /><StatusTag value={authBizStatus(a, DEMO_DATE)} /></div>)}
            {promos.map(p => <div key={p.promotion_id}>推广 <a onClick={() => nav(`/promotions?id=${p.promotion_id}`)}>{p.promotion_id} {p.name}</a> <StatusTag value={p.status} /></div>)}
            {!auths.length && !promos.length && <Empty />}
          </Space>) },
        { key: 'sales', label: '销售及库存联查', children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text strong>关联SKU近12月净销售额</Typography.Text>
            <Column height={220} data={trend} xField="month" yField="amount" axis={{ y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(1)}万` } }} />
            <Space>{c.sku_ids.map(s => <Button key={s} size="small" onClick={() => nav(`/inventory?tab=batch&sku=${s}`)}>{skuLabelById(s)} 批号库存</Button>)}</Space>
          </Space>) },
        { key: 'h', label: '操作记录', children: <Timeline items={[...c.history].reverse().map(h => ({ children: `${h.at} ${h.by} · ${h.action}${h.detail ? ' · ' + h.detail : ''}` }))} /> },
      ]} />
      <Modal open={!!act} title={`${act}招商`} onCancel={() => setAct(null)} onOk={() => { if (showResult(st.catalogueAction(c.catalogue_id, act!, reason))) setAct(null); }}>
        <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={act === '终止' ? '终止原因（必填）' : '原因'} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{act}后默认限制新建机会和新授权草稿，历史保留；已有授权不会被自动撤销。</Typography.Paragraph>
      </Modal>
      <MaterialModal open={matOpen} onClose={() => setMatOpen(false)} item={c} />
    </Drawer>
  );
}

function MaterialModal({ open, onClose, item }: { open: boolean; onClose: () => void; item: CatalogueItem }) {
  const { addMaterial } = useStore();
  const [form] = Form.useForm();
  return (
    <Modal open={open} title="新增资料版本" onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      if (showResult(addMaterial(item.catalogue_id, { doc_id: `KD-${item.catalogue_id}`, name: v.name, version: v.version, effective_date: v.date.format('YYYY-MM-DD'), visibility: v.visibility }))) { form.resetFields(); onClose(); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(DEMO_DATE), visibility: '合作方可见', name: item.materials[0]?.name }}>
        <Form.Item name="name" label="资料名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Space><Form.Item name="version" label="版本" rules={[{ required: true }]}><Input placeholder="如 v2.1" /></Form.Item><Form.Item name="date" label="生效日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="visibility" label="可见范围"><Select style={{ width: 120 }} options={[{ value: '内部' }, { value: '合作方可见' }]} /></Form.Item></Space>
        <Typography.Text type="secondary">新版本不覆盖历史版本；已引用旧版本的推广记录仍可查看当时版本。</Typography.Text>
      </Form>
    </Modal>
  );
}

function CatForm({ item, onClose, onSaved }: { item: CatalogueItem | 'new' | null; onClose: () => void; onSaved: (id: string) => void }) {
  const st = useStore();
  const [form] = Form.useForm();
  useEffect(() => { form.resetFields(); if (item && item !== 'new') form.setFieldsValue(item); else form.setFieldsValue({ owner: st.user, regions: [], channels: [] }); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const used = new Set(st.catalogue.filter(c => item === 'new' || c.catalogue_id !== (item as CatalogueItem)?.catalogue_id).flatMap(c => c.sku_ids));
  return (
    <Modal open={!!item} width={720} title={item === 'new' ? '新增目录草稿' : '编辑目录'} onCancel={onClose} onOk={async () => {
      const v = await form.validateFields();
      const r = st.saveCatalogue(item === 'new' ? v : { ...v, catalogue_id: (item as CatalogueItem).catalogue_id });
      if (showResult(r)) { onClose(); if (r.id) onSaved(r.id); }
    }}>
      <Form form={form} layout="vertical">
        <Typography.Text strong>1 品种选择（从主数据选择）</Typography.Text>
        <Form.Item name="sku_ids" label="关联交易SKU" rules={[{ required: true }]} extra="同名不同规格/厂家分别列出，请按编码与规格确认；已被其他目录引用的SKU会标注">
          <Select mode="multiple" showSearch optionFilterProp="label" options={skus.map(s => ({ value: s.sku_id, label: `${s.trade_name} ${s.generic_name} ${s.spec} · ${s.manufacturer} · ${s.source_code}${used.has(s.sku_id) ? '（已在其他目录）' : ''}` }))} />
        </Form.Item>
        <Form.Item name="name" label="目录名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Typography.Text strong>2 招商范围</Typography.Text>
        <Space style={{ display: 'flex' }}>
          <Form.Item name="regions" label="可招商区域"><Select mode="multiple" style={{ width: 240 }} options={['浙江', '江苏', '上海'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="channels" label="适用渠道"><Select mode="multiple" style={{ width: 280 }} options={CHANNELS.map(v => ({ value: v }))} /></Form.Item>
        </Space>
        <Typography.Text strong>3 合作条件</Typography.Text>
        <Form.Item name="supply_note" label="供货说明"><Input /></Form.Item>
        <Form.Item name="policy_ref" label="价格政策引用（演示示例，按权限显示）"><Input placeholder="如 示例政策 ZC-2026-xx（演示）" /></Form.Item>
        <Typography.Text strong>4 资料</Typography.Text>
        <Typography.Paragraph type="secondary">保存后可在详情中"维护资料"新增资料版本。</Typography.Paragraph>
        <Typography.Text strong>5 负责人</Typography.Text>
        <Form.Item name="owner" rules={[{ required: true }]}><Select style={{ width: 160 }} options={PEOPLE.map(v => ({ value: v }))} /></Form.Item>
      </Form>
    </Modal>
  );
}
