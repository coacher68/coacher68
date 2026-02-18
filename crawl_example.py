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
        if result.success:
            print("Crawl successful!")
            print(f"\nMarkdown content (first 500 chars):\n{result.markdown[:500]}")
        else:
            print(f"Crawl failed: {result.error_message}")


if __name__ == "__main__":
    asyncio.run(main())
