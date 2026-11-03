import { useMemo, useState } from 'react';
import { Button, Card, Col, DatePicker, Row, Select, Space, Tag, Typography } from 'antd';
import { Bar, Line } from '@ant-design/plots';
import {
  ArrowDownOutlined, ArrowUpOutlined, RobotOutlined, WarningOutlined, ClockCircleOutlined, DatabaseOutlined, ShopOutlined,
  MoneyCollectOutlined, TeamOutlined, MedicineBoxOutlined, FieldTimeOutlined, RightOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { DATA_AS_OF, DEMO_DATE, duplicateConflicts, flows } from '../data/mock';
import { custMap, fmtMoney, fmtPct, fmtWan, partnerMap, scopedBatches, scopedFlows, skuMap } from '../data/query';
import { activeCustomerCount, authBizStatus, compareBy, contribution, currentVersion, expiringBatchCount, inPeriod, isSalesFlow, latestVersion, monthPeriod, netSalesAmount, periodLabel } from '../metrics';
import { useStore } from '../data/store';
import { useAi, usePageAiContext } from '../ai/AiPanel';
import { Kpi } from '../components/Kpi';
import { customerRisks } from '../metrics/salesMgmt';
import { customerOwner } from '../data/targets';
import { customers } from '../data/mock';

export default function Dashboard() {
  const { scope, tasks, opportunities, authorizations } = useStore();
  const ai = useAi();
  const nav = useNavigate();
  const [month, setMonth] = useState<Dayjs>(dayjs('2026-10-01'));
  const [region, setRegion] = useState<string | undefined>();
  const m = month.format('YYYY-MM');
  const pm = month.subtract(1, 'month').format('YYYY-MM');
  usePageAiContext({ page: 'P01 经营工作台', filters: { 统计周期: m, region: region ?? '' } });

  const d = useMemo(() => {
    const fs = scopedFlows(scope).filter(f => f.customer_id && (!region || custMap.get(f.customer_id)!.region === region));
    const cur = monthPeriod(m); const base = monthPeriod(pm);
    const cf = fs.filter(f => inPeriod(f.biz_date, cur));
    const bf = fs.filter(f => inPeriod(f.biz_date, base));
    const months = Array.from({ length: 12 }, (_, i) => dayjs(`${m}-01`).subtract(11 - i, 'month').format('YYYY-MM'));
    const trend = months.map(x => ({ month: x, amount: netSalesAmount(fs.filter(f => inPeriod(f.biz_date, monthPeriod(x)))) }));
    const byCust = compareBy(fs, cur, base, f => f.customer_id!).sort((a, b) => a.delta - b.delta);
    const bySku = compareBy(fs, cur, base, f => f.sku_id).sort((a, b) => a.delta - b.delta);
    const bs = scopedBatches(scope);
    const skuSet = (x: typeof cf) => new Set(x.filter(f => f.type === '销售').map(f => f.sku_id)).size;
    return {
      net: netSalesAmount(cf), netB: netSalesAmount(bf), trend, byCust, bySku, contrib: contribution(byCust, 2),
      customers: activeCustomerCount(cf), customersB: activeCustomerCount(bf), skus: skuSet(cf), skusB: skuSet(bf),
      expiring: expiringBatchCount(bs, DEMO_DATE, 90), expiring30: expiringBatchCount(bs, DEMO_DATE, 30),
    };
  }, [scope, region, m, pm]);

  const lastSale = useMemo(() => { const mm = new Map<string, string>(); flows.filter(isSalesFlow).forEach(f => { if ((mm.get(f.sku_id) ?? '') < f.biz_date) mm.set(f.sku_id, f.biz_date); }); return mm; }, []);
  const noSales = [...new Set(scopedBatches(scope).map(b => b.sku_id))].filter(id => (lastSale.get(id) ?? '') < '2026-08-05');
  const pendingTasks = tasks.filter(t => t.status === '待处理' || t.status === '处理中');
  const overdueTasks = pendingTasks.filter(t => t.due_at < DEMO_DATE);
  const overdueOpps = opportunities.filter(o => o.next_date && o.next_date < DEMO_DATE && !['合作确认', '关闭未达成'].includes(o.stage));
  const expiringAuth = authorizations.filter(a => authBizStatus(a, DEMO_DATE) === '生效中' && dayjs(currentVersion(a)!.valid_to).diff(DEMO_DATE, 'day') <= 30);
  const pendingAuth = authorizations.filter(a => latestVersion(a).review === '待确认');
  const delta = d.net - d.netB;
  const down = delta < 0;

  const custRisk = useMemo(() => customerRisks(scopedFlows(scope), customers.filter(c => scope.regions.includes(c.region)), customerOwner, '2026-10', DEMO_DATE), [scope]);
  const highRisk = custRisk.filter(r => r.level === '高');
  const risks: { icon: React.ReactNode; color: string; title: string; desc: string; count: number; to: string; ask?: string }[] = [
    { icon: <TeamOutlined />, color: '#cf1322', title: '流失风险客户', desc: `高风险 ${highRisk.length} 家：${highRisk.slice(0, 3).map(r => custMap.get(r.customer_id)!.name).join('、')}${highRisk.length > 3 ? ' 等' : ''}`, count: custRisk.length, to: '/customers', ask: '哪些客户有流失风险' },
    { icon: <WarningOutlined />, color: '#d48806', title: '临期批次', desc: `≤90天，其中 ≤30天 ${d.expiring30} 个`, count: d.expiring, to: '/inventory?tab=batch&window=90' },
    { icon: <DatabaseOutlined />, color: '#d46b08', title: '无近期销售品种', desc: noSales.map(id => skuMap.get(id)!.trade_name + ' ' + skuMap.get(id)!.generic_name).join('、') || '无', count: noSales.length, to: '/inventory' },
    { icon: <SafetyCertificateOutlined />, color: '#cf1322', title: '待复核数据', desc: `重复导入 ${duplicateConflicts.length} 条（已去重）· 缺单位转换 ${[...skuMap.values()].filter(s => !s.conversion).length} 个SKU`, count: duplicateConflicts.length + [...skuMap.values()].filter(s => !s.conversion).length, to: '/flows/sales' },
    { icon: <ClockCircleOutlined />, color: '#1677ff', title: '待处理任务', desc: `已逾期 ${overdueTasks.length} 个`, count: pendingTasks.length, to: '/tasks' },
    { icon: <ShopOutlined />, color: '#722ed1', title: '招商跟进逾期', desc: overdueOpps.map(o => o.opportunity_id).join('、') || '无', count: overdueOpps.length, to: '/opportunities?overdue=1' },
    { icon: <ShopOutlined />, color: '#13a8a8', title: '授权提醒', desc: `30天内到期 ${expiringAuth.length} 份${expiringAuth.length ? `（${partnerMap.get(expiringAuth[0].partner_id)?.name}）` : ''} · 待确认 ${pendingAuth.length} 份`, count: expiringAuth.length + pendingAuth.length, to: '/authorizations' },
  ];

  const topCust = d.byCust.slice(0, 8).map(r => ({ name: custMap.get(r.key)!.name, delta: r.delta }));
  const skuRank = [...d.bySku.slice(0, 5)];
  const maxAbs = Math.max(...skuRank.map(r => Math.abs(r.delta)), 1);
  const insight = d.contrib.top.length && d.netB > 0
    ? `${m.replace('-', '年')}月净销售额 ${fmtWan(d.net)}，环比${down ? '下降' : '增长'} ${fmtWan(Math.abs(delta))}（${fmtPct(delta / d.netB)}）。变化主要集中在 ${d.contrib.top.map(r => custMap.get(r.key)!.name).join('、')}，合计${d.contrib.topSum < 0 ? '减少' : '增加'} ${fmtWan(Math.abs(d.contrib.topSum))}，占净变化 ${d.contrib.share === null ? '—' : (d.contrib.share * 100).toFixed(1) + '%'}。`
    : '当前范围内暂无可比数据。';

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>经营工作台</Typography.Title>
          <Space size={6} wrap style={{ marginTop: 6 }}>
            <Tag bordered={false} color="blue">统计周期 {periodLabel(monthPeriod(m))}</Tag>
            <Tag bordered={false}>库存快照 {DATA_AS_OF}（上海仓 11-02 22:00）</Tag>
            <Tag bordered={false}>数据更新 {DATA_AS_OF}</Tag>
          </Space>
        </div>
        <Space>
          <Select allowClear placeholder="全部地区" style={{ width: 120 }} value={region} onChange={setRegion} options={scope.regions.map(r => ({ value: r }))} />
          <DatePicker picker="month" value={month} allowClear={false} onChange={v => v && setMonth(v)} disabledDate={x => x.isAfter('2026-10-31')} />
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<MoneyCollectOutlined />} color="#1677ff" title="净销售额（未税）" def="销售金额为正、退货为负求和；未税；演示口径 demo_v1"
            value={<>¥{(d.net / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</>} unit="万"
            foot={<><span className={`kpi-delta ${down ? 'down' : 'up'}`}>{down ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {fmtPct(d.netB > 0 ? delta / d.netB : null)}</span>环比 {fmtMoney(delta)}</>}
            onClick={() => nav(`/sales-compare?cur=${m}&base=${pm}&dim=customer${region ? `&region=${region}` : ''}`)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<TeamOutlined />} color="#13a8a8" title="有效交易客户数" def="查询期间有销售交易的去重客户数（排除仅退货客户），按稳定 customer_id"
            value={d.customers} unit="家" foot={<><span className={`kpi-delta ${d.customers < d.customersB ? 'down' : 'up'}`}>{d.customers - d.customersB >= 0 ? '+' : ''}{d.customers - d.customersB}</span>上期 {d.customersB} 家</>} onClick={() => nav('/customers')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<MedicineBoxOutlined />} color="#722ed1" title="动销SKU数" def="统计周期内有销售记录的去重SKU数"
            value={d.skus} unit="个" foot={<><span className={`kpi-delta ${d.skus < d.skusB ? 'down' : 'up'}`}>{d.skus - d.skusB >= 0 ? '+' : ''}{d.skus - d.skusB}</span>共 {skuMap.size} 个SKU</>} onClick={() => nav('/inventory')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Kpi icon={<FieldTimeOutlined />} color="#d48806" title="临期批次数（≤90天）" def="同一快照与范围内，按货权+SKU+批号去重；跨仓同批次计1次；以库存快照为准"
            value={<span style={{ color: '#d48806' }}>{d.expiring}</span>} unit="个" foot={<><span className="kpi-delta warn">≤30天 {d.expiring30}</span>库存快照时点，非统计周期</>} onClick={() => nav('/inventory?tab=batch&window=90')} />
        </Col>
      </Row>

      <div className="dash-insight">
        <span className="ai-logo"><RobotOutlined /></span>
        <div className="dash-insight-text">
          <div className="dash-insight-title">AI 经营洞察 <Tag color="gold" bordered={false}>规则解析模式</Tag><a style={{ fontWeight: 400, fontSize: 12, marginLeft: 4 }} onClick={() => nav('/insights')}>查看全部洞察 →</a></div>
          <div>{insight}<Typography.Text type="secondary">（具体原因待核实）</Typography.Text></div>
        </div>
        <Space wrap>
          <Button type="primary" ghost onClick={() => ai.open('10月销售下降主要在哪')}>解释本月变化</Button>
          <Button onClick={() => ai.open('查看90天内临期批次')}>查看临期批次</Button>
          <Button onClick={() => ai.open('10月目标完成情况和缺口')}>目标缺口</Button>
          <Button onClick={() => ai.open('生成本周销售周会材料')}>周会材料</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card size="small" className="dash-card" title="近12月净销售额趋势" extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>点击数据点进入销售对比</Typography.Text>}>
            <Line height={300} data={d.trend} xField="month" yField="amount"
              style={{ lineWidth: 2.5, stroke: '#1677ff' }} point={{ shapeField: 'circle', sizeField: 4, style: { fill: '#fff', stroke: '#1677ff', lineWidth: 2 } }}
              axis={{ x: { labelFormatter: (v: string) => v.slice(2).replace('-', '/') , line: true }, y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(0)}万`, grid: true, gridLineDash: [3, 3] } }}
              tooltip={{ items: [{ channel: 'y', name: '净销售额', valueFormatter: (v: number) => fmtMoney(v) }] }}
              onReady={({ chart }: any) => chart.on('element:click', (e: any) => { const mo = e.data?.data?.month; if (mo) nav(`/sales-compare?cur=${mo}&base=${dayjs(`${mo}-01`).subtract(1, 'month').format('YYYY-MM')}&dim=customer`); })} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" className="dash-card" title="风险与待办" styles={{ body: { padding: '4px 8px' } }}>
            {risks.map(r => (
              <div key={r.title} className="risk-item" onClick={() => (r.ask ? ai.open(r.ask) : nav(r.to))}>
                <span className="risk-icon" style={{ color: r.color, background: `${r.color}14` }}>{r.icon}</span>
                <div className="risk-body"><div className="risk-title">{r.title}</div><div className="risk-desc" title={r.desc}>{r.desc}</div></div>
                <span className="risk-count" style={{ color: r.count ? r.color : '#bfbfbf' }}>{r.count}</span>
                <RightOutlined className="risk-arrow" />
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" className="dash-card" title="客户贡献" extra={<Space size={12}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{m} vs {pm} · 差额最大的8个客户</Typography.Text><a onClick={() => nav(`/sales-compare?cur=${m}&base=${pm}&dim=customer`)}>查看全部</a></Space>}>
            <Bar height={300} data={topCust} xField="name" yField="delta"
              style={{ fill: (x: any) => (x.delta < 0 ? '#ff7875' : '#69b1ff'), radiusTopLeft: 3, radiusTopRight: 3, radiusBottomLeft: 3, radiusBottomRight: 3, maxWidth: 18 }}
              axis={{ x: { title: false }, y: { title: false, labelFormatter: (v: number) => `${(v / 10000).toFixed(0)}万`, grid: true, gridLineDash: [3, 3] } }}
              tooltip={{ items: [{ channel: 'y', name: '差额', valueFormatter: (v: number) => fmtMoney(v) }] }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" className="dash-card" title="药品变化排行" extra={<Space size={12}><Typography.Text type="secondary" style={{ fontSize: 12 }}>按差额，下降最多的5个</Typography.Text><a onClick={() => nav(`/sales-compare?cur=${m}&base=${pm}&dim=sku`)}>查看全部</a></Space>}>
            <div className="rank-list">
              {skuRank.map((r, i) => {
                const s = skuMap.get(r.key)!;
                return (
                  <div key={r.key} className="rank-item" onClick={() => nav(`/sales-compare?cur=${m}&base=${pm}&dim=sku`)}>
                    <span className={`rank-no ${i < 3 ? 'top' : ''}`}>{i + 1}</span>
                    <div className="rank-body">
                      <div className="rank-name"><span>{s.trade_name} {s.generic_name}</span><Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.spec}</Typography.Text></div>
                      <div className="rank-bar"><span style={{ width: `${(Math.abs(r.delta) / maxAbs) * 100}%`, background: r.delta < 0 ? '#ff7875' : '#69b1ff' }} /></div>
                    </div>
                    <div className="rank-num"><div className={r.delta < 0 ? 'text-down' : 'text-up'}>{fmtMoney(r.delta)}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>本期 {fmtMoney(r.cur)}</Typography.Text></div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
