"""
Example usage of Crawl4AI - an AI-ready web crawler.

Before running, ensure you have completed the setup:
    pip install -r requirements.txt
    crawl4ai-setup
    crawl4ai-doctor  # optional, verifies installation
"""

import asyncio
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig


async def main():
    browser_config = BrowserConfig(headless=True)
    crawl_config = CrawlerRunConfig()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(
            url="https://www.example.com",
            config=crawl_config,
        )
        print("Crawl successful!" if result.success else "Crawl failed!")
        print(f"\nMarkdown content (first 500 chars):\n{result.markdown[:500]}")


if __name__ == "__main__":
    asyncio.run(main())
