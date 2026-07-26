const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSiOWsBI3_PrgpBrwW7N7diNBev_vgmWlawWuIGFj0uaJhA6KWQUb1YKvkHqx6TqAHG43myXARWX_if/pub?gid=0&single=true&output=csv";
const reportUrl = "https://github.com/meep-meep-bit/vannportalen/issues/new";
const fagernes = { lat: 60.9858, lng: 9.2324 };

let map;
let baseTileLayer;
let mapStarted = false;
let locations = [];
let pendingMapAction = null;
let lastFocusedElement = null;
let activeLocationId = null;
let invalidRowCount = 0;
let currentQuery = "";
let tileErrorCount = 0;
let noticeRetryAction = null;

const todayKey = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Oslo"
}).format(new Date());
const completedKey = `completed-${todayKey}`;
const routeKey = `route-${todayKey}`;

let completedToday = readStoredArray(completedKey);
let todaysRoute = readStoredArray(routeKey);

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("btnShowMap").addEventListener("click", showMap);
  document.getElementById("btnRoutePlanner").addEventListener("click", showRoutePlanner);
  document.getElementById("btnNearest").addEventListener("click", handleNearest);
  document.getElementById("btnReport").addEventListener("click", function () {
    showReportDialog();
  });
  document.getElementById("btnAbout").addEventListener("click", showAboutDialog);
  document.getElementById("backButton").addEventListener("click", showHome);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("retryLoadButton").addEventListener("click", function () {
    if (noticeRetryAction) noticeRetryAction();
  });
  document.getElementById("modalOverlay").addEventListener("click", function (event) {
    if (event.target === this) closeModal();
  });
  document.addEventListener("keydown", handleGlobalKeydown);

  resizeMapMobile();
  updateProgressDisplays();
  registerServiceWorker();
});

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
  } catch (error) {
    console.warn(`Kunne ikke lese ${key} fra lokal lagring.`, error);
    return [];
  }
}

function saveStoredArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    showMapNotice("Status kunne ikke lagres på denne enheten.");
    console.warn(`Kunne ikke lagre ${key}.`, error);
  }
}

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;

  Object.entries(options.attributes || {}).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });

  return element;
}

function appendTextElement(parent, tagName, text, className) {
  const element = createElement(tagName, { text, className });
  parent.appendChild(element);
  return element;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nb-NO")
    .trim();
}

function showHome() {
  closePanels();
  closeModal();
  document.getElementById("homeScreen").classList.remove("hidden");
  document.getElementById("mapScreen").classList.add("hidden");
  updateProgressDisplays();
}

function showMap() {
  document.getElementById("homeScreen").classList.add("hidden");
  document.getElementById("mapScreen").classList.remove("hidden");

  setTimeout(function () {
    if (!mapStarted) {
      mapStarted = startMap();
    } else if (map) {
      map.invalidateSize();
    }
  }, 100);
}

function showModal(title, buildContent, opener) {
  lastFocusedElement = opener || document.activeElement;
  const overlay = document.getElementById("modalOverlay");
  const content = document.getElementById("modalContent");

  document.getElementById("modalTitle").textContent = title;
  content.replaceChildren();
  buildContent(content);
  overlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  document.getElementById("homeScreen").inert = true;
  document.getElementById("mapScreen").inert = true;
  setTimeout(function () {
    overlay.querySelector(".modal-card").focus();
  }, 0);
}

function closeModal() {
  const overlay = document.getElementById("modalOverlay");
  if (overlay.classList.contains("hidden")) return;

  overlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  document.getElementById("homeScreen").inert = false;
  document.getElementById("mapScreen").inert = false;

  if (lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  }
}

function handleGlobalKeydown(event) {
  if (event.key === "Tab" && !document.getElementById("modalOverlay").classList.contains("hidden")) {
    keepFocusInModal(event);
    return;
  }

  if (event.key !== "Escape") return;

  if (!document.getElementById("modalOverlay").classList.contains("hidden")) {
    closeModal();
  } else if (document.getElementById("detailsPanel").classList.contains("open")) {
    closeDetailsPanel();
  } else if (document.getElementById("listPanel").classList.contains("open")) {
    closeListPanel();
  }
}

function keepFocusInModal(event) {
  const modal = document.querySelector("#modalOverlay .modal-card");
  const focusable = Array.from(modal.querySelectorAll(
    "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  ));
  if (!focusable.length) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showRoutePlanner() {
  ensureLocationsLoaded(showRoutePlanner);
  if (!locations.length) return;

  showModal("Planlegg dagens rute", function (content) {
    appendTextElement(
      content,
      "p",
      "Velg prøvestedene som skal besøkes. Rekkefølgen følger den faste feltlisten og kan justeres etterpå.",
      "modal-intro"
    );

    const toolbar = createElement("div", { className: "route-toolbar" });
    const selectAll = createElement("button", { text: "Velg alle", type: "button" });
    const selectRemaining = createElement("button", { text: "Velg ikke hentede", type: "button" });
    const clearAll = createElement("button", { text: "Fjern alle", type: "button" });
    toolbar.append(selectAll, selectRemaining, clearAll);
    content.appendChild(toolbar);

    const count = createElement("div", { className: "route-count", attributes: { "aria-live": "polite" } });
    const list = createElement("div", { className: "route-list" });

    locations.forEach(function (location) {
      const isDone = completedToday.includes(location.id);
      const option = createElement("label", {
        className: isDone ? "route-option completed" : "route-option"
      });
      const checkbox = createElement("input", {
        type: "checkbox",
        attributes: { value: location.id }
      });
      checkbox.checked = todaysRoute.length ? todaysRoute.includes(location.id) : !isDone;

      const label = createElement("span");
      appendTextElement(label, "strong", `${location.order}. ${location.name}`);
      appendTextElement(
        label,
        "small",
        isDone ? "Allerede hentet i dag" : (location.row.Adresse || "Adresse ikke oppgitt")
      );
      option.append(checkbox, label);
      list.appendChild(option);
    });

    function routeCheckboxes() {
      return Array.from(list.querySelectorAll("input[type='checkbox']"));
    }

    function updateCount() {
      const selected = routeCheckboxes().filter(box => box.checked).length;
      count.textContent = `${selected} av ${locations.length} steder valgt`;
    }

    selectAll.addEventListener("click", function () {
      routeCheckboxes().forEach(box => { box.checked = true; });
      updateCount();
    });
    selectRemaining.addEventListener("click", function () {
      routeCheckboxes().forEach(box => {
        box.checked = !completedToday.includes(box.value);
      });
      updateCount();
    });
    clearAll.addEventListener("click", function () {
      routeCheckboxes().forEach(box => { box.checked = false; });
      updateCount();
    });
    list.addEventListener("change", updateCount);

    const saveButton = createElement("button", {
      text: "Lag dagens rute",
      type: "button",
      className: "primary-button"
    });
    saveButton.addEventListener("click", function () {
      const selectedIds = routeCheckboxes().filter(box => box.checked).map(box => box.value);
      todaysRoute = locations
        .filter(location => selectedIds.includes(location.id))
        .sort((a, b) => a.order - b.order)
        .map(location => location.id);
      saveStoredArray(routeKey, todaysRoute);
      updateProgressDisplays();
      showRouteOverview();
    });

    content.append(count, list, saveButton);
    updateCount();
  });
}

function showRouteOverview() {
  showModal("Dagens rute", function (content) {
    if (!todaysRoute.length) {
      appendTextElement(content, "div", "Ingen prøvesteder er valgt for dagens rute.", "route-empty");
      const chooseButton = createElement("button", {
        text: "Velg prøvesteder",
        type: "button",
        className: "primary-button"
      });
      chooseButton.addEventListener("click", showRoutePlanner);
      content.appendChild(chooseButton);
      return;
    }

    const routeLocations = todaysRoute
      .map(id => locations.find(location => location.id === id))
      .filter(Boolean);
    const remainingCount = routeLocations.filter(location => !completedToday.includes(location.id)).length;

    appendTextElement(
      content,
      "p",
      `Start i Fagernes, besøk ${routeLocations.length} valgte steder og returner til Fagernes. ${remainingCount} gjenstår.`,
      "modal-intro"
    );

    const suggestionToolbar = createElement("div", { className: "route-toolbar" });
    const fixedOrderButton = createElement("button", {
      text: "Bruk fast feltrekkefølge",
      type: "button"
    });
    const distanceOrderButton = createElement("button", {
      text: "Foreslå etter luftlinje",
      type: "button"
    });
    suggestionToolbar.append(fixedOrderButton, distanceOrderButton);
    content.appendChild(suggestionToolbar);
    appendTextElement(
      content,
      "p",
      "Avstandsforslaget er et enkelt utgangspunkt og tar ikke hensyn til veier eller kjøretid. Rekkefølgen kan justeres med pilene.",
      "form-help"
    );

    const list = createElement("div", { className: "route-list" });

    function renderSteps() {
      list.replaceChildren();
      routeLocations.forEach(function (location, index) {
        const step = createElement("div", { className: "route-step" });
        appendTextElement(step, "span", String(index + 1), "route-step-number");

        const info = createElement("div");
        appendTextElement(info, "strong", location.name);
        appendTextElement(
          info,
          "small",
          completedToday.includes(location.id) ? "✓ Hentet" : (location.row.Adresse || "Ikke hentet")
        );

        const actions = createElement("div", { className: "route-step-actions" });
        const up = createElement("button", {
          text: "↑",
          type: "button",
          className: "route-order-button",
          attributes: { "aria-label": `Flytt ${location.name} opp` }
        });
        const down = createElement("button", {
          text: "↓",
          type: "button",
          className: "route-order-button",
          attributes: { "aria-label": `Flytt ${location.name} ned` }
        });
        up.disabled = index === 0;
        down.disabled = index === routeLocations.length - 1;

        up.addEventListener("click", function () {
          [routeLocations[index - 1], routeLocations[index]] = [routeLocations[index], routeLocations[index - 1]];
          saveRouteOrder();
        });
        down.addEventListener("click", function () {
          [routeLocations[index], routeLocations[index + 1]] = [routeLocations[index + 1], routeLocations[index]];
          saveRouteOrder();
        });

        actions.append(up, down);
        step.append(info, actions);
        list.appendChild(step);
      });
    }

    function saveRouteOrder() {
      todaysRoute = routeLocations.map(location => location.id);
      saveStoredArray(routeKey, todaysRoute);
      renderSteps();
    }

    fixedOrderButton.addEventListener("click", function () {
      routeLocations.sort((a, b) => a.order - b.order);
      saveRouteOrder();
    });
    distanceOrderButton.addEventListener("click", function () {
      const suggested = suggestRouteByDistance(routeLocations);
      routeLocations.splice(0, routeLocations.length, ...suggested);
      saveRouteOrder();
    });

    const buttonRow = createElement("div", { className: "button-row" });
    const editButton = createElement("button", {
      text: "Endre valg",
      type: "button",
      className: "secondary-button"
    });
    const startButton = createElement("button", {
      text: remainingCount ? "Start / fortsett ruten" : "Vis ruten",
      type: "button",
      className: "primary-button"
    });
    editButton.addEventListener("click", showRoutePlanner);
    startButton.addEventListener("click", function () {
      const next = getNextRouteLocation();
      const first = next || routeLocations[0];
      closeModal();
      showLocationOnMap(first);
    });

    renderSteps();
    buttonRow.append(editButton, startButton);
    content.append(list, buttonRow);
  });
}

function suggestRouteByDistance(selectedLocations) {
  const remaining = [...selectedLocations];
  const suggested = [];
  let currentPoint = fagernes;

  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    remaining.forEach(function (location, index) {
      const distance = calculateDistance(currentPoint.lat, currentPoint.lng, location.lat, location.lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    const [next] = remaining.splice(nearestIndex, 1);
    suggested.push(next);
    currentPoint = next;
  }

  return suggested;
}

function showAboutDialog() {
  showModal("Om portalen", function (content) {
    const purpose = createInfoCard(
      "Laget for feltarbeid",
      "Vannportalen hjelper frivillige og feltpersonell med å finne, kjenne igjen og registrere vannprøvesteder i Valdres."
    );
    const storage = createInfoCard(
      "Status på denne enheten",
      "Dagens rute og hentestatus lagres bare lokalt i denne nettleseren. Markeringene synkroniseres ikke mellom telefoner."
    );
    const data = createInfoCard(
      "Oppdaterte prøvesteder",
      "Stedsinformasjonen hentes fra den publiserte feltlisten når appen har nettilgang."
    );
    content.append(purpose, storage, data);
  });
}

function showReportDialog(preselectedLocation) {
  ensureLocationsLoaded(function () {
    showReportDialog(preselectedLocation);
  });
  if (!locations.length) return;

  showModal("Meld inn en endring", function (content) {
    appendTextElement(
      content,
      "p",
      "Beskriv det du oppdaget. Opplysningene åpnes som en ferdig utfylt melding til prosjektansvarlig.",
      "modal-intro"
    );

    const locationGroup = createElement("div", { className: "field-group" });
    const locationLabel = createElement("label", {
      text: "Prøvested",
      attributes: { for: "reportLocation" }
    });
    const locationSelect = createElement("select", {
      attributes: { id: "reportLocation" }
    });
    const noLocationOption = createElement("option", { text: "Generell melding", attributes: { value: "" } });
    locationSelect.appendChild(noLocationOption);
    locations.forEach(function (location) {
      const option = createElement("option", {
        text: `${location.order}. ${location.name}`,
        attributes: { value: location.id }
      });
      if (preselectedLocation && preselectedLocation.id === location.id) option.selected = true;
      locationSelect.appendChild(option);
    });
    locationGroup.append(locationLabel, locationSelect);

    const typeGroup = createElement("div", { className: "field-group" });
    const typeLabel = createElement("label", {
      text: "Hva gjelder endringen?",
      attributes: { for: "reportType" }
    });
    const typeSelect = createElement("select", { attributes: { id: "reportType" } });
    [
      "Feil koordinater",
      "Endret eller vanskelig innkjøring",
      "Endret prøvetakingspunkt",
      "Feil eller manglende bilde",
      "Endret kontaktinformasjon",
      "Stedet er utilgjengelig",
      "Annet"
    ].forEach(function (label) {
      typeSelect.appendChild(createElement("option", { text: label, attributes: { value: label } }));
    });
    typeGroup.append(typeLabel, typeSelect);

    const messageGroup = createElement("div", { className: "field-group" });
    const messageLabel = createElement("label", {
      text: "Hva bør endres?",
      attributes: { for: "reportMessage" }
    });
    const message = createElement("textarea", {
      attributes: {
        id: "reportMessage",
        placeholder: "Skriv kort hva du observerte og hvor."
      }
    });
    messageGroup.append(messageLabel, message);

    appendTextElement(
      content,
      "p",
      "Du sendes til GitHub for å kontrollere og sende meldingen. Bilder kan legges ved der. En Google Form kan kobles til senere uten å endre resten av appen.",
      "form-help"
    );

    const submitButton = createElement("button", {
      text: "Gå videre med meldingen",
      type: "button",
      className: "primary-button"
    });
    submitButton.addEventListener("click", function () {
      if (!message.value.trim()) {
        message.setCustomValidity("Beskriv hva som bør endres.");
        message.reportValidity();
        return;
      }
      message.setCustomValidity("");

      const location = locations.find(item => item.id === locationSelect.value);
      const locationText = location
        ? `${location.id} – ${location.name}`
        : "Generell melding";
      const title = `${typeSelect.value}: ${locationText}`;
      const body = [
        `**Prøvested:** ${locationText}`,
        `**Type endring:** ${typeSelect.value}`,
        "",
        "**Beskrivelse:**",
        message.value.trim(),
        "",
        `**Registrert dato:** ${todayKey}`
      ].join("\n");
      const url = `${reportUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    });

    content.append(locationGroup, typeGroup, messageGroup, submitButton);
    setTimeout(function () {
      locationSelect.focus();
    }, 0);
  });
}

function handleNearest() {
  ensureLocationsLoaded(handleNearest);
  if (!locations.length) return;

  if (!navigator.geolocation) {
    showSimpleMessage("Finn nærmeste", "Denne nettleseren støtter ikke posisjonsdeling.");
    return;
  }

  showModal("Finn nærmeste", function (content) {
    appendTextElement(content, "p", "Henter posisjonen din…", "modal-intro");
  });

  navigator.geolocation.getCurrentPosition(function (position) {
    const uncompleted = locations.filter(location => !completedToday.includes(location.id));
    const candidates = uncompleted.length ? uncompleted : locations;
    const nearest = findNearestLocation(
      position.coords.latitude,
      position.coords.longitude,
      candidates
    );

    if (!nearest) {
      showSimpleMessage("Finn nærmeste", "Ingen prøvesteder kunne bestemmes.");
      return;
    }

    showModal("Nærmeste prøvested", function (content) {
      const card = createElement("div", { className: "detail-card" });
      appendTextElement(card, "strong", nearest.name);
      appendTextElement(card, "div", nearest.row.Adresse || "Adresse ikke oppgitt");
      appendTextElement(card, "div", `Ca. ${formatDistance(nearest.distanceKm)} km i luftlinje`);
      if (!uncompleted.length) {
        appendTextElement(card, "div", "Alle prøvesteder er allerede markert som hentet i dag.");
      }

      const buttons = createElement("div", { className: "button-row" });
      const showButton = createElement("button", {
        text: "Vis detaljer",
        type: "button",
        className: "secondary-button"
      });
      const navigate = createElement("a", {
        text: "Naviger hit",
        className: "primary-button",
        attributes: {
          href: getNavigationUrl(nearest),
          target: "_blank",
          rel: "noopener noreferrer"
        }
      });
      showButton.addEventListener("click", function () {
        closeModal();
        showLocationOnMap(nearest);
      });
      buttons.append(showButton, navigate);
      content.append(card, buttons);
    });
  }, function (error) {
    const message = error.code === error.PERMISSION_DENIED
      ? "Posisjonstilgang ble ikke tillatt. Du kan fortsatt finne stedet i kartet eller listen."
      : "Posisjonen kunne ikke hentes. Kontroller dekning og prøv igjen.";
    showSimpleMessage("Fant ikke posisjonen", message);
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 60000
  });
}

function calculateDistance(userLat, userLng, targetLat, targetLng) {
  const toRad = value => (value * Math.PI) / 180;
  const dLat = toRad(targetLat - userLat);
  const dLng = toRad(targetLng - userLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(userLat)) * Math.cos(toRad(targetLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function findNearestLocation(userLat, userLng, candidates = locations) {
  let nearest = null;

  candidates.forEach(function (location) {
    const distanceKm = calculateDistance(userLat, userLng, location.lat, location.lng);
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { ...location, distanceKm };
    }
  });

  return nearest;
}

function formatDistance(distanceKm) {
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: distanceKm < 10 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(distanceKm);
}

function ensureLocationsLoaded(action) {
  if (locations.length) return;
  pendingMapAction = action;
  showMap();
}

function startMap() {
  if (typeof L === "undefined") {
    showMapNotice(
      "Kartbiblioteket kunne ikke lastes. Kontroller nettilgangen.",
      true,
      function () { window.location.reload(); }
    );
    return false;
  }

  map = L.map("map", { zoomControl: true }).setView([60.92, 9.41], 11);

  setupMapButtons();
  loadLocations();
  return true;
}

function ensureBaseTileLayer() {
  if (baseTileLayer) return;

  baseTileLayer = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
    maxZoom: 19,
    attribution: "&copy; Kartverket"
  });

  baseTileLayer.on("loading", function () {
    tileErrorCount = 0;
    setLoadingStatus("Laster kart…");
    document.getElementById("map").setAttribute("aria-busy", "true");
  });

  baseTileLayer.on("tileerror", function () {
    tileErrorCount += 1;
  });

  baseTileLayer.on("load", function () {
    document.getElementById("map").setAttribute("aria-busy", "false");
    setLoadingStatus(locations.length ? `${locations.length} prøvesteder` : "Kart klart");

    if (tileErrorCount > 0) {
      const countText = tileErrorCount === 1 ? "Én kartflis" : `${tileErrorCount} kartfliser`;
      showMapNotice(`${countText} kunne ikke lastes. Kontroller dekningen og prøv igjen.`, true, retryMapTiles);
    }
  });

  baseTileLayer.addTo(map);
}

function retryMapTiles() {
  if (!baseTileLayer) return;
  hideMapNotice();
  setLoadingStatus("Prøver kartet igjen…");
  baseTileLayer.redraw();
}

function setupMapButtons() {
  document.getElementById("searchInput").addEventListener("input", function (event) {
    currentQuery = normalizeText(event.target.value);
    applyLocationFilters();
  });
  document.getElementById("hideCompleted").addEventListener("change", renderLocationList);
  document.getElementById("openList").addEventListener("click", openListPanel);
  document.getElementById("closeList").addEventListener("click", closeListPanel);
  document.getElementById("closePanel").addEventListener("click", closeDetailsPanel);
}

function loadLocations() {
  setLoadingStatus("Laster prøvesteder…");
  hideMapNotice();

  if (typeof Papa === "undefined") {
    handleLoadError("Databiblioteket kunne ikke lastes.");
    return;
  }

  Papa.parse(csvUrl, {
    download: true,
    header: true,
    skipEmptyLines: "greedy",
    complete: function (results) {
      const requiredFields = ["ID", "Navn", "Latitude", "Longitude"];
      const fields = results.meta && results.meta.fields ? results.meta.fields : [];
      const missingFields = requiredFields.filter(field => !fields.includes(field));

      if (missingFields.length) {
        handleLoadError(`Feltlisten mangler kolonnene: ${missingFields.join(", ")}.`);
        return;
      }

      clearLocationMarkers();
      invalidRowCount = 0;

      results.data.forEach(function (row) {
        const lat = Number.parseFloat(String(row.Latitude || "").replace(",", "."));
        const lng = Number.parseFloat(String(row.Longitude || "").replace(",", "."));

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          invalidRowCount += 1;
          return;
        }

        const order = Number.parseInt(row.Rekkefølge, 10) || locations.length + 1;
        const name = String(row.Navn || "Ukjent sted").trim();
        const id = String(row.ID || name).trim();
        const location = {
          id,
          order,
          name,
          lat,
          lng,
          row,
          marker: null,
          searchText: normalizeText([
            id,
            name,
            row.Adresse,
            row.Beskrivelse,
            row.Innkjøring,
            row.Kontaktperson,
            row.Prøvetype
          ].join(" "))
        };

        location.marker = L.marker([lat, lng], {
          icon: createNumberIcon(location)
        }).addTo(map);
        location.marker.on("click", function () {
          showDetails(location);
        });
        locations.push(location);
      });

      locations.sort((a, b) => a.order - b.order);
      todaysRoute = todaysRoute.filter(id => locations.some(location => location.id === id));
      completedToday = completedToday.filter(id => locations.some(location => location.id === id));
      saveStoredArray(routeKey, todaysRoute);
      saveStoredArray(completedKey, completedToday);

      if (!locations.length) {
        handleLoadError("Ingen prøvesteder med gyldige koordinater ble funnet.");
        return;
      }

      const group = L.featureGroup(locations.map(item => item.marker));
      map.fitBounds(group.getBounds().pad(0.18), { maxZoom: 14 });
      ensureBaseTileLayer();

      if (!baseTileLayer.isLoading()) {
        setLoadingStatus(`${locations.length} prøvesteder`);
      }
      if (invalidRowCount) {
        showMapNotice(`${invalidRowCount} rad${invalidRowCount === 1 ? "" : "er"} uten gyldige koordinater ble hoppet over.`);
      }
      applyLocationFilters();
      updateProgressDisplays();
      map.invalidateSize();

      if (pendingMapAction) {
        const action = pendingMapAction;
        pendingMapAction = null;
        action();
      }
    },
    error: function (error) {
      console.error("Kunne ikke laste prøvesteder.", error);
      handleLoadError("Prøvestedene kunne ikke lastes. Kontroller nettilgangen.");
    }
  });
}

function clearLocationMarkers() {
  locations.forEach(function (location) {
    if (map && location.marker && map.hasLayer(location.marker)) {
      map.removeLayer(location.marker);
    }
  });
  locations = [];
}

function handleLoadError(message) {
  ensureBaseTileLayer();
  setLoadingStatus("Kunne ikke laste steder");
  showMapNotice(message, true, loadLocations);
  pendingMapAction = null;
  renderLocationList();
  updateProgressDisplays();
}

function setLoadingStatus(message) {
  document.getElementById("status").textContent = message;
}

function showMapNotice(message, allowRetry = false, retryAction = null) {
  noticeRetryAction = allowRetry ? retryAction : null;
  document.getElementById("mapNoticeText").textContent = message;
  document.getElementById("retryLoadButton").classList.toggle("hidden", !allowRetry);
  document.getElementById("mapNotice").classList.remove("hidden");
}

function hideMapNotice() {
  noticeRetryAction = null;
  document.getElementById("mapNotice").classList.add("hidden");
}

function createNumberIcon(location) {
  const isDone = completedToday.includes(location.id);
  return L.divIcon({
    className: isDone ? "number-marker completed" : "number-marker",
    html: `<div><span>${isDone ? "✓" : location.order}</span></div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 42]
  });
}

function applyLocationFilters() {
  locations.forEach(function (location) {
    const matches = !currentQuery || location.searchText.includes(currentQuery);
    if (matches && !map.hasLayer(location.marker)) location.marker.addTo(map);
    if (!matches && map.hasLayer(location.marker)) map.removeLayer(location.marker);
  });
  renderLocationList();
}

function renderLocationList() {
  const list = document.getElementById("locationList");
  const hideCompleted = document.getElementById("hideCompleted").checked;
  const visibleLocations = locations.filter(function (location) {
    const matchesSearch = !currentQuery || location.searchText.includes(currentQuery);
    const matchesStatus = !hideCompleted || !completedToday.includes(location.id);
    return matchesSearch && matchesStatus;
  });

  list.replaceChildren();
  if (!visibleLocations.length) {
    appendTextElement(
      list,
      "div",
      locations.length ? "Ingen prøvesteder passer med søket eller filteret." : "Ingen prøvesteder er lastet.",
      "empty-state"
    );
  }

  visibleLocations.forEach(function (location) {
    const isDone = completedToday.includes(location.id);
    const item = createElement("button", {
      type: "button",
      className: isDone ? "location-item completed" : "location-item"
    });
    const heading = createElement("div", { className: "location-heading" });
    appendTextElement(heading, "strong", `${location.order}. ${location.name}`);
    appendTextElement(heading, "span", isDone ? "✓ Hentet" : "Ikke hentet", `status-badge${isDone ? " done" : ""}`);
    item.appendChild(heading);
    appendTextElement(
      item,
      "span",
      location.row.Adresse || location.row.Beskrivelse || "Ingen adresse oppgitt",
      "location-address"
    );
    item.addEventListener("click", function () {
      showLocationOnMap(location);
      closeListPanel();
    });
    list.appendChild(item);
  });

  updateProgressDisplays();
}

function showDetails(location) {
  activeLocationId = location.id;
  const panel = document.getElementById("detailsPanel");
  const content = document.getElementById("detailsContent");
  const row = location.row;
  const images = [row["Bilde 1"], row["Bilde 2"]]
    .map(value => String(value || "").trim())
    .filter(Boolean);

  content.replaceChildren();
  const title = appendTextElement(content, "h2", `${location.order}. ${location.name}`, "detail-title");
  title.id = "detailsTitle";
  appendTextElement(content, "div", row.Adresse || "Adresse ikke registrert", "detail-address");

  if (images.length) {
    const image = createElement("img", {
      className: "detail-photo",
      attributes: {
        src: images[0],
        alt: `Bilde av prøvestedet ${location.name}`,
        id: "mainPhoto",
        loading: "lazy",
        decoding: "async",
        referrerpolicy: "no-referrer"
      }
    });
    content.appendChild(image);

    if (images.length > 1) {
      const buttons = createElement("div", { className: "photo-buttons" });
      images.forEach(function (url, index) {
        const button = createElement("button", {
          text: `Bilde ${index + 1}`,
          type: "button",
          className: index === 0 ? "active" : ""
        });
        button.addEventListener("click", function () {
          image.src = url;
          buttons.querySelectorAll("button").forEach(item => item.classList.remove("active"));
          button.classList.add("active");
        });
        buttons.appendChild(button);
      });
      content.appendChild(buttons);
    }
  } else {
    appendTextElement(content, "div", "Ingen bilder er lagt inn ennå.", "no-photo");
  }

  if (row.Innkjøring) content.appendChild(createInfoCard("Innkjøring", row.Innkjøring));
  if (row.Beskrivelse) content.appendChild(createInfoCard("Prøvested", row.Beskrivelse));

  const actions = createElement("div", { className: "detail-actions" });
  const navigate = createElement("a", {
    text: "Naviger hit",
    className: "nav-btn",
    attributes: {
      href: getNavigationUrl(location),
      target: "_blank",
      rel: "noopener noreferrer"
    }
  });
  const report = createElement("button", {
    text: "Meld endring",
    type: "button",
    className: "secondary-button"
  });
  report.addEventListener("click", function () {
    showReportDialog(location);
  });
  actions.append(navigate, report);
  content.appendChild(actions);

  const visitCard = createElement("div", { className: "visit-card" });
  const visitInfo = createElement("div");
  appendTextElement(visitInfo, "div", "Dagens status", "visit-label");
  const visitStatus = appendTextElement(visitInfo, "div", "", "visit-status");
  visitStatus.id = "visitStatus";
  const doneButton = createElement("button", {
    type: "button",
    className: "done-btn",
    attributes: { id: "doneButton" }
  });
  doneButton.addEventListener("click", function () {
    toggleCompleted(location.id);
  });
  visitCard.append(visitInfo, doneButton);
  content.appendChild(visitCard);

  const next = getNextRouteLocation(location.id);
  if (next) {
    const nextCard = createElement("div", { className: "next-stop-card" });
    appendTextElement(nextCard, "small", "Neste stopp på dagens rute");
    appendTextElement(nextCard, "strong", `${next.order}. ${next.name}`);
    const nextButton = createElement("button", { text: "Vis neste stopp", type: "button" });
    nextButton.addEventListener("click", function () {
      showLocationOnMap(next);
    });
    nextCard.appendChild(nextButton);
    content.appendChild(nextCard);
  }

  const extraFields = [
    ["ID", location.id],
    ["Prøvetype", row.Prøvetype],
    ["Kontaktperson", row.Kontaktperson],
    ["Telefon", row.Telefon],
    ["Kommentar", row.Kommentar]
  ].filter(([, value]) => String(value || "").trim());

  if (extraFields.length) {
    const details = createElement("details", { className: "more-info" });
    appendTextElement(details, "summary", "Mer informasjon");
    extraFields.forEach(function ([label, value]) {
      const card = createElement("div", { className: "detail-card" });
      appendTextElement(card, "strong", label);
      if (label === "Telefon") {
        const phone = String(value).replace(/[^\d+]/g, "");
        const link = createElement("a", {
          text: String(value),
          attributes: { href: `tel:${phone}` }
        });
        card.appendChild(link);
      } else {
        appendTextElement(card, "div", String(value));
      }
      details.appendChild(card);
    });
    content.appendChild(details);
  }

  updateCompletedDisplay(location.id);
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  panel.scrollTop = 0;
  setTimeout(function () {
    document.getElementById("closePanel").focus();
  }, 0);
}

function createInfoCard(title, text) {
  const card = createElement("div", { className: "detail-card" });
  appendTextElement(card, "strong", title);
  appendTextElement(card, "div", String(text));
  return card;
}

function toggleCompleted(id) {
  if (completedToday.includes(id)) {
    completedToday = completedToday.filter(item => item !== id);
  } else {
    completedToday.push(id);
  }

  saveStoredArray(completedKey, completedToday);
  updateCompletedDisplay(id);
  renderLocationList();
  updateProgressDisplays();

  if (activeLocationId === id) {
    const location = locations.find(item => item.id === id);
    const existingNextCard = document.querySelector(".next-stop-card");
    const next = getNextRouteLocation(id);
    if (!existingNextCard && next && location) {
      showDetails(location);
    }
  }
}

function updateCompletedDisplay(id) {
  const location = locations.find(item => item.id === id);
  if (!location) return;

  const isDone = completedToday.includes(id);
  location.marker.setIcon(createNumberIcon(location));

  if (activeLocationId !== id) return;
  const status = document.getElementById("visitStatus");
  const button = document.getElementById("doneButton");

  if (status) {
    status.textContent = isDone ? "Prøve hentet" : "Prøve ikke hentet";
    status.className = isDone ? "visit-status done" : "visit-status";
  }
  if (button) {
    button.textContent = isDone ? "Angre hentestatus" : "Marker som hentet";
    button.className = isDone ? "done-btn undo" : "done-btn";
  }
}

function updateProgressDisplays() {
  const relevantLocations = todaysRoute.length
    ? todaysRoute.map(id => locations.find(location => location.id === id)).filter(Boolean)
    : locations;
  const total = relevantLocations.length;
  const done = relevantLocations.filter(location => completedToday.includes(location.id)).length;
  const percentage = total ? Math.round((done / total) * 100) : 0;
  const homeText = document.getElementById("homeProgressText");
  const homeBar = document.getElementById("homeProgressBar");
  const listProgress = document.getElementById("listProgress");

  if (homeText) {
    if (!locations.length) {
      homeText.textContent = "Åpne kartet for å laste prøvesteder";
    } else if (todaysRoute.length) {
      homeText.textContent = `${done} av ${total} på dagens rute hentet`;
    } else {
      homeText.textContent = `${done} av ${total} prøvesteder hentet`;
    }
  }
  if (homeBar) homeBar.style.width = `${percentage}%`;
  if (listProgress) {
    listProgress.textContent = total
      ? `${done} av ${total} ${todaysRoute.length ? "på dagens rute" : "prøver"} hentet`
      : "Ingen steder lastet";
  }
}

function getNextRouteLocation(afterId) {
  const routeLocations = todaysRoute
    .map(id => locations.find(location => location.id === id))
    .filter(Boolean);
  if (!routeLocations.length) return null;

  const afterIndex = afterId ? routeLocations.findIndex(location => location.id === afterId) : -1;
  const ordered = afterIndex >= 0
    ? [...routeLocations.slice(afterIndex + 1), ...routeLocations.slice(0, afterIndex + 1)]
    : routeLocations;
  return ordered.find(location => !completedToday.includes(location.id)) || null;
}

function getNavigationUrl(location) {
  return `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
}

function showLocationOnMap(location) {
  showMap();
  setTimeout(function () {
    if (!map) return;
    map.setView([location.lat, location.lng], 16);
    showDetails(location);
  }, 180);
}

function openListPanel() {
  closeDetailsPanel();
  const panel = document.getElementById("listPanel");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  setTimeout(function () {
    document.getElementById("closeList").focus();
  }, 0);
}

function closeListPanel() {
  const panel = document.getElementById("listPanel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
}

function closeDetailsPanel() {
  const panel = document.getElementById("detailsPanel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  activeLocationId = null;
}

function closePanels() {
  closeListPanel();
  closeDetailsPanel();
}

function showSimpleMessage(title, message) {
  showModal(title, function (content) {
    appendTextElement(content, "p", message, "modal-intro");
  });
}

function resizeMapMobile() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;
  mapElement.style.height = `${window.innerHeight}px`;
  if (map) setTimeout(() => map.invalidateSize(), 100);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./service-worker.js").catch(function (error) {
      console.warn("Offline-støtte kunne ikke aktiveres.", error);
    });
  });
}

window.addEventListener("resize", resizeMapMobile);
window.addEventListener("orientationchange", resizeMapMobile);
