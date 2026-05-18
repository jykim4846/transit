function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

const EARTH_RADIUS_METERS = 6371000;

function distanceMeters(fromX, fromY, toX, toY) {
  const dLat = toRadians(Number(toY) - Number(fromY));
  const dLon = toRadians(Number(toX) - Number(fromX));
  const lat1 = toRadians(fromY);
  const lat2 = toRadians(toY);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { toRadians, distanceMeters, EARTH_RADIUS_METERS };
