import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Button, Card, Collapse, DatePicker, Drawer, Form, Input, List, Modal, Select, Space, Steps, Table, Tag, Tooltip, Typography } from 'antd';
import { Column, Line } from '@ant-design/plots';
import { RobotOutlined, SendOutlined, UserOutlined, FileTextOutlined, CheckSquareOutlined, ClearOutlined, RightOutlined, BarChartOutlined, FallOutlined, AlertOutlined, AimOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ask, type AiAnswer, type Conversation, type PageContext, type TaskDraft } from './engine';
import { useStore } from '../data/store';
import { MetaBar, showResult } from '../components/common';
import { PEOPLE } from '../data/mock';
import { downloadText } from '../data/query';

interface AiCtx { open: (q?: string) => void; setPageContext: (c: PageContext) => void; pageContext?: PageContext }
const Ctx = createContext<AiCtx>({ open: () => {}, setPageContext: () => {} });
export const useAi = () => useContext(Ctx);

/** 页面注册当前上下文（查询条件、选中对象），供侧栏AI使用 */
export function usePageAiContext(c: PageContext) {
  const { setPageContext } = useAi();
  const key = JSON.stringify(c);
  useEffect(() => { setPageContext(c); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initQ, setInitQ] = useState<{ q: string; nonce: number } | undefined>();
  const [pageContext, setPageContext] = useState<PageContext>();
  const v = useMemo(() => ({ open: (q?: string) => { setInitQ(q ? { q, nonce: Date.now() + Math.random() } : undefined); setOpen(true); }, setPageContext, pageContext }), [pageContext]);
  return (
    <Ctx.Provider value={v}>
      {children}
      <Drawer title={<Space><span className="ai-logo" style={{ width: 28, height: 28, fontSize: 15, borderRadius: 8 }}><RobotOutlined /></span>AI 经营助手<Tooltip title="问题被解析为结构化 query_spec，由指标服务计算；权限由服务端注入。"><Tag color="gold" bordered={false}>规则解析模式</Tag></Tooltip></Space>} width={640} open={open} onClose={() => setOpen(false)} mask={false} styles={{ body: { padding: 12 } }}>
        <AiChat initialQuestion={initQ} pageContext={pageContext} compact onConsumed={() => setInitQ(undefined)} />
      </Drawer>
    </Ctx.Provider>
  );
}

interface Msg { id: number; role: 'user' | 'ai'; text: string; answer?: AiAnswer; phase?: number }
let msgSeq = 0;

const PRESETS = [
  '比较浙江地区2026年10月和9月的药品净销售额，列出下降最多的前10个SKU',
  '10月销售下降主要在哪',
  '只看医院客户',
  '这些药品现在有多少库存',
  '查看90天内临期批次',
  '生成本月经营简报',
  '授权到期了怎么续期',
];

const SUGGEST = [
  { title: '专项诊断', color: '#13a8a8', icon: <BarChartOutlined />, items: ['招商漏斗诊断', '临期库存去化建议', '授权与推广健康度'] },
  { title: '主管视角', color: '#722ed1', icon: <AimOutlined />, items: ['哪些客户有流失风险', '10月目标完成情况和缺口', '团队负责人业绩怎么样', '分析陈晓的业绩', '分析赵宁的业绩', '生成本周销售周会材料'] },
  { title: '智能问数', color: '#1677ff', icon: <BarChartOutlined />, items: [PRESETS[0], '只看医院客户', '这些药品现在有多少库存'] },
  { title: '变化分析', color: '#cf1322', icon: <FallOutlined />, items: [PRESETS[1], '近12月销售趋势'] },
  { title: '库存预警', color: '#d48806', icon: <AlertOutlined />, items: [PRESETS[4], '查看30天内临期批次'] },
  { title: '简报与知识', color: '#389e0d', icon: <FileTextOutlined />, items: [PRESETS[5], PRESETS[6]] },
];

export function AiChat({ initialQuestion, pageContext, compact, onConsumed }: { initialQuestion?: { q: string; nonce: number }; pageContext?: PageContext; compact?: boolean; onConsumed?: () => void }) {
  const { scope, opportunities, tasks, authorizations, promotions } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const conv = useRef<Conversation>({});
  const endRef = useRef<HTMLDivElement>(null);

  const send = (q: string) => {
    if (!q.trim()) return;
    setInput('');
    const id = ++msgSeq;
    setMsgs(m => [...m, { id: ++msgSeq, role: 'user', text: q }, { id, role: 'ai', text: '', phase: 0 }]);
    // 显示"解析 → 查询 → 生成"阶段
    const step = (phase: number) => setMsgs(m => m.map(x => (x.id === id ? { ...x, phase } : x)));
    setTimeout(() => step(1), 250);
    setTimeout(() => step(2), 500);
    setTimeout(() => {
      let answer: AiAnswer;
      try {
        answer = ask(q, conv.current, scope, pageContext, { opportunities, tasks, authorizations, promotions });
      } catch (e) {
        answer = { text: `处理失败：${(e as Error).message}。报表与基础查询不受影响，可重试。` };
      }
      if (answer.spec) conv.current.lastSpec = answer.spec;
      if (answer.resultSkuIds) conv.current.lastSkuIds = answer.resultSkuIds;
      setMsgs(m => m.map(x => (x.id === id ? { ...x, text: answer.text, answer, phase: 3 } : x)));
    }, 750);
  };

  // 每个外部提问只处理一次（StrictMode 下 effect 会执行两次）
  const handled = useRef<number | null>(null);
  useEffect(() => { if (initialQuestion && handled.current !== initialQuestion.nonce) { handled.current = initialQuestion.nonce; send(initialQuestion.q); onConsumed?.(); } }, [initialQuestion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (msgs.length) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  return (
    <div className={`ai-chat ${compact ? 'ai-compact' : ''}`}>
      {!compact && <div className="ai-head">
        <Space size={10}>
          <span className="ai-logo"><RobotOutlined /></span>
          <div>
            <div className="ai-title">AI 经营助手</div>
            <div className="ai-sub">问数 · 变化分析 · 临期预警 · 简报与待办</div>
          </div>
        </Space>
        <Space size={6}>
          <Tooltip title="问题被解析为结构化 query_spec，由指标服务计算；权限由服务端注入。支持示例问题及其变体，不保证任意问题均可回答。">
            <Tag color="gold" bordered={false} style={{ marginInlineEnd: 0 }}>规则解析模式 · 未接入大模型</Tag>
          </Tooltip>
          {!!msgs.length && <Button size="small" type="text" icon={<ClearOutlined />} onClick={() => { setMsgs([]); conv.current = {}; }}>新对话</Button>}
        </Space>
      </div>}
      <div className="ai-msgs">
        {!msgs.length && (
          <div className="ai-welcome">
            <div className="ai-welcome-icon"><RobotOutlined /></div>
            <div className="ai-welcome-title">你好，我是 AI 经营助手</div>
            <div className="ai-welcome-sub">基于演示数据回答经营问题，所有数字来自指标服务，并附口径与查询编号</div>
            <div className={`ai-suggest ${compact ? 'one-col' : ''}`}>
              {SUGGEST.map(g => (
                <div key={g.title} className="ai-suggest-card">
                  <div className="ai-suggest-head" style={{ color: g.color }}>{g.icon}<span>{g.title}</span></div>
                  <div className="ai-suggest-items">{g.items.map(q => <div key={q} className="ai-suggest-item" onClick={() => send(q)}>{q}<RightOutlined /></div>)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} className={`ai-msg ai-${m.role}`}>
            <Avatar size={28} icon={m.role === 'user' ? <UserOutlined /> : <RobotOutlined />} style={{ background: m.role === 'user' ? '#bfbfbf' : 'linear-gradient(135deg,#1677ff,#69b1ff)', flex: 'none' }} />
            <div className="ai-bubble">
              {m.role === 'user' ? m.text : m.phase !== undefined && m.phase < 3 ? (
                <Steps size="small" current={m.phase} style={{ minWidth: 280 }} items={[{ title: '解析' }, { title: '查询' }, { title: '生成' }]} />
              ) : <AnswerView a={m.answer!} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {!!msgs.length && <div className="ai-quick">{['哪些客户有流失风险', '10月目标完成情况和缺口', ...PRESETS.slice(1, 6)].map(p => <span key={p} className="ai-chip" onClick={() => send(p)}>{p}</span>)}</div>}
      <div className="ai-composer">
        <Input.TextArea variant="borderless" value={input} onChange={e => setInput(e.target.value)} autoSize={{ minRows: compact ? 1 : 2, maxRows: 5 }} placeholder="输入经营问题，例如：10月销售下降主要在哪？" onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(input); } }} />
        <div className="ai-composer-bar">
          <span className="ai-hint">Enter 发送 · Shift+Enter 换行</span>
          <Button type="primary" shape="round" icon={<SendOutlined />} disabled={!input.trim()} onClick={() => send(input)}>发送</Button>
        </div>
      </div>
    </div>
  );
}

function AnswerView({ a }: { a: AiAnswer }) {
  const nav = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <div style={{ whiteSpace: 'pre-wrap' }}>{a.text}</div>
      {a.kpis && <div className="ai-kpis">{a.kpis.map(k => <div key={k.label} className={`ai-kpi ${k.tone ?? ''}`}><span>{k.label}</span><b>{k.value}</b>{k.note && <small>{k.note}</small>}</div>)}</div>}
      {a.observed && <Card size="small" title="已观察到的变化（数据支持）" styles={{ header: { background: '#f0f7ff' } }}><ul className="tight">{a.observed.map(o => <li key={o}>{o}</li>)}</ul></Card>}
      {a.toVerify && <Card size="small" title="待核实的解释（数据无法证明）" styles={{ header: { background: '#fffbe6' } }}><ul className="tight">{a.toVerify.map(o => <li key={o}>{o}</li>)}</ul></Card>}
      {a.chart && a.chart.length > 0 && (a.chart[0].x.match(/^\d{4}-\d{2}$/)
        ? <Line height={200} data={a.chart} xField="x" yField="y" axis={{ y: { labelFormatter: (v: number) => `${(v / 10000).toFixed(0)}万` } }} />
        : <Column height={200} data={a.chart} xField="x" yField="y" style={{ fill: (d: any) => (d.y < 0 ? '#ff7875' : '#1677ff') }} axis={{ x: { labelAutoRotate: true }, y: { labelFormatter: (v: number) => (a.chartUnit ? `${v}${a.chartUnit}` : `${(v / 10000).toFixed(1)}万`) } }} />)}
      {a.table && <Table size="small" bordered pagination={a.table.rows.length > 10 ? { pageSize: 10, size: 'small' } : false} scroll={{ x: 'max-content' }} rowKey="key" dataSource={a.table.rows} columns={a.table.columns.map(c => ({ ...c, dataIndex: c.key }))} />}
      {a.citations && a.citations.length > 0 && <List size="small" bordered dataSource={a.citations} renderItem={c => <List.Item><Space direction="vertical" size={0}><Typography.Text>{c.snippet}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>引用：《{c.title}》{c.version} · 生效 {c.date}</Typography.Text></Space></List.Item>} />}
      {(a.caliber || a.spec) && (
        <Collapse size="small" items={[
          ...(a.caliber ? [{ key: 'c', label: '口径卡', children: <ul className="tight">{a.caliber.map(c => <li key={c}>{c}</li>)}</ul> }] : []),
          ...(a.spec ? [{ key: 's', label: 'query_spec（结构化查询）', children: <pre className="spec">{JSON.stringify(a.spec, null, 2)}</pre> }] : []),
        ]} />
      )}
      {a.meta && <MetaBar meta={a.meta} />}
      <Space wrap>
        {a.links?.map(l => <Button key={l.to} size="small" onClick={() => nav(l.to)}>{l.label}</Button>)}
        {a.brief && <Button size="small" icon={<FileTextOutlined />} onClick={() => setBriefOpen(true)}>查看/编辑草稿</Button>}
        {a.taskDrafts?.map(t => <Button key={t.title} size="small" icon={<CheckSquareOutlined />} onClick={() => setDraft(t)}>任务草稿：{t.title}</Button>)}
      </Space>
      <TaskDraftModal draft={draft} onClose={() => setDraft(null)} evidenceQueryId={a.meta?.query_id} />
      {a.brief && <BriefModal open={briefOpen} onClose={() => setBriefOpen(false)} text={a.brief} />}
    </Space>
  );
}

function TaskDraftModal({ draft, onClose, evidenceQueryId }: { draft: TaskDraft | null; onClose: () => void; evidenceQueryId?: string }) {
  const { addTask } = useStore();
  const [form] = Form.useForm();
  const idemKey = useMemo(() => (draft ? `${draft.title}|${evidenceQueryId}` : ''), [draft, evidenceQueryId]);
  useEffect(() => { if (draft) form.setFieldsValue({ ...draft, due_at: dayjs(draft.due_at) }); }, [draft, form]);
  return (
    <Modal open={!!draft} title="任务草稿预览（确认后保存到任务中心）" onCancel={onClose} okText="确认保存" onOk={async () => {
      const v = await form.validateFields();
      const r = addTask({ title: v.title, object_type: draft!.object_type, object_ids: draft!.object_ids, suggestion: v.suggestion, assignee: v.assignee, due_at: v.due_at.format('YYYY-MM-DD'), evidence_query_id: evidenceQueryId, evidence_desc: draft!.evidence_desc, source: 'AI草稿确认', idemKey });
      showResult(r); onClose();
    }}>
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="suggestion" label="建议动作"><Input.TextArea rows={2} /></Form.Item>
        <Space>
          <Form.Item name="assignee" label="负责人" rules={[{ required: true }]}><Select style={{ width: 140 }} options={PEOPLE.map(p => ({ value: p }))} /></Form.Item>
          <Form.Item name="due_at" label="截止日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
        </Space>
        <Typography.Text type="secondary">对象：{draft?.object_type} {draft?.object_ids.join('、')}；证据：{draft?.evidence_desc}</Typography.Text>
      </Form>
    </Modal>
  );
}

function BriefModal({ open, onClose, text }: { open: boolean; onClose: () => void; text: string }) {
  const [v, setV] = useState(text);
  const name = (text.split('\n')[0].replace(/^#\s*/, '').replace(/（AI ?草稿）/, '').trim() || '经营简报') + '草稿';
  return (
    <Modal open={open} width={760} title={`${name}（可编辑，不会自动发送）`} onCancel={onClose} footer={[
      <Button key="d" onClick={() => downloadText(`${name}.md`, v)}>导出</Button>,
      <Button key="c" type="primary" onClick={onClose}>关闭</Button>,
    ]}>
      <Input.TextArea value={v} onChange={e => setV(e.target.value)} autoSize={{ minRows: 16, maxRows: 28 }} style={{ fontFamily: 'monospace', fontSize: 12 }} />
    </Modal>
  );
}
