import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Layout, Menu, Popconfirm, Select, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  DashboardOutlined, ShopOutlined, SwapOutlined, DatabaseOutlined, ScheduleOutlined, RobotOutlined, MedicineBoxOutlined,
  BarChartOutlined, BulbOutlined, BellOutlined, ReloadOutlined, UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './data/store';
import { DrillProvider } from './components/drill';
import { AiProvider, useAi } from './ai/AiPanel';
import Dashboard from './pages/Dashboard';
import Opportunities from './pages/Opportunities';
import Authorizations from './pages/Authorizations';
import Catalogue from './pages/Catalogue';
import Promotions from './pages/Promotions';
import CustomerSummary from './pages/CustomerSummary';
import FlowQuery from './pages/FlowQuery';
import Transfers from './pages/Transfers';
import SalesCompare from './pages/SalesCompare';
import Inventory from './pages/Inventory';
import TaskCenter from './pages/TaskCenter';
import AiAssistant from './pages/AiAssistant';
import Insights from './pages/Insights';
import type { Role } from './data/types';
import { buildInsights } from './ai/insights';

const { Sider, Header, Content } = Layout;

/** 14个页面入口（保留原页面编号），招商四页按用户确认顺序 */
export const PAGES: Record<string, { code: string; title: string }> = {
  '/': { code: 'P01', title: '经营工作台' },
  '/insights': { code: 'AI', title: 'AI经营洞察' },
  '/opportunities': { code: 'P03', title: '招商进度管理' },
  '/authorizations': { code: 'P13', title: '合伙人授权' },
  '/catalogue': { code: 'P02', title: '招商目录管理' },
  '/promotions': { code: 'P14', title: '合伙人推广' },
  '/customers': { code: 'P04', title: '客户汇总' },
  '/flows/purchase': { code: 'P05', title: '进货流向数据查询' },
  '/flows/sales': { code: 'P06', title: '销售流向数据查询' },
  '/transfers': { code: 'P07', title: '调拨流向' },
  '/flows/warehouse': { code: 'P08', title: '仓储流向数据查询' },
  '/sales-compare': { code: 'P09', title: '销售对比表' },
  '/inventory': { code: 'P10', title: '库存管理' },
  '/tasks': { code: 'P11', title: '任务中心' },
  '/ai': { code: 'P12', title: 'AI经营助手' },
};
const item = (path: string) => ({ key: path, label: PAGES[path].title });

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '经营工作台' },
  { key: '/insights', icon: <BulbOutlined />, label: 'AI经营洞察' },
  { key: 'bd', icon: <ShopOutlined />, label: '招商管理', children: ['/opportunities', '/authorizations', '/catalogue', '/promotions'].map(item) },
  { key: 'biz', icon: <BarChartOutlined />, label: '经营查询', children: ['/customers', '/sales-compare'].map(item) },
  { key: 'flow', icon: <SwapOutlined />, label: '流向相关', children: ['/flows/sales', '/transfers', '/flows/purchase', '/flows/warehouse'].map(item) },
  { key: '/inventory', icon: <DatabaseOutlined />, label: '库存管理' },
  { key: '/tasks', icon: <ScheduleOutlined />, label: '任务中心' },
  { key: '/ai', icon: <RobotOutlined />, label: 'AI经营助手' },
];

function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const { role, setRole, reset, user, scope, opportunities, tasks, authorizations, promotions } = useStore();
  const alerts = useMemo(() => buildInsights(scope, { opportunities, tasks, authorizations, promotions }).filter(i => i.level === '高'), [scope, opportunities, tasks, authorizations, promotions]);
  const ai = useAi();
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<string[]>(['/']);
  const path = PAGES[loc.pathname] ? loc.pathname : '/';
  useEffect(() => { setTabs(t => (t.includes(path) ? t : [...t, path])); }, [path]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={208} collapsible collapsed={collapsed} trigger={null} className="app-sider">
        <div className="logo"><span className="badge"><MedicineBoxOutlined /></span>{!collapsed && '医药招商与流向库存'}</div>
        <Menu theme="dark" mode="inline" selectedKeys={[path]} defaultOpenKeys={['bd', 'biz', 'flow']} items={menuItems} onClick={e => nav(e.key)} />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 208, transition: 'margin-left .2s' }}>
        <div className="app-top">
        <Header className="app-header">
          <Space>
            <Button size="small" type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
            <Typography.Text strong>{PAGES[path].title}</Typography.Text>
            <Tag color="gold">演示数据 · 2026-11-03</Tag>
          </Space>
          <Space size="middle">
            <Tooltip title={<div>经营异动（高优先）：<ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{alerts.map(a => <li key={a.id}>{a.title}</li>)}</ul></div>}>
              <Badge count={alerts.length} size="small" offset={[-4, 4]}><Button size="small" type="text" icon={<BellOutlined />} onClick={() => nav('/insights')}>异动</Button></Badge>
            </Tooltip>
            {path !== '/ai' && <Button size="small" type="primary" ghost icon={<RobotOutlined />} onClick={() => ai.open()}>AI 助手</Button>}
            <Tooltip title="演示权限：仅用于展示角色差异，生产版由服务端验证">
              <Space size={4}>
                <Typography.Text type="secondary">演示角色</Typography.Text>
                <Select<Role> size="small" value={role} style={{ width: 130 }} onChange={setRole} options={[{ value: '经营负责人' }, { value: '区域业务人员' }]} />
              </Space>
            </Tooltip>
            <Popconfirm title="重置演示数据？" description="招商四页与任务中心的修改将恢复初始状态" onConfirm={reset}>
              <Button size="small" icon={<ReloadOutlined />}>重置</Button>
            </Popconfirm>
            <Space size={4}><UserOutlined />{user}</Space>
          </Space>
        </Header>
        <div className="page-tabs">
          <Tabs size="small" type="editable-card" hideAdd activeKey={path} onChange={k => nav(k)}
            onEdit={(k, act) => { if (act === 'remove') { const nt = tabs.filter(t => t !== k); setTabs(nt.length ? nt : ['/']); if (k === path) nav(nt[nt.length - 1] ?? '/'); } }}
            items={tabs.map(t => ({ key: t, label: PAGES[t].title, closable: t !== '/' }))} />
        </div>
        </div>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/authorizations" element={<Authorizations />} />
            <Route path="/catalogue" element={<Catalogue />} />
            <Route path="/promotions" element={<Promotions />} />
            <Route path="/customers" element={<CustomerSummary />} />
            <Route path="/flows/purchase" element={<FlowQuery kind="purchase" key="purchase" />} />
            <Route path="/flows/sales" element={<FlowQuery kind="sales" key="sales" />} />
            <Route path="/flows/warehouse" element={<FlowQuery kind="warehouse" key="warehouse" />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/sales-compare" element={<SalesCompare />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/tasks" element={<TaskCenter />} />
            <Route path="/ai" element={<AiAssistant />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <DrillProvider>
      <AiProvider>
        <Shell />
      </AiProvider>
    </DrillProvider>
  );
}
