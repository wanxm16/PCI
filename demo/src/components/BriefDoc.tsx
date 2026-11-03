import { useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Input, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import { DownloadOutlined, EditOutlined, EyeOutlined, FileWordOutlined, FileMarkdownOutlined, PrinterOutlined, UndoOutlined } from '@ant-design/icons';
import { downloadText } from '../data/query';

/** 简报草稿的轻量 Markdown（# / ## / - / 1. / 缩进子项 / 正文）渲染 */
type Line = { kind: 'h1' | 'h2' | 'li' | 'li2' | 'ol' | 'p' | 'blank'; text: string; n?: string };
function parse(md: string): Line[] {
  return md.split('\n').map(l => {
    if (/^#\s/.test(l)) return { kind: 'h1', text: l.replace(/^#\s*/, '') };
    if (/^##\s/.test(l)) return { kind: 'h2', text: l.replace(/^##\s*/, '') };
    if (/^\s{2,}-\s/.test(l)) return { kind: 'li2', text: l.replace(/^\s*-\s*/, '') };
    if (/^-\s/.test(l)) return { kind: 'li', text: l.replace(/^-\s*/, '') };
    const m = l.match(/^(\d+)\.\s*(.*)$/); if (m) return { kind: 'ol', n: m[1], text: m[2] };
    return l.trim() ? { kind: 'p', text: l } : { kind: 'blank', text: '' };
  });
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function briefToHtml(md: string, title: string) {
  const body = parse(md).map(l => {
    switch (l.kind) {
      case 'h1': return `<h1>${esc(l.text)}</h1>`;
      case 'h2': return `<h2>${esc(l.text)}</h2>`;
      case 'li': return `<p class="li">• ${esc(l.text)}</p>`;
      case 'li2': return `<p class="li2">– ${esc(l.text)}</p>`;
      case 'ol': return `<p class="li">${l.n}. ${esc(l.text)}</p>`;
      case 'p': return `<p>${esc(l.text)}</p>`;
      default: return '';
    }
  }).join('\n');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:11pt;line-height:1.6;color:#222}h1{font-size:18pt;color:#1f3a8a;border-bottom:2px solid #1f3a8a;padding-bottom:4pt}h2{font-size:13pt;color:#1f3a8a;margin-top:14pt}p{margin:3pt 0}.li{margin-left:14pt}.li2{margin-left:30pt;color:#444}.foot{margin-top:18pt;font-size:9pt;color:#888}</style></head>
<body>${body}<p class="foot">演示数据 · 本文件为 AI 规则生成的草稿，未经确认不得对外发送。</p></body></html>`;
}

export interface BriefOption { key: string; label: string; text: string; note?: string }

/** 简报文档预览：可切换类型、在线编辑、下载 Word / Markdown、打印 */
export function BriefDoc({ options, extra }: { options: BriefOption[]; extra?: React.ReactNode }) {
  const [key, setKey] = useState(options[0].key);
  const cur = options.find(o => o.key === key) ?? options[0];
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [key]);
  const text = edits[key] ?? cur.text;
  const lines = useMemo(() => parse(text), [text]);
  const title = (text.split('\n')[0].replace(/^#\s*/, '').replace(/（AI ?草稿）|（草稿）/, '').trim() || cur.label);
  const file = `${title}_2026-11-03`;
  const dl = (fmt: 'doc' | 'md') => (fmt === 'md'
    ? downloadText(`${file}.md`, text)
    : (() => { const blob = new Blob(['﻿', briefToHtml(text, title)], { type: 'application/msword' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${file}.doc`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); })());
  const print = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(briefToHtml(text, title)); w.document.close(); w.focus(); w.print(); };

  return (
    <div className="brief-wrap">
      <div className="brief-bar">
        <Segmented value={key} onChange={v => setKey(v as string)} options={options.map(o => ({ value: o.key, label: o.label }))} />
        {edits[key] !== undefined && <Tag color="blue" bordered={false}>已编辑</Tag>}
        <span style={{ flex: 1 }} />
        <Space size={8}>
          {extra}
          {edits[key] !== undefined && <Tooltip title="放弃编辑，恢复为 AI 生成内容"><Button icon={<UndoOutlined />} onClick={() => setEdits(e => { const n = { ...e }; delete n[key]; return n; })}>恢复</Button></Tooltip>}
          <Button icon={editing ? <EyeOutlined /> : <EditOutlined />} onClick={() => setEditing(!editing)}>{editing ? '预览' : '编辑'}</Button>
          <Button icon={<PrinterOutlined />} onClick={print}>打印 / PDF</Button>
          <Dropdown menu={{ items: [{ key: 'doc', icon: <FileWordOutlined />, label: 'Word 文档（.doc）' }, { key: 'md', icon: <FileMarkdownOutlined />, label: 'Markdown（.md）' }], onClick: e => dl(e.key as 'doc' | 'md') }}>
            <Button type="primary" icon={<DownloadOutlined />}>下载简报</Button>
          </Dropdown>
        </Space>
      </div>
      {cur.note && <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 10px' }}>{cur.note}</Typography.Paragraph>}
      {editing ? (
        <Input.TextArea value={text} onChange={e => setEdits(x => ({ ...x, [key]: e.target.value }))} autoSize={{ minRows: 22 }} className="brief-editor" />
      ) : (
        <div className="brief-paper">
          <div className="brief-draft-mark">AI 草稿 · 未发送</div>
          {lines.map((l, i) => {
            switch (l.kind) {
              case 'h1': return <h1 key={i}>{l.text}</h1>;
              case 'h2': return <h2 key={i}>{l.text}</h2>;
              case 'li': return <div key={i} className="b-li">{l.text}</div>;
              case 'li2': return <div key={i} className="b-li2">{l.text}</div>;
              case 'ol': return <div key={i} className="b-ol"><b>{l.n}</b>{l.text}</div>;
              case 'p': return <p key={i} className={/^数据来源/.test(l.text) ? 'b-src' : /^(统计范围|会议日期)/.test(l.text) ? 'b-sub' : ''}>{l.text}</p>;
              default: return null;
            }
          })}
        </div>
      )}
    </div>
  );
}
