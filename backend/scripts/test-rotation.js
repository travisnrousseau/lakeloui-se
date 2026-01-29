const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;

const lat = 51.4432;
const lon = -116.1616;
const LaD = 31.7583;
const LoV = -114.092;

function test1(latDeg, lonDeg, LaD, LoV) {
  const phi = latDeg * toRad;
  const lambda = lonDeg * toRad;
  const phi_p = LaD * toRad;
  const lambda_p = LoV * toRad;

  const sin_phi = Math.sin(phi);
  const cos_phi = Math.cos(phi);
  const sin_phi_p = Math.sin(phi_p);
  const cos_phi_p = Math.cos(phi_p);
  const d_lambda = lambda - lambda_p;

  const lat_r = Math.asin(sin_phi_p * sin_phi + cos_phi_p * cos_phi * Math.cos(d_lambda));
  const lon_r = Math.atan2(cos_phi * Math.sin(d_lambda), sin_phi_p * cos_phi * Math.cos(d_lambda) - cos_phi_p * sin_phi);
  
  return { lat: lat_r * toDeg, lon: lon_r * toDeg };
}

function test2(latDeg, lonDeg, LaD, LoV) {
  const phi = latDeg * toRad;
  const lambda = lonDeg * toRad;
  const phi_p = LaD * toRad;
  const lambda_p = LoV * toRad;

  const sin_phi = Math.sin(phi);
  const cos_phi = Math.cos(phi);
  const sin_phi_p = Math.sin(phi_p);
  const cos_phi_p = Math.cos(phi_p);
  const d_lambda = lambda - lambda_p;

  const lat_r = Math.asin(sin_phi_p * sin_phi - cos_phi_p * cos_phi * Math.cos(d_lambda));
  const lon_r = Math.atan2(cos_phi * Math.sin(d_lambda), sin_phi_p * cos_phi * Math.cos(d_lambda) + cos_phi_p * sin_phi);
  
  return { lat: lat_r * toDeg, lon: lon_r * toDeg };
}

function test3(latDeg, lonDeg, LaD, LoV) {
  // Assuming LaD/LoV is the South Pole
  const phi = latDeg * toRad;
  const lambda = lonDeg * toRad;
  const phi_s = LaD * toRad;
  const lambda_s = LoV * toRad;

  const lat_r = Math.asin(Math.sin(phi) * Math.sin(phi_s) + Math.cos(phi) * Math.cos(phi_s) * Math.cos(lambda - lambda_s));
  const lon_r = Math.atan2(Math.cos(phi) * Math.sin(lambda - lambda_s), Math.sin(phi_s) * Math.cos(phi) * Math.cos(lambda - lambda_s) - Math.cos(phi_s) * Math.sin(phi));
  
  return { lat: lat_r * toDeg, lon: lon_r * toDeg };
}

console.log("Test 1 (North Pole):", test1(lat, lon, LaD, LoV));
console.log("Test 2 (PROJ ob_tran):", test2(lat, lon, LaD, LoV));
console.log("Test 5 (PROJ ob_tran, South Pole):", test2(lat, lon, -LaD, LoV));


