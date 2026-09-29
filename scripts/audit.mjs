/* 完整性与恶意输入压测：找真 bug，不做表面检查 */
import { analyze, validate, normalizeInput, shuLi, magnet, fiveElement, pattern } from '../web/js/engine.js';
import { SHULI, CIGROUP, CIPAIR, CIZERO, FIVE, CARRIER, TAIL, NUM } from '../web/js/data.js';
import { snap, buildTable, isSnapshot, sanitizeList } from '../web/js/compare.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (c, m) => { if (c) pass++; else { fail++; bad.push(m); } };

console.log('=== ① 数据表完整性 ===');
const missing = [];
for (let i = 1; i <= 80; i++) if (!SHULI[i]) missing.push(i);
ok(missing.length === 0, `SHULI 缺键: ${missing.join(',')}`);
console.log(`  SHULI 1-80 覆盖: ${80 - missing.length}/80`);
const lvOk = Object.values(SHULI).every(v => v && typeof v.w === 'number');
ok(lvOk, 'SHULI 每项都有 w');
/* CIPAIR 只覆盖 8 个数字两两组合 = 64 组，这是设计如此：
   八星磁场由 {1,2,3,4,6,7,8,9} 构成，含 0/5 的另走空亡(CIZERO)与强化分支。 */
const ZERO_FIVE = '05';
const pairs = [];
for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) {
  const p = `${a}${b}`;
  if (ZERO_FIVE.includes(String(a)) || ZERO_FIVE.includes(String(b))) continue;
  if (!CIPAIR[p]) pairs.push(p);
}
ok(pairs.length === 0, `CIPAIR 缺组合: ${pairs.join(',')}`);
const nPairs = 64;
console.log(`  CIPAIR 覆盖: ${nPairs - pairs.length}/${nPairs}（8 数两两，设计如此；含 0/5 走空亡）`);
console.log(`  含 0/5 组合走 CIZERO: ${Object.keys(CIZERO).length ? '已定义' : '缺失⚠'}`);
const gs = new Set(Object.values(CIPAIR).map(v => v.g));
ok(!!CIZERO && typeof CIZERO === 'object' && Object.keys(CIZERO).length > 0, '空亡组（CIZERO）已定义');
console.log(`  磁场分组: ${[...gs].join(',')}`);

console.log('=== ② 数理边界（后四位取灵数的坑）===');
const edge = [['13xx0000', '0000'], ['13xx0080', '0080'], ['13xx0160', '0160'],
  ['13xx9999', '9999'], ['13xx0800', '0800'], ['13xx8000', '8000']];
for (const [label, last4] of edge) {
  const num = '1391234' + last4;
  try {
    const s = shuLi(num);
    const good = s.idx >= 1 && s.idx <= 80 && !!SHULI[s.idx] &&
      s.point >= 0 && s.point <= 100 && Number.isFinite(s.point);
    ok(good, `${label} idx=${s.idx} point=${s.point}`);
    console.log(`  后四位 ${last4} → idx ${String(s.idx).padStart(2)} (${s.n}) 数理分 ${s.point.toFixed(1)}`);
  } catch (e) { ok(false, `${label} 抛异常: ${e.message}`); }
}

console.log('=== ③ validate 边界矩阵 ===');
const cases = [
  ['', false], ['1', false], ['1380013800', false], ['138001380000', false],
  ['13800138000', true], ['23812345678', false], ['10812345678', false],
  ['11812345678', false], ['12812345678', false], ['138-0013-8000', true],
  ['  138 0013 8000 ', true], ['138abc00138000', true], ['+8613800138000', true],
  ['１３８００１３８０００', false], ['00000000000', false],
  ['+8613800138000', true], ['008613800138000', true], ['8613800138000', true],
  ['+86 138 0013 8000', true], ['138001380001', false], ['+12345678901234', false],
  ['../../../etc/passwd', false], ['<script>', false], [null, false],
  [undefined, false], [0, false], [{}, false], [[], false],
  [NaN, false], [1e10, false], ['1e10', false],
];
for (const [inp, want] of cases) {
  let got, err = null;
  try { got = validate(inp).ok; } catch (e) { err = e.message; }
  ok(err === null && got === want, `validate(${JSON.stringify(inp)}) 期望 ${want} 得到 ${err ? '异常:' + err : got}`);
}
console.log(`  ${cases.length} 个用例`);

console.log('=== ③b 国际区号归一化（输入框与校验必须共用同一实现）===');
/* 这条回归来自一个真实的「只修一半」：validate() 认了 +86，但输入框在 input 时
   就先截断到 11 位，粘贴 +8613800138000 会被切成 86138001380（错的号码）。
   故断言不止测 validate，还要测归一化本身的顺序：先剥区号、后截 11 位。 */
const intl = [
  ['+8613800138000', '13800138000'], ['008613800138000', '13800138000'],
  ['8613800138000', '13800138000'], ['+86 138 0013 8000', '13800138000'],
  ['13800138000', '13800138000'], ['138-0013-8000', '13800138000'],
  ['+86 (138) 0013-8000', '13800138000'], ['  138 0013 8000  ', '13800138000'],
];
for (const [inp, want] of intl) {
  const got = normalizeInput(inp);
  ok(got === want, `normalizeInput(${JSON.stringify(inp)}) 期望 ${want} 得到 ${got}`);
  ok(validate(inp).ok && validate(inp).num === want, `validate(${JSON.stringify(inp)}) 应通过并得 ${want}`);
}
/* 关键顺序断言：若先截断后剥区号，这组必然失败 */
ok(normalizeInput('+8613800138000') === '13800138000', '剥区号必须先于截断（否则得到 86138001380）');
ok(normalizeInput('1380013800012345') === '13800138000', '无区号超长输入取前 11 位');
/* 剥区号后仍超长（15 位）必须拒绝：无法判断哪 11 位是真号，静默截断会算错号 */
ok(!validate('86138001380001234').ok, '剥区号后仍超长必须拒绝，不得静默截断猜号');
ok(validate('138001380001').ok === false, '无区号超长同样拒绝（校验器不静默截断）');
ok(normalizeInput('1380013800012345') === '13800138000', '但输入框（硬上限）剥区号后截 11 位');
console.log(`  ${intl.length} 组国际格式全部归一正确`);

console.log('=== ④ 全输入域 fuzz：不得抛异常、输出必须合法 ===');
let seed = 99, fz = 0, ex = 0, rangeBad = 0;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 30000; i++) {
  let n = '1' + Math.floor(rnd() * 10);
  for (let j = 0; j < 9; j++) n += Math.floor(rnd() * 10);
  try {
    const r = analyze(n);
    if (!r.ok) continue;
    fz++;
    const nums = [r.total, r.magnet.score, r.shuli.point, r.pattern.score, r.five.score,
      ...r.dims.map(d => d.v)];
    if (nums.some(v => !Number.isFinite(v) || v < 0 || v > 100)) { rangeBad++; if (rangeBad < 3) bad.push(`越界 ${n}: ${nums}`); }
    if (!['S', 'A', 'B', 'C', 'D', 'E'].includes(r.grade.grade)) bad.push(`非法评级 ${n}`);
    if (!/^\d{3} \d{4} \d{4}$/.test(r.fmt)) bad.push(`fmt 非 3-4-4 ${n} → ${r.fmt}`);
    if (r.dims.length !== 5) bad.push(`维数非5 ${n}`);
    if (!r.verdict || r.verdict.length < 2) bad.push(`判词缺失 ${n}`);
    if (!Array.isArray(r.advice)) bad.push(`advice 非数组 ${n}`);
  } catch (e) { ex++; if (ex < 4) bad.push(`fuzz 异常 ${n}: ${e.message}`); }
}
ok(ex === 0, `fuzz 异常 ${ex} 次`);
ok(rangeBad === 0, `数值越界 ${rangeBad} 次`);
console.log(`  ${fz} 个有效号码 · 异常 ${ex} · 越界 ${rangeBad}`);

console.log('=== ⑤ 全量网段遍历（13x~19x）压力 ===');
let netEx = 0, netN = 0;
for (let s2 = 3; s2 <= 9; s2++) {
  for (let s3 = 0; s3 <= 9; s3++) {
    const seg = `1${s2}${s3}`;
    if (['10', '11', '12'].includes(`${s2}${s3}`)) continue;
    for (let k = 0; k < 30; k++) {
      let n = seg; for (let j = 0; j < 8; j++) n += Math.floor(rnd() * 10);
      try { const r = analyze(n); if (r.ok) netN++; else netEx++; } catch (e) { netEx++; }
    }
  }
}
ok(netEx === 0, `网段遍历异常/拒绝 ${netEx} 次`);
console.log(`  覆盖 ${netN} 个各号段号码`);

console.log('=== ⑥ 对比模块：存储卫生（测的是生产代码本身）===');
/* read() 内部就是 sanitizeList(JSON.parse(...))，故此处直接测它就是测生产路径 */
const realSnap = snap(analyze('13912345678'));
ok(isSnapshot(realSnap), '真实 snap() 产物必须通过校验');
for (const [label, mut] of [
  ['缺 feats', x => ({ ...x, feats: undefined })],
  ['缺 dominant', x => ({ ...x, dominant: undefined })],
  ['缺 missing', x => ({ ...x, missing: undefined })],
  ['dims 仅 4 维', x => ({ ...x, dims: [1, 2, 3, 4] })],
  ['dims 含 NaN', x => ({ ...x, dims: [1, 2, NaN, 4, 5] })],
  ['total 为 NaN', x => ({ ...x, total: NaN })],
  ['total 为字符串', x => ({ ...x, total: '74' })],
  ['非法号码', x => ({ ...x, num: 'x' })],
  ['null 条目', () => null],
  ['字符串条目', () => 'nope'],
]) ok(!isSnapshot(mut(realSnap)), `残缺快照应被拒: ${label}`);
ok(sanitizeList('garbage').length === 0, '非数组输入 → 空');
ok(sanitizeList([realSnap, { num: 'bad' }]).length === 1, '混合输入只留合法项');
ok(sanitizeList(Array(9).fill(realSnap)).length === 4, '超量输入截到上限 4');
console.log(`  校验与截断全部正确（上限 4）`);

console.log('=== ⑥b 回归：残缺/陈旧快照不得打崩对比表 ===');
const staleSet = [
  { num: '13912345678', total: 74, g: 'B', luck: '中吉', mg: 74, sl: 78, pt: 95, wx: 61,
    dims: [57, 97, 66, 57, 68], slIdx: 78, slName: '晚苦之数', tail: '8', tailGi: '延年' },
  { num: '18888888888', total: NaN, g: 'A', luck: '吉', mg: 94, sl: 8, pt: 89, wx: 23,
    dims: null, slIdx: 8, slName: '坚刚之数', tail: '8', tailGi: '伏位', missing: [] },
  { num: 'x', total: 50, g: 'C', luck: '平' },
];
try {
  const T = buildTable(staleSet);
  ok(true, '残缺快照未抛异常');
  const cells = T.rows.filter(r => !r.sep).flatMap(r => r.cells);
  ok(cells.every(c => typeof c.text === 'string' && c.text.length > 0), '所有单元格都有文本');
  ok(cells.every(c => ['', 'best', 'worst'].includes(c.cls)), '单元格 class 合法');
  console.log(`  3 条残缺快照建表成功，单元格 ${cells.length} 个，占位符 ${cells.filter(c => c.text === '—').length} 个`);
} catch (e) {
  ok(false, `残缺快照使对比表崩溃: ${e.message}`);
}

console.log('=== ⑦ 内容一致性（文案不得自相矛盾）===');
let mismatch = 0;
for (const n of ['13912345678', '18888888888', '13800138000', '15900001234', '17701020304']) {
  const r = analyze(n);
  const weakest = [...r.dims].sort((a, b) => a.v - b.v)[0];
  const advText = r.advice.map(a => a.t + a.d).join('');
  // 建议里若点名某维为最弱，必须与雷达最弱维一致
  const mentioned = r.dims.filter(d => advText.includes(d.n) && advText.includes('最弱'));
  if (mentioned.length && !mentioned.some(d => d.n === weakest.n)) {
    mismatch++; bad.push(`${n} 建议点名 ${mentioned.map(d => d.n)} 但最弱实为 ${weakest.n}`);
  }
  // 五行缺失必须与 digits 统计一致
  const cnt = {};
  for (const d of r.num) { const e = FIVE[d].e; cnt[e] = (cnt[e] || 0) + 1; }
  const realMissing = Object.keys(cnt).length === 5 ? [] : ['金', '木', '水', '火', '土'].filter(e => !cnt[e]);
  if ([...realMissing].sort().join() !== [...r.five.missing].sort().join()) {
    mismatch++; bad.push(`${n} 缺失五行不符: 表${r.five.missing} vs 实算${realMissing}`);
  }
  // 数理算式自洽
  const l4 = parseInt(r.num.slice(-4), 10);
  if (l4 % 80 !== r.shuli.idx % 80) { mismatch++; bad.push(`${n} 数理算式不符`); }
}
ok(mismatch === 0, `内容矛盾 ${mismatch} 处`);
console.log(`  5 个样本 · 矛盾 ${mismatch} 处`);

console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
if (bad.length) { console.log('\n失败明细（前 20）:'); bad.slice(0, 20).forEach(b => console.log('  ✗ ' + b)); }
/* 不能用 process.exit()：stdout 被管道/重定向时它会截断尚未刷出的缓冲，
   表现为「退出码 0 但看不到汇总行」。置 exitCode 让 node 自然退出即可。 */
process.exitCode = fail ? 1 : 0;
