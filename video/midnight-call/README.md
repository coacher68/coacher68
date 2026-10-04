# The Midnight Phone Call That Never Happens

15-second horizontal social video for Reliable — 1920×1080, 16:9, 30 fps, no audio.

**File:** [`midnight-call_1920x1080_30fps.mp4`](midnight-call_1920x1080_30fps.mp4) (H.264 High, BT.709, yuv420p, faststart, no audio track)

![Storyboard](storyboard.jpg)

## Beats

| Time | Shot |
| --- | --- |
| 0:00–0:02.5 | Bedside table in blue moonlight. An amber clock reads **1:59 AM**; the phone beside it is dark. Slow push-in. |
| 0:02.5–0:08 | Close-up of a running motor (sensor LED blinking green), pulling back to the motor and pump. Vibration, temperature and operating-condition traces run green, develop amber changes, then converge into one amber early-warning indicator. |
| 0:08–0:12.5 | The indicator becomes a work-order card on a daytime calendar: **EARLY WARNING** (amber) → **PLANNED REPAIR — 10:00 AM** (Reliable green) on Tuesday. Saturday is marked as the projected failure; a green span shows four days of lead time. |
| 0:12.5–0:15 | Cut back to the bedside. **1:59 → 2:00 AM**. Focus pulls to the phone — it stays dark. **MORE WARNING TIME** (green) **CHANGES EVERYTHING.** |

Color: Reliable green `#11a84b` for healthy/planned, amber for the early warning, orange-red for the projected failure; blue night, an industrial-blue motor with a safety-yellow guard, warm daylight on the calendar.

## Re-rendering

The video is generated in code (Three.js in headless Chromium, frames encoded with ffmpeg) — see [`source/`](source).

```bash
cd source
npm install            # three, Inter font, playwright
npx playwright install chromium   # if no Chromium is available
npm run render         # writes frames/f0000.png … f0449.png
npm run encode         # requires ffmpeg
```

All beat timings live in one place, `T` in `source/src/timeline.js`. On-screen text is in `overlay.js`; the three sets are `bedroom.js`, `motor.js` and `calendar.js`.
