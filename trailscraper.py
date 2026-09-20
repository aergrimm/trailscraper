import os
import json
import re
import sys
import io
import logging
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from datetime import datetime

# Dwing console output naar UTF-8 voor Windows/NppExec ondersteuning
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
OUTPUT_PATH = os.path.join(BASE_DIR, "events.json")

MONTH_MAP = {
    "jan": "01", "januari": "01",
    "feb": "02", "februari": "02",
    "mar": "03", "maart": "03", "mrt": "03",
    "apr": "04", "april": "04",
    "mei": "05",
    "jun": "06", "juni": "06",
    "jul": "07", "juli": "07",
    "aug": "08", "augustus": "08",
    "sep": "09", "september": "09", "sept": "09",
    "okt": "10", "oktober": "10",
    "nov": "11", "november": "11",
    "dec": "12", "december": "12"
}

def clean_text(text):
    """Verwijdert vreemde stuurkarakters/emoji-ruis en ruimt spaties op."""
    if not text:
        return ""
    cleaned = re.sub(r'[^\w\s\-\.,\(\)]', '', text)
    return cleaned.strip()

def normalize_date(raw_date_str, month_str=None, year_str=None, link_url=None):
    """Zet elke datumindeling (ISO, DD-MM-YYYY, tekst, URL) om naar YYYY-MM-DD."""
    current_year = str(datetime.now().year)

    # 1. Probeer datum uit URL (bijv. '/2026-09-20')
    if link_url:
        url_match = re.search(r'(\d{4})-(\d{2})-(\d{2})', link_url)
        if url_match:
            return f"{url_match.group(1)}-{url_match.group(2)}-{url_match.group(3)}"

    if month_str:
        combined_text = f"{raw_date_str} {month_str} {year_str or ''}".strip()
    else:
        combined_text = str(raw_date_str).strip()

    if not combined_text:
        return "Onbekend"

    # 2. Check op cijfers: DD-MM-YYYY, DD/MM/YYYY of DD.MM.YYYY
    digits_match = re.search(r'(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{2,4})', combined_text)
    if digits_match:
        day = digits_match.group(1).zfill(2)
        month = digits_match.group(2).zfill(2)
        year = digits_match.group(3)
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{month}-{day}"

    # 3. Check op tekstuele datum: '20 september 2026'
    day_match = re.search(r'\d+', combined_text)
    if not day_match:
        return "Onbekend"
    
    day = day_match.group(0).zfill(2)

    m_clean = re.sub(r'[^a-zA-Z]', '', combined_text).lower()
    month = "01"
    for k, v in MONTH_MAP.items():
        if k in m_clean:
            month = v
            break

    year_match = re.search(r'20\d{2}', combined_text)
    year = year_match.group(0) if year_match else (year_str or current_year)

    return f"{year}-{month}-{day}"

def normalize_distance(dist_str):
    """Vertaalt afstanden en splits bereiken zoals '10-20km' op naar ['10km', '20km']."""
    if not dist_str:
        return []

    d_lower = dist_str.lower().strip()
    results = []
    
    if "halve marathon" in d_lower or "half marathon" in d_lower:
        results.append("21km")
    elif "marathon" in d_lower:
        results.append("42km")

    # Bereik check (bijv. 10-20km of 10 tot 20 km)
    range_match = re.search(r'(\d+)\s*(?:-|t/m|tot)\s*(\d+)\s*km?', d_lower)
    if range_match:
        results.append(f"{range_match.group(1)}km")
        results.append(f"{range_match.group(2)}km")
        return results

    # Alle losse getallen
    numbers = re.findall(r'\d+', d_lower)
    for num in numbers:
        results.append(f"{num}km")

    return list(dict.fromkeys(results))

def infer_province(location_str):
    """Leidt de Nederlandse provincie af op basis van de locatienaam."""
    if not location_str or location_str == "Onbekend":
        return "Buitenland"
    
    provinces = [
        "Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen",
        "Limburg", "Noord-Brabant", "Noord-Holland", "Overijssel",
        "Utrecht", "Zeeland", "Zuid-Holland"
    ]
    loc_lower = location_str.lower()
    for prov in provinces:
        if prov.lower() in loc_lower:
            return prov
    return "Buitenland"

def parse_events_from_page(soup, selectors, current_url):
    events = []
    card_selector = selectors.get("event_card")
    
    if not card_selector:
        logging.error("❌ 'event_card' selector is leeg!")
        return events

    card_elements = soup.select(card_selector)
    
    for card in card_elements:
        def get_elem(key):
            sel = selectors.get(key)
            return card.select_one(sel) if sel else None

        title_el = get_elem("title")
        month_el = get_elem("date_month")
        day_el = get_elem("date_day")
        loc_el = get_elem("location")
        date_single_el = get_elem("date_single")

        # 1. LINK OPHALEN
        link_selector = selectors.get("link")
        link_el = card.select_one(link_selector) if link_selector else card.select_one('a')
        
        if not link_el and card.name == 'a':
            link_el = card

        raw_href = link_el['href'] if (link_el and link_el.has_attr('href')) else ""
        event_link = urljoin(current_url, raw_href) if raw_href else "Onbekend"

        # 2. AFSTANDEN OPHALEN
        dist_selector = selectors.get("distances")
        dist_els = card.select(dist_selector) if dist_selector else []
        distances = []
        for d in dist_els:
            raw_text = d.get_text(strip=True)
            distances.extend(normalize_distance(raw_text))
        distances = list(dict.fromkeys(distances))

        # 3. DATUM BEPALEN
        if date_single_el:
            raw_date = date_single_el.get_text(strip=True)
            iso_date = normalize_date(raw_date, link_url=event_link)
        else:
            day_text = day_el.get_text(strip=True) if day_el else ""
            month_text = month_el.get_text(strip=True) if month_el else ""
            iso_date = normalize_date(day_text, month_str=month_text, link_url=event_link)

        # 4. TEKSTEN SCHOONMAKEN EN VERZAMELEN
        raw_loc = loc_el.get_text(strip=True) if loc_el else "Onbekend"
        clean_loc = clean_text(raw_loc)
        province = infer_province(clean_loc)

        title = title_el.get_text(strip=True) if title_el else "Onbekend"

        if title and title != "Onbekend":
            event_data = {
                "title": title,
                "date": iso_date,
                "location": clean_loc if clean_loc else "Onbekend",
                "province": province,
                "distances": distances,
                "link": event_link
            }
            events.append(event_data)
        
    return events

def find_next_page_url(soup, current_url, selectors):
    next_selector = selectors.get("next_page")
    if not next_selector:
        return None

    next_btn = soup.select_one(next_selector)
    if next_btn and next_btn.get('href'):
        return urljoin(current_url, next_btn['href'])
    return None

def scrape_site(site_config):
    site_name = site_config.get("name", "Onbekende site")
    url = site_config.get("url")
    enabled = site_config.get("enabled", True)
    custom_headers = site_config.get("headers", {})

    if not enabled:
        logging.info(f"⏭️ Overgeslagen (disabled): {site_name}")
        return []

    headers = {
        "User-Agent": "TrailScraperBot/1.0 (+https://aergrimm.github.io/trailscraper/)"
    }
    if custom_headers and isinstance(custom_headers, dict):
        headers.update(custom_headers)

    logging.info(f"🔍 Scraping starten voor: {site_name} ({url})")
    
    current_url = url
    selectors = site_config.get("selectors", {})
    all_site_events = []
    pages_processed = 0
    max_pages = 20  # Veiligheidslimiet voor paginering

    while current_url and pages_processed < max_pages:
        pages_processed += 1
        logging.info(f"--- [ PAGINA {pages_processed} ] Ophalen: {current_url} ---")
        
        try:
            response = requests.get(current_url, headers=headers, timeout=15)
            response.raise_for_status()
        except Exception as e:
            logging.error(f"Fout bij ophalen pagina {current_url}: {e}")
            break

        soup = BeautifulSoup(response.text, 'html.parser')
        events = parse_events_from_page(soup, selectors, current_url)
        all_site_events.extend(events)
        
        logging.info(f"{len(events)} events gevonden op pagina {pages_processed}.")

        # Volgende pagina zoeken
        next_url = find_next_page_url(soup, current_url, selectors)
        if next_url and next_url != current_url:
            current_url = next_url
        else:
            current_url = None

    return all_site_events

def main():
    if not os.path.exists(CONFIG_PATH):
        logging.error(f"❌ Configuratiebestand niet gevonden op pad: '{CONFIG_PATH}'")
        return

    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)

    scrapers = config.get("scrapers", [])
    logging.info(f"⚙️ Configuratie succesvol geladen uit 'config.json'. ({len(scrapers)} scrapers gevonden)")

    all_events = []
    for site_config in scrapers:
        events = scrape_site(site_config)
        all_events.extend(events)

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(all_events, f, ensure_ascii=False, indent=2)

    logging.info(f"✅ Totaal {len(all_events)} evenementen opgeslagen in '{OUTPUT_PATH}'.")

if __name__ == "__main__":
    main()