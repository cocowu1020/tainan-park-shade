const DATA = {
  parks: "data/parks.geojson?v=20261006-5",
  villages: "data/villages.geojson?v=20261006-5",
  trees: "data/trees_ge2m.geojson?v=20261006-5",
  buildings: "data/buildings.geojson?v=20261006-5",
  shadow: (hour) => `data/shadows_${hour}.geojson?v=20261006-5`,
  treeShadow: (hour) => `data/tree_shadows_${hour}.geojson?v=20261006-5`,
};

const palettes = {
  morning: ["#1a9850", "#91cf60", "#fee08b", "#fc8d59", "#d73027"],
  afternoon: ["#1a9850", "#91cf60", "#fee08b", "#fc8d59", "#d73027"],
  income: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
  population: ["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"],
};

const state = {
  metric: "morning",
  parksData: null,
  parksLayer: null,
  villagesData: null,
  villagesLayer: null,
  treesLayer: null,
  buildingsLayer: null,
  shadowLayers: new Map(),
  currentShadowLayer: null,
  treeShadowLayers: new Map(),
  currentTreeShadowLayer: null,
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
map.createPane("treeShadows");
map.getPane("treeShadows").style.zIndex = 440;
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
  return Number(state.metric === "morning" ? properties.morn_class : properties.aft_class);
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
      <span>Morning heat risk</span><strong>${number(properties.morn_risk)}%</strong>
      <span>Morning combined shade</span><strong>${number(properties.morn_shade)}%</strong>
      <span>Morning rank</span><strong>${number(properties.morn_rank, 0)}</strong>
      <span>Afternoon heat risk</span><strong>${number(properties.aft_risk)}%</strong>
      <span>Afternoon combined shade</span><strong>${number(properties.aft_shade)}%</strong>
      <span>Afternoon rank</span><strong>${number(properties.aft_rank, 0)}</strong>
      <span>Canopy footprint</span><strong>${number(properties.tree_pct)}%</strong>
      <span>Morning projected tree shadow</span><strong>${number(properties.morn_tree_shadow)}%</strong>
      <span>Afternoon projected tree shadow</span><strong>${number(properties.aft_tree_shadow)}%</strong>
      <span>Morning building shadow</span><strong>${number(properties.morn_bldg)}%</strong>
      <span>Afternoon building shadow</span><strong>${number(properties.aft_bldg)}%</strong>
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
  const title = state.metric === "morning"
    ? "Morning heat risk (%)"
    : "Afternoon heat risk (%)";
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

  renderRanking(features);
}

function renderRanking(features = state.parksData?.features || []) {
  const rankField = state.metric === "morning" ? "morn_rank" : "aft_rank";
  const riskField = state.metric === "morning" ? "morn_risk" : "aft_risk";
  document.getElementById("ranking-period").textContent =
    state.metric === "morning" ? "09:00–10:00" : "14:00–16:00";
  const ranked = [...features]
    .sort((a, b) => Number(a.properties[rankField]) - Number(b.properties[rankField]))
    .slice(0, 15);
  document.getElementById("ranking-list").innerHTML = ranked.map((feature) => `
    <li>
      <button type="button" data-park-id="${feature.properties.park_id}">
        <span class="rank-number">${feature.properties[rankField]}</span>
        <span class="rank-name">${escapeHtml(feature.properties.park_name)}</span>
        <span class="rank-value">${number(feature.properties[riskField], 0)}</span>
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

async function updateTreeShadowLayer() {
  if (state.currentTreeShadowLayer) {
    map.removeLayer(state.currentTreeShadowLayer);
    state.currentTreeShadowLayer = null;
  }
  if (!document.getElementById("show-tree-shadows").checked) return;
  const hour = document.getElementById("shadow-hour").value;
  if (!state.treeShadowLayers.has(hour)) {
    const data = await fetchGeoJSON(DATA.treeShadow(hour), `${hour.slice(0, 2)}:00 tree shadows`);
    const layer = L.geoJSON(data, {
      pane: "treeShadows",
      style: {
        color: "#116149",
        weight: 0.35,
        opacity: 0.65,
        fillColor: "#2f8f68",
        fillOpacity: 0.46,
        smoothFactor: 1.2,
      },
      onEachFeature(feature, item) {
        const p = feature.properties;
        item.bindPopup(`
          <div class="popup-title">Projected tree shadow ${hour.slice(0, 2)}:00</div>
          <div class="popup-grid">
            <span>Solar elevation</span><strong>${number(p.solar_alt)}°</strong>
            <span>Solar azimuth</span><strong>${number(p.solar_az)}°</strong>
            <span>Canopy threshold</span><strong>≥${number(p.canopy_min, 0)} m</strong>
          </div>`);
      },
    });
    state.treeShadowLayers.set(hour, layer);
  }
  state.currentTreeShadowLayer = state.treeShadowLayers.get(hour);
  state.currentTreeShadowLayer.addTo(map);
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
    renderRanking();
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
document.getElementById("show-tree-shadows").addEventListener("change", () => {
  updateTreeShadowLayer().catch(handleError);
});
document.getElementById("show-shadows").addEventListener("change", () => {
  updateShadowLayer().catch(handleError);
});
document.getElementById("shadow-hour").addEventListener("change", () => {
  updateShadowLayer().catch(handleError);
  updateTreeShadowLayer().catch(handleError);
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
