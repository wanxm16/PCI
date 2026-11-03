import React, { createContext, useContext, useMemo, useState } from 'react';
import { Alert, Descriptions, Drawer, Empty, Space, Table, Tabs, Tag, Typography } from 'antd';
import { Column, Line } from '@ant-design/plots';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { custMap, fmtMoney, ownerMap, scopedBatches, scopedFlows, skuLabel, skuMap, whMap } from '../data/query';
import { DEMO_DATE } from '../data/mock';
import { availableQty, daysLeft, expiryState, inPeriod, monthPeriod, netSalesAmount, coverageDays } from '../metrics';
import { useStore } from '../data/store';
import { StatusTag } from './common';

interface Drill { openSku: (id: string) => void; openCustomer: (id: string) => void }
const Ctx = createContext<Drill>({ openSku: () => {}, openCustomer: () => {} });
export const useDrill = () => useContext(Ctx);

const last12 = () => Array.from({ length: 12 }, (_, i) => dayjs('2026-10-01').subtract(11 - i, 'month').format('YYYY-MM'));

export function DrillProvider({ children }: { children: React.ReactNode }) {
  const [sku, setSku] = useState<string | null>(null);
  const [cust, setCust] = useState<string | null>(null);
  const v = useMemo(() => ({ openSku: (id: string) => { setCust(null); setSku(id); }, openCustomer: (id: string) => { setSku(null); setCust(id); } }), []);
  return (
    <Ctx.Provider value={v}>
      {children}
      <Drawer width={820} open={!!sku} onClose={() => setSku(null)} title="药品详情" destroyOnHidden>{sku && <SkuDetail id={sku} />}</Drawer>
      <Drawer width={820} open={!!cust} onClose={() => setCust(null)} title="客户详情" destroyOnHidden>{cust && <CustomerDetail id={cust} />}</Drawer>
    </Ctx.Provider>
  );
}

export function SkuLink({ id }: { id: string }) {
  const { openSku } = useDrill();
  const s = skuMap.get(id);
  return <Typography.Link onClick={e => { e.stopPropagation(); openSku(id); }}>{s ? `${s.trade_name} ${s.generic_name}` : id}</Typography.Link>;
}
export function CustomerLink({ id, raw }: { id: string | null; raw?: string }) {
  const { openCustomer } = useDrill();
  if (!id) return <span>{raw ?? '-'}</span>;
  const c = custMap.get(id);
  return <Typography.Link onClick={e => { e.stopPropagation(); openCustomer(id); }}>{c?.name ?? id}</Typography.Link>;
}

function SkuDetail({ id }: { id: string }) {
  const { scope, catalogue } = useStore();
  const nav = useNavigate();
  const s = skuMap.get(id)!;
  const bs = scopedBatches(scope).filter(b => b.sku_id === id);
  const fs = scopedFlows(scope).filter(f => f.sku_id === id);
  const trend = last12().map(m => ({ month: m, qty: fs.filter(f => (f.type === '销售' || f.type === '销售退货') && inPeriod(f.biz_date, monthPeriod(m))).reduce((a, f) => a + f.qty, 0) }));
  const cov = coverageDays(id, bs, fs, DEMO_DATE);
  const cats = catalogue.filter(c => c.sku_ids.includes(id));
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {!s.conversion && <Alert type="warning" showIcon message="该SKU缺少单位转换规则，数量不做单位换算，请主数据补充" />}
      <Descriptions size="small" bordered column={2} items={[
        { label: 'SKU', children: s.sku_id }, { label: '来源编码', children: s.source_code },
        { label: '通用名', children: s.generic_name }, { label: '商品名', children: s.trade_name },
        { label: '规格', children: s.spec }, { label: '剂型', children: s.dosage_form },
        { label: '厂家', children: s.manufacturer }, { label: '基础单位', children: s.unit },
        { label: '首拼', children: s.pinyin }, { label: '转换规则', children: s.conversion ? `1${s.unit} = ${s.conversion.factor}${s.conversion.minUnit}` : <Tag color="warning">缺失</Tag> },
        { label: '招商目录', children: cats.length ? cats.map(c => <Tag key={c.catalogue_id} onClick={() => nav(`/catalogue?id=${c.catalogue_id}`)} style={{ cursor: 'pointer' }}>{c.catalogue_id} <StatusTag value={c.status} /></Tag>) : '未纳入目录', span: 2 },
        { label: '库存覆盖天数', span: 2, children: cov.days === null ? '近30天净销量非正，暂不估算' : `${cov.days.toFixed(1)} 天（可用 ${cov.available}${s.unit} ÷ 日均 ${cov.daily.toFixed(1)}${s.unit}，演示口径）` },
      ]} />
      <Tabs items={[
        { key: 'b', label: `批次库存（${bs.length}）`, children: (
          <Table size="small" rowKey={b => b.warehouse_id + b.batch_no} pagination={false} dataSource={bs} columns={[
            { title: '批号', dataIndex: 'batch_no' }, { title: '仓库', render: (_, b) => whMap.get(b.warehouse_id)?.name },
            { title: '货权', render: (_, b) => ownerMap.get(b.owner_id)?.name }, { title: '有效期', render: (_, b) => b.expiry_date ?? '未知' },
            { title: '效期', render: (_, b) => <StatusTag value={expiryState(b.expiry_date, DEMO_DATE, 90)} /> },
            { title: '剩余天数', align: 'right', render: (_, b) => daysLeft(b.expiry_date, DEMO_DATE) ?? '—' },
            { title: '状态', render: (_, b) => <StatusTag value={b.status} /> },
            { title: `当前库存(${s.unit})`, dataIndex: 'qty', align: 'right' }, { title: `可用库存(${s.unit})`, align: 'right', render: (_, b) => availableQty(b, DEMO_DATE) },
            { title: '快照', dataIndex: 'snapshot_at' },
          ]} />) },
        { key: 't', label: '近12月净销量', children: <Column height={240} data={trend} xField="month" yField="qty" axis={{ y: { title: `净销量(${s.unit})` } }} /> },
      ]} />
      <Space><Typography.Link onClick={() => nav(`/flows/sales?sku=${id}`)}>查看销售流向明细 →</Typography.Link><Typography.Link onClick={() => nav(`/inventory?tab=batch&sku=${id}`)}>查看批号库存 →</Typography.Link></Space>
    </Space>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const { scope, promotions } = useStore();
  const nav = useNavigate();
  const c = custMap.get(id)!;
  if (!scope.regions.includes(c.region)) return <Empty description="没有权限查看该客户（演示权限限制）" />;
  const fs = scopedFlows(scope).filter(f => f.customer_id === id);
  const trend = last12().map(m => ({ month: m, amount: netSalesAmount(fs.filter(f => inPeriod(f.biz_date, monthPeriod(m)))) }));
  const p3 = { from: '2026-08-01', to: '2026-11-01' };
  const bySku = new Map<string, { amount: number; qty: number }>();
  fs.filter(f => inPeriod(f.biz_date, p3) && (f.type === '销售' || f.type === '销售退货')).forEach(f => {
    const r = bySku.get(f.sku_id) ?? { amount: 0, qty: 0 }; r.amount += f.amount; r.qty += f.qty; bySku.set(f.sku_id, r);
  });
  const rows = [...bySku.entries()].map(([sku_id, v]) => ({ sku_id, ...v })).sort((a, b) => b.amount - a.amount);
  const promos = promotions.filter(p => p.target_customer_ids.includes(id));
  const raws = [...new Set(fs.map(f => f.raw_customer_name))];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Descriptions size="small" bordered column={2} items={[
        { label: '客户编号', children: c.customer_id }, { label: '标准名称', children: c.name },
        { label: '地区', children: `${c.region} · ${c.city}` }, { label: '类型', children: c.type },
        { label: '组织归属', children: c.org }, { label: '别名映射', children: c.aliases.length ? c.aliases.map(a => <Tag key={a}>{a}</Tag>) : '无' },
        { label: '流向中出现的原始名称', span: 2, children: raws.map(r => <Tag key={r} color={r === c.name ? 'default' : 'gold'}>{r}</Tag>) },
      ]} />
      <Typography.Text strong>近12月净销售额</Typography.Text>
      <Line height={220} data={trend} xField="month" yField="amount" point={{ shapeField: 'circle', sizeField: 3 }} axis={{ y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(0)}万` } }} />
      <Typography.Text strong>近3个月合作品种（2026-08-01 至 2026-10-31）</Typography.Text>
      <Table size="small" rowKey="sku_id" pagination={false} dataSource={rows} columns={[
        { title: 'SKU', render: (_, r) => skuLabel(skuMap.get(r.sku_id)) },
        { title: '净销量', align: 'right', render: (_, r) => `${r.qty} ${skuMap.get(r.sku_id)!.unit}` },
        { title: '净销售额', align: 'right', render: (_, r) => fmtMoney(Math.round(r.amount * 100) / 100) },
      ]} />
      <Alert type="info" showIcon message="关联SKU的企业库存仅作参考，可在药品详情查看；该库存不属于客户，不跨客户累加。" />
      <Typography.Text strong>推广关联</Typography.Text>
      {promos.length ? promos.map(p => <div key={p.promotion_id}><Typography.Link onClick={() => nav(`/promotions?id=${p.promotion_id}`)}>{p.promotion_id} {p.name}</Typography.Link> <StatusTag value={p.status} /></div>) : <Typography.Text type="secondary">无</Typography.Text>}
      <Typography.Link onClick={() => nav(`/flows/sales?customer=${encodeURIComponent(c.name)}`)}>查看该客户销售流向 →</Typography.Link>
    </Space>
  );
}
