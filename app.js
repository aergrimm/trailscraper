let allTrailEvents = [];
let userLat = 52.0907; // Standaard Utrecht GPS
let userLon = 5.1214;
let allProvincesChecked = true;

const PROVINCES = [
  "Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", 
  "Limburg", "Noord-Brabant", "Noord-Holland", "Overijssel", 
  "Utrecht", "Zeeland", "Zuid-Holland"
];

const jsonUrl = './events.json';

function initApp() {
  console.log("🚀 [TRAILSCRAPER] App initialiseren...");
  buildProvinceCheckboxes();
  populateMonthDropdown();

  fetch(jsonUrl)
    .then(r => {
      console.log("📡 [FETCH STATUS]:", r.status);
      if (!r.ok) throw new Error('Status ' + r.status + ' - JSON niet bereikbaar');
      return r.json();
    })
    .then(data => {
      console.log("📦 [DATA GELADEN]:", data.length, "events gevonden");
      allTrailEvents = data;
      filterEvents();
    })
    .catch(err => {
      console.error("❌ [FETCH ERROR]:", err);
      const container = document.getElementById('trailEventsList');
      if (container) {
        container.innerHTML = `<p style="color:red; padding:15px; background:#fff; border:1px solid red; border-radius:8px;">
          <strong>Fout bij ophalen kalender:</strong> ${err.message}
        </p>`;
      }
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Veilige sendHeight wat nie breek op GitHub Pages nie
function sendHeight() {
  try {
    if (window.parent && window.parent !== window) {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ frameHeight: height }, '*');
    }
  } catch (e) {
    // Negeer waarskuwing as postMessage nie toegelaat word nie
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

function updateUserCoordinates(e) {
  if (e) e.preventDefault();
  
  const cityInput = document.getElementById('userLocation');
  const city = cityInput ? cityInput.value : '';
  if (!city) return;
  
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city + ', Nederland')}`)
    .then(r => r.json())
    .then(data => {
      if (data && data.length > 0) {
        userLat = parseFloat(data[0].lat);
        userLon = parseFloat(data[0].lon);
        filterEvents();
      } else {
        alert('Locatie niet gevonden. Probeer een andere plaatsnaam.');
      }
    })
    .catch(err => {
      console.error(err);
      alert('Fout bij ophalen van GPS-coördinaten.');
    });
}

function buildProvinceCheckboxes() {
  const container = document.getElementById('provinceCheckboxes');
  if (!container) return;
  
  container.innerHTML = PROVINCES.map(p => `
    <label>
      <input type="checkbox" class="prov-cb" value="${p}" checked onchange="updateToggleBtnState(); filterEvents();"> ${p}
    </label>
  `).join('');
}

function toggleAllProvinces() {
  const checkboxes = document.querySelectorAll('.prov-cb');
  allProvincesChecked = !allProvincesChecked;

  checkboxes.forEach(cb => {
    cb.checked = allProvincesChecked;
  });

  const btn = document.getElementById('toggleProvincesBtn');
  if (btn) {
    btn.textContent = allProvincesChecked ? 'Alles uitvinken' : 'Alles aanvinken';
  }

  filterEvents();
}

function updateToggleBtnState() {
  const checkboxes = Array.from(document.querySelectorAll('.prov-cb'));
  const checkedCount = checkboxes.filter(cb => cb.checked).length;
  const btn = document.getElementById('toggleProvincesBtn');
  
  if (!btn) return;

  if (checkedCount === checkboxes.length) {
    allProvincesChecked = true;
    btn.textContent = 'Alles uitvinken';
  } else {
    allProvincesChecked = false;
    btn.textContent = 'Alles aanvinken';
  }
}

function filterEvents() {
  if (!allTrailEvents || allTrailEvents.length === 0) return;

  try {
    const maxRadiusEl = document.getElementById('maxRadius');
    const maxRadius = maxRadiusEl ? parseFloat(maxRadiusEl.value) : 9999;

    const monthEl = document.getElementById('monthFilter');
    const selectedMonth = monthEl ? monthEl.value : 'all';

    const distEl = document.getElementById('distanceFilter');
    const distCategory = distEl ? distEl.value : 'all';

    const searchEl = document.getElementById('searchFilter');
    const searchQuery = searchEl ? searchEl.value.toLowerCase() : '';
    
    const checkedBoxes = document.querySelectorAll('.prov-cb:checked');
    const checkedProvinces = Array.from(checkedBoxes).map(cb => cb.value.toLowerCase().trim());

    const filtered = allTrailEvents.filter(event => {
      // 1. Zoekbalk filter
      const titleMatch = event.title ? event.title.toLowerCase().includes(searchQuery) : false;
      const locMatch = event.location ? event.location.toLowerCase().includes(searchQuery) : false;
      if (searchQuery && !titleMatch && !locMatch) return false;

      // 2. Provincie filter
      const rawProv = event.province ? event.province.toLowerCase().trim() : "";
      if (rawProv && rawProv !== "onbekend") {
        if (!checkedProvinces.includes(rawProv)) {
          return false;
        }
      }

      // 3. Afstand v.a. Woonplaats filter
      if (event.lat && event.lon) {
        const distFromUser = calculateDistance(userLat, userLon, event.lat, event.lon);
        event._distFromUser = distFromUser;
        if (distFromUser && distFromUser > maxRadius) {
          return false;
        }
      } else {
        event._distFromUser = null;
      }

      // 4. Maand filter (YYYY-MM)
      if (selectedMonth !== 'all' && (!event.date || !event.date.startsWith(selectedMonth))) {
        return false;
      }

      // 5. Trail Afstand filter
      if (distCategory !== 'all') {
        if (!event.distances || event.distances.length === 0) return false;
        return event.distances.some(d => {
          const match = d.match(/\d+/);
          if (!match) return false;
          const num = parseInt(match[0], 10);
          if (distCategory === 'short') return num < 15;
          if (distCategory === 'medium') return num >= 15 && num < 30;
          if (distCategory === 'long') return num >= 30 && num < 50;
          if (distCategory === 'ultra') return num >= 50;
          return true;
        });
      }

      return true;
    });

    renderEvents(filtered);
  } catch (err) {
    console.error("❌ [FILTER ERROR]:", err);
  }
}

function renderEvents(events) {
  const container = document.getElementById('trailEventsList');
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = '<p style="padding:15px; background:#fff; border:1px solid #ddd; border-radius:8px;">Geen evenementen gevonden voor de geselecteerde filters.</p>';
    sendHeight();
    return;
  }

  const userCityEl = document.getElementById('userLocation');
  const userCity = userCityEl ? userCityEl.value : 'Utrecht';

  container.innerHTML = events.map(e => {
    const city = (e.city && e.city !== "Onbekend") ? e.city : (e.location ? e.location.split(',')[0].trim() : "Onbekend");
    const province = (e.province && e.province !== "Onbekend") ? e.province : "";
    const country = e.country || "Nederland";

    let locationParts = [];
    if (city) locationParts.push(city);
    if (province && !city.toLowerCase().includes(province.toLowerCase())) {
      locationParts.push(province);
    }
    if (country) locationParts.push(country);

    const fullLocationDisplay = locationParts.join(', ');

    const distBadge = (e._distFromUser !== null && e._distFromUser !== undefined) 
      ? `<span class="distance-badge">🚗 ${e._distFromUser} km v.a. ${userCity}</span>` 
      : '';

    const distancesText = e.distances && e.distances.length > 0 
      ? `<span class="trail-event-distances">🏃 ${e.distances.join(', ')}</span>` 
      : '<span style="color:#888; font-size:0.85rem;">Afstand onbekend</span>';

    return `
      <div class="trail-event-card">
        <h3>${e.title}</h3>
        <div class="trail-event-meta">
          📅 <strong>${e.date}</strong> | 📍 ${fullLocationDisplay} ${distBadge}
        </div>
        ${distancesText}
        ${e.link ? `<br><a class="trail-event-link" href="${e.link}" target="_blank" rel="noopener">Bekijk evenement &rarr;</a>` : ''}
      </div>
    `;
  }).join('');

  sendHeight();
}

function populateMonthDropdown() {
  const monthSelect = document.getElementById('monthFilter');
  if (!monthSelect) return;
  
  const now = new Date();
  const dutchMonthNames = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
  for (let i = 0; i < 12; i++) {
    const m = (now.getMonth() + i) % 12;
    const y = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    const opt = document.createElement('option');
    opt.value = `${y}-${String(m + 1).padStart(2, '0')}`;
    opt.textContent = `${dutchMonthNames[m]} ${y}`;
    monthSelect.appendChild(opt);
  }
}