import { useEffect, useState } from 'react';
import { Button, Checkbox, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { RobotOutlined, CheckSquareOutlined, DownOutlined, UpOutlined, CheckCircleOutlined, QuestionCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { useStore } from '../data/store';
import { useAi } from '../ai/AiPanel';
import { DEMO_DATE, PEOPLE } from '../data/mock';
import type { AiAnswer, TaskDraft } from '../ai/engine';
import { showResult } from './common';

export interface DiagKpi { label: string; value: React.ReactNode; tone?: 'down' | 'up' | 'warn' }

/** 页面内嵌的 AI 诊断面板：规则计算结果 + 待办草稿 + 深入分析入口 */
export function AiDiagPanel({ id, title, summary, kpis, drafts, ask, children, note, flat, analysis, observed }: {
  flat?: boolean; analysis?: AiAnswer; observed?: string[]; id: string; title: string; summary: React.ReactNode; kpis?: DiagKpi[]; drafts?: TaskDraft[]; ask?: string; children: React.ReactNode; note?: string;
}) {
  const ai = useAi();
  const key = `diag-open-${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* ignore */ } }, [key, open]);
  const [draftOpen, setDraftOpen] = useState(false);
  const shown = flat || open;
  return (
    <div className={`diag ${shown ? '' : 'diag-closed'} ${flat ? 'diag-flat' : ''}`}>
      <div className="diag-head">
        <span className="ai-logo diag-logo"><RobotOutlined /></span>
        <div className="diag-title">
          <div><b>{title}</b><Tooltip title="规则引擎基于指标层计算，未接入大模型；建议仅为排查方向，原因需核实"><Tag color="gold" bordered={false}>规则解析模式</Tag></Tooltip></div>
          <div className="diag-summary">{summary}</div>
        </div>
        {kpis && <div className="diag-kpis">{kpis.map(k => <div key={k.label} className={`diag-kpi ${k.tone ?? ''}`}><b>{k.value}</b><span>{k.label}</span></div>)}</div>}
        <Space size={6} className="diag-actions">
          {!!drafts?.length && <Button size="small" icon={<CheckSquareOutlined />} onClick={() => setDraftOpen(true)}>生成待办（{drafts.length}）</Button>}
          {ask && !analysis && <Button size="small" type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open(ask)}>深入分析</Button>}
          {!flat && <Button size="small" type="text" onClick={() => setOpen(!open)}>{open ? <>收起 <UpOutlined /></> : <>展开 <DownOutlined /></>}</Button>}
        </Space>
      </div>
      {shown && <div className="diag-body">{children}{analysis && <DiagAnalysis a={analysis} observed={observed} ask={ask} />}{note && <div className="diag-note">{note}</div>}</div>}
      {drafts && <DraftTasksModal open={draftOpen} drafts={drafts} onClose={() => setDraftOpen(false)} />}
    </div>
  );
}

/** AI 分析结论直接展示：结论 / 数据观察 / 待核实 / 口径，可继续追问 */
function DiagAnalysis({ a, observed, ask }: { a: AiAnswer; observed?: string[]; ask?: string }) {
  const ai = useAi();
  const [cal, setCal] = useState(false);
  const obs = observed ?? a.observed ?? [];
  return (
    <div className="diag-ana">
      <div className="diag-ana-head"><RobotOutlined /> AI 分析<span className="diag-ana-text">{a.text}</span></div>
      <div className="diag-ana-cols">
        {!!obs.length && <div>
          <div className="diag-ana-sub ok"><CheckCircleOutlined /> 数据观察</div>
          <ul>{obs.map(t => <li key={t}>{t}</li>)}</ul>
        </div>}
        {!!a.toVerify?.length && <div>
          <div className="diag-ana-sub verify"><QuestionCircleOutlined /> 待核实（非数据结论）</div>
          <ul>{a.toVerify.map(t => <li key={t}>{t}</li>)}</ul>
        </div>}
      </div>
      <div className="diag-ana-foot">
        <a onClick={() => setCal(!cal)}>{cal ? '收起口径' : '查看口径'} {cal ? <UpOutlined /> : <DownOutlined />}</a>
        {a.meta && <span>查询编号 {a.meta.query_id} · 数据截止 {a.meta.data_as_of} · 口径 {a.meta.metric_version}</span>}
        <a style={{ marginLeft: 'auto' }} onClick={() => ai.open(ask)}><MessageOutlined /> 在 AI 助手中继续追问</a>
      </div>
      {cal && a.caliber && <ul className="diag-ana-cal">{a.caliber.map(t => <li key={t}>{t}</li>)}</ul>}
    </div>
  );
}

/** 批量任务草稿预览：勾选、改负责人后确认保存；同一草稿当天重复保存忽略 */
export function DraftTasksModal({ open, drafts, onClose }: { open: boolean; drafts: TaskDraft[]; onClose: () => void }) {
  const { addTask } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [who, setWho] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setPicked(drafts.map(d => d.title)); setWho({}); } }, [open, drafts]);
  const save = () => {
    let ok = 0, dup = 0;
    drafts.filter(d => picked.includes(d.title)).forEach(d => {
      const r = addTask({ title: d.title, object_type: d.object_type, object_ids: d.object_ids, suggestion: d.suggestion, assignee: who[d.title] ?? d.assignee, due_at: d.due_at, evidence_desc: d.evidence_desc, source: 'AI草稿确认', idemKey: `${d.title}|${DEMO_DATE}` });
      if (r.ok) ok++; else dup++;
    });
    showResult({ ok: true, msg: `已保存 ${ok} 条待办${dup ? `，${dup} 条此前已保存已忽略` : ''}` });
    onClose();
  };
  return (
    <Modal open={open} width={760} title="任务草稿预览（确认后保存到任务中心）" okText={`确认保存 ${picked.length} 条`} okButtonProps={{ disabled: !picked.length }} onOk={save} onCancel={onClose}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>草稿由 AI 规则生成，不会自动发送、指派或变更业务状态；保存后可在任务中心修改。</Typography.Paragraph>
      <div className="remind-list">
        {drafts.map(d => (
          <div key={d.title} className="remind-item" style={{ alignItems: 'flex-start' }}>
            <Checkbox checked={picked.includes(d.title)} onChange={e => setPicked(p => (e.target.checked ? [...p, d.title] : p.filter(x => x !== d.title)))} style={{ marginTop: 2 }} />
            <div className="remind-title"><div>{d.title}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{d.suggestion}</Typography.Text></div>
            <Select size="small" style={{ width: 90 }} value={who[d.title] ?? d.assignee} onChange={v => setWho(w => ({ ...w, [d.title]: v }))} options={PEOPLE.map(p => ({ value: p }))} />
            <span className="remind-due">截止 {d.due_at.slice(5)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
