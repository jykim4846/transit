const { sendJson } = require("./_odsay");

const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return sendJson(res, 400, { error: "좌표 파라미터가 올바르지 않습니다" });
  }

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "jsonv2",
      "accept-language": "ko",
      zoom: "18",
      addressdetails: "1"
    });

    const response = await fetch(`${REVERSE_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": "transit-app/1.0 (contact: transit-app)"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return sendJson(res, response.status, { error: `역지오코딩 실패 (${response.status})` });
    }

    const payload = await response.json().catch(() => ({}));
    const address = payload.address || {};
    const name =
      payload.name ||
      address.amenity ||
      address.attraction ||
      address.building ||
      address.neighbourhood ||
      address.suburb ||
      address.road ||
      "지도 선택 위치";

    const detail = [
      address.city || address.state || address.county,
      address.borough || address.city_district || address.suburb,
      address.road || address.neighbourhood
    ].filter(Boolean).join(" · ");

    return sendJson(res, 200, {
      location: {
        name,
        detail: detail || payload.display_name || "",
        kind: "지도 선택",
        x: lon,
        y: lat
      }
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "역지오코딩에 실패했습니다" });
  }
};
