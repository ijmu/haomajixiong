/* 选号推荐单测：锁定生成约束与排序行为 */
import { analyze, recommend } from '../web/js/engine.js';

let pass = 0, fail = 0; const bad = [];
const ok = (c, m) => { if (c) pass++; else { fail++; bad.push(m); } };
const seeded = s => { let x = s; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

console.log('=== ① 结构约束 ===');
const base1 = recommend('13912345678', { rng: seeded(42) });
ok(base1.ok, '推荐成功');
ok(base1.list.length === 6, `候选 6 个，实际 ${base1.list.length}`);
ok(base1.list.every(c => /^1\d{10}$/.test(c.num)), '全部为 11 位合法号码');
ok(base1.list.every(c => c.num.startsWith('139')), '保留原号段');
ok(base1.list.every(c => c.num !== '13912345678'), '不含原号');
ok(new Set(base1.list.map(c => c.num)).size === 6, '无重复');
console.log(`  ${base1.list.length} 个候选，号段 139，无重复`);

console.log('=== ② 避 4 约束 ===');
const r2 = recommend('13912345678', { rng: seeded(7), noFour: true });
ok(r2.list.every(c => !c.num.includes('4')), '全部不含 4');
const r2b = recommend('13912345678', { rng: seeded(7), noFour: false });
console.log(`  避4: ${r2.list.every(c => !c.num.includes('4'))} | 允许4时有含4: ${r2b.list.some(c => c.num.includes('4'))}`);

console.log('=== ③ 五行补缺 ===');
/* 18888888888：全 8（木）+1（水）→ 缺 火/金/土 */
const b = analyze('18888888888');
console.log(`  原号缺失: ${b.five.missing.join('、')}`);
const r3 = recommend('18888888888', { rng: seeded(11), fill: true });
const DIG = { 水: ['1', '6'], 火: ['2', '7'], 木: ['3', '8'], 金: ['4', '9'], 土: ['5', '0'] };
ok(r3.list.every(c => b.five.missing.every(e => c.num.split('').some(d => DIG[e].includes(d)))),
  '全部候选覆盖原号缺失元素');
const hasReason = r3.list.some(c => c.reasons.some(x => x.t === '五行'));
ok(hasReason, '理由中含五行补缺说明');
console.log('  样例: ' + r3.list[0].num + ' → ' + (r3.list[0].reasons.find(x => x.t === '五行') || {}).d);

/* 补土的诚实代价：土用 5/0，其组合为隐数/空亡 */
const r3t = recommend('13912345678', { rng: seeded(3), fill: true, target: 'all' });
console.log(`  对照（原号不缺土）: 首选含 5/0 = ${/[50]/.test(r3t.list[0].num)}`);

console.log('=== ④ 号型模板 ===');
const shapes = {
  baozi: t => /(.)\1\1$/.test(t), duizi: t => /(\d)\1(\d)\2$/.test(t),
  xunhuan: t => /(\d)(\d)\1\2$/.test(t),
  /* 尾4 = tail[4..7]，逐位 +1（mod 10，允许 9→0 回绕） */
  shunzi: t => [1, 2, 3].every(i => (+t[4 + i] - +t[3 + i] + 10) % 10 === 1)
};
for (const [shape, test] of Object.entries(shapes)) {
  const r = recommend('13912345678', { rng: seeded(5), shape });
  const hit = r.list.filter(c => test(c.num.slice(3))).length;
  ok(hit === r.list.length, `${shape}: ${hit}/${r.list.length} 命中模板`);
  console.log(`  ${shape.padEnd(8)} ${r.list.map(c => c.num.slice(3)).join(' ')}`);
}

console.log('=== ⑤ 目标维度确实被补强 ===');
/* 原号 18888888888 事业 97 已近顶 → 改用感情弱的原号 */
const wb = analyze('13912345678');
const weakest = [...wb.dims].sort((a, b) => a.v - b.v)[0];
console.log(`  原号最弱维: ${weakest.n} ${Math.round(weakest.v)}`);
const r5 = recommend('13912345678', { rng: seeded(42) });   // auto → 最弱维
const got = r5.list.map(c => c.dims[r5.base.dims.findIndex(d => d.k === r5.dimKey)]);
const mean = got.reduce((a, b2) => a + b2, 0) / got.length;
const baseV = r5.base.dims.find(d => d.k === r5.dimKey).v;
ok(mean > baseV, `top6 均值 ${mean.toFixed(1)} 应高于原号 ${baseV.toFixed(1)}`);
ok(got.every(v => v >= baseV), '每个候选都不低于原号（该维）');
console.log(`  auto→${r5.dimName}: 候选 ${got.join(',')} vs 原号 ${baseV.toFixed(1)}`);

console.log('=== ⑥ 指定综合 / 指定维度 ===');
const r6a = recommend('13912345678', { rng: seeded(9), target: 'all' });
ok(r6a.dimKey === null && r6a.dimName === '综合', 'target=all → 综合');
const r6b = recommend('13912345678', { rng: seeded(9), target: 'ren' });
ok(r6b.dimKey === 'ren' && r6b.dimName === '人际', 'target=ren → 人际');
const meanRen = r6b.list.reduce((a, c) => a + c.dims[4], 0) / r6b.list.length;
console.log(`  人际均值 ${meanRen.toFixed(1)} vs 原号 ${r6b.base.dims[4].v.toFixed(1)}`);

console.log('=== ⑦ 非法输入 ===');
ok(!recommend('123').ok, '短号拒绝');
ok(!recommend('abc').ok, '垃圾输入拒绝');

console.log('=== ⑧ 理由质量 ===');
const noEmpty = base1.list.every(c => c.reasons.length >= 1 && c.reasons.every(x => x.t && x.d));
ok(noEmpty, '每个候选都有非空理由');
console.log('  首选理由: ' + base1.list[0].reasons.map(x => x.t).join('/'));

console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
if (bad.length) bad.forEach(b2 => console.log('  ✗ ' + b2));
process.exitCode = fail ? 1 : 0;
