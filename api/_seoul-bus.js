const xlsx = require("node-xlsx");

const SEOUL_BUS_API_ROOT = process.env.SEOUL_BUS_API_ROOT || "http://ws.bus.go.kr/api/rest";
const SEOUL_ROUTE_FILE_SEQ = process.env.SEOUL_ROUTE_FILE_SEQ || "48";
const SEOUL_ROUTE_FILE_INF_ID = process.env.SEOUL_ROUTE_FILE_INF_ID || "OA-1095";
const SEOUL_ROUTE_FILE_INF_SEQ = process.env.SEOUL_ROUTE_FILE_INF_SEQ || "2";
const SEOUL_ROUTE_FILE_URL = process.env.SEOUL_ROUTE_FILE_URL || "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false";
const SEOUL_ROUTE_FILE_CACHE_TTL_MS = Math.max(0, Number(process.env.SEOUL_ROUTE_FILE_CACHE_TTL_MS || 10 * 60 * 1000) || 0);

let routeWorkbookCache = {
  rows: null,
  expiresAt: 0,
  promise: null
};

function getSeoulBusApiKey() {
  const key = process.env.SEOUL_BUS_API_KEY || null;
  if (!key) return null;
  if (!key.includes("%")) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function inspectSeoulBusApiKey() {
  const raw = process.env.SEOUL_BUS_API_KEY || "";
  const normalized = getSeoulBusApiKey() || "";
  return {
    configured: Boolean(raw),
    rawLength: raw.length,
    normalizedLength: normalized.length,
    rawContainsPercent: raw.includes("%"),
    rawContainsPlus: raw.includes("+"),
    normalizedContainsPlus: normalized.includes("+"),
    normalizedPreview: normalized
      ? `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
      : null,
    apiRoot: SEOUL_BUS_API_ROOT
  };
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchSeoulBus(pathname, params) {
  const key = getSeoulBusApiKey();
  if (!key) {
    throw new Error("SEOUL_BUS_API_KEY 환경변수가 설정되지 않았습니다");
  }

  const query = new URLSearchParams({
    serviceKey: key,
    resultType: "json",
    ...params
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;

  try {
    response = await fetch(`${SEOUL_BUS_API_ROOT}${pathname}?${query.toString()}`, {
      headers: {
        "User-Agent": "transit-app-seoul-bus/1.0"
      },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    const detail = error?.name === "AbortError" ? "요청 시간 초과" : (error?.message || "fetch failed");
    throw new Error(`서울시 버스 API fetch 실패: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`서울시 버스 API 요청 실패 (${response.status})`);
  }

  const payload = await response.json().catch(() => null);
  const header = payload?.msgHeader || payload?.ServiceResult?.msgHeader;
  if (header?.headerCd && String(header.headerCd) !== "0") {
    throw new Error(header.headerMsg || `서울시 버스 API 오류 (${header.headerCd})`);
  }

  return payload?.msgBody || payload?.ServiceResult?.msgBody || {};
}

async function debugFetchSeoulBus(pathname, params) {
  const key = getSeoulBusApiKey();
  if (!key) {
    throw new Error("SEOUL_BUS_API_KEY 환경변수가 설정되지 않았습니다");
  }

  const query = new URLSearchParams({
    serviceKey: key,
    resultType: "json",
    ...params
  });

  const url = `${SEOUL_BUS_API_ROOT}${pathname}?${query.toString()}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "transit-app-seoul-bus/1.0"
    },
    cache: "no-store"
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  const header = payload?.msgHeader || payload?.ServiceResult?.msgHeader || null;
  return {
    urlMasked: url.replace(key, "<MASKED_KEY>"),
    status: response.status,
    ok: response.ok,
    header,
    bodySnippet: text.slice(0, 1200)
  };
}

function normalizeRoute(entry) {
  return {
    routeId: entry.busRouteId || null,
    routeNo: entry.busRouteNm || "",
    routeType: entry.routeType || null,
    startName: entry.stStationNm || entry.stStation || "",
    endName: entry.edStationNm || entry.edStation || ""
  };
}

function normalizeStop(entry) {
  return {
    routeId: entry.busRouteId || null,
    seq: Number(entry.seq || 0),
    stationId: entry.station || entry.stId || null,
    arsId: entry.arsId || entry.stationNo || null,
    name: entry.stationNm || "",
    lat: Number(entry.gpsY),
    lng: Number(entry.gpsX),
    direction: entry.direction || ""
  };
}

function normalizeArrival(entry) {
  return {
    routeId: entry.busRouteId || null,
    stationId: entry.stId || null,
    routeNo: entry.rtNm || "",
    stationSeq: Number(entry.staOrd || entry.ord || 0),
    arrivalMessage1: entry.arrmsg1 || "",
    arrivalMessage2: entry.arrmsg2 || "",
    expectedSeconds1: Number(entry.exps1 || 0) || null,
    expectedSeconds2: Number(entry.exps2 || 0) || null
  };
}

function normalizeVehiclePosition(entry) {
  const sectionDistance = Number(entry.sectDist);
  const fullSectionDistance = Number(entry.fullSectDist);
  return {
    vehicleId: entry.vehId || null,
    plateNo: entry.plainNo || "",
    routeId: entry.busRouteId || null,
    sectionOrder: Number(entry.sectOrd || 0),
    lastStationId: entry.lastStnId || null,
    nextStationId: entry.nextStId || null,
    sectionDistance: Number.isFinite(sectionDistance) ? sectionDistance : null,
    fullSectionDistance: Number.isFinite(fullSectionDistance) ? fullSectionDistance : null,
    stopFlag: String(entry.stopFlag || "0") === "1",
    gpsX: Number(entry.gpsX),
    gpsY: Number(entry.gpsY),
    congestion: entry.congetion || null,
    dataTime: entry.dataTm || null,
    isRunning: String(entry.isrunyn || "0") === "1",
    isLast: String(entry.islastyn || "0") === "1"
  };
}

function normalizeWorkbookStop(row) {
  return {
    routeId: row.ROUTE_ID ? String(row.ROUTE_ID) : null,
    routeNo: row["노선명"] ? String(row["노선명"]).trim() : "",
    seq: Number(row["순번"] || 0),
    stationId: row.NODE_ID ? String(row.NODE_ID) : null,
    arsId: row.ARS_ID ? String(row.ARS_ID).trim() : null,
    name: row["정류소명"] ? String(row["정류소명"]).trim() : "",
    lat: Number(row["Y좌표"]),
    lng: Number(row["X좌표"])
  };
}

async function downloadRouteWorkbookRows() {
  const now = Date.now();
  if (routeWorkbookCache.rows && routeWorkbookCache.expiresAt > now) {
    return routeWorkbookCache.rows;
  }
  if (routeWorkbookCache.promise) {
    return routeWorkbookCache.promise;
  }

  routeWorkbookCache.promise = (async () => {
    const response = await fetch(SEOUL_ROUTE_FILE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "transit-app-seoul-bus/1.0"
      },
      body: new URLSearchParams({
        seq: SEOUL_ROUTE_FILE_SEQ,
        seqNo: SEOUL_ROUTE_FILE_SEQ,
        infId: SEOUL_ROUTE_FILE_INF_ID,
        infSeq: SEOUL_ROUTE_FILE_INF_SEQ
      }).toString(),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`서울시 공개 노선 파일 다운로드 실패 (${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const sheets = xlsx.parse(buffer);
    const firstSheet = sheets[0];
    if (!firstSheet?.data?.length) {
      throw new Error("서울시 공개 노선 파일 파싱 결과가 비어 있습니다");
    }

    const [headers, ...rows] = firstSheet.data;
    const normalizedRows = rows.map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[String(header)] = row[index];
      });
      return normalizeWorkbookStop(item);
    }).filter((row) => row.routeId && row.routeNo && row.stationId && row.seq > 0);

    routeWorkbookCache = {
      rows: normalizedRows,
      expiresAt: Date.now() + SEOUL_ROUTE_FILE_CACHE_TTL_MS,
      promise: null
    };
    return normalizedRows;
  })().catch((error) => {
    routeWorkbookCache.promise = null;
    throw error;
  });

  return routeWorkbookCache.promise;
}

async function searchRoutesByNumber(routeNo) {
  const body = await fetchSeoulBus("/busRouteInfo/getBusRouteList", {
    strSrch: routeNo
  });
  return normalizeList(body.itemList).map(normalizeRoute).filter((item) => item.routeId);
}

async function getStopsByRoute(routeId) {
  const body = await fetchSeoulBus("/busRouteInfo/getStaionByRoute", {
    busRouteId: routeId
  });
  return normalizeList(body.itemList).map(normalizeStop).filter((item) => item.stationId);
}

async function getArrivalByRoute(stationId, routeId, stationSeq) {
  const body = await fetchSeoulBus("/arrive/getArrInfoByRoute", {
    stId: stationId,
    busRouteId: routeId,
    ord: stationSeq
  });
  return normalizeList(body.itemList).map(normalizeArrival).filter((item) => item.routeId);
}

async function getBusPositionsByRoute(routeId) {
  const body = await fetchSeoulBus("/buspos/getBusPosByRtid", {
    busRouteId: routeId
  });
  return normalizeList(body.itemList).map(normalizeVehiclePosition).filter((item) => item.vehicleId && item.isRunning);
}

module.exports = {
  getSeoulBusApiKey,
  inspectSeoulBusApiKey,
  searchRoutesByNumber,
  getStopsByRoute,
  getArrivalByRoute,
  getBusPositionsByRoute,
  downloadRouteWorkbookRows,
  debugFetchSeoulBus
};
