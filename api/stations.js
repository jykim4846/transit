const { fetchOdsay, sendJson } = require("./_odsay");
const PLACE_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

function roundedKey(x, y) {
  return `${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
}

function normalizeStation(station) {
  const stationType = Number(station.stationType ?? 0);
  const stationClass = Number(station.stationClass ?? 0);
  const isSubway = stationType === 1 || stationClass === 2;
  const detail = [
    station.stationCityName,
    station.stationDistrictName,
    station.stationDongName
  ].filter(Boolean).join(" · ");
  return {
    name: station.stationName || station.stationNameKor || "",
    x: station.x,
    y: station.y,
    stationID: station.stationID || null,
    kind: isSubway ? "지하철" : "버스",
    detail
  };
}

async function searchPlaces(query) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    countrycodes: "kr",
    addressdetails: "0",
    "accept-language": "ko"
  });

  const response = await fetch(`${PLACE_SEARCH_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": "transit-app/1.0 (contact: transit-app)"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`장소 검색 실패 (${response.status})`);
  }

  const payload = await response.json().catch(() => []);
  return payload.map((place) => ({
    name: place.display_name?.split(",")[0]?.trim() || place.name || "",
    x: place.lon,
    y: place.lat,
    stationID: null,
    kind: "장소",
    detail: place.display_name || ""
  })).filter((place) => place.name && place.x && place.y);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    return sendJson(res, 400, { error: "검색어는 두 글자 이상이어야 합니다" });
  }

  let stationResults = [];
  let placeResults = [];
  let stationError = null;
  let placeError = null;

  try {
    const payload = await fetchOdsay("searchStation", {
      stationName: q
    });
    stationResults = (payload.result?.station || [])
      .slice(0, 8)
      .map(normalizeStation)
      .filter((station) => station.name && station.x && station.y);
  } catch (error) {
    stationError = error;
  }

  try {
    placeResults = await searchPlaces(q);
  } catch (error) {
    placeError = error;
  }

  const seen = new Set();
  const stations = [...stationResults, ...placeResults].filter((item) => {
    const key = `${item.name}:${roundedKey(item.x, item.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  if (!stations.length && stationError) {
    const errorMessage = stationError.message || placeError?.message || "검색에 실패했습니다";
    return sendJson(res, stationError.statusCode || 500, { error: errorMessage });
  }

  const warnings = [];
  if (stationError) warnings.push(`역/정류장 검색 일부 실패: ${stationError.message}`);
  if (placeError) warnings.push(`장소 검색 일부 실패: ${placeError.message}`);

  const result = warnings.length ? { stations, warnings } : { stations };
  return sendJson(res, 200, result);
};
