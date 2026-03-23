const geolib = require('geolib');

/**
 * Check if a point is within a geo-fence radius
 */
function isWithinGeofence(userLat, userLng, fenceLat, fenceLng, radiusMeters) {
  const distance = geolib.getDistance(
    { latitude: userLat, longitude: userLng },
    { latitude: fenceLat, longitude: fenceLng }
  );
  return { isInside: distance <= radiusMeters, distance };
}

/**
 * Calculate distance between two GPS coordinates in meters
 */
function getDistance(lat1, lng1, lat2, lng2) {
  return geolib.getDistance(
    { latitude: lat1, longitude: lng1 },
    { latitude: lat2, longitude: lng2 }
  );
}

module.exports = { isWithinGeofence, getDistance };
