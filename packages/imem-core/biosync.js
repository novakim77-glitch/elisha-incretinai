// IMEM Core — Bio-Sync (sunrise/sunset)
// Pure functions extracted from IncretinAi_v7.0.html (line 2650)

function calculateSunTimes(lat, date = new Date()) {
  const dy = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const dec = 23.45 * Math.sin((2 * Math.PI / 365) * (dy - 81));
  const lr = lat * Math.PI / 180;
  const dr = dec * Math.PI / 180;
  const ha = Math.acos(-Math.tan(lr) * Math.tan(dr)) * 180 / Math.PI / 15;
  const n = 12;
  return {
    sunrise: { h: Math.floor(n - ha), m: Math.round(((n - ha) % 1) * 60) },
    sunset:  { h: Math.floor(n + ha), m: Math.round(((n + ha) % 1) * 60) },
  };
}

function timeToMinutes(h, m) { return h * 60 + m; }

function isWithinGoldenTime(sun, now = new Date()) {
  const nowM = timeToMinutes(now.getHours(), now.getMinutes());
  const srM = timeToMinutes(sun.sunrise.h, sun.sunrise.m);
  const ssM = timeToMinutes(sun.sunset.h, sun.sunset.m);
  return nowM >= srM && nowM < ssM;
}

function getMinutesToSunset(sun, now = new Date()) {
  const nowM = timeToMinutes(now.getHours(), now.getMinutes());
  const ssM = timeToMinutes(sun.sunset.h, sun.sunset.m);
  return ssM - nowM;
}

module.exports = { calculateSunTimes, timeToMinutes, isWithinGoldenTime, getMinutesToSunset };
