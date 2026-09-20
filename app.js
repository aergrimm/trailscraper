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

  // 6. EENMALIG REISAFSTANDEN BEREKENEN (0.001 sec via JSON lat/lon)
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

    filterEvents();
  }

  // 7. EVENTS RENDEREN
  function renderEvents(events) {
    if (!eventsContainer) return;

    if (events.length === 0) {
      eventsContainer.innerHTML = '<div class="no-events">Geen trailrun evenementen gevonden voor deze filters.</div>';
      sendHeightToParent();
      return;
    }

    const userCity = userLocationInput ? userLocationInput.value.trim() : 'Utrecht';

    const cardsHtml = events.map(e => {
      const humanReadableDate = formatDutchDate(e.date);
      const distText = e.distances && e.distances.length > 0 
        ? e.distances.join(', ') 
        : 'Afstand onbekend';

      const travelDistBadge = e.calculatedDistance !== undefined
        ? ` <span class="travel-distance">(±${e.calculatedDistance} km vanaf ${userCity})</span>`
        : '';

      const linkHtml = (e.link && e.link !== "Onbekend")
        ? `<a class="trail-event-link" href="${e.link}" target="_blank" rel="noopener">Bekijk &rarr;</a>`
        : '';

      return `
        <div class="trail-event-card">
          <div class="card-header">
            <span class="card-date">📅 ${humanReadableDate}</span>
            <h3 class="card-title">${e.title}</h3>
            ${linkHtml}
          </div>
          <div class="card-location">
            📍 ${e.location}${travelDistBadge}
          </div>
          <div class="card-distances">
            🏃 ${distText}
          </div>
        </div>
      `;
    });

    eventsContainer.innerHTML = cardsHtml.join('');
    sendHeightToParent();
  }

  // 8. FILTEREN (100% Synchroon & Instant)
  function filterEvents() {
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedMonth = monthFilter ? monthFilter.value : 'all';
    const maxTravelKm = travelDistFilter ? travelDistFilter.value : 'all';

    const checkedDistances = Array.from(distanceCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
    const checkedProvinces = Array.from(provinceCheckboxes).filter(cb => cb.checked).map(cb => cb.value.toLowerCase());

    const filtered = allEvents.filter(e => {
      // 1. Zoekterm
      const matchesSearch = !searchTerm || 
        e.title.toLowerCase().includes(searchTerm) || 
        e.location.toLowerCase().includes(searchTerm);

      // 2. Maand
      const matchesMonth = selectedMonth === 'all' || (e.date && e.date.startsWith(selectedMonth));

      // 3. Provincie
      const eventProv = (e.province || 'Buitenland').toLowerCase();
      const matchesProvince = checkedProvinces.length > 0 && checkedProvinces.includes(eventProv);

      // 4. Afstand van de trail
      let matchesDistance = false;
      if (checkedDistances.length > 0) {
        if (e.distances && e.distances.length > 0) {
          const kms = e.distances.map(d => parseInt(d.replace('km', ''), 10)).filter(n => !isNaN(n));
          if (kms.length > 0) {
            const isUnder15 = checkedDistances.includes('under_15') && kms.some(k => k < 15);
            const isUpTo25  = checkedDistances.includes('up_to_25') && kms.some(k => k >= 15 && k <= 25);
            const isUpTo42  = checkedDistances.includes('up_to_42') && kms.some(k => k > 25 && k <= 42);
            const isOver42  = checkedDistances.includes('over_42') && kms.some(k => k > 42);

            matchesDistance = isUnder15 || isUpTo25 || isUpTo42 || isOver42;
          } else {
            matchesDistance = true;
          }
        } else {
          matchesDistance = true;
        }
      }

      // 5. Max Reisafstand
      let matchesTravelDistance = true;
      if (maxTravelKm !== 'all') {
        const maxKmNum = parseInt(maxTravelKm, 10);
        matchesTravelDistance = e.calculatedDistance !== undefined && e.calculatedDistance <= maxKmNum;
      }

      return matchesSearch && matchesMonth && matchesProvince && matchesDistance && matchesTravelDistance;
    });

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