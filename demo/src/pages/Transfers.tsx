import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, Select, Space, Tabs, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { fmtMoney, makeMeta, matchSku, scopedFlows, skuMap, whMap, type QueryMeta } from '../data/query';
import { warehouses } from '../data/mock';
import type { FlowRecord } from '../data/types';
import { useStore } from '../data/store';
import { MetaBar, NotQueried, PageTitle, ResultTable } from '../components/common';
import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { SkuLink } from '../components/drill';
import { usePageAiContext } from '../ai/AiPanel';

interface F { range?: [Dayjs, Dayjs]; sku?: string; from?: string; to?: string; diff?: string }
interface CmpRow { doc_no: string; sku_id: string; from: string; to: string; out_date?: string; in_date?: string; out_qty: number; in_qty: number; diff: number; result: string }

export default function Transfers() {
  const { scope } = useStore();
  const [tab, setTab] = useState('query');
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F | null>(null);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const defaults: F = { range: [dayjs('2026-08-01'), dayjs('2026-10-31')] };
  useEffect(() => { search(applied ?? defaults); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P07 调拨流向', filters: meta?.applied_filters });

  const search = (v: F) => {
    setApplied(v);
    setMeta(makeMeta(scope, { 业务日期: v.range ? `${v.range[0].format('YYYY-MM-DD')} 至 ${v.range[1].format('YYYY-MM-DD')}` : '', 药品: v.sku ?? '', 调出仓: v.from ? whMap.get(v.from)!.name : '', 调入仓: v.to ? whMap.get(v.to)!.name : '', 对比结果: v.diff ?? '', 页签: tab === 'query' ? '查询' : '对比' }));
  };

  const base = useMemo(() => {
    if (!applied) return [];
    return scopedFlows(scope).filter(f => (f.type === '调拨出库' || f.type === '调拨入库') && matchSku(skuMap.get(f.sku_id)!, applied.sku ?? ''));
  }, [applied, scope]);

  const rows = useMemo(() => {
    if (!applied) return [];
    const from = applied.range?.[0].format('YYYY-MM-DD') ?? '0000'; const to = applied.range?.[1].format('YYYY-MM-DD') ?? '9999';
    return base.filter(f => f.biz_date >= from && f.biz_date <= to
      && (!applied.from || (f.type === '调拨出库' ? f.warehouse_id : f.counter_warehouse_id) === applied.from)
      && (!applied.to || (f.type === '调拨入库' ? f.warehouse_id : f.counter_warehouse_id) === applied.to));
  }, [base, applied]);

  /** 对比：按调拨单号关联出库与入库（跨期入库也纳入，按出库日期归属查询区间） */
  const cmp = useMemo<CmpRow[]>(() => {
    if (!applied) return [];
    const from = applied.range?.[0].format('YYYY-MM-DD') ?? '0000'; const to = applied.range?.[1].format('YYYY-MM-DD') ?? '9999';
    const m = new Map<string, CmpRow>();
    base.forEach(f => {
      const r = m.get(f.doc_no) ?? { doc_no: f.doc_no, sku_id: f.sku_id, from: '', to: '', out_qty: 0, in_qty: 0, diff: 0, result: '' };
      if (f.type === '调拨出库') { r.out_qty += -f.qty; r.out_date = f.biz_date; r.from = f.warehouse_id; r.to = f.counter_warehouse_id!; }
      else { r.in_qty += f.qty; r.in_date = f.biz_date; r.to = f.warehouse_id; r.from = r.from || f.counter_warehouse_id!; }
      m.set(f.doc_no, r);
    });
    return [...m.values()].filter(r => { const d = r.out_date ?? r.in_date!; return d >= from && d <= to; }).map(r => {
      const diff = r.out_qty - r.in_qty;
      const result = !r.in_date ? '单边：仅出库' : !r.out_date ? '单边：仅入库' : diff !== 0 ? '数量差异' : r.out_date.slice(0, 7) !== r.in_date.slice(0, 7) ? '跨期匹配' : '匹配';
      return { ...r, diff, result };
    }).filter(r => (!applied.diff || (applied.diff === '异常' ? r.result !== '匹配' : r.result === applied.diff)) && (!applied.from || r.from === applied.from) && (!applied.to || r.to === applied.to))
      .sort((a, b) => (a.result === '匹配' ? 1 : 0) - (b.result === '匹配' ? 1 : 0) || (b.out_date ?? '').localeCompare(a.out_date ?? ''));
  }, [base, applied]);

  const whOpts = warehouses.filter(w => scope.warehouses.includes(w.warehouse_id)).map(w => ({ value: w.warehouse_id, label: w.name }));
  const stat = { total: cmp.length, abnormal: cmp.filter(r => r.result !== '匹配').length };

  return (
    <div>
      <PageTitle title="调拨流向" />
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" initialValues={defaults} onFinish={search}>
          <Form.Item name="range" label="业务日期"><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="sku" label="药品"><Input allowClear placeholder="名称/首拼/编码" /></Form.Item>
          <Form.Item name="from" label="调出仓"><Select allowClear style={{ width: 120 }} options={whOpts} /></Form.Item>
          <Form.Item name="to" label="调入仓"><Select allowClear style={{ width: 120 }} options={whOpts} /></Form.Item>
          {tab === 'compare' && <Form.Item name="diff" label="对比结果"><Select allowClear style={{ width: 140 }} options={['异常', '匹配', '数量差异', '单边：仅出库', '单边：仅入库', '跨期匹配'].map(v => ({ value: v }))} /></Form.Item>}
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search(defaults); }}>重置</Button></Space>
        </Form>
      </div>
      <div className="panel">
        <Tabs activeKey={tab} onChange={k => { setTab(k); if (applied) setMeta(m => m && { ...m, applied_filters: { ...m.applied_filters, 页签: k === 'query' ? '查询' : '对比' } }); }} items={[
          { key: 'query', label: '调拨流向查询', children: (
            <>
              <MetaBar meta={meta} />
              {!applied ? <NotQueried quick={[{ label: '查询近3个月', onClick: () => form.submit() }]} /> : (
                <ResultTable<FlowRecord> rowKey="source_line_id" data={rows} meta={meta} exportName="调拨流向查询"
                  exportCols={[{ key: 'biz_date', title: '日期' }, { key: 'doc_no', title: '调拨单号' }, { key: 'type', title: '类型' }, { key: 'sku_id', title: 'SKU' }, { key: 'qty', title: '数量' }, { key: 'batch_no', title: '批号' }]}
                  columns={[
                    { title: '业务日期', dataIndex: 'biz_date' }, { title: '调拨单号', dataIndex: 'doc_no' },
                    { title: '类型', dataIndex: 'type', render: t => <Tag color={t === '调拨出库' ? 'orange' : 'blue'}>{t}</Tag> },
                    { title: '药品', render: (_, f) => <SkuLink id={f.sku_id} /> }, { title: '规格', render: (_, f) => skuMap.get(f.sku_id)!.spec },
                    { title: '本方仓库', render: (_, f) => whMap.get(f.warehouse_id)?.name }, { title: '对方仓库', render: (_, f) => whMap.get(f.counter_warehouse_id ?? '')?.name },
                    { title: '批号', dataIndex: 'batch_no' }, { title: '数量', align: 'right', render: (_, f) => `${f.qty} ${skuMap.get(f.sku_id)!.unit}` },
                    { title: '金额(成本参考)', align: 'right', render: (_, f) => fmtMoney(f.amount) }, { title: '来源', render: (_, f) => `${f.source_id}/${f.source_line_id}` },
                  ]}
                  summary={<span>全部查询结果 {rows.length} 条；内部调拨不计入对外销售，也不计入库存覆盖天数分母。</span>} />
              )}
            </>) },
          { key: 'compare', label: '调拨流向对比表', children: (
            <>
              <MetaBar meta={meta} />
              {!applied ? <NotQueried /> : (
                <>
                  {stat.abnormal > 0 && <Alert style={{ marginBottom: 8 }} type="warning" showIcon message={`对比 ${stat.total} 张调拨单，其中 ${stat.abnormal} 张存在差异（数量差异、单边或跨期），请核对。`} />}
                  <ResultTable<CmpRow> rowKey="doc_no" data={cmp} meta={meta} exportName="调拨流向对比"
                    exportCols={[{ key: 'doc_no', title: '调拨单号' }, { key: 'sku_id', title: 'SKU' }, { key: 'out_date', title: '出库日期' }, { key: 'in_date', title: '入库日期' }, { key: 'out_qty', title: '出库数量' }, { key: 'in_qty', title: '入库数量' }, { key: 'diff', title: '差异' }, { key: 'result', title: '结果' }]}
                    columns={[
                      { title: '调拨单号', dataIndex: 'doc_no' }, { title: '药品', render: (_, r) => <SkuLink id={r.sku_id} /> },
                      { title: '调出仓', render: (_, r) => whMap.get(r.from)?.name }, { title: '调入仓', render: (_, r) => whMap.get(r.to)?.name },
                      { title: '出库日期', dataIndex: 'out_date', render: d => d ?? '—' }, { title: '入库日期', dataIndex: 'in_date', render: d => d ?? '—' },
                      { title: '出库数量', align: 'right', render: (_, r) => `${r.out_qty} ${skuMap.get(r.sku_id)!.unit}` }, { title: '入库数量', align: 'right', render: (_, r) => `${r.in_qty} ${skuMap.get(r.sku_id)!.unit}` },
                      { title: '差异', align: 'right', render: (_, r) => <span className={r.diff ? 'text-down' : ''}>{r.diff}</span> },
                      { title: '对比结果', dataIndex: 'result', render: (r: string) => <Tag color={r === '匹配' ? 'success' : r === '跨期匹配' ? 'gold' : 'error'} icon={r === '匹配' ? <CheckCircleOutlined /> : <WarningOutlined />}>{r}</Tag> },
                    ]} />
                </>
              )}
            </>) },
        ]} />
      </div>
    </div>
  );
}
