const xlsx = require("node-xlsx");

const SEOUL_BUS_API_ROOT = process.env.SEOUL_BUS_API_ROOT || "http://ws.bus.go.kr/api/rest";
const SEOUL_ROUTE_FILE_SEQ = process.env.SEOUL_ROUTE_FILE_SEQ || "48";
const SEOUL_ROUTE_FILE_INF_ID = process.env.SEOUL_ROUTE_FILE_INF_ID || "OA-1095";
const SEOUL_ROUTE_FILE_INF_SEQ = process.env.SEOUL_ROUTE_FILE_INF_SEQ || "2";
const SEOUL_ROUTE_FILE_URL = process.env.SEOUL_ROUTE_FILE_URL || "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false";

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
  return rows.map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[String(header)] = row[index];
    });
    return normalizeWorkbookStop(item);
  }).filter((row) => row.routeId && row.routeNo && row.stationId && row.seq > 0);
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

module.exports = {
  getSeoulBusApiKey,
  searchRoutesByNumber,
  getStopsByRoute,
  getArrivalByRoute,
  downloadRouteWorkbookRows
};
