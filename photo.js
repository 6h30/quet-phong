// ---------- Đo kích thước trên ảnh ----------
// Ảnh không có độ sâu, nên cần một mốc biết kích thước:
//  - Mốc thước: 2 điểm + chiều dài thật -> tỉ lệ mm/pixel (đúng cho ảnh chụp thẳng)
//  - Mặt phẳng 4 điểm: 4 góc một hình chữ nhật biết kích thước -> phép biến đổi phối cảnh
//    (homography), đo đúng mọi đoạn nằm trên mặt phẳng đó kể cả khi chụp xiên.
const $ = (s) => document.querySelector(s);
const cv = $('#pc'), wrap = $('#pcWrap'), lp = $('#loupe');
const st = { img: null, W: 0, H: 0, ref: null, plane: null, Hm: null, dims: [], tool: 'dim', pend: [], sel: -1, unit: 'mm' };
let view = { s: 1, ox: 0, oy: 0 };
try { st.unit = localStorage.getItem('quet-phong-unit') || 'mm'; } catch { /* bỏ qua */ }
$('#pUnit').value = st.unit;

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const toImg = (x, y) => ({ x: (x - view.ox) / view.s, y: (y - view.oy) / view.s });
const toScr = (p) => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });

// ---- Hình học ----
function solve(A, b) { // khử Gauss có chọn trụ
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  return solve(A, b);
}
const applyH = (h, p) => { const w = h[6] * p.x + h[7] * p.y + 1; return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }; };
// Xếp 4 điểm theo chiều kim đồng hồ, bắt đầu từ góc trên-trái
function orderQuad(p) {
  const cx = p.reduce((s, v) => s + v.x, 0) / 4, cy = p.reduce((s, v) => s + v.y, 0) / 4;
  const q = [...p].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let k = 0; q.forEach((v, i) => { if (v.x + v.y < q[k].x + q[k].y) k = i; });
  return [...q.slice(k), ...q.slice(0, k)];
}
function updatePlaneH() {
  const P = st.plane;
  st.Hm = P ? homography(P.pts, [{ x: 0, y: 0 }, { x: P.w, y: 0 }, { x: P.w, y: P.h }, { x: 0, y: P.h }]) : null;
}
// Chiều dài thật (m) của đoạn a-b, hoặc null nếu chưa có mốc
function realLen(a, b) {
  if (st.plane && st.Hm) return dist(applyH(st.Hm, a), applyH(st.Hm, b));
  if (st.ref) { const px = dist(st.ref.a, st.ref.b); return px > 0 ? dist(a, b) * st.ref.len / px : null; }
  return null;
}
function fmt(m) {
  if (m == null) return '?';
  if (st.unit === 'mm') return String(Math.round(m * 1000));
  if (st.unit === 'cm') return (m * 100).toFixed(1) + ' cm';
  return m.toFixed(2) + ' m';
}
const fmtMM = (m) => (st.unit === 'mm' ? String(Math.round(m * 1000)) : fmt(m));

// ---- Vẽ ----
// u = số pixel ảnh ứng với 1 "đơn vị nét" (trên màn hình: 1 px CSS; khi xuất: theo cỡ ảnh)
function tag(g, x, y, ang, text, u, bg) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.font = `700 ${15 * u}px system-ui, "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width + 10 * u, h = 21 * u;
  g.fillStyle = bg; g.beginPath();
  if (g.roundRect) g.roundRect(-w / 2, -h / 2, w, h, 4 * u); else g.rect(-w / 2, -h / 2, w, h);
  g.fill();
  g.fillStyle = '#fff'; g.fillText(text, 0, 1 * u);
  g.restore();
}
function dimLine(g, a, b, text, color, u, bold) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, tx = dx / L, ty = dy / L, nx = -ty, ny = tx;
  const stroke = (pts, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); g.lineTo(pts[2], pts[3]); g.stroke(); };
  const seg = [a.x, a.y, b.x, b.y], w = (bold ? 3.5 : 2.5) * u;
  g.lineCap = 'round';
  stroke(seg, w + 2.5 * u, 'rgba(0,0,0,.55)'); stroke(seg, w, color);
  for (const p of [a, b]) {
    const bar = [p.x - nx * 9 * u, p.y - ny * 9 * u, p.x + nx * 9 * u, p.y + ny * 9 * u];
    const tick = [p.x - (tx + nx) * 6 * u, p.y - (ty + ny) * 6 * u, p.x + (tx + nx) * 6 * u, p.y + (ty + ny) * 6 * u];
    stroke(bar, 2 * u + 2 * u, 'rgba(0,0,0,.55)'); stroke(bar, 2 * u, color);
    stroke(tick, 3 * u, color);
  }
  if (!text) return;
  let ang = Math.atan2(dy, dx);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  const ux = Math.sin(ang), uy = -Math.cos(ang); // hướng "lên" của chữ
  tag(g, (a.x + b.x) / 2 + ux * 15 * u, (a.y + b.y) / 2 + uy * 15 * u, ang, text, u, bold ? '#b42318' : 'rgba(20,28,40,.82)');
}
function drawAnn(g, u, screen) {
  const P = st.plane;
  if (P) {
    g.strokeStyle = '#2e9e5b'; g.lineWidth = 2.5 * u; g.setLineDash([10 * u, 6 * u]);
    g.beginPath(); P.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke(); g.setLineDash([]);
    const t = P.pts[0], r = P.pts[1];
    tag(g, (t.x + r.x) / 2, (t.y + r.y) / 2 - 16 * u, 0, `Mặt phẳng ${fmtMM(P.w)} × ${fmtMM(P.h)}`, u, 'rgba(46,158,91,.92)');
  }
  if (st.ref) dimLine(g, st.ref.a, st.ref.b, `Mốc ${fmtMM(st.ref.len)}`, '#2f80ed', u);
  st.dims.forEach((d, i) => dimLine(g, d.a, d.b, fmt(realLen(d.a, d.b)), i === st.sel && screen ? '#ffcc00' : '#ff3b30', u, i === st.sel && screen));
  if (!screen) return;
  const handle = (p, c) => { g.fillStyle = c; g.strokeStyle = '#000'; g.lineWidth = 1.5 * u; g.beginPath(); g.arc(p.x, p.y, 6 * u, 0, 7); g.fill(); g.stroke(); };
  handles().forEach((p) => handle(p, '#fff'));
  st.pend.forEach((p) => handle(p, '#ffcc00'));
  if (st.tool === 'plane' && st.pend.length > 1) {
    g.strokeStyle = '#ffcc00'; g.lineWidth = 2 * u; g.beginPath();
    st.pend.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  }
}
function handles() {
  const h = [];
  st.dims.forEach((d) => h.push(d.a, d.b));
  if (st.ref) h.push(st.ref.a, st.ref.b);
  if (st.plane) h.push(...st.plane.pts);
  return h;
}
let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(draw); }
function draw() {
  raf = 0;
  const dpr = devicePixelRatio || 1, cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (!cw || !ch) return;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  $('#pcEmpty').style.display = st.img ? 'none' : 'flex';
  if (st.img) {
    g.save(); g.translate(view.ox, view.oy); g.scale(view.s, view.s);
    g.imageSmoothingQuality = 'high'; g.drawImage(st.img, 0, 0);
    drawAnn(g, 1 / view.s, true);
    g.restore();
  }
  hint();
}
function drawLoupe(p) {
  const g = lp.getContext('2d'), S = lp.width, z = Math.max(view.s * 3, 0.6);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.save(); g.translate(S / 2, S / 2); g.scale(z, z); g.translate(-p.x, -p.y);
  g.drawImage(st.img, 0, 0); drawAnn(g, 2 / z, true); g.restore();
  g.strokeStyle = '#ffcc00'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(S / 2, S / 2 - 26); g.lineTo(S / 2, S / 2 + 26); g.moveTo(S / 2 - 26, S / 2); g.lineTo(S / 2 + 26, S / 2); g.stroke();
}
function showLoupe(p, sx, sy) {
  lp.style.display = 'block';
  const left = sx < 170 && sy < 170; // ngón tay đang che góc trái trên -> chuyển sang phải
  lp.style.left = left ? '' : '10px'; lp.style.right = left ? '10px' : '';
  drawLoupe(p);
}
function hint() {
  const el = $('#pHint');
  if (!st.img) { el.textContent = 'Chọn một ảnh để bắt đầu.'; return; }
  const cal = st.plane ? `Đã có mặt phẳng ${fmtMM(st.plane.w)}×${fmtMM(st.plane.h)}: đo đúng cho các đoạn nằm trên mặt đó.`
    : st.ref ? `Đã có mốc ${fmtMM(st.ref.len)}: đúng nhất với ảnh chụp thẳng, đoạn đo cùng mặt với mốc.`
    : 'Chưa có mốc nên chưa ra kích thước thật. Đặt Mốc thước hoặc Mặt phẳng 4 điểm trước.';
  if (st.tool === 'ref') el.textContent = `Mốc thước: chạm 2 đầu một vật biết kích thước (cửa, ô gạch, tờ A4…) ${st.pend.length}/2.`;
  else if (st.tool === 'plane') el.textContent = `Mặt phẳng: chạm 4 góc một hình chữ nhật biết kích thước nằm trên mặt cần đo ${st.pend.length}/4. Thứ tự nào cũng được.`;
  else el.textContent = `${cal} Chạm 2 điểm để đặt dim${st.pend.length ? ' (đã chọn 1 điểm)' : ''}. Kéo chấm trắng để chỉnh, chạm vào dim để chọn.`;
}

// ---- Thao tác ----
function setTool(t) {
  st.tool = t; st.pend = [];
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  render();
}
document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
const parseNums = (s) => (String(s || '').replace(/,/g, '.').match(/\d+(\.\d+)?/g) || []).map(Number);
function placePoint(p) {
  // bỏ qua chạm trùng điểm vừa chọn (tránh dim dài 0)
  if (st.pend.some((q) => dist(q, p) < 2 / view.s)) return;
  st.pend.push({ x: p.x, y: p.y });
  const need = st.tool === 'plane' ? 4 : 2;
  if (st.pend.length < need) { render(); return; }
  const pts = st.pend; st.pend = [];
  if (st.tool === 'dim') { st.dims.push({ a: pts[0], b: pts[1] }); st.sel = st.dims.length - 1; }
  else if (st.tool === 'ref') {
    const v = parseNums(prompt('Chiều dài thật của đoạn mốc (mm):', '900'))[0];
    if (v > 0) { st.ref = { a: pts[0], b: pts[1], len: v / 1000 }; st.plane = null; st.Hm = null; }
    setTool('dim');
  } else {
    const v = parseNums(prompt('Kích thước thật của hình chữ nhật, rộng x cao (mm)\nví dụ cửa: 900x2100, tờ A4 dọc: 210x297', '900x2100'));
    if (v[0] > 0 && v[1] > 0) {
      st.plane = { pts: orderQuad(pts), w: v[0] / 1000, h: v[1] / 1000 }; updatePlaneH();
      if (!st.Hm) { alert('4 điểm không tạo thành hình tứ giác hợp lệ, hãy chọn lại.'); st.plane = null; }
    }
    setTool('dim');
  }
  render();
}
function hitHandle(sx, sy) {
  let best = null, bd = 18;
  for (const p of handles()) { const q = toScr(p), d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = p; } }
  return best;
}
function hitDim(sx, sy) {
  let best = -1, bd = 14;
  st.dims.forEach((d, i) => {
    const a = toScr(d.a), b = toScr(d.b), ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((sx - a.x) * ex + (sy - a.y) * ey) / L2));
    const dd = Math.hypot(a.x + ex * t - sx, a.y + ey * t - sy);
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}
function fitView() {
  if (!st.img) return;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  view.s = Math.min(cw / st.W, ch / st.H) * 0.96;
  view.ox = (cw - st.W * view.s) / 2; view.oy = (ch - st.H * view.s) / 2;
  render();
}
function zoomAt(sx, sy, f) {
  const p = toImg(sx, sy), base = Math.min(wrap.clientWidth / st.W, wrap.clientHeight / st.H);
  view.s = Math.min(base * 40, Math.max(base * 0.5, view.s * f));
  view.ox = sx - p.x * view.s; view.oy = sy - p.y * view.s;
  render();
}

const ptrs = new Map();
let gest = null;
const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', (e) => {
  if (!st.img) return;
  try { cv.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
  const q = pos(e); ptrs.set(e.pointerId, q);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gest = { type: 'pinch', d0: Math.hypot(b.x - a.x, b.y - a.y), s0: view.s, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, o0: { x: view.ox, y: view.oy } };
    lp.style.display = 'none';
    return;
  }
  const h = hitHandle(q.x, q.y);
  gest = { type: h ? 'handle' : 'pan', h, sx: q.x, sy: q.y, o0: { x: view.ox, y: view.oy }, moved: false, h0: h && { x: h.x, y: h.y } };
});
cv.addEventListener('pointermove', (e) => {
  if (!gest || !ptrs.has(e.pointerId)) return;
  const q = pos(e); ptrs.set(e.pointerId, q);
  if (gest.type === 'pinch') {
    if (ptrs.size < 2) return;
    const [a, b] = [...ptrs.values()], d = Math.hypot(b.x - a.x, b.y - a.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const p = { x: (gest.m0.x - gest.o0.x) / gest.s0, y: (gest.m0.y - gest.o0.y) / gest.s0 };
    const base = Math.min(wrap.clientWidth / st.W, wrap.clientHeight / st.H);
    view.s = Math.min(base * 40, Math.max(base * 0.5, gest.s0 * d / (gest.d0 || 1)));
    view.ox = m.x - p.x * view.s; view.oy = m.y - p.y * view.s;
    render(); return;
  }
  if (!gest.moved && Math.hypot(q.x - gest.sx, q.y - gest.sy) < 6) return;
  gest.moved = true;
  if (gest.type === 'handle') {
    // di chuyển theo độ dời của ngón tay (không nhảy điểm về dưới ngón tay)
    gest.h.x = gest.h0.x + (q.x - gest.sx) / view.s; gest.h.y = gest.h0.y + (q.y - gest.sy) / view.s;
    if (st.plane && st.plane.pts.includes(gest.h)) updatePlaneH();
    showLoupe(gest.h, q.x, q.y);
  } else {
    view.ox = gest.o0.x + q.x - gest.sx; view.oy = gest.o0.y + q.y - gest.sy;
  }
  render();
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  const g0 = gest;
  if (ptrs.size > 0) { if (g0?.type === 'pinch') gest = { type: 'none' }; return; }
  gest = null; lp.style.display = 'none';
  if (!g0 || g0.type === 'pinch' || g0.type === 'none' || g0.moved || e.type === 'pointercancel') { render(); return; }
  // chạm nhẹ: chạm vào chấm -> dùng đúng điểm đó (nối dim liên tiếp); chạm vào dim -> chọn; còn lại -> đặt điểm
  if (g0.h) placePoint(g0.h);
  else {
    const i = st.pend.length ? -1 : hitDim(g0.sx, g0.sy);
    if (i >= 0) { st.sel = i === st.sel ? -1 : i; render(); } else placePoint(toImg(g0.sx, g0.sy));
  }
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', (e) => { if (!st.img) return; e.preventDefault(); const q = pos(e); zoomAt(q.x, q.y, e.deltaY > 0 ? 0.87 : 1.15); }, { passive: false });

$('#pFile').onchange = (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const url = URL.createObjectURL(f), img = new Image();
  img.onload = () => {
    if (st.img?.src?.startsWith('blob:')) URL.revokeObjectURL(st.img.src);
    Object.assign(st, { img, W: img.naturalWidth, H: img.naturalHeight, ref: null, plane: null, Hm: null, dims: [], pend: [], sel: -1 });
    setTool('ref');
    fitView();
  };
  img.onerror = () => alert('Không đọc được ảnh này. Hãy thử ảnh JPG hoặc PNG.');
  img.src = url;
  e.target.value = '';
};
$('#pUnit').onchange = (e) => { st.unit = e.target.value; try { localStorage.setItem('quet-phong-unit', st.unit); } catch { /* bỏ qua */ } render(); };
$('#pUndo').onclick = () => { if (st.pend.length) st.pend.pop(); else if (st.dims.length) { st.dims.pop(); st.sel = -1; } render(); };
$('#pDel').onclick = () => {
  if (st.sel >= 0) { st.dims.splice(st.sel, 1); st.sel = -1; render(); }
  else alert('Chạm vào một đường dim để chọn trước, rồi bấm Xóa.');
};
$('#pFit').onclick = fitView;
$('#pSave').onclick = () => {
  if (!st.img) { alert('Chưa có ảnh.'); return; }
  const k = Math.min(1, 4096 / Math.max(st.W, st.H)); // giới hạn cỡ canvas của Safari
  const c = document.createElement('canvas'); c.width = Math.round(st.W * k); c.height = Math.round(st.H * k);
  const g = c.getContext('2d'); g.scale(k, k); g.drawImage(st.img, 0, 0);
  drawAnn(g, Math.max(st.W, st.H) / 900, false);
  c.toBlob(async (blob) => {
    if (!blob) { alert('Không tạo được ảnh.'); return; }
    const file = new File([blob], 'anh-kich-thuoc.jpg', { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { // iPhone: mở bảng chia sẻ -> "Lưu hình ảnh"
      try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }, 'image/jpeg', 0.92);
};
// khung đổi kích thước (xoay máy, mở tab): vừa lại ảnh
let lastSize = '';
new ResizeObserver(() => {
  const s = wrap.clientWidth + 'x' + wrap.clientHeight;
  if (s !== lastSize && wrap.clientWidth) { lastSize = s; if (st.img) fitView(); }
  render();
}).observe(wrap);
render();
