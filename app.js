import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = (s) => document.querySelector(s);
const KEY = 'quet-phong-v1';

// ---------- Trạng thái ----------
// points: toạ độ mặt bằng tính bằng mét (x sang phải, y xuống dưới), là mép TRONG của tường.
const room = Object.assign({ points: [], closed: false, height: 2.7, thick: 0.2 }, load());
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(room)); } catch { /* bỏ qua */ } }

// ---------- Hình học ----------
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const edgeCount = () => (room.closed ? room.points.length : Math.max(0, room.points.length - 1));
const edge = (i) => [room.points[i], room.points[(i + 1) % room.points.length]];
function signedArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
function centroid(p) {
  const A = signedArea(p); let cx = 0, cy = 0;
  if (Math.abs(A) < 1e-9) return { x: p[0].x, y: p[0].y };
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], k = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * k; cy += (a.y + b.y) * k;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}
// Pháp tuyến hướng ra ngoài của cạnh i (đa giác kín)
function outNormal(p, i, sign) {
  const a = p[i], b = p[(i + 1) % p.length], d = dist(a, b) || 1;
  return { x: sign * (b.y - a.y) / d, y: -sign * (b.x - a.x) / d };
}
// Đẩy đa giác ra ngoài một khoảng d -> mép ngoài tường.
// Góc vuông/tù: nối thẳng (miter). Góc nhọn lồi (< 70°): vát góc, tránh mũi nhọn chĩa ra ngoài.
function offsetPolygon(p, d) {
  const n = p.length, sign = signedArea(p) >= 0 ? 1 : -1, out = [];
  for (let i = 0; i < n; i++) {
    const v = p[i], a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const n1 = outNormal(p, (i - 1 + n) % n, sign), n2 = outNormal(p, i, sign);
    const convex = ((v.x - a.x) * (b.y - v.y) - (v.y - a.y) * (b.x - v.x)) * sign > 0;
    const c = n1.x * n2.x + n1.y * n2.y; // = −cos(góc trong)
    if (convex && c < -0.34) {
      out.push({ x: v.x + d * n1.x, y: v.y + d * n1.y }, { x: v.x + d * n2.x, y: v.y + d * n2.y });
    } else {
      const k = Math.max(0.05, 1 + c);
      out.push({ x: v.x + d * (n1.x + n2.x) / k, y: v.y + d * (n1.y + n2.y) / k });
    }
  }
  return out;
}
// Góc trong (độ) tại đỉnh i của đa giác kín
function cornerAngle(p, i) {
  const n = p.length, v = p[i], a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
  const u1 = { x: a.x - v.x, y: a.y - v.y }, u2 = { x: b.x - v.x, y: b.y - v.y };
  const l1 = Math.hypot(u1.x, u1.y) || 1, l2 = Math.hypot(u2.x, u2.y) || 1;
  let ang = Math.acos(Math.max(-1, Math.min(1, (u1.x * u2.x + u1.y * u2.y) / (l1 * l2)))) * 180 / Math.PI;
  const convex = ((v.x - a.x) * (b.y - v.y) - (v.y - a.y) * (b.x - v.x)) * (signedArea(p) >= 0 ? 1 : -1) > 0;
  if (!convex) ang = 360 - ang;
  // hướng phân giác vào trong phòng
  let bx = u1.x / l1 + u2.x / l2, by = u1.y / l1 + u2.y / l2, bl = Math.hypot(bx, by);
  if (bl < 1e-6) { bx = -u1.y / l1; by = u1.x / l1; bl = 1; }
  const s = convex ? 1 : -1;
  return { ang, bis: { x: s * bx / bl, y: s * by / bl } };
}
function bounds(p) {
  const xs = p.map((v) => v.x), ys = p.map((v) => v.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const snap = (v) => ({ x: Math.round(v.x * 20) / 20, y: Math.round(v.y * 20) / 20 });

function setEdgeLength(i, L) {
  const p = room.points, n = p.length, j = (i + 1) % n, a = p[i], b = p[j], d = dist(a, b);
  if (!d || !(L > 0)) return;
  const dx = (b.x - a.x) / d * (L - d), dy = (b.y - a.y) / d * (L - d);
  if (j === 0) { b.x += dx; b.y += dy; } else for (let k = j; k < n; k++) { p[k].x += dx; p[k].y += dy; }
}

// Nắn các cạnh gần ngang/dọc thành vuông góc tuyệt đối (sai số quét AR thường vài độ)
// Xoay cả phòng để cạnh dài nhất nằm ngang
function alignLongest() {
  const p = room.points;
  if (p.length < 2) return;
  let best = 0, bl = 0;
  for (let i = 0; i < edgeCount(); i++) { const [a, b] = edge(i), l = dist(a, b); if (l > bl) { bl = l; best = i; } }
  const [a0, b0] = edge(best), th = -Math.atan2(b0.y - a0.y, b0.x - a0.x), c = Math.cos(th), s = Math.sin(th), o = { ...p[0] };
  p.forEach((v) => { const x = v.x - o.x, y = v.y - o.y; v.x = x * c - y * s; v.y = x * s + y * c; });
}
function scaleRoom(k) {
  const p = room.points, o = { ...p[0] };
  p.forEach((v) => { v.x = o.x + (v.x - o.x) * k; v.y = o.y + (v.y - o.y) * k; });
}
function orthogonalize() {
  const p = room.points, n = p.length;
  if (n < 2) return;
  alignLongest();
  const gx = p.map((_, i) => i), gy = p.map((_, i) => i);
  const find = (g, i) => (g[i] === i ? i : (g[i] = find(g, g[i])));
  for (let i = 0; i < edgeCount(); i++) {
    const j = (i + 1) % n, ang = Math.abs(Math.atan2(p[j].y - p[i].y, p[j].x - p[i].x) * 180 / Math.PI);
    // chỉ nắn cạnh lệch dưới 10° (sai số đo); tường xiên thật được giữ nguyên
    if (ang < 10 || ang > 170) gy[find(gy, i)] = find(gy, j);        // cạnh ngang: chung y
    else if (Math.abs(ang - 90) < 10) gx[find(gx, i)] = find(gx, j); // cạnh dọc: chung x
  }
  for (const [g, key] of [[gx, 'x'], [gy, 'y']]) {
    const sum = {}, cnt = {};
    p.forEach((v, i) => { const r = find(g, i); sum[r] = (sum[r] || 0) + v[key]; cnt[r] = (cnt[r] || 0) + 1; });
    p.forEach((v, i) => { const r = find(g, i); v[key] = Math.round(sum[r] / cnt[r] * 100) / 100; });
  }
}

// ---------- Mặt bằng 2D ----------
const svg = $('#plan');
let view = { x: -1, y: -1, w: 10, h: 8 };
let hover = null;

function aspect() { const r = svg.getBoundingClientRect(); return (r.height || 1) / (r.width || 1); }
function fit() {
  const asp = aspect();
  const b = room.points.length ? bounds(room.points) : { cx: 4, cy: 3, w: 8, h: 6 };
  const m = Math.max(b.w, b.h) * 0.2 + 0.8;
  let w = b.w + 2 * m, h = b.h + 2 * m;
  if (h / w < asp) h = w * asp; else w = h / asp;
  view = { x: b.cx - w / 2, y: b.cy - h / 2, w, h };
}
function zoom(f) {
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
  view.w = Math.min(200, Math.max(1.5, view.w * f)); view.h = view.w * aspect();
  view.x = cx - view.w / 2; view.y = cy - view.h / 2;
  renderPlan();
}
const f2 = (v) => v.toFixed(3);
const path = (p, close) => p.map((v, i) => `${i ? 'L' : 'M'}${f2(v.x)} ${f2(v.y)}`).join(' ') + (close ? ' Z' : '');

function renderPlan() {
  const p = room.points, n = p.length, { x, y, w, h } = view;
  svg.setAttribute('viewBox', `${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)}`);
  const fs = w / 48, r = w / 120, thin = 'vector-effect="non-scaling-stroke"';
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>`;

  if (w < 80) { // lưới 1 m
    let g = '';
    for (let i = Math.ceil(x); i <= x + w; i++) g += `M${i} ${f2(y)}V${f2(y + h)}`;
    for (let i = Math.ceil(y); i <= y + h; i++) g += `M${f2(x)} ${i}H${f2(x + w)}`;
    s += `<path d="${g}" stroke="#e6eaf0" stroke-width="1" fill="none" ${thin}/>`;
  }

  if (room.closed && n >= 3) {
    const outer = offsetPolygon(p, room.thick);
    s += `<path d="${path(outer, true)} ${path(p, true)}" fill="#4a5568" fill-rule="evenodd"/>`;
    s += `<path d="${path(p, true)}" fill="#fbf3e2" stroke="#1b2430" stroke-width="1.5" ${thin}/>`;
    s += `<path d="${path(outer, true)}" fill="none" stroke="#1b2430" stroke-width="1.5" ${thin}/>`;
  } else if (n >= 2) {
    s += `<path d="${path(p, false)}" fill="none" stroke="#1b2430" stroke-width="3" ${thin}/>`;
  }
  if (!room.closed && n && hover) {
    const a = p[n - 1];
    s += `<path d="M${a.x} ${a.y}L${hover.x} ${hover.y}" stroke="#e8792b" stroke-width="2" stroke-dasharray="6 5" fill="none" ${thin}/>`;
    s += label((a.x + hover.x) / 2, (a.y + hover.y) / 2 - fs, dist(a, hover).toFixed(2) + ' m', 0, fs, '#e8792b');
  }

  const sign = n >= 3 ? (signedArea(p) >= 0 ? 1 : -1) : 1;
  for (let i = 0; i < edgeCount(); i++) {
    const [a, b] = edge(i), nrm = outNormal(p, i, sign), k = room.closed ? -1.1 : 1.1;
    let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang <= -90) ang += 180;
    s += label((a.x + b.x) / 2 + nrm.x * fs * k, (a.y + b.y) / 2 + nrm.y * fs * k, dist(a, b).toFixed(2) + ' m', ang, fs, '#1f3a5f');
  }
  if (room.closed && n >= 3) {
    const c = centroid(p);
    s += label(c.x, c.y, Math.abs(signedArea(p)).toFixed(2) + ' m²', 0, fs * 1.5, '#8a5a1c');
    for (let i = 0; i < n; i++) { // ghi số độ ở các góc không vuông
      const { ang, bis } = cornerAngle(p, i);
      if (Math.abs(ang - 90) < 0.5 || Math.abs(ang - 270) < 0.5) continue;
      s += label(p[i].x + bis.x * fs * 2.2, p[i].y + bis.y * fs * 2.2, ang.toFixed(0) + '°', 0, fs * 0.85, '#b42318');
    }
  }
  p.forEach((v, i) => {
    const first = i === 0 && !room.closed && n >= 3;
    s += `<circle cx="${f2(v.x)}" cy="${f2(v.y)}" r="${first ? r * 1.6 : r}" fill="${first ? '#2e9e5b' : '#e8792b'}" stroke="#fff" stroke-width="1.5" ${thin}/>`;
  });
  svg.innerHTML = s;
}
function label(x, y, text, ang, fs, color) {
  return `<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(fs)}" font-family="system-ui,Segoe UI,sans-serif" font-weight="600" fill="${color}" text-anchor="middle" dominant-baseline="middle" stroke="#fff" stroke-width="${f2(fs / 4)}" paint-order="stroke" transform="rotate(${ang.toFixed(1)} ${f2(x)} ${f2(y)})">${text}</text>`;
}

function toPlan(e) {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: pt.x, y: pt.y };
}
let drag = null;
svg.addEventListener('pointerdown', (e) => {
  const q = toPlan(e), tol = view.w / 45;
  let hit = -1, bd = tol;
  room.points.forEach((v, i) => { const d = dist(v, q); if (d < bd) { bd = d; hit = i; } });
  drag = { sx: e.clientX, sy: e.clientY, hit, moved: false, v0: { ...view } };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (!room.closed && room.points.length && e.pointerType === 'mouse') { hover = snap(toPlan(e)); renderPlan(); }
    return;
  }
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
  if (!drag.moved) return;
  if (drag.hit >= 0) {
    Object.assign(room.points[drag.hit], snap(toPlan(e)));
    updateInfo();
  } else {
    const k = view.w / svg.getBoundingClientRect().width;
    view.x = drag.v0.x - (e.clientX - drag.sx) * k; view.y = drag.v0.y - (e.clientY - drag.sy) * k;
  }
  renderPlan();
});
svg.addEventListener('pointerup', (e) => {
  const d = drag; drag = null;
  if (!d) return;
  if (d.moved) { if (d.hit >= 0) commit(); return; }
  const q = toPlan(e), p = room.points;
  if (d.hit >= 0) {
    if (d.hit === 0 && !room.closed && p.length >= 3) { room.closed = true; hover = null; commit(); fit(); renderPlan(); }
    return;
  }
  for (let i = 0; i < edgeCount(); i++) { // bấm vào số đo để sửa chiều dài
    const [a, b] = edge(i), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (dist(m, q) < view.w / 22) {
      const v = prompt(`Chiều dài cạnh ${i + 1} (m):`, dist(a, b).toFixed(2));
      const L = v && parseFloat(v.replace(',', '.'));
      if (L > 0) {
        const whole = room.closed && confirm('Co giãn CẢ PHÒNG theo cạnh này?\n\nOK: co giãn toàn bộ (dùng khi cạnh này vừa đo lại bằng thước)\nHủy: chỉ sửa riêng cạnh này');
        if (whole) scaleRoom(L / dist(a, b)); else setEdgeLength(i, L);
        commit(); fit(); renderPlan();
      }
      return;
    }
  }
  if (!room.closed) { p.push(snap(q)); commit(); }
});
svg.addEventListener('pointerleave', () => { if (hover) { hover = null; renderPlan(); } });
svg.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 0.87); }, { passive: false });

function updateInfo() {
  const p = room.points, n = p.length;
  let per = 0; const li = [];
  for (let i = 0; i < edgeCount(); i++) { const [a, b] = edge(i), l = dist(a, b); per += l; li.push(`<li><span>Cạnh ${i + 1}</span><b>${l.toFixed(2)} m</b></li>`); }
  const area = room.closed && n >= 3 ? Math.abs(signedArea(p)) : 0;
  $('#stats').innerHTML =
    `<span>Diện tích sàn</span><b>${area.toFixed(2)} m²</b>` +
    `<span>Chu vi</span><b>${per.toFixed(2)} m</b>` +
    `<span>Diện tích tường</span><b>${(per * room.height).toFixed(2)} m²</b>` +
    `<span>Thể tích</span><b>${(area * room.height).toFixed(2)} m³</b>`;
  $('#walls').innerHTML = li.join('') || '<li><span style="color:#667085">Chưa có cạnh nào</span></li>';
  $('#hint').textContent = room.closed
    ? 'Kéo các góc để chỉnh · bấm vào số đo để nhập chiều dài chính xác · kéo nền để di chuyển'
    : n === 0 ? 'Bấm lên lưới để đặt góc phòng đầu tiên (mỗi ô = 1 m), hoặc quét bằng camera ở bước 1'
    : n < 3 ? 'Bấm tiếp để đặt các góc còn lại' : 'Bấm vào điểm xanh để khép kín phòng';
}
function commit() { save(); updateInfo(); renderPlan(); }

$('#zIn').onclick = () => zoom(0.8);
$('#zOut').onclick = () => zoom(1.25);
$('#zFit').onclick = () => { fit(); renderPlan(); };
$('#bUndo').onclick = () => { if (room.closed) room.closed = false; else room.points.pop(); commit(); };
$('#bClear').onclick = () => { if (!room.points.length || confirm('Xóa toàn bộ mặt bằng?')) { room.points = []; room.closed = false; fit(); commit(); } };
$('#bOrtho').onclick = () => { orthogonalize(); fit(); commit(); };
$('#bSample').onclick = () => {
  room.points = [[0, 0], [5, 0], [5, 3], [3.2, 3], [3.2, 4.5], [0, 4.5]].map(([x, y]) => ({ x, y }));
  room.closed = true; fit(); commit();
};
const inH = $('#inH'), inT = $('#inT');
inH.value = room.height; inT.value = room.thick;
inH.onchange = () => { room.height = Math.min(10, Math.max(1, parseFloat(inH.value) || 2.7)); inH.value = room.height; commit(); };
inT.onchange = () => { room.thick = Math.min(1, Math.max(0.05, parseFloat(inT.value) || 0.2)); inT.value = room.thick; commit(); };

// ---------- Xuất file ----------
function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toDXF() { // đơn vị mm, trục Y hướng lên
  const p = room.points, n = p.length, mm = (v) => (v * 1000).toFixed(1);
  let o = '0\nSECTION\n2\nENTITIES\n';
  const line = (a, b, layer) => { o += `0\nLINE\n8\n${layer}\n10\n${mm(a.x)}\n20\n${mm(-a.y)}\n11\n${mm(b.x)}\n21\n${mm(-b.y)}\n`; };
  const sign = n >= 3 ? (signedArea(p) >= 0 ? 1 : -1) : 1;
  for (let i = 0; i < edgeCount(); i++) {
    const [a, b] = edge(i), nrm = outNormal(p, i, sign), k = room.closed ? -0.25 : 0.25;
    line(a, b, 'TUONG_TRONG');
    let ang = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang <= -90) ang += 180;
    const t = Math.round(dist(a, b) * 1000) + '';
    const tx = (a.x + b.x) / 2 + nrm.x * k, ty = (a.y + b.y) / 2 + nrm.y * k;
    o += `0\nTEXT\n8\nKICH_THUOC\n10\n${mm(tx)}\n20\n${mm(-ty)}\n40\n120\n1\n${t}\n50\n${ang.toFixed(2)}\n72\n1\n11\n${mm(tx)}\n21\n${mm(-ty)}\n`;
  }
  if (room.closed && n >= 3) { const out = offsetPolygon(p, room.thick); out.forEach((a, i) => line(a, out[(i + 1) % out.length], 'TUONG_NGOAI')); }
  return o + '0\nENDSEC\n0\nEOF\n';
}
$('#xDXF').onclick = () => download('mat-bang.dxf', toDXF(), 'application/dxf');
$('#xSVG').onclick = () => download('mat-bang.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
$('#xJSON').onclick = () => download('mat-bang.json', JSON.stringify(room, null, 2), 'application/json');

// ---------- Khối 3D ----------
let v3 = null;
function init3D() {
  const canvas = $('#c3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe9edf2);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b1, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(6, 12, 4); scene.add(sun);
  const group = new THREE.Group(); scene.add(group);
  v3 = { renderer, scene, camera, controls, group, grid: null };
  (function loop() {
    requestAnimationFrame(loop);
    if (!$('#p-3d').classList.contains('on')) return;
    controls.update(); renderer.render(scene, camera);
  })();
}
function resize3D() {
  if (!v3) return;
  const c = $('#c3d'), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  v3.renderer.setSize(w, h, false); v3.camera.aspect = w / h; v3.camera.updateProjectionMatrix();
}
function build3D() {
  const { group, scene, camera, controls } = v3, p = room.points, n = p.length, H = room.height, T = room.thick;
  group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  group.clear();
  if (v3.grid) { scene.remove(v3.grid); v3.grid = null; }
  $('#empty3d').style.display = n < 2 ? 'flex' : 'none';
  if (n < 2) return;
  const glass = $('#chkGlass').checked;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9, side: THREE.DoubleSide, transparent: glass, opacity: glass ? 0.35 : 1, depthWrite: !glass });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x2b3442 });
  const addMesh = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat); m.name = name; group.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat); e.name = name + '_vien'; group.add(e);
    return m;
  };
  const shapeOf = (pts, Cls = THREE.Shape) => new Cls(pts.map((v) => new THREE.Vector2(v.x, -v.y)));

  if (room.closed && n >= 3) {
    const outer = offsetPolygon(p, T);
    const ring = shapeOf(outer); ring.holes.push(shapeOf(p, THREE.Path));
    const wall = new THREE.ExtrudeGeometry(ring, { depth: H, bevelEnabled: false }); wall.rotateX(-Math.PI / 2);
    addMesh(wall, wallMat, 'Tuong');
    const slab = new THREE.ExtrudeGeometry(shapeOf(outer), { depth: 0.1, bevelEnabled: false }); slab.rotateX(-Math.PI / 2); slab.translate(0, -0.1, 0);
    addMesh(slab, new THREE.MeshStandardMaterial({ color: 0xc9a777, roughness: 0.8 }), 'San');
  } else {
    for (let i = 0; i < n - 1; i++) {
      const a = p[i], b = p[i + 1], l = dist(a, b);
      const g = new THREE.BoxGeometry(l, H, T);
      g.rotateY(-Math.atan2(b.y - a.y, b.x - a.x)); g.translate((a.x + b.x) / 2, H / 2, (a.y + b.y) / 2);
      addMesh(g, wallMat, 'Tuong_' + (i + 1));
    }
  }
  const b = bounds(p), size = Math.max(b.w, b.h, H);
  const grid = new THREE.GridHelper(Math.ceil(size * 3), Math.ceil(size * 3), 0xb8c1cd, 0xd5dbe3);
  grid.position.set(Math.round(b.cx), -0.101, Math.round(b.cy)); scene.add(grid); v3.grid = grid;
  controls.target.set(b.cx, H / 3, b.cy);
  camera.position.set(b.cx + size * 0.9, size * 1.5 + H, b.cy + size * 1.5);
  controls.update();
}
$('#chkGlass').onchange = () => build3D();
$('#xGLB').onclick = () => {
  if (room.points.length < 2) return;
  new GLTFExporter().parse(v3.group, (buf) => download('phong-3d.glb', new Blob([buf], { type: 'model/gltf-binary' })), (e) => alert('Lỗi xuất GLB: ' + e), { binary: true });
};

// ---------- Tab ----------
function show(tab) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((s) => s.classList.toggle('on', s.id === 'p-' + tab));
  if (tab === 'plan') { view.h = view.w * aspect(); renderPlan(); }
  if (tab === '3d') { if (!v3) init3D(); resize3D(); build3D(); }
}
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
addEventListener('resize', () => { view.h = view.w * aspect(); renderPlan(); resize3D(); });

// ---------- Quét AR (WebXR hit-test) ----------
const arStart = $('#arStart'), arStatus = $('#arStatus');
(async () => {
  let ok = false;
  try { ok = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')); } catch { /* không hỗ trợ */ }
  if (ok) {
    arStart.disabled = false; arStatus.classList.add('ok');
    arStatus.textContent = 'Thiết bị hỗ trợ AR. Nên quét ở nơi đủ sáng, sàn có hoa văn sẽ nhận nhanh hơn.';
  } else if (!isSecureContext) {
    arStatus.textContent = 'Camera AR chỉ chạy khi trang được mở qua HTTPS. Bạn vẫn có thể vẽ tay ở bước 2.';
  } else {
    arStatus.textContent = 'Trình duyệt này không hỗ trợ quét AR (cần Chrome trên Android có ARCore). Bạn vẫn có thể vẽ tay mặt bằng ở bước 2 rồi xem khối 3D.';
  }
})();

let ar = null;
function textSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,28,40,.85)'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#fff'; g.font = '600 52px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(0.3, 0.1125, 1); sp.renderOrder = 10;
  return sp;
}
function arRedraw() {
  const { marks, pts, closed } = ar;
  marks.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
  marks.clear();
  pts.forEach((v, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: i ? 0xe8792b : 0x2e9e5b }));
    m.position.copy(v); marks.add(m);
  });
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffffff }));
    ln.frustumCulled = false; marks.add(ln);
    const sp = textSprite(a.distanceTo(b).toFixed(2) + ' m');
    sp.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0, 0.08, 0)); marks.add(sp);
  }
}
async function startAR() {
  const overlay = $('#arOverlay'); overlay.classList.add('on');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
  } catch (e) { overlay.classList.remove('on'); alert('Không mở được chế độ AR: ' + e.message); return; }

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.xr.enabled = true;
  renderer.domElement.className = 'ar-canvas'; document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.01, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcc00 })); reticle.add(dot);
  const marks = new THREE.Group(); scene.add(marks);
  const live = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffcc00 }));
  live.frustumCulled = false; live.visible = false; scene.add(live);

  ar = { session, renderer, marks, pts: [], closed: false, cur: new THREE.Vector3(), has: false };
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewer });
  session.addEventListener('end', endAR);

  const info = $('#arInfo');
  renderer.setAnimationLoop((t, frame) => {
    if (frame && ar) {
      const hits = frame.getHitTestResults(hitSource), ref = renderer.xr.getReferenceSpace();
      const pose = hits.length && hits[0].getPose(ref);
      ar.has = !!pose; reticle.visible = ar.has;
      if (pose) {
        reticle.matrix.fromArray(pose.transform.matrix); ar.cur.setFromMatrixPosition(reticle.matrix);
        const n = ar.pts.length;
        live.visible = n > 0 && !ar.closed;
        if (live.visible) { live.geometry.setFromPoints([ar.pts[n - 1], ar.cur]); }
        if (ar.closed) info.textContent = 'Đã khép phòng. Bấm Xong để xem mặt bằng.';
        else if (!n) info.textContent = 'Ngắm vào góc tường sát sàn rồi bấm Thêm góc';
        else if (n >= 3 && ar.cur.distanceTo(ar.pts[0]) < 0.2) info.textContent = 'Bấm Thêm góc để khép kín phòng';
        else info.textContent = `Cạnh đang đo: ${ar.cur.distanceTo(ar.pts[n - 1]).toFixed(2)} m · đã có ${n} góc`;
      } else info.textContent = 'Lia chậm điện thoại để tìm mặt sàn…';
    }
    renderer.render(scene, camera);
  });
}
function endAR() {
  const a = ar; if (!a) return; ar = null;
  a.renderer.setAnimationLoop(null); a.renderer.dispose(); a.renderer.domElement.remove();
  $('#arOverlay').classList.remove('on');
  if (a.pts.length >= 2) {
    const x0 = Math.min(...a.pts.map((v) => v.x)), z0 = Math.min(...a.pts.map((v) => v.z));
    room.points = a.pts.map((v) => ({ x: Math.round((v.x - x0) * 100) / 100, y: Math.round((v.z - z0) * 100) / 100 }));
    room.closed = a.closed || a.pts.length >= 3;
    show('plan'); fit(); commit();
  }
}
arStart.onclick = startAR;
$('#arAdd').onclick = () => {
  if (!ar || !ar.has || ar.closed) return;
  if (ar.pts.length >= 3 && ar.cur.distanceTo(ar.pts[0]) < 0.2) ar.closed = true;
  else { const v = ar.cur.clone(); if (ar.pts.length) v.y = ar.pts[0].y; ar.pts.push(v); }
  arRedraw();
};
$('#arUndo').onclick = () => { if (!ar) return; if (ar.closed) ar.closed = false; else ar.pts.pop(); arRedraw(); };
$('#arDone').onclick = () => ar && ar.session.end();

// ---------- Quét bằng góc nghiêng: camera + cảm biến (chạy trên Safari iPhone) ----------
// Đứng yên một chỗ, camera ở độ cao h. Ngắm vào góc chân tường dưới góc chúc θ
// => khoảng cách ngang d = h / tan θ, hướng lấy từ con quay hồi chuyển.
const tiltStatus = $('#tiltStatus'), inCamH = $('#inCamH'), DEG = Math.PI / 180;
try { const v = parseFloat(localStorage.getItem(KEY + '-camh')); if (v) inCamH.value = v; } catch { /* bỏ qua */ }
const tiltOK = !!navigator.mediaDevices?.getUserMedia && 'DeviceOrientationEvent' in window;
if (!isSecureContext) tiltStatus.textContent = 'Camera chỉ chạy khi trang được mở qua HTTPS.';
else if (!tiltOK) tiltStatus.textContent = 'Trình duyệt này không có camera hoặc cảm biến nghiêng. Bạn vẫn có thể vẽ tay ở bước 2.';
else {
  tiltStatus.classList.add('ok');
  tiltStatus.textContent = 'Sẵn sàng. Sai số thường 3–5% khoảng cách. Đo lại một cạnh bằng thước rồi bấm vào số đo ở mặt bằng để nhập, cả phòng sẽ co giãn đúng theo.';
}

let tilt = null;
// Ma trận quay thiết bị -> trái đất (x đông, y bắc, z lên), từ góc Euler alpha-beta-gamma của W3C
function rotMatrix(e) {
  const a = e.alpha * DEG, b = e.beta * DEG, g = (e.gamma || 0) * DEG;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return [
    cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];
}
function onOrient(e) {
  if (!tilt || e.alpha == null || e.beta == null) return;
  const R = rotMatrix(e), d = [-R[2], -R[5], -R[8]]; // camera sau nhìn theo trục −z của máy
  tilt.R = R;
  if (tilt.capture) tilt.capture.push(d);
  if (!tilt.sm) tilt.sm = d.slice(); else for (let i = 0; i < 3; i++) tilt.sm[i] = tilt.sm[i] * 0.75 + d[i] * 0.25; // làm mượt
}
// Từ một hướng nhìn: góc ngẩng/chúc, hướng ngang trên mặt bằng, và điểm chạm sàn (nếu chúc xuống)
function readingFrom(v) {
  const [x, y, z] = v, hl = Math.hypot(x, y) || 1e-6, st = tilt.station;
  const elev = Math.atan2(z, hl); // âm = chúc xuống
  const dir = { x: x / hl, y: -y / hl }; // mặt bằng: x sang phải, y xuống dưới
  let floor = null;
  if (elev < -4 * DEG) {
    const d = tilt.h / Math.tan(-elev);
    if (d < 25) floor = { x: st.x + dir.x * d, y: st.y + dir.y * d, d };
  }
  return { elev, dir, floor };
}
const median = (a) => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ceilH = () => (tilt.ceils.length ? median(tilt.ceils) : null);

// Mốc để đo trần theo hướng đang nhìn: ưu tiên mốc người dùng đặt, sau đó tới bức tường đã đo.
// Trả về { d: khoảng cách ngang, foot: chân mốc trên sàn, src } hoặc lỗi.
function ceilTarget(r) {
  const st = tilt.station;
  if (tilt.mark) {
    const vx = tilt.mark.x - st.x, vy = tilt.mark.y - st.y, L = Math.hypot(vx, vy);
    const off = Math.acos(Math.max(-1, Math.min(1, (vx * r.dir.x + vy * r.dir.y) / (L || 1)))) / DEG;
    if (off > 12) return { err: 'off', off };
    return { d: L * Math.cos(off * DEG), foot: tilt.mark, src: 'mark' };
  }
  const p = tilt.pts, n = p.length;
  let best = null, wall = -1;
  for (let i = 0; i < (n >= 3 ? n : n - 1); i++) {
    const a = p[i], b = p[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y;
    const den = r.dir.x * ey - r.dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const wx = a.x - st.x, wy = a.y - st.y;
    const t = (wx * ey - wy * ex) / den, u = (wx * r.dir.y - wy * r.dir.x) / den;
    if (t > 0.2 && u > -0.05 && u < 1.05 && (best == null || t < best)) { best = t; wall = i; }
  }
  if (best == null) return { err: 'none' };
  return { d: best, foot: { x: st.x + r.dir.x * best, y: st.y + r.dir.y * best }, src: 'wall', wall };
}

// Lấy trung bình hướng nhìn trong 0,45 s để số đo không bị rung tay
function steady(cb) {
  if (!tilt?.sm || tilt.capture) return;
  tilt.capture = [];
  setTimeout(() => {
    if (!tilt) return;
    const c = tilt.capture; tilt.capture = null;
    let v = tilt.sm.slice();
    if (c.length >= 3) { v = [0, 0, 0]; c.forEach((d) => { for (let i = 0; i < 3; i++) v[i] += d[i]; }); }
    cb(readingFrom(v));
    try { navigator.vibrate?.(30); } catch { /* bỏ qua */ }
  }, 450);
}

// ---- Vẽ chồng lên hình camera: chân tường, mốc, đường trần (chiếu từ góc nghiêng của máy) ----
const FOV_LONG = 67 * DEG; // góc nhìn theo cạnh dài của camera chính điện thoại (xấp xỉ)
function drawOverlay(r, tgt) {
  const cv = $('#tiltAR'), video = $('#tiltVideo'), dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const vw = video.videoWidth, vh = video.videoHeight, R = tilt.R;
  if (!vw || !vh || !R) return;
  const f = (Math.max(vw, vh) / 2) / Math.tan(FOV_LONG / 2) * Math.max(W / vw, H / vh) * (tilt.zoom ? 2 : 1);
  const ang = ((screen.orientation?.angle ?? window.orientation ?? 0) * DEG);
  const ca = Math.cos(ang), sa = Math.sin(ang), st = tilt.station, h = tilt.h;
  // điểm mặt bằng (x, y) ở độ cao z -> toạ độ máy
  const dev = (x, y, z) => {
    const vx = x - st.x, vy = -(y - st.y), vz = z - h;
    return [R[0] * vx + R[3] * vy + R[6] * vz, R[1] * vx + R[4] * vy + R[7] * vz, R[2] * vx + R[5] * vy + R[8] * vz];
  };
  const scr = (q) => {
    const depth = -q[2], u = f * q[0] / depth, v = f * q[1] / depth;
    return [W / 2 + (u * ca - v * sa), H / 2 - (u * sa + v * ca)];
  };
  const NEAR = 0.15;
  const seg = (A, B) => { // cắt bỏ phần nằm sau lưng camera
    let a = dev(...A), b = dev(...B);
    const da = -a[2], db = -b[2];
    if (da < NEAR && db < NEAR) return null;
    if (da < NEAR) { const t = (NEAR - da) / (db - da); a = a.map((x, i) => x + (b[i] - x) * t); }
    if (db < NEAR) { const t = (NEAR - db) / (da - db); b = b.map((x, i) => x + (a[i] - x) * t); }
    return [scr(a), scr(b)];
  };
  const line = (A, B, color, w, dash) => {
    const s = seg(A, B); if (!s) return;
    g.setLineDash(dash || []); g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = w + 3; g.beginPath(); g.moveTo(...s[0]); g.lineTo(...s[1]); g.stroke();
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(...s[0]); g.lineTo(...s[1]); g.stroke();
    g.setLineDash([]);
  };
  const dot = (P, color, rad, text) => {
    const q = dev(...P); if (-q[2] < NEAR) return;
    const [x, y] = scr(q);
    g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); g.stroke();
    if (text) {
      g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, x + rad + 5, y); g.fillStyle = '#fff'; g.fillText(text, x + rad + 5, y);
    }
  };
  const p = tilt.pts, n = p.length, CH = ceilH();
  const m = n >= 3 ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = p[i], b = p[(i + 1) % n], hi = tgt && tgt.src === 'wall' && tgt.wall === i;
    line([a.x, a.y, 0], [b.x, b.y, 0], hi ? '#ffcc00' : '#fff', hi ? 4 : 3);
    if (CH) line([a.x, a.y, CH], [b.x, b.y, CH], 'rgba(255,255,255,.8)', 2, [8, 6]);
  }
  p.forEach((v, i) => {
    if (CH) line([v.x, v.y, 0], [v.x, v.y, CH], 'rgba(255,255,255,.6)', 2, [4, 6]);
    dot([v.x, v.y, 0], i === n - 1 && tilt.relocate ? '#ffcc00' : i ? '#e8792b' : '#2e9e5b', i === n - 1 && tilt.relocate ? 10 : 7, String(i + 1));
  });
  // mốc đo trần: vạch đứng màu cam từ chân tường lên
  if (tilt.mark) {
    const k = tilt.mark;
    line([k.x, k.y, 0], [k.x, k.y, Math.max(3.5, (CH || 0) + 0.5)], '#ff7a1a', 4);
    dot([k.x, k.y, 0], '#ff7a1a', 9, 'MỐC');
  }
  // khi đang ngẩng lên: vạch vàng từ chân mốc tới chỗ đang ngắm
  if (tgt && tgt.foot && r.elev > 0) {
    const Hn = h + tgt.d * Math.tan(r.elev);
    line([tgt.foot.x, tgt.foot.y, 0], [tgt.foot.x, tgt.foot.y, Hn], '#ffcc00', 3);
  }
  // khi đang chúc xuống: điểm sẽ được thêm
  if (r.floor && !tilt.capture) dot([r.floor.x, r.floor.y, 0], '#ffcc00', 5);
}

function drawTiltMap(cur, tgt) {
  const cv = $('#tiltMap'), g = cv.getContext('2d'), W = cv.width, { pts, stations, station } = tilt;
  g.clearRect(0, 0, W, W);
  const all = [...pts, ...stations, ...(cur ? [cur] : []), ...(tilt.mark ? [tilt.mark] : [])];
  const b = bounds(all), s = Math.max(2, b.w, b.h) * 1.15, k = (W - 24) / s;
  const P = (v) => [W / 2 + (v.x - b.cx) * k, W / 2 + (v.y - b.cy) * k];
  const n = pts.length;
  for (let i = 0; i < (n >= 3 ? n : n - 1); i++) {
    const hi = tgt && tgt.src === 'wall' && tgt.wall === i;
    g.strokeStyle = hi ? '#ffcc00' : '#fff'; g.lineWidth = hi ? 6 : 3;
    g.beginPath(); g.moveTo(...P(pts[i])); g.lineTo(...P(pts[(i + 1) % n])); g.stroke();
  }
  if (cur) { g.strokeStyle = '#ffcc00'; g.lineWidth = 2; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(...P(station)); g.lineTo(...P(cur)); g.stroke(); g.setLineDash([]); }
  pts.forEach((v, i) => {
    const last = i === n - 1 && tilt.relocate;
    g.fillStyle = last ? '#ffcc00' : i ? '#e8792b' : '#2e9e5b';
    g.beginPath(); g.arc(...P(v), last ? 11 : 7, 0, 7); g.fill();
  });
  if (tilt.mark) { g.fillStyle = '#ff7a1a'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(...P(tilt.mark), 9, 0, 7); g.fill(); g.stroke(); }
  stations.forEach((v) => { g.fillStyle = v === station ? '#4da3ff' : 'rgba(77,163,255,.45)'; g.beginPath(); g.arc(...P(v), v === station ? 9 : 6, 0, 7); g.fill(); });
}
function updateTiltButtons() {
  $('#tiltAdd').textContent = tilt?.relocate ? 'Xác nhận chỗ đứng' : '+ Thêm góc';
  $('#tiltMove').classList.toggle('on', !!tilt?.relocate);
  $('#tiltCeil').disabled = !!tilt?.relocate;
}
function tiltLoop() {
  if (!tilt) return;
  requestAnimationFrame(tiltLoop);
  const info = $('#tiltInfo'), n = tilt.pts.length, ceilBtn = $('#tiltCeil');
  if (!tilt.sm) {
    info.textContent = performance.now() - tilt.t0 > 2500 ? 'Không nhận được cảm biến nghiêng. Hãy cho phép “Chuyển động & hướng” rồi thử lại.' : 'Đang chờ cảm biến…';
    return;
  }
  const r = readingFrom(tilt.sm), up = r.elev > 4 * DEG;
  const tgt = up ? ceilTarget(r) : null;
  ceilBtn.textContent = up ? 'Đo trần' : tilt.mark ? 'Đặt lại mốc' : 'Đặt mốc trần';
  const CH = ceilH(), ceilTxt = CH ? ` · trần ${CH.toFixed(2)} m (${tilt.ceils.length} lần)` : '';
  if (tilt.capture) info.innerHTML = '<b>Giữ yên máy…</b>';
  else if (tilt.relocate) {
    info.innerHTML = 'Đã đổi chỗ. Ngắm lại <b>góc cuối cùng</b> (chấm vàng) rồi bấm <b>Xác nhận chỗ đứng</b>'
      + (r.floor ? `<br>cách ${r.floor.d.toFixed(2)} m` : '');
  } else if (up) {
    const a = `Ngẩng ${(r.elev / DEG).toFixed(0)}°`;
    if (tgt.err === 'off') info.innerHTML = `${a} · lệch mốc ${tgt.off.toFixed(0)}°<br>Xoay về <b>vạch cam MỐC</b> rồi ngẩng thẳng lên mép trần`;
    else if (tgt.err) info.innerHTML = `${a} · chưa có mốc<br>Chúc xuống <b>chân tường</b> ngay dưới mép trần, bấm <b>Đặt mốc trần</b>${ceilTxt}`;
    else info.innerHTML = `${a} · ${tgt.src === 'mark' ? 'mốc' : 'tường'} cách ${tgt.d.toFixed(2)} m<br>trần <b>${(tilt.h + tgt.d * Math.tan(r.elev)).toFixed(2)} m</b> → đưa dấu + lên mép trần, bấm <b>Đo trần</b>${ceilTxt}`;
  } else if (r.floor) {
    let t = `Chúc ${(-r.elev / DEG).toFixed(0)}° · cách <b>${r.floor.d.toFixed(2)} m</b>`;
    if (n) t += ` · cạnh ${dist(tilt.pts[n - 1], r.floor).toFixed(2)} m`;
    if (tilt.mark) t += '<br>Đã có MỐC: ngẩng theo vạch cam lên mép trần';
    else t += `<br>${n} góc${ceilTxt}`;
    info.innerHTML = t;
  } else {
    info.innerHTML = `Chúc camera xuống, ngắm dấu + vào góc chân tường<br>${n} góc${ceilTxt}`;
  }
  drawOverlay(r, tgt && !tgt.err ? tgt : null);
  drawTiltMap(r.floor, tgt && !tgt.err ? tgt : null);
}
async function startTilt() {
  const h = parseFloat(String(inCamH.value).replace(',', '.'));
  if (!(h >= 0.5 && h <= 2.5)) { alert('Nhập độ cao camera từ 0,5 đến 2,5 m.'); return; }
  try { localStorage.setItem(KEY + '-camh', h); } catch { /* bỏ qua */ }
  // Cả hai yêu cầu quyền phải gọi ngay trong cú bấm (Safari bắt buộc)
  const permP = typeof DeviceOrientationEvent.requestPermission === 'function' ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
  const camP = navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  const [perm, cam] = await Promise.allSettled([permP, camP]);
  if (cam.status !== 'fulfilled') { alert('Không mở được camera: ' + (cam.reason?.message || cam.reason)); return; }
  if (perm.status !== 'fulfilled' || perm.value !== 'granted') {
    cam.value.getTracks().forEach((t) => t.stop());
    alert('Cần cho phép truy cập “Chuyển động & hướng” để đo góc nghiêng. Tải lại trang và bấm Cho phép.');
    return;
  }
  const video = $('#tiltVideo'); video.srcObject = cam.value; video.style.transform = '';
  video.play().catch(() => { /* đã autoplay */ });
  const station = { x: 0, y: 0 };
  tilt = { h, stream: cam.value, pts: [], ceils: [], hist: [], station, stations: [station], mark: null, relocate: false, capture: null, zoom: false, sm: null, R: null, t0: performance.now() };
  addEventListener('deviceorientation', onOrient);
  $('#tilt').classList.add('on'); $('#tiltZoom').classList.remove('on');
  updateTiltButtons();
  tiltLoop();
}
function stopTilt(keep) {
  const t = tilt; if (!t) return; tilt = null;
  removeEventListener('deviceorientation', onOrient);
  t.stream.getTracks().forEach((x) => x.stop());
  $('#tiltVideo').srcObject = null;
  $('#tilt').classList.remove('on');
  if (!keep) return;
  if (t.ceils.length) { room.height = Math.round(median(t.ceils) * 100) / 100; inH.value = room.height; }
  if (t.pts.length < 2) { if (t.ceils.length) commit(); return; }
  room.points = t.pts.map((v) => ({ x: v.x, y: v.y }));
  room.closed = t.pts.length >= 3;
  alignLongest();
  const x0 = Math.min(...room.points.map((v) => v.x)), y0 = Math.min(...room.points.map((v) => v.y));
  room.points.forEach((v) => { v.x = Math.round((v.x - x0) * 100) / 100; v.y = Math.round((v.y - y0) * 100) / 100; });
  show('plan'); fit(); commit();
}
$('#tiltStart').onclick = () => { if (tiltOK && isSecureContext) startTilt(); else alert(tiltStatus.textContent); };
$('#tiltAdd').onclick = () => steady((r) => {
  if (!r.floor) { alert('Hãy chúc camera xuống và ngắm vào góc chân tường trên sàn.'); return; }
  if (tilt.relocate) { // chỗ đứng mới = góc cuối cùng − vectơ từ chỗ đứng tới góc đó
    const ref = tilt.pts[tilt.pts.length - 1], prev = tilt.station;
    tilt.station = { x: ref.x - (r.floor.x - prev.x), y: ref.y - (r.floor.y - prev.y) };
    tilt.stations.push(tilt.station);
    tilt.hist.push({ type: 'st', prev, mark: tilt.mark });
    tilt.mark = null; // mốc cũ đo từ chỗ đứng cũ
    tilt.relocate = false; updateTiltButtons();
  } else {
    tilt.pts.push({ x: r.floor.x, y: r.floor.y });
    tilt.hist.push({ type: 'pt' });
  }
});
// Đo trần 2 bước: (1) chúc xuống chân tường -> đặt MỐC; (2) ngẩng theo vạch cam lên mép trần -> Đo trần
$('#tiltCeil').onclick = () => {
  if (!tilt?.sm) return;
  steady((r) => {
    if (r.floor) { // bước 1
      tilt.hist.push({ type: 'mark', prev: tilt.mark });
      tilt.mark = { x: r.floor.x, y: r.floor.y };
      return;
    }
    if (r.elev < 4 * DEG) { alert('Chúc xuống chân tường để đặt mốc, hoặc ngẩng lên mép trần để đo.'); return; }
    const t = ceilTarget(r);
    if (t.err === 'off') { alert(`Đang lệch mốc ${t.off.toFixed(0)}°. Xoay về vạch cam MỐC rồi ngẩng thẳng lên mép trần.`); return; }
    if (t.err) { alert('Chưa có mốc. Chúc xuống chân tường ngay dưới chỗ định đo, bấm “Đặt mốc trần”, rồi ngẩng lên mép trần.'); return; }
    tilt.ceils.push(tilt.h + t.d * Math.tan(r.elev));
    tilt.hist.push({ type: 'ceil', mark: tilt.mark });
    tilt.mark = null;
  });
};
$('#tiltMove').onclick = () => {
  if (!tilt) return;
  if (!tilt.pts.length) { alert('Đo ít nhất một góc trước khi đổi chỗ đứng.'); return; }
  tilt.relocate = !tilt.relocate; updateTiltButtons();
};
$('#tiltZoom').onclick = () => {
  if (!tilt) return;
  tilt.zoom = !tilt.zoom;
  $('#tiltVideo').style.transform = tilt.zoom ? 'scale(2)' : '';
  $('#tiltZoom').classList.toggle('on', tilt.zoom);
};
$('#tiltUndo').onclick = () => {
  if (!tilt) return;
  if (tilt.relocate) { tilt.relocate = false; updateTiltButtons(); return; }
  const h = tilt.hist.pop(); if (!h) return;
  if (h.type === 'pt') tilt.pts.pop();
  else if (h.type === 'ceil') { tilt.ceils.pop(); tilt.mark = h.mark; }
  else if (h.type === 'mark') tilt.mark = h.prev;
  else { tilt.stations.pop(); tilt.station = h.prev; tilt.mark = h.mark; }
};
$('#tiltDone').onclick = () => stopTilt(true);

// ---------- Khởi động ----------
fit(); updateInfo(); renderPlan();
if (!room.points.length) show('scan');
