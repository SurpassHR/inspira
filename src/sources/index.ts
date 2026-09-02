import type { InspirationSource, SourceMaterial } from '../types.js';
import { aggregateImages, themeToQueries } from './aggregator.js';
import { fetchHotImages, type HotImageEntry } from './hotImages.js';
import { fetchHotTopics, type HotEntry } from './hotTopics.js';

function choose<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]!; }

function topicMaterial(it: HotEntry): SourceMaterial {
  return { source: 'hot_topic', label: it.title, text: it.summary ?? it.title, url: it.url };
}
function imageMaterial(it: HotImageEntry): SourceMaterial {
  return { source: 'hot_image', label: it.title ?? '网络图像', text: it.title, url: it.url, imageUrl: it.imageUrl };
}

export interface SourceDeps {
  topics?: typeof fetch;
  /** 注入到聚合抓取器（providers）的 fetch；测试用 */
  images?: typeof fetch;
}

/**
 * 解析灵感来源素材：
 * - hot_topic  从热搜源取回一条热点；失败/未配置 → 降级为“直接创意”，并记录 note
 * - hot_image  使用内置图像聚合抓取器（bing/google/wikimedia/openverse/x/自定义 JSON），
 *              按主题生成检索词抓取并随机取一条；全部失败 → 降级并记录 note
 * - original_idea 直接返回空素材
 */
export async function resolveSourceMaterial(source: InspirationSource, theme = 'general', deps: SourceDeps = {}): Promise<SourceMaterial> {
  switch (source) {
    case 'hot_topic': {
      const items = await fetchHotTopics(undefined, deps.topics);
      if (items.length > 0) return topicMaterial(choose(items));
      return { source, label: '实时热点', note: '未能获取实时热点数据，请直接围绕主题发挥创意' };
    }
    case 'hot_image': {
      const query = choose(themeToQueries(theme));
      const agg = await aggregateImages(query, { fetcher: deps.images });
      if (agg.items.length > 0) {
        const it = choose(agg.items);
        return {
          source, label: it.title || '网络图像', text: it.title,
          url: it.url, imageUrl: it.imageUrl,
        };
      }
      return { source, label: '网络图像', note: agg.note };
    }
    default:
      return { source, label: '原创点子' };
  }
}