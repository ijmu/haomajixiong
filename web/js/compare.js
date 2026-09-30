/* compare.js · 多号对比
   用途：正在挑号的人往往手头有 2–4 个候选，逐个测完却无法并排比较。
   本模块把结果并排成表，逐行标出最优/最差，并给出一句话结论。

   设计：snap() 与 buildTable() 是纯函数（不碰 DOM），因此可在 node 下直接单测；
   initCompare() 只负责把它们接到界面上。
   依赖注入（避免跨模块共享作用域）：$ / esc / analyze / toast
*/
import { fmtFull } from './engine.js?v=20260929s';

const CKEY = 'hl_cmp';
const MAX = 4;

/* 评级是有序的（S>A>B>C>D>E），映射成序数才能正确比较高低；
   尾号磁场／最旺五行／尾号数字属分类值，无高低之分，故不给 v、不参与高亮。 */
export const GRADE_RANK = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };

/* 全站统一 3-4-4 读法（唯一实现在 engine.js，此处转发以维持既有导入路径） */
export { fmtFull };

export const ROWS = [
  { t: '综合评分', f: x => Math.round(x.total), hi: true, big: true },
  { t: '评级', f: x => `${x.g} · ${x.luck}`, v: x => GRADE_RANK[x.g] || 0, hi: true },
  { t: '数字磁场', f: x => Math.round(x.mg), hi: true },
  { t: '81 数理', f: x => `${x.slIdx} ${x.slName}`, v: x => x.sl, hi: true },
  { t: '号码形态', f: x => Math.round(x.pt), hi: true },
  { t: '河图五行', f: x => Math.round(x.wx), hi: true },
  { t: 'sep', t2: '五维画像' },
  { t: '财运', f: x => x.dims[0], hi: true },
  { t: '事业', f: x => x.dims[1], hi: true },
  { t: '感情', f: x => x.dims[2], hi: true },
  { t: '健康', f: x => x.dims[3], hi: true },
  { t: '人际', f: x => x.dims[4], hi: true },
  { t: 'sep', t2: '号码特征' },
  { t: '尾号磁场', f: x => x.tailGi || '—' },
  { t: '尾号数字', f: x => x.tail },
  { t: '最旺五行', f: x => x.dominant },
  { t: '五行缺失', f: x => x.missing.length ? x.missing.join('、') : '不缺', v: x => x.missing.length, lo: true },
  { t: '吉星特征', f: x => x.feats + ' 项', v: x => x.feats, hi: true }
];

/* ---------- 快照：只存表格需要的字段 ---------- */
export function snap(r) {
  const gi = k => (r.magnet.groups.find(g => g.info.g === k) || {}).pair || '';
  const order = ['tiany', 'yinian', 'shengqi', 'fuwei', 'jueming', 'wugui', 'liusha', 'huohai'];
  const tai = r.magnet.groups[r.magnet.groups.length - 1];
  return {
    num: r.num,
    total: r.total,
    g: r.grade.grade, qian: r.grade.qian, luck: r.grade.luck,
    mg: r.magnet.score, sl: r.shuli.point, pt: r.pattern.score, wx: r.five.score,
    dims: r.dims.map(d => Math.round(d.v)),
    slIdx: r.shuli.idx, slName: r.shuli.n,
    tail: r.num[10],
    tailGi: (tai.info && tai.info.n) || '',
    bestGi: order.map(gi).filter(Boolean)[0] || '',
    missing: r.five.missing,
    dominant: r.five.dominant,
    feats: r.pattern.feats.filter(f => f.k === 'good').length,
    ts: Date.now()
  };
}

/* ---------- 表格模型（纯函数，可在 node 下单测） ---------- */
export function buildTable(list) {
  const N = list.length;
  const rows = [];

  for (const row of ROWS) {
    if (row.t === 'sep') { rows.push({ sep: row.t2 }); continue; }

    /* 逐格包一层：任一快照字段缺失只让该格显示占位，不让整表崩掉 */
    const cellSafe = (x, fn) => { try { return fn(x); } catch (e) { return null; } };
    const vals = list.map(x => cellSafe(x, () => row.v ? row.v(x)
      : (typeof row.f(x) === 'number' ? row.f(x) : null)));

    let best = null, worst = null;
    if (row.hi || row.lo) {
      const nums = vals.filter(v => typeof v === 'number');
      if (nums.length >= 2 && Math.max(...nums) !== Math.min(...nums)) {
        best = row.hi ? Math.max(...nums) : Math.min(...nums);
        worst = row.hi ? Math.min(...nums) : Math.max(...nums);
      }
    }

    rows.push({
      label: row.t, big: !!row.big,
      cells: list.map((x, i) => {
        /* 必须显式判 null：无数值可比时 best/worst 为 null，
           而该类行的 vals[i] 也是 null，直接判等会把整行亮成「最优」 */
        const cls = (best !== null && vals[i] === best) ? 'best'
          : (worst !== null && vals[i] === worst) ? 'worst' : '';
        return { text: String(cellSafe(x, row.f) ?? '—'), cls };
      })
    });
  }

  /* 结论：综合分最高者 */
  const top = [...list].sort((a, b) => b.total - a.total);
  const gap = top.length > 1 ? (top[0].total - top[1].total) : 0;
  const dimAt = (x, i) => (Array.isArray(x.dims) && Number.isFinite(x.dims[i]) ? x.dims[i] : -1);
  const dimBest = [0, 1, 2, 3, 4].map(i => [...list].sort((a, b) => dimAt(b, i) - dimAt(a, i))[0]);
  const names = ['财运', '事业', '感情', '健康', '人际'];

  const summary = gap >= 5
    ? `「${fmtFull(top[0].num)}」综合领先 ${gap.toFixed(1)} 分，差距明确。`
    : gap > 0
      ? `「${fmtFull(top[0].num)}」仅领先 ${gap.toFixed(1)} 分，${top.length > 2 ? '前两名' : '两者'}接近，建议按单维强弱取舍。`
      : '几个号码综合分持平，按你最看重的维度来选。';
  const strong = names.filter((n, i) => dimBest[i].num === top[0].num);

  return {
    keys: list.map(x => fmtFull(x.num)),
    rows,
    verdict: {
      summary,
      sub: strong.length
        ? `「${fmtFull(top[0].num)}」在你最看重的 ${strong.join('、')} 上也是最强。`
        : '但单维最强项分散在其它号码上，没有全面占优者。',
      note: '分数差异在 2 分以内基本属噪声（同一体系的舍入与权重产物），不必据此纠结。'
    }
  };
}

/* ---------- 快照有效性 ----------
   快照必须字段齐备才可用。
   必要性：版本迭代会改变快照字段，用户 localStorage 里可能残留旧版数据；
   残缺快照一旦进入 buildTable，会让对比表直接抛异常、点了按钮毫无反应（实测过）。 */
const numArr = (v, n) => Array.isArray(v) && v.length === n && v.every(x => Number.isFinite(x));

export const isSnapshot = x => !!x && typeof x === 'object'
  && typeof x.num === 'string' && /^1\d{10}$/.test(x.num)
  && Number.isFinite(x.total)
  && typeof x.g === 'string' && typeof x.luck === 'string'
  && [x.mg, x.sl, x.pt, x.wx, x.slIdx, x.feats].every(Number.isFinite)
  && numArr(x.dims, 5)
  && typeof x.slName === 'string' && typeof x.tail === 'string'
  && typeof x.tailGi === 'string' && typeof x.dominant === 'string'
  && Array.isArray(x.missing);

/* 读入任意来源（可能畸形）的对比列表 → 干净的快照数组。纯函数，可单测。 */
export function sanitizeList(arr) {
  return Array.isArray(arr) ? arr.filter(isSnapshot).slice(0, MAX) : [];
}

/* shareCompare(list, verdict)：由 app 注入（对比成图在 share.js，避免模块反向依赖） */
export function initCompare({ $, esc, analyze, toast, shareCompare }) {
  let list = read();

  function read() {
    try {
      return sanitizeList(JSON.parse(localStorage.getItem(CKEY) || '[]'));
    } catch (e) { return []; }   /* 畸形 JSON（用户手改 / 旧版本 / 存储损坏）一律当空 */
  }
  function write() {
    try { localStorage.setItem(CKEY, JSON.stringify(list)); } catch (e) { /* 隐私模式静默 */ }
  }

  const has = num => list.some(x => x.num === num);

  function add(r) {
    if (!r || !r.ok) return;
    if (has(r.num)) { toast('该号码已在对比中'); return; }
    if (list.length >= MAX) { toast(`最多对比 ${MAX} 个号码，请先移除一个`); return; }
    list.push(snap(r));
    write(); renderDock();
    toast(`已加入对比（${list.length}/${MAX}）`);
  }

  function remove(num) {
    list = list.filter(x => x.num !== num);
    write(); renderDock();
    if (list.length < 2) close(); else renderModal();
  }

  function clear() {
    list = [];
    write(); renderDock(); close();
  }

  /* ---------- 底部对比条 ---------- */
  function renderDock() {
    let dock = $('#cmp-dock');
    if (!list.length) {
      if (dock) dock.classList.remove('on');
      document.body.classList.remove('has-dock');
      return;
    }
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'cmp-dock';
      dock.className = 'cmp-dock';
      dock.innerHTML = `<div class="cmp-chips" id="cmp-chips"></div>
        <div class="cmp-ops">
          <button class="cmp-btn ghost" id="cmp-clear">清空</button>
          <button class="cmp-btn" id="cmp-open">对比</button>
        </div>`;
      document.body.appendChild(dock);
      dock.querySelector('#cmp-clear').addEventListener('click', clear);
      dock.querySelector('#cmp-open').addEventListener('click', openCompare);
    }
    dock.querySelector('#cmp-chips').innerHTML = list.map(x => `
      <span class="cmp-chip" data-num="${esc(x.num)}">
        <b>${esc(fmtFull(x.num))}</b><i>${Math.round(x.total)}</i>
        <em class="cmp-x" data-x="${esc(x.num)}" role="button" aria-label="移除">×</em>
      </span>`).join('');
    dock.querySelectorAll('.cmp-x').forEach(el => el.addEventListener('click', ev => {
      ev.stopPropagation(); remove(el.getAttribute('data-x'));
    }));
    dock.classList.add('on');
    document.body.classList.add('has-dock');
  }

  /* ---------- 对比表 ---------- */
  function renderModal() {
    const m = $('#cmp-modal');
    if (!m) return;
    const N = list.length;
    const { keys, rows, verdict } = buildTable(list);

    let html = `<div class="cmp-scroll"><table class="cmp-table" style="--n:${N}">
      <thead><tr><th class="cmp-lb">项目</th>${
      keys.map((k, i) => `<th>
        <span class="cmp-h-num">${esc(k)}</span>
        <em class="cmp-h-x" data-x="${esc(list[i].num)}" role="button" aria-label="移除 ${esc(list[i].num)}">×</em>
      </th>`).join('')}</tr></thead><tbody>`;

    for (const r of rows) {
      if (r.sep) {
        html += `<tr class="cmp-sep"><th class="cmp-lb" colspan="${N + 1}">${esc(r.sep)}</th></tr>`;
        continue;
      }
      html += `<tr><th class="cmp-lb">${esc(r.label)}</th>` + r.cells.map(c =>
        `<td class="${r.big ? 'big ' : ''}${c.cls}">${esc(c.text)}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table></div>';

    html += `<div class="cmp-sum">
      <p class="cmp-verdict">${esc(verdict.summary)}</p>
      <p class="cmp-verdict sub">${esc(verdict.sub)}</p>
      <p class="cmp-note">${esc(verdict.note)}</p>
    </div>`;

    m.querySelector('#cmp-body').innerHTML = html;
    m.querySelectorAll('[data-x]').forEach(el =>
      el.addEventListener('click', () => remove(el.getAttribute('data-x'))));
  }

  function openCompare() {
    if (list.length < 2) { toast('至少加入 2 个号码才能对比'); return; }
    let m = $('#cmp-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cmp-modal';
      m.className = 'modal';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.setAttribute('aria-label', '号码对比');
      m.innerHTML = `<div class="modal-bg"></div>
        <div class="modal-inner cmp-inner">
          <h3 class="cmp-title">号码对比</h3>
          <div id="cmp-body"></div>
          <button class="btn-sub" id="cmp-share">分享对比图</button>
          <button class="btn-sub" id="cmp-close">关闭</button>
        </div>`;
      document.body.appendChild(m);
      m.querySelector('.modal-bg').addEventListener('click', close);
      m.querySelector('#cmp-close').addEventListener('click', close);
      m.querySelector('#cmp-share').addEventListener('click', () => {
        if (!shareCompare) { toast('对比图功能未就绪'); return; }
        shareCompare(list, buildTable(list).verdict);
      });
    }
    renderModal();
    m.classList.add('on');
  }
  function close() { const m = $('#cmp-modal'); if (m) m.classList.remove('on'); }

  /* ---------- 历史记录里的快捷加入 ---------- */
  /* 覆盖"测过几个、事后想比"的场景 */
  function syncHistoryChips() {
    document.querySelectorAll('#hist-list .hrow').forEach(row => {
      const num = row.getAttribute('data-num');
      if (!num) return;
      if (row.querySelector('.hrow-cmp')) return;
      const b = document.createElement('em');
      b.className = 'hrow-cmp' + (has(num) ? ' on' : '');
      b.textContent = has(num) ? '✓' : '+';
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', '加入对比');
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        if (has(num)) {
          remove(num); b.textContent = '+'; b.classList.remove('on'); return;
        }
        const r = analyze(num);
        if (r && r.ok) { add(r); b.textContent = '✓'; b.classList.add('on'); }
      });
      row.appendChild(b);
    });
  }

  renderDock();

  return { add, remove, clear, has, syncHistoryChips, get list() { return list; } };
}
