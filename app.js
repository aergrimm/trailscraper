let allTrailEvents = [];
let userLat = 52.0907; // Standaard GPS Utrecht
let userLon = 5.1214;
let allProvincesChecked = true;

const PROVINCES = [
  "Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", 
  "Limburg", "Noord-Brabant", "Noord-Holland", "Overijssel", 
  "Utrecht", "Zeeland", "Zuid-Holland"
];

// Relatieve URL omdat events.json in dezelfde GitHub Pages map staat
const jsonUrl = './events.json';

document.addEventListener('DOMContentLoaded', function() {
  buildProvinceCheckboxes();
  populateMonthDropdown();

  fetch(jsonUrl)
    .then(r => {
      if (!r.ok) throw new Error('Status ' + r.status + ' - JSON niet bereikbaar');
      return r.json();
    })
    .then(data => {
      allTrailEvents = data;
      filterEvents();
    })
    .catch(err => {
      console.error(err);
      document.getElementById('trailEventsList').innerHTML = 
        '<p style="color:red;"><strong>Er ging iets mis bij het ophalen van de kalender.</strong></p>';
    });
});

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

  const maxRadiusEl = document.getElementById('maxRadius');
  const maxRadius = maxRadiusEl ? parseFloat(maxRadiusEl.value) : 9999;

  const selectedMonth = document.getElementById('monthFilter').value;
  const distCategory = document.getElementById('distanceFilter').value;
  const searchQuery = document.getElementById('searchFilter').value.toLowerCase();
  
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
}

function renderEvents(events) {
  const container = document.getElementById('trailEventsList');
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = '<p style="padding:15px; background:#fff; border:1px solid #ddd; border-radius:8px;">Geen evenementen gevonden voor de geselecteerde filters.</p>';
    return;
  }

  const userCityEl = document.getElementById('userLocation');
  const userCity = userCityEl ? userCityEl.value : 'locatie';

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

    const distBadge = e._distFromUser !== null && e._distFromUser !== undefined 
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

// Stuur de exacte hoogte van de pagina naar het parent window (WordPress)
function sendHeight() {
  const height = document.body.scrollHeight;
  window.parent.postMessage({ frameHeight: height }, '*');
}

// Pas deze regel aan in je bestaande renderEvents() functie:
// Voeg sendHeight() toe helemaal aan het einde van renderEvents():
function renderEvents(events) {
  // ... je bestaande render logica ...
  
  // Stuur de nieuwe hoogte door na het renderen van de kaartjes
  setTimeout(sendHeight, 100);
}