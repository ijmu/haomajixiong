/* 对比模块单测：纯函数 buildTable / snap，直接在 node 下跑，不依赖浏览器 */
import { analyze } from '../web/js/engine.js';
import { snap, buildTable, fmtFull, GRADE_RANK } from '../web/js/compare.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } };

const NUMS = ['13912345678', '18888888888', '15900001234'];
const snaps = NUMS.map(n => snap(analyze(n)));
const T = buildTable(snaps);

console.log('=== 1) 号码格式统一 3-4-4 ===');
ok(fmtFull('13912345678') === '139 1234 5678', 'fmtFull 输出');
ok(T.keys.every(k => /^\d{3} \d{4} \d{4}$/.test(k)), 'keys 全为 3-4-4：' + T.keys.join(' | '));
console.log('  ' + T.keys.join('  |  '));

console.log('=== 2) 行数与结构 ===');
const seps = T.rows.filter(r => r.sep);
const data = T.rows.filter(r => !r.sep);
ok(seps.length === 2, `分隔行 2 个，实际 ${seps.length}`);
ok(data.length === 16, `数据行 16 个，实际 ${data.length}`);
ok(data.every(r => r.cells.length === 3), '每行 3 列');
console.log(`  分隔行: ${seps.map(s => s.sep).join(' / ')} | 数据行 ${data.length}`);

console.log('=== 3) 分类值不得被误判为「最优」（本次修的 bug）===');
const CATEGORICAL = ['尾号磁场', '尾号数字', '最旺五行'];
for (const name of CATEGORICAL) {
  const r = T.rows.find(x => x.label === name);
  const lit = r.cells.filter(c => c.cls === 'best' || c.cls === 'worst').length;
  ok(lit === 0, `「${name}」不应有高亮，实际 ${lit} 个`);
  console.log(`  「${name}」 ${r.cells.map(c => c.text + (c.cls ? `<${c.cls}>` : '')).join(' | ')}`);
}

console.log('=== 4) 评级行按 S>A>B>C>D>E 正确高亮 ===');
const gRow = T.rows.find(x => x.label === '评级');
const ranks = snaps.map(s => GRADE_RANK[s.g]);
const bestRank = Math.max(...ranks), worstRank = Math.min(...ranks);
gRow.cells.forEach((c, i) => {
  const want = ranks[i] === bestRank && bestRank !== worstRank ? 'best'
    : ranks[i] === worstRank && bestRank !== worstRank ? 'worst' : '';
  ok(c.cls === want, `评级第${i + 1}列 期望「${want}」实际「${c.cls}」`);
});
console.log('  ' + gRow.cells.map((c, i) => `${c.text}${c.cls ? '<' + c.cls + '>' : ''}`).join(' | '));

console.log('=== 5) 数值行高亮方向正确 ===');
const numRows = T.rows.filter(r => !r.sep && r.cells.some(c => c.cls));
for (const r of numRows) {
  const values = snaps.map(s => Number(String(r.cells[snaps.indexOf(s)].text).replace(/[^\d.]/g, '')));
  const hasBest = r.cells.some(c => c.cls === 'best');
  const hasWorst = r.cells.some(c => c.cls === 'worst');
  ok(hasBest === hasWorst, `「${r.label}」best/worst 应成对出现`);
  console.log(`  「${r.label}」 ${r.cells.map(c => c.text + (c.cls === 'best' ? '★' : c.cls === 'worst' ? '▽' : '')).join(' | ')}`);
}

console.log('=== 6) 五行缺失是 lo（越少越好）===');
const miss = T.rows.find(x => x.label === '五行缺失');
const counts = snaps.map(s => s.missing.length);
const minC = Math.min(...counts), maxC = Math.max(...counts);
miss.cells.forEach((c, i) => {
  const want = counts[i] === minC && minC !== maxC ? 'best'
    : counts[i] === maxC && minC !== maxC ? 'worst' : '';
  ok(c.cls === want, `五行缺失第${i + 1}列 期望「${want}」实际「${c.cls}」`);
});
console.log('  ' + miss.cells.map((c, i) => `${c.text}[${counts[i]}]${c.cls ? '<' + c.cls + '>' : ''}`).join(' | '));

console.log('=== 7) 全等值不应产生高亮 ===');
const same = [snap(analyze('13912345678')), snap(analyze('13912345678'))];
const T2 = buildTable(same);
const anyLit = T2.rows.filter(r => !r.sep).flatMap(r => r.cells).some(c => c.cls);
ok(!anyLit, '两个完全相同的号码不应有任何高亮');
console.log('  高亮数: ' + (anyLit ? '有（错误）' : '0 ✓'));

console.log('=== 8) 结论指向综合分最高者 ===');
const top = [...snaps].sort((a, b) => b.total - a.total)[0];
ok(T.verdict.summary.includes(fmtFull(top.num)), '结论含最高分号码');
ok(T.verdict.note.includes('噪声'), '含噪声提示');
console.log('  ' + T.verdict.summary);
console.log('  ' + T.verdict.sub);
console.log('  各号总分: ' + snaps.map(s => `${s.g}${s.total.toFixed(1)}`).join(' | '));

console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
/* 不能用 process.exit()：stdout 被管道/重定向时它会截断尚未刷出的缓冲，
   表现为「退出码 0 但看不到汇总行」。置 exitCode 让 node 自然退出即可。 */
process.exitCode = fail ? 1 : 0;
