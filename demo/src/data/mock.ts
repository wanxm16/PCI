/**
 * 一套关联的演示数据（设计文档第8章）。
 * 固定演示日期 2026-11-03；历史 2025-09 ~ 2026-10；库存为固定快照。
 * 使用固定随机种子，每次生成结果一致。所有名称均为虚构演示数据。
 */
import dayjs from 'dayjs';
import type {
  Authorization, BatchStock, CatalogueItem, Customer, CustomerType, FlowRecord, KnowledgeDoc,
  Opportunity, Partner, Promotion, Region, Sku, Task, Unit, Warehouse, JobRecord,
} from './types';

export const DEMO_DATE = '2026-11-03';
export const DATA_AS_OF = '2026-11-03 08:00';
export const METRIC_VERSION = 'demo_v1';

// —— 确定性随机 ——
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261103);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

// —— 药品SKU：30个，含3组同名不同规格/厂家，单位含盒/瓶/支 ——
const MFR = ['华东示例制药', '江南仿真药业', '浦江演示制药', '钱塘样例生物', '金陵示范药业', '东海模拟制药'];
type SkuSeed = [string, string, string, string, number, Unit, number, string];
// 通用名, 商品名, 规格, 剂型, 厂家idx, 单位, 单价, 首拼
const SKU_SEEDS: SkuSeed[] = [
  ['阿莫西林胶囊', '安莫灵', '0.25g×24粒', '胶囊剂', 0, '盒', 18.5, 'AMXLJN'],
  ['阿莫西林胶囊', '安莫灵', '0.5g×24粒', '胶囊剂', 0, '盒', 32.0, 'AMXLJN'],
  ['阿莫西林胶囊', '康莫欣', '0.25g×24粒', '胶囊剂', 1, '盒', 16.8, 'AMXLJN'],
  ['盐酸二甲双胍片', '糖舒平', '0.5g×20片', '片剂', 2, '盒', 12.6, 'YSEJSGP'],
  ['盐酸二甲双胍片', '糖舒平', '0.85g×30片', '片剂', 2, '盒', 24.0, 'YSEJSGP'],
  ['头孢克肟颗粒', '克益', '50mg×6袋', '颗粒剂', 3, '盒', 29.9, 'TBKWKL'],
  ['头孢克肟颗粒', '肟康', '50mg×6袋', '颗粒剂', 4, '盒', 27.5, 'TBKWKL'],
  ['苯磺酸氨氯地平片', '络平', '5mg×28片', '片剂', 1, '盒', 36.0, 'BHSALDPP'],
  ['阿托伐他汀钙片', '脂安', '20mg×7片', '片剂', 4, '盒', 42.0, 'ATFTTGP'],
  ['硫酸氢氯吡格雷片', '格宁', '75mg×7片', '片剂', 5, '盒', 58.0, 'LSQLBGLP'],
  ['布洛芬缓释胶囊', '芬舒', '0.3g×20粒', '胶囊剂', 0, '盒', 28.0, 'BLFHSJN'], // SKU-X
  ['奥美拉唑肠溶胶囊', '奥宁', '20mg×14粒', '胶囊剂', 2, '盒', 22.5, 'AMLZCRJN'],
  ['复方甘草口服溶液', '甘宁', '100ml', '口服溶液剂', 3, '瓶', 9.8, 'FFGCKFRY'],
  ['维生素C片', '维佳', '0.1g×100片', '片剂', 5, '瓶', 6.5, 'WSSCP'],
  ['小儿氨酚黄那敏颗粒', '童康', '10袋', '颗粒剂', 1, '盒', 14.0, 'XEAFHNMKL'],
  ['蒙脱石散', '肠安', '3g×10袋', '散剂', 4, '盒', 19.5, 'MTSS'],
  ['碳酸钙D3片', '钙立', '600mg×60片', '片剂', 5, '瓶', 39.0, 'TSGD3P'],
  ['氯雷他定片', '敏舒', '10mg×6片', '片剂', 2, '盒', 15.0, 'LLTDP'],
  ['头孢呋辛酯片', '呋康', '0.25g×12片', '片剂', 3, '盒', 33.0, 'TBFXZP'],
  ['左氧氟沙星片', '左宁', '0.5g×4片', '片剂', 0, '盒', 21.0, 'ZYFSXP'],
  ['注射用头孢曲松钠', '曲宁', '1.0g', '注射剂', 4, '支', 8.6, 'ZSYTBQSN'],
  ['氯化钠注射液', '盐安', '250ml', '注射剂', 1, '瓶', 3.2, 'LHNZSY'],
  ['葡萄糖注射液', '糖安', '500ml', '注射剂', 1, '瓶', 3.8, 'PTTZSY'],
  ['低分子肝素钙注射液', '肝宁', '0.4ml:4100IU', '注射剂', 5, '支', 26.0, 'DFZGSGZSY'],
  ['红霉素软膏', '红宁', '10g', '软膏剂', 2, '支', 4.5, 'HMSRG'],
  ['莫匹罗星软膏', '匹康', '5g', '软膏剂', 3, '支', 18.0, 'MPLXRG'],
  ['厄贝沙坦片', '贝宁', '0.15g×7片', '片剂', 4, '盒', 27.0, 'EBSTP'],
  ['格列美脲片', '糖宁', '2mg×30片', '片剂', 0, '盒', 31.0, 'GLMNP'],
  ['银杏叶片', '杏安', '9.6mg×48片', '片剂', 5, '盒', 25.0, 'YXYP'], // 无近期销售
  ['益生菌冻干粉', '菌康', '2g×10袋', '散剂', 3, '盒', 45.0, 'YSJDGF'],
];

export const skus: Sku[] = SKU_SEEDS.map((s, i) => ({
  sku_id: `SKU-${pad(i + 1)}`,
  source_code: `6901${pad(i * 37 + 1001, 6)}`,
  generic_name: s[0],
  trade_name: s[1],
  spec: s[2],
  dosage_form: s[3],
  manufacturer: MFR[s[4]],
  unit: s[5],
  conversion: i === 25 ? null : { minUnit: s[5] === '盒' ? '最小包装' : s[5], factor: s[5] === '盒' ? 1 : 1 },
  pinyin: s[7],
  list_price: s[6],
}));
export const SKU_X = 'SKU-011'; // AI03 演示：临期批次
export const SKU_NO_SALES = 'SKU-029'; // 无近期销售
export const SKU_NO_CONVERSION = 'SKU-026';

// —— 客户：40个，3地区，医院/药店/商业公司 ——
const CITY: Record<Region, string[]> = {
  浙江: ['杭州', '宁波', '温州', '绍兴'],
  江苏: ['南京', '苏州', '无锡'],
  上海: ['浦东', '徐汇', '闵行'],
};
const HOSP = ['仁济', '康华', '济民', '惠安', '同德', '安平', '博爱', '和泰'];
const SHOP = ['康宁', '益丰源', '百姓安', '润生', '金桥', '天顺'];
const BIZ = ['医药物流', '医药供应链', '药业商贸'];

function buildCustomers(): Customer[] {
  const list: Customer[] = [];
  const regions: Region[] = ['浙江', '江苏', '上海'];
  const plan: [Region, CustomerType][] = [];
  // A、B 两个核心客户
  list.push({ customer_id: 'C001', name: '杭州滨江仁济医院', aliases: ['滨江仁济医院', '杭州市滨江区仁济医院'], region: '浙江', city: '杭州', type: '医院', org: '华东事业部' });
  list.push({ customer_id: 'C002', name: '宁波海曙康宁大药房', aliases: ['康宁大药房(海曙店)'], region: '浙江', city: '宁波', type: '药店', org: '华东事业部' });
  for (let i = 0; i < 38; i++) {
    const region = i < 14 ? '浙江' : regions[1 + (i % 2)];
    const t: CustomerType = i % 5 === 0 ? '商业公司' : i % 2 === 0 ? '医院' : '药店';
    plan.push([region as Region, t]);
  }
  const used = new Set(list.map(c => c.name));
  plan.forEach(([region, type], i) => {
    let name = '';
    let city = '';
    do {
      city = pick(CITY[region]);
      name = type === '医院' ? `${city}${pick(HOSP)}医院` : type === '药店' ? `${city}${pick(SHOP)}大药房` : `${city}${pick(['恒信', '华联', '中瑞', '康达'])}${pick(BIZ)}有限公司`;
    } while (used.has(name));
    used.add(name);
    list.push({
      customer_id: `C${pad(i + 3)}`,
      name,
      aliases: rnd() < 0.2 ? [name.replace('大药房', '药房').replace('有限公司', '')] : [],
      region,
      city,
      type,
      org: region === '浙江' ? '华东事业部' : region === '江苏' ? '苏皖事业部' : '上海事业部',
    });
  });
  return list;
}
export const customers = buildCustomers();
export const CUST_A = 'C001';
export const CUST_B = 'C002';
export const CUST_NEW = 'C039'; // 基期为0：10月新增
export const CUST_RETURN_ONLY = 'C040'; // 10月仅退货

export const warehouses: Warehouse[] = [
  { warehouse_id: 'WH1', name: '杭州主仓', region: '浙江', snapshot_at: '2026-11-03 08:00' },
  { warehouse_id: 'WH2', name: '宁波分仓', region: '浙江', snapshot_at: '2026-11-03 08:00' },
  { warehouse_id: 'WH3', name: '上海前置仓', region: '上海', snapshot_at: '2026-11-02 22:00' },
];
export const owners = [
  { owner_id: 'OWN-01', name: '示例医药商业有限公司' },
  { owner_id: 'OWN-02', name: '示例医药（上海）有限公司' },
];

// —— 库存批次快照（约80条） ——
function buildBatches(): BatchStock[] {
  const out: BatchStock[] = [];
  const offsets = [150, -20, 260, 40, 380, 470, 75, 540, 620, 330, 700, 210, 58, 430, 590, 680, 120, 510, 300, 650];
  skus.forEach((s, i) => {
    const n = i % 3 === 0 ? 3 : i % 3 === 1 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const wh = warehouses[(i + k) % 3];
      const off = offsets[(i * 3 + k * 5) % offsets.length];
      out.push({
        snapshot_at: wh.snapshot_at,
        owner_id: wh.warehouse_id === 'WH3' ? 'OWN-02' : 'OWN-01',
        warehouse_id: wh.warehouse_id,
        sku_id: s.sku_id,
        batch_no: `B${dayjs(DEMO_DATE).add(off - 720, 'day').format('YYMM')}${pad(i + 1, 2)}${k}`,
        expiry_date: dayjs(DEMO_DATE).add(off, 'day').format('YYYY-MM-DD'),
        status: (i + k) % 11 === 0 ? '冻结' : (i + k) % 13 === 0 ? '待验' : '合格',
        qty: ri(40, 260) * 10,
        effective_qty_src: 0,
        reserved_qty: (i + k) % 4 === 0 ? ri(1, 5) * 10 : 0,
      });
    }
  });
  // —— 预埋边界案例 ——
  const x = out.filter(b => b.sku_id === SKU_X);
  x[0].warehouse_id = 'WH1'; x[0].owner_id = 'OWN-01'; x[0].snapshot_at = warehouses[0].snapshot_at;
  x[0].batch_no = 'B2511X1'; x[0].expiry_date = '2026-11-28'; x[0].qty = 300; x[0].status = '合格'; x[0].reserved_qty = 0;
  x[1].warehouse_id = 'WH1'; x[1].owner_id = 'OWN-01'; x[1].snapshot_at = warehouses[0].snapshot_at;
  x[1].batch_no = 'B2607X2'; x[1].expiry_date = '2027-07-15'; x[1].qty = 520; x[1].status = '合格'; x[1].reserved_qty = 0;
  // 同批次跨仓（宁波、杭州）——临期批次计1次
  const s4 = out.filter(b => b.sku_id === 'SKU-004');
  s4[0].warehouse_id = 'WH1'; s4[0].owner_id = 'OWN-01'; s4[0].snapshot_at = warehouses[0].snapshot_at;
  s4[1].warehouse_id = 'WH2'; s4[1].owner_id = 'OWN-01'; s4[1].snapshot_at = warehouses[1].snapshot_at;
  s4[0].batch_no = s4[1].batch_no = 'B2512A';
  s4[0].expiry_date = s4[1].expiry_date = '2026-12-20';
  // 同批号不同SKU
  const s1 = out.find(b => b.sku_id === 'SKU-001')!;
  const s2 = out.find(b => b.sku_id === 'SKU-002')!;
  s1.batch_no = s2.batch_no = 'B260301';
  // 未知效期
  out.find(b => b.sku_id === 'SKU-014')!.expiry_date = null;
  out.find(b => b.sku_id === 'SKU-022')!.expiry_date = null;
  // 无近期销售品种：有库存且临期
  const ns = out.filter(b => b.sku_id === SKU_NO_SALES);
  ns[0].expiry_date = '2027-01-20'; ns[0].qty = 400; ns[0].status = '合格';
  // 原系统"有效库存"字段：直接作为来源值（演示：部分缺失）
  out.forEach((b, i) => {
    b.effective_qty_src = i % 9 === 4 ? null : Math.max(0, b.qty - b.reserved_qty - (b.status === '合格' ? 0 : b.qty - b.reserved_qty));
  });
  return out;
}
export const batches = buildBatches();

// —— 流向明细（约2000条） ——
const MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const MONTH_TOTAL: Record<string, number> = {
  '2025-09': 980000, '2025-10': 1010000, '2025-11': 1050000, '2025-12': 1120000, '2026-01': 1060000,
  '2026-02': 900000, '2026-03': 1080000, '2026-04': 1100000, '2026-05': 1150000, '2026-06': 1130000,
  '2026-07': 1170000, '2026-08': 1190000, '2026-09': 1200000, '2026-10': 960000,
};

let lineSeq = 1;
let docSeq = 1;
function dayIn(month: string, from = 1, to?: number) {
  const end = to ?? dayjs(`${month}-01`).daysInMonth();
  return `${month}-${pad(ri(from, end), 2)}`;
}
function importDateOf(d: string) { return dayjs(d).add(ri(1, 3), 'day').format('YYYY-MM-DD'); }
function whForCustomer(c: Customer) { return c.region === '浙江' ? (c.city === '宁波' ? 'WH2' : 'WH1') : 'WH3'; }
function batchFor(skuId: string, wh?: string) {
  const list = batches.filter(b => b.sku_id === skuId && (!wh || b.warehouse_id === wh));
  const b = list.length ? pick(list) : pick(batches.filter(x => x.sku_id === skuId));
  return { batch_no: b.batch_no, expiry_date: b.expiry_date };
}
function rawName(c: Customer) { return c.aliases.length && rnd() < 0.35 ? pick(c.aliases) : c.name; }

function mkFlow(p: Omit<FlowRecord, 'source_id' | 'source_line_id' | 'event_id' | 'doc_no' | 'import_date' | 'acquire_mode'> & Partial<FlowRecord>): FlowRecord {
  const ln = lineSeq++;
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  return {
    ...clean,
    source_id: p.source_id ?? (p.type.startsWith('仓储') ? 'WMS' : 'ERP'),
    source_line_id: p.source_line_id ?? `L${pad(ln, 6)}`,
    event_id: p.event_id ?? `EV${pad(ln, 6)}`,
    doc_no: p.doc_no ?? `${p.type === '进货' ? 'PO' : p.type.startsWith('调拨') ? 'TR' : p.type.startsWith('仓储') ? 'WM' : p.type === '销售退货' ? 'RT' : 'SO'}${p.biz_date.replace(/-/g, '').slice(2)}${pad(docSeq++, 4)}`,
    import_date: p.import_date ?? importDateOf(p.biz_date),
    acquire_mode: p.acquire_mode ?? (rnd() < 0.8 ? '接口' : '文件导入'),
  } as FlowRecord;
}

const skuById = new Map(skus.map(s => [s.sku_id, s]));
const custById = new Map(customers.map(c => [c.customer_id, c]));

function emitSales(out: FlowRecord[], month: string, c: Customer, target: number, allowSkus: string[], dayFrom = 1) {
  if (target <= 0) return;
  const n = target > 60000 ? ri(4, 7) : target > 15000 ? ri(2, 4) : ri(1, 2);
  let acc = 0;
  const wh = whForCustomer(c);
  for (let k = 0; k < n; k++) {
    const sku = skuById.get(pick(allowSkus))!;
    const date = dayIn(month, dayFrom);
    let qty: number; let price: number; let amount: number;
    if (k < n - 1) {
      price = r2(sku.list_price * (0.95 + rnd() * 0.1));
      qty = Math.max(1, Math.round((target * 0.85 / n) / price));
      amount = r2(qty * price);
    } else {
      amount = r2(target - acc);
      qty = Math.max(1, Math.round(amount / sku.list_price));
      price = r2(amount / qty);
    }
    acc = r2(acc + amount);
    out.push(mkFlow({ type: '销售', biz_date: date, sku_id: sku.sku_id, customer_id: c.customer_id, raw_customer_name: rawName(c), warehouse_id: wh, ...batchFor(sku.sku_id, wh), qty, unit_price: price, amount }));
  }
}
function emitReturn(out: FlowRecord[], month: string, c: Customer, amountAbs: number, allowSkus: string[]) {
  const sku = skuById.get(pick(allowSkus))!;
  const qty = Math.max(1, Math.round(amountAbs / sku.list_price));
  const price = r2(amountAbs / qty);
  const wh = whForCustomer(c);
  out.push(mkFlow({ type: '销售退货', biz_date: dayIn(month), sku_id: sku.sku_id, customer_id: c.customer_id, raw_customer_name: rawName(c), warehouse_id: wh, ...batchFor(sku.sku_id, wh), qty: -qty, unit_price: price, amount: -r2(amountAbs) }));
}

function splitTargets(ids: string[], total: number): Record<string, number> {
  const w = ids.map(() => 0.3 + rnd());
  const sw = w.reduce((a, b) => a + b, 0);
  const res: Record<string, number> = {};
  let acc = 0;
  ids.forEach((id, i) => {
    const v = i === ids.length - 1 ? total - acc : Math.round((total * w[i]) / sw);
    res[id] = v; acc += v;
  });
  return res;
}

function buildFlows(): { flows: FlowRecord[]; duplicates: FlowRecord[] } {
  const out: FlowRecord[] = [];
  const others = customers.filter(c => c.customer_id !== CUST_A && c.customer_id !== CUST_B);
  for (const m of MONTHS) {
    const allow = skus.map(s => s.sku_id).filter(id => !(id === SKU_NO_SALES && m >= '2026-06') && !(id === SKU_X && m === '2026-10'));
    let targets: Record<string, number>;
    if (m === '2026-09') {
      const act = others.filter(c => c.customer_id !== CUST_NEW && rnd() < 0.85 || c.customer_id === CUST_RETURN_ONLY);
      targets = { [CUST_A]: 250000, [CUST_B]: 150000, ...splitTargets(act.filter(c => c.customer_id !== CUST_NEW).map(c => c.customer_id), 800000) };
    } else if (m === '2026-10') {
      const act = others.filter(c => ![CUST_NEW, CUST_RETURN_ONLY].includes(c.customer_id) && rnd() < 0.85);
      targets = { [CUST_A]: 100000, [CUST_B]: 90000, [CUST_NEW]: 18000, [CUST_RETURN_ONLY]: -2600, ...splitTargets(act.map(c => c.customer_id), 770000 - 18000 + 2600) };
      // AI03：SKU-X 近30天（10-04 ~ 11-02）对外净销 240 盒（日均8盒）
      const xs = act.slice(0, 8);
      xs.forEach((c, i) => {
        const price = 28.0;
        const qty = 30;
        out.push(mkFlow({ type: '销售', biz_date: `2026-10-${pad(5 + i * 3, 2)}`, sku_id: SKU_X, customer_id: c.customer_id, raw_customer_name: c.name, warehouse_id: 'WH1', batch_no: 'B2511X1', expiry_date: '2026-11-28', qty, unit_price: price, amount: qty * price }));
        targets[c.customer_id] -= qty * price;
      });
    } else {
      const act = customers.filter(c => c.customer_id !== CUST_NEW && rnd() < 0.82);
      targets = splitTargets(act.map(c => c.customer_id), MONTH_TOTAL[m]);
    }
    // 退货：净额不变，销售额 += 退货额
    const retCands = Object.keys(targets).filter(id => targets[id] > 20000 && id !== CUST_RETURN_ONLY);
    const retIds = new Set<string>();
    for (let k = 0; k < 4; k++) retIds.add(pick(retCands));
    if (m === '2026-10') retIds.add(CUST_A);
    for (const [id, t] of Object.entries(targets)) {
      const c = custById.get(id)!;
      if (t < 0) { emitReturn(out, m, c, -t, allow); continue; }
      const ret = retIds.has(id) ? (id === CUST_A && m === '2026-10' ? 2000 : ri(5, 30) * 100) : 0;
      emitSales(out, m, c, t + ret, allow);
      if (ret) emitReturn(out, m, c, ret, allow);
    }
    // 进货（含仓储入库视图，同一业务事件）
    for (let k = 0; k < 20; k++) {
      const sku = pick(skus);
      const wh = pick(warehouses).warehouse_id;
      const qty = ri(10, 80) * 10;
      const price = r2(sku.list_price * 0.72);
      const f = mkFlow({ type: '进货', biz_date: dayIn(m), sku_id: sku.sku_id, customer_id: null, raw_customer_name: sku.manufacturer, warehouse_id: wh, ...batchFor(sku.sku_id, wh), qty, unit_price: price, amount: r2(qty * price) });
      out.push(f);
      if (k < 6) out.push(mkFlow({ ...f, source_id: 'WMS', source_line_id: undefined, doc_no: undefined, type: '仓储入库', event_id: f.event_id, biz_date: f.biz_date, amount: 0, unit_price: 0 } as any));
    }
    // 仓储出库视图（对应部分销售）
    const monthSales = out.filter(f => f.type === '销售' && f.biz_date.startsWith(m));
    for (let k = 0; k < 4; k++) {
      const s = pick(monthSales);
      out.push(mkFlow({ ...s, source_id: 'WMS', source_line_id: undefined, doc_no: undefined, type: '仓储出库', event_id: s.event_id, amount: 0, unit_price: 0, qty: -s.qty } as any));
    }
    // 调拨：成对出入库
    for (let k = 0; k < 10; k++) {
      const sku = pick(skus);
      const [a, b] = rnd() < 0.5 ? ['WH1', 'WH2'] : rnd() < 0.5 ? ['WH1', 'WH3'] : ['WH2', 'WH1'];
      const qty = ri(2, 20) * 10;
      const d = dayIn(m, 1, 26);
      const bt = batchFor(sku.sku_id, a);
      const doc = `TR${d.replace(/-/g, '').slice(2)}${pad(docSeq++, 4)}`;
      const ev = `EVT${pad(lineSeq, 6)}`;
      const price = r2(sku.list_price * 0.72);
      out.push(mkFlow({ type: '调拨出库', doc_no: doc, event_id: ev, biz_date: d, sku_id: sku.sku_id, customer_id: null, raw_customer_name: '内部调拨', warehouse_id: a, counter_warehouse_id: b, ...bt, qty: -qty, unit_price: price, amount: -r2(qty * price) }));
      const singleSide = m === '2026-08' && k === 0;
      if (!singleSide) {
        const inDate = m === '2026-10' && k === 0 ? '2026-11-02' : dayjs(d).add(ri(0, 2), 'day').format('YYYY-MM-DD');
        const inQty = m === '2026-09' && k === 1 ? qty - 10 : qty; // 数量差异
        out.push(mkFlow({ type: '调拨入库', doc_no: doc, event_id: ev, biz_date: inDate, sku_id: sku.sku_id, customer_id: null, raw_customer_name: '内部调拨', warehouse_id: b, counter_warehouse_id: a, ...bt, qty: inQty, unit_price: price, amount: r2(inQty * price) }));
      }
    }
  }
  // 重复导入：同来源+同来源明细ID再次出现
  const dupSrc = out.filter(f => f.type === '销售' && f.biz_date.startsWith('2026-08')).slice(0, 2);
  const duplicates = dupSrc.map(f => ({ ...f, import_date: '2026-09-15', acquire_mode: '文件导入' as const }));
  out.sort((a, b) => (a.biz_date < b.biz_date ? -1 : a.biz_date > b.biz_date ? 1 : 0));
  return { flows: out, duplicates };
}

const built = buildFlows();
/** 原始来源记录（含重复导入） */
export const rawFlowRecords: FlowRecord[] = [...built.flows, ...built.duplicates];

/** 按来源系统+来源明细ID幂等去重 */
export function dedupeFlows(records: FlowRecord[]) {
  const seen = new Map<string, FlowRecord>();
  const conflicts: FlowRecord[] = [];
  for (const r of records) {
    const k = `${r.source_id}|${r.source_line_id}`;
    if (seen.has(k)) conflicts.push(r); else seen.set(k, r);
  }
  return { flows: [...seen.values()], conflicts };
}
const dd = dedupeFlows(rawFlowRecords);
export const flows = dd.flows;
export const duplicateConflicts = dd.conflicts;

// —— 招商：合伙人、目录、机会、授权、推广 ——
export const partners: Partner[] = [
  { partner_id: 'PT01', name: '浙南医药推广服务有限公司', kind: '企业', contact: '周经理 138****1201', owner: '陈晓', status: '合作中' },
  { partner_id: 'PT02', name: '苏沪康联医药咨询有限公司', kind: '企业', contact: '吴总 139****3320', owner: '林悦', status: '合作中' },
  { partner_id: 'PT03', name: '申城药学服务工作室', kind: '个人工作室', contact: '郑女士 137****5568', owner: '林悦', status: '合作中' },
  { partner_id: 'PT04', name: '甬江医药商贸有限公司', kind: '商业公司', contact: '王经理 135****7781', owner: '陈晓', status: '合作中' },
  { partner_id: 'PT05', name: '钱江学术推广有限公司', kind: '企业', contact: '冯总 136****9902', owner: '陈晓', status: '合作中' },
  { partner_id: 'PT06', name: '金陵康瑞医药服务有限公司', kind: '企业', contact: '许经理 133****4410', owner: '赵宁', status: '潜在' },
];

const mat = (id: string, name: string, v: string, d: string, vis: '内部' | '合作方可见' = '合作方可见') => ({ doc_id: id, name, version: v, effective_date: d, visibility: vis });
export const initialCatalogue: CatalogueItem[] = [
  { catalogue_id: 'CAT-01', name: '安莫灵 阿莫西林胶囊 0.25g×24粒', sku_ids: ['SKU-001'], status: '招商中', regions: ['浙江', '江苏'], channels: ['医院', '药店'], owner: '陈晓', supply_note: '杭州主仓常规供货，3个工作日', policy_ref: '示例政策 ZC-2026-01（演示）', materials: [mat('KD-01', '产品招商手册', 'v2.0', '2026-05-01'), mat('KD-01', '产品招商手册', 'v1.0', '2025-09-01')], updated_at: '2026-10-12', history: [] },
  { catalogue_id: 'CAT-02', name: '安莫灵 阿莫西林胶囊 0.5g×24粒', sku_ids: ['SKU-002'], status: '招商中', regions: ['浙江'], channels: ['药店'], owner: '陈晓', supply_note: '杭州主仓常规供货', policy_ref: '示例政策 ZC-2026-02（演示）', materials: [mat('KD-01', '产品招商手册', 'v2.0', '2026-05-01')], updated_at: '2026-09-20', history: [] },
  { catalogue_id: 'CAT-03', name: '糖舒平 盐酸二甲双胍片（两规格）', sku_ids: ['SKU-004', 'SKU-005'], status: '招商中', regions: ['江苏'], channels: ['医院', '药店', '商业公司'], owner: '林悦', supply_note: '两规格均可供货', policy_ref: '示例政策 ZC-2026-03（演示）', materials: [mat('KD-03', '糖舒平产品资料', 'v1.1', '2026-03-01')], updated_at: '2026-10-02', history: [] },
  { catalogue_id: 'CAT-04', name: '络平 苯磺酸氨氯地平片 5mg×28片', sku_ids: ['SKU-008'], status: '招商中', regions: ['江苏', '上海'], channels: ['医院'], owner: '赵宁', supply_note: '上海前置仓供货', policy_ref: '示例政策 ZC-2026-04（演示）', materials: [mat('KD-04', '络平学术资料', 'v1.0', '2026-02-15')], updated_at: '2026-08-11', history: [] },
  { catalogue_id: 'CAT-05', name: '克益 头孢克肟颗粒 50mg×6袋', sku_ids: ['SKU-006'], status: '招商中', regions: ['上海'], channels: ['药店'], owner: '林悦', supply_note: '上海前置仓供货', policy_ref: '示例政策 ZC-2026-05（演示）', materials: [mat('KD-05', '克益产品资料', 'v1.0', '2026-01-10')], updated_at: '2026-07-01', history: [] },
  { catalogue_id: 'CAT-06', name: '芬舒 布洛芬缓释胶囊 0.3g×20粒', sku_ids: ['SKU-011'], status: '招商中', regions: ['浙江'], channels: ['医院', '药店', '商业公司'], owner: '陈晓', supply_note: '注意近效期批次 B2511X1', policy_ref: '示例政策 ZC-2026-06（演示）', materials: [mat('KD-06', '芬舒产品资料', 'v1.0', '2026-04-01')], updated_at: '2026-10-28', history: [] },
  { catalogue_id: 'CAT-07', name: '脂安 阿托伐他汀钙片 20mg×7片', sku_ids: ['SKU-009'], status: '招商中', regions: ['上海'], channels: ['医院', '药店', '商业公司'], owner: '赵宁', supply_note: '上海前置仓供货', policy_ref: '示例政策 ZC-2025-07（演示）', materials: [mat('KD-07', '脂安招商资料', 'v1.0', '2025-11-20')], updated_at: '2026-06-18', history: [] },
  { catalogue_id: 'CAT-08', name: '肟康 头孢克肟颗粒 50mg×6袋', sku_ids: ['SKU-007'], status: '草稿', regions: ['浙江'], channels: ['药店'], owner: '陈晓', supply_note: '', policy_ref: '', materials: [], updated_at: '2026-10-30', history: [] },
  { catalogue_id: 'CAT-09', name: '格宁 硫酸氢氯吡格雷片 75mg×7片', sku_ids: ['SKU-010'], status: '招商中', regions: ['浙江', '江苏', '上海'], channels: ['医院'], owner: '赵宁', supply_note: '三仓均可供货', policy_ref: '示例政策 ZC-2026-09（演示）', materials: [mat('KD-09', '格宁学术资料', 'v1.0', '2026-06-01')], updated_at: '2026-09-02', history: [] },
  { catalogue_id: 'CAT-10', name: '银杏叶片 9.6mg×48片', sku_ids: ['SKU-029'], status: '暂停招商', regions: ['浙江'], channels: ['药店'], owner: '陈晓', supply_note: '近期无销售，库存待核查', policy_ref: '示例政策 ZC-2025-10（演示）', materials: [mat('KD-10', '杏安资料', 'v1.0', '2025-10-01')], updated_at: '2026-08-30', history: [{ at: '2026-08-30 10:20', by: '陈晓', action: '暂停招商', detail: '供货计划调整' }] },
  { catalogue_id: 'CAT-11', name: '莫匹罗星软膏 5g', sku_ids: ['SKU-026'], status: '草稿', regions: ['上海'], channels: ['药店'], owner: '赵宁', supply_note: '单位转换规则缺失，待主数据补充', policy_ref: '', materials: [], updated_at: '2026-10-25', history: [] },
  { catalogue_id: 'CAT-12', name: '维佳 维生素C片 0.1g×100片', sku_ids: ['SKU-014'], status: '已终止', regions: ['江苏'], channels: ['药店'], owner: '林悦', supply_note: '', policy_ref: '示例政策 ZC-2025-12（演示）', materials: [mat('KD-12', '维佳资料', 'v1.0', '2025-03-01')], updated_at: '2026-04-15', history: [{ at: '2026-04-15 09:00', by: '林悦', action: '终止招商', detail: '品种退出招商目录' }] },
];

const fu = (id: string, at: string, method: string, target: string, content: string, feedback: string, next_action: string, next_date: string | undefined, by: string) => ({ followup_id: id, at, method, target, content, feedback, next_action, next_date, by });
const sc = (at: string, by: string, from: any, to: any, reason: string) => ({ at, by, from, to, reason });

export const initialOpportunities: Opportunity[] = [
  { opportunity_id: 'OPP-2026-001', name: '安莫灵0.25g 浙江医院渠道合作', catalogue_id: 'CAT-01', partner_id: 'PT01', prospect_name: null, region: '浙江', channel: '医院', owner: '陈晓', stage: '合作确认', source: '展会', need: '覆盖杭州、宁波二级医院', next_action: '执行授权与推广', created_at: '2025-11-10', confirmed_at: '2025-12-20', followups: [fu('F001', '2025-11-12 10:00', '业务拜访', '周经理', '介绍产品与招商政策', '有意向，需资料', '提供资质资料', '2025-11-20', '陈晓'), fu('F002', '2025-12-15 15:00', '电话沟通', '周经理', '确认合作范围', '同意浙江医院渠道', '登记合作确认', undefined, '陈晓')], stage_changes: [sc('2025-11-10 09:00', '陈晓', null, '线索登记', '展会登记'), sc('2025-11-12 11:00', '陈晓', '线索登记', '需求沟通', '首次拜访'), sc('2025-11-25 11:00', '陈晓', '需求沟通', '资料确认', '资料已提供'), sc('2025-12-10 11:00', '陈晓', '资料确认', '合作洽谈', '进入洽谈'), sc('2025-12-20 16:00', '陈晓', '合作洽谈', '合作确认', '负责人确认，依据：会议纪要')], version: 6 },
  { opportunity_id: 'OPP-2026-002', name: '安莫灵0.25g 浙江医院（钱江学术）', catalogue_id: 'CAT-01', partner_id: 'PT05', prospect_name: null, region: '浙江', channel: '医院', owner: '陈晓', stage: '合作确认', source: '合伙人推荐', need: '温州、绍兴医院学术推广', next_action: '跟进推广', created_at: '2026-04-02', confirmed_at: '2026-05-20', followups: [fu('F003', '2026-04-10 14:00', '业务拜访', '冯总', '沟通区域需求', '侧重温州绍兴', '提供资料', '2026-04-20', '陈晓')], stage_changes: [sc('2026-04-02 09:00', '陈晓', null, '线索登记', '推荐登记'), sc('2026-05-20 10:00', '陈晓', '合作洽谈', '合作确认', '确认依据：合作意向书')], version: 3 },
  { opportunity_id: 'OPP-2026-003', name: '糖舒平 江苏全渠道合作', catalogue_id: 'CAT-03', partner_id: 'PT02', prospect_name: null, region: '江苏', channel: '全部渠道', owner: '林悦', stage: '合作确认', source: '主动拓展', need: '南京苏州全渠道', next_action: '等待授权生效', created_at: '2026-08-01', confirmed_at: '2026-10-15', followups: [fu('F004', '2026-08-05 10:00', '业务拜访', '吴总', '介绍两规格', '关注0.85g规格', '提供资料', '2026-08-15', '林悦')], stage_changes: [sc('2026-08-01 09:00', '林悦', null, '线索登记', '主动拓展'), sc('2026-10-15 10:00', '林悦', '合作洽谈', '合作确认', '确认依据：洽谈纪要')], version: 4 },
  { opportunity_id: 'OPP-2026-004', name: '芬舒 浙江全渠道合作', catalogue_id: 'CAT-06', partner_id: 'PT01', prospect_name: null, region: '浙江', channel: '全部渠道', owner: '陈晓', stage: '合作确认', source: '既有合伙人', need: '扩大芬舒覆盖', next_action: '授权待确认', created_at: '2026-09-10', confirmed_at: '2026-10-30', followups: [fu('F005', '2026-09-12 10:00', '电话沟通', '周经理', '沟通芬舒', '有意向', '洽谈范围', '2026-09-25', '陈晓'), fu('F006', '2026-10-28 16:00', '业务拜访', '周经理', '确认范围与期限', '同意', '生成授权草稿', undefined, '陈晓')], stage_changes: [sc('2026-09-10 09:00', '陈晓', null, '线索登记', '既有合伙人'), sc('2026-10-30 10:00', '陈晓', '合作洽谈', '合作确认', '确认依据：会议纪要')], version: 5 },
  { opportunity_id: 'OPP-2026-005', name: '络平 江苏医院合作', catalogue_id: 'CAT-04', partner_id: 'PT06', prospect_name: null, region: '江苏', channel: '医院', owner: '赵宁', stage: '合作洽谈', source: '展会', need: '南京三甲医院', next_action: '确认供货条件', next_date: '2026-10-28', created_at: '2026-07-15', followups: [fu('F007', '2026-09-20 10:00', '业务拜访', '许经理', '洽谈供货条件', '关注供货周期', '确认供货条件', '2026-10-28', '赵宁')], stage_changes: [sc('2026-07-15 09:00', '赵宁', null, '线索登记', '展会'), sc('2026-09-20 11:00', '赵宁', '资料确认', '合作洽谈', '资料齐备')], version: 3 },
  { opportunity_id: 'OPP-2026-006', name: '格宁 上海医院合作', catalogue_id: 'CAT-09', partner_id: 'PT03', prospect_name: null, region: '上海', channel: '医院', owner: '赵宁', stage: '资料确认', source: '合伙人推荐', need: '浦东医院', next_action: '补充学术资料', next_date: '2026-11-08', created_at: '2026-09-05', followups: [fu('F008', '2026-10-20 15:00', '电话沟通', '郑女士', '确认资料清单', '缺临床资料', '补充学术资料', '2026-11-08', '赵宁')], stage_changes: [sc('2026-09-05 09:00', '赵宁', null, '线索登记', '推荐'), sc('2026-10-20 16:00', '赵宁', '需求沟通', '资料确认', '资料清单确认')], version: 3 },
  { opportunity_id: 'OPP-2026-007', name: '格宁 浙江医院合作（潜在线索）', catalogue_id: 'CAT-09', partner_id: null, prospect_name: '温州某医药咨询团队', region: '浙江', channel: '医院', owner: '陈晓', stage: '需求沟通', source: '电话咨询', need: '温州医院', next_action: '约见面谈', next_date: '2026-10-30', created_at: '2026-10-08', followups: [fu('F009', '2026-10-12 10:00', '电话沟通', '团队负责人', '初步需求', '待面谈', '约见面谈', '2026-10-30', '陈晓')], stage_changes: [sc('2026-10-08 09:00', '陈晓', null, '线索登记', '电话咨询'), sc('2026-10-12 11:00', '陈晓', '线索登记', '需求沟通', '有效沟通')], version: 2 },
  { opportunity_id: 'OPP-2026-008', name: '安莫灵0.25g 江苏药店合作', catalogue_id: 'CAT-01', partner_id: 'PT02', prospect_name: null, region: '江苏', channel: '药店', owner: '林悦', stage: '线索登记', source: '主动拓展', need: '苏州连锁药店', next_action: '首次沟通', next_date: '2026-11-06', created_at: '2026-10-29', followups: [], stage_changes: [sc('2026-10-29 09:00', '林悦', null, '线索登记', '主动拓展')], version: 1 },
  { opportunity_id: 'OPP-2026-009', name: '脂安 上海全渠道合作', catalogue_id: 'CAT-07', partner_id: 'PT02', prospect_name: null, region: '上海', channel: '全部渠道', owner: '赵宁', stage: '合作确认', source: '既有合伙人', need: '上海全渠道', next_action: '续期评估', created_at: '2025-10-01', confirmed_at: '2025-11-20', followups: [], stage_changes: [sc('2025-11-20 10:00', '赵宁', '合作洽谈', '合作确认', '确认依据：合作协议')], version: 5 },
  { opportunity_id: 'OPP-2026-010', name: '克益 上海药店合作', catalogue_id: 'CAT-05', partner_id: 'PT03', prospect_name: null, region: '上海', channel: '药店', owner: '林悦', stage: '合作确认', source: '合伙人推荐', need: '徐汇闵行药店', next_action: '授权暂停中，待核查', created_at: '2026-01-05', confirmed_at: '2026-02-20', followups: [], stage_changes: [sc('2026-02-20 10:00', '林悦', '合作洽谈', '合作确认', '确认依据：会议纪要')], version: 4 },
  { opportunity_id: 'OPP-2026-011', name: '安莫灵0.5g 浙江药店合作', catalogue_id: 'CAT-02', partner_id: 'PT04', prospect_name: null, region: '浙江', channel: '药店', owner: '陈晓', stage: '关闭未达成', source: '展会', need: '宁波药店续签', next_action: '—', close_reason: '暂缓', created_at: '2026-08-20', followups: [fu('F010', '2026-09-10 10:00', '业务拜访', '王经理', '续签沟通', '暂缓合作', '关闭机会', undefined, '陈晓')], stage_changes: [sc('2026-08-20 09:00', '陈晓', null, '线索登记', '展会'), sc('2026-09-12 10:00', '陈晓', '需求沟通', '关闭未达成', '暂缓：对方年度预算调整')], version: 3 },
  { opportunity_id: 'OPP-2026-012', name: '络平 上海医院合作', catalogue_id: 'CAT-04', partner_id: 'PT03', prospect_name: null, region: '上海', channel: '医院', owner: '赵宁', stage: '需求沟通', source: '合伙人推荐', need: '闵行医院', next_action: '提交需求方案', next_date: '2026-11-12', created_at: '2026-10-18', followups: [fu('F011', '2026-10-22 10:00', '业务拜访', '郑女士', '需求沟通', '关注学术支持', '提交需求方案', '2026-11-12', '赵宁')], stage_changes: [sc('2026-10-18 09:00', '赵宁', null, '线索登记', '推荐'), sc('2026-10-22 11:00', '赵宁', '线索登记', '需求沟通', '有效沟通')], version: 2 },
];

const av = (version: number, scope_items: any[], valid_from: string, valid_to: string, review: any, basis: string, created_at: string, created_by: string, change_note: string) => ({ version, scope_items, valid_from, valid_to, review, basis, created_at, created_by, change_note });
const si = (catalogue_id: string, sku_ids: string[], regions: any, channels: any, customers: any = { mode: 'ALL_MATCHING' }) => ({ catalogue_id, sku_ids, regions, channels, customers });

export const initialAuthorizations: Authorization[] = [
  { authorization_id: 'AUTH-001', partner_id: 'PT01', opportunity_id: 'OPP-2026-001', owner: '陈晓', current_version: 2, versions: [
    av(1, [si('CAT-01', ['SKU-001'], ['浙江'], ['医院'], { mode: 'LIST', ids: ['C001', 'C003', 'C005'] })], '2026-01-01', '2026-12-31', '已通过', '合作协议（演示附件）', '2025-12-22', '陈晓', '首次授权'),
    av(2, [si('CAT-01', ['SKU-001'], ['浙江'], ['医院'])], '2026-01-01', '2026-12-31', '已通过', '补充协议（演示附件）', '2026-04-10', '陈晓', '客户范围由指定清单调整为全部符合区域渠道的客户'),
  ], suspended: false, terminated: false, attachments: ['合作协议_演示.pdf', '补充协议_演示.pdf'], history: [{ at: '2026-01-01 00:00', by: '系统', action: '生效' }], updated_at: '2026-04-12' },
  { authorization_id: 'AUTH-002', partner_id: 'PT02', opportunity_id: 'OPP-2026-003', owner: '林悦', current_version: 1, versions: [
    av(1, [si('CAT-03', ['SKU-004', 'SKU-005'], ['江苏'], 'ALL')], '2026-12-01', '2027-11-30', '已通过', '合作意向书（演示附件）', '2026-10-18', '林悦', '首次授权'),
  ], suspended: false, terminated: false, attachments: ['合作意向书_演示.pdf'], history: [{ at: '2026-10-20 10:00', by: '赵宁', action: '模拟通过' }], updated_at: '2026-10-20' },
  { authorization_id: 'AUTH-003', partner_id: 'PT03', opportunity_id: 'OPP-2026-010', owner: '林悦', current_version: 1, versions: [
    av(1, [si('CAT-05', ['SKU-006'], ['上海'], ['药店'])], '2026-03-01', '2027-02-28', '已通过', '合作协议（演示附件）', '2026-02-22', '林悦', '首次授权'),
  ], suspended: true, terminated: false, attachments: ['合作协议_演示.pdf'], history: [{ at: '2026-10-08 14:00', by: '林悦', action: '暂停', detail: '合伙人资质文件到期待更新' }], updated_at: '2026-10-08' },
  { authorization_id: 'AUTH-004', partner_id: 'PT04', owner: '陈晓', current_version: 1, versions: [
    av(1, [si('CAT-02', ['SKU-002'], ['浙江'], ['药店'])], '2025-10-01', '2026-10-31', '已通过', '合作协议（演示附件）', '2025-09-25', '陈晓', '首次授权'),
  ], suspended: false, terminated: false, attachments: ['合作协议_演示.pdf'], history: [], updated_at: '2025-09-28' },
  { authorization_id: 'AUTH-005', partner_id: 'PT05', opportunity_id: 'OPP-2026-002', owner: '陈晓', current_version: 1, versions: [
    av(1, [si('CAT-01', ['SKU-001'], ['浙江'], ['医院'])], '2026-06-01', '2027-05-31', '已通过', '合作意向书（演示附件）', '2026-05-22', '陈晓', '首次授权'),
  ], suspended: false, terminated: false, attachments: ['合作意向书_演示.pdf'], history: [], updated_at: '2026-05-25' },
  { authorization_id: 'AUTH-006', partner_id: 'PT01', opportunity_id: 'OPP-2026-004', owner: '陈晓', current_version: 0, versions: [
    av(1, [si('CAT-06', ['SKU-011'], ['浙江'], 'ALL')], '2026-11-10', '2027-11-09', '待确认', '会议纪要（演示附件）', '2026-10-30', '陈晓', '由招商机会 OPP-2026-004 生成草稿'),
  ], suspended: false, terminated: false, attachments: ['会议纪要_演示.pdf'], history: [{ at: '2026-10-31 09:00', by: '陈晓', action: '提交确认' }], updated_at: '2026-10-31' },
  { authorization_id: 'AUTH-007', partner_id: 'PT06', opportunity_id: 'OPP-2026-005', owner: '赵宁', current_version: 0, versions: [
    av(1, [si('CAT-04', ['SKU-008'], ['江苏'], null)], '2026-12-01', '2027-11-30', '草稿', '', '2026-10-25', '赵宁', '草稿：渠道范围未填写'),
  ], suspended: false, terminated: false, attachments: [], history: [], updated_at: '2026-10-25' },
  { authorization_id: 'AUTH-008', partner_id: 'PT02', opportunity_id: 'OPP-2026-009', owner: '赵宁', current_version: 1, versions: [
    av(1, [si('CAT-07', ['SKU-009'], ['上海'], 'ALL')], '2025-12-01', '2026-11-25', '已通过', '合作协议（演示附件）', '2025-11-22', '赵宁', '首次授权'),
  ], suspended: false, terminated: false, attachments: ['合作协议_演示.pdf'], history: [], updated_at: '2025-11-25' },
];

const zjHosp = customers.filter(c => c.region === '浙江' && c.type === '医院').map(c => c.customer_id);
const zjShop = customers.filter(c => c.region === '浙江' && c.type === '药店').map(c => c.customer_id);
const shShop = customers.filter(c => c.region === '上海' && c.type === '药店').map(c => c.customer_id);
const shAll = customers.filter(c => c.region === '上海').map(c => c.customer_id);
const jsAll = customers.filter(c => c.region === '江苏').map(c => c.customer_id);
const act = (id: string, at: string, customer_id: string | null, method: any, content: string, feedback: string, by: string, extra: any = {}) => ({ activity_id: id, at, customer_id, method, content, feedback, by, ...extra });

export const initialPromotions: Promotion[] = [
  { promotion_id: 'PRM-001', name: '安莫灵 浙江医院Q4推广', partner_id: 'PT01', catalogue_id: 'CAT-01', authorization_id: 'AUTH-001', authorization_version: 2, region: '浙江', channel: '医院', start: '2026-10-01', end: '2026-12-31', owner: '陈晓', goal: '覆盖6家二级医院', status: '执行中', target_customer_ids: [...zjHosp.slice(0, 4), zjShop[0]], leads: ['绍兴某社区卫生服务中心'], opportunity_ids: ['OPP-2026-001'], activities: [
    act('A001', '2026-10-08 10:00', zjHosp[0], '业务拜访', '产品介绍', '药剂科有兴趣', '陈晓', { material_version: '产品招商手册 v2.0', next_action: '学术会议', next_date: '2026-10-20' }),
    act('A002', '2026-10-20 14:00', zjHosp[0], '学术会议', '科室会', '反馈良好', '陈晓', { material_version: '产品招商手册 v2.0' }),
    act('A003', '2026-10-15 10:00', zjHosp[1], '资料介绍', '递交资料', '待评估', '陈晓', { material_version: '产品招商手册 v2.0' }),
    act('A004', '2026-10-22 10:00', zjHosp[2], '电话沟通', '预约拜访', '约11月', '陈晓', { next_action: '拜访', next_date: '2026-11-05' }),
    act('A005', '2026-09-28 10:00', zjHosp[1], '业务拜访', '计划前沟通（补录）', '有兴趣', '陈晓', { backfilled: true }),
    act('A006', '2026-10-25 10:00', null, '业务拜访', '潜在线索沟通', '需进一步了解', '陈晓', { lead_name: '绍兴某社区卫生服务中心' }),
  ], history: [{ at: '2026-10-01 09:00', by: '陈晓', action: '启动', detail: '授权 AUTH-001 v2 校验通过' }], version: 3 },
  { promotion_id: 'PRM-002', name: '安莫灵 温绍医院学术推广', partner_id: 'PT05', catalogue_id: 'CAT-01', authorization_id: 'AUTH-005', authorization_version: 1, region: '浙江', channel: '医院', start: '2026-06-15', end: '2026-12-15', owner: '陈晓', goal: '学术会议4场', status: '执行中', target_customer_ids: zjHosp.slice(3, 7), leads: [], opportunity_ids: ['OPP-2026-002'], activities: [
    act('A007', '2026-07-10 10:00', zjHosp[3], '学术会议', '科室会', '良好', '冯总'),
    act('A008', '2026-08-12 10:00', zjHosp[4], '学术会议', '科室会', '良好', '冯总'),
    act('A009', '2026-09-15 10:00', zjHosp[3], '业务拜访', '回访', '需求稳定', '冯总'),
    act('A010', '2026-10-18 10:00', zjHosp[5] ?? zjHosp[3], '电话沟通', '预约', '待定', '冯总'),
  ], history: [], version: 2 },
  { promotion_id: 'PRM-003', name: '克益 上海药店推广', partner_id: 'PT03', catalogue_id: 'CAT-05', authorization_id: 'AUTH-003', authorization_version: 1, region: '上海', channel: '药店', start: '2026-04-01', end: '2026-12-31', owner: '林悦', goal: '覆盖5家药店', status: '已暂停', target_customer_ids: shShop.slice(0, 4), leads: [], opportunity_ids: ['OPP-2026-010'], activities: [
    act('A011', '2026-05-10 10:00', shShop[0], '业务拜访', '产品介绍', '上架意向', '郑女士'),
    act('A012', '2026-06-18 10:00', shShop[1], '资料介绍', '资料', '待定', '郑女士'),
    act('A013', '2026-08-20 10:00', shShop[0], '电话沟通', '回访', '稳定', '郑女士'),
  ], history: [{ at: '2026-10-08 14:05', by: '系统', action: '暂停', detail: '关联授权 AUTH-003 已暂停' }], version: 4 },
  { promotion_id: 'PRM-004', name: '安莫灵0.5g 宁波药店推广', partner_id: 'PT04', catalogue_id: 'CAT-02', authorization_id: 'AUTH-004', authorization_version: 1, region: '浙江', channel: '药店', start: '2025-11-01', end: '2026-10-31', owner: '陈晓', goal: '覆盖8家药店', status: '已完成', target_customer_ids: zjShop.slice(0, 5), leads: [], opportunity_ids: [], activities: [
    act('A014', '2025-12-05 10:00', zjShop[0], '业务拜访', '介绍', '上架', '王经理'),
    act('A015', '2026-02-10 10:00', zjShop[1], '业务拜访', '介绍', '上架', '王经理'),
    act('A016', '2026-04-11 10:00', zjShop[2], '业务拜访', '介绍', '待定', '王经理'),
    act('A017', '2026-06-08 10:00', zjShop[0], '电话沟通', '回访', '稳定', '王经理'),
  ], history: [{ at: '2026-10-31 18:00', by: '陈晓', action: '完成', detail: '计划期结束' }], version: 5 },
  { promotion_id: 'PRM-005', name: '糖舒平 江苏推广筹备', partner_id: 'PT02', catalogue_id: 'CAT-03', authorization_id: 'AUTH-002', authorization_version: 1, region: '江苏', channel: '全部渠道', start: '2026-12-01', end: '2027-05-31', owner: '林悦', goal: '首批覆盖10家客户', status: '草稿', target_customer_ids: jsAll.slice(0, 5), leads: [], opportunity_ids: ['OPP-2026-003'], activities: [], history: [], version: 1 },
  { promotion_id: 'PRM-006', name: '脂安 上海年末推广', partner_id: 'PT02', catalogue_id: 'CAT-07', authorization_id: 'AUTH-008', authorization_version: 1, region: '上海', channel: '全部渠道', start: '2026-11-01', end: '2026-12-31', owner: '赵宁', goal: '维护既有客户', status: '待执行', target_customer_ids: shAll.slice(0, 4), leads: [], opportunity_ids: ['OPP-2026-009'], activities: [
    act('A018', '2026-10-28 10:00', shAll[0], '电话沟通', '计划沟通', '配合', '赵宁'),
  ], history: [], version: 1 },
];

export const initialTasks: Task[] = [
  { task_id: 'T001', title: '核查芬舒批次 B2511X1 临期处理', kind: '业务待办', object_type: '批次', object_ids: ['B2511X1'], suggestion: '核查库存状态，联系既有客户核实需求', assignee: '陈晓', due_at: '2026-11-10', status: '待处理', evidence_desc: '库存快照 2026-11-03 08:00', created_at: '2026-11-02', source: '手工' },
  { task_id: 'T002', title: '跟进络平江苏医院供货条件', kind: '业务待办', object_type: '招商机会', object_ids: ['OPP-2026-005'], suggestion: '确认供货周期', assignee: '赵宁', due_at: '2026-10-28', status: '待处理', created_at: '2026-09-20', source: '招商跟进' },
  { task_id: 'T003', title: '补充格宁学术资料', kind: '业务待办', object_type: '招商机会', object_ids: ['OPP-2026-006'], suggestion: '补临床资料', assignee: '赵宁', due_at: '2026-11-08', status: '处理中', created_at: '2026-10-20', source: '招商跟进' },
  { task_id: 'T004', title: '复核8月重复导入记录', kind: '业务待办', object_type: '数据质量', object_ids: ['L-DUP'], suggestion: '确认重复导入的2条记录已去重', assignee: '数据组', due_at: '2026-11-05', status: '待处理', created_at: '2026-09-16', source: '手工' },
  { task_id: 'T005', title: '补充莫匹罗星软膏单位转换规则', kind: '业务待办', object_type: '主数据', object_ids: ['SKU-026'], suggestion: '主数据补充转换规则', assignee: '数据组', due_at: '2026-11-15', status: '待处理', created_at: '2026-10-25', source: '手工' },
  { task_id: 'T006', title: '核查银杏叶片无销售库存', kind: '业务待办', object_type: '药品', object_ids: ['SKU-029'], suggestion: '评估调拨或处置', assignee: '陈晓', due_at: '2026-11-20', status: '待处理', created_at: '2026-10-30', source: '手工' },
  { task_id: 'T007', title: '脂安授权到期续期评估', kind: '业务待办', object_type: '授权', object_ids: ['AUTH-008'], suggestion: '评估是否续期', assignee: '赵宁', due_at: '2026-11-15', status: '待处理', created_at: '2026-10-26', source: '手工' },
  { task_id: 'T008', title: '温州线索约见面谈', kind: '业务待办', object_type: '招商机会', object_ids: ['OPP-2026-007'], suggestion: '约见面谈', assignee: '陈晓', due_at: '2026-10-30', status: '待处理', created_at: '2026-10-12', source: '招商跟进' },
  { task_id: 'T009', title: '申城工作室资质更新', kind: '业务待办', object_type: '授权', object_ids: ['AUTH-003'], suggestion: '收集新资质文件后评估恢复', assignee: '林悦', due_at: '2026-11-12', status: '处理中', created_at: '2026-10-08', source: '手工' },
  { task_id: 'T010', title: '9月调拨数量差异核对', kind: '业务待办', object_type: '调拨', object_ids: [], suggestion: '核对出入库差异10件', assignee: '数据组', due_at: '2026-10-20', status: '已完成', created_at: '2026-10-05', source: '手工' },
  { task_id: 'T011', title: 'Q3经营简报整理', kind: '业务待办', object_type: '报告', object_ids: [], suggestion: '', assignee: '陈晓', due_at: '2026-10-10', status: '已完成', created_at: '2026-10-01', source: '手工' },
  { task_id: 'T012', title: '安莫灵推广拜访绍兴医院', kind: '业务待办', object_type: '推广计划', object_ids: ['PRM-001'], suggestion: '拜访', assignee: '陈晓', due_at: '2026-11-05', status: '待处理', created_at: '2026-10-22', source: '推广计划' },
];

export const initialJobs: JobRecord[] = [
  { job_id: 'J001', kind: '导入', name: '经销商流向 2026-08（文件导入）', status: '成功', rows: 214, created_at: '2026-09-15 10:02', scope: '浙江', error: '2条重复记录已按来源ID去重' },
  { job_id: 'J002', kind: '导出', name: '批号库存查询 导出', status: '失败', rows: 0, created_at: '2026-10-30 17:20', scope: '全部', error: '演示：导出超时，请缩小条件后重试' },
];

export const knowledgeDocs: KnowledgeDoc[] = [
  { doc_id: 'KD-01', title: '安莫灵产品招商手册', version: 'v2.0', effective_date: '2026-05-01', status: '有效', catalogue_id: 'CAT-01', snippets: ['适用渠道：医院、药店；需提供合作主体资质与区域说明。', '招商资料以本版本为准，v1.0 自 2026-05-01 起失效。'] },
  { doc_id: 'KD-01v1', title: '安莫灵产品招商手册', version: 'v1.0', effective_date: '2025-09-01', status: '已失效', catalogue_id: 'CAT-01', snippets: ['适用渠道：医院。'] },
  { doc_id: 'KD-03', title: '糖舒平产品资料', version: 'v1.1', effective_date: '2026-03-01', status: '有效', catalogue_id: 'CAT-03', snippets: ['两种规格：0.5g×20片、0.85g×30片，不可互相替代统计。'] },
  { doc_id: 'KD-06', title: '芬舒产品资料', version: 'v1.0', effective_date: '2026-04-01', status: '有效', catalogue_id: 'CAT-06', snippets: ['布洛芬缓释胶囊，储存条件：密封，阴凉干燥处。'] },
  { doc_id: 'KD-90', title: '招商合作管理制度（演示）', version: 'v3.0', effective_date: '2026-01-01', status: '有效', snippets: ['合作确认后应形成授权草稿，经有权人员确认后方可生效。', '授权到期需续期形成新版本，不得通过恢复操作延续。'] },
  { doc_id: 'KD-91', title: '临期药品处理规范（演示）', version: 'v1.2', effective_date: '2026-02-01', status: '有效', snippets: ['临期观察窗口为30/60/90天；处理前应核查库存状态与货权。'] },
  { doc_id: 'KD-92', title: '流向数据导入操作手册', version: 'v1.0', effective_date: '2026-03-15', status: '有效', snippets: ['按来源系统+来源明细ID去重；无稳定ID时保留冲突清单。'] },
  { doc_id: 'KD-93', title: '招商合作管理制度（旧版）', version: 'v2.0', effective_date: '2025-01-01', status: '已失效', snippets: ['（已失效）合作确认即视为授权。'] },
];

export const PEOPLE = ['陈晓', '林悦', '赵宁', '数据组'];
export const CHANNELS = ['医院', '药店', '商业公司'];
