import os
import json
import logging
from bs4 import BeautifulSoup
from urllib.parse import urljoin

# Importeer de gedeelde helpers uit base_scraper
from scrapers.base_scraper import (
    fetch_html,
    clean_text,
    normalize_date,
    normalize_distance,
    infer_province
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

def get_site_config():
    """Haalt de GoTrailNL configuratie op uit config.json."""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
                for site in config.get("scrapers", []):
                    if site.get("name") == "GoTrailNL":
                        return site
        except Exception as e:
            logging.error(f"❌ Kon config.json niet lezen in gotrail.py: {e}")
    return {}

def parse_events_from_page(soup, selectors, current_url):
    """Verwerkt één HTML pagina op basis van de selectors uit config.json."""
    events = []
    card_selector = selectors.get("event_card")
    month_header_selector = selectors.get("month_header")
    
    if not card_selector:
        logging.error("❌ 'event_card' selector ontbreekt in configuratie!")
        return events

    combined_selector = card_selector
    if month_header_selector:
        combined_selector = f"{month_header_selector}, {card_selector}"

    elements = soup.select(combined_selector)
    
    current_context_month = None
    current_context_year = None

    for elem in elements:
        # Check of het element een maand-header is
        is_header = False
        if month_header_selector:
            clean_class = month_header_selector.replace('.', '').strip()
            if clean_class in elem.get('class', []):
                is_header = True

        if is_header:
            header_text = elem.get_text(strip=True)
            parts = header_text.split()
            if len(parts) >= 2:
                current_context_month = parts[0]
                current_context_year = parts[1]
            elif len(parts) == 1:
                current_context_year = parts[0]
            continue

        # Event card verwerken
        card = elem

        def get_elem(key):
            sel = selectors.get(key)
            return card.select_one(sel) if sel else None

        title_el = get_elem("title")
        month_el = get_elem("date_month")
        day_el = get_elem("date_day")
        loc_el = get_elem("location")
        date_single_el = get_elem("date_single")
        
        title = title_el.get_text(strip=True) if title_el else "Onbekend"

        # Link ophalen
        link_selector = selectors.get("link")
        link_el = card.select_one(link_selector) if link_selector else card.select_one('a')
        if not link_el and card.name == 'a':
            link_el = card

        raw_href = link_el['href'] if (link_el and link_el.has_attr('href')) else ""
        event_link = urljoin(current_url, raw_href) if raw_href else "Onbekend"

        # Afstanden ophalen
        dist_selector = selectors.get("distances")
        dist_els = card.select(dist_selector) if dist_selector else []
        distances = []
        for d in dist_els:
            raw_text = d.get_text(strip=True)
            distances.extend(normalize_distance(raw_text))
        distances = list(dict.fromkeys(distances))

        # Datum bepalen
        if date_single_el:
            raw_date = date_single_el.get_text(strip=True)
            iso_date = normalize_date(
                raw_date, 
                month_str=current_context_month, 
                year_str=current_context_year, 
                link_url=event_link
            )
        else:
            day_text = day_el.get_text(strip=True) if day_el else ""
            month_text = month_el.get_text(strip=True) if month_el else current_context_month
            iso_date = normalize_date(
                day_text, 
                month_str=month_text, 
                year_str=current_context_year, 
                link_url=event_link
            )

        # Locatie & Provincie (geen geocoding meer in dit script!)
        raw_loc = loc_el.get_text(strip=True) if loc_el else "Onbekend"
        clean_loc = clean_text(raw_loc)
        province = infer_province(clean_loc)

        if title and title != "Onbekend":
            events.append({
                "title": title,
                "date": iso_date,
                "location": clean_loc if clean_loc else "Onbekend",
                "province": province,
                "distances": distances,
                "link": event_link,
                "source": "gotrail"
            })
        
    return events

def find_next_page_url(soup, current_url, selectors):
    next_selector = selectors.get("next_page")
    if not next_selector:
        return None

    next_btn = soup.select_one(next_selector)
    if next_btn and next_btn.get('href'):
        return urljoin(current_url, next_btn['href'])
    return None

def scrape():
    """Hoofdfunctie die door main.py wordt aangeroepen."""
    site_config = get_site_config()
    
    if not site_config or not site_config.get("enabled", True):
        logging.info("⏭️ GoTrailNL overgeslagen (disabled of niet geconfigureerd).")
        return []

    site_name = site_config.get("name", "GoTrailNL")
    url = site_config.get("url")
    custom_headers = site_config.get("headers", {})
    selectors = site_config.get("selectors", {})

    logging.info(f"🔍 Scraping starten voor: {site_name} ({url})")
    
    current_url = url
    all_site_events = []
    pages_processed = 0
    max_pages = 20

    while current_url and pages_processed < max_pages:
        pages_processed += 1
        logging.info(f"--- [ PAGINA {pages_processed} ] Ophalen: {current_url} ---")
        
        html = fetch_html(current_url, headers=custom_headers)
        if not html:
            break

        soup = BeautifulSoup(html, 'html.parser')
        events = parse_events_from_page(soup, selectors, current_url)
        all_site_events.extend(events)
        
        logging.info(f"✅ {len(events)} events gevonden op pagina {pages_processed}.")

        next_url = find_next_page_url(soup, current_url, selectors)
        if next_url and next_url != current_url:
            current_url = next_url
        else:
            current_url = None

    return all_site_events