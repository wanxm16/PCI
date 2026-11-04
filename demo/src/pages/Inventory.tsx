import { useEffect, useMemo, useState } from 'react';
import { Button, Col, Form, Input, Row, Segmented, Select, Space, Tag, Tooltip, Typography, Tabs } from 'antd';
import { RobotOutlined, FieldTimeOutlined, StopOutlined, QuestionOutlined, DatabaseOutlined, DownOutlined, UpOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { DEMO_DATE, flows, warehouses, owners } from '../data/mock';
import { makeMeta, matchSku, ownerMap, scopedBatches, scopedFlows, skuMap, whMap, type QueryMeta } from '../data/query';
import { availableQty, coverageDays, daysLeft, expiringBatchCount, expiryState, isSalesFlow } from '../metrics';
import type { BatchStock } from '../data/types';
import { useStore } from '../data/store';
import { Definition, MetaBar, ResultTable, StatusTag } from '../components/common';
import { Kpi } from '../components/Kpi';
import { SkuLink, useDrill } from '../components/drill';
import { AiDiagPanel } from '../components/AiDiag';
import { clearancePlan, runClearance } from '../ai/tier2';
import { useAi, usePageAiContext } from '../ai/AiPanel';

interface F { sku?: string; mfr?: string; batch?: string; window: number; expState?: string; warehouse?: string; status?: string; owner?: string }
interface SkuRow { key: string; sku_id: string; snapshot_at: string; qty: number; eff: number | null; effMissing: boolean; avail: number; reserved: number; batchRecords: number; expiring: number; coverage: number | null; noSales: boolean }
type BatchRow = BatchStock & { key: string };

const DEF = {
  cur: '当前库存：指定快照及范围下的库存记录数量（含冻结、待验、临期；未扣减占用）',
  eff: '有效库存：保留原系统名称与字段原值，定义待客户确认；不推定为可用库存或未过期库存',
  avail: '可用库存（演示口径）：合格且未过期批次的 当前库存 − 已占用；与"有效库存"不互相替换',
  cov: '库存覆盖天数：同SKU可用库存 ÷ 近30天日均对外净销量（内部调拨不计）；分母≤0不估算',
};
const snapShort = (s: string) => s.slice(5).replace('-', '/');
const NO_SALES_FROM = '2026-08-05';

function DrugCell({ id }: { id: string }) {
  const s = skuMap.get(id)!;
  return <div className="cell-2l"><SkuLink id={id} /><span>{s.spec} · {s.manufacturer}</span></div>;
}
function Qty({ v, unit, strong }: { v: number | null; unit: string; strong?: boolean }) {
  if (v === null) return <Tag bordered={false} style={{ marginInlineEnd: 0 }}>缺失</Tag>;
  return <span className={`qty ${strong ? 'strong' : ''}`}>{v.toLocaleString()}<small>{unit}</small></span>;
}
function Coverage({ days }: { days: number | null }) {
  if (days === null) return <Tooltip title="近30天净销量非正，暂不估算"><Typography.Text type="secondary">不估算</Typography.Text></Tooltip>;
  const color = days < 30 ? '#cf1322' : days < 90 ? '#d48806' : '#389e0d';
  return (
    <div className="cov">
      <span style={{ color }}>{days >= 999 ? '999+' : days.toFixed(0)}<small>天</small></span>
      <div className="cov-bar"><i style={{ width: `${Math.min(100, (days / 180) * 100)}%`, background: color }} /></div>
    </div>
  );
}
function ExpiryCell({ b, window }: { b: BatchStock; window: number }) {
  const d = daysLeft(b.expiry_date, DEMO_DATE);
  const st = expiryState(b.expiry_date, DEMO_DATE, window);
  const color = st === '已过期' ? '#cf1322' : st === '临期' ? '#d48806' : '#8c8c8c';
  return (
    <div className="cell-2l">
      <span style={{ color: '#262626' }}>{b.expiry_date ?? '未知效期'}</span>
      <span style={{ color }}>{d === null ? '—' : d < 0 ? `已过期 ${-d} 天` : `剩 ${d} 天`}</span>
    </div>
  );
}

export default function Inventory() {
  const { scope } = useStore();
  const ai = useAi();
  const [params] = useSearchParams();
  const [form] = Form.useForm<F>();
  const [tab, setTab] = useState<'sku' | 'batch'>((params.get('tab') as 'batch') ?? 'sku');
  const [adv, setAdv] = useState(false);
  const [applied, setApplied] = useState<F>({ window: 90 });
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const search = (v: F) => {
    setApplied(v);
    setMeta(makeMeta(scope, { 药品: v.sku ?? '', 厂家: v.mfr ?? '', 批号: v.batch ?? '', 临期窗口: `${v.window}天`, 效期状态: v.expState ?? '', 仓库: v.warehouse ? whMap.get(v.warehouse)!.name : '', 库存状态: v.status ?? '', 货权: v.owner ? ownerMap.get(v.owner)!.name : '' }, '杭州/宁波 2026-11-03 08:00；上海 2026-11-02 22:00'));
  };
  useEffect(() => {
    const v: F = { window: Number(params.get('window') ?? 90) };
    if (params.get('sku')) v.sku = skuMap.get(params.get('sku')!)?.source_code;
    if (params.get('window')) v.expState = '临期';
    if (params.get('tab')) setTab(params.get('tab') as 'sku' | 'batch');
    form.setFieldsValue(v); search(v);
  }, [params, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageAiContext({ page: '库存管理', filters: meta?.applied_filters });

  const allScoped = useMemo(() => scopedBatches(scope), [scope]);
  const sf = useMemo(() => scopedFlows(scope), [scope]);
  const lastSale = useMemo(() => { const m = new Map<string, string>(); flows.filter(isSalesFlow).forEach(f => { if ((m.get(f.sku_id) ?? '') < f.biz_date) m.set(f.sku_id, f.biz_date); }); return m; }, []);
  const noSalesSkus = useMemo(() => new Set([...new Set(allScoped.map(b => b.sku_id))].filter(id => (lastSale.get(id) ?? '') < NO_SALES_FROM)), [allScoped, lastSale]);

  const bs = useMemo<BatchRow[]>(() => allScoped.filter(b => {
    const s = skuMap.get(b.sku_id)!;
    return matchSku(s, applied.sku ?? '') && (!applied.mfr || s.manufacturer.includes(applied.mfr)) && (!applied.batch || b.batch_no.includes(applied.batch))
      && (!applied.expState || expiryState(b.expiry_date, DEMO_DATE, applied.window) === applied.expState)
      && (!applied.warehouse || b.warehouse_id === applied.warehouse) && (!applied.status || b.status === applied.status) && (!applied.owner || b.owner_id === applied.owner);
  }).sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999')).map(b => ({ ...b, key: `${b.warehouse_id}|${b.sku_id}|${b.batch_no}` })), [applied, allScoped]);

  /** 药品库存：按 SKU+快照时点 汇总，不跨快照累计；等于对应批次之和 */
  const skuRows = useMemo<SkuRow[]>(() => {
    const m = new Map<string, SkuRow>();
    bs.forEach(b => {
      const k = `${b.sku_id}|${b.snapshot_at}`;
      const r = m.get(k) ?? { key: k, sku_id: b.sku_id, snapshot_at: b.snapshot_at, qty: 0, eff: 0, effMissing: false, avail: 0, reserved: 0, batchRecords: 0, expiring: 0, coverage: null, noSales: false };
      r.qty += b.qty; r.reserved += b.reserved_qty; r.avail += availableQty(b, DEMO_DATE); r.batchRecords++;
      if (b.effective_qty_src === null) r.effMissing = true; else r.eff = (r.eff ?? 0) + b.effective_qty_src;
      m.set(k, r);
    });
    return [...m.values()].map(r => ({
      ...r,
      expiring: expiringBatchCount(bs.filter(b => b.sku_id === r.sku_id && b.snapshot_at === r.snapshot_at), DEMO_DATE, applied.window),
      coverage: coverageDays(r.sku_id, allScoped, sf, DEMO_DATE).days,
      noSales: noSalesSkus.has(r.sku_id),
    })).sort((a, b) => b.expiring - a.expiring || (a.coverage ?? 9999) - (b.coverage ?? 9999));
  }, [bs, applied.window, allScoped, sf, noSalesSkus]);

  const stats = useMemo(() => ({
    expiring: expiringBatchCount(allScoped, DEMO_DATE, applied.window),
    expiring30: expiringBatchCount(allScoped, DEMO_DATE, 30),
    expired: allScoped.filter(b => expiryState(b.expiry_date, DEMO_DATE, 0) === '已过期').length,
    unknown: allScoped.filter(b => !b.expiry_date).length,
    skus: new Set(allScoped.map(b => b.sku_id)).size,
  }), [allScoped, applied.window]);

  const setQuick = (patch: Partial<F>, toTab?: 'sku' | 'batch') => { const v = { ...form.getFieldsValue(), ...patch } as F; form.setFieldsValue(v); search(v); if (toTab) setTab(toTab); setMainTab('list'); };
  const toggleExp = (st: string) => setQuick({ expState: applied.expState === st ? undefined : st }, 'batch');
  const whOpts = warehouses.filter(w => scope.warehouses.includes(w.warehouse_id)).map(w => ({ value: w.warehouse_id, label: w.name }));
  const unitOf = (id: string) => skuMap.get(id)!.unit;
  const dash = <Typography.Text type="secondary">—</Typography.Text>;
  const shSnap = scope.warehouses.includes('WH3');
  const { openCustomer } = useDrill();
  const plan = useMemo(() => clearancePlan(scope), [scope]);
  const planMap = new Map(plan.map(p => [`${p.b.warehouse_id}|${p.b.sku_id}|${p.b.batch_no}`, p]));
  const clrAns = useMemo(() => runClearance(scope), [scope]);
  const clrDrafts = clrAns.taskDrafts ?? [];
  const [mainTab, setMainTab] = useState<'list' | 'clear'>(() => (params.get('diag') === 'clearance' ? 'clear' : 'list'));

  const skuColumns = [
    { title: '药品', fixed: 'left' as const, width: 250, render: (_: any, r: SkuRow) => <DrugCell id={r.sku_id} /> },
    { title: <Definition label="当前库存" def={DEF.cur} />, align: 'right' as const, sorter: (a: SkuRow, b: SkuRow) => a.qty - b.qty, render: (_: any, r: SkuRow) => <Qty v={r.qty} unit={unitOf(r.sku_id)} strong /> },
    { title: <Definition label="可用库存" def={DEF.avail} />, align: 'right' as const, render: (_: any, r: SkuRow) => <Qty v={r.avail} unit={unitOf(r.sku_id)} /> },
    { title: <Definition label="有效库存（原系统）" def={DEF.eff} />, align: 'right' as const, render: (_: any, r: SkuRow) => <Space size={4}><Qty v={r.eff} unit={unitOf(r.sku_id)} />{r.effMissing && <Tooltip title="部分批次缺少原系统有效库存字段"><Tag color="warning" bordered={false} style={{ marginInlineEnd: 0 }}>部分缺失</Tag></Tooltip>}</Space> },
    { title: '已占用', align: 'right' as const, render: (_: any, r: SkuRow) => (r.reserved ? <Qty v={r.reserved} unit={unitOf(r.sku_id)} /> : dash) },
    { title: '批次', render: (_: any, r: SkuRow) => <Space size={6}><a onClick={() => setQuick({ sku: skuMap.get(r.sku_id)!.source_code }, 'batch')}>{r.batchRecords} 条</a>{r.expiring > 0 && <Tag color="warning" bordered={false} icon={<FieldTimeOutlined />}>临期 {r.expiring}</Tag>}</Space> },
    { title: <Definition label="覆盖天数" def={DEF.cov} />, width: 120, sorter: (a: SkuRow, b: SkuRow) => (a.coverage ?? 9999) - (b.coverage ?? 9999), render: (_: any, r: SkuRow) => <Coverage days={r.coverage} /> },
    { title: '提示', render: (_: any, r: SkuRow) => { const conv = !!skuMap.get(r.sku_id)!.conversion; return r.noSales || !conv ? <Space size={4} wrap>{r.noSales && <Tag color="orange" bordered={false}>无近期销售</Tag>}{!conv && <Tag color="red" bordered={false}>缺转换规则</Tag>}</Space> : dash; } },
    { title: '快照', render: (_: any, r: SkuRow) => <Typography.Text type="secondary">{snapShort(r.snapshot_at)}</Typography.Text> },
  ];

  const batchColumns = [
    { title: '药品', fixed: 'left' as const, width: 250, render: (_: any, b: BatchRow) => <DrugCell id={b.sku_id} /> },
    { title: '批号', dataIndex: 'batch_no', render: (v: string) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
    { title: '有效期', sorter: (a: BatchRow, b: BatchRow) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'), render: (_: any, b: BatchRow) => <ExpiryCell b={b} window={applied.window} /> },
    { title: '效期状态', render: (_: any, b: BatchRow) => <StatusTag value={expiryState(b.expiry_date, DEMO_DATE, applied.window)} /> },
    { title: '仓库 / 货权', width: 170, render: (_: any, b: BatchRow) => <div className="cell-2l"><span style={{ color: '#262626', fontSize: 14 }}>{whMap.get(b.warehouse_id)?.name}</span><span>{ownerMap.get(b.owner_id)?.name}</span></div> },
    { title: '库存状态', render: (_: any, b: BatchRow) => <StatusTag value={b.status} /> },
    { title: <Definition label="当前库存" def={DEF.cur} />, align: 'right' as const, sorter: (a: BatchRow, b: BatchRow) => a.qty - b.qty, render: (_: any, b: BatchRow) => <Qty v={b.qty} unit={unitOf(b.sku_id)} strong /> },
    { title: <Definition label="可用库存" def={DEF.avail} />, align: 'right' as const, render: (_: any, b: BatchRow) => <Qty v={availableQty(b, DEMO_DATE)} unit={unitOf(b.sku_id)} /> },
    { title: <Definition label="有效库存（原系统）" def={DEF.eff} />, align: 'right' as const, render: (_: any, b: BatchRow) => <Qty v={b.effective_qty_src} unit={unitOf(b.sku_id)} /> },
    { title: '已占用', align: 'right' as const, render: (_: any, b: BatchRow) => (b.reserved_qty ? <Qty v={b.reserved_qty} unit={unitOf(b.sku_id)} /> : dash) },
    { title: 'AI 去化', render: (_: any, b: BatchRow) => { const p = planMap.get(b.key); return p ? <Tooltip title={<div>到期前预计剩余 {p.remaining}{unitOf(b.sku_id)}<br />候选：{p.cands.map(c => c.name).join('、') || '无'}</div>}><Tag color="processing" bordered={false} icon={<RobotOutlined />}>剩 {p.remaining}{unitOf(b.sku_id)}</Tag></Tooltip> : dash; } },
    { title: '快照', render: (_: any, b: BatchRow) => <Typography.Text type="secondary">{snapShort(b.snapshot_at)}</Typography.Text> },
  ];

  return (
    <div>
      <div className="dash-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>库存管理</Typography.Title>
          <Space size={6} wrap style={{ marginTop: 6 }}>
            <Tag bordered={false} color="blue">快照 杭州主仓 / 宁波分仓 11-03 08:00</Tag>
            {shSnap && <Tooltip title="快照时点与其他仓不同；药品库存按 SKU+快照时点分行汇总，不跨快照累计"><Tag bordered={false} color="orange" icon={<InfoCircleOutlined />}>上海前置仓 11-02 22:00</Tag></Tooltip>}
            <Tooltip title="库存金额因缺少成本数据不展示；不同SKU单位不同，不提供跨SKU库存总量"><Tag bordered={false}>不展示库存金额</Tag></Tooltip>
          </Space>
        </div>
        <Button type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open(`查看${applied.window}天内临期批次`)}>AI 临期分析</Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<FieldTimeOutlined />} color="#d48806" title={`临期批次（≤${applied.window}天）`} def="同一快照与范围内，按货权主体+SKU+批号去重；跨仓同批次计1次"
            value={<span style={{ color: '#d48806' }}>{stats.expiring}</span>} unit="个" active={applied.expState === '临期'}
            foot={<><span className="kpi-delta warn">≤30天 {stats.expiring30}</span>点击筛选批次</>} onClick={() => toggleExp('临期')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<StopOutlined />} color="#cf1322" title="已过期批次记录" def="有效期早于演示日期或到期当天（演示配置：到期当天视为已过期）"
            value={<span style={{ color: '#cf1322' }}>{stats.expired}</span>} unit="条" active={applied.expState === '已过期'}
            foot={<><span className="kpi-delta down">需处置</span>核查库存状态与货权</>} onClick={() => toggleExp('已过期')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<QuestionOutlined />} color="#8c8c8c" title="未知效期记录" def="批次缺少有效期字段，不参与临期判断"
            value={stats.unknown} unit="条" active={applied.expState === '未知'} foot="需主数据补充有效期" onClick={() => toggleExp('未知')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<DatabaseOutlined />} color="#d46b08" title="无近期销售品种" def={`有库存且近90天（${NO_SALES_FROM} 起）无销售/退货流向，演示规则`}
            value={noSalesSkus.size} unit="个" foot={`共 ${stats.skus} 个在库SKU`} onClick={() => { const id = [...noSalesSkus][0]; if (id) setQuick({ sku: skuMap.get(id)!.source_code }, 'sku'); }} />
        </Col>
      </Row>

      <div className="panel">
        <Form form={form} layout="inline" className="filter-form" initialValues={{ window: 90 }} onFinish={v => { search(v); setMainTab('list'); }}>
          <Form.Item name="sku" label="药品"><Input allowClear placeholder="名称/首拼/编码" /></Form.Item>
          <Form.Item name="warehouse" label="仓库"><Select allowClear placeholder="全部仓库" options={whOpts} /></Form.Item>
          <Form.Item name="expState" label="效期状态"><Select allowClear placeholder="全部" options={['已过期', '临期', '正常', '未知'].map(v => ({ value: v }))} /></Form.Item>
          <Form.Item name="window" label="临期窗口"><Select options={[30, 60, 90].map(v => ({ value: v, label: `${v}天` }))} /></Form.Item>
          {adv && <>
            <Form.Item name="mfr" label="厂家"><Input allowClear placeholder="厂家名称" /></Form.Item>
            <Form.Item name="batch" label="批号"><Input allowClear placeholder="批号" /></Form.Item>
            <Form.Item name="status" label="库存状态"><Select allowClear placeholder="全部" options={['合格', '冻结', '待验'].map(v => ({ value: v }))} /></Form.Item>
            <Form.Item name="owner" label="货权"><Select allowClear placeholder="全部" options={owners.map(o => ({ value: o.owner_id, label: o.name }))} /></Form.Item>
          </>}
          <Space>
            <Button type="link" onClick={() => setAdv(!adv)}>{adv ? <>收起 <UpOutlined /></> : <>更多筛选 <DownOutlined /></>}</Button>
            <Button onClick={() => { form.resetFields(); search({ window: 90 }); setMainTab('list'); }}>重置</Button>
            <Button type="primary" htmlType="submit">搜索</Button>
          </Space>
        </Form>
      </div>
      <Tabs className="page-main-tabs" activeKey={mainTab} onChange={k => setMainTab(k as any)} items={[
        { key: 'list', label: <span className="seg-label">库存明细<b>{stats.skus}</b></span>, children: <>
      <div className="panel">
        <div className="inv-bar">
          <Segmented value={tab} onChange={v => setTab(v as 'sku' | 'batch')} options={[
            { value: 'sku', label: <span className="seg-label">药品库存<b>{skuRows.length}</b></span> },
            { value: 'batch', label: <span className="seg-label">批号库存<b>{bs.length}</b></span> },
          ]} />
        </div>
        <MetaBar meta={meta} />
        {tab === 'sku' ? (
          <ResultTable<SkuRow> rowKey="key" data={skuRows} meta={meta} exportName="药品库存"
            exportCols={[{ key: 'sku_id', title: 'SKU' }, { key: 'snapshot_at', title: '快照时点' }, { key: 'qty', title: '当前库存' }, { key: 'eff', title: '有效库存(原系统)' }, { key: 'avail', title: '可用库存(演示)' }, { key: 'unit', title: '单位' }]}
            exportRow={r => ({ ...r, unit: unitOf(r.sku_id), eff: r.effMissing ? '部分缺失' : r.eff })}
            onRow={r => ({ onDoubleClick: () => setQuick({ sku: skuMap.get(r.sku_id)!.source_code }, 'batch') })}
            columns={skuColumns as any} />
        ) : (
          <ResultTable<BatchRow> rowKey="key" data={bs} meta={meta} exportName="批号库存"
            exportCols={[{ key: 'sku_id', title: 'SKU' }, { key: 'batch_no', title: '批号' }, { key: 'expiry_date', title: '有效期' }, { key: 'warehouse_id', title: '仓库' }, { key: 'status', title: '状态' }, { key: 'qty', title: '当前库存' }, { key: 'snapshot_at', title: '快照' }]}
            tableProps={{ rowClassName: b => { const st = expiryState(b.expiry_date, DEMO_DATE, applied.window); return st === '已过期' ? 'row-expired' : st === '临期' ? 'row-expiring' : ''; } }}
            columns={batchColumns as any}
            summary={<span>共 {bs.length} 条批次记录，其中临期批次（按货权+SKU+批号去重）<b>{expiringBatchCount(bs, DEMO_DATE, applied.window)}</b> 个</span>} />
        )}
      </div>
        </> },
        { key: 'clear', label: <span className="seg-label"><RobotOutlined /> AI 去化建议{plan.length > 0 && <b className="warn">{plan.length}</b>}</span>, children:
      <AiDiagPanel flat id="clearance" title="AI 去化建议" ask="临期库存去化建议" drafts={clrDrafts} analysis={clrAns} observed={[]}
        summary={plan.length ? <>{plan.length} 个合格临期批次按当前日均到期前消化不完，已匹配近6个月买过同品种的客户（同省优先）</> : '当前没有到期前消化不完的临期批次'}
        kpis={[
          { label: '需去化批次', value: plan.length, tone: plan.length ? 'warn' : undefined },
          { label: '最近到期', value: plan[0] ? `${plan[0].left}天` : '—', tone: 'down' },
          { label: '有候选客户', value: plan.filter(p => p.cands.length).length },
        ]}>
        {plan.length > 0 && <div>
          <div className="clr-row clr-head"><span>药品 / 批号</span><span>剩余天数</span><span>自然消化 / 预计剩余</span><span>候选客户（点击查看客户）</span><span /></div>
          {plan.map(p => {
            const u = unitOf(p.b.sku_id);
            return (
              <div key={p.b.warehouse_id + p.b.batch_no} className="clr-row">
                <div className="cell-2l"><SkuLink id={p.b.sku_id} /><span>{p.b.batch_no} · {whMap.get(p.b.warehouse_id)?.name}</span></div>
                <span className={p.left <= 30 ? 'text-down' : ''} style={{ fontWeight: 600 }}>{p.left} 天</span>
                <div><span style={{ fontSize: 12 }}>{p.expectedSold}{u} / <b className="text-down">{p.remaining}{u}</b></span><div className="clr-bar"><i style={{ width: `${(p.expectedSold / p.b.qty) * 100}%` }} /><em style={{ width: `${(p.remaining / p.b.qty) * 100}%` }} /></div></div>
                <div className="clr-cands">{p.cands.length ? p.cands.map(c => <Tooltip key={c.id} title={`近6个月月均 ${c.monthly.toFixed(0)}${u}${c.sameRegion ? '' : '（跨省）'}`}><Tag color={c.sameRegion ? 'blue' : 'default'} bordered={false} onClick={() => openCustomer(c.id)}>{c.name}</Tag></Tooltip>) : <Typography.Text type="secondary">无候选客户</Typography.Text>}</div>
                <Button size="small" type="link" onClick={() => setQuick({ sku: skuMap.get(p.b.sku_id)!.source_code, batch: p.b.batch_no }, 'batch')}>查看批次</Button>
              </div>
            );
          })}
        </div>}
      </AiDiagPanel>
        },
      ]} />
    </div>
  );
}
