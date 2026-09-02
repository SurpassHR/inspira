/**
 * 聚合抓取 CLI：直接调用内置图像聚合器抓取灵感素材样本，不经过 LLM。
 *
 * 用法：
 *   npm run scrape -- "neon city"
 *   npm run scrape            # 默认使用综合美学检索词
 * 可通过 IMAGE_SCRAPE_PROVIDERS 控制 provider 白名单。
 */
import { aggregateImages, themeToQueries } from './sources/aggregator.js';
import { enabledProviders } from './sources/aggregator.js';

function choose<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]!; }

const query = process.argv[2] ?? choose(themeToQueries('general'));
console.log(`检索词: ${query}\n`);

const providers = enabledProviders();
console.log(`启用 provider: ${providers.map((p) => p.id).join(', ') || '（无，请检查 IMAGE_SCRAPE_PROVIDERS / 密钥）'}\n`);

const start = Date.now();
const { items, note, tried, failed } = await aggregateImages(query);
console.log(`聚合结果: ${items.length} 条（尝试 ${tried.join('、')}，耗时 ${Date.now() - start}ms）\n`);
if (note) console.log(`提示: ${note}\n`);

for (const it of items.slice(0, 10)) {
  console.log(`[${it.provider}] ${it.title}\n  ${it.imageUrl}${it.url ? `\n  ↳ ${it.url}` : ''}`);
}

const failedList = Object.entries(failed);
if (failedList.length) console.log(`\n失败源: ${failedList.map(([id, msg]) => `${id}(${msg})`).join('；')}`);