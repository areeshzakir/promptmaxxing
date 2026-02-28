import asyncio
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

async def main():
    browser_config = BrowserConfig(headless=True)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(
            url="https://furoku.github.io/bananaX/projects/infographic-evaluation/en/",
            config=run_config
        )
        with open("target_page.html", "w", encoding="utf-8") as f:
            f.write(result.html)

if __name__ == "__main__":
    asyncio.run(main())
