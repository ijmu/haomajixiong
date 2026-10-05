import { fmtFull } from './engine.js?v=20260929v';

/* ---------- 分享成图 ---------- */
/* 用 canvas 直接绘制（而不是把页面 SVG 光栅化）：SVG → Image → canvas 在部分 WebView
   上会因 foreignObject / 外部字体而静默失败，直接绘制路径最可靠。 */
const CARD_W = 540, CARD_H = 900;
const CF = (w, s) => `${w} ${s}px "PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei",sans-serif`;

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrapText(g, text, maxW) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
    else line += ch;
  }
  if (line) out.push(line);
  return out;
}

function drawShareCard(r, clamp) {
  /* 倍率上限 2：3x 出图 1620×2700 约 1.4MB，微信等平台会二次压缩甚至拒收；
     2x 得 1080×1800 约 0.6MB，清晰度足够且体积友好 */
  const S = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 2)));
  const cv = document.createElement('canvas');
  cv.width = CARD_W * S;
  cv.height = CARD_H * S;
  const g = cv.getContext('2d');
  g.scale(S, S);

  const GOLD = '#d9b877', GOLD2 = '#f4e0b0', DIM = '#9b93a8', DIM2 = '#8b83a0';
  const LINE = '#2c2537';
  const tone = r.total >= 69 ? '#63d392' : (r.total < 49 ? '#ea6f62' : GOLD);

  /* 背景 */
  const bg = g.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#181422'); bg.addColorStop(0.45, '#100e17'); bg.addColorStop(1, '#0b0a10');
  g.fillStyle = bg; g.fillRect(0, 0, CARD_W, CARD_H);
  const gl = g.createRadialGradient(CARD_W / 2, -40, 20, CARD_W / 2, -40, 460);
  gl.addColorStop(0, 'rgba(217,184,119,.22)'); gl.addColorStop(1, 'rgba(217,184,119,0)');
  g.fillStyle = gl; g.fillRect(0, 0, CARD_W, 440);

  const cx = CARD_W / 2;

  /* 顶部品牌 */
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = CF(400, 26); g.fillStyle = GOLD;
  g.fillText('☯\ufe0e', cx, 46);
  g.font = CF(700, 29); g.fillStyle = GOLD2;
  g.fillText('号码玄机', cx, 88);
  g.font = CF(400, 12.5); g.fillStyle = DIM2;
  g.fillText('手 机 号 码 吉 凶 测 算', cx, 116);

  /* 号码 */
  g.font = CF(700, 33); g.fillStyle = GOLD2;
  g.fillText(r.fmt, cx, 176);
  g.font = CF(400, 12); g.fillStyle = DIM2;
  g.fillText(r.carrier, cx, 205);

  g.strokeStyle = LINE; g.lineWidth = 1;
  g.beginPath(); g.moveTo(40, 232); g.lineTo(CARD_W - 40, 232); g.stroke();

  /* 分数环 */
  const RCX = 138, RCY = 330, RR = 66;
  g.lineWidth = 11; g.lineCap = 'round';
  g.strokeStyle = '#241f30';
  g.beginPath(); g.arc(RCX, RCY, RR, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = tone;
  g.shadowColor = tone; g.shadowBlur = 16;
  g.beginPath();
  g.arc(RCX, RCY, RR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(r.total, 0, 100) / 100);
  g.stroke();
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.font = CF(700, 44); g.fillStyle = tone;
  g.fillText(String(Math.round(r.total)), RCX, RCY - 4);
  g.font = CF(400, 11.5); g.fillStyle = DIM2;
  g.fillText('综合评分', RCX, RCY + 30);

  /* 右侧：评级 + 判词 */
  const LX = 232, LW = CARD_W - LX - 40;
  g.textAlign = 'left';
  const bTxt = `${r.grade.grade} · ${r.grade.qian}`;
  g.font = CF(700, 17);
  const bW = g.measureText(bTxt).width;
  g.fillStyle = 'rgba(255,255,255,.06)';
  rrect(g, LX, 268, bW + 26, 30, 15); g.fill();
  g.strokeStyle = tone; g.lineWidth = 1; rrect(g, LX, 268, bW + 26, 30, 15); g.stroke();
  g.fillStyle = tone; g.textBaseline = 'middle';
  g.fillText(bTxt, LX + 13, 284);

  g.font = CF(400, 13);
  let yy = 322;
  for (const para of [r.verdict[0], r.verdict[1]]) {
    g.fillStyle = '#bdb6c6';
    for (const ln of wrapText(g, para, LW)) { g.fillText(ln, LX, yy); yy += 20; }
    yy += 7;
  }

  g.beginPath(); g.moveTo(40, 452); g.lineTo(CARD_W - 40, 452); g.stroke();

  /* 五维雷达 */
  const RX = cx, RY = 620, RAD = 92;
  const N = r.dims.length;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / N;
    return [RX + Math.cos(a) * RAD * f, RY + Math.sin(a) * RAD * f];
  };
  g.strokeStyle = '#3a3346'; g.lineWidth = 1;
  for (const f of [1, 0.75, 0.5, 0.25]) {
    g.beginPath();
    for (let i = 0; i < N; i++) { const [x, y] = pt(i, f); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke();
  }
  for (let i = 0; i < N; i++) {
    const [x, y] = pt(i, 1);
    g.beginPath(); g.moveTo(RX, RY); g.lineTo(x, y); g.stroke();
  }
  g.beginPath();
  r.dims.forEach((d, i) => { const [x, y] = pt(i, clamp(d.v, 5, 100) / 100); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath();
  g.fillStyle = 'rgba(217,184,119,.20)'; g.fill();
  g.strokeStyle = GOLD; g.lineWidth = 2; g.stroke();
  r.dims.forEach((d, i) => {
    const [x, y] = pt(i, clamp(d.v, 5, 100) / 100);
    g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fillStyle = GOLD2; g.fill();
    const [lx, ly] = pt(i, 1.30);
    g.textAlign = 'center';
    g.font = CF(400, 12.5); g.fillStyle = DIM;
    g.fillText(d.n, lx, ly - 8);
    g.font = CF(700, 14); g.fillStyle = d.v >= 70 ? '#63d392' : (d.v < 50 ? '#ea6f62' : GOLD2);
    g.fillText(String(Math.round(d.v)), lx, ly + 9);
  });

  g.strokeStyle = LINE;
  g.beginPath(); g.moveTo(40, 792); g.lineTo(CARD_W - 40, 792); g.stroke();

  /* 四轴 */
  const axes = [['磁场', r.magnet.score], ['数理', r.shuli.point], ['形态', r.pattern.score], ['五行', r.five.score]];
  axes.forEach(([n, v], i) => {
    const w = (CARD_W - 80 - 3 * 14) / 4;
    const x = 40 + i * (w + 14);
    g.textAlign = 'left';
    g.font = CF(400, 11.5); g.fillStyle = DIM2;
    g.fillText(n, x, 820);
    g.font = CF(700, 17); g.fillStyle = GOLD2;
    g.fillText(String(Math.round(v)), x, 843);
    g.fillStyle = '#241f30';
    rrect(g, x, 856, w, 5, 2.5); g.fill();
    g.fillStyle = GOLD;
    rrect(g, x, 856, Math.max(3, w * clamp(v, 0, 100) / 100), 5, 2.5); g.fill();
  });

  g.textAlign = 'center';
  g.font = CF(600, 13); g.fillStyle = GOLD;
  g.fillText('haomajixiong.pages.dev', cx, 874);
  g.font = CF(400, 10.5); g.fillStyle = '#8b83a0';
  g.fillText('传统民俗数理 · 文化娱乐参考 · 不构成任何决策建议', cx, 893);
  return cv;
}

function dataURLtoBlob(durl) {
  const [head, b64] = durl.split(',');
  const mime = /:(.*?);/.exec(head)[1];
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/* 分享不可用时的兜底：弹层展示图片，引导长按保存 */
function showImageModal($, url, hint) {
  let m = $('#img-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'img-modal';
    m.className = 'modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', '测算结果分享图');
    m.innerHTML = `<div class="modal-bg"></div><div class="modal-inner">
      <img id="img-modal-pic" alt="测算结果分享图">
      <p class="modal-hint" id="img-modal-hint"></p>
      <button class="btn-sub" id="img-modal-close">关闭</button></div>`;
    document.body.appendChild(m);
    m.querySelector('.modal-bg').addEventListener('click', () => m.classList.remove('on'));
    m.querySelector('#img-modal-close').addEventListener('click', () => m.classList.remove('on'));
  }
  m.querySelector('#img-modal-pic').src = url;
  m.querySelector('#img-modal-hint').textContent = hint || '';
  m.classList.add('on');
}

export function initShare(deps) {
  const { getLast, $, clamp, copyText, plainText } = deps;
  return async function shareCard() {
  const LAST = getLast();
  if (!LAST) return;
  const tip = $('#copy-tip');
  const say = m => { if (tip) tip.textContent = m; };
  say('正在生成图片…');
  let cv;
  try {
    cv = drawShareCard(LAST, clamp);
  } catch (e) {
    say('生成图片失败，已改为复制文字结果');
    const ok = await copyText(plainText(LAST));
    say(ok ? '✓ 已复制文字结果' : '生成与复制均失败，请长按页面选择文字');
    return;
  }

  const fname = `号码玄机-${LAST.num}.png`;
  const shareTitle = `${LAST.grade.qian} · ${Math.round(LAST.total)} 分`;
  const shareText = `我的手机号测算：${LAST.grade.grade} 级 · ${LAST.grade.qian}｜${Math.round(LAST.total)} 分`;
  await exportCanvasImage(cv, fname, shareTitle, shareText, { $, say });
  };
}

/* ---------- 对比成图 ----------
   "帮我选号"天然是社交场景：对比表是最该被分享的东西。
   布局：每号一列（分数卡 + 迷你雷达），一眼看出形状差异，细节表留在站内。 */
const CMP_W = 720, CMP_H = 870;
const CMP_COLORS = ['#d9b877', '#63d392', '#7fb3e8', '#e8a0b0'];

function cmpRadar(g, cx, cy, R, dims, color, clamp) {
  const n = dims.length;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  g.strokeStyle = '#332c42'; g.lineWidth = 1;
  for (const f of [1, 0.75, 0.5, 0.25]) {
    g.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, f); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke();
  }
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
  g.beginPath();
  dims.forEach((v, i) => { const [x, y] = pt(i, clamp(v, 5, 100) / 100); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath();
  g.fillStyle = color + '3d'; g.fill();
  g.strokeStyle = color; g.lineWidth = 2; g.stroke();
  g.fillStyle = color;
  dims.forEach((v, i) => { const [x, y] = pt(i, clamp(v, 5, 100) / 100); g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); });
  const DN = ['财', '事', '情', '健', '人'];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = CF(400, 10); g.fillStyle = '#9b93a8';
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1.34); g.fillText(DN[i], x, y); }
}

export function drawCompareCard(list, verdict, clamp) {
  const S = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 2)));
  const cv = document.createElement('canvas');
  cv.width = CMP_W * S; cv.height = CMP_H * S;
  const g = cv.getContext('2d');
  g.scale(S, S);

  const N = list.length;
  const PAD = 40, GAP = 14;
  const colW = (CMP_W - PAD * 2 - (N - 1) * GAP) / N;

  const bg = g.createLinearGradient(0, 0, 0, CMP_H);
  bg.addColorStop(0, '#181422'); bg.addColorStop(0.45, '#100e17'); bg.addColorStop(1, '#0b0a10');
  g.fillStyle = bg; g.fillRect(0, 0, CMP_W, CMP_H);
  const gl = g.createRadialGradient(CMP_W / 2, -30, 20, CMP_W / 2, -30, 420);
  gl.addColorStop(0, 'rgba(217,184,119,.20)'); gl.addColorStop(1, 'rgba(217,184,119,0)');
  g.fillStyle = gl; g.fillRect(0, 0, CMP_W, 400);

  /* 头部 */
  const cx = CMP_W / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = CF(700, 27); g.fillStyle = '#f4e0b0';
  g.fillText('号码对比', cx, 58);
  g.font = CF(400, 12.5); g.fillStyle = '#9b93a8';
  g.fillText(`☯\ufe0e 号码玄机 · ${N} 个候选`, cx, 88);

  g.strokeStyle = '#2c2537'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(PAD, 118); g.lineTo(CMP_W - PAD, 118); g.stroke();

  /* 分数卡（按总分降序） */
  const numFs = N >= 4 ? 11.5 : 13;
  list.forEach((x, i) => {
    const color = CMP_COLORS[i % CMP_COLORS.length];
    const x0 = PAD + i * (colW + GAP);
    g.fillStyle = 'rgba(255,255,255,.05)';
    rrect(g, x0, 142, colW, 148, 12); g.fill();
    g.fillStyle = color;
    rrect(g, x0, 142, colW, 4, 2); g.fill();

    g.fillStyle = color;
    rrect(g, x0 + colW / 2 - 30, 158, 60, 20, 10); g.fill();
    g.font = CF(700, 12); g.fillStyle = '#1c1508';
    g.fillText(`${x.g} · ${x.luck}`, x0 + colW / 2, 168);

    g.font = CF(700, 30); g.fillStyle = '#f4e0b0';
    g.fillText(String(Math.round(x.total)), x0 + colW / 2, 208);
    g.font = CF(400, 10.5); g.fillStyle = '#8b83a0';
    g.fillText('综合评分', x0 + colW / 2, 236);

    g.font = CF(600, numFs); g.fillStyle = '#d9b877';
    g.fillText(fmtFull(x.num), x0 + colW / 2, 268);
  });

  g.strokeStyle = '#2c2537';
  g.beginPath(); g.moveTo(PAD, 316); g.lineTo(CMP_W - PAD, 316); g.stroke();

  /* 迷你雷达（按加入顺序，颜色与列表/页内一致） */
  const RY = 470, R = Math.min(colW * 0.36, 96);
  list.forEach((x, i) => {
    const color = CMP_COLORS[i % CMP_COLORS.length];
    const cx2 = PAD + i * (colW + GAP) + colW / 2;
    cmpRadar(g, cx2, RY, R, x.dims, color, clamp);
    g.font = CF(600, numFs); g.fillStyle = color;
    g.fillText(fmtFull(x.num), cx2, RY + R + 26);
  });

  g.strokeStyle = '#2c2537';
  g.beginPath(); g.moveTo(PAD, RY + R + 52); g.lineTo(CMP_W - PAD, RY + R + 52); g.stroke();

  /* 各维最强（并列都标） */
  const DIMN = ['财运', '事业', '感情', '健康', '人际'];
  const MARK = ['①', '②', '③', '④'];
  const winners = DIMN.map((_, d) => {
    let mx = -1;
    list.forEach(x => { const v = (x.dims || [])[d] ?? -1; if (v > mx) mx = v; });
    return list.map((x, i) => (((x.dims || [])[d] ?? -1) === mx ? MARK[i] : '')).join('');
  });
  let wy = RY + R + 84;
  g.font = CF(400, 12.5); g.fillStyle = '#8b83a0';
  g.fillText('各维最强', cx, wy); wy += 26;
  g.font = CF(600, 13.5);
  const parts = DIMN.map((n, d) => `${n} ${winners[d]}`).join('   ');
  g.fillStyle = '#f4e0b0';
  g.fillText(parts, cx, wy); wy += 30;

  /* 结论（来自 buildTable，与页内一致） */
  g.font = CF(400, 12.5); g.fillStyle = '#bdb6c6';
  for (const ln of wrapText(g, verdict.summary, CMP_W - PAD * 2)) { g.fillText(ln, cx, wy); wy += 20; }
  g.fillStyle = '#9b93a8';
  for (const ln of wrapText(g, verdict.sub, CMP_W - PAD * 2)) { g.fillText(ln, cx, wy); wy += 20; }

  g.textAlign = 'center';
  g.font = CF(600, 13); g.fillStyle = '#d9b877';
  g.fillText('haomajixiong.pages.dev', cx, CMP_H - 40);
  g.font = CF(400, 10.5); g.fillStyle = '#8b83a0';
  g.fillText('传统民俗数理 · 文化娱乐参考', cx, CMP_H - 18);
  return cv;
}

/* 出图后的统一链路：系统分享(带文件) → 下载 → 弹层长按保存。
   结果卡与对比卡共用，避免两条降级路径日后改不同步。 */
export async function exportCanvasImage(cv, fname, title, text, io) {
  const { $, say } = io;
  /* 不用 cv.toBlob：其回调在部分 WebView 里可能永不触发（实测把整个流程挂死，
     toast 停在"正在生成…"不再前进）。toDataURL 是同步 API，先取数据 URL
     再转 Blob，路径确定、无回调依赖。 */
  const durl = cv.toDataURL('image/png');
  const blob = dataURLtoBlob(durl);
  const url = URL.createObjectURL(blob);
  const file = new File([blob], fname, { type: 'image/png' });

  /* navigator.share 要求「用户激活」。激活过期时它不按规范抛 NotAllowedError，
     而是可能永久挂起（实测：toast 停在初始文案、整个流程卡死）。
     双保险：① 无激活直接跳过系统分享走降级；② 有激活也加超时赛跑兜底。 */
  const fresh = !navigator.userActivation || navigator.userActivation.isActive;
  if (fresh && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await Promise.race([
        navigator.share({ files: [file], title, text }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('share-timeout')), 10000))
      ]);
      say('✓ 已唤起系统分享');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') { say('已取消分享'); return; }
    }
  }
  try {
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    say('✓ 已生成图片，若未自动下载请改用长按保存');
  } catch (e) { /* 继续走兜底 */ }
  showImageModal($, url, '长按图片可保存到相册');
  say('已生成分享图 · 长按图片保存');
}
