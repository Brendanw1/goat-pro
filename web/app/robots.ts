import type { MetadataRoute } from "next";

// AI training/scraper crawlers: ~86% of requests on 2026-10-30 (meta-externalagent + GPTBot),
// every one a dynamic render. Search engines stay; query-string variants (?season=, sort/filter
// state) are the same page re-rendered, so crawlers get the base URLs only.
const AI_BOTS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "CCBot", "Bytespider", "PerplexityBot", "Perplexity-User", "Amazonbot", "meta-externalagent",
  "meta-externalfetcher", "FacebookBot", "Google-Extended", "Applebot-Extended", "cohere-ai",
  "Diffbot", "ImagesiftBot", "Omgilibot", "Timpibot", "YouBot", "DataForSeoBot", "AhrefsBot",
  "SemrushBot", "MJ12bot", "DotBot", "PetalBot", "Barkrowler", "TikTokSpider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_BOTS, disallow: "/" },
      { userAgent: "*", allow: "/", disallow: ["/api/", "/*?"], crawlDelay: 5 },
    ],
  };
}
