document.addEventListener('DOMContentLoaded', () => {
  let allEvents = [];
  const geocodeCache = {};

  // DOM elementen
  const eventsContainer = document.getElementById('events-container');
  const searchInput = document.getElementById('search-input');
  const userLocationInput = document.getElementById('user-location');
  const monthFilter = document.getElementById('month-filter');

  // Checkboxes
  const distanceCheckboxes = document.querySelectorAll('.dist-checkbox');
  const btnDistSelectAll = document.getElementById('btn-dist-select-all');
  const btnDistDeselectAll = document.getElementById('btn-dist-deselect-all');

  const provinceCheckboxes = document.querySelectorAll('.prov-checkbox');
  const btnProvSelectAll = document.getElementById('btn-prov-select-all');
  const btnProvDeselectAll = document.getElementById('btn-prov-deselect-all');

  // 1. Maandfilter dynamisch vullen: Huidige maand + 11 toekomstige maanden
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

  // 2. Datum formatter: YYYY-MM-DD -> za 20 sep 2026
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

  // 3. Haversine formule (afstand tussen lat/lon in km)
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

  // 4. Geocoding via OpenStreetMap (Nominatim API)
  async function geocodeAddress(query) {
    if (!query) return null;
    const cleanQuery = query.toLowerCase().trim();
    if (geocodeCache[cleanQuery]) return geocodeCache[cleanQuery];

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TrailscraperApp/1.0' }
      });
      const data = await res.json();
      if (data && data.length > 0) {
        const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        geocodeCache[cleanQuery] = coords;
        return coords;
      }
    } catch (err) {
      console.warn(`Geocoding fout voor '${query}':`, err);
    }
    return null;
  }

  // 5. Automatisering voor iframe hoogte
  function sendHeightToParent() {
    if (window.parent && window.parent !== window) {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ frameHeight: height }, '*');
    }
  }

  // 6. Events renderen
  async function renderEvents(events) {
    if (!eventsContainer) return;

    if (events.length === 0) {
      eventsContainer.innerHTML = '<div class="no-events">Geen trailrun evenementen gevonden voor deze filters.</div>';
      sendHeightToParent();
      return;
    }

    const userCity = userLocationInput ? userLocationInput.value.trim() : 'Utrecht';
    const userCoords = await geocodeAddress(userCity || 'Utrecht');

    const cardsHtml = await Promise.all(events.map(async e => {
      const humanReadableDate = formatDutchDate(e.date);
      const distText = e.distances && e.distances.length > 0 
        ? e.distances.join(', ') 
        : 'Afstand onbekend';

      let travelDistBadge = '';
      if (userCoords) {
        let eventCoords = (e.lat && e.lon) ? { lat: e.lat, lon: e.lon } : null;
        if (!eventCoords && e.location && e.location !== "Onbekend") {
          eventCoords = await geocodeAddress(e.location);
        }

        if (eventCoords) {
          const km = calculateHaversineDistance(userCoords.lat, userCoords.lon, eventCoords.lat, eventCoords.lon);
          travelDistBadge = ` <span class="travel-distance">(±${km} km vanaf ${userCity})</span>`;
        }
      }

      return `
        <div class="trail-event-card">
          <h3>${e.title}</h3>
          <div class="trail-event-meta">
            📅 <strong>${humanReadableDate}</strong> | 📍 ${e.location}${travelDistBadge}
          </div>
          <div class="trail-event-distances">
            🏃 ${distText}
          </div>
          ${e.link && e.link !== "Onbekend" 
            ? `<a class="trail-event-link" href="${e.link}" target="_blank" rel="noopener">Bekijk evenement &rarr;</a>` 
            : ''}
        </div>
      `;
    }));

    eventsContainer.innerHTML = cardsHtml.join('');
    sendHeightToParent();
  }

  // 7. Filter logica
  function filterEvents() {
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedMonth = monthFilter ? monthFilter.value : 'all';

    // Afstand categorieën
    const checkedDistances = Array.from(distanceCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    // Provincie categorieën
    const checkedProvinces = Array.from(provinceCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value.toLowerCase());

    const filtered = allEvents.filter(e => {
      // Zoekterm filter
      const matchesSearch = !searchTerm || 
        e.title.toLowerCase().includes(searchTerm) || 
        e.location.toLowerCase().includes(searchTerm);

      // Maand filter
      const matchesMonth = selectedMonth === 'all' || 
        (e.date && e.date.startsWith(selectedMonth));

      // Provincie Checkbox Filter
      let matchesProvince = false;
      if (checkedProvinces.length > 0) {
        const eventProv = (e.province || 'Buitenland').toLowerCase();
        matchesProvince = checkedProvinces.includes(eventProv);
      }

      // Afstand Checkbox Filter
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

      return matchesSearch && matchesMonth && matchesProvince && matchesDistance;
    });

    renderEvents(filtered);
  }

  // --- KNOPPEN HANDLERS ---
  // Afstanden Alles Aan / Alles Uit
  if (btnDistSelectAll) {
    btnDistSelectAll.addEventListener('click', () => {
      distanceCheckboxes.forEach(cb => cb.checked = true);
      filterEvents();
    });
  }
  if (btnDistDeselectAll) {
    btnDistDeselectAll.addEventListener('click', () => {
      distanceCheckboxes.forEach(cb => cb.checked = false);
      filterEvents();
    });
  }

  // Provincies Alles Aan / Alles Uit
  if (btnProvSelectAll) {
    btnProvSelectAll.addEventListener('click', () => {
      provinceCheckboxes.forEach(cb => cb.checked = true);
      filterEvents();
    });
  }
  if (btnProvDeselectAll) {
    btnProvDeselectAll.addEventListener('click', () => {
      provinceCheckboxes.forEach(cb => cb.checked = false);
      filterEvents();
    });
  }

  // --- INITIALISATIE ---
  populateMonthFilter();

  fetch('events.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      allEvents = data;
      renderEvents(allEvents);
    })
    .catch(err => {
      console.error('Fout bij laden van events.json:', err);
      if (eventsContainer) {
        eventsContainer.innerHTML = '<div class="error-msg">Kan evenementen niet laden.</div>';
      }
    });

  // Debounce voor soepel typen
  let timeoutId;
  function debounceFilter() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(filterEvents, 400);
  }

  // Event Listeners
  if (searchInput) searchInput.addEventListener('input', debounceFilter);
  if (userLocationInput) userLocationInput.addEventListener('input', debounceFilter);
  if (monthFilter) monthFilter.addEventListener('change', filterEvents);
  
  distanceCheckboxes.forEach(cb => cb.addEventListener('change', filterEvents));
  provinceCheckboxes.forEach(cb => cb.addEventListener('change', filterEvents));

  window.addEventListener('resize', sendHeightToParent);
});