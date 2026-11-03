/**
 * 查询服务：权限范围由"服务端"（此处为数据服务）根据当前身份注入，
 * 列表、合计、导出与AI共用同一 query_spec 与数据版本。
 */
import dayjs from 'dayjs';
import { batches, customers, DATA_AS_OF, flows, METRIC_VERSION, partners, skus, warehouses, owners, DEMO_DATE } from './mock';
import type { FlowRecord, Region, Role, Sku } from './types';

export const skuMap = new Map(skus.map(s => [s.sku_id, s]));
export const custMap = new Map(customers.map(c => [c.customer_id, c]));
export const whMap = new Map(warehouses.map(w => [w.warehouse_id, w]));
export const partnerMap = new Map(partners.map(p => [p.partner_id, p]));
export const ownerMap = new Map(owners.map(o => [o.owner_id, o]));

export interface PermissionScope { role: Role; regions: Region[]; warehouses: string[]; summary: string }
export function scopeFor(role: Role): PermissionScope {
  if (role === '区域业务人员') return { role, regions: ['浙江'], warehouses: ['WH1', 'WH2'], summary: '演示权限：区域业务人员 · 仅浙江地区客户、杭州主仓/宁波分仓' };
  return { role, regions: ['浙江', '江苏', '上海'], warehouses: ['WH1', 'WH2', 'WH3'], summary: '演示权限：经营负责人 · 全部地区与仓库' };
}

export function flowInScope(f: FlowRecord, s: PermissionScope) {
  if (f.customer_id) {
    const c = custMap.get(f.customer_id);
    return !!c && s.regions.includes(c.region);
  }
  return s.warehouses.includes(f.warehouse_id);
}
export const scopedFlows = (s: PermissionScope) => flows.filter(f => flowInScope(f, s));
export const scopedBatches = (s: PermissionScope) => batches.filter(b => s.warehouses.includes(b.warehouse_id));
export const scopedCustomers = (s: PermissionScope) => customers.filter(c => s.regions.includes(c.region));

let qseq = 1;
export function newQueryId() { return `Q${dayjs().format('HHmmss')}${String(qseq++).padStart(3, '0')}`; }

export interface QueryMeta {
  query_id: string;
  data_as_of: string;
  metric_version: string;
  applied_filters: Record<string, string>;
  permission_scope_summary: string;
}
export function makeMeta(s: PermissionScope, applied: Record<string, string>, dataAsOf = DATA_AS_OF): QueryMeta {
  return { query_id: newQueryId(), data_as_of: dataAsOf, metric_version: METRIC_VERSION, applied_filters: applied, permission_scope_summary: s.summary };
}

export const skuLabel = (s?: Sku) => (s ? `${s.trade_name} ${s.generic_name} ${s.spec}` : '-');
export const skuLabelById = (id: string) => skuLabel(skuMap.get(id));

/** 名称检索：名称/别名/首拼/编码 */
export function matchSku(s: Sku, kw: string) {
  if (!kw) return true;
  const k = kw.trim().toUpperCase();
  return [s.sku_id, s.source_code, s.generic_name, s.trade_name, s.pinyin, s.spec].some(v => v.toUpperCase().includes(k));
}
export function matchCustomer(id: string | null, raw: string, kw: string) {
  if (!kw) return true;
  const c = id ? custMap.get(id) : undefined;
  return [raw, c?.name ?? '', ...(c?.aliases ?? []), id ?? ''].some(v => v.includes(kw.trim()));
}

export const fmtMoney = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const fmtWan = (n: number) => `${(n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}万元`;
export const fmtPct = (n: number | null) => (n === null ? '基期≤0，不计算' : `${(n * 100).toFixed(1)}%`);
export const demoNow = () => `${DEMO_DATE} ${dayjs().format('HH:mm')}`;

/** CSV 导出（客户端生成） */
export function toCsv(rows: Record<string, unknown>[], cols: { key: string; title: string }[]) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map(c => esc(c.title)).join(','), ...rows.map(r => cols.map(c => esc(r[c.key])).join(','))].join('\n');
}
export function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
