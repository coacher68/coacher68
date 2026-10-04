// 2D overlay: data traces, early-warning indicator, work-order card, final line.
import { T, seg, lerp, clamp, smooth, smoother, easeOutCubic, easeInOutCubic, easeOutBack, noise1 } from './timeline.js';

const GREEN = '#11a84b';          // Reliable green (brand)
const GREEN_LINE = '#2bcf6e';     // brighter tint of brand green for thin strokes on dark
const AMBER = '#ffad1f';          // early-warning amber
const INK = '#1a1406';            // dark text on amber
const W = 1920, H = 1080;

const PANEL_W = 360, PANEL_H = 128;
const C = { x: 930, y: 512 };                         // convergence point (screen)
const CARD = { x: 150, y: 596, w: 960, h: 252 };      // full work-order card
const TAG_H_CARD = 50;                                // amber tag height inside the card

// normalized data series (x in 0..1 -> y in 0..1, 1 = top)
const change = (x, sev) => Math.pow(smoother(seg(x, 0.56, 1.0)), 1.35) * sev;
const SERIES = {
  temp: (x, t, sev) => 0.30 + 0.022 * Math.sin(x * 8.5 + 0.6) + 0.012 * noise1(x * 38 + 3, 1) + 0.30 * change(x, sev),
  vib: (x, t, sev) => {
    const amp = 0.065 + 0.17 * change(x, sev);
    return 0.40 + 0.05 * change(x, sev) + amp * Math.sin(2 * Math.PI * (x * 15 - t * 1.6)) + 0.012 * noise1(x * 60 - t * 4, 2);
  },
  cond: (x, t, sev) => {
    const c = change(x, sev);
    const dip = c * 0.06 * Math.max(0, Math.sin(2 * Math.PI * (x * 7 - t * 0.9)));
    return 0.62 + 0.022 * Math.sin(2 * Math.PI * (x * 9 - t * 0.7)) + 0.01 * noise1(x * 50, 3) - 0.24 * c - dip;
  },
};

function roundRectPath(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function label(ctx, text, x, y, { size = 15, weight = 600, color = 'rgba(255,255,255,0.7)', spacing = 3, align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.font = `${weight} ${size}px Inter`;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

function textWidth(ctx, text, size, weight, spacing) {
  ctx.font = `${weight} ${size}px Inter`;
  ctx.letterSpacing = `${spacing}px`;
  const w = ctx.measureText(text).width;
  ctx.letterSpacing = '0px';
  return w;
}

function quadPoint(a, q, b, u) {
  const v = 1 - u;
  return { x: v * v * a.x + 2 * v * u * q.x + u * u * b.x, y: v * v * a.y + 2 * v * u * q.y + u * u * b.y };
}

function mixHex(a, b, k) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], k))).join(',')})`;
}

// "!" (optionally inside a ring), centred at 0,0, sized to radius r
function warnGlyph(ctx, r, color, ring = true) {
  const sc = r / 22;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-2.7 * sc, -11.5 * sc, 5.4 * sc, 14.5 * sc, 2.7 * sc); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 8.6 * sc, 3.0 * sc, 0, Math.PI * 2); ctx.fill();
  if (ring) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.6 * sc;
    ctx.beginPath(); ctx.arc(0, 0, r - 1.3 * sc, 0, Math.PI * 2); ctx.stroke();
  }
}

function checkGlyph(ctx, r, d, color) {
  const sc = r / 20;
  ctx.strokeStyle = color; ctx.lineWidth = 3.6 * sc; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const p0 = { x: -8 * sc, y: 0.5 * sc }, p1 = { x: -2.6 * sc, y: 6 * sc }, p2 = { x: 8.6 * sc, y: -6.4 * sc };
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
  if (d < 0.35) { const k = d / 0.35; ctx.lineTo(lerp(p0.x, p1.x, k), lerp(p0.y, p1.y, k)); }
  else { ctx.lineTo(p1.x, p1.y); const k = (d - 0.35) / 0.65; ctx.lineTo(lerp(p1.x, p2.x, k), lerp(p1.y, p2.y, k)); }
  ctx.stroke();
}

export class Overlay {
  constructor() {
    this.panels = [
      { key: 'temp', title: 'TEMPERATURE', x: 112, y: 168, anchor: 'temp', delay: 0.0 },
      { key: 'vib', title: 'VIBRATION', x: W - 112 - PANEL_W, y: 168, anchor: 'vib', delay: 0.16 },
      { key: 'cond', title: 'OPERATING CONDITION', x: 112, y: 790, anchor: 'cond', delay: 0.32 },
    ];
  }

  chartRect(p) { return { x: p.x + 22, y: p.y + 46, w: PANEL_W - 44, h: PANEL_H - 64 }; }

  headPos(p, t, sev, reveal) {
    const r = this.chartRect(p);
    const y = SERIES[p.key](reveal, t, sev);
    return { x: r.x + reveal * r.w, y: r.y + (1 - y) * r.h };
  }

  // ---------------------------------------------------------------- S2: traces
  drawTraces(ctx, t, anchors) {
    const sev = smooth(seg(t, T.sev[0], T.sev[1]));
    const warnK = smooth(seg(t, T.sev[0] + 0.35, T.sev[1] + 0.1));
    const fadeOut = 1 - smooth(seg(t, T.conv + 0.2, T.conv + 0.85));
    for (const p of this.panels) {
      const a0 = T.panel0 + p.delay;
      const appear = easeOutCubic(seg(t, a0, a0 + 0.45));
      if (appear <= 0) continue;
      const alpha = appear * fadeOut;
      if (alpha <= 0.003) continue;
      const reveal = easeOutCubic(seg(t, a0 + 0.1, a0 + 0.1 + T.reveal));
      const dy = (1 - appear) * 14;
      const anc = anchors[p.anchor];

      // leader line: sensor -> panel edge
      const edge = { x: p.x < W / 2 ? p.x + PANEL_W : p.x, y: p.y + (p.y < H / 2 ? PANEL_H : 0) + dy };
      const lk = easeInOutCubic(seg(t, a0 - 0.08, a0 + 0.38));
      if (anc && lk > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        const ex = lerp(anc.x, edge.x, lk), ey = lerp(anc.y, edge.y, lk);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(anc.x, anc.y); ctx.lineTo(ex, ey); ctx.stroke();
        const mc = mixHex(GREEN_LINE, AMBER, warnK);
        ctx.fillStyle = mc;
        ctx.beginPath(); ctx.arc(anc.x, anc.y, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = mc; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(anc.x, anc.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, dy);
      // panel glass
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
      ctx.fillStyle = 'rgba(8,14,24,0.66)';
      roundRectPath(ctx, p.x, p.y, PANEL_W, PANEL_H, 14); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      roundRectPath(ctx, p.x + 0.5, p.y + 0.5, PANEL_W - 1, PANEL_H - 1, 14); ctx.stroke();
      label(ctx, p.title, p.x + 22, p.y + 32, { size: 14, color: 'rgba(255,255,255,0.72)', spacing: 3.2 });
      // status dot: green (normal) -> amber (developing)
      ctx.fillStyle = mixHex(GREEN_LINE, AMBER, warnK);
      ctx.beginPath(); ctx.arc(p.x + PANEL_W - 26, p.y + 27, 5, 0, Math.PI * 2); ctx.fill();

      const r = this.chartRect(p);
      // alert threshold (dashed) + baseline
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(255,173,31,0.32)'; ctx.lineWidth = 1;
      const thrY = r.y + (1 - 0.86) * r.h;
      ctx.beginPath(); ctx.moveTo(r.x, thrY); ctx.lineTo(r.x + r.w, thrY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();

      // trace
      if (reveal > 0.002) {
        const N = 220;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const x = (i / N) * reveal;
          pts.push({ x, px: r.x + x * r.w, py: r.y + (1 - clamp(SERIES[p.key](x, t, sev), 0, 1)) * r.h });
        }
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = GREEN_LINE; ctx.lineWidth = 2.0;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py)));
        ctx.stroke();
        // developing change, in amber
        if (sev > 0.01) {
          for (let i = 1; i < pts.length; i++) {
            const c = change(pts[i].x, sev);
            if (c < 0.02) continue;
            ctx.strokeStyle = `rgba(255,173,31,${clamp(0.2 + c * 1.2, 0, 1)})`;
            ctx.lineWidth = 2.0 + c * 1.4;
            ctx.beginPath(); ctx.moveTo(pts[i - 1].px, pts[i - 1].py); ctx.lineTo(pts[i].px, pts[i].py); ctx.stroke();
          }
        }
        // head
        const hd = pts[pts.length - 1];
        const hc = mixHex(GREEN_LINE, AMBER, warnK);
        ctx.fillStyle = hc;
        ctx.beginPath(); ctx.arc(hd.px, hd.py, 4, 0, Math.PI * 2); ctx.fill();
        const pulse = (t * 1.3 + p.delay) % 1;
        ctx.strokeStyle = hc; ctx.globalAlpha = alpha * 0.55 * (1 - pulse);
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(hd.px, hd.py, 4.5 + pulse * 12, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    // converging packets: from each head to C (amber)
    for (const p of this.panels) {
      const start = T.conv + p.delay * 0.35;
      const u = easeInOutCubic(seg(t, start, start + 0.62));
      if (u <= 0 || t > T.arrive + 0.6) continue;
      const head = this.headPos(p, t, sev, 1);
      const mid = { x: (head.x + C.x) / 2, y: (head.y + C.y) / 2 };
      const dx = C.x - head.x, dy = C.y - head.y;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const side = p.key === 'cond' ? -1 : 1;
      const q = { x: mid.x + nx * len * 0.18 * side, y: mid.y + ny * len * 0.18 * side - 60 };
      const tail = 0.42;
      const u0 = Math.max(0, u - tail);
      const STEPS = 40;
      ctx.save();
      ctx.lineCap = 'round';
      let prev = quadPoint(head, q, C, u0);
      const fadeEnd = 1 - smooth(seg(u, 0.92, 1.0));
      for (let i = 1; i <= STEPS; i++) {
        const uu = lerp(u0, u, i / STEPS);
        const pt = quadPoint(head, q, C, uu);
        const k = i / STEPS;
        ctx.strokeStyle = `rgba(255,173,31,${(0.06 + 0.94 * k * k) * fadeEnd})`;
        ctx.lineWidth = 1.0 + 3.4 * k;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
        prev = pt;
      }
      if (u < 0.995) {
        ctx.fillStyle = '#ffe2a8';
        ctx.shadowColor = 'rgba(255,173,31,0.8)'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(prev.x, prev.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      }
      ctx.restore();
    }
  }

  // --------------------------------------------- indicator -> amber tag -> card
  drawWarning(ctx, t, cal) {
    const pop = seg(t, T.arrive - 0.04, T.arrive + 0.34);
    if (pop <= 0) return;
    const s = easeOutBack(pop, 1.25);

    const pillOpen = easeOutCubic(seg(t, T.pill[0], T.pill[1]));
    const morph = easeInOutCubic(seg(t, T.morph[0], T.morph[1]));
    const expand = easeInOutCubic(seg(t, T.expand[0], T.expand[1]));
    const planned = easeInOutCubic(seg(t, T.planned[0], T.planned[1]));
    const card = CARD;

    // pulse ring when the indicator lands
    const pr = seg(t, T.arrive, T.arrive + 0.75);
    if (pr > 0 && pr < 1) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,173,31,${0.75 * (1 - pr) * (1 - morph)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(C.x, C.y, 36 + easeOutCubic(pr) * 62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // amber tag geometry: indicator disc -> pill (on dark) -> tag inside the card
    const tSize = lerp(25, 21, morph), tSpace = lerp(4.5, 3.6, morph);
    const tw = textWidth(ctx, 'EARLY WARNING', tSize, 700, tSpace);
    const hPill = lerp(68 * s, TAG_H_CARD, morph);
    const padL = hPill + 6;                                   // text start offset inside tag
    const openW = hPill + (padL - hPill + tw + hPill * 0.42) * pillOpen;
    const tag = {
      x: lerp(C.x - 34 * s, card.x + 40, morph),
      y: lerp(C.y - 34 * s, card.y + 34, morph),
      w: Math.max(hPill, openW), h: hPill,
    };

    // white card body grows behind the tag
    const bodyK = smooth(seg(morph, 0.15, 0.85));
    const padX = 40 * bodyK, padY = 34 * bodyK;
    const body = { x: tag.x - padX, y: tag.y - padY, w: tag.w + padX * 2, h: tag.h + padY * 2 };
    const R = { x: lerp(body.x, card.x, expand), y: lerp(body.y, card.y, expand), w: lerp(body.w, card.w, expand), h: lerp(body.h, card.h, expand) };

    ctx.save();
    // pointer: card -> repair slot on calendar
    const ptr = easeInOutCubic(seg(t, T.ptr[0], T.ptr[1]));
    if (ptr > 0 && cal && cal.repairBottom) {
      const from = { x: card.x + 300, y: card.y };
      const to = cal.repairBottom;
      const ex = lerp(from.x, to.x, ptr), ey = lerp(from.y, to.y, ptr);
      const col = planned > 0.5 ? GREEN : '#c98a14';
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
      const dk = seg(ptr, 0.85, 1);
      if (dk > 0) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(to.x, to.y, 9 * dk, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(to.x, to.y, 3.6 * dk, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (bodyK > 0) {
      ctx.save();
      ctx.globalAlpha = bodyK;
      ctx.shadowColor = 'rgba(20,28,36,0.22)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 26;
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, R.x, R.y, R.w, R.h, 22); ctx.fill();
      ctx.shadowColor = 'transparent';
      // accent bar amber -> green
      roundRectPath(ctx, R.x, R.y, R.w, R.h, 22); ctx.clip();
      ctx.fillStyle = AMBER;
      ctx.fillRect(R.x, R.y, 8, R.h);
      ctx.fillStyle = GREEN;
      ctx.fillRect(R.x, R.y + R.h * (1 - planned), 8, R.h * planned);
      ctx.restore();
    }

    // amber tag (indicator / pill / tag)
    ctx.save();
    ctx.shadowColor = `rgba(255,150,20,${0.45 * (1 - morph)})`; ctx.shadowBlur = 26 * (1 - morph);
    ctx.fillStyle = AMBER;
    roundRectPath(ctx, tag.x, tag.y, tag.w, tag.h, tag.h / 2); ctx.fill();
    ctx.restore();
    if (morph < 1) {
      const ra = 0.6 * (1 - pillOpen) * Math.min(1, pop * 2);
      if (ra > 0.01) {
        ctx.strokeStyle = `rgba(255,173,31,${ra})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(C.x, C.y, 34 * s + 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // glyph
    ctx.save();
    ctx.translate(tag.x + tag.h / 2, tag.y + tag.h / 2);
    ctx.globalAlpha = Math.min(1, pop * 1.6);
    warnGlyph(ctx, lerp(22 * s, hPill * 0.31, pillOpen), INK, pillOpen > 0.02);
    ctx.restore();
    // "EARLY WARNING"
    if (pillOpen > 0) {
      ctx.save();
      roundRectPath(ctx, tag.x, tag.y, tag.w, tag.h, tag.h / 2); ctx.clip();
      const tx = tag.x + padL - (1 - pillOpen) * 18;
      label(ctx, 'EARLY WARNING', tx, tag.y + tag.h / 2 + 1, { size: tSize, weight: 700, color: `rgba(26,20,6,${pillOpen})`, spacing: tSpace, baseline: 'middle' });
      ctx.restore();
    }

    // divider + main line
    if (expand > 0.5) {
      ctx.save();
      ctx.globalAlpha = smooth(seg(expand, 0.5, 1));
      ctx.strokeStyle = '#e8ebed'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(card.x + 40, card.y + 118); ctx.lineTo(card.x + card.w - 40, card.y + 118); ctx.stroke();
      ctx.restore();
    }
    const mainK = easeOutCubic(seg(t, T.main[0], T.main[1]));
    if (mainK > 0) {
      ctx.save();
      roundRectPath(ctx, R.x, R.y, R.w, R.h, 22); ctx.clip();
      const cx = card.x + 40 + 22, cy = card.y + 184;
      // green check disc
      const dr = 22 * easeOutBack(seg(t, T.planned[0], T.planned[0] + 0.3), 1.2);
      if (dr > 0) {
        ctx.fillStyle = GREEN;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, dr), 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(cx, cy); checkGlyph(ctx, 20, smooth(seg(planned, 0.3, 1)), '#ffffff'); ctx.restore();
      }
      const mx = card.x + 40 + 60;
      ctx.beginPath(); ctx.rect(mx - 4, cy - 50, (card.w - 110) * mainK + 4, 100); ctx.clip();
      ctx.globalAlpha = Math.min(1, mainK * 1.6);
      label(ctx, 'PLANNED REPAIR — 10:00 AM', mx - (1 - mainK) * 26, cy + 1, { size: 50, weight: 700, color: GREEN, spacing: 0.4, baseline: 'middle' });
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- S4
  drawFinal(ctx, t) {
    const k = smooth(seg(t, T.text[0], T.text[1]));
    if (k <= 0) return;
    const y = 958 + (1 - easeOutCubic(seg(t, T.text[0], T.text[1] + 0.2))) * 10;
    const size = 44, sp = 7;
    const a = 'MORE WARNING TIME ', b = 'CHANGES EVERYTHING.';
    const wa = textWidth(ctx, a, size, 700, sp), wb = textWidth(ctx, b, size, 600, sp);
    const x0 = W / 2 - (wa + wb) / 2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18;
    label(ctx, a, x0, y, { size, weight: 700, color: '#19c25a', spacing: sp, align: 'left', baseline: 'middle' });
    label(ctx, b, x0 + wa, y, { size, weight: 600, color: 'rgba(255,255,255,0.96)', spacing: sp, align: 'left', baseline: 'middle' });
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    const rw = 64 * easeOutCubic(seg(t, T.rule[0], T.rule[1]));
    ctx.fillStyle = GREEN;
    ctx.fillRect(W / 2 - rw / 2, y - 50, rw, 3);
    ctx.restore();
  }

  draw(ctx, t, { motor, cal }) {
    ctx.clearRect(0, 0, W, H);
    if (t >= T.panel0 - 0.2 && t < T.arrive + 0.7) this.drawTraces(ctx, t, motor || {});
    if (t >= T.arrive - 0.1 && t < T.cut) this.drawWarning(ctx, t, cal);
    if (t >= T.cut) this.drawFinal(ctx, t);
  }
}
