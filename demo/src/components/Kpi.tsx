import { Card, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

/** 指标卡：标题+定义、彩色图标、数值+单位、底部说明；active 表示当前筛选正在使用 */
export function Kpi({ icon, color, title, def, value, unit, foot, onClick, active }: { icon: React.ReactNode; color: string; title: string; def?: string; value: React.ReactNode; unit?: string; foot?: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <Card size="small" className={`kpi-card ${onClick ? 'clickable' : ''} ${active ? 'kpi-active' : ''}`} onClick={onClick} style={active ? { borderColor: color, boxShadow: `0 0 0 2px ${color}22` } : undefined}>
      <div className="kpi-top">
        <span className="kpi-title">{title}{def && <Tooltip title={def}><QuestionCircleOutlined /></Tooltip>}</span>
        <span className="kpi-icon" style={{ color, background: `${color}14` }}>{icon}</span>
      </div>
      <div className="kpi-value">{value}{unit && <small>{unit}</small>}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </Card>
  );
}
