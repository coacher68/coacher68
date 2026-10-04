// Scene 3: daytime planning calendar lying on a desk in soft window light.
import * as THREE from 'three';
import { canvas, makeNoise2, fbm } from './textures.js';
import { seg, lerp, easeInOutSine, easeOutCubic, easeInOutCubic, smooth, clamp } from './timeline.js';

export const GREEN = '#11a84b';
const TW = 2560, TH = 1440;          // sheet texture size (px)
const SW = 16, SH = 9;               // sheet size (world units)

// Calendar layout (texture px)
export const CAL = {
  gutter: 250, colX0: 262, colW: 318, colGap: 0, headerTop: 56, gridTop: 352, rowH: 100, hours: 10, startHour: 8,
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], dates: [13, 14, 15, 16, 17, 18, 19],
  repairDay: 1, failDay: 5,
};
export function colX(i) { return CAL.colX0 + i * CAL.colW; }
export function hourY(h) { return CAL.gridTop + (h - CAL.startHour) * CAL.rowH; }

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function hazardIcon(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.48); ctx.lineTo(s * 0.52, s * 0.42); ctx.lineTo(-s * 0.52, s * 0.42); ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-s * 0.05, -s * 0.18, s * 0.1, s * 0.34, s * 0.05); ctx.fill();
  ctx.beginPath(); ctx.arc(0, s * 0.27, s * 0.065, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function wrenchIcon(ctx, cx, cy, s, color, bg) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-s * 0.085, -s * 0.12, s * 0.17, s * 0.62, s * 0.085); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -s * 0.26, s * 0.215, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(-s * 0.08, -s * 0.56, s * 0.16, s * 0.3, s * 0.03); ctx.fill();
  ctx.restore();
}

export class Calendar {
  constructor(renderer) {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd3d8db);
    this.camera = new THREE.PerspectiveCamera(24, 16 / 9, 0.1, 300);

    // desk
    this.deskCanvas = this.makeDesk();
    const deskTex = new THREE.CanvasTexture(this.deskCanvas);
    deskTex.colorSpace = THREE.SRGBColorSpace; deskTex.anisotropy = 8;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), new THREE.MeshBasicMaterial({ map: deskTex }));
    desk.rotation.x = -Math.PI / 2; desk.position.y = -0.02;
    scene.add(desk);

    // sheet shadow
    const sh = canvas(512, 320), sctx = sh.getContext('2d');
    sctx.filter = 'blur(18px)';
    sctx.fillStyle = 'rgba(20,28,34,0.55)';
    sctx.beginPath(); sctx.roundRect(60, 60, 392, 200, 20); sctx.fill();
    const shTex = new THREE.CanvasTexture(sh); shTex.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(SW * 1.3, SH * 1.48), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.25, -0.01, 0.45);
    scene.add(shadow);

    // sheet
    this.sheetCanvas = canvas(TW, TH);
    this.sheetTex = new THREE.CanvasTexture(this.sheetCanvas);
    this.sheetTex.colorSpace = THREE.SRGBColorSpace; this.sheetTex.anisotropy = 16;
    this.sheetTex.minFilter = THREE.LinearMipmapLinearFilter;
    const sheet = this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: this.sheetTex }));
    sheet.rotation.x = -Math.PI / 2;
    scene.add(sheet);

    this.lightCanvas = this.makeSheetLight();
    this.lastKey = '';
    this.anchors = {};
  }

  makeDesk() {
    const W = 2048, H = 1152, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#e4e8ea'); g.addColorStop(0.55, '#d4d9dc'); g.addColorStop(1, '#c3c9cd');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft window-blind light bands (daylight)
    ctx.save();
    ctx.translate(W * 0.5, H * 0.5); ctx.rotate(-0.42); ctx.translate(-W * 0.5, -H * 0.5);
    ctx.filter = 'blur(26px)';
    for (let i = -6; i < 16; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(-400, i * 120, W + 800, 58);
    }
    ctx.restore();
    // fine paper/laminate noise
    const img = ctx.getImageData(0, 0, W, H);
    const n = makeNoise2(77);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const v = (n(x / 1.3, y / 1.3) - 0.5) * 5 + (fbm(n, x / 300, y / 300, 3) - 0.5) * 8;
      img.data[o] += v; img.data[o + 1] += v; img.data[o + 2] += v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  makeSheetLight() {
    // very subtle daylight falloff + blinds bands to multiply over the sheet
    const c = canvas(TW, TH), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, TW, TH);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(60,70,78,0.07)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
    ctx.save();
    ctx.translate(TW * 0.5, TH * 0.5); ctx.rotate(-0.42); ctx.translate(-TW * 0.5, -TH * 0.5);
    ctx.filter = 'blur(30px)';
    for (let i = -8; i < 20; i++) {
      ctx.fillStyle = 'rgba(70,80,90,0.035)';
      ctx.fillRect(-600, i * 150 + 75, TW + 1200, 72);
    }
    ctx.restore();
    return c;
  }

  drawSheet(st) {
    const ctx = this.sheetCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TW, TH);
    ctx.fillStyle = '#fbfcfc';
    roundRect(ctx, 0, 0, TW, TH, 34); ctx.fill();
    ctx.strokeStyle = '#dde2e5'; ctx.lineWidth = 3; roundRect(ctx, 1.5, 1.5, TW - 3, TH - 3, 33); ctx.stroke();

    const { gutter, headerTop, gridTop, rowH, hours, startHour, days, dates, colW } = CAL;
    const gridBottom = gridTop + rowH * hours;

    // failure day column hatch (behind grid)
    if (st.fail > 0) {
      const x = colX(CAL.failDay);
      ctx.save();
      ctx.globalAlpha = st.fail;
      ctx.beginPath(); ctx.rect(x + 6, gridTop + 4, colW - 12, gridBottom - gridTop - 8); ctx.clip();
      ctx.fillStyle = '#f1f3f4'; ctx.fillRect(x, gridTop, colW, gridBottom - gridTop);
      ctx.strokeStyle = '#d3d8dc'; ctx.lineWidth = 5;
      for (let k = -50; k < 14; k++) {
        ctx.beginPath(); ctx.moveTo(x + k * 34, gridTop); ctx.lineTo(x + k * 34 + 1300, gridTop + 1300 * 1.2); ctx.stroke();
      }
      ctx.restore();
    }

    // grid lines
    ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 2.5;
    for (let r = 0; r <= hours; r++) {
      const y = gridTop + r * rowH;
      ctx.beginPath(); ctx.moveTo(gutter, y); ctx.lineTo(TW - 60, y); ctx.stroke();
    }
    for (let i = 0; i <= 7; i++) {
      const x = colX(i);
      ctx.beginPath(); ctx.moveTo(x, headerTop + 20); ctx.lineTo(x, gridBottom); ctx.stroke();
    }
    // hour labels
    ctx.fillStyle = '#9ba3a9'; ctx.font = '500 30px Inter'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let r = 0; r < hours; r += 2) {
      const h = startHour + r;
      const lbl = h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
      ctx.fillText(lbl, gutter - 34, gridTop + r * rowH);
    }
    // day headers
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < 7; i++) {
      const x = colX(i) + 30;
      ctx.letterSpacing = '5px';
      ctx.font = '600 32px Inter';
      ctx.fillStyle = i === CAL.failDay && st.fail > 0 ? '#5d656b' : '#8a9298';
      ctx.fillText(days[i], x, headerTop + 92);
      ctx.letterSpacing = '0px';
      ctx.font = '600 92px Inter';
      ctx.fillStyle = '#1f2326';
      if (i === 0) {
        // today
        ctx.fillStyle = '#23272a';
        ctx.beginPath(); ctx.arc(x + 54, headerTop + 164, 62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center'; ctx.fillText(String(dates[i]), x + 54, headerTop + 196); ctx.textAlign = 'left';
      } else {
        ctx.fillText(String(dates[i]), x - 4, headerTop + 196);
      }
    }
    ctx.letterSpacing = '0px';

    // failure marker: dashed outline + hazard icon
    if (st.fail > 0) {
      const x = colX(CAL.failDay);
      ctx.save();
      ctx.globalAlpha = st.fail;
      ctx.setLineDash([18, 14]); ctx.lineWidth = 5; ctx.strokeStyle = '#7d868c';
      roundRect(ctx, x + 10, gridTop + 10, colW - 20, gridBottom - gridTop - 20, 18); ctx.stroke();
      ctx.setLineDash([]);
      const cy = gridTop + rowH * 4.5;
      const sc = 1 + 0.12 * (1 - easeOutCubic(seg(st.fail, 0, 1)));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x + colW / 2, cy, 78 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d5dadd'; ctx.lineWidth = 3; ctx.stroke();
      hazardIcon(ctx, x + colW / 2, cy - 4, 92 * sc, '#3a4146');
      ctx.restore();
    }

    // planned repair event block (Tue 10:00-12:00)
    if (st.event > 0) {
      const x = colX(CAL.repairDay) + 12, w = colW - 24;
      const y0 = hourY(10) + 8, h = rowH * 2 - 16;
      const k = easeOutCubic(st.event);
      ctx.save();
      ctx.globalAlpha = Math.min(1, st.event * 1.5);
      const hh = h * (0.4 + 0.6 * k);
      ctx.fillStyle = 'rgba(17,168,75,0.16)';
      roundRect(ctx, x, y0, w, hh, 16); ctx.fill();
      ctx.fillStyle = GREEN;
      roundRect(ctx, x, y0, 12, hh, [16, 0, 0, 16]); ctx.fill();
      wrenchIcon(ctx, x + 70, y0 + 66, 68, GREEN, '#d6efe0');
      ctx.restore();
    }

    // lead-time bracket (green) between repair day and failure day, just under headers
    if (st.bracket > 0) {
      const yB = gridTop - 44;
      const xa = colX(CAL.repairDay) + colW / 2, xb = colX(CAL.failDay) + colW / 2;
      const xe = lerp(xa, xb, easeInOutCubic(st.bracket));
      ctx.save();
      ctx.strokeStyle = GREEN; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xa, yB); ctx.lineTo(xe, yB); ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.beginPath(); ctx.arc(xa, yB, 14, 0, Math.PI * 2); ctx.fill();
      // day ticks
      for (let i = CAL.repairDay + 1; i < CAL.failDay; i++) {
        const xt = colX(i) + colW / 2;
        if (xt <= xe) { ctx.beginPath(); ctx.arc(xt, yB, 7, 0, Math.PI * 2); ctx.fill(); }
      }
      if (st.bracket >= 0.999) {
        ctx.beginPath(); ctx.arc(xb, yB, 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // daylight multiply layer
    ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(this.lightCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.sheetTex.needsUpdate = true;
  }

  texToWorld(u, v) {
    return new THREE.Vector3((u / TW - 0.5) * SW, 0, (v / TH - 0.5) * SH);
  }

  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * 1920, y: (-p.y * 0.5 + 0.5) * 1080 };
  }

  state(t) {
    return {
      fail: easeOutCubic(seg(t, 5.6, 6.1)),
      event: seg(t, 5.95, 6.4),
      bracket: seg(t, 6.75, 7.4),
    };
  }

  update(t) {
    const st = this.state(t);
    const key = `${st.fail.toFixed(3)}|${st.event.toFixed(3)}|${st.bracket.toFixed(3)}`;
    if (key !== this.lastKey) { this.drawSheet(st); this.lastKey = key; }

    const cam = this.camera;
    const k = easeInOutSine(seg(t, 5.0, 8.0));
    const arrive = easeOutCubic(seg(t, 5.0, 6.0));
    const tgt = new THREE.Vector3(lerp(0.5, 0.62, k), 0, lerp(0.06, 0.12, k));
    const el = lerp(1.21, 1.19, k) + 0.04 * (1 - arrive);  // elevation (rad)
    const az = lerp(-0.045, -0.025, k);
    const dist = lerp(17.9, 17.1, k) + 1.0 * (1 - arrive);
    cam.position.set(tgt.x + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, tgt.z + Math.cos(az) * Math.cos(el) * dist);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);

    const rp = this.texToWorld(colX(CAL.repairDay) + 24, hourY(10) + 8);
    this.anchors = {
      repair: this.project(rp),
      repairBottom: this.project(this.texToWorld(colX(CAL.repairDay) + CAL.colW / 2, hourY(12) - 8)),
      repairCenter: this.project(this.texToWorld(colX(CAL.repairDay) + CAL.colW / 2, hourY(11))),
      fail: this.project(this.texToWorld(colX(CAL.failDay) + CAL.colW / 2, hourY(12.5))),
    };

    const focusPt = this.texToWorld(TW * 0.5, TH * 0.45);
    const v = focusPt.clone().applyMatrix4(cam.matrixWorldInverse);
    let focus = -v.z;
    const inK = smooth(seg(t, 5.4, 5.95));
    focus = lerp(3.0, focus, inK);
    return {
      exposure: 1.0, toneMix: 0.0, vignette: 0.16, vigPow: 2.4, sat: 1.0, contrast: 1.0,
      dof: { focus, cocScale: 70, deadZone: 0.012, maxCoc: 22, radScale: 0.9 },
      bloom: { strength: 0, radius: 0, threshold: 1 },
      grain: 0.008,
      clear: 0xd3d8db,
    };
  }
}
