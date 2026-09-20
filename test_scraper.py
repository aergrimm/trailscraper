import sys
import io
import re
import logging
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from datetime import datetime

# Dwing console output naar UTF-8 voor Windows/NppExec ondersteuning
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

TEST_URL = "https://gotrail.run/trail-running-kalender/nederland"

HEADERS = {
    "User-Agent": "TrailScraperBot/1.0 (Testing Script; +https://aergrimm.github.io/trailscraper/)"
}

SELECTORS = {
        "event_card": ".event-card-main",
        "title": ".event-card-title",
        "date_month": ".event-calendar div:nth-child(1)",
        "date_day": ".event-calendar div:nth-child(2)",
        "distances": ".event-card-distances, .label-distance",
		"location": ".event-card-location",
        "link": ".event-card-title-link",
		"next_page": "a[aria-label='Volgende']"
}

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

def parse_events_from_page(soup):
    events = []
    card_selector = SELECTORS.get("event_card")
    
    if not card_selector:
        logging.error("❌ 'event_card' selector is leeg!")
        return events

    card_elements = soup.select(card_selector)
    
    for card in card_elements[:2]:
        def get_elem(key):
            sel = SELECTORS.get(key)
            return card.select_one(sel) if sel else None

        title_el = get_elem("title")
        month_el = get_elem("date_month")
        day_el = get_elem("date_day")
        loc_el = get_elem("location")
        date_single_el = get_elem("date_single")

        # 1. LINK OPHALEN
        link_selector = SELECTORS.get("link")
        link_el = card.select_one(link_selector) if link_selector else card.select_one('a')
        
        # Check of card zelf de <a> tag is
        if not link_el and card.name == 'a':
            link_el = card

        raw_href = link_el['href'] if (link_el and link_el.has_attr('href')) else ""
        event_link = urljoin(TEST_URL, raw_href) if raw_href else ""

        # 2. AFSTANDEN OPHALEN
        dist_selector = SELECTORS.get("distances")
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
            
            if day_text or month_text:
                raw_date = f"{day_text} {month_text}".strip()
            else:
                raw_date = "[GEEN TEKST GEVONDEN VIA SELECTOR]"
                
            iso_date = normalize_date(day_text, month_str=month_text, link_url=event_link)

        # 4. TEKSTEN SCHOONMAKEN EN VERZAMELEN
        raw_loc = loc_el.get_text(strip=True) if loc_el else "Onbekend"
        clean_loc = clean_text(raw_loc)
        clean_raw_date = clean_text(raw_date)

        event_data = {
            "title": title_el.get_text(strip=True) if title_el else "Onbekend",
            "raw_date": clean_raw_date,
            "date": iso_date,
            "location": clean_loc if clean_loc else "Onbekend",
            "distances": distances,
            "link": event_link if event_link else "Onbekend"
        }
        events.append(event_data)
        
    return events

def find_next_page_url(soup, current_url):
    next_selector = SELECTORS.get("next_page")
    if not next_selector:
        return None

    next_btn = soup.select_one(next_selector)
    if next_btn and next_btn.get('href'):
        return urljoin(current_url, next_btn['href'])
    return None

def run_test():
    logging.info(f"Starten van test-scraper op: {TEST_URL}")
    
    current_url = TEST_URL
    pages_processed = 0
    total_events_found = 0

    while current_url and pages_processed < 2:
        pages_processed += 1
        logging.info(f"\n--- [ PAGINA {pages_processed} ] Ophalen: {current_url} ---")
        
        try:
            response = requests.get(current_url, headers=HEADERS, timeout=10)
            response.raise_for_status()
        except Exception as e:
            logging.error(f"Fout bij ophalen pagina {current_url}: {e}")
            break

        soup = BeautifulSoup(response.text, 'html.parser')
        events = parse_events_from_page(soup)
        
        logging.info(f"{len(events)} events gevonden op pagina {pages_processed}:")
        
        for idx, ev in enumerate(events, 1):
            total_events_found += 1
            print(f"\n  [Event #{idx}]")
            print(f"  - Titel:       {ev['title']}")
            print(f"  - Datum Ruw:   {ev['raw_date']}")
            print(f"  - Datum ISO:   {ev['date']}")
            print(f"  - Locatie:     {ev['location']}")
            print(f"  - Afstanden:   {', '.join(ev['distances']) if ev['distances'] else 'Geen'}")
            print(f"  - Link:        {ev['link']}")

        if pages_processed == 1:
            next_url = find_next_page_url(soup, current_url)
            if next_url:
                logging.info(f"\n➡️ Volgende pagina knop gevonden: {next_url}")
                current_url = next_url
            else:
                logging.info("\n⏹️ Geen 'volgende pagina' knop gevonden. Test gestopt.")
                current_url = None
        else:
            logging.info("\n⏹️ Maximaal aantal testpagina's (2) bereikt.")
            current_url = None

    logging.info(f"\nTest voltooid. Totaal {total_events_found} events geparst over {pages_processed} pagina('s).")

if __name__ == "__main__":
    run_test()