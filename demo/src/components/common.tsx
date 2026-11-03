import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Dropdown, Empty, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DownloadOutlined, ExclamationCircleOutlined,
  InfoCircleOutlined, MinusCircleOutlined, PauseCircleOutlined, QuestionCircleOutlined, SyncOutlined, WarningOutlined, EditOutlined,
} from '@ant-design/icons';
import { downloadCsv, toCsv, type QueryMeta } from '../data/query';
import { useStore } from '../data/store';

const { Text } = Typography;

/** 状态同时使用文字与图标，避免只凭颜色区分 */
const STATUS: Record<string, { color: string; icon: React.ReactNode }> = {
  生效中: { color: 'success', icon: <CheckCircleOutlined /> }, 已通过: { color: 'success', icon: <CheckCircleOutlined /> },
  招商中: { color: 'processing', icon: <SyncOutlined /> }, 执行中: { color: 'processing', icon: <SyncOutlined /> }, 处理中: { color: 'processing', icon: <SyncOutlined /> },
  正常: { color: 'success', icon: <CheckCircleOutlined /> }, 合格: { color: 'success', icon: <CheckCircleOutlined /> }, 成功: { color: 'success', icon: <CheckCircleOutlined /> }, 已完成: { color: 'success', icon: <CheckCircleOutlined /> },
  合作确认: { color: 'success', icon: <CheckCircleOutlined /> }, 合作中: { color: 'success', icon: <CheckCircleOutlined /> },
  临期: { color: 'warning', icon: <WarningOutlined /> }, 待确认: { color: 'warning', icon: <ClockCircleOutlined /> }, 待执行: { color: 'warning', icon: <ClockCircleOutlined /> }, 待处理: { color: 'warning', icon: <ClockCircleOutlined /> }, 待验: { color: 'warning', icon: <ClockCircleOutlined /> }, 排队: { color: 'warning', icon: <ClockCircleOutlined /> },
  未生效: { color: 'default', icon: <MinusCircleOutlined /> }, 草稿: { color: 'default', icon: <EditOutlined /> }, 已撤回: { color: 'default', icon: <MinusCircleOutlined /> }, 潜在: { color: 'default', icon: <MinusCircleOutlined /> },
  已暂停: { color: 'orange', icon: <PauseCircleOutlined /> }, 暂停招商: { color: 'orange', icon: <PauseCircleOutlined /> }, 冻结: { color: 'orange', icon: <PauseCircleOutlined /> },
  已过期: { color: 'error', icon: <CloseCircleOutlined /> }, 已到期: { color: 'error', icon: <CloseCircleOutlined /> }, 已终止: { color: 'error', icon: <CloseCircleOutlined /> }, 已退回: { color: 'error', icon: <ExclamationCircleOutlined /> }, 失败: { color: 'error', icon: <CloseCircleOutlined /> }, 关闭未达成: { color: 'error', icon: <CloseCircleOutlined /> }, 已取消: { color: 'default', icon: <CloseCircleOutlined /> },
  未知: { color: 'default', icon: <QuestionCircleOutlined /> },
};
export function StatusTag({ value }: { value: string }) {
  const s = STATUS[value] ?? { color: 'blue', icon: <InfoCircleOutlined /> };
  return <Tag color={s.color} icon={s.icon}>{value}</Tag>;
}

/** 查询元信息：生效条件、数据截止时间、指标版本、权限范围、查询编号 */
export function MetaBar({ meta, extra }: { meta?: QueryMeta | null; extra?: React.ReactNode }) {
  if (!meta) return null;
  const entries = Object.entries(meta.applied_filters).filter(([, v]) => v);
  return (
    <div className="meta-bar">
      <Space size={[6, 6]} wrap>
        <Text type="secondary">已生效条件：</Text>
        {entries.length ? entries.map(([k, v]) => <Tag key={k} bordered={false} color="blue">{k}：{v}</Tag>) : <Text type="secondary">无</Text>}
      </Space>
      <Space size={12} wrap className="meta-right">
        <Text type="secondary">数据截止 {meta.data_as_of}</Text>
        <Text type="secondary">口径 {meta.metric_version}</Text>
        <Tooltip title={meta.permission_scope_summary}><Tag icon={<InfoCircleOutlined />} bordered={false}>{meta.permission_scope_summary.split('·')[0].replace('演示权限：', '')}</Tag></Tooltip>
        <Text type="secondary" copyable={{ text: meta.query_id }}>查询编号 {meta.query_id}</Text>
        {extra}
      </Space>
    </div>
  );
}

export function NotQueried({ hint, quick }: { hint?: string; quick?: { label: string; onClick: () => void }[] }) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>{hint ?? '请设置条件后点击"搜索"。未查询不代表没有业务数据。'}</span>}>
      {quick && <Space wrap>{quick.map(q => <Button key={q.label} size="small" onClick={q.onClick}>{q.label}</Button>)}</Space>}
    </Empty>
  );
}

export interface ExportCol { key: string; title: string }

/**
 * 结果表格：本页选择与"选择全部查询结果"区分；导出所选与导出全部区分；导出创建任务中心记录。
 */
export function ResultTable<T extends Record<string, any>>(props: {
  rowKey: string;
  columns: TableProps<T>['columns'];
  data: T[];
  meta?: QueryMeta | null;
  exportName: string;
  exportCols: ExportCol[];
  exportRow?: (r: T) => Record<string, unknown>;
  summary?: React.ReactNode;
  scroll?: TableProps<T>['scroll'];
  onRow?: TableProps<T>['onRow'];
  selectable?: boolean;
  noPermissionHint?: boolean;
  tableProps?: Partial<TableProps<T>>;
  toolbar?: React.ReactNode;
}) {
  const { addJob, scope } = useStore();
  const [page, setPage] = useState({ current: 1, pageSize: 20 });
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [allResults, setAllResults] = useState(false);
  const total = props.data.length;
  useEffect(() => { setPage(p => ({ ...p, current: 1 })); setSelected([]); setAllResults(false); }, [props.meta?.query_id]); // 搜索后回到第一页

  const doExport = (mode: 'selected' | 'all') => {
    const rows = mode === 'all' || allResults ? props.data : props.data.filter(r => selected.includes(r[props.rowKey]));
    if (!rows.length) { message.warning('请先选择记录'); return; }
    const csv = toCsv(rows.map(r => (props.exportRow ? props.exportRow(r) : r)), props.exportCols);
    const name = `${props.exportName}_${props.meta?.query_id ?? ''}`;
    addJob({ kind: '导出', name: `${props.exportName} 导出（${mode === 'all' || allResults ? '全部查询结果' : '所选记录'}）`, status: '成功', rows: rows.length, scope: scope.summary, csv });
    downloadCsv(name, csv);
    message.success(`已导出 ${rows.length} 条（${scope.summary}），可在任务中心查看`);
  };

  const selCount = allResults ? total : selected.length;
  return (
    <div>
      <div className="table-toolbar">
        <Space wrap>
          {props.selectable !== false && (
            <Text type="secondary">
              {allResults ? <>已选择全部查询结果 <b>{total}</b> 条</> : <>本页已选 <b>{selected.length}</b> 条</>}
              {!allResults && total > 0 && <Button type="link" size="small" onClick={() => setAllResults(true)}>选择全部查询结果（{total}条）</Button>}
              {allResults && <Button type="link" size="small" onClick={() => { setAllResults(false); setSelected([]); }}>取消全选</Button>}
            </Text>
          )}
          {props.toolbar}
        </Space>
        <Dropdown.Button
          icon={<DownloadOutlined />}
          disabled={!props.meta}
          onClick={() => doExport('all')}
          menu={{ items: [{ key: 's', label: `导出所选（${selCount}条）`, disabled: !selCount }], onClick: () => doExport('selected') }}
        >导出全部结果（{total}条）</Dropdown.Button>
      </div>
      <Table<T>
        size="small"
        bordered
        rowKey={props.rowKey}
        columns={props.columns}
        dataSource={props.data}
        scroll={props.scroll ?? { x: 'max-content' }}
        onRow={props.onRow}
        rowSelection={props.selectable === false ? undefined : {
          selectedRowKeys: allResults ? props.data.map(r => r[props.rowKey]) : selected,
          onChange: keys => { setAllResults(false); setSelected(keys); },
          selections: false,
        }}
        locale={{ emptyText: <Empty description={props.noPermissionHint ? '当前权限范围内无数据（可能因权限限制，不代表业务不存在）' : '当前条件下查无记录，请调整条件'} /> }}
        pagination={{ ...page, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: t => `共 ${t} 条`, onChange: (current, pageSize) => setPage({ current, pageSize }) }}
        {...props.tableProps}
      />
      {props.summary && <Card size="small" className="summary-card">{props.summary}</Card>}
    </div>
  );
}

export function DemoDataNotice() {
  return <Alert type="info" showIcon banner message="演示数据 · 固定演示日期 2026-11-03 · 字段与规则为建议设计，待客户确认" />;
}

export function PageTitle({ title, extra }: { title: string; desc?: string; extra?: React.ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
      </div>
      <Space wrap>{extra}</Space>
    </div>
  );
}

export function Definition({ label, def }: { label: React.ReactNode; def: string }) {
  return <Space size={4}>{label}<Tooltip title={def}><QuestionCircleOutlined style={{ color: '#8c8c8c' }} /></Tooltip></Space>;
}

export function showResult(r: { ok: boolean; msg: string; warnings?: string[] }) {
  if (r.ok) {
    message.success(r.msg);
    r.warnings?.forEach(w => message.warning(w, 5));
  } else {
    message.error({ content: <div><div>{r.msg}</div>{r.warnings?.map(w => <div key={w} style={{ fontSize: 12 }}>· {w}</div>)}</div>, duration: 5 });
  }
  return r.ok;
}

/** 详情抽屉标题：名称一行，编号与状态一行，避免与操作按钮挤压 */
export function DrawerTitle({ id, name, tags, sub }: { id: string; name?: React.ReactNode; tags?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="drawer-title">
      <div className="drawer-title-name">{name ?? id}</div>
      <div className="drawer-title-sub"><span className="drawer-id">{id}</span>{tags}{sub && <span>{sub}</span>}</div>
    </div>
  );
}
