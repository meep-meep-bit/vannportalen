const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSiOWsBI3_PrgpBrwW7N7diNBev_vgmWlawWuIGFj0uaJhA6KWQUb1YKvkHqx6TqAHG43myXARWX_if/pub?gid=0&single=true&output=csv";

let map;
let mapStarted = false;
let locations = [];

const todayKey = new Date().toISOString().slice(0, 10);
const completedKey = `completed-${todayKey}`;
let completedToday = JSON.parse(localStorage.getItem(completedKey) || "[]");

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("btnShowMap").addEventListener("click", showMap);
  document.getElementById("btnRoutePlanner").addEventListener("click", () => alert("Ruteplanlegger kommer i neste versjon."));
  document.getElementById("btnNearest").addEventListener("click", () => alert("Finn nærmeste prøvested kommer i neste versjon."));
  document.getElementById("btnReport").addEventListener("click", () => alert("Meld inn endringer kommer i neste versjon."));
  document.getElementById("btnAbout").addEventListener("click", () => alert("Vannportalen Valdres er en enkel feltapp for oversikt over vannprøvesteder."));
  document.getElementById("backButton").addEventListener("click", showHome);
});

function showHome() {
  document.getElementById("homeScreen").classList.remove("hidden");
  document.getElementById("mapScreen").classList.add("hidden");
}

function showMap() {
  document.getElementById("homeScreen").classList.add("hidden");
  document.getElementById("mapScreen").classList.remove("hidden");

  setTimeout(() => {
    if (!mapStarted) {
      startMap();
      mapStarted = true;
    } else {
      map.invalidateSize();
    }
  }, 200);
}

function startMap() {
  map = L.map("map").setView([60.92, 9.41], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  setupMapButtons();
  loadLocations();
}

function setupMapButtons() {
  document.getElementById("searchInput").addEventListener("input", function(e) {
    const query = e.target.value.toLowerCase();

    locations.forEach(item => {
      const text = item.searchText.toLowerCase();

      if (text.includes(query)) {
        if (!map.hasLayer(item.marker)) item.marker.addTo(map);
      } else {
        if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
      }
    });
  });

  document.getElementById("openList").addEventListener("click", function() {
    document.getElementById("listPanel").classList.add("open");
  });

  document.getElementById("closeList").addEventListener("click", function() {
    document.getElementById("listPanel").classList.remove("open");
  });

  document.getElementById("closePanel").addEventListener("click", function() {
    document.getElementById("detailsPanel").classList.remove("open");
  });
}

function loadLocations() {
  document.getElementById("status").textContent = "Laster prøvesteder...";

  Papa.parse(csvUrl, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      locations = [];

      results.data.forEach(row => {
        const lat = parseFloat((row.Latitude || "").replace(",", "."));
        const lng = parseFloat((row.Longitude || "").replace(",", "."));

        if (isNaN(lat) || isNaN(lng)) return;

        const order = parseInt(row.Rekkefølge) || locations.length + 1;
        const name = row.Navn || "Ukjent sted";
        const id = row.ID || name;

        const marker = L.marker([lat, lng], {
          icon: createNumberIcon(completedToday.includes(id) ? "✓" : order)
        }).addTo(map);

        const location = {
          id,
          order,
          name,
          lat,
          lng,
          row,
          marker,
          searchText: `${id} ${name} ${row.Adresse || ""} ${row.Beskrivelse || ""} ${row.Innkjøring || ""} ${row.Kontaktperson || ""}`
        };

        marker.on("click", function() {
          showDetails(location);
        });

        locations.push(location);
      });

      locations.sort((a, b) => a.order - b.order);

      document.getElementById("status").textContent = `${locations.length} prøvesteder`;

      if (locations.length > 0) {
        const group = L.featureGroup(locations.map(item => item.marker));
        map.fitBounds(group.getBounds().pad(0.2));
      }

      renderLocationList();
      map.invalidateSize();
    }
  });
}

function createNumberIcon(number) {
  return L.divIcon({
    className: "number-marker",
    html: `<div>${number}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function showDetails(location) {
  const row = location.row;
  const panel = document.getElementById("detailsPanel");
  const content = document.getElementById("detailsContent");

  const bilde1 = (row["Bilde 1"] || "").trim();
  const bilde2 = (row["Bilde 2"] || "").trim();
  const hovedbilde = bilde1 || bilde2;

  content.innerHTML = `
    <h2 class="detail-title">${location.order}. ${location.name}</h2>
    <div class="detail-address">${row.Adresse || "Adresse ikke registrert"}</div>

    ${hovedbilde ? `
      <img id="mainPhoto" class="detail-photo" src="${hovedbilde}" alt="Bilde av prøvested" referrerpolicy="no-referrer">
    ` : `
      <div class="no-photo">Ingen bilder lagt inn ennå</div>
    `}

    ${(bilde1 || bilde2) ? `
      <div class="photo-buttons">
        ${bilde1 ? `<button onclick="setMainPhoto('${bilde1}')">Bilde 1</button>` : ""}
        ${bilde2 ? `<button onclick="setMainPhoto('${bilde2}')">Bilde 2</button>` : ""}
      </div>
    ` : ""}

    <div class="detail-card">
      <strong>Beskrivelse</strong>
      <div>${row.Beskrivelse || ""}</div>
    </div>

    <div class="detail-card">
      <strong>Innkjøring</strong>
      <div>${row.Innkjøring || ""}</div>
    </div>

    <a class="nav-btn" target="_blank" href="https://www.google.com/maps?q=${location.lat},${location.lng}">
      Naviger hit
    </a>

    <div class="visit-card">
      <div>
        <div class="visit-label">Dagens status</div>
        <div id="visitStatus" class="visit-status"></div>
      </div>
      <button type="button" id="doneButton" class="done-btn" onclick="toggleCompleted('${location.id}')"></button>
    </div>

    <details class="more-info">
      <summary>Mer informasjon</summary>

      <div class="detail-card">
        <strong>ID</strong>
        <div>${location.id}</div>
      </div>

      <div class="detail-card">
        <strong>Prøvetype</strong>
        <div>${row.Prøvetype || ""}</div>
      </div>

      <div class="detail-card">
        <strong>Kontakt</strong>
        <div>${row.Kontaktperson || ""}</div>
        <div>${row.Telefon || ""}</div>
      </div>

      <div class="detail-card">
        <strong>Kommentar</strong>
        <div>${row.Kommentar || ""}</div>
      </div>
    </details>
  `;

  updateCompletedDisplay(location.id);
  panel.classList.add("open");
}

function setMainPhoto(url) {
  const img = document.getElementById("mainPhoto");
  if (img) img.src = url;
}

function toggleCompleted(id) {
  if (completedToday.includes(id)) {
    completedToday = completedToday.filter(item => item !== id);
  } else {
    completedToday.push(id);
  }

  localStorage.setItem(completedKey, JSON.stringify(completedToday));
  updateCompletedDisplay(id);
  renderLocationList();
}

function updateCompletedDisplay(id) {
  const location = locations.find(item => item.id === id);
  if (!location) return;

  const isDone = completedToday.includes(id);

  location.marker.setIcon(createNumberIcon(isDone ? "✓" : location.order));

  const status = document.getElementById("visitStatus");
  const button = document.getElementById("doneButton");

  if (status) {
    status.textContent = isDone ? "Prøve hentet" : "Prøve ikke hentet";
    status.className = isDone ? "visit-status done" : "visit-status";
  }

  if (button) {
    button.textContent = isDone ? "Fjern markering" : "Marker prøve som hentet";
    button.className = isDone ? "done-btn undo" : "done-btn";
  }
}

function renderLocationList() {
  const list = document.getElementById("locationList");
  list.innerHTML = "";

  locations.forEach(location => {
    const isDone = completedToday.includes(location.id);

    const item = document.createElement("div");
    item.className = isDone ? "location-item completed" : "location-item";

    item.innerHTML = `
      <div>
        <strong>${location.order}. ${location.name}</strong>
        <span>${location.row.Adresse || location.row.Beskrivelse || ""}</span>
      </div>
      <div class="list-status">${isDone ? "✓ Hentet" : "Ikke hentet"}</div>
    `;

    item.addEventListener("click", function() {
      map.setView([location.lat, location.lng], 16);
      showDetails(location);
      document.getElementById("listPanel").classList.remove("open");
    });

    list.appendChild(item);
  });
}

function resizeMapMobile() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  mapElement.style.height = window.innerHeight + "px";

  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

window.addEventListener("resize", resizeMapMobile);
window.addEventListener("orientationchange", resizeMapMobile);