document.addEventListener('DOMContentLoaded', () => {
  let allEvents = [];

  // DOM elementen
  const eventsContainer = document.getElementById('events-container');
  const searchInput = document.getElementById('search-input');
  const distanceFilter = document.getElementById('distance-filter');
  const monthFilter = document.getElementById('month-filter');

  // 1. Datum formatter: zet 'YYYY-MM-DD' om naar 'za 20 sep 2026'
  function formatDutchDate(isoDateStr) {
    if (!isoDateStr || isoDateStr === "Onbekend") return "Datum onbekend";

    const parts = isoDateStr.split('-');
    if (parts.length !== 3) return isoDateStr;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Maanden zijn 0-indexed in JS
    const day = parseInt(parts[2], 10);

    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) return isoDateStr;

    const shortDays = ["zo", "ma", "di", "wo", "do", "vr", "za"];
    const shortMonths = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

    const dayName = shortDays[d.getDay()];
    const monthName = shortMonths[d.getMonth()];

    return `${dayName} ${day} ${monthName} ${year}`;
  }

  // 2. Automatisering voor iframe hoogte (handig voor WordPress integratie)
  function sendHeightToParent() {
    if (window.parent && window.parent !== window) {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ frameHeight: height }, '*');
    }
  }

  // 3. Events renderen op de pagina
  function renderEvents(events) {
    if (!eventsContainer) return;

    if (events.length === 0) {
      eventsContainer.innerHTML = '<div class="no-events">Geen trailrun evenementen gevonden voor deze filters.</div>';
      sendHeightToParent();
      return;
    }

    eventsContainer.innerHTML = events.map(e => {
      const humanReadableDate = formatDutchDate(e.date);
      
      const distText = e.distances && e.distances.length > 0 
        ? e.distances.join(', ') 
        : 'Afstand onbekend';

      return `
        <div class="trail-event-card">
          <h3>${e.title}</h3>
          <div class="trail-event-meta">
            📅 <strong>${humanReadableDate}</strong> | 📍 ${e.location}
          </div>
          <div class="trail-event-distances">
            🏃 ${distText}
          </div>
          ${e.link && e.link !== "Onbekend" 
            ? `<a class="trail-event-link" href="${e.link}" target="_blank" rel="noopener">Bekijk evenement &rarr;</a>` 
            : ''}
        </div>
      `;
    }).join('');

    sendHeightToParent();
  }

  // 4. Filters toepassen
  function filterEvents() {
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedDistance = distanceFilter ? distanceFilter.value : 'all';
    const selectedMonth = monthFilter ? monthFilter.value : 'all';

    const filtered = allEvents.filter(e => {
      // Zoekterm filter (titel & locatie)
      const matchesSearch = !searchTerm || 
        e.title.toLowerCase().includes(searchTerm) || 
        e.location.toLowerCase().includes(searchTerm);

      // Maand filter (vergelijkt YYYY-MM)
      const matchesMonth = selectedMonth === 'all' || 
        (e.date && e.date.startsWith(selectedMonth));

      // Afstand filter
      let matchesDistance = true;
      if (selectedDistance !== 'all' && e.distances && e.distances.length > 0) {
        // Haal alle numerieke afstanden op uit de array ['10km', '20km'] -> [10, 20]
        const kms = e.distances.map(d => parseInt(d.replace('km', ''), 10)).filter(n => !isNaN(n));
        
        if (kms.length > 0) {
          if (selectedDistance === 'short') { // < 15 km
            matchesDistance = kms.some(k => k < 15);
          } else if (selectedDistance === 'medium') { // 15 - 30 km
            matchesDistance = kms.some(k => k >= 15 && k <= 30);
          } else if (selectedDistance === 'long') { // > 30 km
            matchesDistance = kms.some(k => k > 30);
          }
        }
      }

      return matchesSearch && matchesMonth && matchesDistance;
    });

    renderEvents(filtered);
  }

  // 5. Data ophalen uit events.json
  fetch('events.json')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP fout! Status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      allEvents = data;
      renderEvents(allEvents);
    })
    .catch(error => {
      console.error('Fout bij het laden van events.json:', error);
      if (eventsContainer) {
        eventsContainer.innerHTML = '<div class="error-msg">Kan de evenementen op dit moment niet laden.</div>';
      }
    });

  // Event listeners voor live filtering
  if (searchInput) searchInput.addEventListener('input', filterEvents);
  if (distanceFilter) distanceFilter.addEventListener('change', filterEvents);
  if (monthFilter) monthFilter.addEventListener('change', filterEvents);

  // Pas iframe hoogte aan bij verandering van venstergrootte
  window.addEventListener('resize', sendHeightToParent);
});