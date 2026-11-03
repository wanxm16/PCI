import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Form, Input, Radio, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { custMap, fmtMoney, makeMeta, matchSku, scopedFlows, skuMap, type QueryMeta } from '../data/query';
import { useStore } from '../data/store';
import { MetaBar, NotQueried, PageTitle, ResultTable } from '../components/common';
import { CustomerLink, SkuLink } from '../components/drill';
import { usePageAiContext } from '../ai/AiPanel';

interface F { range: [Dayjs, Dayjs]; biz?: string; region?: string; ctype?: string; customer?: string; sku?: string; grain: 'cs' | 'c' }
interface Row { key: string; customer_id: string; sku_id?: string; sale_qty: number; ret_qty: number; sale_amt: number; ret_amt: number; net_amt: number; skus: number; unit?: string }
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function CustomerSummary() {
  const { scope } = useStore();
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F | null>(null);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const defaults: F = { range: [dayjs('2026-08-01'), dayjs('2026-10-31')], grain: 'cs' };
  const search = (v: F) => {
    setApplied(v);
    setMeta(makeMeta(scope, { 业务日期: `${v.range[0].format('YYYY-MM-DD')} 至 ${v.range[1].format('YYYY-MM-DD')}`, 业务类型: v.biz ?? '销售+退货', 客户地区: v.region ?? '', 客户类型: v.ctype ?? '', 客户: v.customer ?? '', 药品: v.sku ?? '', 粒度: v.grain === 'cs' ? '客户×药品' : '客户' }));
  };
  useEffect(() => { search(applied ?? defaults); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P04 客户汇总', filters: meta?.applied_filters });

  const rows = useMemo<Row[]>(() => {
    if (!applied) return [];
    const from = applied.range[0].format('YYYY-MM-DD'); const to = applied.range[1].format('YYYY-MM-DD');
    const m = new Map<string, Row & { skuSet: Set<string> }>();
    scopedFlows(scope).forEach(f => {
      if (!f.customer_id || !(f.type === '销售' || f.type === '销售退货')) return;
      if (applied.biz && f.type !== applied.biz) return;
      if (f.biz_date < from || f.biz_date > to) return;
      const c = custMap.get(f.customer_id)!;
      if (applied.region && c.region !== applied.region) return;
      if (applied.ctype && c.type !== applied.ctype) return;
      if (applied.customer && !c.name.includes(applied.customer) && !c.aliases.some(a => a.includes(applied.customer!))) return;
      if (!matchSku(skuMap.get(f.sku_id)!, applied.sku ?? '')) return;
      const key = applied.grain === 'cs' ? `${f.customer_id}|${f.sku_id}` : f.customer_id;
      const r = m.get(key) ?? { key, customer_id: f.customer_id, sku_id: applied.grain === 'cs' ? f.sku_id : undefined, sale_qty: 0, ret_qty: 0, sale_amt: 0, ret_amt: 0, net_amt: 0, skus: 0, skuSet: new Set<string>(), unit: skuMap.get(f.sku_id)!.unit };
      if (f.type === '销售') { r.sale_qty += f.qty; r.sale_amt += f.amount; } else { r.ret_qty += -f.qty; r.ret_amt += -f.amount; }
      r.net_amt += f.amount; r.skuSet.add(f.sku_id);
      m.set(key, r);
    });
    return [...m.values()].map(({ skuSet, ...r }) => ({ ...r, skus: skuSet.size, sale_amt: r2(r.sale_amt), ret_amt: r2(r.ret_amt), net_amt: r2(r.net_amt) })).sort((a, b) => b.net_amt - a.net_amt);
  }, [applied, scope]);

  const totals = useMemo(() => {
    const byUnit = new Map<string, number>();
    rows.forEach(r => { if (r.sku_id) byUnit.set(r.unit!, (byUnit.get(r.unit!) ?? 0) + r.sale_qty - r.ret_qty); });
    return { sale: r2(rows.reduce((a, r) => a + r.sale_amt, 0)), ret: r2(rows.reduce((a, r) => a + r.ret_amt, 0)), net: r2(rows.reduce((a, r) => a + r.net_amt, 0)), customers: new Set(rows.map(r => r.customer_id)).size, byUnit };
  }, [rows]);

  const cs = applied?.grain === 'cs';
  return (
    <div>
      <PageTitle title="客户汇总" />
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" initialValues={defaults} onFinish={search}>
          <Form.Item name="biz" label="业务类型"><Select allowClear placeholder="销售+退货" style={{ width: 120 }} options={[{ value: '销售' }, { value: '销售退货' }]} /></Form.Item>
          <Form.Item name="range" label="业务日期"><DatePicker.RangePicker allowClear={false} /></Form.Item>
          <Form.Item name="region" label="客户地区"><Select allowClear style={{ width: 100 }} options={scope.regions.map(r => ({ value: r }))} /></Form.Item>
          <Form.Item name="ctype" label="客户类型"><Select allowClear style={{ width: 110 }} options={['医院', '药店', '商业公司'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="customer" label="客户"><Input allowClear style={{ width: 150 }} placeholder="名称/别名" /></Form.Item>
          <Form.Item name="sku" label="药品"><Input allowClear style={{ width: 150 }} placeholder="名称/首拼/编码" /></Form.Item>
          <Form.Item name="grain" label="汇总粒度"><Radio.Group optionType="button" options={[{ value: 'cs', label: '客户×药品' }, { value: 'c', label: '客户' }]} /></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search(defaults); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <MetaBar meta={meta} />
        {!applied ? <NotQueried quick={[{ label: '近3个月 客户×药品', onClick: () => form.submit() }]} /> : (
          <ResultTable<Row> rowKey="key" data={rows} meta={meta} exportName="客户汇总"
            exportCols={[{ key: 'customer', title: '客户' }, { key: 'sku', title: '药品' }, { key: 'sale_qty', title: '销售数量' }, { key: 'ret_qty', title: '退货数量' }, { key: 'unit', title: '单位' }, { key: 'sale_amt', title: '销售金额' }, { key: 'ret_amt', title: '退货金额' }, { key: 'net_amt', title: '净销售额' }]}
            exportRow={r => ({ ...r, customer: custMap.get(r.customer_id)!.name, sku: r.sku_id ? `${skuMap.get(r.sku_id)!.trade_name} ${skuMap.get(r.sku_id)!.spec}` : `${r.skus}个SKU`, unit: cs ? r.unit : '' })}
            columns={[
              { title: '客户', fixed: 'left', render: (_, r) => <CustomerLink id={r.customer_id} /> },
              { title: '地区', render: (_, r) => custMap.get(r.customer_id)!.region },
              { title: '类型', render: (_, r) => custMap.get(r.customer_id)!.type },
              ...(cs ? [
                { title: '药品', render: (_: any, r: Row) => <SkuLink id={r.sku_id!} /> },
                { title: '规格', render: (_: any, r: Row) => skuMap.get(r.sku_id!)!.spec },
                { title: '厂家', render: (_: any, r: Row) => skuMap.get(r.sku_id!)!.manufacturer },
                { title: '销售数量', align: 'right' as const, render: (_: any, r: Row) => `${r.sale_qty} ${r.unit}` },
                { title: '退货数量', align: 'right' as const, render: (_: any, r: Row) => `${r.ret_qty} ${r.unit}` },
                { title: '净数量', align: 'right' as const, render: (_: any, r: Row) => `${r.sale_qty - r.ret_qty} ${r.unit}` },
              ] : [{ title: '品种数', align: 'right' as const, dataIndex: 'skus' }]),
              { title: '销售金额', align: 'right', render: (_, r) => fmtMoney(r.sale_amt) },
              { title: '退货金额', align: 'right', render: (_, r) => fmtMoney(r.ret_amt) },
              { title: '净销售额', align: 'right', sorter: (a, b) => a.net_amt - b.net_amt, render: (_, r) => <b className={r.net_amt < 0 ? 'text-down' : ''}>{fmtMoney(r.net_amt)}</b> },
            ]}
            summary={<Space wrap size="large">
              <Typography.Text strong>全部查询结果合计（{rows.length}行 · {totals.customers}个客户）</Typography.Text>
              <span>销售金额 {fmtMoney(totals.sale)}</span><span>退货金额 {fmtMoney(totals.ret)}</span><span>净销售额 <b>{fmtMoney(totals.net)}</b></span>
              {cs && <span>净数量按单位：{[...totals.byUnit.entries()].map(([u, q]) => `${q.toLocaleString()} ${u}`).join('；')}（不跨单位合计）</span>}
              {!cs && <Typography.Text type="secondary">客户粒度下不展示数量（不同SKU单位不可相加）</Typography.Text>}
            </Space>} />
        )}
      </div>
    </div>
  );
}
