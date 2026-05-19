const { test, expect } = require("@playwright/test");

const route = {
  id: "route-e2e",
  label: "출근",
  from: { name: "현재 위치", isCurrentLocation: true, x: 127.0276, y: 37.4979, kind: "현재 위치" },
  to: { name: "홍대입구역", x: 126.9223, y: 37.5563 },
  priority: "fastest",
  transportFilter: "bus",
  createdAt: new Date().toISOString(),
  lastResult: {
    fetchedAt: new Date().toISOString(),
    recommendedId: "candidate-e2e",
    recommendation: null,
    candidates: [
      {
        id: "candidate-e2e",
        routeNo: "400",
        busRouteId: "100100596",
        boardingStationId: "121000012",
        alightingStationId: "102000098",
        boardingStopName: "강남역",
        alightingStopName: "홍대입구역",
        firstTransitLabel: "400번",
        totalTime: 38,
        journeyMinutes: 38,
        transferCount: 0,
        walkTime: 5,
        initialWalkTime: 4,
        note: "E2E 경로",
        segments: [
          { type: "walk", kind: "도보", label: "도보", text: "정류장까지 도보", time: "4분", minutes: 4 },
          { type: "bus", kind: "버스", label: "400번", text: "400번 탑승", time: "30분", minutes: 30 },
          { type: "walk", kind: "도보", label: "도보", text: "도착지까지 도보", time: "4분", minutes: 4 }
        ],
        busApproachPreview: {
          boardingStationSeq: 10,
          alightingStationSeq: 18,
          alightingStopName: "홍대입구역",
          vehicles: [
            {
              key: "bus-e2e",
              label: "다음",
              catchable: true,
              remainingStops: 3,
              etaMinutes: 4,
              progressSeq: 7,
              progressPercent: 58,
              gpsLat: 37.501,
              gpsLng: 127.02
            }
          ],
          ridingVehicles: [],
          stops: [
            { seq: 7, name: "역삼역", stationId: "s7", lat: 37.5002, lng: 127.036, isBoarding: false },
            { seq: 10, name: "강남역", stationId: "s10", lat: 37.4979, lng: 127.0276, isBoarding: true },
            { seq: 18, name: "홍대입구역", stationId: "s18", lat: 37.5563, lng: 126.9223, isAlighting: true }
          ],
          ridingStops: [
            { seq: 10, name: "강남역", stationId: "s10", lat: 37.4979, lng: 127.0276, isBoarding: true },
            { seq: 18, name: "홍대입구역", stationId: "s18", lat: 37.5563, lng: 126.9223, isAlighting: true }
          ]
        }
      }
    ],
    picks: { fastestId: "candidate-e2e", fewestTransfersId: "candidate-e2e" }
  }
};

async function installBrowserStubs(page, routes = [route]) {
  await page.addInitScript((seedRoutes) => {
    localStorage.setItem("transit-routes-v2", JSON.stringify(seedRoutes));
    localStorage.setItem("transit-kakao-map-key", "e2e-map-key");
    window.__TRANSIT_E2E_FAST_POLL = true;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success) => success({ coords: { latitude: 37.4979, longitude: 127.0276 } }),
        watchPosition: (success) => {
          success({ coords: { latitude: 37.4979, longitude: 127.0276 } });
          return 1;
        },
        clearWatch: () => {}
      }
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: async () => ({ state: "prompt", onchange: null })
      }
    });
    class LatLng {
      constructor(lat, lng) {
        this.lat = lat;
        this.lng = lng;
      }
    }
    class CustomOverlay {
      constructor(options) {
        this.options = options;
        this.content = options.content;
      }
      setMap(map) {
        this.map = map;
      }
      setPosition(position) {
        this.position = position;
      }
      getContent() {
        return this.content;
      }
    }
    class Polyline {
      constructor(options) {
        this.options = options;
      }
      setMap(map) {
        this.map = map;
      }
    }
    class LatLngBounds {
      extend() {}
    }
    class Map {
      constructor(element, options) {
        this.element = element;
        this.options = options;
      }
      setBounds() {}
    }
    window.kakao = {
      maps: {
        load: (callback) => callback(),
        LatLng,
        CustomOverlay,
        Polyline,
        LatLngBounds,
        Map
      }
    };
  }, routes);
}

test("explains browser location permission persistence before prompting", async ({ page }) => {
  await page.goto("/");
  const notice = page.locator("#permission-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("위치 권한은 브라우저가 저장합니다");
});

test("keeps boarded bus state after reload", async ({ page }) => {
  await installBrowserStubs(page);
  await page.route("**/api/bus-positions**", async (requestRoute) => {
    await requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ preview: route.lastResult.candidates[0].busApproachPreview })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "이 버스 탑승" }).click();
  await expect(page.locator(".boarding-panel.boarded")).toContainText("탑승 중");
  await expect(page.locator(".boarding-panel-meta")).toContainText("까지 유지");

  await page.reload();
  await expect(page.locator(".boarding-panel.boarded")).toContainText("탑승 중");
  await expect(page.locator(".boarding-panel.boarded")).toContainText("홍대입구역까지");
  const storedTrip = await page.evaluate(() => JSON.parse(localStorage.getItem("transit-boarded-trip")));
  expect(storedTrip.vehicleKey).toBe("bus-e2e");
});

test("shows live-map reconnect control after repeated bus polling failures", async ({ page }) => {
  await installBrowserStubs(page);
  let pollCount = 0;
  await page.route("**/api/bus-positions**", async (requestRoute) => {
    pollCount += 1;
    await requestRoute.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "temporary outage" })
    });
  });

  await page.goto("/");
  await expect.poll(() => pollCount).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => page.evaluate(() => window.__TRANSIT_E2E_POLL_FAILURES || 0)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("[data-live-map-status]")).toContainText("실시간 위치 연결이 불안정해요");
  await expect(page.getByRole("button", { name: "재연결" })).toBeVisible();
});

test("does not refresh route candidates while a boarded trip is active", async ({ page }) => {
  await installBrowserStubs(page);
  await page.route("**/api/bus-positions**", async (requestRoute) => {
    await requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ preview: route.lastResult.candidates[0].busApproachPreview })
    });
  });

  let routeRefreshesAfterBoarding = 0;
  await page.goto("/");
  await page.route("**/api/routes?**", async (requestRoute) => {
    routeRefreshesAfterBoarding += 1;
    await requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(route.lastResult)
    });
  });

  await page.getByRole("button", { name: "이 버스 탑승" }).click();
  await expect(page.locator(".boarding-panel.boarded")).toContainText("탑승 중");
  await page.getByRole("button", { name: "이동 트래킹 토글" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect.poll(() => routeRefreshesAfterBoarding).toBe(0);
  await expect(page.locator(".boarding-panel.boarded")).toContainText("탑승 중");
});
