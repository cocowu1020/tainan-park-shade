const DATA = {
  parks: "data/parks.geojson",
  villages: "data/villages.geojson",
  trees: "data/trees_ge2m.geojson",
  buildings: "data/buildings.geojson",
  shadow: (hour) => `data/shadows_${hour}.geojson`,
};

const palettes = {
  heat_risk: ["#1a9850", "#91cf60", "#fee08b", "#fc8d59", "#d73027"],
  comb_pct: ["#f7fcf0", "#ccebc5", "#7bccc4", "#2b8cbe", "#084081"],
  income: ["#ffffcc", "#c2e699", "#78c679", "#31a354", "#006837"],
  population: ["#fff5eb", "#fdd0a2", "#fdae6b", "#e6550d", "#a63603"],
};

const state = {
  metric: "heat_risk",
  parksData: null,
  parksLayer: null,
  villagesData: null,
  villagesLayer: null,
  treesLayer: null,
  buildingsLayer: null,
  shadowLayers: new Map(),
  currentShadowLayer: null,
  parkLayersById: new Map(),
};

const map = L.map("map", {
  preferCanvas: true,
  zoomControl: false,
  minZoom: 8,
}).setView([23.0, 120.22], 11);

L.control.zoom({ position: "bottomright" }).addTo(map);

const street = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Tiles © Esri; data providers listed by Esri",
  },
).addTo(map);

const imagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Imagery © Esri and contributors",
  },
);

L.control.layers(
  { "Esri streets": street, "Esri imagery": imagery },
  {},
  { position: "topright", collapsed: true },
).addTo(map);

map.createPane("villages");
map.getPane("villages").style.zIndex = 360;
map.createPane("shadows");
map.getPane("shadows").style.zIndex = 430;
map.createPane("trees");
map.getPane("trees").style.zIndex = 490;
map.createPane("buildings");
map.getPane("buildings").style.zIndex = 450;
map.createPane("parks");
map.getPane("parks").style.zIndex = 400;

const statusElement = document.getElementById("loading-status");
const legendElement = document.getElementById("legend");
const parkSearch = document.getElementById("park-search");

function setStatus(message) {
  if (!message) {
    statusElement.classList.add("hidden");
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.remove("hidden");
}

async function fetchGeoJSON(path, label) {
  setStatus(`Loading ${label}…`);
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${label} could not be loaded (${response.status}).`);
  const data = await response.json();
  setStatus("");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "—";
}

function classColor(classValue, palette) {
  const index = Math.max(0, Math.min(4, Number(classValue) - 1));
  return palette[index];
}

function parkClass(properties) {
  if (state.metric === "heat_risk") return Number(properties.risk_class);
  const shade = Number(properties.comb_pct);
  if (shade <= 20) return 1;
  if (shade <= 40) return 2;
  if (shade <= 60) return 3;
  if (shade <= 80) return 4;
  return 5;
}

function parkStyle(feature) {
  return {
    pane: "parks",
    color: "#27434d",
    weight: 1,
    opacity: 0.9,
    fillColor: classColor(parkClass(feature.properties), palettes[state.metric]),
    fillOpacity: 0.72,
  };
}

function parkPopup(properties) {
  return `
    <div class="popup-title">${escapeHtml(properties.park_name)}</div>
    <div class="popup-grid">
      <span>Heat risk</span><strong>${number(properties.heat_risk)}%</strong>
      <span>Combined shade</span><strong>${number(properties.comb_pct)}%</strong>
      <span>Tree coverage</span><strong>${number(properties.tree_pct)}%</strong>
      <span>Building shadow</span><strong>${number(properties.bldg_pct)}%</strong>
      <span>Heat-risk rank</span><strong>${number(properties.heat_rank, 0)}</strong>
      <span>Village</span><strong>${escapeHtml(properties.district)} ${escapeHtml(properties.village)}</strong>
      <span>Median income</span><strong>${number(properties.med_inc_k, 0)} thousand NTD</strong>
      <span>Population age 0–12</span><strong>${number(properties.pop_0_12, 0)}</strong>
    </div>`;
}

function updateParkStyle() {
  if (!state.parksLayer) return;
  state.parksLayer.setStyle(parkStyle);
  renderLegend();
}

function renderLegend() {
  const isRisk = state.metric === "heat_risk";
  const title = isRisk ? "Park heat risk (%)" : "Combined shade (%)";
  const labels = ["Lowest", "Low", "Middle", "High", "Highest"];
  const palette = palettes[state.metric];
  legendElement.innerHTML = `
    <div class="legend-title">${title}</div>
    ${labels.map((label, index) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${palette[index]}"></span>
        <span>${label}</span>
      </div>`).join("")}`;
}

function populateParkControls(features) {
  const ordered = [...features].sort((a, b) =>
    String(a.properties.park_name).localeCompare(String(b.properties.park_name), "zh-Hant"),
  );
  const fragment = document.createDocumentFragment();
  ordered.forEach((feature) => {
    const option = document.createElement("option");
    option.value = feature.properties.park_id;
    option.textContent = feature.properties.park_name;
    fragment.append(option);
  });
  parkSearch.append(fragment);

  const ranked = [...features]
    .sort((a, b) => Number(a.properties.heat_rank) - Number(b.properties.heat_rank))
    .slice(0, 15);
  document.getElementById("ranking-list").innerHTML = ranked.map((feature) => `
    <li>
      <button type="button" data-park-id="${feature.properties.park_id}">
        <span class="rank-number">${feature.properties.heat_rank}</span>
        <span class="rank-name">${escapeHtml(feature.properties.park_name)}</span>
        <span class="rank-value">${number(feature.properties.heat_risk, 0)}</span>
      </button>
    </li>`).join("");
}

function zoomToPark(parkId) {
  const layer = state.parkLayersById.get(String(parkId));
  if (!layer) return;
  map.fitBounds(layer.getBounds(), { padding: [45, 45], maxZoom: 18 });
  layer.openPopup();
  if (window.innerWidth <= 760) togglePanel(false);
}

async function loadParks() {
  state.parksData = await fetchGeoJSON(DATA.parks, "parks");
  state.parksLayer = L.geoJSON(state.parksData, {
    pane: "parks",
    style: parkStyle,
    onEachFeature(feature, layer) {
      const id = String(feature.properties.park_id);
      state.parkLayersById.set(id, layer);
      layer.bindPopup(parkPopup(feature.properties), { maxWidth: 340 });
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2.5, color: "#ffffff" }),
        mouseout: () => state.parksLayer.resetStyle(layer),
      });
    },
  }).addTo(map);
  populateParkControls(state.parksData.features);
  renderLegend();

  const home = state.parksData.features.find((feature) => feature.properties.park_name === "臺南公園");
  if (home) zoomToPark(home.properties.park_id);
  else map.fitBounds(state.parksLayer.getBounds(), { padding: [25, 25] });
}

async function updateVillageLayer(mode) {
  if (state.villagesLayer) {
    map.removeLayer(state.villagesLayer);
    state.villagesLayer = null;
  }
  if (mode === "none") return;
  if (!state.villagesData) state.villagesData = await fetchGeoJSON(DATA.villages, "villages");

  const classField = mode === "income" ? "inc_class" : "pop_class";
  const valueField = mode === "income" ? "med_inc_k" : "pop_0_12";
  const label = mode === "income" ? "Median income (thousand NTD)" : "Population age 0–12";
  state.villagesLayer = L.geoJSON(state.villagesData, {
    pane: "villages",
    style: (feature) => ({
      color: "#55656b",
      weight: 0.65,
      opacity: 0.75,
      fillColor: classColor(feature.properties[classField], palettes[mode]),
      fillOpacity: 0.48,
    }),
    onEachFeature(feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <div class="popup-title">${escapeHtml(p.district)} ${escapeHtml(p.village)}</div>
        <div class="popup-grid">
          <span>${label}</span><strong>${number(p[valueField], 0)}</strong>
        </div>`);
    },
  }).addTo(map);
}

async function toggleTrees(show) {
  if (!show) {
    if (state.treesLayer) map.removeLayer(state.treesLayer);
    return;
  }
  if (!state.treesLayer) {
    const data = await fetchGeoJSON(DATA.trees, "tree polygons");
    state.treesLayer = L.geoJSON(data, {
      pane: "trees",
      style: { color: "#16705c", weight: 0.45, fillColor: "#3aa66f", fillOpacity: 0.7 },
      onEachFeature(feature, layer) {
        layer.bindPopup(`Tree canopy ≥${number(feature.properties.canopy_min, 0)} m`);
      },
    });
  }
  state.treesLayer.addTo(map);
}

async function toggleBuildings(show) {
  if (!show) {
    if (state.buildingsLayer) map.removeLayer(state.buildingsLayer);
    return;
  }
  if (!state.buildingsLayer) {
    const data = await fetchGeoJSON(DATA.buildings, "buildings");
    state.buildingsLayer = L.geoJSON(data, {
      pane: "buildings",
      style: { color: "#50585d", weight: 0.5, fillColor: "#aeb5b9", fillOpacity: 0.62 },
      onEachFeature(feature, layer) {
        layer.bindPopup(`Building height: ${number(feature.properties.height_m)} m`);
      },
    });
  }
  state.buildingsLayer.addTo(map);
}

async function updateShadowLayer() {
  if (state.currentShadowLayer) {
    map.removeLayer(state.currentShadowLayer);
    state.currentShadowLayer = null;
  }
  if (!document.getElementById("show-shadows").checked) return;
  const hour = document.getElementById("shadow-hour").value;
  if (!state.shadowLayers.has(hour)) {
    const data = await fetchGeoJSON(DATA.shadow(hour), `${hour.slice(0, 2)}:00 shadows`);
    const layer = L.geoJSON(data, {
      pane: "shadows",
      style: {
        color: "#403653",
        weight: 0.2,
        opacity: 0.45,
        fillColor: "#403653",
        fillOpacity: 0.38,
        smoothFactor: 1.5,
      },
      onEachFeature(feature, item) {
        const p = feature.properties;
        item.bindPopup(`
          <div class="popup-title">Building shadow ${hour.slice(0, 2)}:00</div>
          <div class="popup-grid">
            <span>Solar elevation</span><strong>${number(p.solar_alt)}°</strong>
            <span>Solar azimuth</span><strong>${number(p.solar_az)}°</strong>
            <span>Display source</span><strong>${escapeHtml(p.display_method || "Shadow polygon")}</strong>
          </div>`);
      },
    });
    state.shadowLayers.set(hour, layer);
  }
  state.currentShadowLayer = state.shadowLayers.get(hour);
  state.currentShadowLayer.addTo(map);
}

function togglePanel(open) {
  const sidebar = document.getElementById("sidebar");
  const button = document.getElementById("panel-toggle");
  sidebar.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
}

document.querySelectorAll(".metric-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".metric-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.metric = button.dataset.metric;
    updateParkStyle();
  });
});

parkSearch.addEventListener("change", () => {
  if (parkSearch.value) zoomToPark(parkSearch.value);
  else if (state.parksLayer) map.fitBounds(state.parksLayer.getBounds(), { padding: [25, 25] });
});

document.getElementById("ranking-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-park-id]");
  if (button) zoomToPark(button.dataset.parkId);
});

const incomeToggle = document.getElementById("show-income");
const populationToggle = document.getElementById("show-population");
incomeToggle.addEventListener("change", () => {
  if (incomeToggle.checked) populationToggle.checked = false;
  updateVillageLayer(incomeToggle.checked ? "income" : "none").catch(handleError);
});
populationToggle.addEventListener("change", () => {
  if (populationToggle.checked) incomeToggle.checked = false;
  updateVillageLayer(populationToggle.checked ? "population" : "none").catch(handleError);
});
document.getElementById("show-trees").addEventListener("change", (event) => {
  toggleTrees(event.target.checked).catch(handleError);
});
document.getElementById("show-buildings").addEventListener("change", (event) => {
  toggleBuildings(event.target.checked).catch(handleError);
});
document.getElementById("show-shadows").addEventListener("change", () => {
  updateShadowLayer().catch(handleError);
});
document.getElementById("shadow-hour").addEventListener("change", () => {
  updateShadowLayer().catch(handleError);
});
document.getElementById("panel-toggle").addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  togglePanel(!sidebar.classList.contains("open"));
});

function handleError(error) {
  console.error(error);
  setStatus(error.message || "A map layer could not be loaded.");
}

Promise.all([loadParks(), updateShadowLayer()])
  .then(() => setStatus(""))
  .catch(handleError);
