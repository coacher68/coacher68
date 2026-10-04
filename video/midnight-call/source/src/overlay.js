// 2D overlay: data traces, early-warning indicator, work-order card, final line.
import { seg, lerp, clamp, smooth, smoother, easeOutCubic, easeInOutCubic, easeOutBack, easeOutQuart, easeInOutSine, noise1 } from './timeline.js';

const GREEN = '#11a84b';
const W = 1920, H = 1080;

const PANEL_W = 360, PANEL_H = 128;
const C = { x: 930, y: 512 };            // convergence point (screen)
const CARD = { x: 150, y: 632, w: 900, h: 232 };
const CARD_C = { x: 150, y: 632, w: 560, h: 116 };

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
    const dip = c * 0.06 * Math.max(0, Math.sin(2 * Math.PI * (x * 7 - t * 0.9))) ;
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

export class Overlay {
  constructor() {
    this.panels = [
      { key: 'temp', title: 'TEMPERATURE', x: 112, y: 168, anchor: 'temp', delay: 0.0 },
      { key: 'vib', title: 'VIBRATION', x: W - 112 - PANEL_W, y: 168, anchor: 'vib', delay: 0.12 },
      { key: 'cond', title: 'OPERATING CONDITION', x: 112, y: 790, anchor: 'cond', delay: 0.24 },
    ];
  }

  chartRect(p) { return { x: p.x + 22, y: p.y + 46, w: PANEL_W - 44, h: PANEL_H - 64 }; }

  headPos(p, t, sev, reveal) {
    const r = this.chartRect(p);
    const x = reveal;
    const y = SERIES[p.key](x, t, sev);
    return { x: r.x + x * r.w, y: r.y + (1 - y) * r.h };
  }

  // ---------------------------------------------------------------- S2: traces
  drawTraces(ctx, t, anchors) {
    const sev = smooth(seg(t, 3.15, 4.2));
    const fadeOut = 1 - smooth(seg(t, 4.35, 4.95));
    for (const p of this.panels) {
      const a0 = 2.32 + p.delay;
      const appear = easeOutCubic(seg(t, a0, a0 + 0.45));
      if (appear <= 0) continue;
      const alpha = appear * fadeOut;
      if (alpha <= 0.003) continue;
      const reveal = easeOutCubic(seg(t, a0 + 0.12, a0 + 1.35));
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
        // sensor marker
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(anc.x, anc.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(anc.x, anc.y, 9 + 2 * Math.sin(t * 5 + p.delay * 20) * 0.0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, dy);
      // panel glass
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
      ctx.fillStyle = 'rgba(14,17,20,0.62)';
      roundRectPath(ctx, p.x, p.y, PANEL_W, PANEL_H, 14); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      roundRectPath(ctx, p.x + 0.5, p.y + 0.5, PANEL_W - 1, PANEL_H - 1, 14); ctx.stroke();
      label(ctx, p.title, p.x + 22, p.y + 32, { size: 14, color: 'rgba(255,255,255,0.66)', spacing: 3.2 });

      const r = this.chartRect(p);
      // alert threshold (dashed) + baseline
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1;
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
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py)));
        ctx.stroke();
        // developing change, emphasized
        if (sev > 0.01) {
          for (let i = 1; i < pts.length; i++) {
            const c = change(pts[i].x, sev);
            if (c < 0.02) continue;
            ctx.strokeStyle = `rgba(255,255,255,${clamp(0.25 + c * 1.1, 0, 1)})`;
            ctx.lineWidth = 1.8 + c * 1.4;
            ctx.beginPath(); ctx.moveTo(pts[i - 1].px, pts[i - 1].py); ctx.lineTo(pts[i].px, pts[i].py); ctx.stroke();
          }
        }
        // head
        const hd = pts[pts.length - 1];
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hd.px, hd.py, 3.6, 0, Math.PI * 2); ctx.fill();
        if (sev > 0.2) {
          const pulse = (t * 1.3 + p.delay) % 1;
          ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - pulse) * sev})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(hd.px, hd.py, 4 + pulse * 12, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // converging packets: from each head to C
    const conv0 = 4.12;
    for (const p of this.panels) {
      const start = conv0 + p.delay * 0.35;
      const u = easeInOutCubic(seg(t, start, start + 0.62));
      if (u <= 0 || t > 5.2) continue;
      const head = this.headPos(p, t, sev, 1);
      head.y += 0;
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
      for (let i = 1; i <= STEPS; i++) {
        const uu = lerp(u0, u, i / STEPS);
        const pt = quadPoint(head, q, C, uu);
        const k = i / STEPS;
        const fadeEnd = 1 - smooth(seg(u, 0.92, 1.0));
        ctx.strokeStyle = `rgba(255,255,255,${(0.06 + 0.94 * k * k) * fadeEnd})`;
        ctx.lineWidth = 1.0 + 3.2 * k;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
        prev = pt;
      }
      if (u < 0.995) {
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(prev.x, prev.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      }
      ctx.restore();
    }
  }

  // --------------------------------------------- indicator -> pill -> card
  drawWarning(ctx, t, cal) {
    const arrive = 4.74;
    const pop = seg(t, arrive - 0.04, arrive + 0.34);
    if (pop <= 0) return;
    const s = easeOutBack(pop, 1.25);

    const pillOpen = easeOutCubic(seg(t, 4.98, 5.34));
    const morph = easeInOutCubic(seg(t, 5.2, 6.02));
    const planned = easeInOutCubic(seg(t, 6.2, 6.62));
    const card = CARD;

    // pulse ring when the indicator lands
    const pr = seg(t, arrive, arrive + 0.75);
    if (pr > 0 && pr < 1) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - pr) * (1 - morph)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(C.x, C.y, 36 + easeOutCubic(pr) * 58, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // geometry: indicator -> pill -> compact card -> full card
    const expand = easeInOutCubic(seg(t, 6.1, 6.48));
    const titleSize = lerp(lerp(25, 28, morph), 21, expand), titleSpacing = lerp(4.5, 4.2, morph);
    const tw = textWidth(ctx, 'EARLY WARNING', titleSize, 600, titleSpacing);
    const pillH = 68 * s;
    const pill = { x: C.x - 34 * s, y: C.y - 34 * s, w: 68 * s + (tw + 46) * pillOpen, h: pillH };
    const mid = {
      x: lerp(pill.x, CARD_C.x, morph), y: lerp(pill.y, CARD_C.y, morph),
      w: lerp(pill.w, CARD_C.w, morph), h: lerp(pill.h, CARD_C.h, morph),
    };
    const R = { x: lerp(mid.x, card.x, expand), y: lerp(mid.y, card.y, expand), w: lerp(mid.w, card.w, expand), h: lerp(mid.h, card.h, expand) };
    const radius = lerp(34 * s, 22, morph);

    ctx.save();
    // pointer: card -> repair slot on calendar
    const ptr = easeInOutCubic(seg(t, 6.0, 6.34));
    if (ptr > 0 && cal && cal.repairBottom) {
      const from = { x: card.x + 290, y: card.y };
      const to = cal.repairBottom;
      const ex = lerp(from.x, to.x, ptr), ey = lerp(from.y, to.y, ptr);
      const col = planned > 0.5 ? GREEN : '#454c52';
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

    // white body (indicator disc -> pill -> card)
    ctx.shadowColor = `rgba(8,12,16,${lerp(0.45, 0.20, morph)})`;
    ctx.shadowBlur = lerp(24, 64, morph); ctx.shadowOffsetY = lerp(8, 28, morph);
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, R.x, R.y, R.w, R.h, radius); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // thin outer ring while it is an indicator
    if (morph < 1) {
      const ra = 0.55 * (1 - pillOpen) * Math.min(1, pop * 2);
      if (ra > 0.01) {
        ctx.strokeStyle = `rgba(255,255,255,${ra})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(C.x, C.y, 34 * s + 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // accent bar
    if (morph > 0.35) {
      ctx.save();
      roundRectPath(ctx, R.x, R.y, R.w, R.h, radius); ctx.clip();
      ctx.globalAlpha = smooth(seg(morph, 0.35, 1));
      ctx.fillStyle = '#dfe3e6';
      ctx.fillRect(R.x, R.y, 8, R.h);
      ctx.fillStyle = GREEN;
      ctx.fillRect(R.x, R.y + R.h * (1 - planned), 8, R.h * planned);
      ctx.restore();
    }

    // icon
    const icon = { x: lerp(C.x, card.x + 66, morph), y: lerp(C.y, lerp(card.y + 58, card.y + 62, expand), morph) };
    const ir = lerp(22, 21, morph) * s;
    const inner = Math.max(pillOpen, morph);            // dark disc grows inside the white indicator
    const dark = [30, 34, 38], green = [17, 168, 75];
    const ic = dark.map((v, i) => Math.round(lerp(v, green[i], planned)));
    // indicator stage: white disc with dark glyph; pill/card stage: dark (then green) disc with white glyph
    if (inner < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(icon.x, icon.y, ir, 0, Math.PI * 2); ctx.fill();
    }
    if (inner > 0) {
      ctx.fillStyle = `rgb(${ic.join(',')})`;
      ctx.beginPath(); ctx.arc(icon.x, icon.y, ir * inner, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(icon.x, icon.y);
    const sc = ir / 22;
    if (planned < 0.5) {
      ctx.globalAlpha = (1 - smooth(seg(planned, 0.15, 0.5))) * Math.min(1, pop * 1.6);
      ctx.fillStyle = inner > 0.55 ? '#ffffff' : '#15181b';
      ctx.beginPath(); ctx.roundRect(-2.7 * sc, -11.5 * sc, 5.4 * sc, 14.5 * sc, 2.7 * sc); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 8.6 * sc, 3.0 * sc, 0, Math.PI * 2); ctx.fill();
    } else {
      const d = smooth(seg(planned, 0.5, 1.0));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const p0 = { x: -8.5, y: 0.5 }, p1 = { x: -2.8, y: 6.2 }, p2 = { x: 9, y: -6.6 };
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
      if (d < 0.35) { const k = d / 0.35; ctx.lineTo(lerp(p0.x, p1.x, k), lerp(p0.y, p1.y, k)); }
      else { ctx.lineTo(p1.x, p1.y); const k = (d - 0.35) / 0.65; ctx.lineTo(lerp(p1.x, p2.x, k), lerp(p1.y, p2.y, k)); }
      ctx.stroke();
    }
    ctx.restore();

    // "EARLY WARNING"
    if (pillOpen > 0) {
      const tx = lerp(C.x + 34 * s + 8, card.x + 66 + 44, morph);
      const ty = lerp(C.y, lerp(card.y + 58, card.y + 62, expand), morph);
      ctx.save();
      roundRectPath(ctx, R.x, R.y, R.w, R.h, radius); ctx.clip();
      const tc = [22, 25, 28].map((v, i) => Math.round(lerp(v, [96, 104, 110][i], expand)));
      label(ctx, 'EARLY WARNING', tx - (1 - pillOpen) * 18, ty + 1, { size: titleSize, weight: 600, color: `rgba(${tc.join(',')},${pillOpen})`, spacing: titleSpacing, baseline: 'middle' });
      ctx.restore();
    }

    // divider
    if (expand > 0.5) {
      ctx.save();
      ctx.globalAlpha = smooth(seg(expand, 0.5, 1));
      ctx.strokeStyle = '#e8ebed'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(card.x + 44, card.y + 108); ctx.lineTo(card.x + card.w - 40, card.y + 108); ctx.stroke();
      ctx.restore();
    }

    // main line
    const mainK = easeOutCubic(seg(t, 6.32, 6.84));
    if (mainK > 0) {
      ctx.save();
      roundRectPath(ctx, R.x, R.y, R.w, R.h, radius); ctx.clip();
      const mx = card.x + 45, my = card.y + 166;
      ctx.beginPath(); ctx.rect(mx - 4, my - 50, (card.w - 70) * mainK + 4, 100); ctx.clip();
      ctx.globalAlpha = Math.min(1, mainK * 1.6);
      label(ctx, 'PLANNED REPAIR — 10:00 AM', mx - (1 - mainK) * 26, my, { size: 50, weight: 700, color: GREEN, spacing: 0.4, baseline: 'middle' });
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- S4
  drawFinal(ctx, t) {
    const k = smooth(seg(t, 8.8, 9.2));
    if (k <= 0) return;
    const y = 958 + (1 - easeOutCubic(seg(t, 8.8, 9.4))) * 10;
    ctx.save();
    ctx.globalAlpha = k;
    label(ctx, 'MORE WARNING TIME CHANGES EVERYTHING.', W / 2, y, { size: 44, weight: 600, color: 'rgba(255,255,255,0.95)', spacing: 7, align: 'center', baseline: 'middle' });
    // brand rule
    const rw = 56 * easeOutCubic(seg(t, 8.95, 9.45));
    ctx.fillStyle = GREEN;
    ctx.fillRect(W / 2 - rw / 2, y - 48, rw, 3);
    ctx.restore();
  }

  draw(ctx, t, { motor, cal }) {
    ctx.clearRect(0, 0, W, H);
    if (t >= 2.25 && t < 5.2) this.drawTraces(ctx, t, motor || {});
    if (t >= 4.6 && t < 8.0) this.drawWarning(ctx, t, cal);
    if (t >= 8.0) this.drawFinal(ctx, t);
  }
}
