import os
import json
import time
import logging
import requests
from urllib.parse import quote

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

# Pad naar de cache in de data/ map
CACHE_DIR = "data"
CACHE_FILE = os.path.join(CACHE_DIR, "geocode_cache.json")

def load_cache():
    """Laadt de opgeslagen lat/lon coördinaten uit de JSON cache."""
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"⚠️ Fout bij laden van geocode_cache.json: {e}")
            return {}
    return {}

def save_cache(cache):
    """Slaat de geüpdatete cache op in data/geocode_cache.json."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"⚠️ Fout bij opslaan van geocode_cache.json: {e}")

def enrich_events(events):
    """
    Verrijkt een lijst met events met lat/lon coördinaten.
    Gebruikt eerst de lokale cache; haalt alleen nieuwe locaties op via Nominatim.
    """
    cache = load_cache()
    cache_updated = False

    for event in events:
        loc = event.get("location")
        
        # Sla lege/onbekende locaties over
        if not loc or loc == "Onbekend":
            event["lat"] = None
            event["lon"] = None
            continue

        # 1. Bekende locatie uit de cache paken
        if loc in cache:
            lat, lon = cache[loc]
            if lat is not None and lon is not None:
                event["lat"] = lat
                event["lon"] = lon
                #logging.info(f"⚡ Locatie uit cache geladen: '{loc}' -> ({lat}, {lon})")
            else:
                # <-- HIER: Waarschuwing als de cache [null, null] bevat
                logging.warning(f"⚠️ Geen coördinaten in cache voor locatie: '{loc}' (staat als null/null)")
        else:
            # 2. Nieuwe locatie ophalen via OpenStreetMap Nominatim API
            logging.info(f"🌐 Nieuwe plaats geocoderen: '{loc}'...")
            try:
                url = f"https://nominatim.openstreetmap.org/search?format=json&q={quote(loc + ', Nederland')}&limit=1"
                headers = {'User-Agent': 'TrailScraperBot/1.0'}
                
                res = requests.get(url, headers=headers, timeout=5).json()
                
                if res and len(res) > 0:
                    lat = float(res[0]['lat'])
                    lon = float(res[0]['lon'])
                    cache[loc] = [lat, lon]
                    event["lat"] = lat
                    event["lon"] = lon
                else:
                    logging.warning(f"⚠️ Geen coördinaten gevonden voor: '{loc}'")
                    cache[loc] = [None, None]
                    event["lat"] = None
                    event["lon"] = None
                
                cache_updated = True
                time.sleep(1.2)  # Noodzakelijk om de Nominatim rate-limit niet te overschrijden
            except Exception as e:
                logging.error(f"❌ Fout bij geocoding voor '{loc}': {e}")
                event["lat"] = None
                event["lon"] = None

    # Schrijf de bijgewerkte cache weg als er nieuwe plaatsen gezocht zijn
    if cache_updated:
        save_cache(cache)

    unresolved = []

    for event in events:
        if not event.get('lat') or not event.get('lon'):
            unresolved.append(f"- **{event.get('title')}** ({event.get('location', 'Geen locatie')})")

    if unresolved:
        # Maak speciaal dit bestand aan
        with open('geocoding_issues.txt', 'w', encoding='utf-8') as f:
            f.write("De volgende evenementen konden niet worden geocodeerd:\n\n")
            f.write("\n".join(unresolved))
        logging.warning(f"⚠️ geocoding_issues.txt aangemaakt.")
    return events