const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinGeofence, getDistance } = require('./geofence');

test('geofence utility tests', async (t) => {
  await t.test('getDistance should calculate the correct distance between two points', () => {
    // Coordinates around a central point (London Euston area)
    const lat1 = 51.524412;
    const lng1 = -0.13997;
    const lat2 = 51.524224;
    const lng2 = -0.14175;

    const distance = getDistance(lat1, lng1, lat2, lng2);
    // distance is ~125 meters
    assert.ok(distance > 100 && distance < 150, `Expected distance around 125 meters, got ${distance}`);
  });

  await t.test('isWithinGeofence should detect point inside the geofence', () => {
    const fenceLat = 51.524412;
    const fenceLng = -0.13997;
    const userLat = 51.524224;
    const userLng = -0.14175;
    const radiusMeters = 200; // Point is ~125 meters away, so inside 200m

    const result = isWithinGeofence(userLat, userLng, fenceLat, fenceLng, radiusMeters);
    assert.deepEqual(result.isInside, true);
    assert.ok(result.distance <= radiusMeters);
  });

  await t.test('isWithinGeofence should detect point outside the geofence', () => {
    const fenceLat = 51.524412;
    const fenceLng = -0.13997;
    const userLat = 51.524224;
    const userLng = -0.14175;
    const radiusMeters = 50; // Point is ~125 meters away, so outside 50m

    const result = isWithinGeofence(userLat, userLng, fenceLat, fenceLng, radiusMeters);
    assert.deepEqual(result.isInside, false);
    assert.ok(result.distance > radiusMeters);
  });
});
