import { useState } from 'react';
import { Alert, Badge, Button, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { DEMO_DATE, PEOPLE } from '../data/mock';
import { downloadCsv } from '../data/query';
import type { Task } from '../data/types';
import { useStore } from '../data/store';
import { PageTitle, StatusTag, showResult } from '../components/common';

const objLink = (t: Task) => {
  const id = t.object_ids[0];
  if (!id) return null;
  if (id.startsWith('OPP')) return `/opportunities?id=${id}`;
  if (id.startsWith('AUTH')) return `/authorizations?id=${id}`;
  if (id.startsWith('PRM')) return `/promotions?id=${id}`;
  if (id.startsWith('SKU')) return `/inventory?tab=batch&sku=${id}`;
  if (id.startsWith('B')) return `/inventory?tab=batch&window=90`;
  if (id.startsWith('C')) return `/customers`;
  return null;
};

export default function TaskCenter() {
  const st = useStore();
  const nav = useNavigate();
  const [status, setStatus] = useState<string | undefined>();
  const [assignee, setAssignee] = useState<string | undefined>();
  const [overdue, setOverdue] = useState(false);
  const tasks = st.tasks.filter(t => (!status || t.status === status) && (!assignee || t.assignee === assignee) && (!overdue || (t.due_at < DEMO_DATE && ['待处理', '处理中'].includes(t.status))));
  const pending = st.tasks.filter(t => ['待处理', '处理中'].includes(t.status)).length;
  return (
    <div>
      <PageTitle title="任务中心" />
      <div className="panel">
        <Tabs items={[
          { key: 'biz', label: <Badge count={pending} size="small" offset={[8, 0]}>业务待办</Badge>, children: (
            <>
              <Space wrap style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="状态" style={{ width: 110 }} value={status} onChange={setStatus} options={['待处理', '处理中', '已完成', '已取消'].map(v => ({ value: v }))} />
                <Select allowClear placeholder="负责人" style={{ width: 110 }} value={assignee} onChange={setAssignee} options={PEOPLE.map(v => ({ value: v }))} />
                <Button type={overdue ? 'primary' : 'default'} onClick={() => setOverdue(!overdue)}>仅逾期</Button>
              </Space>
              <Table size="small" bordered rowKey="task_id" dataSource={tasks} pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 'max-content' }} columns={[
                { title: '编号', dataIndex: 'task_id' }, { title: '标题', dataIndex: 'title' },
                { title: '对象', render: (_, t) => { const l = objLink(t); return <Space size={2}><Tag>{t.object_type}</Tag>{l ? <a onClick={() => nav(l)}>{t.object_ids.join('、')}</a> : t.object_ids.join('、')}</Space>; } },
                { title: '建议动作', dataIndex: 'suggestion' }, { title: '负责人', dataIndex: 'assignee' },
                { title: '截止', render: (_, t) => <span className={t.due_at < DEMO_DATE && ['待处理', '处理中'].includes(t.status) ? 'text-down' : ''}>{t.due_at}{t.due_at < DEMO_DATE && ['待处理', '处理中'].includes(t.status) && ' 逾期'}</span> },
                { title: '状态', render: (_, t) => <StatusTag value={t.status} /> }, { title: '来源', dataIndex: 'source' },
                { title: '依据', render: (_, t) => (t.evidence_query_id || t.evidence_desc ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.evidence_query_id && `查询 ${t.evidence_query_id} · `}{t.evidence_desc}</Typography.Text> : '—') },
                { title: '创建', dataIndex: 'created_at' },
                { title: '操作', fixed: 'right', render: (_, t) => <Space size={4}>
                  {t.status === '待处理' && <Button size="small" onClick={() => showResult(st.setTaskStatus(t.task_id, '处理中'))}>开始</Button>}
                  {['待处理', '处理中'].includes(t.status) && <Button size="small" type="primary" onClick={() => showResult(st.setTaskStatus(t.task_id, '已完成'))}>完成</Button>}
                  {['待处理', '处理中'].includes(t.status) && <Button size="small" danger onClick={() => showResult(st.setTaskStatus(t.task_id, '已取消'))}>取消</Button>}
                </Space> },
              ]} />
            </>) },
          { key: 'jobs', label: '导入导出任务', children: (
            <>
              <Alert style={{ marginBottom: 8 }} type="info" showIcon message="导出任务显示排队、处理中、成功、失败；成功可下载文件，失败说明原因。演示数据在浏览器内生成。" action={<Button disabled icon={<UploadOutlined />}>样例流向文件导入复核 <Tag style={{ marginLeft: 6 }}>P1</Tag></Button>} />
              <Table size="small" bordered rowKey="job_id" dataSource={st.jobs} pagination={{ pageSize: 20 }} columns={[
                { title: '编号', dataIndex: 'job_id' }, { title: '类型', dataIndex: 'kind', render: k => <Tag>{k}</Tag> }, { title: '名称', dataIndex: 'name' },
                { title: '状态', render: (_, j) => <StatusTag value={j.status} /> }, { title: '行数', dataIndex: 'rows', align: 'right' }, { title: '权限范围', dataIndex: 'scope' },
                { title: '创建时间', dataIndex: 'created_at' }, { title: '说明', dataIndex: 'error', render: e => e ?? '—' },
                { title: '操作', render: (_, j) => j.csv ? <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadCsv(j.name, j.csv!)}>下载</Button> : j.status === '失败' ? <Typography.Text type="secondary">请缩小条件后在原页面重新导出</Typography.Text> : null },
              ]} />
            </>) },
        ]} />
      </div>
    </div>
  );
}
