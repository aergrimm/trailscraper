import os
import re
import logging
import requests
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

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

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def fetch_html(url, headers=None, timeout=15):
    """Haalt de HTML-inhoud op van een pagina met foutafhandeling."""
    req_headers = DEFAULT_HEADERS.copy()
    if headers and isinstance(headers, dict):
        req_headers.update(headers)
        
    try:
        response = requests.get(url, headers=req_headers, timeout=timeout)
        response.raise_for_status()
        return response.text
    except Exception as e:
        logging.error(f"❌ Netwerkfout bij ophalen van {url}: {e}")
        return None

def clean_text(text):
    """Verwijdert vreemde stuurkarakters/emoji-ruis en ruimt spaties op."""
    if not text:
        return ""
    cleaned = re.sub(r'[^\w\s\-\.,\(\)]', '', text)
    return cleaned.strip()

def normalize_date(raw_date_str, month_str=None, year_str=None, link_url=None):
    current_year = str(datetime.now().year)

    # 1. Probeer datum uit URL te halen
    if link_url:
        url_match = re.search(r'(\d{4})-(\d{2})-(\d{2})', link_url)
        if url_match:
            return f"{url_match.group(1)}-{url_match.group(2)}-{url_match.group(3)}"

    # 2. Opschonen van maandbereik (bijv. "nov-mrt" -> pak alleen "nov")
    if month_str:
        # Als er een koppelteken in de maand staat, pak de STARTmaand
        clean_month_str = month_str.split('-')[0].split('t/m')[0].strip()
    else:
        clean_month_str = ""

    # 3. Opschonen van dagbereik (bijv. "7-20" -> pak alleen de startdag "7")
    clean_day_str = str(raw_date_str or "").split('-')[0].split('t/m')[0].strip()

    combined_text = f"{clean_day_str} {clean_month_str} {year_str or ''}".strip()
    if not combined_text:
        return "Onbekend"

    # Match op digitale datums (bijv. 07-11-2026)
    digits_match = re.search(r'(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{2,4})', combined_text)
    if digits_match:
        day = digits_match.group(1).zfill(2)
        month = digits_match.group(2).zfill(2)
        year = digits_match.group(3)
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{month}-{day}"

    # Haal daggetal op
    day_match = re.search(r'\d+', clean_day_str)
    if not day_match:
        return "Onbekend"
    day = day_match.group(0).zfill(2)

    # Zoek de startmaand in MONTH_MAP
    m_clean = re.sub(r'[^a-zA-Z]', '', clean_month_str).lower()
    month = "01"
    for k, v in MONTH_MAP.items():
        if k in m_clean:
            month = v
            break

    year_match = re.search(r'20\d{2}', combined_text)
    year = year_match.group(0) if year_match else (year_str or current_year)

    return f"{year}-{month}-{day}"

def normalize_distance(dist_str):
    """Zet afstands-teksten om naar een genormaliseerde lijst (bijv. ['10km', '21km'])."""
    if not dist_str:
        return []

    d_lower = dist_str.lower().strip()
    results = []
    
    if "halve marathon" in d_lower or "half marathon" in d_lower:
        results.append("21km")
    elif "marathon" in d_lower:
        results.append("42km")

    range_match = re.search(r'(\d+)\s*(?:-|t/m|tot)\s*(\d+)\s*km?', d_lower)
    if range_match:
        results.append(f"{range_match.group(1)}km")
        results.append(f"{range_match.group(2)}km")
        return results

    numbers = re.findall(r'\d+', d_lower)
    for num in numbers:
        results.append(f"{num}km")

    return list(dict.fromkeys(results))

def infer_province(location_str):
    """Bepaalt de Nederlandse provincie op basis van de plaatsnaam."""
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