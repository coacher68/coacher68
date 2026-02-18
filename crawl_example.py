"""
Crawl4AI - Bulk website crawler that reads URLs from a CSV file.

Usage:
    python crawl_example.py urls.csv

The CSV file should have a column named "url" (case-insensitive).
Other columns (like company name) are preserved in the output.

Before running, ensure you have completed the setup:
    pip install -r requirements.txt
    crawl4ai-setup
    crawl4ai-doctor  # optional, verifies installation
"""

import asyncio
import csv
import sys
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig


def load_urls_from_csv(csv_path):
    """Load URLs from a CSV file. Looks for a column named 'url'."""
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Find the URL column (case-insensitive)
        url_col = None
        for col in reader.fieldnames:
            if col.strip().lower() == "url":
                url_col = col
                break
        if url_col is None:
            print(f"Error: No 'url' column found in {csv_path}")
            print(f"  Columns found: {reader.fieldnames}")
            sys.exit(1)
        for row in reader:
            url = row[url_col].strip()
            if url:
                rows.append(row)
    return rows, url_col


async def main():
    if len(sys.argv) < 2:
        print("Usage: python crawl_example.py <csv_file>")
        sys.exit(1)

    csv_path = sys.argv[1]
    rows, url_col = load_urls_from_csv(csv_path)
    urls = [row[url_col].strip() for row in rows]

    print(f"Loaded {len(urls)} URLs from {csv_path}")

    browser_config = BrowserConfig(headless=True)
    crawl_config = CrawlerRunConfig()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        results = await crawler.arun_many(
            urls=urls,
            config=crawl_config,
        )

        success_count = 0
        fail_count = 0
        for result in results:
            if result.success:
                success_count += 1
                print(f"[OK]   {result.url}")
            else:
                fail_count += 1
                print(f"[FAIL] {result.url} - {result.error_message}")

        print(f"\nDone: {success_count} succeeded, {fail_count} failed out of {len(urls)} URLs")


if __name__ == "__main__":
    asyncio.run(main())
