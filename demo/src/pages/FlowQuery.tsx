import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { DownOutlined, UpOutlined, RobotOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { custMap, fmtMoney, makeMeta, matchCustomer, matchSku, scopedFlows, skuMap, whMap, type QueryMeta } from '../data/query';
import { duplicateConflicts, warehouses } from '../data/mock';
import type { FlowRecord, FlowType } from '../data/types';
import { useStore } from '../data/store';
import { MetaBar, NotQueried, PageTitle, ResultTable } from '../components/common';
import { CustomerLink, SkuLink } from '../components/drill';
import { usePageAiContext } from '../ai/AiPanel';
import { analyzeFlows, previousRange, type FlowAnalysis, type FlowKind, type FlowTopRow } from '../ai/flowAnalysis';
import { AiDiagPanel } from '../components/AiDiag';

type Kind = 'purchase' | 'sales' | 'warehouse';
const CFG: Record<Kind, { code: string; title: string; types: FlowType[]; desc: string; defaultRange: [string, string] }> = {
  purchase: { code: 'P05', title: '进货流向数据查询', types: ['进货'], desc: '通用流向查询模板 · 进货业务；退货与重复按来源ID处理', defaultRange: ['2026-10-01', '2026-10-31'] },
  sales: { code: 'P06', title: '销售流向数据查询', types: ['销售', '销售退货'], desc: '销售为正、退货为负；原始客户名称经映射到标准客户', defaultRange: ['2026-10-01', '2026-10-31'] },
  warehouse: { code: 'P08', title: '仓储流向数据查询', types: ['仓储入库', '仓储出库'], desc: '仅做记录浏览与来源追溯；同一业务事件可能在多个系统出现，不能直接相加', defaultRange: ['2026-09-01', '2026-10-31'] },
};

interface Filters { range?: [Dayjs, Dayjs]; customer?: string; sku?: string; batch?: string; region?: string; type?: string; warehouse?: string; mode?: string; importRange?: [Dayjs, Dayjs]; doc?: string }

export default function FlowQuery({ kind }: { kind: Kind }) {
  const cfg = CFG[kind];
  const { scope } = useStore();
  const [form] = Form.useForm<Filters>();
  const [params] = useSearchParams();
  const [adv, setAdv] = useState(false);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [eventOf, setEventOf] = useState<string | null>(null);
  const defaults: Filters = { range: [dayjs(cfg.defaultRange[0]), dayjs(cfg.defaultRange[1])] };

  const search = (v: Filters) => {
    setApplied(v);
    setMeta(makeMeta(scope, {
      业务日期: v.range ? `${v.range[0].format('YYYY-MM-DD')} 至 ${v.range[1].format('YYYY-MM-DD')}` : '',
      客户: v.customer ?? '', 药品: v.sku ?? '', 批号: v.batch ?? '', 地区: v.region ?? '', 业务类型: v.type ?? '',
      仓库: v.warehouse ? whMap.get(v.warehouse)!.name : '', 获取方式: v.mode ?? '', 单据号: v.doc ?? '',
      导入日期: v.importRange ? `${v.importRange[0].format('YYYY-MM-DD')} 至 ${v.importRange[1].format('YYYY-MM-DD')}` : '',
    }));
  };
  useEffect(() => {
    const init: Filters = { ...defaults };
    const sku = params.get('sku'); const customer = params.get('customer');
    if (sku) { init.sku = skuMap.get(sku)?.source_code ?? sku; init.range = [dayjs('2025-09-01'), dayjs('2026-10-31')]; }
    if (customer) { init.customer = customer; init.range = [dayjs('2025-09-01'), dayjs('2026-10-31')]; }
    form.setFieldsValue(init);
    search(init);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (applied) search(applied); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  usePageAiContext({ page: `${cfg.code} ${cfg.title}`, filters: meta?.applied_filters });

  const filterFlows = (v: Filters, range?: [string, string]) => {
    const from = range?.[0] ?? v.range?.[0].format('YYYY-MM-DD'); const to = range?.[1] ?? v.range?.[1].format('YYYY-MM-DD');
    const ifrom = v.importRange?.[0].format('YYYY-MM-DD'); const ito = v.importRange?.[1].format('YYYY-MM-DD');
    return scopedFlows(scope).filter(f => cfg.types.includes(f.type)
      && (!from || (f.biz_date >= from && f.biz_date <= to!))
      && (!ifrom || (f.import_date >= ifrom && f.import_date <= ito!))
      && matchCustomer(f.customer_id, f.raw_customer_name, v.customer ?? '')
      && matchSku(skuMap.get(f.sku_id)!, v.sku ?? '')
      && (!v.batch || f.batch_no.includes(v.batch))
      && (!v.region || (f.customer_id && custMap.get(f.customer_id)!.region === v.region))
      && (!v.type || f.type === v.type)
      && (!v.warehouse || f.warehouse_id === v.warehouse)
      && (!v.mode || f.acquire_mode === v.mode)
      && (!v.doc || f.doc_no.includes(v.doc)))
      .sort((a, b) => (a.biz_date < b.biz_date ? 1 : -1));
  };
  const data = useMemo(() => (applied ? filterFlows(applied) : []), [applied, scope, cfg.types]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mainTab, setMainTab] = useState<'list' | 'ai'>('list');
  const analysis = useMemo(() => {
    if (!applied || mainTab !== 'ai') return null;
    const range: [string, string] = applied.range ? [applied.range[0].format('YYYY-MM-DD'), applied.range[1].format('YYYY-MM-DD')] : [cfg.defaultRange[0], cfg.defaultRange[1]];
    return analyzeFlows(kind, data, filterFlows(applied, previousRange(range[0], range[1])), range, meta);
  }, [applied, data, meta, mainTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const byUnit = new Map<string, number>();
    data.forEach(f => { const u = skuMap.get(f.sku_id)!.unit; byUnit.set(u, (byUnit.get(u) ?? 0) + f.qty); });
    const sales = data.filter(f => f.amount > 0).reduce((a, f) => a + f.amount, 0);
    const ret = data.filter(f => f.amount < 0).reduce((a, f) => a - f.amount, 0);
    return { byUnit, sales, ret, net: sales - ret, skuCount: new Set(data.map(f => f.sku_id)).size };
  }, [data]);

  const columns = [
    { title: '业务日期', dataIndex: 'biz_date', fixed: 'left' as const, width: 100, sorter: (a: FlowRecord, b: FlowRecord) => a.biz_date.localeCompare(b.biz_date) },
    { title: '单据号', dataIndex: 'doc_no', width: 130 },
    { title: '业务类型', dataIndex: 'type', render: (t: string) => <Tag color={t.includes('退货') ? 'red' : t.includes('出库') ? 'orange' : 'blue'}>{t}</Tag> },
    ...(kind === 'warehouse' ? [] : [{ title: kind === 'purchase' ? '供应方（原始名称）' : '客户', render: (_: any, f: FlowRecord) => <CustomerLink id={f.customer_id} raw={f.raw_customer_name} /> }]),
    ...(kind === 'sales' ? [{ title: '原始客户名称', dataIndex: 'raw_customer_name', render: (r: string, f: FlowRecord) => <span>{r}{f.customer_id && custMap.get(f.customer_id)!.name !== r && <Tag color="gold" style={{ marginLeft: 4 }}>别名</Tag>}</span> }, { title: '地区', render: (_: any, f: FlowRecord) => (f.customer_id ? custMap.get(f.customer_id)!.region : '-') }] : []),
    { title: '药品', fixed: 'left' as const, render: (_: any, f: FlowRecord) => <SkuLink id={f.sku_id} /> },
    { title: '规格', render: (_: any, f: FlowRecord) => skuMap.get(f.sku_id)!.spec },
    { title: '厂家', render: (_: any, f: FlowRecord) => skuMap.get(f.sku_id)!.manufacturer },
    { title: '批号', dataIndex: 'batch_no' },
    { title: '有效期', dataIndex: 'expiry_date', render: (d: string | null) => d ?? <Tag>未知</Tag> },
    { title: '仓库', render: (_: any, f: FlowRecord) => whMap.get(f.warehouse_id)?.name },
    { title: '数量', align: 'right' as const, render: (_: any, f: FlowRecord) => `${f.qty} ${skuMap.get(f.sku_id)!.unit}` },
    ...(kind === 'warehouse' ? [] : [
      { title: '单价', align: 'right' as const, render: (_: any, f: FlowRecord) => fmtMoney(f.unit_price) },
      { title: '金额(未税)', align: 'right' as const, sorter: (a: FlowRecord, b: FlowRecord) => a.amount - b.amount, render: (_: any, f: FlowRecord) => <span className={f.amount < 0 ? 'text-down' : ''}>{fmtMoney(f.amount)}</span> },
    ]),
    { title: '数据获取方式', dataIndex: 'acquire_mode' },
    { title: '导入日期', dataIndex: 'import_date' },
    { title: '来源/明细ID', render: (_: any, f: FlowRecord) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{f.source_id}/{f.source_line_id}</Typography.Text> },
    { title: '业务事件', render: (_: any, f: FlowRecord) => <Typography.Link onClick={() => setEventOf(f.event_id)}>{f.event_id}</Typography.Link> },
  ];

  const exportCols = [
    { key: 'biz_date', title: '业务日期' }, { key: 'doc_no', title: '单据号' }, { key: 'type', title: '业务类型' }, { key: 'customer', title: '客户' },
    { key: 'raw_customer_name', title: '原始客户名称' }, { key: 'sku', title: '药品' }, { key: 'spec', title: '规格' }, { key: 'batch_no', title: '批号' },
    { key: 'expiry_date', title: '有效期' }, { key: 'qty', title: '数量' }, { key: 'unit', title: '单位' }, { key: 'unit_price', title: '单价' }, { key: 'amount', title: '金额' },
    { key: 'import_date', title: '导入日期' }, { key: 'source_line_id', title: '来源明细ID' },
  ];
  const eventRecords = eventOf ? scopedFlows(scope).filter(f => f.event_id === eventOf) : [];

  return (
    <div>
      <PageTitle title={cfg.title} extra={kind === 'sales' && (
        <Tooltip title={<>8月文件导入发现 {duplicateConflicts.length} 条重复记录（同来源+同来源明细ID），已按幂等规则去重，未计入统计。<br />{duplicateConflicts.map(d => `${d.source_id}/${d.source_line_id} ${d.doc_no}`).join('；')}</>}>
          <Tag bordered={false} color="warning" icon={<InfoCircleOutlined />} style={{ cursor: 'help' }}>已去重 {duplicateConflicts.length} 条重复导入</Tag>
        </Tooltip>
      )} />
      <div className="panel">
        <Form form={form} className="filter-form" onFinish={search} initialValues={defaults}>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="range" label="业务日期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item></Col>
            {kind !== 'warehouse' && <Col span={8}><Form.Item name="customer" label={kind === 'purchase' ? '供应方' : '客户'}><Input allowClear placeholder="名称/别名/原始名称" /></Form.Item></Col>}
            <Col span={8}><Form.Item name="sku" label="药品"><Input allowClear placeholder="名称/首拼/编码，如 AMXL" /></Form.Item></Col>
            {adv && <>
              <Col span={8}><Form.Item name="batch" label="批号"><Input allowClear /></Form.Item></Col>
              <Col span={8}><Form.Item name="doc" label="单据号"><Input allowClear /></Form.Item></Col>
              {kind === 'sales' && <Col span={8}><Form.Item name="region" label="客户地区"><Select allowClear options={scope.regions.map(r => ({ value: r }))} /></Form.Item></Col>}
              {cfg.types.length > 1 && <Col span={8}><Form.Item name="type" label="业务类型"><Select allowClear options={cfg.types.map(t => ({ value: t }))} /></Form.Item></Col>}
              <Col span={8}><Form.Item name="warehouse" label="仓库"><Select allowClear options={warehouses.filter(w => scope.warehouses.includes(w.warehouse_id)).map(w => ({ value: w.warehouse_id, label: w.name }))} /></Form.Item></Col>
              <Col span={8}><Form.Item name="mode" label="获取方式"><Select allowClear options={['接口', '文件导入', '手工'].map(v => ({ value: v }))} /></Form.Item></Col>
              <Col span={8}><Form.Item name="importRange" label="导入日期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item></Col>
            </>}
          </Row>
          <Space>
            <Button type="primary" htmlType="submit">搜索</Button>
            <Button onClick={() => { form.resetFields(); form.setFieldsValue(defaults); search(defaults); }}>重置</Button>
            <Button type="link" onClick={() => setAdv(!adv)}>{adv ? <>收起 <UpOutlined /></> : <>高级筛选 <DownOutlined /></>}</Button>
          </Space>
        </Form>
      </div>
      <Tabs className="page-main-tabs" activeKey={mainTab} onChange={k => setMainTab(k as any)} items={[
        { key: 'list', label: <span className="seg-label">查询结果<b>{data.length}</b></span>, children: <>
      <div className="panel">
        <MetaBar meta={meta} />
        {!applied ? <NotQueried quick={[{ label: '查询 2026年10月', onClick: () => form.submit() }]} /> : (
          <ResultTable<FlowRecord>
            rowKey="source_line_id" columns={columns as any} data={data} meta={meta} exportName={cfg.title} exportCols={exportCols}
            noPermissionHint={scope.role !== '经营负责人'}
            exportRow={f => ({ ...f, customer: f.customer_id ? custMap.get(f.customer_id)!.name : '', sku: `${skuMap.get(f.sku_id)!.trade_name} ${skuMap.get(f.sku_id)!.generic_name}`, spec: skuMap.get(f.sku_id)!.spec, unit: skuMap.get(f.sku_id)!.unit })}
            summary={<Space wrap size="large">
              <Typography.Text strong>全部查询结果合计（{data.length}条）</Typography.Text>
              {kind !== 'warehouse' && <span>{kind === 'sales' ? '销售金额' : '进货金额'} {fmtMoney(totals.sales)}</span>}
              {kind === 'sales' && <><span>退货金额 {fmtMoney(totals.ret)}</span><span>净销售额 <b>{fmtMoney(totals.net)}</b></span></>}
              <span>数量按单位分组：{[...totals.byUnit.entries()].map(([u, q]) => `${q.toLocaleString()} ${u}`).join('；')}（涉及 {totals.skuCount} 个SKU，不跨单位合计）</span>
            </Space>}
          />
        )}
      </div>
        </> },
        { key: 'ai', label: <span><RobotOutlined /> AI 分析当前结果</span>, children: analysis && <FlowAnalysisView a={analysis} kind={kind} ask={kind === 'sales' ? '10月销售下降主要在哪' : undefined} /> },
      ]} />
      <Modal open={!!eventOf} onCancel={() => setEventOf(null)} footer={null} width={900} title={`业务事件 ${eventOf} 的各系统视图`}>
        <Alert type="info" showIcon style={{ marginBottom: 8 }} message="同一笔业务事件可能在ERP、WMS等多个来源出现。它们是同一事件的不同视图，不能把各来源数量直接相加。" />
        <Table size="small" rowKey="source_line_id" pagination={false} dataSource={eventRecords} columns={[
          { title: '来源', dataIndex: 'source_id' }, { title: '来源明细ID', dataIndex: 'source_line_id' }, { title: '类型', dataIndex: 'type' }, { title: '日期', dataIndex: 'biz_date' },
          { title: '药品', render: (_, f) => skuMap.get(f.sku_id)!.trade_name }, { title: '数量', render: (_, f) => `${f.qty} ${skuMap.get(f.sku_id)!.unit}` }, { title: '金额', render: (_, f) => fmtMoney(f.amount) },
        ]} />
      </Modal>
    </div>
  );
}

function FlowAnalysisView({ a, kind, ask }: { a: FlowAnalysis; kind: FlowKind; ask?: string }) {
  const money = kind !== 'warehouse';
  const val = (r: FlowTopRow) => (money ? fmtMoney(r.cur) : `${r.cur.toLocaleString()} ${r.unit ?? ''}`);
  const chg = (r: FlowTopRow) => (r.rate === null ? <span className="diag-row-side">{r.base === 0 ? '对比期无' : '—'}</span> : <span className={r.rate < 0 ? 'text-down' : 'text-up'}>{r.rate > 0 ? '+' : ''}{(r.rate * 100).toFixed(1)}%</span>);
  const list = (title: string, rows: FlowTopRow[], render: (r: FlowTopRow) => React.ReactNode) => (
    <div>
      <div className="diag-sub">{title}</div>
      <div className="diag-list">
        {rows.map((r, i) => (
          <div key={r.key} className="diag-row" style={{ cursor: 'default' }}>
            <span className={`rep-rank r${i + 1}`} style={{ minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
            <span className="diag-row-main">{render(r)}</span>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{val(r)}</b>
            <span style={{ width: 70, textAlign: 'right', fontSize: 12 }}>{chg(r)}</span>
          </div>
        ))}
        {!rows.length && <span className="diag-row-side">无数据</span>}
      </div>
    </div>
  );
  return (
    <AiDiagPanel flat id={`flow-${kind}`} title="AI 分析当前结果" ask={ask} analysis={a.answer}
      summary={<>基于当前筛选条件的查询结果，与对比期 {a.prev[0]} 至 {a.prev[1]}（同条件）比较</>}
      kpis={a.kpis.map(k => ({ label: k.label, value: k.value, tone: k.tone }))}>
      <div className="diag-cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        {list(money ? '药品构成（金额 Top5）' : '药品构成（数量 Top5，按各自单位）', a.bySku, r => <SkuLink id={r.skuId!} />)}
        {list(`${a.partyTitle}构成（${money ? '金额' : '记录数'} Top5）`, a.byParty, r => (kind === 'sales' && r.customerId ? <CustomerLink id={r.customerId} raw={r.label} /> : r.label))}
      </div>
    </AiDiagPanel>
  );
}
