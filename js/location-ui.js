import { escapeHtml } from "./util.js";
import { AUTOCOMPLETE_MIN_LENGTH } from "./constants.js";
import { state } from "./state.js";
import { fetchJson, searchStations } from "./api.js";

let showToast = () => {};

export function configureLocationUi(options = {}) {
  if (typeof options.showToast === "function") {
    showToast = options.showToast;
  }
}

export function clearLocationPreview(selectionKey) {
  const mapId = "route-" + selectionKey + "-preview-map";
  const labelId = "route-" + selectionKey + "-preview-label";
  const mapEl = document.getElementById(mapId);
  const labelEl = document.getElementById(labelId);
  if (!mapEl || !labelEl) return;

  const existing = state.previewMaps[selectionKey];
  if (existing?.map) {
    existing.map.remove();
  }
  delete state.previewMaps[selectionKey];

  mapEl.classList.add("empty");
  mapEl.innerHTML = "검색 결과를 선택하면 지도로 위치를 확인할 수 있습니다.";
  labelEl.textContent = "위치를 선택하면 이곳에 지도가 보입니다.";
}

export function updateLocationPreview(selectionKey, location) {
  const mapId = "route-" + selectionKey + "-preview-map";
  const labelId = "route-" + selectionKey + "-preview-label";
  const mapEl = document.getElementById(mapId);
  const labelEl = document.getElementById(labelId);
  if (!mapEl || !labelEl) return;

  if (!location || location.x == null || location.y == null) {
    clearLocationPreview(selectionKey);
    return;
  }

  mapEl.classList.remove("empty");
  labelEl.textContent = [location.kind, location.detail].filter(Boolean).join(" · ") || location.name;

  const lat = Number(location.y);
  const lng = Number(location.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    clearLocationPreview(selectionKey);
    return;
  }

  requestAnimationFrame(() => {
    let preview = state.previewMaps[selectionKey];
    if (!preview) {
      mapEl.innerHTML = "";
      if (typeof L === "undefined") {
        mapEl.classList.add("empty");
        mapEl.textContent = `${location?.name || "선택한 위치"} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
        return;
      }
      const map = L.map(mapId, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19
      }).addTo(map);
      const marker = L.circleMarker([lat, lng], {
        radius: 8,
        color: "#165c47",
        weight: 2,
        fillColor: "#1e7a5f",
        fillOpacity: 0.9
      }).addTo(map);
      preview = { map, marker };
      state.previewMaps[selectionKey] = preview;
    } else {
      preview.marker.setLatLng([lat, lng]);
    }

    preview.map.getContainer().style.cursor = "default";
    preview.map.setView([lat, lng], 15);
    preview.map.invalidateSize();
  });
}

export function clearAutocompletePreview(selectionKey) {
  const previewId = "route-" + selectionKey + "-dropdown-preview";
  const previewEl = document.getElementById(previewId);
  if (!previewEl) return;

  const existing = state.previewMaps["dropdown-" + selectionKey];
  if (existing?.map) {
    existing.map.remove();
  }
  delete state.previewMaps["dropdown-" + selectionKey];

  previewEl.classList.add("empty");
  previewEl.innerHTML = "목록에서 항목에 마우스를 올리거나 방향키로 이동하면 위치가 여기에 보입니다.";
}

export function updateAutocompletePreview(selectionKey, location) {
  const previewId = "route-" + selectionKey + "-dropdown-preview";
  const previewEl = document.getElementById(previewId);
  if (!previewEl) return;

  if (!location || location.x == null || location.y == null) {
    clearAutocompletePreview(selectionKey);
    return;
  }

  previewEl.classList.remove("empty");

  const lat = Number(location.y);
  const lng = Number(location.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    clearAutocompletePreview(selectionKey);
    return;
  }

  requestAnimationFrame(() => {
    let preview = state.previewMaps["dropdown-" + selectionKey];
    if (!preview) {
      previewEl.innerHTML = "";
      if (typeof L === "undefined") {
        previewEl.classList.add("empty");
        previewEl.textContent = `${location.name} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
        return;
      }
      const map = L.map(previewId, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19
      }).addTo(map);
      const marker = L.circleMarker([lat, lng], {
        radius: 8,
        color: "#1c5bb7",
        weight: 2,
        fillColor: "#3c7ad1",
        fillOpacity: 0.9
      }).addTo(map);
      preview = { map, marker };
      state.previewMaps["dropdown-" + selectionKey] = preview;
    } else {
      preview.marker.setLatLng([lat, lng]);
    }

    preview.map.setView([lat, lng], 15);
    preview.map.invalidateSize();
  });
}

export function updateMapPickButtons() {
  ["from", "to"].forEach((selectionKey) => {
    const button = document.getElementById(`route-${selectionKey}-map-pick-btn`);
    if (!button) return;
    const active = state.mapPickerTarget === selectionKey;
    button.classList.toggle("active", active);
    button.textContent = active ? "지도 열림" : "지도에서 찍기";
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const payload = await fetchJson(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
    return payload.location || null;
  } catch {
    return null;
  }
}

async function handleMapPick(selectionKey, lat, lng) {
  const location = await reverseGeocode(lat, lng);
  const fallbackName = selectionKey === "from" ? "지도 선택 출발지" : "지도 선택 도착지";
  const picked = {
    name: location?.name || fallbackName,
    detail: location?.detail || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    kind: location?.kind || "지도 선택",
    x: lng,
    y: lat,
    stationID: null
  };

  state.autocompleteSelection[selectionKey] = picked;
  const input = document.getElementById(`route-${selectionKey}-input`);
  if (input) input.value = picked.name;
  closeMapPicker();
  updateMapPickButtons();
  updateLocationPreview(selectionKey, picked);
  showToast(`${selectionKey === "from" ? "출발지" : "도착지"}를 지도에서 선택했습니다`);
}

export function openMapPicker(selectionKey) {
  state.mapPickerTarget = selectionKey;
  updateMapPickButtons();
  document.getElementById("map-picker-title").textContent = selectionKey === "from" ? "출발지를 지도에서 선택" : "도착지를 지도에서 선택";
  document.getElementById("map-picker-subtitle").textContent = "큰 지도에서 정확한 위치를 누르면 즉시 저장됩니다.";
  document.getElementById("map-picker-status").textContent = "핀을 찍을 지점을 찾은 뒤 지도를 한 번 눌러 선택하세요.";
  document.getElementById("map-picker-overlay").classList.add("active");
  renderMapPicker();
}

export function closeMapPicker() {
  const existing = state.previewMaps.mapPicker;
  if (existing?.map) {
    existing.map.remove();
  }
  delete state.previewMaps.mapPicker;
  state.mapPickerTarget = null;
  document.getElementById("map-picker-overlay").classList.remove("active");
  updateMapPickButtons();
}

export function renderMapPicker() {
  const selectionKey = state.mapPickerTarget;
  const mapEl = document.getElementById("map-picker-map");
  if (!selectionKey || !mapEl) return;

  const location = state.autocompleteSelection[selectionKey];
  const lat = location?.y != null ? Number(location.y) : 37.5665;
  const lng = location?.x != null ? Number(location.x) : 126.9780;
  const zoom = location?.y != null && location?.x != null ? 16 : 13;

  requestAnimationFrame(() => {
    let preview = state.previewMaps.mapPicker;
    if (!preview) {
      mapEl.innerHTML = "";
      if (typeof L === "undefined") {
        mapEl.textContent = "지도를 불러오지 못했습니다.";
        return;
      }
      const map = L.map("map-picker-map", {
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        keyboard: false
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19
      }).addTo(map);
      let marker = null;
      if (location?.x != null && location?.y != null) {
        marker = L.marker([lat, lng]).addTo(map);
      }
      map.on("click", (event) => {
        if (!state.mapPickerTarget) return;
        handleMapPick(state.mapPickerTarget, event.latlng.lat, event.latlng.lng);
      });
      preview = { map, marker };
      state.previewMaps.mapPicker = preview;
    } else {
      if (location?.x != null && location?.y != null) {
        if (!preview.marker) {
          preview.marker = L.marker([lat, lng]).addTo(preview.map);
        } else {
          preview.marker.setLatLng([lat, lng]);
        }
      }
    }

    preview.map.setView([lat, lng], zoom);
    preview.map.invalidateSize();
  });
}

export function setupAutocomplete(inputId, dropdownId, selectionKey) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  let currentItems = [];
  let focusedIndex = -1;
  let closeTimer = null;
  let pointerInsideDropdown = false;

  const renderDropdownShell = (previewContent, rightContent) => {
    dropdown.innerHTML = `
      <div class="autocomplete-panel">
        <div class="autocomplete-preview${previewContent.empty ? " empty" : ""}" id="route-${selectionKey}-dropdown-preview">${previewContent.html}</div>
        <div class="autocomplete-results">${rightContent}</div>
      </div>
    `;
    dropdown.classList.add("open");
  };

  const renderDropdown = (items, loading = false, warnings = []) => {
    currentItems = items;
    focusedIndex = -1;
    if (loading) {
      renderDropdownShell(
        { empty: true, html: "검색 중..." },
        '<div class="autocomplete-empty">위치 후보를 불러오고 있습니다.</div>'
      );
      return;
    }
    if (!items.length) {
      renderDropdownShell(
        { empty: true, html: "검색 결과가 없어 위치를 미리 볼 수 없습니다." },
        '<div class="autocomplete-empty">검색 결과 없음</div>' + (warnings.length ? `<div class="autocomplete-warning">${escapeHtml(warnings.join(" / "))}</div>` : "")
      );
      return;
    }
    const listHtml = items.map((station, index) => `
      <div class="autocomplete-item ${index === 0 ? "focused" : ""}" data-index="${index}">
        <span class="autocomplete-text">
          <span class="autocomplete-name">${escapeHtml(station.name)}</span>
          ${station.detail ? `<span class="autocomplete-detail">${escapeHtml(station.detail)}</span>` : ""}
        </span>
        <span class="autocomplete-meta">${escapeHtml(station.kind)}</span>
      </div>
    `).join("");

    renderDropdownShell(
      { empty: true, html: "목록에서 항목에 마우스를 올리거나 방향키로 이동하면 위치가 여기에 보입니다." },
      `
        <div class="autocomplete-results-head">
          <strong>검색 결과</strong>
          <span>${items.length}건</span>
        </div>
        <div class="autocomplete-scroll">${listHtml}</div>
        ${warnings.length ? `<div class="autocomplete-warning">${escapeHtml(warnings.join(" / "))}</div>` : ""}
      `
    );
    focusedIndex = 0;
    updateAutocompletePreview(selectionKey, items[0]);
  };

  const closeDropdown = () => {
    clearTimeout(closeTimer);
    closeTimer = null;
    dropdown.classList.remove("open");
    focusedIndex = -1;
    clearAutocompletePreview(selectionKey);
  };

  const scheduleCloseDropdown = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (pointerInsideDropdown) return;
      closeDropdown();
    }, 180);
  };

  const selectItem = (station) => {
    state.mapPickerTarget = null;
    updateMapPickButtons();
    state.autocompleteSelection[selectionKey] = station;
    input.value = station.name;
    updateLocationPreview(selectionKey, station);
    closeDropdown();
  };

  const debouncedSearch = debounce(async () => {
    const value = input.value.trim();
    if (value.length < AUTOCOMPLETE_MIN_LENGTH) {
      closeDropdown();
      return;
    }
    renderDropdown([], true);
    try {
      const result = await searchStations(value);
      renderDropdown(result.stations, false, result.warnings);
    } catch (error) {
      renderDropdownShell(
        { empty: true, html: "검색을 완료하지 못했습니다." },
        '<div class="autocomplete-empty">' + escapeHtml(error.message || "검색 실패") + '</div>'
      );
    }
  }, 320);

  input.addEventListener("input", () => {
    if (state.mapPickerTarget === selectionKey) {
      state.mapPickerTarget = null;
      updateMapPickButtons();
    }
    state.autocompleteSelection[selectionKey] = null;
    clearLocationPreview(selectionKey);
    debouncedSearch();
  });

  input.addEventListener("keydown", (event) => {
    if (!dropdown.classList.contains("open")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, currentItems.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (focusedIndex >= 0 && currentItems[focusedIndex]) {
        event.preventDefault();
        selectItem(currentItems[focusedIndex]);
      }
    } else if (event.key === "Escape") {
      closeDropdown();
    } else {
      return;
    }

    dropdown.querySelectorAll(".autocomplete-item").forEach((item, index) => {
      item.classList.toggle("focused", index === focusedIndex);
    });
    if (focusedIndex >= 0 && currentItems[focusedIndex]) {
      updateAutocompletePreview(selectionKey, currentItems[focusedIndex]);
    }
  });

  dropdown.addEventListener("mousedown", (event) => {
    const item = event.target.closest("[data-index]");
    if (!item) return;
    event.preventDefault();
    selectItem(currentItems[Number(item.dataset.index)]);
  });

  dropdown.addEventListener("mousemove", (event) => {
    const item = event.target.closest("[data-index]");
    if (!item) return;
    const index = Number(item.dataset.index);
    if (!Number.isNaN(index) && currentItems[index]) {
      focusedIndex = index;
      dropdown.querySelectorAll(".autocomplete-item").forEach((node, nodeIndex) => {
        node.classList.toggle("focused", nodeIndex === focusedIndex);
      });
      updateAutocompletePreview(selectionKey, currentItems[index]);
    }
  });

  dropdown.addEventListener("mouseenter", () => {
    pointerInsideDropdown = true;
    clearTimeout(closeTimer);
    closeTimer = null;
  });

  dropdown.addEventListener("mouseleave", () => {
    pointerInsideDropdown = false;
    if (document.activeElement !== input) {
      scheduleCloseDropdown();
    }
  });

  input.addEventListener("focus", () => {
    clearTimeout(closeTimer);
    closeTimer = null;
  });

  input.addEventListener("blur", () => {
    scheduleCloseDropdown();
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
