import os
import json
import logging
import sys
import io

# Dwing console output naar UTF-8 voor Windows ondersteuning
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

# Importeer de scrapers en geocoder
from scrapers import gotrail
from geocoder import enrich_events

OUTPUT_FILE = "events.json"

def main():
    logging.info("🚀 TrailScraper Pijplijn gestart...")
    all_events = []

    # 1. Voer de GoTrail scraper uit
    try:
        gotrail_events = gotrail.scrape()
        all_events.extend(gotrail_events)
    except Exception as e:
        logging.error(f"❌ Fout opgetreden bij GoTrail scraper: {e}")

    # (Hier kun je later eenvoudig extra scrapers toevoegen, bijv. betrail.scrape())

    logging.info(f"📊 Totaal {len(all_events)} ruwe events verzameld.")

    # 2. Verrijken met lat/lon via geocoder (geocoder.py leest/schrijft ook de cache)
    logging.info("📍 Starten met coördinaten verrijken (via cache/API)...")
    enriched_events = enrich_events(all_events)

    # 3. Opslaan als definitief events.json bestand voor de frontend
    try:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(enriched_events, f, ensure_ascii=False, indent=2)
        logging.info(f"🎉 Succesvol {len(enriched_events)} events opgeslagen in '{OUTPUT_FILE}'.")
    except Exception as e:
        logging.error(f"❌ Fout bij opslaan van '{OUTPUT_FILE}': {e}")

if __name__ == "__main__":
    main()