import json
import re
import time
from datetime import datetime, date
from urllib.parse import urljoin, quote
from difflib import SequenceMatcher
import requests
from bs4 import BeautifulSoup
from feedgen.feed import FeedGenerator
from icalendar import Calendar, Event
from dateutil.parser import parse

DUTCH_MONTHS = {
    "jan": 1, "feb": 2, "mrt": 3, "apr": 4, "mei": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "dec": 12
}

# Cache om dubbele geocoding verzoeken te voorkomen en snel te blijven
GEO_CACHE = {}

def load_config(file_path="config.json"):
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

def clean_text_no_icons(text):
    """Verwijdert emoji's, speciale iconen en overtollige spaties uit een string."""
    if not text:
        return ""
    # Regex voor het verwijderen van Unicode emoji's en symbolen
    clean = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27ff\u2300-\u23ff]', '', text)
    return re.sub(r'\s+', ' ', clean).strip()

def get_location_details(raw_location_str):
    """
    Analyseert en verrijkt een locatie via OpenStreetMap Nominatim.
    Schoont dubbelingen op en levert losse velden (city, province, country).
    """
    clean_input = clean_text_no_icons(raw_location_str)
    if not clean_input or clean_input == "Onbekende locatie":
        return {
            "formatted": "Onbekende locatie",
            "city": "Onbekend",
            "province": "Onbekend",
            "country": "Nederland",
            "lat": None,
            "lon": None
        }
    
    if clean_input in GEO_CACHE:
        return GEO_CACHE[clean_input]

    try:
        headers = {"User-Agent": "TrailCalendarScraper/1.0 (info@example.com)"}
        query_str = f"{clean_input}, Nederland" if "nederland" not in clean_input.lower() else clean_input
        url = f"https://nominatim.openstreetmap.org/search?format=json&q={quote(query_str)}&addressdetails=1&limit=1"
        
        response = requests.get(url, headers=headers, timeout=5)
        time.sleep(1) # Eerbiedig de Nominatim API rate limit (max 1 req/sec)

        if response.status_code == 200 and response.json():
            data = response.json()[0]
            address = data.get("address", {})
            
            # 1. Plaats bepalen (stad, dorp, gemeente)
            city = (
                address.get("village") or 
                address.get("town") or 
                address.get("city") or 
                address.get("municipality") or 
                clean_input.split(",")[0].strip()
            )

            # 2. Provincie bepalen
            province = (
                address.get("state") or 
                address.get("province") or 
                address.get("region") or 
                "Onbekend"
            )

            # 3. Land bepalen
            country = address.get("country") or "Nederland"

            # 4. GPS Coördinaten
            lat = float(data.get("lat")) if data.get("lat") else None
            lon = float(data.get("lon")) if data.get("lon") else None

            # 5. Geformatteerde locatiestring opbouwen (bijv. "Stramproy, Limburg")
            loc_parts = []
            if city and city != "Onbekend":
                loc_parts.append(city)
            if province and province != "Onbekend" and province.lower() not in city.lower():
                loc_parts.append(province)
            
            formatted_location = ", ".join(loc_parts) if loc_parts else clean_input

            result = {
                "formatted": formatted_location,
                "city": city,
                "province": province,
                "country": country,
                "lat": lat,
                "lon": lon
            }
            GEO_CACHE[clean_input] = result
            return result
    except Exception:
        pass

    # Fallback als OSM niets vindt
    fallback = {
        "formatted": clean_input,
        "city": clean_input.split(",")[0].strip() if clean_input else "Onbekend",
        "province": "Onbekend",
        "country": "Nederland",
        "lat": None,
        "lon": None
    }
    GEO_CACHE[clean_input] = fallback
    return fallback

def is_similar_title(a, b, threshold=0.75):
    """Berekent of twee titels op elkaar lijken (0.0 tot 1.0)."""
    clean_a = re.sub(r"[^\w\s]", "", a.lower()).strip()
    clean_b = re.sub(r"[^\w\s]", "", b.lower()).strip()
    
    if clean_a in clean_b or clean_b in clean_a:
        return True
    
    ratio = SequenceMatcher(None, clean_a, clean_b).ratio()
    return ratio >= threshold

def parse_single_date(date_raw):
    """Parseert enkele datumstrings zoals '12-04-2026', '12/04/2026' of '12 april 2026'."""
    if not date_raw:
        return "Onbekende datum"
    
    date_str = date_raw.strip().lower()

    # 1. Numeriek DD-MM-YYYY of YYYY-MM-DD
    match_numeric = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", date_str)
    if match_numeric:
        day, month, year = match_numeric.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"

    # 2. Tekstueel (bijv. '12 april 2026')
    match_text = re.search(r"(\d{1,2})\s+([a-z]{3,9})\s*(\d{4})?", date_str)
    if match_text:
        day = int(match_text.group(1))
        month_str = match_text.group(2)[:3]
        year = int(match_text.group(3)) if match_text.group(3) else datetime.now().year
        
        month_num = DUTCH_MONTHS.get(month_str, datetime.now().month)
        return f"{year:04d}-{month_num:02d}-{day:02d}"

    return "Onbekende datum"

def parse_split_date(month_str, day_str):
    """Parseert losse dag/maand elementen (bijv. 'sep' en '20' of '25-27')."""
    if not month_str or not day_str:
        return "Onbekende datum"
    
    clean_month = month_str.strip().lower()[:3]
    match = re.search(r"\d+", day_str)
    if not match:
        return "Onbekende datum"
    
    clean_day = int(match.group())
    month_num = DUTCH_MONTHS.get(clean_month, datetime.now().month)
    
    now = datetime.now()
    year = now.year
    if month_num < now.month:
        year += 1

    try:
        dt = datetime(year, month_num, clean_day)
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return "Onbekende datum"

def extract_distances(card, distance_selector):
    if not distance_selector:
        return []
    
    try:
        elements = card.select(distance_selector)
    except Exception:
        return []

    distances = []
    for el in elements:
        text = clean_text_no_icons(el.get_text(strip=True))
        matches = re.findall(r"\b\d+(?:[\.,]\d+)?\s*(?:k|km)\b", text, re.IGNORECASE)
        for m in matches:
            clean_dist = m.lower().replace(" ", "")
            if clean_dist not in distances:
                distances.append(clean_dist)
                
    return distances

def scrape_site(site_config):
    name = site_config.get("name")
    current_url = site_config.get("url")
    headers = site_config.get("headers", {})
    selectors = site_config.get("selectors", {})

    events = []
    visited_urls = set()
    today_str = date.today().strftime("%Y-%m-%d")

    while current_url and current_url not in visited_urls:
        visited_urls.add(current_url)

        try:
            response = requests.get(current_url, headers=headers, timeout=10)
            response.raise_for_status()
        except Exception as e:
            print(f"❌ Fout bij ophalen van {name} ({current_url}): {e}")
            break

        soup = BeautifulSoup(response.text, "html.parser")
        card_selector = selectors.get("event_card", "")
        if not card_selector:
            break

        cards = soup.select(card_selector)

        for card in cards:
            # 1. Titel
            title_selector = selectors.get("title", "")
            title_el = card.select_one(title_selector) if title_selector else None
            raw_title = title_el.get_text(strip=True) if title_el else "Geen titel"
            title = clean_text_no_icons(raw_title)

            # 2. Datum
            date_selector = selectors.get("date", "")
            month_selector = selectors.get("date_month", "")
            day_selector = selectors.get("date_day", "")

            if date_selector:
                date_el = card.select_one(date_selector)
                raw_date = date_el.get_text(strip=True) if date_el else ""
                event_date = parse_single_date(raw_date)
            elif month_selector and day_selector:
                month_el = card.select_one(month_selector)
                day_el = card.select_one(day_selector)
                month_str = month_el.get_text(strip=True) if month_el else ""
                day_str = day_el.get_text(strip=True) if day_el else ""
                event_date = parse_split_date(month_str, day_str)
            else:
                event_date = "Onbekende datum"

            # Filter oude datums
            if event_date != "Onbekende datum" and event_date < today_str:
                continue

            # 3. Locatie + Geocoding
            loc_selector = selectors.get("location", "")
            loc_el = card.select_one(loc_selector) if loc_selector else None
            raw_location = loc_el.get_text(strip=True) if loc_el else ""
            loc_info = get_location_details(raw_location)

            # 4. Afstanden
            distances = extract_distances(card, selectors.get("distances", ""))

            # 5. Link / URL
            link_selector = selectors.get("link", "")
            link = ""
            if link_selector:
                link_el = card.select_one(link_selector)
                if link_el and link_el.get("href"):
                    raw_href = link_el.get("href")
                    link = raw_href if raw_href.startswith("http") else urljoin(current_url, raw_href)

            # 6. Event opslaan
            events.append({
                "title": title,
                "date": event_date,
                "location": loc_info["formatted"],
                "city": loc_info["city"],
                "province": loc_info["province"],
                "country": loc_info["country"],
                "lat": loc_info["lat"],
                "lon": loc_info["lon"],
                "distances": distances,
                "link": link,
                "source": name
            })

        # Volgende pagina afhandeling
        next_selector = selectors.get("next_page", "")
        next_button = soup.select_one(next_selector) if next_selector else None
        if next_button and next_button.get("href"):
            current_url = urljoin(current_url, next_button.get("href"))
        else:
            current_url = None

    return events

def deduplicate_events(all_events):
    """Dedupliceert events op basis van datum en soortgelijke titel."""
    unique_events = []

    for event in all_events:
        is_duplicate = False
        for u_event in unique_events:
            if event["date"] != "Onbekende datum" and event["date"] == u_event["date"]:
                if is_similar_title(event["title"], u_event["title"]):
                    is_duplicate = True
                    for dist in event["distances"]:
                        if dist not in u_event["distances"]:
                            u_event["distances"].append(dist)
                    if not u_event["link"] and event["link"]:
                        u_event["link"] = event["link"]
                    if not u_event["location"] and event["location"]:
                        u_event["location"] = event["location"]
                        u_event["city"] = event["city"]
                        u_event["province"] = event["province"]
                        u_event["country"] = event["country"]
                        u_event["lat"] = event["lat"]
                        u_event["lon"] = event["lon"]
                    break

        if not is_duplicate:
            unique_events.append(event)

    unique_events.sort(key=lambda x: x["date"])
    return unique_events

def generate_json(events, output_file="events.json"):
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    print(f"✅ JSON bestand gegenereerd: {output_file}")

def generate_rss(events, output_file="trail_events.xml"):
    fg = FeedGenerator()
    fg.id("https://trailscraper.local/feed")
    fg.title("Verzamelde Trailrun Kalender")
    fg.link(href="https://trailscraper.local", rel="alternate")
    fg.description("Geaggregeerde trailrun evenementen uit meerdere bronnen.")
    fg.language("nl")

    for ev in events:
        fe = fg.add_entry()
        event_id = f"{ev['date']}-{re.sub(r'[^a-zA-Z0-9]', '', ev['title'])}"
        fe.id(event_id)
        
        dist_str = f" [{', '.join(ev['distances'])}]" if ev['distances'] else ""
        fe.title(f"{ev['title']}{dist_str}")
        
        if ev["link"]:
            fe.link(href=ev["link"])
            
        desc = f"Datum: {ev['date']}\nLocatie: {ev['location'] or 'Onbekend'}\nAfstanden: {', '.join(ev['distances']) or 'Onbekend'}\nBron: {ev['source']}"
        fe.description(desc)

        if ev["date"] != "Onbekende datum":
            try:
                dt = parse(ev["date"])
                fe.pubDate(dt.astimezone())
            except Exception:
                pass

    fg.rss_file(output_file)
    print(f"✅ RSS feed gegenereerd: {output_file}")

def generate_ics(events, output_file="trail_events.ics"):
    cal = Calendar()
    cal.add('prodid', '-//Trail Scraper Aggregator//NL')
    cal.add('version', '2.0')

    for ev in events:
        if ev["date"] == "Onbekende datum":
            continue

        event = Event()
        dist_str = f" [{', '.join(ev['distances'])}]" if ev['distances'] else ""
        event.add('summary', f"{ev['title']}{dist_str}")
        
        desc = f"Locatie: {ev['location']}\nAfstanden: {', '.join(ev['distances'])}\nBron: {ev['source']}\nLink: {ev['link']}"
        event.add('description', desc)
        
        if ev["location"]:
            event.add('location', ev["location"])

        try:
            event_date = parse(ev["date"]).date()
            event.add('dtstart', event_date)
            event.add('dtend', event_date)
            event.add('uid', f"{ev['date']}-{hash(ev['title'])}@trailscraper")
            cal.add_component(event)
        except Exception:
            pass

    with open(output_file, 'wb') as f:
        f.write(cal.to_ical())
    print(f"✅ ICS kalender gegenereerd: {output_file}")

def main():
    config = load_config()
    all_scraped_events = []

    for site in config.get("scrapers", []):
        if site.get("enabled", True):
            print(f"Scrapen van: {site.get('name')}...")
            events = scrape_site(site)
            print(f"  -> {len(events)} toekomstige events opgehaald.")
            all_scraped_events.extend(events)

    print(f"\nTotaal opgehaald uit alle bronnen: {len(all_scraped_events)} toekomstige events.")
    
    unique_events = deduplicate_events(all_scraped_events)
    print(f"Na de-duplicatie overgebleven: {len(unique_events)} unieke events.\n")

    print("=" * 80)
    print("GECOMBINEERDE OUTPUT:")
    print("=" * 80)

    for i, ev in enumerate(unique_events, start=1):
        dist_str = f" | {', '.join(ev['distances'])}" if ev['distances'] else ""
        loc_str = f" | {ev['location']}" if ev['location'] else ""
        url_str = f" | {ev['link']}" if ev['link'] else ""
        
        print(f"[{i}] {ev['date']} | {ev['title']}{loc_str}{dist_str}{url_str}")

    print("=" * 80 + "\n")

    generate_json(unique_events)
    generate_rss(unique_events)
    generate_ics(unique_events)

if __name__ == "__main__":
    main()