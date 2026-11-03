// 核心实体，对应设计文档第5章。所有ID稳定，状态各自维护。

export type Region = '浙江' | '江苏' | '上海';
export type CustomerType = '医院' | '药店' | '商业公司';
export type Unit = '盒' | '瓶' | '支';

export interface Sku {
  sku_id: string;
  source_code: string;
  generic_name: string; // 通用名
  trade_name: string; // 商品名
  spec: string; // 规格
  dosage_form: string; // 剂型
  manufacturer: string;
  unit: Unit; // 基础单位
  /** 转换规则：1 基础单位 = n 最小单位；null 表示缺失（边界案例） */
  conversion: { minUnit: string; factor: number } | null;
  pinyin: string; // 首拼
  list_price: number; // 演示单价（元/基础单位，未税）
}

export interface Customer {
  customer_id: string;
  name: string;
  aliases: string[];
  region: Region;
  city: string;
  type: CustomerType;
  org: string; // 组织归属
}

export type FlowType = '进货' | '销售' | '销售退货' | '调拨出库' | '调拨入库' | '仓储入库' | '仓储出库';

export interface FlowRecord {
  source_id: string; // 来源系统
  source_line_id: string; // 来源明细ID
  event_id: string; // 业务事件ID（同一事件的不同视图）
  doc_no: string; // 单据号
  type: FlowType;
  biz_date: string; // 业务日期 YYYY-MM-DD
  import_date: string; // 导入日期
  acquire_mode: '接口' | '文件导入' | '手工';
  sku_id: string;
  customer_id: string | null; // 调拨/仓储可能无客户
  raw_customer_name: string; // 原始客户名称
  warehouse_id: string;
  counter_warehouse_id?: string; // 调拨对方仓
  batch_no: string;
  expiry_date: string | null;
  /** 带符号数量：销售/入库为正，退货为负 */
  qty: number;
  unit_price: number;
  /** 带符号金额（元，未税） */
  amount: number;
}

export interface Warehouse {
  warehouse_id: string;
  name: string;
  region: Region;
  /** 快照时点；故意不一致以演示"快照时点不同" */
  snapshot_at: string;
}

export type StockStatus = '合格' | '冻结' | '待验';

export interface BatchStock {
  snapshot_at: string;
  owner_id: string;
  warehouse_id: string;
  sku_id: string;
  batch_no: string;
  expiry_date: string | null; // null = 未知效期
  status: StockStatus;
  /** 当前库存（快照数量） */
  qty: number;
  /** 原系统"有效库存"字段原值，定义待确认，不做推导 */
  effective_qty_src: number | null;
  reserved_qty: number;
}

// —— 招商四页 ——
export type CatalogueStatus = '草稿' | '招商中' | '暂停招商' | '已终止';

export interface MaterialVersion {
  doc_id: string;
  name: string;
  version: string;
  effective_date: string;
  visibility: '内部' | '合作方可见';
}

export interface CatalogueItem {
  catalogue_id: string;
  name: string;
  sku_ids: string[];
  status: CatalogueStatus;
  regions: Region[];
  channels: string[];
  owner: string;
  supply_note: string;
  policy_ref: string; // 价格政策引用（示例）
  materials: MaterialVersion[];
  updated_at: string;
  history: AuditEntry[];
}

export interface AuditEntry {
  at: string;
  by: string;
  action: string;
  detail?: string;
}

export type OppStage = '线索登记' | '需求沟通' | '资料确认' | '合作洽谈' | '合作确认' | '关闭未达成';
export const OPP_STAGES: OppStage[] = ['线索登记', '需求沟通', '资料确认', '合作洽谈', '合作确认', '关闭未达成'];

export interface Partner {
  partner_id: string;
  name: string;
  kind: '企业' | '个人工作室' | '商业公司';
  contact: string;
  owner: string;
  status: '合作中' | '潜在' | '停用';
}

export interface Followup {
  followup_id: string;
  at: string;
  method: string;
  target: string;
  content: string;
  feedback: string;
  next_action: string;
  next_date?: string;
  by: string;
  revisions?: { at: string; by: string; before: string }[];
}

export interface StageChange {
  at: string;
  by: string;
  from: OppStage | null;
  to: OppStage;
  reason: string;
}

export interface Opportunity {
  opportunity_id: string;
  name: string;
  catalogue_id: string;
  partner_id: string | null;
  prospect_name: string | null; // 未建档线索
  region: Region;
  channel: string;
  owner: string;
  stage: OppStage;
  source: string;
  need: string;
  expected_date?: string;
  next_action: string;
  next_date?: string;
  created_at: string;
  confirmed_at?: string;
  close_reason?: string;
  followups: Followup[];
  stage_changes: StageChange[];
  version: number;
}

export type AuthReview = '草稿' | '待确认' | '已通过' | '已退回' | '已撤回';
export type AuthBiz = '未生效' | '生效中' | '已暂停' | '已到期' | '已终止';

export interface ScopeItem {
  catalogue_id: string;
  sku_ids: string[]; // 明确SKU集合，后续新增SKU不自动扩大
  regions: Region[] | 'ALL' | null; // null = 未填
  channels: string[] | 'ALL' | null;
  customers: { mode: 'ALL_MATCHING' } | { mode: 'LIST'; ids: string[] } | null;
}

export interface AuthVersion {
  version: number;
  scope_items: ScopeItem[];
  valid_from: string;
  valid_to: string;
  review: AuthReview;
  basis: string;
  created_at: string;
  created_by: string;
  change_note: string;
}

export interface Authorization {
  authorization_id: string;
  partner_id: string;
  opportunity_id?: string;
  owner: string;
  /** 现行版本号（已通过）；草稿/待确认的变更在 versions 中另存，不覆盖 */
  current_version: number;
  versions: AuthVersion[];
  suspended: boolean;
  terminated: boolean;
  terminate_reason?: string;
  attachments: string[];
  history: AuditEntry[];
  updated_at: string;
}

export type PromoStatus = '草稿' | '待执行' | '执行中' | '已暂停' | '已完成' | '已取消';

export interface PromoActivity {
  activity_id: string;
  at: string;
  customer_id: string | null;
  lead_name?: string;
  method: '业务拜访' | '电话沟通' | '资料介绍' | '学术会议';
  content: string;
  feedback: string;
  material_version?: string;
  next_action?: string;
  next_date?: string;
  by: string;
  backfilled?: boolean; // 历史补录
  revisions?: { at: string; by: string; before: string }[];
}

export interface Promotion {
  promotion_id: string;
  name: string;
  partner_id: string;
  catalogue_id: string;
  authorization_id: string;
  authorization_version: number;
  region: Region;
  channel: string;
  start: string;
  end: string;
  owner: string;
  goal: string;
  status: PromoStatus;
  target_customer_ids: string[];
  leads: string[];
  opportunity_ids: string[];
  activities: PromoActivity[];
  history: AuditEntry[];
  version: number;
}

export type TaskStatus = '待处理' | '处理中' | '已完成' | '已取消';

export interface Task {
  task_id: string;
  title: string;
  kind: '业务待办';
  object_type: string;
  object_ids: string[];
  suggestion: string;
  assignee: string;
  due_at: string;
  status: TaskStatus;
  evidence_query_id?: string;
  evidence_desc?: string;
  created_at: string;
  source: '手工' | 'AI草稿确认' | '招商跟进' | '推广计划';
}

export interface JobRecord {
  job_id: string;
  kind: '导出' | '导入';
  name: string;
  status: '排队' | '处理中' | '成功' | '失败';
  rows: number;
  created_at: string;
  scope: string;
  error?: string;
  csv?: string;
}

export interface KnowledgeDoc {
  doc_id: string;
  title: string;
  version: string;
  effective_date: string;
  status: '有效' | '已失效';
  catalogue_id?: string;
  snippets: string[];
}

export type Role = '经营负责人' | '区域业务人员';
