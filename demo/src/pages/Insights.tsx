import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Modal, Progress, Segmented, Select, Space, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { WarningOutlined, ExclamationCircleOutlined, InfoCircleOutlined, RobotOutlined, RightOutlined, FileTextOutlined, BulbOutlined, TeamOutlined, BellOutlined, FunnelPlotOutlined, FieldTimeOutlined, SafetyCertificateOutlined, ArrowUpOutlined, ArrowDownOutlined, TrophyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { useAi, usePageAiContext } from '../ai/AiPanel';
import { buildInsights, type Insight, type InsightCat, type InsightLevel } from '../ai/insights';
import { DATA_AS_OF, DEMO_DATE, PEOPLE } from '../data/mock';
import dayjs from 'dayjs';
import { repScorecards, runMeeting, type RepCard } from '../ai/manager';
import { runBrief } from '../ai/engine';
import { BriefDoc } from '../components/BriefDoc';
import { authHealth, clearancePlan, funnelStats } from '../ai/tier2';
import { custMap } from '../data/query';

const LEVEL: Record<InsightLevel, { color: string; bg: string; icon: React.ReactNode; text: string }> = {
  高: { color: '#cf1322', bg: '#fff1f0', icon: <WarningOutlined />, text: '高优先' },
  中: { color: '#d46b08', bg: '#fff7e6', icon: <ExclamationCircleOutlined />, text: '关注' },
  提示: { color: '#1677ff', bg: '#e6f4ff', icon: <InfoCircleOutlined />, text: '提示' },
};
const CATS: InsightCat[] = ['销售', '目标', '客户', '库存', '招商授权', '数据质量'];

function InsightCard({ it }: { it: Insight }) {
  const nav = useNavigate();
  const ai = useAi();
  const lv = LEVEL[it.level];
  return (
    <div className="ins-card" style={{ borderTopColor: lv.color }}>
      <div className="ins-top">
        <Space size={6}>
          <span className="ins-level" style={{ color: lv.color, background: lv.bg }}>{lv.icon}{lv.text}</span>
          <Tag bordered={false} style={{ marginInlineEnd: 0 }}>{it.cat}</Tag>
        </Space>
        {it.metric && <div className="ins-metric"><b style={{ color: lv.color }}>{it.metric.value}</b>{it.metric.unit && <small>{it.metric.unit}</small>}<span>{it.metric.label}</span></div>}
      </div>
      <div className="ins-title">{it.title}</div>
      <ul className="ins-points">{it.points.map(p => <li key={p}>{p}</li>)}</ul>
      {it.verify && <div className="ins-verify"><Tag color="gold" bordered={false}>待核实</Tag>{it.verify}</div>}
      <div className="ins-foot">
        <Tooltip title={`数据依据：${it.basis}`}><span className="ins-basis"><InfoCircleOutlined /> {it.basis}</span></Tooltip>
        <Space size={4}>
          {it.link && <Button size="small" type="text" onClick={() => nav(it.link!.to)}>{it.link.label} <RightOutlined /></Button>}
          {it.ask && <Button size="small" type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open(it.ask)}>深入分析</Button>}
        </Space>
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const w = 120, h = 32, max = Math.max(...data, 1), min = Math.min(...data, 0);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / (max - min || 1)) * (h - 6)}`).join(' ');
  const all = pts.split(' '); const last = all[all.length - 1].split(',');
  return <svg width={w} height={h} className="rep-spark"><polyline points={pts} fill="none" stroke="#1677ff" strokeWidth="1.8" /><circle cx={last[0]} cy={last[1]} r="2.8" fill="#1677ff" /></svg>;
}
const wanS = (n: number) => `${(n / 10000).toFixed(1)}万`;
const p0 = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

function RepCardView({ c }: { c: RepCard }) {
  const ai = useAi();
  const ok = (c.rate ?? 0) >= 0.9;
  const ahead = c.q4Actual >= c.q4Target * c.timeRatio;
  return (
    <div className="rep-card">
      <div className="rep-head">
        <div className="rep-avatar">{c.owner.slice(0, 1)}</div>
        <div className="rep-name"><b>{c.owner}</b><span>{c.areas.join('、')}</span></div>
        <span className={`rep-rank r${c.rank}`}>{c.rank === 1 && <TrophyOutlined />} 第 {c.rank} 名</span>
      </div>
      <div className="rep-main">
        <div>
          <div className="rep-label">10月达成</div>
          <div className="rep-rate" style={{ color: ok ? '#389e0d' : (c.rate ?? 0) >= 0.75 ? '#d48806' : '#cf1322' }}>{p0(c.rate)}</div>
          <div className="rep-sub">{wanS(c.actual)} / 目标 {wanS(c.target)}</div>
        </div>
        <div className="rep-right">
          <Spark data={c.trend.map(t => t.amount)} />
          <span className={`kpi-delta ${(c.mom ?? 0) < 0 ? 'down' : 'up'}`}>{(c.mom ?? 0) < 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} 环比 {c.mom === null ? '—' : `${(c.mom * 100).toFixed(1)}%`}</span>
        </div>
      </div>
      <Progress percent={Math.min(100, Math.round((c.rate ?? 0) * 100))} showInfo={false} size="small" strokeColor={ok ? '#52c41a' : (c.rate ?? 0) >= 0.75 ? '#faad14' : '#ff4d4f'} />
      <div className="rep-q4">
        <span>Q4 {p0(c.q4Rate)}</span>
        <div className="rep-q4-bar"><i style={{ width: `${Math.min(100, (c.q4Rate ?? 0) * 100)}%` }} /><em style={{ left: `${c.timeRatio * 100}%` }} title="时间进度" /></div>
        <span className={ahead ? 'text-up' : 'text-down'}>{ahead ? '领先' : '落后'}时间进度</span>
      </div>
      <div className="rep-stats">
        <div><b>{c.activeCust}</b><span>有销售客户</span><small>流失 {c.lostCust.length} · 新增 {c.newCust.length}</small></div>
        <div><b style={{ color: c.highRisk ? '#cf1322' : undefined }}>{c.risk}</b><span>风险客户</span><small>高风险 {c.highRisk}</small></div>
        <div><b>{c.opps}</b><span>招商机会</span><small>逾期 {c.overdueOpps}</small></div>
        <div><b style={{ color: c.overdueTasks ? '#d46b08' : undefined }}>{c.tasks}</b><span>待办</span><small>逾期 {c.overdueTasks}</small></div>
      </div>
      {c.topDown.length > 0 && <div className="rep-down">主要下滑：{c.topDown.slice(0, 2).map(d => `${custMap.get(d.id)?.name} ${wanS(d.delta)}`).join('、')}</div>}
      <div className="rep-foot">
        <Button size="small" type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open(`分析${c.owner}的业绩`)}>AI 业绩分析</Button>
        {c.risk > 0 && <Button size="small" type="text" onClick={() => ai.open(`${c.owner}名下哪些客户有流失风险`)}>风险客户 <RightOutlined /></Button>}
      </div>
    </div>
  );
}

export default function Insights() {
  const { scope, opportunities, tasks, authorizations, promotions } = useStore();
  const ai = useAi();
  const [cat, setCat] = useState<string>('全部');
  const nav = useNavigate();
  const [tab, setTab] = useState<string>(() => { try { return (t => (t === 'diag' ? 'brief' : t))(sessionStorage.getItem('ins-tab') ?? 'overview'); } catch { return 'overview'; } });
  useEffect(() => { try { sessionStorage.setItem('ins-tab', tab); } catch { /* ignore */ } }, [tab]);
  const [onlyHigh, setOnlyHigh] = useState(false);
  usePageAiContext({ page: 'AI经营洞察' });
  const all = useMemo(() => buildInsights(scope, { opportunities, tasks, authorizations, promotions }), [scope, opportunities, tasks, authorizations, promotions]);
  const reps = useMemo(() => repScorecards(scope, { opportunities, tasks, authorizations, promotions }), [scope, opportunities, tasks, authorizations, promotions]);
  const list = all.filter(i => (cat === '全部' || i.cat === cat) && (!onlyHigh || i.level === '高'));
  const n = (l: InsightLevel) => all.filter(i => i.level === l).length;
  const top = all.filter(i => i.level === '高');
  const { addTask } = useStore();
  const [remind, setRemind] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<Record<string, string>>({});
  const openRemind = () => { setPicked(all.filter(i => i.level === '高').map(i => i.id)); setRemind(true); };
  const saveRemind = () => {
    let ok = 0, dup = 0;
    all.filter(i => picked.includes(i.id)).forEach(i => {
      const r = addTask({ title: `【经营异动】${i.title}`, object_type: '经营洞察', object_ids: [i.id], suggestion: `${i.points[0] ?? ''}${i.verify ? `（待核实：${i.verify}）` : ''}`, assignee: assignee[i.id] ?? '陈晓', due_at: dayjs(DEMO_DATE).add(i.level === '高' ? 3 : 7, 'day').format('YYYY-MM-DD'), evidence_desc: `AI经营洞察 ${DEMO_DATE}：${i.basis}`, source: 'AI草稿确认', idemKey: `insight|${i.id}|${DEMO_DATE}` });
      if (r.ok) ok++; else dup++;
    });
    message.success(`已保存 ${ok} 条提醒待办${dup ? `，${dup} 条此前已生成已忽略` : ''}`);
    setRemind(false);
  };

  const fu = useMemo(() => funnelStats({ opportunities, tasks, authorizations, promotions }), [opportunities, tasks, authorizations, promotions]);
  const clr = useMemo(() => clearancePlan(scope), [scope]);
  const ah = useMemo(() => authHealth(scope, { opportunities, tasks, authorizations, promotions }), [scope, opportunities, tasks, authorizations, promotions]);
  const ranked = [...reps].sort((a, b) => a.rank - b.rank);
  const DIAGS = [
    { key: 'funnel', icon: <FunnelPlotOutlined />, color: '#722ed1', title: '招商漏斗诊断', page: '招商进度管理', to: '/opportunities?diag=funnel', ask: '招商漏斗诊断', stat: `${fu.stuck.length} 个卡点`, desc: fu.bottleneck ? `"→${fu.bottleneck.stage}"转化最低（${Math.round((fu.bottleneck.conv ?? 0) * 100)}%），进行中 ${fu.active.length} 个` : `进行中 ${fu.active.length} 个` },
    { key: 'clr', icon: <FieldTimeOutlined />, color: '#d48806', title: '临期去化建议', page: '库存管理', to: '/inventory?diag=clearance', ask: '临期库存去化建议', stat: `${clr.length} 个批次`, desc: clr[0] ? `最近 ${clr[0].left} 天到期，已匹配候选客户` : '暂无需去化批次' },
    { key: 'auth', icon: <SafetyCertificateOutlined />, color: '#13a8a8', title: '授权健康诊断', page: '合伙人授权', to: '/authorizations?diag=health', ask: '授权与推广健康度', stat: `${ah.filter(h => h.issues.some(i => i.level !== '提示')).length} 份需处理`, desc: `${ah.filter(h => h.biz === '生效中' && !h.running.length).length} 份生效中但无推广` },
  ];

  const overview = (
    <div className="ov-grid">
      <div className="ov-col">
        <div className="ins-summary">
          <span className="ai-logo"><BulbOutlined /></span>
          <div className="ins-summary-body">
            <div className="ins-summary-title">今日要点</div>
            <div className="ins-summary-text">共扫描出 {all.length} 条洞察，其中 {n('高')} 条需要优先处理。10月目标达成 {reps.length ? p0(reps.reduce((a, r) => a + r.actual, 0) / Math.max(1, reps.reduce((a, r) => a + r.target, 0))) : '—'}，团队中 {ranked.filter(r => (r.rate ?? 0) < 0.85).map(r => r.owner).join('、') || '无人'} 达成率低于 85%。</div>
          </div>
          <div className="ins-counts">
            {(['高', '中', '提示'] as InsightLevel[]).map(l => (
              <div key={l} style={{ color: LEVEL[l].color, cursor: 'pointer' }} onClick={() => { setOnlyHigh(l === '高'); setCat('全部'); setTab('list'); }}><b>{n(l)}</b><span>{LEVEL[l].icon} {LEVEL[l].text}</span></div>
            ))}
          </div>
        </div>
        <div className="ov-card">
          <div className="ov-card-head"><b><WarningOutlined style={{ color: '#cf1322' }} /> 需要优先处理</b><a onClick={() => { setOnlyHigh(true); setCat('全部'); setTab('list'); }}>查看全部 <RightOutlined /></a></div>
          {top.map(i => (
            <div key={i.id} className="ov-item">
              <Tag bordered={false} style={{ marginInlineEnd: 0 }}>{i.cat}</Tag>
              <div className="ov-item-main"><div className="ov-item-title">{i.title}</div><div className="ov-item-sub">{i.points[0]}</div></div>
              {i.metric && <span className="ov-item-metric" style={{ color: LEVEL[i.level].color }}>{i.metric.value}<small>{i.metric.unit}</small></span>}
              <Space size={2}>
                {i.link && <Button size="small" type="text" onClick={() => nav(i.link!.to)}>{i.link.label}</Button>}
                {i.ask && <Button size="small" type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open(i.ask)} />}
              </Space>
            </div>
          ))}
        </div>
      </div>
      <div className="ov-col">
        <div className="ov-card">
          <div className="ov-card-head"><b><TeamOutlined style={{ color: '#1677ff' }} /> 销售业绩排行 · 10月</b><a onClick={() => setTab('reps')}>详情 <RightOutlined /></a></div>
          {ranked.map(c => (
            <div key={c.owner} className="ov-rep" onClick={() => ai.open(`分析${c.owner}的业绩`)}>
              <span className={`rep-rank r${c.rank}`}>{c.rank}</span>
              <div className="rep-avatar sm">{c.owner.slice(0, 1)}</div>
              <div className="ov-rep-main">
                <div className="ov-rep-line"><b>{c.owner}</b><span style={{ color: (c.rate ?? 0) >= 0.9 ? '#389e0d' : (c.rate ?? 0) >= 0.75 ? '#d48806' : '#cf1322', fontWeight: 600 }}>{p0(c.rate)}</span></div>
                <Progress percent={Math.min(100, Math.round((c.rate ?? 0) * 100))} showInfo={false} size="small" strokeColor={(c.rate ?? 0) >= 0.9 ? '#52c41a' : (c.rate ?? 0) >= 0.75 ? '#faad14' : '#ff4d4f'} />
                <div className="ov-rep-sub">环比 {c.mom === null ? '—' : `${(c.mom * 100).toFixed(1)}%`} · 风险客户 {c.risk} · 待办逾期 {c.overdueTasks}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="ov-card">
          <div className="ov-card-head"><b><BulbOutlined style={{ color: '#13a8a8' }} /> 专项诊断</b><span className="ov-item-sub">点击进入对应页面诊断</span></div>
          {DIAGS.map(d => (
            <div key={d.key} className="ov-diag" onClick={() => nav(d.to)}>
              <span className="risk-icon" style={{ color: d.color, background: `${d.color}14` }}>{d.icon}</span>
              <div className="ov-item-main"><div className="ov-item-title">{d.title}<small> · {d.page}</small></div><div className="ov-item-sub">{d.desc}</div></div>
              <b style={{ color: d.color, whiteSpace: 'nowrap' }}>{d.stat}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const repsTab = (
    <div>
      <div className="ins-section-head">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>2026-10 · 按负责人归集客户 · 目标为演示数据 · 点击卡片按钮进行 AI 分析</Typography.Text>
        <Button size="small" icon={<RobotOutlined />} onClick={() => ai.open('团队负责人业绩怎么样')}>AI 团队对比</Button>
      </div>
      <div className="rep-grid">{ranked.map(c => <RepCardView key={c.owner} c={c} />)}</div>
    </div>
  );

  const listTab = (
    <div>
      <div className="ins-bar">
        <Segmented value={cat} onChange={v => setCat(v as string)} options={['全部', ...CATS].map(c => ({ value: c, label: <span className="seg-label">{c}<b>{c === '全部' ? all.length : all.filter(i => i.cat === c).length}</b></span> }))} />
        <Button type={onlyHigh ? 'primary' : 'default'} ghost={onlyHigh} icon={<WarningOutlined />} onClick={() => setOnlyHigh(!onlyHigh)}>只看高优先</Button>
      </div>
      {list.length ? <div className="ins-grid">{list.map(i => <InsightCard key={i.id} it={i} />)}</div> : <div className="panel"><Empty description="当前分类下暂无洞察" /></div>}
    </div>
  );

  const briefOpts = useMemo(() => {
    const m = runBrief(scope);
    const w = runMeeting(scope, { opportunities, tasks, authorizations, promotions }, '生成本周销售周会材料');
    return [
      { key: 'month', label: '月度经营简报', text: m.brief ?? '', note: `经营概况、变化贡献、库存风险、数据质量与建议跟进事项；查询编号 ${m.meta?.query_id ?? '—'}。` },
      { key: 'weekly', label: '销售周会材料', text: w.brief ?? '', note: '业绩与目标、变化归因、风险客户、库存、招商与授权、团队情况、下周重点，共 7 部分。' },
    ];
  }, [scope, opportunities, tasks, authorizations, promotions]);
  const briefTab = <BriefDoc options={briefOpts} extra={<Button icon={<RobotOutlined />} onClick={() => ai.open('生成本月经营简报')}>在 AI 助手中调整</Button>} />;

  return (
    <div>
      <div className="dash-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>AI 经营洞察</Typography.Title>
          <Space size={6} wrap style={{ marginTop: 6 }}>
            <Tag bordered={false} color="blue">统计期 2026-10 · 对比 2026-09</Tag>
            <Tag bordered={false}>数据更新 {DATA_AS_OF}</Tag>
            <Tooltip title="由规则引擎扫描指标层生成，未接入大模型；数字均来自指标服务，原因列为待核实"><Tag bordered={false} color="gold">规则解析模式</Tag></Tooltip>
          </Space>
        </div>
        <Space>
          <Button icon={<BellOutlined />} onClick={openRemind}>生成提醒待办</Button>
          <Button type="primary" icon={<FileTextOutlined />} onClick={() => setTab('brief')}>查看经营简报</Button>
        </Space>
      </div>

      <Tabs className="ins-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'overview', label: '概览', children: overview },
        { key: 'reps', label: <span className="seg-label">销售业绩<b>{reps.length}</b></span>, children: repsTab },
        { key: 'list', label: <span className="seg-label">洞察清单<b>{all.length}</b></span>, children: listTab },
        { key: 'brief', label: <span><FileTextOutlined /> 经营简报</span>, children: briefTab },
      ]} />

      <Modal open={remind} width={720} title="生成提醒待办（预览，确认后保存到任务中心）" okText={`确认保存 ${picked.length} 条`} okButtonProps={{ disabled: !picked.length }} onOk={saveRemind} onCancel={() => setRemind(false)}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>默认勾选高优先异动；AI 不会自动发送或指派，保存后可在任务中心修改。同一天同一异动重复保存会被忽略。</Typography.Paragraph>
        <div className="remind-list">
          {all.filter(i => i.level !== '提示').map(i => (
            <div key={i.id} className="remind-item">
              <Checkbox checked={picked.includes(i.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, i.id] : p.filter(x => x !== i.id)))} />
              <span className="ins-level" style={{ color: LEVEL[i.level].color, background: LEVEL[i.level].bg }}>{LEVEL[i.level].icon}{LEVEL[i.level].text}</span>
              <span className="remind-title">{i.title}</span>
              <Select size="small" style={{ width: 90 }} value={assignee[i.id] ?? '陈晓'} onChange={v => setAssignee(a => ({ ...a, [i.id]: v }))} options={PEOPLE.map(p => ({ value: p }))} />
              <span className="remind-due">截止 {dayjs(DEMO_DATE).add(i.level === '高' ? 3 : 7, 'day').format('MM-DD')}</span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
