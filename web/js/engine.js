/* engine.js · 测算内核（纯函数，零 DOM，可单测 / 可在 Worker 里跑） */
import { SHULI, CIGROUP, CIPAIR, CIZERO, FIVE, CARRIER, TAIL, NUM,
         fmtNum, numLevel, LEVEL_W, carrierOf } from './data.js?v=20260929v';

/* ---------- 工具 ---------- */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* 剥国际区号（+86 / 0086 / 86）。
   这是「剥区号」的唯一实现：输入框与校验都必须先做这步再谈长度，
   否则粘贴 "+8613800138000" 会被截成 "86138001380"（错的号码），校验层救不回来。 */
function stripCC(digits) {
  if (digits.length > 11) {
    if (digits.startsWith('0086')) return digits.slice(4);
    if (digits.startsWith('86')) return digits.slice(2);
  }
  return digits;
}

/* 输入框用：剥区号后硬截 11 位（输入框本就是 11 位硬上限） */
export function normalizeInput(raw) {
  return stripCC(String(raw || '').replace(/\D/g, '')).slice(0, 11);
}

/* 校验用：剥区号后不静默截断 —— 超长仍应报错，
   避免把「两串号码粘在一起」这类输入悄悄算错号 */
export function validate(raw) {
  const digits = stripCC(String(raw || '').replace(/\D/g, ''));
  if (digits.length === 0) return { ok: false, err: '请输入手机号码' };
  if (digits.length < 11) return { ok: false, err: `还差 ${11 - digits.length} 位（已输入 ${digits.length} 位）` };
  if (digits.length > 11) {
    return { ok: false, err: `手机号为 11 位，当前 ${digits.length} 位；若含国际区号可直接粘贴（+86 会自动识别）` };
  }
  if (digits[0] !== '1') return { ok: false, err: '大陆手机号以 1 开头' };
  if (digits[1] === '0' || digits[1] === '1' || digits[1] === '2') {
    return { ok: false, err: `1${digits[1]}x 不是有效号段` };
  }
  return { ok: true, num: digits };
}

/* 全站统一的号码读法：3-4-4（号段 3 位 + HLR 4 位 + 用户号 4 位）。
   唯一实现：结果卡 / 历史 / 对比条 / 分享图都必须用它，禁止再造缩写格式。 */
export const fmtFull = n => `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;

/* ---------- 选号推荐 ---------- */
/* 五行 → 数字（河图）；星 → 两两组合（由 CIPAIR 反转） */
export const DIGITS_OF = { 水: ['1', '6'], 火: ['2', '7'], 木: ['3', '8'], 金: ['4', '9'], 土: ['5', '0'] };
const PAIRS_OF = (() => {
  const m = {};
  for (const [p, v] of Object.entries(CIPAIR)) (m[v.g] = m[v.g] || []).push(p);
  return m;
})();
/* 维度 → 对其有正贡献的星（与 profile() 的系数方向一致） */
const DIM_GOOD = {
  cai: ['tiany', 'shengqi'], shi: ['yinian', 'fuwei'], qing: ['tiany', 'shengqi'],
  jian: ['tiany', 'shengqi'], ren: ['shengqi', 'tiany']
};
const DIM_NAMES = { cai: '财运', shi: '事业', qing: '感情', jian: '健康', ren: '人际' };

/* 吉利号型模板：生成尾 4 位（或尾 3 位豹子）。
   候选数字避开 4（noFour），优先用补缺数字——号型与补缺同向时一举两得。 */
function shapeLast4(shape, fillD, allowed, rng) {
  const lucky = ['8', '6', '9', '2', '3', '7', '1'].filter(allowed);
  /* fillD 与 lucky 拼接（不去重）= 补缺数字权重 ×2，属有意加权：
     号型与补缺同向时一举两得。实测会系统性偏好补缺元素
     （如感情弱 + 补火 → 豹子倾向 777），这是分数排名的真实结果，非偶然。 */
  const pool = fillD.filter(allowed).concat(lucky);
  const d = () => pool[Math.floor(rng() * pool.length)];
  if (shape === 'baozi') { const c = d(); return c + c + c; }            // 尾3连
  if (shape === 'duizi') { let a = d(), b = d(); while (b === a) b = d(); return a + a + b + b; }
  if (shape === 'xunhuan') { let a = d(), b = d(); while (b === a) b = d(); return a + b + a + b; }
  if (shape === 'shunzi') {
    const starts = ['0', '5', '6', '7'].filter(s =>
      [0, 1, 2, 3].every(k => allowed(String((+s + k) % 10))));
    if (!starts.length) return null;
    const s = +starts[Math.floor(rng() * starts.length)];
    return [0, 1, 2, 3].map(k => String((s + k) % 10)).join('');
  }
  return null;
}

/* ---------- 方案存储的校验（纯函数，可单测） ----------
   与 compare 的快照同理：localStorage 里的东西一律当不可信数据，
   版本迭代或手改都可能留下畸形条目，读回必须逐字段校验。 */
export const REC_TARGETS = ['auto', 'all', 'cai', 'shi', 'qing', 'jian', 'ren'];
export const REC_SHAPES = ['any', 'baozi', 'shunzi', 'duizi', 'xunhuan'];

export function sanitizeRec(o) {
  if (!o || typeof o !== 'object') return null;
  if (!REC_TARGETS.includes(o.target) || !REC_SHAPES.includes(o.shape)) return null;
  if (typeof o.fill !== 'boolean' || typeof o.noFour !== 'boolean') return null;
  return { target: o.target, shape: o.shape, fill: o.fill, noFour: o.noFour };
}

export const isPlan = p => !!p && typeof p === 'object'
  && Number.isFinite(p.ts)
  && typeof p.base === 'string' && /^1\d{10}$/.test(p.base)
  && !!sanitizeRec(p.opts)
  && Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 6
  && p.items.every(x => !!x && typeof x.num === 'string' && /^1\d{10}$/.test(x.num)
    && Number.isFinite(x.total) && typeof x.g === 'string'
    && Number.isFinite(x.deltaDim) && Number.isFinite(x.deltaTotal));

export const sanitizePlans = arr => Array.isArray(arr) ? arr.filter(isPlan).slice(0, 6) : [];

/**
 * recommend(num, opts)：基于原号生成候选号并排序。
 * @param opts.target 'auto'(最弱维) | 'all'(综合) | 'cai'|'shi'|'qing'|'jian'|'ren'
 * @param opts.shape  'any'|'baozi'|'shunzi'|'duizi'|'xunhuan'
 * @param opts.fill   五行补缺（候选须覆盖原号缺失元素），默认 true
 * @param opts.noFour 避开数字 4，默认 true
 * @param opts.rng    可注入伪随机（测试用），默认 Math.random
 * @returns {ok, base, dimKey, list:[{num,total,g,luck,dims,deltaDim,deltaTotal,reasons}]}
 */
export function recommend(num, opts = {}) {
  const base = analyze(num);
  if (!base.ok) return { ok: false, err: base.err };

  const rng = opts.rng || Math.random;
  const target = opts.target || 'auto';
  const shape = opts.shape || 'any';
  const noFour = opts.noFour !== false;
  const wantFill = opts.fill !== false;
  const allowed = d => !noFour || d !== '4';
  const pick = arr => arr[Math.floor(rng() * arr.length)];

  const dimKey = target === 'auto'
    ? [...base.dims].sort((a, b) => a.v - b.v)[0].k
    : (target === 'all' ? null : target);
  const dimName = dimKey ? DIM_NAMES[dimKey] : '综合';

  /* 候选吉星对池（含 4 则剔除该对） */
  const goodPairs = (dimKey ? DIM_GOOD[dimKey] : ['tiany', 'yinian', 'shengqi', 'fuwei'])
    .flatMap(g => PAIRS_OF[g] || [])
    .filter(p => [...p].every(allowed));
  const fillD = wantFill ? base.five.missing.flatMap(e => DIGITS_OF[e]) : [];

  const genTail = () => {
    /* 前两对（吉星，权重低）+ 后 4 位（形态模板或另两对吉星）= 恒 8 位 */
    const parts = [pick(goodPairs), pick(goodPairs)];
    const last4 = shape !== 'any' ? shapeLast4(shape, fillD, allowed, rng) : null;
    if (last4 && last4.length === 3) parts.push(pick(goodPairs)[0] + last4);
    else if (last4) parts.push(last4);
    else parts.push(pick(goodPairs), pick(goodPairs));
    const tail = parts.join('').split('');
    /* 五行补缺注入：只动非形态位（形态尾保持完整） */
    if (fillD.length) {
      const slots = shape !== 'any' ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5];
      for (const e of base.five.missing) {
        if (!tail.some(c => DIGITS_OF[e].includes(c))) {
          const cand = DIGITS_OF[e].filter(allowed);
          if (cand.length) tail[pick(slots)] = pick(cand);
        }
      }
    }
    return tail.join('');
  };

  const seen = new Set([num]);
  const cands = [];
  let guard = 0;
  while (cands.length < 140 && guard++ < 4000) {
    const n = num.slice(0, 3) + genTail();
    if (seen.has(n)) continue;
    seen.add(n);
    if (wantFill && base.five.missing.some(e => !n.split('').some(c => DIGITS_OF[e].includes(c)))) continue;
    cands.push(n);
  }

  const rank = r => dimKey
    ? r.dims.find(d => d.k === dimKey).v * 0.65 + r.total * 0.35
    : r.total;

  const list = cands
    .map(n => analyze(n)).filter(r => r.ok)
    .map(r => {
      const bd = base.dims.find(d => d.k === dimKey) || { v: base.total };
      const rd = dimKey ? r.dims.find(d => d.k === dimKey) : { v: r.total };
      /* 理由：与原号逐项对比，只说真发生的变化 */
      const reasons = [];
      const covered = base.five.missing.filter(e => (r.five.cnt[e] || 0) > 0);
      if (covered.length) {
        reasons.push({ t: '五行', d: `补${covered.join('、')}：` +
          covered.map(e => `${e}用${DIGITS_OF[e].filter(allowed).join('/')}`).join('，') });
      }
      const lastPair = r.magnet.groups[r.magnet.groups.length - 1];
      const lg = CIGROUP[lastPair.info.g];
      if (lg && lg.lucky > 0) {
        reasons.push({ t: '尾磁', d: `尾入${lastPair.info.n}（${lastPair.pair}），全盘落点` });
      }
      const feats = r.pattern.feats.filter(f => f.k === 'good').slice(0, 2).map(f => f.t);
      if (feats.length) reasons.push({ t: '号型', d: feats.join('；') });
      const fmtD = (a, b) => `${Math.round(b)}（${b - a >= 0 ? '+' : ''}${(b - a).toFixed(1)}）`;
      reasons.push({ t: '对比', d: dimKey
        ? `${dimName} ${fmtD(bd.v, rd.v)} · 综合 ${fmtD(base.total, r.total)}`
        : `综合 ${fmtD(base.total, r.total)}` });
      return {
        num: r.num, total: r.total, g: r.grade.grade, luck: r.grade.luck,
        dims: r.dims.map(d => Math.round(d.v)),
        deltaDim: +(rd.v - bd.v).toFixed(1), deltaTotal: +(r.total - base.total).toFixed(1),
        reasons
      };
    })
    .sort((a, b) => rank(analyze(b.num)) - rank(analyze(a.num)) || b.total - a.total)
    .slice(0, 6);

  return { ok: true, base, dimKey, dimName, list };
}
/* ---------- ① 81 数理灵数 ---------- */
export function shuLi(num) {
  const last4 = parseInt(num.slice(-4), 10);
  const r = last4 % 80;
  const idx = r === 0 ? 80 : r;
  return { last4, idx, ...SHULI[idx], point: 30 + SHULI[idx].w * 70 };
}

/* ---------- ② 八星数字磁场 ---------- */
/* 去号段（前 3 位为「先天号段」，只作展示），后 8 位两两分组 = 4 组磁场。
   权重：越靠后影响越大（1 / 1.2 / 1.5 / 2）——尾号定盘的通行说法。 */
const PAIR_W = [1, 1.2, 1.5, 2];

/* 五维原始分的离线标定值（mu=均值, sd=标准差），由 scripts/calibrate.mjs 实测填入。
   作用：把各维原始分映射到统一标尺，使五个维度跨维可比。
   改任何维度系数后必须重跑标定，否则雷达形状会失真。 */
const RAW = {
  cai:  { mu: 56.23, sd: 7.59 },
  shi:  { mu: 60.39, sd: 6.73 },
  qing: { mu: 58.89, sd: 6.63 },
  jian: { mu: 60.35, sd: 7.32 },
  ren:  { mu: 61.95, sd: 6.88 }
};

export function magnet(num) {
  const body = num.slice(3);            // 8 位
  const groups = [];
  let raw = 0;                          // 加权吉凶分（-2 ~ +2 每单位权重）
  let wsum = 0;

  for (let i = 0; i < body.length; i += 2) {
    const pair = body.slice(i, i + 2);
    const w = PAIR_W[i / 2];
    const gi = i / 2;
    const meta = { pair, weight: w, pos: gi, zero: [], strong: false, info: null };

    /* 0 / 5 的处理（数字能量学通行规则）
       5 = 强化：放大同组主能量；0 = 空亡：削弱/隐藏主能量。
       含 0 或 5 的组合不构成八星磁场对，先剥离再判断剩余部分。 */
    let core = pair;
    for (const ch of pair) {
      if (ch === '0') meta.zero.push('0');
      if (ch === '5') meta.strong = true;
    }
    core = pair.replace(/[05]/g, '');

    if (core.length === 2 && CIPAIR[core]) {
      meta.info = { ...CIPAIR[core], lucky: CIGROUP[CIPAIR[core].g].lucky };
    } else if (core.length === 0) {
      meta.info = { ...CIZERO, g: 'zero' };
    } else {
      /* 50 / 05 / 55 / 00 / 单数字残余 —— 归入「隐数」 */
      meta.info = { ...CIZERO, g: 'zero', n: '隐数', tag: pair.split('').map(d => NUM[d].t).join('') };
    }

    let g = meta.info.w;
    if (meta.strong) g *= 1.35;                     // 5 放大
    if (meta.zero.length) g *= (meta.zero.length > 1 ? 0.35 : 0.6);  // 0 削弱
    meta.eff = g;
    raw += g * w;
    wsum += w;
    groups.push(meta);
  }

  const base = raw / (wsum * 2) * 100;              // -100 ~ +100
  return { groups, body, score: clamp(70 + base * 0.30, 0, 100), raw };
}

/* ---------- ③ 河图五行 ---------- */
export function fiveElement(num) {
  const cnt = { 水: 0, 火: 0, 木: 0, 金: 0, 土: 0 };
  for (const d of num) cnt[FIVE[d].e]++;
  const total = num.length;
  const keys = Object.keys(cnt);
  const ideal = total / 5;
  const missing = keys.filter(k => cnt[k] === 0);
  const counts = keys.map(k => cnt[k]);
  const varSum = counts.reduce((s, c) => s + Math.abs(c - ideal), 0);
  const maxK = keys.reduce((a, b) => (cnt[a] >= cnt[b] ? a : b));
  const minK = keys.reduce((a, b) => (cnt[a] <= cnt[b] ? a : b));

  /* 相生链：水→木→火→土→金→水；相邻两位相生加分，相克扣分 */
  const SHENG = { 水: '木', 木: '火', 火: '土', 土: '金', 金: '水' };
  const KE = { 水: '火', 火: '金', 金: '木', 木: '土', 土: '水' };
  let flow = 0, flowNote = [];
  const seq = [...num].map(d => FIVE[d].e);
  for (let i = 0; i < seq.length - 1; i++) {
    if (SHENG[seq[i]] === seq[i + 1]) { flow += 1; }
    else if (KE[seq[i]] === seq[i + 1]) { flow -= 1.4; flowNote.push(`${seq[i]}克${seq[i + 1]}`); }
    else if (SHENG[seq[i + 1]] === seq[i]) { flow += 0.4; }
    else if (KE[seq[i + 1]] === seq[i]) { flow -= 0.7; }
  }

  /* 均衡度：完全均衡 = 100，越偏越低 */
  const evenness = clamp(100 - (varSum / total) * 100 * 0.85, 0, 100);
  const flowScore = clamp(50 + flow * 5, 0, 100);
  const score = clamp(evenness * 0.5 + flowScore * 0.4 + 8 - missing.length * 2.5, 0, 100);

  return { cnt, total, missing, dominant: maxK, weakest: minK, evenness, flow,
           flowNote: [...new Set(flowNote)], score, seq };
}

/* ---------- ④ 号码形态 ---------- */
export function pattern(num) {
  const feats = [];
  let score = 62;                 // 形态基准分（大多数号码是普通号）

  const digits = [...num];
  const d = num.slice(3);         // 用户号（8 位）

  /* 豹子：连续 3 位以上相同 */
  const rep = /(\d)\1{2,}/.exec(num);
  if (rep) {
    const L = rep[0].length;
    const n = NUM[rep[1]].n;
    if (L >= 4) { feats.push({ k: 'neutral', t: `${L} 连豹子号「${rep[0]}」`, d: `同一数字连出 ${L} 位（${n}），极稀有号型。传统视为「气场极纯」，能量强而单一，主大起大落；商业上辨识度极高，本身即资产。` }); score += 16; }
    else { feats.push({ k: 'good', t: `三连豹子「${rep[0]}」`, d: `${n} 连出三位，号型稀有，记忆点强。` }); score += 12; }
  }

  /* 顺子：连续 4 位以上递增 / 递减 */
  let asc = 1, desc = 1, bestAsc = 1, bestDesc = 1, ascAt = 0, descAt = 0;
  for (let i = 1; i < num.length; i++) {
    const a = +num[i - 1], b = +num[i];
    asc = (b === a + 1) ? asc + 1 : 1;
    desc = (b === a - 1) ? desc + 1 : 1;
    if (asc > bestAsc) { bestAsc = asc; ascAt = i - asc + 1; }
    if (desc > bestDesc) { bestDesc = desc; descAt = i - desc + 1; }
  }
  if (bestAsc >= 4) {
    const s = num.slice(ascAt, ascAt + bestAsc);
    feats.push({ k: 'good', t: `步步高升「${s}」`, d: `${bestAsc} 位连续递增。数理取「节节高」之象，主运势顺势而上、贵人递接，是号型中最受欢迎的一类。` });
    score += 10 + bestAsc;
  }
  if (bestDesc >= 4) {
    const s = num.slice(descAt, descAt + bestDesc);
    feats.push({ k: 'neutral', t: `倒顺「${s}」`, d: `${bestDesc} 位连续递减。顺而下行，主「收」不主「放」：守成、回笼资金有力，开拓稍弱。` });
    score += 4;
  }

  /* 对子（AABB / ABAB） */
  const aabb = /(\d)\1(\d)\2/.exec(num);
  if (aabb) { feats.push({ k: 'good', t: `对子连「${aabb[0]}」`, d: `AABB 双对结构，主稳定、成双，人缘与家宅平顺。` }); score += 6; }
  const abab = /(\d)\1?(\d)\1\2/.exec(num);
  if (!aabb && /(\d)(\d)\1\2/.exec(num)) {
    const m = /(\d)(\d)\1\2/.exec(num);
    feats.push({ k: 'good', t: `循环对「${m[0]}」`, d: `ABAB 往复结构，主反复得财、机会循环，适合业务型号码。` }); score += 6;
  }

  /* 首尾呼应 */
  if (num[0] === num[10]) { feats.push({ k: 'good', t: '首尾同数', d: '号首与号尾同一数字，取「有始有终」之象。' }); score += 3; }

  /* 含 4 计数 */
  const four = (num.match(/4/g) || []).length;
  if (four >= 3) { feats.push({ k: 'bad', t: `数字 4 出现 ${four} 次`, d: `4 属金（河图 4/9 金），谐音「世」亦谐「死」，民间忌讳较重。数理上金多主刚硬、决断力强而少圆融；若本人五行喜金，反为助力。` }); score -= 12; }
  else if (four === 2) { feats.push({ k: 'neutral', t: '数字 4 出现 2 次', d: '民间避讳之数，但两位分散不构成号型缺陷；河图属金，主决断。' }); score -= 4; }
  else if (four === 1) { feats.push({ k: 'neutral', t: '含 1 个 4', d: '单点出现，影响轻微。' }); score -= 1; }

  /* 全号相同数字种类过少 */
  const kinds = new Set(digits).size;
  if (kinds <= 3) { feats.push({ k: 'neutral', t: `全号仅 ${kinds} 种数字`, d: `五行覆盖面窄（只用 ${kinds} 种数），能量纯但不全，宜以姓名 / 车牌等其它号码补足缺失五行。` }); score -= 4; }
  if (kinds >= 9) { feats.push({ k: 'good', t: `${kinds} 种数字齐备`, d: '十数得其九，五行俱全，气场流通无死角。' }); score += 7; }

  /* 尾号寓意 */
  const t = +num[10];
  const tail = TAIL[t];
  feats.push({ k: tail.w >= 0.5 ? 'good' : (tail.w <= -0.5 ? 'bad' : 'neutral'),
               t: `尾号 ${t} · ${tail.n}`, d: tail.d });
  score += tail.w * 9;

  /* 末两位 */
  const last2 = num.slice(-2);
  if (CIPAIR[last2] && CIPAIR[last2].g !== 'zero') {
    const gi = CIPAIR[last2].g, g = CIGROUP[gi];
    feats.push({ k: g.lucky > 0 ? 'good' : 'bad', t: `收尾磁场 · ${g.n}`,
                 d: `号码最后两位「${last2}」为${g.n}磁场（${g.t.join('/')}），全盘能量的落点：${g.d}` });
  }

  if (!feats.some(f => f.k === 'good')) {
    feats.push({ k: 'neutral', t: '号型平实', d: '未见豹子、顺子、对子等稀有结构，属常规号型。稀有号型是市场溢价因素，与吉凶无必然关系。' });
  }

  return { feats, score: clamp(score, 0, 100), kinds, fourCount: four };
}

/* ---------- ⑤ 五维画像 ---------- */
export function profile(num, sl, mg, fe, pt) {
  const G = mg.groups.map(g => g.info.g);
  const W = mg.groups.map(g => g.weight * (g.eff / (g.info.w || 1)));   // 已含 0/5 修正的权重
  /* 归一化到 0~1：同一星最多可占满四个位置（权重和 = WSUM），
     不归一会让 cnt×系数直接冲穿 clamp，导致维度普遍顶到 99 而失去区分度。 */
  const WSUM = PAIR_W.reduce((a, b) => a + b, 0);
  const cnt = k => G.reduce((s, g, i) => s + (g === k ? W[i] : 0), 0) / WSUM;

  /* 财：天医主正财，绝命主偏财但漏，祸害耗财，0 为暗财/空 */
  let cai = 58 + cnt('tiany') * 30 - cnt('jueming') * 16 + cnt('shengqi') * 9
            - cnt('huohai') * 13 - cnt('zero') * 8 + (fe.cnt['金'] - 2.2) * 3;
  /* 事业：延年主专业与掌权，五鬼主创意但动荡，伏位主守 */
  let shi = 58 + cnt('yinian') * 32 + cnt('wugui') * 9 - cnt('liusha') * 11
            + cnt('fuwei') * 4 - cnt('jueming') * 9 + (fe.cnt['木'] - 2.2) * 2.5;
  /* 感情：六煞主桃花纠葛，天医主正缘，伏位主冷 */
  let qing = 60 - cnt('liusha') * 28 + cnt('tiany') * 20 - cnt('fuwei') * 9
             + cnt('shengqi') * 11 - cnt('wugui') * 8 + (fe.cnt['火'] - 2.2) * 2.5;
  /* 健康：祸害主病痛口舌，绝命主意外，天医主康健 */
  let jian = 62 - cnt('huohai') * 28 - cnt('jueming') * 17 + cnt('tiany') * 22
             + cnt('shengqi') * 8 - cnt('wugui') * 8 + (fe.cnt['土'] - 2.2) * 2.5;
  /* 人际：生气主贵人，祸害主小人，六煞主人缘旺但杂 */
  let ren = 58 + cnt('shengqi') * 32 - cnt('huohai') * 20 + cnt('liusha') * 8
            + cnt('yinian') * 6 + (fe.cnt['水'] - 2.2) * 2.5;

  /* 数理灵数与号型的整体牵引。
     关键：这两项对五个维度是等量叠加，只会平移五边形、不产生形状差异。
     早期版本系数过大（pull 最大 ±11、shapePull ±8），公共分量压过差异分量，
     导致 50% 的号码雷达"极差 < 15"、五边形几乎一样。
     现降到 0.22 倍，只作轻微底色；数理的分量主要由「总分」那条轴承担（权重 26%）。 */
  const pull = (sl.w - 0.5) * 22 * 0.22;
  const shapePull = (pt.score - 62) * 0.22 * 0.22;

  /* 各维原始分 → 目标分布。
     RAW_MU / RAW_SD 为离线实测的原始分均值与标准差（见 calibrate 脚本），
     映射到 目标均值 62、目标标准差 13.5 —— 
     这样五个维度共享同一标尺：p10≈45 / p50≈62 / p90≈80，跨维可比、雷达有形。 */
  const fit = (v, mu, sd) => clamp(62 + (v - mu) * (13.5 / sd), 5, 97);

  const raw = [
    { k: 'cai',  n: '财运', v: cai + pull + shapePull },
    { k: 'shi',  n: '事业', v: shi + pull + shapePull },
    { k: 'qing', n: '感情', v: qing + pull + shapePull },
    { k: 'jian', n: '健康', v: jian + pull + shapePull },
    { k: 'ren',  n: '人际', v: ren + pull + shapePull },
  ];
  return raw.map(o => {
    const v = fit(o.v, RAW[o.k].mu, RAW[o.k].sd);
    return { k: o.k, n: o.n, v, d: dimText(o.k, v, G, fe) };
  });
}

/* 离线标定用：返回五维「原始分」（未经 fit 映射），供 calibrate 脚本统计 mu/sd。
   生产路径不依赖它，保留是为了下次改系数时能一键重标。 */
export function rawDims(num) {
  const v = validate(num);
  if (!v.ok) return null;
  const sl = shuLi(v.num), mg = magnet(v.num), fe = fiveElement(v.num), pt = pattern(v.num);
  const G = mg.groups.map(g => g.info.g);
  const W = mg.groups.map(g => g.weight * (g.eff / (g.info.w || 1)));
  const WSUM = PAIR_W.reduce((a, b) => a + b, 0);
  const cnt = k => G.reduce((s, g, i) => s + (g === k ? W[i] : 0), 0) / WSUM;
  const pull = (sl.w - 0.5) * 22 * 0.22;
  const shapePull = (pt.score - 62) * 0.22 * 0.22;
  return {
    cai: 58 + cnt('tiany') * 30 - cnt('jueming') * 16 + cnt('shengqi') * 9
         - cnt('huohai') * 13 - cnt('zero') * 8 + (fe.cnt['金'] - 2.2) * 3 + pull + shapePull,
    shi: 58 + cnt('yinian') * 32 + cnt('wugui') * 9 - cnt('liusha') * 11
         + cnt('fuwei') * 4 - cnt('jueming') * 9 + (fe.cnt['木'] - 2.2) * 2.5 + pull + shapePull,
    qing: 60 - cnt('liusha') * 28 + cnt('tiany') * 20 - cnt('fuwei') * 9
          + cnt('shengqi') * 11 - cnt('wugui') * 8 + (fe.cnt['火'] - 2.2) * 2.5 + pull + shapePull,
    jian: 62 - cnt('huohai') * 28 - cnt('jueming') * 17 + cnt('tiany') * 22
          + cnt('shengqi') * 8 - cnt('wugui') * 8 + (fe.cnt['土'] - 2.2) * 2.5 + pull + shapePull,
    ren: 58 + cnt('shengqi') * 32 - cnt('huohai') * 20 + cnt('liusha') * 8
         + cnt('yinian') * 6 + (fe.cnt['水'] - 2.2) * 2.5 + pull + shapePull,
  };
}

function dimText(k, v, G, fe) {
  const has = x => G.includes(x);
  const T = {
    cai: [
      has('tiany') ? '天医磁场在盘，正财路清晰，收入与付出成正比。' : '盘中无天医，正财需靠专业与积累硬挣，横财无缘。',
      has('jueming') ? '但绝命同现，进财快漏财也快，切忌加杠杆与替人担保。' : '',
      has('huohai') ? '祸害磁场主口舌耗财，合同纠纷与言语失分是主要漏点。' : '',
      fe.cnt['金'] >= 4 ? '五行金旺，决断与执行力是财路来源。' : (fe.cnt['金'] === 0 ? '五行缺金，收敛与议价能力偏弱，报价时容易心软。' : ''),
    ],
    shi: [
      has('yinian') ? '延年磁场在盘，专业能力与掌权欲兼具，适合做到「负责人」这一层。' : '盘中无延年，靠职位驱动的路走不远，宜以作品与技术立身。',
      has('wugui') ? '五鬼同现，创意与应变是长项，但耐不住重复性工作，容易中途换赛道。' : '',
      has('fuwei') ? '伏位磁场主蓄势，早年平台期长，属于后发型。' : '',
      fe.cnt['木'] >= 4 ? '五行木旺，生发之气足，新开局比守旧摊更容易出成绩。' : '',
    ],
    qing: [
      has('liusha') ? '六煞磁场在盘，情感浓度高、共情力强，也更容易被关系反复消耗。' : '盘中无六煞，情感表达偏克制，关系稳定但热度不高。',
      has('tiany') ? '天医同现，正缘质量高，伴侣往往同时是贵人。' : '',
      has('fuwei') ? '伏位主冷处理，争执时容易沉默，需刻意把话说开。' : '',
      fe.cnt['火'] >= 4 ? '五行火旺，情绪外露、爱憎分明。' : (fe.cnt['火'] === 0 ? '五行缺火，主动表达不足，容易被误读为冷淡。' : ''),
    ],
    jian: [
      has('huohai') ? '祸害磁场在盘，传统认为主小病不断与口腔 / 呼吸系统弱点，宜规律作息。' : '盘中无祸害，身体底盘较稳。',
      has('jueming') ? '绝命同现，注意意外与急症，忌熬夜后剧烈运动与疲劳驾驶。' : '',
      has('tiany') ? '天医磁场主康健，恢复力好。' : '',
      fe.cnt['土'] >= 4 ? '五行土旺，脾胃是重点，忌暴饮暴食。' : (fe.cnt['土'] === 0 ? '五行缺土，节律感弱，作息最容易乱。' : ''),
    ],
    ren: [
      has('shengqi') ? '生气磁场在盘，天生带贵人缘，陌生人容易对你放下防备。' : '盘中无生气，人脉靠长期兑现信誉积累，慢热但牢固。',
      has('huohai') ? '祸害同现，防口舌与背后是非，重要承诺尽量落文字。' : '',
      has('liusha') ? '六煞磁场人缘旺而杂，需学会筛人。' : '',
      fe.cnt['水'] >= 4 ? '五行水旺，沟通与流动能力强，适合跨圈层协作。' : '',
    ],
  };
  const arr = T[k].filter(Boolean);
  const band = v >= 78 ? '此项为全盘强项。' : v >= 62 ? '此项中上，正常发挥。' : v >= 46 ? '此项平平，靠后天补。' : '此项为全盘弱项，见下方化解建议。';
  return arr.join(' ') + band;
}

/* ---------- ⑥ 综合评级与建议 ---------- */
/* 档位阈值按 6000 号实测分位定标（p99≈81 / p95≈77.5 / p65≈69 / p35≈60 / p5≈51）
   目标分布 ≈ S 1.5% / A 7.5% / B 26% / C 37% / D 24% / E 4% —— 金字塔而非一刀切 */
const BANDS = [
  [80, 'S', '上上签', '大吉'],
  [75, 'A', '上签', '吉'],
  [69, 'B', '中签', '中吉'],
  [57, 'C', '中平', '平'],
  [49, 'D', '下签', '小凶'],
  [0,  'E', '下下签', '凶'],
];

export function grade(total) {
  for (const [min, g, q, l] of BANDS) if (total >= min) return { grade: g, qian: q, luck: l, min };
  return { grade: 'E', qian: '下下签', luck: '凶', min: 0 };
}

export function verdict(total, g) {
  const V = {
    S: ['号码格局完整，吉星压尾、五行不缺，属可遇不可求的一等号。', '守成即可，不必折腾；这类号码本身已有市场溢价，转手前请评估价值。'],
    A: ['盘面偏吉，主力磁场落点正，数理亦得上格。', '现有配置足以支撑长期用，重点在把优势维度用足——强项不用等于没有。'],
    B: ['吉凶相间，有明确强项也有明确漏点，属大多数号码的常态。', '不必换号。把弱项对应的行为习惯补上，比换号有效得多。'],
    C: ['能量平铺，无大吉亦无大凶，主平顺而少助力。', '号码只是背景变量，此盘之下成败几乎全在人为。'],
    D: ['盘面偏弱，凶星磁场占位较重或数理落空亡。', '可先做低成本调整（见化解建议），是否换号取决于弱项是否已实际影响生活。'],
    E: ['数理与磁场双弱，传统上视为「耗」盘。', '若近年确实诸事不顺，换号是选项之一；但先排除健康、财务与关系上的现实成因，号码不该替它们背锅。'],
  };
  return V[g] || V.C;
}

export function advice(dims, mg, fe, sl) {
  const out = [];
  const sorted = [...dims].sort((a, b) => a.v - b.v);
  const weak = sorted.slice(0, 2);

  const FIX = {
    cai: '财运弱 → 强制储蓄前置（收入到账当日划走固定比例），账户与消费账户物理隔离；忌杠杆、忌替人担保、忌与人合伙不做账。',
    shi: '事业弱 → 以「可验证的作品」代替「职位头衔」积累；每 18 个月做一次外部市场询价，避免被单一平台定价。',
    qing: '感情弱 → 冲突当下不沉默，24 小时内必须把话说完；重要承诺落成文字，减少靠默契推断的部分。',
    jian: '健康弱 → 固定作息锚点（同一时间睡 / 起），每年一次体检不可省；疲劳状态下禁止剧烈运动与长途驾驶。',
    ren: '人际弱 → 减少多角关系与传话，重要沟通一对一；主动维护 5 个以内的强关系，胜过 50 个弱连接。',
  };
  for (const w of weak) out.push({ t: `${w.n}（${Math.round(w.v)} 分）为最弱项`, d: FIX[w.k] });

  /* 五行化解 */
  if (fe.missing.length) {
    const M = fe.missing.map(m => `${m}（对应数字 ${Object.keys(FIVE).filter(d => FIVE[d].e === m).join('、')}）`).join('、');
    out.push({ t: `五行缺 ${fe.missing.join('、')}`,
      d: `缺 ${M}。传统化解：在车牌 / 门牌 / 密码 / 常用账号尾数中补入对应数字；方位与颜色按该五行取用。数理层面「缺」不等于「凶」，只表示该项能量需外部补足。` });
  }

  /* 凶星磁场化解 */
  const bad = mg.groups.filter(g => g.info.lucky < 0);
  if (bad.length >= 2) {
    out.push({ t: `凶星磁场 ${bad.length} 组（${bad.map(g => g.info.n + g.pair).join('、')}）`,
      d: '数字能量学的主张是「凶星非灾，是行为倾向」：绝命 → 决策前强制隔夜；五鬼 → 重要事项留书面与备份；祸害 → 少议论第三人；六煞 → 关系里设明确边界。把这四条当操作手册，比换号更直接。' });
  }
  if (mg.groups.some(g => g.info.g === 'zero')) {
    out.push({ t: '盘中见 0（空亡）', d: '0 主隐藏与归零：暗财可得但明财易空，重要收益务必落到可查证的账户与合同上，不要停留在口头与聊天记录里。' });
  }
  if (sl.w <= 0.2) {
    out.push({ t: `81 数理落「${sl.idx} · ${sl.n}」（${LEVEL_W[sl.w]}）`, d: `数理为「${sl.s}」，传统断语见上。这是号码的先天格，无法通过习惯改变——若此项与实际处境严重冲突，换号是唯一解；否则视为背景噪声即可。` });
  }
  return out;
}

/* ---------- ⑦ 汇总 ---------- */
export function analyze(raw) {
  const v = validate(raw);
  if (!v.ok) return v;
  const num = v.num;
  const sl = shuLi(num);
  const mg = magnet(num);
  const fe = fiveElement(num);
  const pt = pattern(num);
  const dims = profile(num, sl, mg, fe, pt);

  /* 加权总分：磁场 34% / 数理 26% / 形态 22% / 五行 18% */
  const total = clamp(
    mg.score * 0.34 + sl.point * 0.26 + pt.score * 0.22 + fe.score * 0.18, 1, 99);
  const g = grade(total);

  return {
    ok: true, num,
    fmt: `${num.slice(0, 3)} ${num.slice(3, 7)} ${num.slice(7)}`,
    carrier: carrierOf(num.slice(0, 3)),
    shuli: sl, magnet: mg, five: fe, pattern: pt, dims,
    total: Math.round(total * 10) / 10,
    grade: g, verdict: verdict(total, g.grade),
    advice: advice(dims, mg, fe, sl),
    ts: Date.now(),
  };
}
