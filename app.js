document.addEventListener('DOMContentLoaded', () => {
  let allEvents = [];
  const geocodeCache = {};

  // DOM elementen
  const eventsContainer = document.getElementById('events-container');
  const searchInput = document.getElementById('search-input');
  const monthFilter = document.getElementById('month-filter');
  const userLocationInput = document.getElementById('user-location');
  const travelDistFilter = document.getElementById('travel-dist-filter');

  const distanceCheckboxes = document.querySelectorAll('.dist-checkbox');
  const btnToggleDist = document.getElementById('btn-toggle-dist');

  const provinceCheckboxes = document.querySelectorAll('.prov-checkbox');
  const btnToggleProv = document.getElementById('btn-toggle-prov');

	const PROVINCIE_AFKORTINGEN = {
	  "Noord-Brabant": "NB",
	  "Noord-Holland": "NH",
	  "Zuid-Holland": "ZH",
	  "Gelderland": "GE",
	  "Overijssel": "OV",
	  "Groningen": "GR",
	  "Friesland": "FR",
	  "Flevoland": "FL",
	  "Drenthe": "DR",
	  "Utrecht": "UT",
	  "Zeeland": "ZE",
	  "Limburg": "LI"
	};
	
		// Dual range slider elementen ophalen
		const minInput = document.getElementById('min-dist');
		const maxInput = document.getElementById('max-dist');
		const rangeText = document.getElementById('distance-range-text');

		function updateDistanceFilter() {
		  let minVal = parseInt(minInput.value, 10);
		  let maxVal = parseInt(maxInput.value, 10);

		  // Zorg dat min nooit groter wordt dan max
		  if (minVal==0 && maxVal <5) {
			maxVal=5;
			maxInput.value = maxVal;
		  }else if (minVal+5 > maxVal) {
			minInput.value = maxVal-5;
			minVal = maxVal-5;
		  }

		  // Update de tekst (bijv: "0 - 50+ km" of "15 - 30 km")
		  const maxDisplay = maxVal === 50 ? '50+ km' : `${maxVal} km`;
		  if (rangeText) {
			rangeText.textContent = `${minVal} - ${maxDisplay}`;
		  }

		  // Trigger de filtering
		  filterEvents(); // Of applyFilters(), afhankelijk van de naam in jouw app.js
		}

		// Koppel event listeners (zowel 'input' voor direct slepen als 'change')
		if (minInput && maxInput) {
		  minInput.addEventListener('input', updateDistanceFilter);
		  maxInput.addEventListener('input', updateDistanceFilter);
		}
	function formatLocationWithProvince(locationStr) {
	  if (!locationStr) return "";
	  
	  let formatted = locationStr.trim();
	  
	  Object.entries(PROVINCIE_AFKORTINGEN).forEach(([fullName, shortCode]) => {
		// Vervang ", Gelderland" of " Gelderland" overal in de tekst door " (GE)"
		const regex = new RegExp(`(,\\s*|\\s+)` + fullName, 'gi');
		if (regex.test(formatted)) {
		  formatted = formatted.replace(regex, ` (${shortCode})`);
		}
	  });

	  return formatted;
	}
// ==========================================
// SCROLL TO TOP KNOP LOGICA
// ==========================================
const scrollToTopBtn = document.getElementById("scrollToTopBtn");

if (scrollToTopBtn) {
  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      scrollToTopBtn.classList.add("visible");
    } else {
      scrollToTopBtn.classList.remove("visible");
    }
  });

  scrollToTopBtn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}

  // 1. Maandfilter vullen (huidige maand + 11 toekomstige maanden)
  function populateMonthFilter() {
    if (!monthFilter) return;

    const dutchMonths = [
      "Januari", "Februari", "Maart", "April", "Mei", "Juni",
      "Juli", "Augustus", "September", "Oktober", "November", "December"
    ];

    const today = new Date();
    let currentYear = today.getFullYear();
    let currentMonth = today.getMonth();

    monthFilter.innerHTML = '<option value="all">Alle maanden</option>';

    for (let i = 0; i < 12; i++) {
      const monthNum = (currentMonth % 12) + 1;
      const formattedMonth = String(monthNum).padStart(2, '0');
      const valueStr = `${currentYear}-${formattedMonth}`;
      const labelStr = `${dutchMonths[currentMonth % 12]} ${currentYear}`;

      const option = document.createElement('option');
      option.value = valueStr;
      option.textContent = labelStr;
      monthFilter.appendChild(option);

      currentMonth++;
      if (currentMonth % 12 === 0) {
        currentYear++;
      }
    }
  }

  // 2. Datum formatter
  function formatDutchDate(isoDateStr) {
    if (!isoDateStr || isoDateStr === "Onbekend") return "Datum onbekend";

	const parts = isoDateStr.split('-');
    if (parts.length !== 3) return isoDateStr;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) return isoDateStr;

    const shortDays = ["zo", "ma", "di", "wo", "do", "vr", "za"];
    const shortMonths = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

    return `${shortDays[d.getDay()]} ${day} ${shortMonths[d.getMonth()]} ${year}`;
  }

  // 3. Haversine afstandsberekening (in km)
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  // 4. Geocoding: ALLEEN voor de ingevoerde vertrekplaats!
  async function geocodeUserCity(cityQuery) {
    if (!cityQuery) return null;
    const cleanQuery = cityQuery.toLowerCase().trim();
    if (geocodeCache[cleanQuery]) return geocodeCache[cleanQuery];

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'TrailscraperApp/1.0' } });
      const data = await res.json();
      if (data && data.length > 0) {
        const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        geocodeCache[cleanQuery] = coords;
        return coords;
      }
    } catch (err) {
      console.warn(`Geocoding fout voor vertrekplaats '${cityQuery}':`, err);
    }
    return null;
  }

  // 5. Iframe hoogte bijwerken
  function sendHeightToParent() {
    if (window.parent && window.parent !== window) {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ frameHeight: height }, '*');
    }
  }

  // 6. REISAFSTANDEN BEREKENEN EN SORTEREN OP DATUM
  async function updateCalculatedDistances() {
    const userCity = userLocationInput ? userLocationInput.value.trim() : 'Utrecht';
    const userCoords = await geocodeUserCity(userCity || 'Utrecht');

    allEvents.forEach(e => {
      if (userCoords && e.lat && e.lon) {
        e.calculatedDistance = calculateHaversineDistance(userCoords.lat, userCoords.lon, e.lat, e.lon);
      } else {
        e.calculatedDistance = undefined;
      }
    });

    // Sorteren op datum (oplopend)
    allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    filterEvents();
  }

  // 7. EVENTS RENDEREN MET MAAND-SCHEIDINGSBALK
  function renderEvents(events) {
    if (!eventsContainer) return;

    if (events.length === 0) {
      eventsContainer.innerHTML = '<div class="no-events">Geen trailrun evenementen gevonden voor deze filters.</div>';
      sendHeightToParent();
      return;
    }

    const userCity = userLocationInput ? userLocationInput.value.trim() : 'Utrecht';
    const dutchMonths = [
      "Januari", "Februari", "Maart", "April", "Mei", "Juni",
      "Juli", "Augustus", "September", "Oktober", "November", "December"
    ];

    let htmlBuilder = '';
    let currentMonthHeader = '';

events.forEach(e => {
  // 1. Bepaal maand en jaar voor de scheidingsbalk
  if (e.date && e.date !== "Onbekend") {
    const parts = e.date.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const monthYearStr = `${dutchMonths[monthIdx]} ${year}`;

      if (monthYearStr !== currentMonthHeader) {
        currentMonthHeader = monthYearStr;
        htmlBuilder += `
          <div class="month-divider">
            <h2>${currentMonthHeader}</h2>
          </div>
        `;
      }
    }
  }

  // 2. Geformateerde datum ophalen
  const humanReadableDate = formatDutchDate(e.date);

  // 3. Titel opbouwen (klikbaar mits er een geldige link is)
  const titleHtml = (e.link && e.link !== "Onbekend")
    ? `<a href="${e.link}" target="_blank" rel="noopener">${e.title} <span class="link-icon">🔗</span></a>`
    : e.title;

  // 4. Locatie opschonen met provincie-afkorting (bijv. "Driebergen-Rijsenburg (UT)")
  const compactLocation = formatLocationWithProvince(e.location);

  // 5. Reisafstand compacter formuleren (bijv. " • 12 km")
  const travelDistBadge = (e.calculatedDistance !== undefined)
    ? `<span class="distance-badge"> • 🚗 ${e.calculatedDistance}km</span>`
    : '';

// 6. Hardloopafstanden sorteren en omzetten naar badges
  let distancesHtml = '';
  if (e.distances && e.distances.length > 0) {
    // Sorteer op het getal in de string (bijv. "4km" -> 4, "42km" -> 42)
    const sortedDistances = [...e.distances].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    distancesHtml = sortedDistances
      .map(d => `<span class="badge">${d}</span>`)
      .join('');
  } else {
    distancesHtml = 'Afstand onbekend';
  }

  // 7. Compacte kaart HTML-structuur toevoegen
  htmlBuilder += `
    <div class="event-card">
      <div class="card-header">
        <span class="event-date">📅 ${humanReadableDate}</span>
      </div>

      <h3 class="event-title">
        ${titleHtml}
      </h3>

      <p class="event-location">
        📍 ${compactLocation}${travelDistBadge}
      </p>

      <div class="event-distances">
        ${distancesHtml}
      </div>
    </div>
  `;
});

    eventsContainer.innerHTML = htmlBuilder;
    sendHeightToParent();
  }

  // 8. FILTEREN EN SORTEREN
function filterEvents() {
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const selectedMonth = monthFilter ? monthFilter.value : 'all';
  const maxTravelKm = travelDistFilter ? travelDistFilter.value : 'all';

  const minKm = parseInt(minInput ? minInput.value : 0, 10);
  const maxKm = parseInt(maxInput ? maxInput.value : 50, 10);

  const checkedProvinces = Array.from(provinceCheckboxes).filter(cb => cb.checked).map(cb => cb.value.toLowerCase());

  const filtered = allEvents.filter(e => {
    // 0. Veiligheidscheck voor lege event objecten
    if (!e) return false;

    // 1. Zoekterm
    const matchesSearch = !searchTerm || 
      (e.title && e.title.toLowerCase().includes(searchTerm)) || 
      (e.location && e.location.toLowerCase().includes(searchTerm));

    // 2. Maand
    const matchesMonth = selectedMonth === 'all' || (e.date && e.date.startsWith(selectedMonth));

    // 3. Provincie
    const eventProv = (e.province || 'Buitenland').toLowerCase();
    const matchesProvince = checkedProvinces.length === 0 || checkedProvinces.includes(eventProv);

    // 4. Afstand van de trail (met slider)
    const eventDistances = e.distances || [];
    let matchesDistance = true; // Standaard op true als er geen afstanden vermeld staan

    if (eventDistances.length > 0) {
      matchesDistance = eventDistances.some(dist => {
        const km = parseFloat(dist);
        if (isNaN(km)) return true; // Als afstand tekst/onbekend is, wel tonen

        if (maxKm === 50) {
          return km >= minKm; // 50 geldt als 50+ km
        }
        return km >= minKm && km <= maxKm;
      });
    }

    // 5. Max Reisafstand (Auto)
    let matchesTravelDistance = true;
    if (maxTravelKm !== 'all') {
      const maxKmNum = parseInt(maxTravelKm, 10);
      matchesTravelDistance = e.calculatedDistance !== undefined && e.calculatedDistance <= maxKmNum;
    }

    return matchesSearch && matchesMonth && matchesProvince && matchesDistance && matchesTravelDistance;
  });

  // Zorg ervoor dat het resultaat altijd op datum gesorteerd is
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

  renderEvents(filtered);
}

  // WISSELKNOPPEN
  function updateToggleBtnText(checkboxes, btn) {
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    btn.textContent = allChecked ? "Alles uit" : "Alles aan";
  }

  function handleToggleAll(checkboxes, btn) {
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateToggleBtnText(checkboxes, btn);
    filterEvents();
  }

  if (btnToggleDist) {
    btnToggleDist.addEventListener('click', () => handleToggleAll(distanceCheckboxes, btnToggleDist));
    distanceCheckboxes.forEach(cb => cb.addEventListener('change', () => {
      updateToggleBtnText(distanceCheckboxes, btnToggleDist);
      filterEvents();
    }));
  }

  if (btnToggleProv) {
    btnToggleProv.addEventListener('click', () => handleToggleAll(provinceCheckboxes, btnToggleProv));
    provinceCheckboxes.forEach(cb => cb.addEventListener('change', () => {
      updateToggleBtnText(provinceCheckboxes, btnToggleProv);
      filterEvents();
    }));
  }

  // INITIALISATIE
  populateMonthFilter();

  fetch('events.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      allEvents = data;
      updateCalculatedDistances();
    })
    .catch(err => {
      console.error('Fout bij laden van events.json:', err);
      if (eventsContainer) {
        eventsContainer.innerHTML = '<div class="error-msg">Kan evenementen niet laden.</div>';
      }
    });

  // Debounce voor vertrekplaats
  let timeoutId;
  if (userLocationInput) {
    userLocationInput.addEventListener('input', () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateCalculatedDistances, 400);
    });
  }

  // Event-listeners voor live filtering
  if (searchInput) searchInput.addEventListener('input', filterEvents);
  if (monthFilter) monthFilter.addEventListener('change', filterEvents);
  if (travelDistFilter) travelDistFilter.addEventListener('change', filterEvents);

  window.addEventListener('resize', sendHeightToParent);
});

