"""
Example usage of Crawl4AI - an AI-ready web crawler.

Crawls multiple websites concurrently using AsyncWebCrawler.

Before running, ensure you have completed the setup:
    pip install -r requirements.txt
    crawl4ai-setup
    crawl4ai-doctor  # optional, verifies installation
"""

import asyncio
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

# Add the URLs you want to crawl here
URLS = [
    "https://www.example.com",
    "https://www.wikipedia.org",
    "https://www.python.org",
]


async def main():
    browser_config = BrowserConfig(headless=True)
    crawl_config = CrawlerRunConfig()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        results = await crawler.arun_many(
            urls=URLS,
            config=crawl_config,
        )
        for result in results:
            if result.success:
                print(f"[OK] {result.url}")
                print(f"     {result.markdown[:200]}\n")
            else:
                print(f"[FAIL] {result.url} - {result.error_message}\n")


if __name__ == "__main__":
    asyncio.run(main())
