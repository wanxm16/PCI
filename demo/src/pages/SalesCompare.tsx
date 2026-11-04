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
import { usePageAiContext } from '../ai/AiPanel';
import { AiDiagPanel } from '../components/AiDiag';
import type { AiAnswer, TaskDraft } from '../ai/engine';
import { customerOwner } from '../data/targets';
import { DEMO_DATE } from '../data/mock';
import type { FlowRecord } from '../data/types';

type Dim = 'customer' | 'sku' | 'region' | 'ctype';
interface F { cur: Dayjs; base: Dayjs; dim: Dim; region?: string; ctype?: string; sku?: string; customer?: string }
const DIM_LABEL: Record<Dim, string> = { customer: '客户', sku: 'SKU', region: '地区', ctype: '客户类型' };

export default function SalesCompare() {
  const { scope } = useStore();
  const [tab, setTab] = useState<string>('table');
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
      <PageTitle title="销售对比表" />
      {res && <>
      {res.incomplete && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="包含不完整月份：2026-11 数据截止 2026-11-03，且演示数据无11月流向，结果不可直接比较。" />}
      <Row gutter={10} style={{ marginBottom: 10 }}>
        <Col span={6}><Card size="small"><Statistic title="本期净销售额" value={res.tc} precision={2} prefix="¥" /><span className="stat-note">{periodLabel(res.cur)}</span></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="对比期净销售额" value={res.tb} precision={2} prefix="¥" /><span className="stat-note">{periodLabel(res.base)}</span></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="差额" value={res.tc - res.tb} precision={2} prefix="¥" valueStyle={{ color: res.tc - res.tb < 0 ? '#cf1322' : '#389e0d' }} /><span className="stat-note">本期 − 对比期</span></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="变化率" value={fmtPct(res.tb > 0 ? (res.tc - res.tb) / res.tb : null)} /><span className="stat-note">对比期 &gt; 0 时计算</span></Card></Col>
      </Row>
      </>}
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
          <div className="panel">
            <MetaBar meta={meta} />
            <Tabs className="page-main-tabs" activeKey={tab} onChange={setTab} items={[
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
              { key: 'ai', label: <span><RobotOutlined /> AI 解释变化</span>, children: tab === 'ai' && <ExplainView res={res} dim={applied!.dim} name={name} meta={meta} filters={applied!} /> },
            ]} />
          </div>
        </>
      )}
    </div>
  );
}

type Res = { cur: { from: string; to: string }; base: { from: string; to: string }; rows: CompareRow[]; tc: number; tb: number; contrib: ReturnType<typeof contribution>; incomplete: boolean };

/** AI 解释变化：基于当前对比结果（同一查询条件与口径）做贡献归因 */
function ExplainView({ res, dim, name, meta, filters }: { res: Res; dim: Dim; name: (k: string) => string; meta: QueryMeta | null; filters: F }) {
  const { contrib: c, rows } = res;
  const delta = res.tc - res.tb;
  const rate = res.tb > 0 ? delta / res.tb : null;
  const down = rows.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta);
  const up = rows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta);
  const lost = rows.filter(r => r.base > 0 && r.cur <= 0);
  const fresh = rows.filter(r => r.base <= 0 && r.cur > 0);
  const label = DIM_LABEL[dim];
  const dir = delta < 0 ? '下降' : delta > 0 ? '增长' : '持平';
  const share = c.share === null ? '—' : `${(c.share * 100).toFixed(1)}%`;
  const link = (k: string) => (dim === 'customer' ? <CustomerLink id={k} /> : dim === 'sku' ? <SkuLink id={k} /> : k);

  const observed = [
    `净销售额 ${fmtMoney(res.tb)} → ${fmtMoney(res.tc)}，变化 ${fmtMoney(delta)}（${fmtPct(rate)}）。`,
    ...c.top.map(r => `${name(r.key)}：${fmtMoney(r.base)} → ${fmtMoney(r.cur)}，差额 ${fmtMoney(r.delta)}${c.total ? `，占净变化 ${((r.delta / c.total) * 100).toFixed(1)}%` : ''}`),
    `前2个${label}合计 ${fmtMoney(c.topSum)}，占净变化 ${share}；其他合计 ${fmtMoney(c.rest)}。`,
    c.offsetsCount ? `${c.offsetsCount} 个${label}反向变化，抵消 ${fmtMoney(c.offsetsSum)}。` : '无反向抵消项。',
    ...(lost.length ? [`${lost.length} 个${label}本期净销售 ≤0（对比期有销售）：${lost.slice(0, 3).map(r => name(r.key)).join('、')}${lost.length > 3 ? ' 等' : ''}。`] : []),
    ...(fresh.length ? [`${fresh.length} 个${label}对比期无销售或为负，不计算变化率。`] : []),
  ];
  const toVerify = [
    dim === 'customer' ? '客户采购计划调整、库存充足暂缓进货、竞品替代等原因需拜访客户核实。' : '原因（采购节奏、政策、竞品、渠道调整等）需结合业务跟进记录核实，当前数据不能证明。',
    ...(lost.length ? ['本期净销售 ≤0 的对象需确认是否为退货冲减或停止合作。'] : []),
    ...(res.incomplete ? ['包含不完整月份，变化可能由数据未到齐导致。'] : []),
  ];
  const drafts: TaskDraft[] = dim === 'customer' ? c.top.filter(r => r.delta < 0).map(r => {
    const cu = custMap.get(r.key);
    return { title: `核实 ${name(r.key)} 销售下降原因`, object_type: '客户', object_ids: [r.key], suggestion: '联系客户了解采购变化，核对退货与订单', assignee: cu ? customerOwner(cu) : '陈晓', due_at: dayjs(DEMO_DATE).add(7, 'day').format('YYYY-MM-DD'), evidence_desc: `${meta?.query_id ?? ''}：${periodLabel(res.cur)} vs ${periodLabel(res.base)} 差额 ${fmtMoney(r.delta)}` };
  }) : [];
  const filt = [filters.region && `地区=${filters.region}`, filters.ctype && `客户类型=${filters.ctype}`, filters.customer && `客户含"${filters.customer}"`, filters.sku && `药品="${filters.sku}"`].filter(Boolean).join('，') || '无';
  const answer: AiAnswer = {
    text: delta === 0 ? `本期与对比期净销售额持平（${fmtMoney(res.tc)}）。` : `净销售额${dir} ${fmtMoney(Math.abs(delta))}（${fmtPct(rate)}），${c.top.length ? `主要来自 ${c.top.map(r => `${name(r.key)}（${fmtMoney(r.delta)}）`).join('、')}，前2个${label}占净变化 ${share}。` : ''}`,
    observed, toVerify, meta: meta ?? undefined,
    caliber: ['指标：净销售额 = 销售金额（正）+ 退货金额（负），未税，演示口径 demo_v1', `本期：${periodLabel(res.cur)}；对比期：${periodLabel(res.base)}；按${label}分组`, `过滤：${filt}`, '贡献：前2个对象按差额绝对值排序，与对比表合计行一致', '变化率：对比期>0时计算；基期为0或负值单独标注'],
    taskDrafts: drafts,
  };
  const ask = `${res.cur.from.slice(0, 4)}年${Number(res.cur.from.slice(5, 7))}月销售${delta < 0 ? '下降' : '变化'}主要在哪`;
  const list = (title: string, rs: CompareRow[]) => (
    <div>
      <div className="diag-sub">{title}</div>
      <div className="diag-list">
        {rs.slice(0, 5).map((r, i) => (
          <div key={r.key} className="diag-row" style={{ cursor: 'default' }}>
            <span className={`rep-rank r${i + 1}`} style={{ minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
            <span className="diag-row-main">{link(r.key)}<span className="diag-row-side"> {fmtMoney(r.base)} → {fmtMoney(r.cur)}</span></span>
            <b className={r.delta < 0 ? 'text-down' : 'text-up'} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.delta)}</b>
            <span style={{ width: 70, textAlign: 'right', fontSize: 12 }}>{r.rate === null ? <span className="diag-row-side">{r.base === 0 ? '基期为0' : '基期为负'}</span> : fmtPct(r.rate)}</span>
          </div>
        ))}
        {!rs.length && <span className="diag-row-side">无</span>}
      </div>
    </div>
  );
  return (
    <AiDiagPanel flat id="sales-compare" title="AI 解释变化" ask={ask} analysis={answer} observed={observed.slice(1)} drafts={drafts}
      summary={<>基于当前对比结果：{periodLabel(res.cur)} vs {periodLabel(res.base)}，按{label}归因</>}
      kpis={[
        { label: '净变化', value: fmtMoney(delta), tone: delta < 0 ? 'down' : 'up' },
        { label: '变化率', value: fmtPct(rate), tone: delta < 0 ? 'down' : 'up' },
        { label: `前2${label}占比`, value: share, tone: 'warn' },
        { label: `下降/增长${label}`, value: `${down.length} / ${up.length}` },
      ]}>
      <div className="diag-cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        {list(`下降最多的${label}（Top5）`, down)}
        {list(`增长最多的${label}（Top5）`, up)}
      </div>
    </AiDiagPanel>
  );
}
