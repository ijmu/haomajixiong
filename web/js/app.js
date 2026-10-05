/* app.js · 界面层（DOM + SVG，零 canvas） */
import { analyze, validate, normalizeInput, recommend, fmtFull,
         sanitizePlans, sanitizeRec } from './engine.js?v=20260929v';
import { CIGROUP, CIZERO, FIVE, NUM, TAIL, WUXING_ORDER, WUXING_TEXT, LEVEL_W, numLevel, carrierOf }
  from './data.js?v=20260929v';
import { initShare, drawCompareCard, exportCanvasImage } from './share.js?v=20260929v';
import { initCompare } from './compare.js?v=20260929v';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* ---------- 背景罗盘刻度 ---------- */
(function ticks() {
  const g = $('#bgTicks'); if (!g) return;
  let s = '';
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * Math.PI / 180;
    const long = i % 6 === 0;
    const r1 = long ? 152 : 168, r2 = 188;
    s += `<line x1="${(200 + Math.cos(a) * r1).toFixed(1)}" y1="${(200 + Math.sin(a) * r1).toFixed(1)}" x2="${(200 + Math.cos(a) * r2).toFixed(1)}" y2="${(200 + Math.sin(a) * r2).toFixed(1)}"/>`;
  }
  g.innerHTML = s;
})();

/* ---------- 八卦符号（起盘动画） ---------- */
(function bagua() {
  const el = $('#bagua'); if (!el) return;
  const G = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷'];
  el.innerHTML = G.map((c, i) => `<i style="--i:${i}">${c}</i>`).join('');
})();

/* ---------- 输入区 ---------- */
const slots = $('#slots'), phone = $('#phone'), errBox = $('#err');
const counter = $('#counter'), carrierChip = $('#carrier-chip'), goBtn = $('#go');
let CUR = '';
let BUSY = false;          // 起盘动画期间锁住输入，防止重入

for (let i = 0; i < 11; i++) {
  const d = document.createElement('div');
  // 大陆手机号读法为 3-4-4（号段 3 位 + HLR 4 位 + 用户号 4 位），
  // 分隔符必须落在第 3、7 个格子之后，才能和输入框/历史/结果里的 "138 0013 8000" 对齐
  d.className = 'slot' + (i === 2 || i === 6 ? ' gap' : '');
  slots.appendChild(d);
}
const slotEls = [...slots.children];

function paint() {
  slotEls.forEach((el, i) => {
    const ch = CUR[i];
    el.textContent = ch || '';
    el.classList.toggle('on', !!ch);
    el.classList.toggle('next', !ch && i === CUR.length);
  });
  counter.textContent = `${CUR.length} / 11`;
  carrierChip.textContent = CUR.length >= 3 ? (validateCarrier(CUR.slice(0, 3)) || '未知 / 新号段') : '号段待识别';
  carrierChip.classList.toggle('ghost', CUR.length < 3);
}
function validateCarrier(p) {
  const c = carrierOf(p);
  return c && c.indexOf('未知') < 0 ? c : null;
}

phone.addEventListener('input', () => {
  /* 走 engine 的 normalizeInput：先剥国际区号（+86/0086/86）再截 11 位，
     否则粘贴带区号的号码会被截成错的号码 */
  const d = normalizeInput(phone.value);
  CUR = d; phone.value = fmtInput(d); paint(); hideErr();
});
phone.addEventListener('focus', () => { if (!CUR) phone.placeholder = ''; });
function fmtInput(d) {
  if (d.length <= 3) return d;
  if (d.length <= 7) return d.slice(0, 3) + ' ' + d.slice(3);
  return d.slice(0, 3) + ' ' + d.slice(3, 7) + ' ' + d.slice(7);
}
slots.addEventListener('click', () => phone.focus());

/* 轻量提示：对比条操作需要即时反馈 */
let _toastT = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('on'), 1900);
}

function showErr(m) { errBox.textContent = m; errBox.classList.add('on'); }
function hideErr() { errBox.classList.remove('on'); errBox.textContent = ''; }

$('#clear').addEventListener('click', () => {
  CUR = ''; phone.value = ''; paint(); hideErr(); phone.focus();
});

/* 随机号：真实存在的号段，避免生成无效号 */
const SEGS = ['133', '135', '136', '138', '139', '150', '151', '152', '156', '158', '159',
  '166', '176', '177', '178', '180', '182', '185', '186', '188', '189', '198', '199'];
$('#random').addEventListener('click', () => {
  let n = SEGS[Math.floor(Math.random() * SEGS.length)];
  for (let i = 0; i < 8; i++) n += Math.floor(Math.random() * 10);
  CUR = n; phone.value = fmtInput(n); paint(); hideErr();
});

/* ---------- 起盘 ---------- */
const cast = $('#cast'), castStep = $('#castStep'), resultBox = $('#result');
const STEPS = ['排数理 · 后四位取灵数…', '布磁场 · 八星两两分组…',
  '定五行 · 河图纳甲分布…', '察号型 · 豹子顺子对子…', '合四轴 · 加权出盘…'];

function runCast(num) {
  if (BUSY) return;                     // 防重入：动画期间再点不会叠加 setInterval
  BUSY = true;
  goBtn.disabled = true; goBtn.classList.add('loading');
  const rb = $('#random'), cl = $('#clear');
  if (rb) rb.disabled = true;
  if (cl) cl.disabled = true;
  resultBox.innerHTML = ''; resultBox.hidden = true;
  cast.hidden = false;
  cast.scrollIntoView({ behavior: 'smooth', block: 'center' });
  let i = 0;
  castStep.textContent = STEPS[0];
  /* 用同步 setInterval + 固定步数，不依赖 rAF（WebView 下 rAF 可能停摆） */
  const done = () => {
    BUSY = false;
    goBtn.disabled = false; goBtn.classList.remove('loading');
    if (rb) rb.disabled = false;
    if (cl) cl.disabled = false;
  };
  const timer = setInterval(() => {
    i++;
    if (i < STEPS.length) { castStep.textContent = STEPS[i]; return; }
    clearInterval(timer);
    cast.hidden = true;
    render(analyze(num));
    done();
  }, 260);
}

goBtn.addEventListener('click', () => {
  const v = validate(CUR || phone.value);
  if (!v.ok) { showErr(v.err); return; }
  hideErr();
  runCast(v.num);
});
phone.addEventListener('keydown', e => { if (e.key === 'Enter') goBtn.click(); });

/* ================= 渲染 ================= */
const GRADE_CLS = { S: 'grade-S', A: 'grade-A', B: 'grade-B', C: 'grade-C', D: 'grade-D', E: 'grade-E' };
const KIND_CLS = { good: 'good', bad: 'bad', neutral: 'neutral' };

let LAST = null;

/* ---------- 结果渲染 ---------- */
function render(r) {
  if (!r || !r.ok) { showErr(r ? r.err : '测算失败'); return; }
  LAST = r;
  const lv = numLevel(r.shuli.w);
  const tone = r.total >= 69 ? 'good' : (r.total < 49 ? 'bad' : 'neu');

  /* 四轴分量 */
  const axes = [
    ['数字磁场', r.magnet.score, '34%'],
    ['81 数理', r.shuli.point, '26%'],
    ['号码形态', r.pattern.score, '22%'],
    ['河图五行', r.five.score, '18%'],
  ];

  resultBox.innerHTML = `
  <section class="card">
    <div class="sum">
      ${ring(r.total, tone)}
      <div class="sum-r">
        <div class="badges">
          <span class="badge ${tone}">${esc(r.grade.grade)} · ${esc(r.grade.qian)}</span>
          <span class="badge ${lvTone(r.shuli.w)}">数理${esc(lv)}</span>
          <span class="badge">${esc(r.carrier)}</span>
        </div>
        <p class="phone-big">${esc(r.fmt)}</p>
        <p class="verdict">${esc(r.verdict[0])}</p>
        <p class="verdict sub2">${esc(r.verdict[1])}</p>
      </div>
    </div>
    <div class="axes">
      ${axes.map(([n, v, w]) => `
        <div class="ax">
          <div class="ax-h"><span>${n}</span><b>${Math.round(v)}</b><i>权重 ${w}</i></div>
          <div class="bar"><i style="width:${clamp(v, 0, 100).toFixed(1)}%"></i></div>
        </div>`).join('')}
    </div>
    <div class="acts">
      <button class="btn-sub" id="copy">复制结果</button>
      <button class="btn-sub" id="share">分享</button>
      <button class="btn-sub" id="cmpadd">加入对比</button>
      <button class="btn-sub" id="again">再测一个</button>
    </div>
    <p class="tip" id="copy-tip"></p>
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">貳</span><h2>五维画像</h2>
      <span class="hint">财 / 事 / 情 / 健 / 人</span></div>
    <div class="radar-wrap">${radar(r.dims)}</div>
    ${r.dims.map(d => `
      <div class="dim">
        <div class="dim-h"><span class="dn">${esc(d.n)}</span>
          <span class="dv ${d.v >= 70 ? 'good' : d.v < 50 ? 'bad' : ''}">${Math.round(d.v)}</span></div>
        <div class="bar"><i class="${d.v >= 70 ? 'good' : d.v < 50 ? 'bad' : ''}" style="width:${clamp(d.v, 0, 100).toFixed(1)}%"></i></div>
        <p class="dim-t">${esc(d.d)}</p>
      </div>`).join('')}
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">叁</span><h2>81 数理灵数</h2>
      <span class="hint">后 ${esc(String(r.shuli.last4).padStart(4, '0'))} ÷ 80</span></div>
    <div class="shuli">
      <div class="sl-n ${lvTone(r.shuli.w)}">${r.shuli.idx}</div>
      <div class="sl-r">
        <p class="sl-name">${esc(r.shuli.n)}<span class="lv ${lvTone(r.shuli.w)}">${esc(lv)}</span></p>
        <p class="sl-s">${esc(r.shuli.s)}</p>
        <p class="sl-calc">算法：后四位 <b>${esc(String(r.shuli.last4).padStart(4, '0'))}</b> ÷ 80，余数
          <b>${r.shuli.idx}</b>${r.shuli.idx === 80 ? '（整除取 80）' : ''} → 查 81 数理表得「${esc(r.shuli.n)}」，
          数理分 <b>${Math.round(r.shuli.point)}</b> / 100。</p>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">肆</span><h2>八星数字磁场</h2>
      <span class="hint">磁场分 ${Math.round(r.magnet.score)}</span></div>
    <p class="lead">去号段「${esc(r.num.slice(0, 3))}」后取 8 位两两分组，得 4 组磁场。越靠尾权重越大（1 / 1.2 / 1.5 / 2）。</p>
    <div class="pairs">
      ${r.magnet.groups.map((g, i) => pairChip(g, i)).join('')}
    </div>
    ${r.magnet.groups.map((g, i) => rowMagnet(g, i)).join('')}
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">伍</span><h2>河图五行</h2>
      <span class="hint">五行分 ${Math.round(r.five.score)}</span></div>
    <p class="lead">1/6 水 · 2/7 火 · 3/8 木 · 4/9 金 · 5/0 土</p>
    <div class="digits">
      ${r.num.split('').map(d => `<i class="dg ${FIVE[d].e}" title="${d} → ${FIVE[d].e}">${d}</i>`).join('')}
    </div>
    ${rowWuxing(r.five)}
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">陸</span><h2>号码形态</h2>
      <span class="hint">形态分 ${Math.round(r.pattern.score)}</span></div>
    ${r.pattern.feats.map(f => `
      <div class="feat ${f.k}">
        <div class="feat-h"><span class="dot"></span>${esc(f.t)}</div>
        <p>${esc(f.d)}</p>
      </div>`).join('')}
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">柒</span><h2>化解与建议</h2>
      <span class="hint">按弱项生成</span></div>
    ${r.advice.length ? r.advice.map(a => `
      <div class="adv">
        <div class="adv-h">${esc(a.t)}</div>
        <p>${esc(a.d)}</p>
      </div>`).join('') : '<p class="lead">此盘无明显弱项，无需特别化解。</p>'}
    <p class="tip">以上为民俗数理推演，非事实判断。号码不决定命运，习惯才决定。</p>
  </section>

  <section class="card">
    <div class="card-h"><span class="ci">捌</span><h2>选号推荐</h2>
      <span class="hint">以 ${esc(r.num.slice(0, 3))} 为号段生成</span></div>
    <div class="rec-opts" id="rec-opts">
      <div class="rec-row"><span class="rl">补强</span><div class="chips">
        <button class="chip" data-k="target" data-v="auto">自动补弱</button>
        <button class="chip" data-k="target" data-v="all">综合</button>
        <button class="chip" data-k="target" data-v="cai">财运</button>
        <button class="chip" data-k="target" data-v="shi">事业</button>
        <button class="chip" data-k="target" data-v="qing">感情</button>
        <button class="chip" data-k="target" data-v="jian">健康</button>
        <button class="chip" data-k="target" data-v="ren">人际</button>
      </div></div>
      <div class="rec-row"><span class="rl">号型</span><div class="chips">
        <button class="chip" data-k="shape" data-v="any">不限</button>
        <button class="chip" data-k="shape" data-v="baozi">豹子</button>
        <button class="chip" data-k="shape" data-v="shunzi">顺子</button>
        <button class="chip" data-k="shape" data-v="duizi">对子</button>
        <button class="chip" data-k="shape" data-v="xunhuan">循环</button>
      </div></div>
      <div class="rec-row"><span class="rl">约束</span><div class="chips">
        <button class="chip" id="rec-fill">五行补缺</button>
        <button class="chip" id="rec-nofour">避开 4</button>
      </div></div>
    </div>
    <div class="rec-grid" id="rec-grid"></div>
    <div class="plan-bar">
      <button class="btn-sub" id="plan-save">存为方案</button>
      <button class="btn-sub ghost" id="plan-toggle">我的方案</button>
    </div>
    <div id="plan-list" hidden></div>
    <p class="tip">推荐为本机即时生成的候选，能否办理以运营商号池为准；同号段可携号转网。选号看相对差异，不看绝对分数。</p>
  </section>`;

  resultBox.hidden = false;
  resultBox.setAttribute('tabindex', '-1');
  resultBox.setAttribute('aria-label', '测算结果');
  bindActs();
  bindRec();
  bindPlans();
  renderRec();
  saveHist(r);
  resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  /* 把焦点移到结果区：键盘/读屏用户不必从页首重新 tab 一遍 */
  try { resultBox.focus({ preventScroll: true }); } catch (e) { }
}

function ring(v, tone) {
  const C = 2 * Math.PI * 52;
  const off = C * (1 - clamp(v, 0, 100) / 100);
  return `<div class="ring ${tone}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="rbg" cx="60" cy="60" r="52"/>
      <circle class="rfg" cx="60" cy="60" r="52"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        style="transform:rotate(-90deg);transform-origin:60px 60px"/>
    </svg>
    <div class="rv">${Math.round(v)}<small>综合</small></div>
  </div>`;
}

function radar(dims) {
  const cx = 110, cy = 104, R = 66, N = dims.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / N;
    return [(cx + Math.cos(a) * r).toFixed(1), (cy + Math.sin(a) * r).toFixed(1)];
  };
  let grid = '';
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const p = dims.map((_, i) => pt(i, R * f).join(',')).join(' ');
    grid += `<polygon class="rgrid" points="${p}"/>`;
  });
  const axes = dims.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line class="raxis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
  }).join('');
  const data = dims.map((d, i) => pt(i, R * clamp(d.v, 5, 100) / 100).join(',')).join(' ');
  const dots = dims.map((d, i) => {
    const [x, y] = pt(i, R * clamp(d.v, 5, 100) / 100);
    return `<circle cx="${x}" cy="${y}" r="2.6"/>`;
  }).join('');
  const labs = dims.map((d, i) => {
    const [x, y] = pt(i, R + 20);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${esc(d.n)} ${Math.round(d.v)}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="0 0 220 208">${grid}${axes}
    <polygon class="rdata" points="${data}"/>${dots}${labs}</svg>`;
}

function pairChip(g, i) {
  const gi = g.info.g, lucky = gi === 'zero' ? 0 : CIGROUP[gi].lucky;
  const cls = lucky > 0 ? 'good' : lucky < 0 ? 'bad' : 'neu';
  return `<div class="pc ${cls}">
    <span class="pc-p">${esc(g.pair)}</span>
    <span class="pc-n">${esc(gi === 'zero' ? g.info.n : CIGROUP[gi].n)}</span>
    <span class="pc-w">权重 ${g.weight}</span></div>`;
}

function rowMagnet(g, i) {
  const gi = g.info.g, G = CIGROUP[gi];
  const lucky = gi === 'zero' ? 0 : G.lucky;
  const cls = lucky > 0 ? 'good' : lucky < 0 ? 'bad' : 'neu';
  const mods = [];
  if (g.strong) mods.push('<span class="mod m5">含 5 · 强化 ×1.35</span>');
  if (g.zero.length) mods.push(`<span class="mod m0">含 0 · 空亡 ×${g.zero.length > 1 ? '0.35' : '0.6'}</span>`);
  const tier = g.info.tier
    ? `<span class="mod mt">第${'一二三四'[g.info.tier - 1]}档强度 · 能量 ${g.info.w > 0 ? '+' : ''}${g.info.w}</span>`
    : `<span class="mod mt">非八星对 · 能量 ${(g.info.w || 0) > 0 ? '+' : ''}${g.info.w || 0}</span>`;
  const posName = ['起盘', '二盘', '三盘', '收尾'][i] || `第${i + 1}组`;
  return `<div class="mag ${cls}">
    <div class="mag-h">
      <span class="mag-pair">${esc(g.pair)}</span>
      <span class="mag-name">${esc(g.info.n || G.n)}${lucky > 0 ? '磁场' : (lucky < 0 ? '磁场' : '')}</span>
      <span class="mag-tag ${cls}">${lucky > 0 ? '吉星' : lucky < 0 ? '凶星' : '中性'}</span>
      <span class="mag-pos">${posName} · 权重 ${g.weight}</span>
    </div>
    <div class="mods">${tier}${mods.join('')}</div>
    <p class="mag-d">${esc(G.d)}</p>
    ${G.good ? `<p class="mag-gb"><b>逢之则</b>　${esc(G.good)}</p>` : ''}
    ${G.bad ? `<p class="mag-gb warn"><b>忌</b>　${esc(G.bad)}</p>` : ''}
    ${g.info.tag ? `<p class="mag-gb"><b>隐数</b>　${esc(g.info.tag)}　${esc(NUM[g.pair[0]] ? NUM[g.pair[0]].n : '')}</p>` : ''}
  </div>`;
}

function rowWuxing(fe) {
  const max = Math.max(1, ...WUXING_ORDER.map(k => fe.cnt[k]));
  const bars = WUXING_ORDER.map(k => {
    const c = fe.cnt[k], miss = c === 0;
    return `<div class="wx ${k}${miss ? ' miss' : ''}">
      <div class="wx-h"><span>${k}</span><b>${c}</b><i>${(c / fe.total * 100).toFixed(0)}%</i></div>
      <div class="bar"><i style="width:${(c / max * 100).toFixed(1)}%"></i></div>
      ${miss ? '<em>缺</em>' : ''}
    </div>`;
  }).join('');
  const flow = fe.flow > 1.5 ? ['good', '流通有情', '相邻数字多为相生，气脉顺畅，主做事有接力、少内耗。']
    : fe.flow < -1.5 ? ['bad', '克战较多', `相邻数字多见相克${fe.flowNote.length ? '（' + fe.flowNote.join('、') + '）' : ''}，主推进中阻力反复，宜先谋后动。`]
      : ['', '生克平平', '相生相克大致抵消，气场中性，成败更多取决于人为。'];
  const dom = WUXING_TEXT[fe.dominant];
  return `
    <div class="wx-grid">${bars}</div>
    <div class="wx-sum">
      <p><b>最旺</b>　${esc(fe.dominant)}（${fe.cnt[fe.dominant]} 位）· ${esc(dom.nature)}<br><span class="dim-t">${esc(dom.desc)}</span></p>
      <p><b>最弱</b>　${esc(fe.weakest)}（${fe.cnt[fe.weakest]} 位）${fe.missing.length ? ` · 缺 ${fe.missing.join('、')}` : ''}</p>
      <p><b>均衡度</b>　${Math.round(fe.evenness)} / 100　<b>流通度</b>　${Math.round(fe.flow * 10) / 10}</p>
      <p class="flow ${flow[0]}"><b>${flow[1]}</b>　${esc(flow[2])}</p>
    </div>`;
}

/* ---------- 数理等级色调（入参为权重 w，render 传的是 r.shuli.w） ---------- */
function lvTone(w) { return w >= 0.8 ? 'good' : (w <= 0.2 ? 'bad' : 'neu'); }

/* ---------- 纯文本结果（复制 / 分享用） ---------- */
function plainText(r) {
  const L = [];
  L.push('【号码玄机 · 手机号吉凶测算】');
  L.push(`号码：${r.fmt}　号段：${r.carrier}`);
  L.push(`综合评分：${Math.round(r.total)} / 100　${r.grade.grade} 级 · ${r.grade.qian} · ${r.grade.luck}`);
  L.push('');
  L.push(`81 数理：${r.shuli.idx} ${r.shuli.n}（${numLevel(r.shuli.w)}）— ${r.shuli.s}`);
  L.push(`数字磁场 ${Math.round(r.magnet.score)}｜81 数理 ${Math.round(r.shuli.point)}｜号码形态 ${Math.round(r.pattern.score)}｜河图五行 ${Math.round(r.five.score)}`);
  L.push('');
  L.push('◆ 八星磁场');
  r.magnet.groups.forEach(g => {
    const gi = g.info.g, G = CIGROUP[gi] || CIZERO;
    const tag = gi === 'zero' ? '中性' : (G.lucky > 0 ? '吉星' : '凶星');
    L.push(`  ${g.pair}　${G.n}${tag ? '（' + tag + '）' : ''}　权重 ${g.weight}`);
  });
  L.push('');
  L.push('◆ 五维画像');
  r.dims.forEach(d => L.push(`  ${d.n}：${Math.round(d.v)}`));
  L.push('');
  L.push(`◆ 五行：最旺 ${r.five.dominant}（${r.five.cnt[r.five.dominant]} 位）` +
    (r.five.missing.length ? `　缺 ${r.five.missing.join('、')}` : '　五行不缺'));
  L.push(`  分布 ${WUXING_ORDER.map(k => `${k}${r.five.cnt[k]}`).join('　')}`);
  L.push('');
  L.push('◆ 号型');
  r.pattern.feats.forEach(f => L.push(`  · ${f.t}`));
  if (r.advice.length) { L.push(''); L.push('◆ 化解建议'); r.advice.forEach(a => L.push(`  · ${a.t}`)); }
  L.push('');
  L.push('判词：' + r.verdict[0]);
  L.push('（传统民俗数理，文化娱乐参考，不构成任何决策建议）');
  return L.join('\n');
}

async function copyText(t) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; }
  } catch (e) { /* 继续走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove(); return ok;
  } catch (e) { return false; }
}

function bindActs() {
  const tip = $('#copy-tip');
  const say = m => { if (tip) tip.textContent = m; };

  const c = $('#copy');
  if (c) c.addEventListener('click', async () => {
    if (!LAST) return;
    say(await copyText(plainText(LAST)) ? '✓ 已复制完整测算结果到剪贴板' : '复制失败，请长按选择文字手动复制');
  });

  const s = $('#share');
  if (s) s.addEventListener('click', () => { shareCard(); });

  const cAdd = $('#cmpadd');
  if (cAdd) cAdd.addEventListener('click', () => { if (LAST) compare.add(LAST); });

  const a = $('#again');
  if (a) a.addEventListener('click', () => {
    CUR = ''; phone.value = ''; paint(); hideErr();
    resultBox.hidden = true; resultBox.innerHTML = '';
    $('#card-input').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => phone.focus(), 360);
  });
}

/* ---------- 选号推荐 ---------- */
const REC = Object.assign({ target: 'auto', shape: 'any', fill: true, noFour: true }, readRec() || {});

function renderRec() {
  const grid = $('#rec-grid');
  if (!grid || !LAST) return;
  const rec = recommend(LAST.num, REC);
  LAST_REC = rec;
  if (!rec.ok) { grid.innerHTML = '<p class="lead">' + esc(rec.err) + '</p>'; return; }

  grid.innerHTML = rec.list.map(c => {
    const cls = c.g === 'S' || c.g === 'A' ? 'good' : (c.g === 'E' || c.g === 'D' ? 'bad' : '');
    return `<div class="rec-card">
      <div class="rec-top">
        <b class="rec-num">${esc(fmtFull(c.num))}</b>
        <span class="rec-score ${cls}">${esc(c.g)} ${Math.round(c.total)}</span>
      </div>
      <div class="rec-delta">
        <span class="${c.deltaDim >= 0 ? 'up' : 'down'}">${esc(rec.dimName)} ${c.deltaDim >= 0 ? '+' : ''}${c.deltaDim}</span>
        <span class="${c.deltaTotal >= 0 ? 'up' : 'down'}">综合 ${c.deltaTotal >= 0 ? '+' : ''}${c.deltaTotal}</span>
      </div>
      <ul class="rec-reasons">${c.reasons.map(x =>
        `<li><i>${esc(x.t)}</i><span>${esc(x.d)}</span></li>`).join('')}</ul>
      <div class="rec-acts">
        <button class="btn-mini" data-use="${esc(c.num)}">测这个</button>
        <button class="btn-mini ghost" data-add="${esc(c.num)}">对比＋</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
    const n = b.getAttribute('data-use');
    CUR = n; phone.value = fmtInput(n); paint(); hideErr();
    runCast(n);
  }));
  grid.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const r2 = analyze(b.getAttribute('data-add'));
    if (r2 && r2.ok) compare.add(r2);
  }));
}

function bindRec() {
  const box = $('#rec-opts');
  if (!box) return;
  box.querySelectorAll('.chip[data-k]').forEach(x =>
    x.classList.toggle('on', REC[x.dataset.k] === x.dataset.v));
  const f = $('#rec-fill'), n4 = $('#rec-nofour');
  if (f) f.classList.toggle('on', REC.fill);
  if (n4) n4.classList.toggle('on', REC.noFour);

  box.addEventListener('click', e => {
    const b = e.target.closest('button.chip');
    if (!b) return;
    if (b.dataset.k) REC[b.dataset.k] = b.dataset.v;
    else if (b.id === 'rec-fill') REC.fill = !REC.fill;
    else if (b.id === 'rec-nofour') REC.noFour = !REC.noFour;
    box.querySelectorAll('.chip[data-k]').forEach(x =>
      x.classList.toggle('on', REC[x.dataset.k] === x.dataset.v));
    if (f) f.classList.toggle('on', REC.fill);
    if (n4) n4.classList.toggle('on', REC.noFour);
    try { localStorage.setItem(RKEY, JSON.stringify(REC)); } catch (e) { }
    renderRec();
  });
}

/* ---------- 推荐方案（本机存储） ----------
   方案 = 配置 + 当时那 6 个号的快照。只存配置会导致回看时号码全变（推荐是随机生成），
   所以快照必须一起存，回看才是同一组。 */
const PKEY = 'hl_plans', RKEY = 'hl_rec';
const TGT_NAMES = { auto: '自动补弱', all: '综合', cai: '财运', shi: '事业', qing: '感情', jian: '健康', ren: '人际' };
const SHP_NAMES = { any: '不限号型', baozi: '豹子', shunzi: '顺子', duizi: '对子', xunhuan: '循环' };
let LAST_REC = null;

function readPlans() {
  try { return sanitizePlans(JSON.parse(localStorage.getItem(PKEY) || '[]')); } catch (e) { return []; }
}
function writePlans(l) {
  try { localStorage.setItem(PKEY, JSON.stringify(l.slice(0, 6))); } catch (e) { /* 隐私模式静默 */ }
}
function readRec() {
  try { return sanitizeRec(JSON.parse(localStorage.getItem(RKEY) || 'null')); } catch (e) { return null; }
}

function planTags(p) {
  const t = [TGT_NAMES[p.opts.target] || p.opts.target, SHP_NAMES[p.opts.shape] || p.opts.shape];
  if (p.opts.fill) t.push('补缺');
  if (p.opts.noFour) t.push('避4');
  return t;
}

function renderPlans() {
  const box = $('#plan-list');
  if (!box) return;
  const plans = readPlans();
  const btn = $('#plan-toggle');
  if (btn) btn.textContent = plans.length ? `我的方案（${plans.length}）` : '我的方案';
  if (!plans.length) {
    box.innerHTML = '<p class="lead">还没有方案。调好补强方向与号型后点「存为方案」，' +
      '之后换号、换设备前都能回看这一组候选。</p>';
    return;
  }
  box.innerHTML = plans.map((p, i) => `
    <div class="plan-row" data-i="${i}">
      <div class="plan-h" data-open="${i}">
        <b>${esc(fmtFull(p.base))}</b>
        <i>${esc(new Date(p.ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }))}</i>
        <span class="plan-tags">${planTags(p).map(t => `<em>${esc(t)}</em>`).join('')}</span>
      </div>
      <div class="plan-items" hidden>
        ${p.items.map(x => `
          <div class="plan-it">
            <b>${esc(fmtFull(x.num))}</b>
            <span class="hs">${Math.round(x.total)}</span>
            <span class="${x.deltaDim >= 0 ? 'up' : 'down'}">${x.deltaDim >= 0 ? '+' : ''}${x.deltaDim}</span>
            <span class="plan-acts">
              <button class="btn-mini" data-use="${esc(x.num)}">测</button>
              <button class="btn-mini ghost" data-add="${esc(x.num)}">＋</button>
            </span>
          </div>`).join('')}
        <div class="plan-ops">
          <button class="btn-mini ghost" data-load="${i}">载入此配置重生成</button>
          <button class="btn-mini ghost" data-del="${i}">删除方案</button>
        </div>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-open]').forEach(h => h.addEventListener('click', () => {
    const items = h.parentElement.querySelector('.plan-items');
    items.hidden = !items.hidden;
  }));
  box.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const n = b.getAttribute('data-use');
    CUR = n; phone.value = fmtInput(n); paint(); hideErr(); runCast(n);
  }));
  box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const r2 = analyze(b.getAttribute('data-add'));
    if (r2 && r2.ok) compare.add(r2);
  }));
  box.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const p = readPlans()[+b.getAttribute('data-load')];
    if (!p) return;
    Object.assign(REC, p.opts);
    bindRec(); renderRec();
    $('#rec-opts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('已载入方案配置，重新生成中');
  }));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const l = readPlans();
    l.splice(+b.getAttribute('data-del'), 1);
    writePlans(l); renderPlans();
    toast('方案已删除');
  }));
}

function bindPlans() {
  const save = $('#plan-save'), tog = $('#plan-toggle');
  if (save) save.addEventListener('click', () => {
    if (!LAST_REC || !LAST_REC.ok || !LAST) { toast('先测算一个号码'); return; }
    const plans = readPlans();
    plans.unshift({
      ts: Date.now(), base: LAST.num,
      opts: { target: REC.target, shape: REC.shape, fill: REC.fill, noFour: REC.noFour },
      items: LAST_REC.list.map(c => ({
        num: c.num, total: c.total, g: c.g, deltaDim: c.deltaDim, deltaTotal: c.deltaTotal
      }))
    });
    writePlans(plans);
    renderPlans();
    $('#plan-list').hidden = false;
    toast(`已存为方案（共 ${readPlans().length} 个）`);
  });
  if (tog) tog.addEventListener('click', () => {
    const box = $('#plan-list');
    box.hidden = !box.hidden;
    if (!box.hidden) renderPlans();
  });
}

/* ---------- 本机历史（仅存本机，无上传） ---------- */
const LKEY = 'hl_hist';

function readHist() {
  try {
    const raw = localStorage.getItem(LKEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(h => h && typeof h.num === 'string') : [];
  } catch (e) { return []; }
}
function writeHist(list) {
  try { localStorage.setItem(LKEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* 隐私模式静默失败 */ }
}
function saveHist(r) {
  const list = readHist();
  const i = list.findIndex(x => x.num === r.num);
  if (i >= 0) list.splice(i, 1);
  list.unshift({ num: r.num, total: r.total, g: r.grade.grade, q: r.grade.qian, l: r.grade.luck, ts: r.ts });
  writeHist(list);
  renderHist(readHist());
}
function dstr(ts) {
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderHist(list) {
  const box = $('#hist-list'), card = $('#card-history');
  if (!box || !card) return;
  card.hidden = list.length === 0;
  box.innerHTML = list.map(h => `
    <div class="hrow" data-num="${esc(h.num)}">
      <div class="hi">
        <b>${esc(h.num.slice(0, 3))} **** ${esc(h.num.slice(7))}</b>
        <i>${esc(dstr(h.ts))}</i>
      </div>
      <div class="hr">
        <span class="hs">${Math.round(h.total)}</span>
        <span class="hg ${h.g === 'S' || h.g === 'A' ? 'good' : (h.g === 'E' || h.g === 'D' ? 'bad' : '')}">${esc(h.g)} · ${esc(h.l)}</span>
      </div>
    </div>`).join('');
  compare.syncHistoryChips();
  box.querySelectorAll('.hrow').forEach(el => {
    el.addEventListener('click', () => {
      const n = el.getAttribute('data-num') || '';
      CUR = n; phone.value = fmtInput(n); paint(); hideErr();
      render(analyze(n));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ---------- 启动 ---------- */
/* 对比成图：复用 share.js 的绘制与出图链路（分享→下载→长按保存） */
async function shareCompareCard(list, verdict) {
  toast('正在生成对比图…');
  try {
    const cv = drawCompareCard(list, verdict, clamp);
    await exportCanvasImage(
      cv,
      `号码玄机-对比-${list.length}号.png`,
      '号码对比 · 帮我选号',
      '几个候选号并排比过了，帮我看看选哪个',
      { $: s => document.querySelector(s), say: toast });
  } catch (e) {
    toast('生成对比图失败，请稍后再试');
  }
}

const compare = initCompare({
  $: s => document.querySelector(s),
  esc,
  analyze,
  toast,
  shareCompare: shareCompareCard
});
const shareCard = initShare({
  getLast: () => LAST,
  $: s => document.querySelector(s),
  clamp,
  copyText,
  plainText
});
paint();
renderHist(readHist());
const histClear = $('#hist-clear');
if (histClear) histClear.addEventListener('click', () => { writeHist([]); renderHist([]); });
window.__bootOK = true;

/* 离线可用：纯客户端工具，注册 SW 后从主屏打开即秒开、断网可用。
   策略是网络优先，不会把用户钉在旧代码上（详见 sw.js 头注释）。
   只在 https 下注册（本地 minis:// 预览无 SW，也不该注册）。 */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
