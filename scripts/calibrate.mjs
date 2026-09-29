#!/usr/bin/env node
/**
 * 五维标定脚本（离线）
 *
 * 目的：把 engine.js 里五个维度的「原始分」实测分布量出来，回填 RAW 常量，
 * 使五维映射到同一标尺（目标 p50≈62、p90≈80），雷达图才有形状区分度。
 *
 * 用法：
 *   node scripts/calibrate.mjs            # 只报告
 *   node scripts/calibrate.mjs --write    # 同时把 mu/sd 写回 engine.js
 */
import { rawDims } from '../web/js/engine.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '../web/js/engine.js');

const KEYS = ['cai', 'shi', 'qing', 'jian', 'ren'];
const NAMES = { cai: '财运', shi: '事业', qing: '感情', jian: '健康', ren: '人际' };

// 确定性伪随机，保证每次标定结果可复现
let seed = 20260929;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const N = parseInt(process.env.N || '20000', 10);
const buckets = { cai: [], shi: [], qing: [], jian: [], ren: [] };

for (let i = 0; i < N; i++) {
  let n = '1' + ['3', '5', '7', '8', '9'][Math.floor(rnd() * 5)];
  for (let j = 0; j < 9; j++) n += Math.floor(rnd() * 10);
  const d = rawDims(n);
  if (!d) continue;
  for (const k of KEYS) buckets[k].push(d[k]);
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

console.log(`样本 ${buckets.cai.length} 个号码\n`);
console.log('维度   原始均值  原始标准差   p10    p50    p90');
const stats = {};
for (const k of KEYS) {
  const a = buckets[k];
  stats[k] = { mu: +mean(a).toFixed(2), sd: +sd(a).toFixed(2) };
  console.log(
    (NAMES[k] + '    ').slice(0, 6),
    String(mean(a).toFixed(1)).padStart(8),
    String(sd(a).toFixed(1)).padStart(11),
    String(pct(a, 0.1).toFixed(0)).padStart(6),
    String(pct(a, 0.5).toFixed(0)).padStart(6),
    String(pct(a, 0.9).toFixed(0)).padStart(6));
}

// 映射后的预期分布（62 + (v-mu) * 13.5/sd）
console.log('\n映射到统一标尺后的预期分布（目标 p50=62 / p90≈80）：');
console.log('维度    p10    p50    p90    ≥70 占比  ≤45 占比');
for (const k of KEYS) {
  const a = buckets[k];
  const fit = v => 62 + (v - stats[k].mu) * (13.5 / stats[k].sd);
  const f = a.map(fit);
  const ge70 = f.filter(v => v >= 70).length / f.length * 100;
  const le45 = f.filter(v => v <= 45).length / f.length * 100;
  console.log(
    (NAMES[k] + '    ').slice(0, 6),
    String(fit(pct(a, 0.1)).toFixed(0)).padStart(6),
    String(fit(pct(a, 0.5)).toFixed(0)).padStart(6),
    String(fit(pct(a, 0.9)).toFixed(0)).padStart(6),
    String(ge70.toFixed(1) + '%').padStart(10),
    String(le45.toFixed(1) + '%').padStart(9));
}

// 雷达形状检查
let flat = 0, spreads = [];
for (let i = 0; i < buckets.cai.length; i++) {
  const f = KEYS.map(k => 62 + (buckets[k][i] - stats[k].mu) * (13.5 / stats[k].sd));
  const sp = Math.max(...f) - Math.min(...f);
  spreads.push(sp);
  if (sp < 15) flat++;
}
spreads.sort((a, b) => a - b);
console.log(`\n雷达极差 p10/p50/p90: ${spreads[Math.floor(spreads.length * .1)].toFixed(1)} / ` +
  `${spreads[Math.floor(spreads.length * .5)].toFixed(1)} / ${spreads[Math.floor(spreads.length * .9)].toFixed(1)}`);
console.log(`过平（极差 <15）占比: ${(flat / spreads.length * 100).toFixed(1)}%  （越低越有形）`);

if (process.argv.includes('--write')) {
  const src = readFileSync(ENGINE, 'utf8');
  const block = `const RAW = {
  cai:  { mu: ${stats.cai.mu}, sd: ${stats.cai.sd} },
  shi:  { mu: ${stats.shi.mu}, sd: ${stats.shi.sd} },
  qing: { mu: ${stats.qing.mu}, sd: ${stats.qing.sd} },
  jian: { mu: ${stats.jian.mu}, sd: ${stats.jian.sd} },
  ren:  { mu: ${stats.ren.mu}, sd: ${stats.ren.sd} }
};`;
  const re = /const RAW = \{[\s\S]*?\n\};/;
  if (!re.test(src)) {
    console.error('\n!! 未找到 RAW 常量块，未写入');
    process.exitCode = 1;
  }
  writeFileSync(ENGINE, src.replace(re, block));
  console.log('\n已写回 engine.js：\n' + block);
}
