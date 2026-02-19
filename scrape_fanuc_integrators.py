#!/usr/bin/env python3
"""
Scrape FANUC Authorized System Integrators from fanucamerica.com/integrators/robotics

Strategy:
  Phase 1 - API Discovery: Use Playwright to load the page, intercept XHR/fetch
            requests, and discover the backend API endpoint used by the search form.
  Phase 2a - Direct API: If an API is found, call it directly to pull all integrators.
  Phase 2b - DOM Scraping Fallback: If no API is found, use Playwright to interact
             with the search form (selecting each region/state) and scrape rendered results.

Output: fanuc_integrators.csv
"""

import asyncio
import csv
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field, fields, asdict
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

try:
    from playwright.async_api import async_playwright, Page, Route, Request
except ImportError:
    print("ERROR: playwright is required. Install with:")
    print("  pip install playwright && playwright install chromium")
    sys.exit(1)

try:
    import httpx
except ImportError:
    httpx = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

BASE_URL = "https://www.fanucamerica.com/integrators/robotics"
OUTPUT_CSV = Path("fanuc_integrators.csv")

# US states + DC + territories, plus Canada/Mexico for completeness
US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
]

REGIONS = ["United States", "Canada", "Mexico"]


@dataclass
class Integrator:
    company_name: str = ""
    city: str = ""
    state: str = ""
    full_address: str = ""
    phone: str = ""
    website: str = ""
    industries: str = ""
    applications: str = ""
    certification_level: str = ""
    region: str = ""


class APIDiscovery:
    """Intercept network requests to find the integrator search API."""

    def __init__(self):
        self.api_calls: list[dict] = []
        self.api_endpoint: str | None = None
        self.api_method: str | None = None
        self.api_headers: dict = {}
        self.api_payload_sample: dict | None = None

    def on_response(self, response):
        """Capture API responses that look like integrator search results."""
        url = response.url
        content_type = response.headers.get("content-type", "")

        # Look for JSON API responses that might contain integrator data
        if "json" in content_type or "api" in url.lower():
            self.api_calls.append({
                "url": url,
                "method": response.request.method,
                "status": response.status,
                "content_type": content_type,
            })
            log.info(f"Captured API call: {response.request.method} {url} -> {response.status}")

    def on_request(self, request):
        """Capture outgoing requests for API pattern detection."""
        url = request.url
        resource_type = request.resource_type

        # Focus on XHR/fetch requests
        if resource_type in ("xhr", "fetch"):
            entry = {
                "url": url,
                "method": request.method,
                "resource_type": resource_type,
                "headers": dict(request.headers),
            }
            if request.post_data:
                entry["post_data"] = request.post_data
            self.api_calls.append(entry)
            log.info(f"Captured XHR/fetch: {request.method} {url}")


class FANUCScraper:
    def __init__(self):
        self.integrators: list[Integrator] = []
        self.seen: set[str] = set()  # deduplicate by company_name+state
        self.api_discovery = APIDiscovery()

    def _dedup_key(self, integrator: Integrator) -> str:
        return f"{integrator.company_name}|{integrator.city}|{integrator.state}".lower().strip()

    def add_integrator(self, integrator: Integrator):
        key = self._dedup_key(integrator)
        if key and key not in self.seen:
            self.seen.add(key)
            self.integrators.append(integrator)

    async def run(self):
        log.info("Starting FANUC integrator scraper")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1920, "height": 1080},
            )
            page = await context.new_page()

            # Phase 1: Discover API
            api_endpoint = await self._discover_api(page)

            if api_endpoint:
                log.info(f"API endpoint discovered: {api_endpoint}")
                await self._scrape_via_api(page, context, api_endpoint)
            else:
                log.info("No API endpoint discovered, falling back to DOM scraping")
                await self._scrape_via_dom(page)

            await browser.close()

        self._save_csv()
        log.info(f"Done! Scraped {len(self.integrators)} integrators -> {OUTPUT_CSV}")

    async def _discover_api(self, page: Page) -> str | None:
        """Load the page and intercept network requests to find the API."""
        log.info(f"Phase 1: Loading {BASE_URL} to discover API...")

        # Listen for all requests/responses
        page.on("request", self.api_discovery.on_request)
        page.on("response", self.api_discovery.on_response)

        try:
            await page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        except Exception as e:
            log.warning(f"Page load timeout/error (may still have useful data): {e}")
            # Continue anyway - partial load may have revealed API calls

        # Wait a bit for any lazy-loaded scripts
        await page.wait_for_timeout(3000)

        # Try to trigger the search by interacting with filters
        await self._trigger_search(page)

        # Analyze captured calls
        return self._analyze_api_calls()

    async def _trigger_search(self, page: Page):
        """Try to interact with the search form to trigger API calls."""
        log.info("Attempting to trigger search form...")

        # Common selector patterns for search forms / dropdowns
        selectors_to_try = [
            # Region/country dropdowns
            'select[name*="region" i]',
            'select[name*="country" i]',
            'select[id*="region" i]',
            'select[id*="country" i]',
            '[data-filter*="region" i]',
            # State dropdowns
            'select[name*="state" i]',
            'select[id*="state" i]',
            # Search/submit buttons
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Search")',
            'button:has-text("Find")',
            'a:has-text("Search")',
            # Generic dropdown triggers (Vue/React components)
            '.dropdown-toggle',
            '[class*="filter"]',
            '[class*="search-btn"]',
            '[class*="submit"]',
        ]

        for selector in selectors_to_try:
            try:
                element = await page.query_selector(selector)
                if element:
                    tag = await element.evaluate("el => el.tagName.toLowerCase()")
                    log.info(f"Found interactive element: {selector} ({tag})")

                    if tag == "select":
                        # Try to select the first non-empty option
                        options = await element.evaluate("""el => {
                            return Array.from(el.options).map(o => ({value: o.value, text: o.text}));
                        }""")
                        log.info(f"  Options: {options[:5]}...")
                        for opt in options:
                            if opt["value"] and opt["value"] != "0" and opt["text"].strip():
                                await element.select_option(value=opt["value"])
                                log.info(f"  Selected: {opt['text']}")
                                await page.wait_for_timeout(2000)
                                break
                    elif tag in ("button", "input", "a"):
                        await element.click()
                        await page.wait_for_timeout(2000)
            except Exception as e:
                log.debug(f"Selector {selector} failed: {e}")

        # Also try clicking any visible "Search" or region-related text
        try:
            # Look for any text that says "United States" and click it
            us_elem = await page.query_selector('text="United States"')
            if us_elem:
                await us_elem.click()
                await page.wait_for_timeout(2000)
                log.info("Clicked 'United States' text element")
        except Exception:
            pass

        # Give time for any triggered requests to complete
        await page.wait_for_timeout(3000)

    def _analyze_api_calls(self) -> str | None:
        """Analyze captured network calls to identify the integrator API."""
        log.info(f"Analyzing {len(self.api_discovery.api_calls)} captured API calls...")

        # Keywords that suggest integrator-related API calls
        integrator_keywords = [
            "integrat", "search", "find", "filter", "results",
            "company", "asi", "partner", "dealer", "locator",
        ]

        candidates = []
        for call in self.api_discovery.api_calls:
            url_lower = call["url"].lower()
            # Skip static assets, analytics, tracking
            if any(skip in url_lower for skip in [
                "google", "analytics", "gtm", "facebook", "pixel",
                "cloudflare", "cdn", "fonts", "css", ".js",
                "tracking", "beacon", "doubleclick", "bing",
            ]):
                continue

            score = 0
            for kw in integrator_keywords:
                if kw in url_lower:
                    score += 2
            if call.get("resource_type") in ("xhr", "fetch"):
                score += 1
            if call.get("method") == "POST":
                score += 1
            if "json" in call.get("content_type", ""):
                score += 2

            if score > 0:
                candidates.append((score, call))
                log.info(f"  Candidate (score={score}): {call.get('method', '?')} {call['url']}")

        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            best = candidates[0][1]
            log.info(f"Best API candidate: {best['url']}")
            self.api_discovery.api_endpoint = best["url"]
            self.api_discovery.api_method = best.get("method", "GET")
            self.api_discovery.api_headers = best.get("headers", {})
            if "post_data" in best:
                self.api_discovery.api_payload_sample = best["post_data"]
            return best["url"]

        log.info("No API endpoint candidates found")
        return None

    async def _scrape_via_api(self, page: Page, context, api_endpoint: str):
        """Use the discovered API endpoint to fetch all integrators."""
        log.info(f"Phase 2a: Scraping via API at {api_endpoint}")

        # Try to fetch the API response through the browser context
        # to maintain cookies/session
        try:
            # First, get a sample response to understand the data shape
            response = await page.evaluate(f"""
                async () => {{
                    const resp = await fetch("{api_endpoint}");
                    const text = await resp.text();
                    return text;
                }}
            """)
            log.info(f"Sample API response (first 500 chars): {str(response)[:500]}")

            # Try to parse as JSON
            try:
                data = json.loads(response)
                self._parse_api_response(data)
            except json.JSONDecodeError:
                log.warning("API response is not JSON, falling back to DOM scraping")
                await self._scrape_via_dom(page)
                return

        except Exception as e:
            log.warning(f"Direct API call failed: {e}")

            # If we captured POST data, try to replay the request with variations
            if self.api_discovery.api_payload_sample:
                await self._replay_api_with_variations(page)
            else:
                # Fall back to DOM scraping
                await self._scrape_via_dom(page)

    async def _replay_api_with_variations(self, page: Page):
        """Try calling the API with different state/region parameters."""
        endpoint = self.api_discovery.api_endpoint
        sample_payload = self.api_discovery.api_payload_sample
        log.info(f"Attempting to replay API with variations. Endpoint: {endpoint}")
        log.info(f"Sample payload: {sample_payload}")

        # This is speculative - we'll try common parameter variations
        # The actual implementation depends on what we discover
        try:
            payload_dict = json.loads(sample_payload) if isinstance(sample_payload, str) else sample_payload
        except (json.JSONDecodeError, TypeError):
            payload_dict = {}

        # Try fetching with the original payload first
        try:
            response_text = await page.evaluate(f"""
                async () => {{
                    const resp = await fetch("{endpoint}", {{
                        method: "POST",
                        headers: {{"Content-Type": "application/json"}},
                        body: JSON.stringify({json.dumps(payload_dict)})
                    }});
                    return await resp.text();
                }}
            """)
            data = json.loads(response_text)
            self._parse_api_response(data)
        except Exception as e:
            log.warning(f"API replay failed: {e}, falling back to DOM scraping")
            await self._scrape_via_dom(page)

    def _parse_api_response(self, data, region: str = ""):
        """Parse JSON API response into Integrator objects."""
        items = []

        # Handle common response shapes
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            # Look for common container keys
            for key in ["results", "data", "items", "integrators", "records",
                        "Results", "Data", "Items", "Integrators", "Records",
                        "searchResults", "SearchResults", "companies", "Companies"]:
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
            if not items:
                # Maybe it's nested one level deeper
                for v in data.values():
                    if isinstance(v, dict):
                        for key in ["results", "data", "items", "integrators"]:
                            if key in v and isinstance(v[key], list):
                                items = v[key]
                                break
                    if items:
                        break

        log.info(f"Found {len(items)} items in API response")

        for item in items:
            if not isinstance(item, dict):
                continue
            integrator = Integrator(region=region)

            # Map common field names to our schema
            name_fields = ["name", "companyName", "company_name", "CompanyName",
                           "Name", "company", "Company", "title", "Title",
                           "organizationName", "OrganizationName"]
            for f in name_fields:
                if f in item and item[f]:
                    integrator.company_name = str(item[f]).strip()
                    break

            city_fields = ["city", "City", "cityName", "CityName"]
            for f in city_fields:
                if f in item and item[f]:
                    integrator.city = str(item[f]).strip()
                    break

            state_fields = ["state", "State", "stateName", "StateName",
                            "stateProvince", "StateProvince", "province", "Province"]
            for f in state_fields:
                if f in item and item[f]:
                    integrator.state = str(item[f]).strip()
                    break

            addr_fields = ["address", "Address", "fullAddress", "FullAddress",
                           "streetAddress", "StreetAddress", "address1", "Address1"]
            for f in addr_fields:
                if f in item and item[f]:
                    integrator.full_address = str(item[f]).strip()
                    break

            # Build full address if we have components
            if not integrator.full_address:
                parts = []
                for f in ["address1", "Address1", "street", "Street",
                          "streetAddress", "StreetAddress"]:
                    if f in item and item[f]:
                        parts.append(str(item[f]).strip())
                        break
                if integrator.city:
                    parts.append(integrator.city)
                if integrator.state:
                    parts.append(integrator.state)
                for f in ["zip", "Zip", "zipCode", "ZipCode", "postalCode", "PostalCode"]:
                    if f in item and item[f]:
                        parts.append(str(item[f]).strip())
                        break
                if parts:
                    integrator.full_address = ", ".join(parts)

            phone_fields = ["phone", "Phone", "phoneNumber", "PhoneNumber",
                            "telephone", "Telephone", "tel", "Tel"]
            for f in phone_fields:
                if f in item and item[f]:
                    integrator.phone = str(item[f]).strip()
                    break

            url_fields = ["website", "Website", "url", "Url", "URL",
                          "websiteUrl", "WebsiteUrl", "webAddress", "WebAddress",
                          "companyUrl", "CompanyUrl", "siteUrl", "SiteUrl"]
            for f in url_fields:
                if f in item and item[f]:
                    integrator.website = str(item[f]).strip()
                    break

            industry_fields = ["industries", "Industries", "industry", "Industry",
                               "industryList", "IndustryList"]
            for f in industry_fields:
                if f in item and item[f]:
                    val = item[f]
                    if isinstance(val, list):
                        integrator.industries = "; ".join(str(v) for v in val)
                    else:
                        integrator.industries = str(val).strip()
                    break

            app_fields = ["applications", "Applications", "application", "Application",
                          "applicationList", "ApplicationList", "specializations",
                          "Specializations"]
            for f in app_fields:
                if f in item and item[f]:
                    val = item[f]
                    if isinstance(val, list):
                        integrator.applications = "; ".join(str(v) for v in val)
                    else:
                        integrator.applications = str(val).strip()
                    break

            cert_fields = ["certification", "Certification", "certificationLevel",
                           "CertificationLevel", "level", "Level", "type", "Type",
                           "asiLevel", "ASILevel", "integratorType", "IntegratorType"]
            for f in cert_fields:
                if f in item and item[f]:
                    integrator.certification_level = str(item[f]).strip()
                    break

            if integrator.company_name:
                self.add_integrator(integrator)

    async def _scrape_via_dom(self, page: Page):
        """Fall back to scraping the rendered DOM by interacting with the search form."""
        log.info("Phase 2b: DOM-based scraping with Playwright")

        # Navigate fresh
        try:
            await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log.warning(f"Navigation warning: {e}")

        # Wait for dynamic content to load
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

        await page.wait_for_timeout(3000)

        # Check if page loaded meaningful content
        page_content_length = await page.evaluate("() => document.body?.innerHTML?.length || 0")
        if page_content_length < 500:
            log.error(
                "Page did not load meaningful content. This likely means the site "
                "is blocked by a proxy or firewall. Try running the script from a "
                "machine with direct internet access."
            )
            return

        # Take a screenshot for debugging
        try:
            await page.screenshot(path="debug_page_load.png", timeout=10000)
            log.info("Saved debug screenshot: debug_page_load.png")
        except Exception as e:
            log.warning(f"Screenshot failed (page may not have loaded): {e}")

        # Dump the page HTML structure for analysis
        page_content = await page.content()
        # Save for debugging
        Path("debug_page_source.html").write_text(page_content)
        log.info(f"Saved page source ({len(page_content)} chars): debug_page_source.html")

        # Analyze the page structure
        form_info = await page.evaluate("""() => {
            const info = {
                selects: [],
                buttons: [],
                forms: [],
                inputs: [],
                links_with_search: [],
                divs_with_data: [],
                scripts_inline: [],
            };

            // Find all selects
            document.querySelectorAll('select').forEach(s => {
                const options = Array.from(s.options).map(o => ({value: o.value, text: o.text}));
                info.selects.push({
                    id: s.id, name: s.name, className: s.className,
                    options: options.slice(0, 20)
                });
            });

            // Find all buttons
            document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(b => {
                info.buttons.push({
                    tag: b.tagName, type: b.type, text: b.textContent?.trim().substring(0, 50),
                    id: b.id, name: b.name, className: b.className
                });
            });

            // Find forms
            document.querySelectorAll('form').forEach(f => {
                info.forms.push({
                    action: f.action, method: f.method, id: f.id, className: f.className
                });
            });

            // Find inputs
            document.querySelectorAll('input').forEach(i => {
                info.inputs.push({
                    type: i.type, name: i.name, id: i.id, value: i.value?.substring(0, 50),
                    placeholder: i.placeholder
                });
            });

            // Look for search-related links
            document.querySelectorAll('a').forEach(a => {
                if (a.href && (a.href.includes('search') || a.href.includes('integrat') ||
                    a.href.includes('filter') || a.href.includes('find'))) {
                    info.links_with_search.push({href: a.href, text: a.textContent?.trim().substring(0, 50)});
                }
            });

            // Look for data attributes
            document.querySelectorAll('[data-url], [data-api], [data-endpoint], [data-src]').forEach(el => {
                info.divs_with_data.push({
                    tag: el.tagName, dataUrl: el.dataset.url, dataApi: el.dataset.api,
                    dataEndpoint: el.dataset.endpoint, dataSrc: el.dataset.src,
                    id: el.id, className: el.className
                });
            });

            // Collect inline script snippets that reference APIs
            document.querySelectorAll('script:not([src])').forEach(s => {
                const text = s.textContent || '';
                if (text.includes('api') || text.includes('fetch') || text.includes('ajax') ||
                    text.includes('integrat') || text.includes('xhr') ||
                    text.includes('endpoint') || text.includes('search')) {
                    info.scripts_inline.push(text.substring(0, 500));
                }
            });

            return info;
        }""")

        log.info("Page structure analysis:")
        log.info(f"  Selects: {json.dumps(form_info.get('selects', []), indent=2)[:2000]}")
        log.info(f"  Buttons: {json.dumps(form_info.get('buttons', []), indent=2)[:1000]}")
        log.info(f"  Forms: {json.dumps(form_info.get('forms', []), indent=2)[:1000]}")
        log.info(f"  Inputs: {json.dumps(form_info.get('inputs', []), indent=2)[:1000]}")
        log.info(f"  Data attrs: {json.dumps(form_info.get('divs_with_data', []), indent=2)[:1000]}")
        log.info(f"  Inline scripts: {len(form_info.get('scripts_inline', []))} found")
        for i, script in enumerate(form_info.get("scripts_inline", [])[:5]):
            log.info(f"  Script {i}: {script[:300]}")

        # Also look for Vue/React app data or config objects
        app_data = await page.evaluate("""() => {
            const data = {};
            // Vue.js
            if (window.__NUXT__) data.nuxt = JSON.stringify(window.__NUXT__).substring(0, 500);
            if (window.__NEXT_DATA__) data.next = JSON.stringify(window.__NEXT_DATA__).substring(0, 500);
            // Generic app config
            if (window.appConfig) data.appConfig = JSON.stringify(window.appConfig).substring(0, 500);
            if (window.APP_CONFIG) data.APP_CONFIG = JSON.stringify(window.APP_CONFIG).substring(0, 500);
            // Look for any global variables with API URLs
            for (const key of Object.keys(window)) {
                try {
                    const val = window[key];
                    if (typeof val === 'string' && val.includes('/api/')) {
                        data['window.' + key] = val.substring(0, 200);
                    }
                } catch(e) {}
            }
            return data;
        }""")
        if app_data:
            log.info(f"App data found: {json.dumps(app_data, indent=2)[:1000]}")

        # Now try to interact with any discovered selects/forms
        await self._interact_with_form(page, form_info)

    async def _interact_with_form(self, page: Page, form_info: dict):
        """Interact with discovered form elements to load integrator results."""
        selects = form_info.get("selects", [])

        # Find region/state selects
        region_select = None
        state_select = None
        industry_select = None
        application_select = None

        for sel in selects:
            sel_id = (sel.get("id") or "").lower()
            sel_name = (sel.get("name") or "").lower()
            sel_class = (sel.get("className") or "").lower()
            combined = f"{sel_id} {sel_name} {sel_class}"

            if any(kw in combined for kw in ["region", "country", "location"]):
                region_select = sel
            elif any(kw in combined for kw in ["state", "province"]):
                state_select = sel
            elif any(kw in combined for kw in ["industry", "sector"]):
                industry_select = sel
            elif any(kw in combined for kw in ["application", "app"]):
                application_select = sel

        # If no labeled selects found, try to identify by option content
        if not region_select and not state_select:
            for sel in selects:
                options_text = " ".join(o.get("text", "") for o in sel.get("options", []))
                if "United States" in options_text or "Canada" in options_text:
                    region_select = sel
                    log.info(f"Identified region select by content: {sel.get('id') or sel.get('name')}")
                elif any(s in options_text for s in US_STATES[:5]):
                    state_select = sel
                    log.info(f"Identified state select by content: {sel.get('id') or sel.get('name')}")

        # Strategy: Select each region, then iterate states
        if region_select:
            await self._scrape_by_region(page, region_select, state_select)
        elif state_select:
            await self._scrape_by_state(page, state_select)
        else:
            log.info("No region/state selects found. Trying to scrape visible results...")
            # Maybe results are already visible or loaded differently
            await self._scrape_visible_results(page)

            # Also check if there's a different interaction model (clicks, tabs, etc.)
            await self._try_alternative_interactions(page)

    async def _scrape_by_region(self, page: Page, region_select: dict, state_select: dict | None):
        """Select each region and scrape results."""
        selector = f"#{region_select['id']}" if region_select.get("id") else f"select[name='{region_select.get('name')}']"

        for opt in region_select.get("options", []):
            region_name = opt.get("text", "").strip()
            region_value = opt.get("value", "")

            if not region_value or region_value == "0" or not region_name:
                continue

            if region_name not in REGIONS and not any(r in region_name for r in REGIONS):
                continue

            log.info(f"Selecting region: {region_name}")
            try:
                await page.select_option(selector, value=region_value)
                await page.wait_for_timeout(2000)

                # Wait for potential state dropdown to populate
                try:
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass

                if state_select:
                    # Re-read state options (they may have changed)
                    state_selector = f"#{state_select['id']}" if state_select.get("id") else f"select[name='{state_select.get('name')}']"
                    state_options = await page.evaluate(f"""() => {{
                        const sel = document.querySelector('{state_selector}');
                        if (!sel) return [];
                        return Array.from(sel.options).map(o => ({{value: o.value, text: o.text}}));
                    }}""")

                    for state_opt in state_options:
                        state_name = state_opt.get("text", "").strip()
                        state_value = state_opt.get("value", "")
                        if not state_value or state_value == "0" or not state_name:
                            continue

                        log.info(f"  Selecting state: {state_name}")
                        await page.select_option(state_selector, value=state_value)
                        await page.wait_for_timeout(2000)

                        # Click search if there's a button
                        await self._click_search_button(page)
                        await page.wait_for_timeout(2000)

                        try:
                            await page.wait_for_load_state("networkidle", timeout=10000)
                        except Exception:
                            pass

                        await self._scrape_visible_results(page, region=region_name)
                else:
                    # No state select - scrape what's visible after region selection
                    await self._click_search_button(page)
                    await page.wait_for_timeout(3000)
                    await self._scrape_visible_results(page, region=region_name)

            except Exception as e:
                log.error(f"Error scraping region {region_name}: {e}")

    async def _scrape_by_state(self, page: Page, state_select: dict):
        """Iterate through each state and scrape results."""
        selector = f"#{state_select['id']}" if state_select.get("id") else f"select[name='{state_select.get('name')}']"

        for opt in state_select.get("options", []):
            state_name = opt.get("text", "").strip()
            state_value = opt.get("value", "")
            if not state_value or state_value == "0" or not state_name:
                continue

            log.info(f"Selecting state: {state_name}")
            try:
                await page.select_option(selector, value=state_value)
                await page.wait_for_timeout(1500)
                await self._click_search_button(page)
                await page.wait_for_timeout(2000)

                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass

                await self._scrape_visible_results(page)
            except Exception as e:
                log.error(f"Error scraping state {state_name}: {e}")

    async def _click_search_button(self, page: Page):
        """Try to click a search/submit button."""
        button_selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Search")',
            'button:has-text("Find")',
            'button:has-text("Go")',
            'a:has-text("Search")',
            '.search-btn',
            '.btn-search',
            '[class*="search"] button',
            '[class*="filter"] button',
        ]
        for sel in button_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    log.info(f"Clicked search button: {sel}")
                    return
            except Exception:
                pass

    async def _scrape_visible_results(self, page: Page, region: str = ""):
        """Extract integrator data from the currently visible page."""
        # Try multiple strategies to find integrator listings

        results = await page.evaluate("""() => {
            const integrators = [];

            // Strategy 1: Look for common card/listing patterns
            const cardSelectors = [
                '.integrator-card', '.integrator-item', '.integrator-listing',
                '.result-card', '.result-item', '.search-result',
                '.card', '.listing-item', '.company-card',
                '[class*="integrator"]', '[class*="result-card"]',
                '[class*="partner"]', '[class*="company-item"]',
                '[data-integrator]', '[data-company]',
            ];

            for (const selector of cardSelectors) {
                const cards = document.querySelectorAll(selector);
                if (cards.length > 0) {
                    cards.forEach(card => {
                        const getText = (selectors) => {
                            for (const s of selectors) {
                                const el = card.querySelector(s);
                                if (el) return el.textContent?.trim() || '';
                            }
                            return '';
                        };
                        const getHref = (selectors) => {
                            for (const s of selectors) {
                                const el = card.querySelector(s);
                                if (el) return el.href || el.getAttribute('href') || '';
                            }
                            return '';
                        };

                        integrators.push({
                            company_name: getText(['h2', 'h3', 'h4', '.company-name', '.name',
                                                    '[class*="name"]', '[class*="title"]', 'a > strong',
                                                    '.card-title', 'a:first-child']),
                            full_text: card.textContent?.trim().substring(0, 1000) || '',
                            html: card.innerHTML?.substring(0, 2000) || '',
                            website: getHref(['a[href*="http"]', 'a.website', 'a[class*="web"]',
                                              'a[class*="site"]', 'a[target="_blank"]']),
                            selector_used: selector,
                        });
                    });
                    break;  // Use first matching selector
                }
            }

            // Strategy 2: If no cards found, look for table rows
            if (integrators.length === 0) {
                const tables = document.querySelectorAll('table');
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            integrators.push({
                                company_name: cells[0]?.textContent?.trim() || '',
                                full_text: row.textContent?.trim().substring(0, 1000) || '',
                                html: row.innerHTML?.substring(0, 2000) || '',
                                website: '',
                                selector_used: 'table tr',
                            });
                        }
                    });
                });
            }

            // Strategy 3: Look for repeated div/li patterns with company-like content
            if (integrators.length === 0) {
                const containers = document.querySelectorAll(
                    '.results, .search-results, .integrator-results, ' +
                    '#results, #searchResults, [class*="results"], [class*="list"]'
                );
                containers.forEach(container => {
                    const children = container.querySelectorAll(':scope > div, :scope > li, :scope > article');
                    if (children.length >= 2) {
                        children.forEach(child => {
                            integrators.push({
                                company_name: (child.querySelector('h2, h3, h4, strong, b, a') ||
                                               {}).textContent?.trim() || '',
                                full_text: child.textContent?.trim().substring(0, 1000) || '',
                                html: child.innerHTML?.substring(0, 2000) || '',
                                website: '',
                                selector_used: 'container children',
                            });
                        });
                    }
                });
            }

            return integrators;
        }""")

        log.info(f"Found {len(results)} result elements on page")

        for raw in results:
            integrator = self._parse_dom_result(raw, region)
            if integrator and integrator.company_name:
                self.add_integrator(integrator)

    def _parse_dom_result(self, raw: dict, region: str = "") -> Integrator | None:
        """Parse a DOM-extracted result into an Integrator."""
        name = raw.get("company_name", "").strip()
        if not name or len(name) < 2:
            return None

        integrator = Integrator(company_name=name, region=region)

        full_text = raw.get("full_text", "")
        html = raw.get("html", "")

        # Extract phone number from text
        phone_match = re.search(
            r'(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
            full_text
        )
        if phone_match:
            integrator.phone = phone_match.group().strip()

        # Extract website URL
        website = raw.get("website", "")
        if not website:
            url_match = re.search(r'href=["\']?(https?://[^"\'>\s]+)', html)
            if url_match:
                website = url_match.group(1)
        if website and "fanucamerica.com" not in website:
            integrator.website = website

        # Extract city/state from text patterns
        # Common pattern: "City, ST" or "City, State"
        state_abbrevs = {
            'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
            'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
            'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
            'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
            'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
            'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
            'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
            'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
            'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina',
            'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon',
            'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
            'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
            'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
            'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
        }

        city_state_match = re.search(
            r'([A-Z][a-zA-Z\s\.]+),\s*([A-Z]{2})\b',
            full_text
        )
        if city_state_match:
            integrator.city = city_state_match.group(1).strip()
            state_abbr = city_state_match.group(2)
            integrator.state = state_abbrevs.get(state_abbr, state_abbr)

        # Look for full state names
        if not integrator.state:
            for state in US_STATES:
                if state in full_text:
                    integrator.state = state
                    break

        # Extract address - look for patterns with street numbers
        addr_match = re.search(
            r'(\d+\s+[A-Za-z0-9\s\.]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Suite|Ste)[^,\n]*(?:,\s*[^,\n]+)?(?:,\s*[A-Z]{2}\s*\d{5})?)',
            full_text,
            re.IGNORECASE
        )
        if addr_match:
            integrator.full_address = addr_match.group().strip()

        # Extract industries/applications from text
        # Look for common industry keywords
        industry_keywords = [
            "Automotive", "Food & Beverage", "Pharmaceutical", "Aerospace",
            "Electronics", "Medical", "Packaging", "Plastics", "Metal",
            "Consumer Goods", "Life Sciences", "General Industry",
            "Warehousing", "Logistics", "Agriculture",
        ]
        found_industries = [kw for kw in industry_keywords if kw.lower() in full_text.lower()]
        if found_industries:
            integrator.industries = "; ".join(found_industries)

        application_keywords = [
            "Welding", "Material Handling", "Assembly", "Painting",
            "Palletizing", "Dispensing", "Machine Tending", "Inspection",
            "Pick and Place", "Packaging", "Deburring", "Grinding",
            "Polishing", "Loading", "Unloading", "Cutting",
        ]
        found_apps = [kw for kw in application_keywords if kw.lower() in full_text.lower()]
        if found_apps:
            integrator.applications = "; ".join(found_apps)

        # Look for certification levels
        cert_patterns = [
            r'(ASI\s*Level\s*\d+)', r'(CSI)', r'(Certified\s+\w+\s+Integrator)',
            r'(Level\s*[1-4]\s*(?:ASI|Integrator))', r'(Authorized\s+System\s+Integrator)',
        ]
        for pattern in cert_patterns:
            cert_match = re.search(pattern, full_text, re.IGNORECASE)
            if cert_match:
                integrator.certification_level = cert_match.group().strip()
                break

        return integrator

    async def _try_alternative_interactions(self, page: Page):
        """Try alternative ways to load integrator data (tabs, accordions, etc.)."""
        log.info("Trying alternative interactions...")

        # Look for tab-like navigation
        tab_selectors = [
            '[role="tab"]', '.tab', '.nav-tab', '.tab-link',
            '[data-toggle="tab"]', '[data-bs-toggle="tab"]',
        ]
        for sel in tab_selectors:
            tabs = await page.query_selector_all(sel)
            if tabs:
                log.info(f"Found {len(tabs)} tabs with selector {sel}")
                for tab in tabs:
                    text = await tab.text_content()
                    log.info(f"  Tab: {text}")

        # Look for "Load More" or pagination
        load_more_selectors = [
            'button:has-text("Load More")',
            'button:has-text("Show More")',
            'a:has-text("Load More")',
            'a:has-text("Next")',
            '.load-more', '.show-more',
            '.pagination a',
        ]
        for sel in load_more_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    log.info(f"Found load-more element: {sel}")
                    # Click repeatedly until no more results
                    while btn and await btn.is_visible():
                        await btn.click()
                        await page.wait_for_timeout(2000)
                        btn = await page.query_selector(sel)
                    await self._scrape_visible_results(page)
                    return
            except Exception:
                pass

        # Try scrolling to trigger lazy loading
        log.info("Trying scroll-based loading...")
        for _ in range(5):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1500)
        await self._scrape_visible_results(page)

    def _save_csv(self):
        """Save all integrators to CSV."""
        if not self.integrators:
            log.warning("No integrators found to save!")
            return

        fieldnames = [f.name for f in fields(Integrator)]
        with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for integrator in sorted(self.integrators, key=lambda i: (i.state, i.company_name)):
                writer.writerow(asdict(integrator))

        log.info(f"Saved {len(self.integrators)} integrators to {OUTPUT_CSV}")
        log.info(f"States covered: {sorted(set(i.state for i in self.integrators if i.state))}")


async def main():
    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Scrape FANUC Authorized System Integrators"
    )
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="Clear HTTP proxy environment variables before running",
    )
    parser.add_argument(
        "--output",
        default="fanuc_integrators.csv",
        help="Output CSV file path (default: fanuc_integrators.csv)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.no_proxy:
        for var in ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]:
            os.environ.pop(var, None)
        log.info("Cleared proxy environment variables")

    global OUTPUT_CSV
    OUTPUT_CSV = Path(args.output)

    scraper = FANUCScraper()
    await scraper.run()


if __name__ == "__main__":
    asyncio.run(main())
