import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Form, Input, Radio, Row, Select, Space, Statistic, Tabs, Typography } from 'antd';
import { Column, Line } from '@ant-design/plots';
import { RobotOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { custMap, fmtMoney, fmtPct, makeMeta, matchSku, scopedFlows, skuLabelById, skuMap, type QueryMeta } from '../data/query';
import { compareBy, contribution, inPeriod, monthPeriod, netSalesAmount, periodLabel, type CompareRow } from '../metrics';
import { useStore } from '../data/store';
import { MetaBar, NotQueried, PageTitle, ResultTable } from '../components/common';
import { CustomerLink, SkuLink } from '../components/drill';
import { useAi, usePageAiContext } from '../ai/AiPanel';
import type { FlowRecord } from '../data/types';

type Dim = 'customer' | 'sku' | 'region' | 'ctype';
interface F { cur: Dayjs; base: Dayjs; dim: Dim; region?: string; ctype?: string; sku?: string; customer?: string }
const DIM_LABEL: Record<Dim, string> = { customer: '客户', sku: 'SKU', region: '地区', ctype: '客户类型' };

export default function SalesCompare() {
  const { scope } = useStore();
  const ai = useAi();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [applied, setApplied] = useState<F | null>(null);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const defaults: F = { cur: dayjs('2026-10-01'), base: dayjs('2026-09-01'), dim: 'customer' };

  const search = (v: F) => {
    setApplied(v);
    setMeta(makeMeta(scope, { 本期: periodLabel(monthPeriod(v.cur.format('YYYY-MM'))), 对比期: periodLabel(monthPeriod(v.base.format('YYYY-MM'))), 维度: DIM_LABEL[v.dim], 地区: v.region ?? '', 客户类型: v.ctype ?? '', 药品: v.sku ?? '', 客户: v.customer ?? '' }));
  };
  useEffect(() => {
    const v: F = { ...defaults };
    if (params.get('cur')) v.cur = dayjs(`${params.get('cur')}-01`);
    if (params.get('base')) v.base = dayjs(`${params.get('base')}-01`);
    if (params.get('dim')) v.dim = params.get('dim') as Dim;
    if (params.get('region')) v.region = params.get('region')!;
    form.setFieldsValue(v);
    search(v);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (applied) search(applied); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: 'P09 销售对比', filters: { ...(meta?.applied_filters ?? {}), region: applied?.region ?? '' } });

  const res = useMemo(() => {
    if (!applied) return null;
    const cur = monthPeriod(applied.cur.format('YYYY-MM'));
    const base = monthPeriod(applied.base.format('YYYY-MM'));
    const fs = scopedFlows(scope).filter(f => {
      if (!f.customer_id) return false;
      const c = custMap.get(f.customer_id)!;
      return (!applied.region || c.region === applied.region) && (!applied.ctype || c.type === applied.ctype)
        && matchSku(skuMap.get(f.sku_id)!, applied.sku ?? '') && (!applied.customer || c.name.includes(applied.customer) || c.aliases.some(a => a.includes(applied.customer!)));
    });
    const keyOf = (f: FlowRecord) => applied.dim === 'customer' ? f.customer_id! : applied.dim === 'sku' ? f.sku_id : applied.dim === 'region' ? custMap.get(f.customer_id!)!.region : custMap.get(f.customer_id!)!.type;
    const rows = compareBy(fs, cur, base, keyOf).sort((a, b) => a.delta - b.delta);
    const tc = netSalesAmount(fs.filter(f => inPeriod(f.biz_date, cur)));
    const tb = netSalesAmount(fs.filter(f => inPeriod(f.biz_date, base)));
    const months = Array.from({ length: 12 }, (_, i) => dayjs('2026-10-01').subtract(11 - i, 'month').format('YYYY-MM'));
    const trend = months.map(m => ({ month: m, amount: netSalesAmount(fs.filter(f => inPeriod(f.biz_date, monthPeriod(m)))) }));
    return { cur, base, rows, tc, tb, contrib: contribution(rows, 2), trend, incomplete: applied.cur.format('YYYY-MM') >= '2026-11' || applied.base.format('YYYY-MM') >= '2026-11' };
  }, [applied, scope]);

  const name = (k: string) => (applied?.dim === 'customer' ? custMap.get(k)?.name ?? k : applied?.dim === 'sku' ? skuLabelById(k) : k);
  const quick = (mode: 'mom' | 'yoy') => { const c: Dayjs = form.getFieldValue('cur'); form.setFieldValue('base', mode === 'mom' ? c.subtract(1, 'month') : c.subtract(1, 'year')); form.submit(); };

  return (
    <div>
      <PageTitle title="销售对比表" extra={<Button icon={<RobotOutlined />} onClick={() => ai.open('10月销售下降主要在哪')}>AI 解释变化</Button>} />
      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" initialValues={defaults} onFinish={search}>
          <Form.Item name="cur" label="本期"><DatePicker picker="month" allowClear={false} disabledDate={d => d.isAfter('2026-11-30')} /></Form.Item>
          <Form.Item name="base" label="对比期"><DatePicker picker="month" allowClear={false} /></Form.Item>
          <Form.Item><Space.Compact><Button onClick={() => quick('mom')}>环比</Button><Button onClick={() => quick('yoy')}>同比</Button></Space.Compact></Form.Item>
          <Form.Item name="dim" label="对比维度"><Radio.Group optionType="button" options={(Object.keys(DIM_LABEL) as Dim[]).map(k => ({ value: k, label: DIM_LABEL[k] }))} /></Form.Item>
          <Form.Item name="region" label="地区"><Select allowClear style={{ width: 100 }} options={scope.regions.map(r => ({ value: r }))} /></Form.Item>
          <Form.Item name="ctype" label="客户类型"><Select allowClear style={{ width: 110 }} options={['医院', '药店', '商业公司'].map(r => ({ value: r }))} /></Form.Item>
          <Form.Item name="customer" label="客户"><Input allowClear style={{ width: 140 }} /></Form.Item>
          <Form.Item name="sku" label="药品"><Input allowClear style={{ width: 140 }} placeholder="名称/首拼/编码" /></Form.Item>
          <Space><Button type="primary" htmlType="submit">搜索</Button><Button onClick={() => { form.resetFields(); search(defaults); }}>重置</Button></Space>
        </Form>
      </div>
      {!res ? <div className="panel"><NotQueried quick={[{ label: '2026年10月 vs 9月（按客户）', onClick: () => form.submit() }]} /></div> : (
        <>
          {res.incomplete && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="包含不完整月份：2026-11 数据截止 2026-11-03，且演示数据无11月流向，结果不可直接比较。" />}
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={6}><Card size="small"><Statistic title="本期净销售额" value={res.tc} precision={2} prefix="¥" /><span className="stat-note">{periodLabel(res.cur)}</span></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="对比期净销售额" value={res.tb} precision={2} prefix="¥" /><span className="stat-note">{periodLabel(res.base)}</span></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="差额" value={res.tc - res.tb} precision={2} prefix="¥" valueStyle={{ color: res.tc - res.tb < 0 ? '#cf1322' : '#389e0d' }} /><span className="stat-note">本期 − 对比期</span></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="变化率" value={fmtPct(res.tb > 0 ? (res.tc - res.tb) / res.tb : null)} /><span className="stat-note">对比期 &gt; 0 时计算</span></Card></Col>
          </Row>
          <div className="panel">
            <MetaBar meta={meta} />
            <Tabs items={[
              { key: 'table', label: '对比表', children: (
                <ResultTable<CompareRow> rowKey="key" data={res.rows} meta={meta} exportName="销售对比"
                  exportCols={[{ key: 'name', title: DIM_LABEL[applied!.dim] }, { key: 'base', title: '对比期' }, { key: 'cur', title: '本期' }, { key: 'delta', title: '差额' }, { key: 'rate', title: '变化率' }]}
                  exportRow={r => ({ ...r, name: name(r.key), rate: fmtPct(r.rate) })}
                  columns={[
                    { title: DIM_LABEL[applied!.dim], render: (_, r) => applied!.dim === 'customer' ? <CustomerLink id={r.key} /> : applied!.dim === 'sku' ? <SkuLink id={r.key} /> : r.key },
                    ...(applied!.dim === 'sku' ? [{ title: '净销量（对比期→本期）', align: 'right' as const, render: (_: any, r: CompareRow) => `${r.baseQty} → ${r.curQty} ${skuMap.get(r.key)!.unit}` }] : []),
                    { title: '对比期', align: 'right', sorter: (a, b) => a.base - b.base, render: (_, r) => fmtMoney(r.base) },
                    { title: '本期', align: 'right', sorter: (a, b) => a.cur - b.cur, render: (_, r) => fmtMoney(r.cur) },
                    { title: '差额', align: 'right', defaultSortOrder: 'ascend', sorter: (a, b) => a.delta - b.delta, render: (_, r) => <span className={r.delta < 0 ? 'text-down' : r.delta > 0 ? 'text-up' : ''}>{fmtMoney(r.delta)}</span> },
                    { title: '变化率', align: 'right', render: (_, r) => (r.rate === null ? <Typography.Text type="secondary">{r.base === 0 ? '基期为0' : '基期为负'}</Typography.Text> : fmtPct(r.rate)) },
                    { title: '占净变化', align: 'right', render: (_, r) => (res.contrib.total ? `${((r.delta / res.contrib.total) * 100).toFixed(1)}%` : '—') },
                    { title: '明细', render: (_, r) => applied!.dim === 'customer' ? <a onClick={() => nav(`/flows/sales?customer=${encodeURIComponent(custMap.get(r.key)!.name)}`)}>流向</a> : applied!.dim === 'sku' ? <a onClick={() => nav(`/flows/sales?sku=${r.key}`)}>流向</a> : '—' },
                  ]}
                  summary={<Space wrap size="large">
                    <b>全部查询结果合计（{res.rows.length}个{DIM_LABEL[applied!.dim]}）</b>
                    <span>对比期 {fmtMoney(res.tb)}</span><span>本期 {fmtMoney(res.tc)}</span><span>差额 {fmtMoney(res.contrib.total)}</span>
                    <span>前2贡献 {fmtMoney(res.contrib.topSum)}（{res.contrib.share === null ? '—' : (res.contrib.share * 100).toFixed(1) + '%'}）；反向抵消 {res.contrib.offsetsCount} 个，合计 {fmtMoney(res.contrib.offsetsSum)}</span>
                  </Space>} />) },
              { key: 'chart', label: '变化贡献', children: (
                <Column height={360} data={[...res.rows].sort((a, b) => a.delta - b.delta).slice(0, 15).map(r => ({ name: name(r.key).slice(0, 14), delta: r.delta }))} xField="name" yField="delta"
                  style={{ fill: (d: any) => (d.delta < 0 ? '#ff7875' : '#69b1ff') }} axis={{ x: { labelAutoRotate: true }, y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(1)}万` } }} />) },
              { key: 'trend', label: '近12月趋势', children: (
                <Line height={320} data={res.trend} xField="month" yField="amount" point={{ shapeField: 'circle', sizeField: 3 }} axis={{ y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(0)}万` } }} />) },
            ]} />
          </div>
        </>
      )}
    </div>
  );
}
