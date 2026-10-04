// Post-processing chain: HDR scene -> DOF (half-res gather) -> bloom -> tonemap/grade -> LDR.
// Final pass mixes up to two LDR scene images, composites the 2D overlay, adds grain.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_FNS = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform float uNear, uFar, uFocus, uCocScale, uDeadZone, uMaxCoc;
float viewZ(vec2 uv) { float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, uNear, uFar); }
// signed circle of confusion in full-res pixels: + far, - near
float coc(float z) {
  float di = 1.0 / uFocus - 1.0 / max(z, 1e-4);
  float c = sign(di) * max(abs(di) - uDeadZone, 0.0) * uCocScale;
  return clamp(c, -uMaxCoc, uMaxCoc);
}`;

function hf(w, h, extra = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, ...extra,
  });
}

export class Post {
  constructor(renderer, W, H) {
    this.renderer = renderer;
    this.W = W; this.H = H;
    const depthTex = new THREE.DepthTexture(W, H);
    depthTex.type = THREE.FloatType;
    this.rtScene = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, samples: 4, depthBuffer: true, depthTexture: depthTex,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.rtHalf = hf(W / 2, H / 2);
    this.rtHalfBlur = hf(W / 2, H / 2);
    this.rtDof = hf(W, H);
    this.ldr = [hf(W, H), hf(W, H)];
    this.quad = new FullScreenQuad();

    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.4, 0.9);

    const dofUniforms = () => ({
      tDepth: { value: null }, uNear: { value: 1 }, uFar: { value: 1000 },
      uFocus: { value: 50 }, uCocScale: { value: 1000 }, uDeadZone: { value: 0 }, uMaxCoc: { value: 24 },
    });

    this.matPrefilter = new THREE.ShaderMaterial({
      uniforms: { ...dofUniforms(), tColor: { value: null }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) } },
      vertexShader: VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
        ${DEPTH_FNS}
        void main() {
          vec2 o = uTexel * 0.5;
          vec2 p0 = vUv + vec2(-o.x, -o.y), p1 = vUv + vec2(o.x, -o.y), p2 = vUv + vec2(-o.x, o.y), p3 = vUv + vec2(o.x, o.y);
          vec3 c0 = texture2D(tColor, p0).rgb, c1 = texture2D(tColor, p1).rgb, c2 = texture2D(tColor, p2).rgb, c3 = texture2D(tColor, p3).rgb;
          float k0 = coc(viewZ(p0)), k1 = coc(viewZ(p1)), k2 = coc(viewZ(p2)), k3 = coc(viewZ(p3));
          float kn = min(min(k0, k1), min(k2, k3));
          float k = kn < -0.5 ? kn : 0.25 * (k0 + k1 + k2 + k3);
          // soft clamp very bright values to reduce bokeh fireflies flicker
          vec3 c = 0.25 * (c0 + c1 + c2 + c3);
          gl_FragColor = vec4(c, k);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.matGather = new THREE.ShaderMaterial({
      uniforms: { tHalf: { value: null }, uTexel: { value: new THREE.Vector2(2 / W, 2 / H) }, uMaxRadius: { value: 12 }, uRadScale: { value: 0.8 } },
      vertexShader: VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tHalf; uniform vec2 uTexel; uniform float uMaxRadius; uniform float uRadScale; varying vec2 vUv;
        const float GA = 2.39996323;
        void main() {
          vec4 center = texture2D(tHalf, vUv);
          float cSize = abs(center.a) * 0.5;
          vec3 acc = center.rgb; float tot = 1.0;
          float radius = uRadScale; float ang = 0.0; float nearSpread = 0.0;
          for (int i = 0; i < 600; i++) {
            if (radius >= uMaxRadius) break;
            vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
            vec4 s = texture2D(tHalf, tc);
            float sSize = abs(s.a) * 0.5;
            if (s.a > center.a) sSize = clamp(sSize, 0.0, cSize * 2.0);
            float m = smoothstep(radius - 0.5, radius + 0.5, sSize);
            acc += mix(acc / tot, s.rgb, m);
            tot += 1.0;
            if (s.a < center.a && s.a < -0.5) nearSpread = max(nearSpread, m * abs(s.a));
            ang += GA;
            radius += uRadScale / radius;
          }
          gl_FragColor = vec4(acc / tot, max(abs(center.a), nearSpread));
        }`,
      depthTest: false, depthWrite: false,
    });

    this.matComposite = new THREE.ShaderMaterial({
      uniforms: { ...dofUniforms(), tColor: { value: null }, tBlur: { value: null } },
      vertexShader: VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tColor; uniform sampler2D tBlur; varying vec2 vUv;
        ${DEPTH_FNS}
        void main() {
          vec3 sharp = texture2D(tColor, vUv).rgb;
          float k = abs(coc(viewZ(vUv)));
          vec4 b = texture2D(tBlur, vUv);
          float amt = max(k, b.a);
          float w = smoothstep(0.7, 2.6, amt);
          gl_FragColor = vec4(mix(sharp, b.rgb, w), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.matTone = new THREE.ShaderMaterial({
      uniforms: {
        tHDR: { value: null }, uExposure: { value: 1 }, uVignette: { value: 0.35 }, uVigPow: { value: 2.2 },
        uAspect: { value: W / H }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
        uSat: { value: 1.0 }, uContrast: { value: 1.0 }, uToneMix: { value: 1.0 }, uVigCenter: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tHDR; uniform float uExposure, uVignette, uVigPow, uAspect, uSat, uContrast, uToneMix;
        uniform vec3 uLift, uGain; uniform vec2 uVigCenter; varying vec2 vUv;
        vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        vec3 ACESFilmic(vec3 color) {
          const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
          const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
          color /= 0.6;
          color = ACESInputMat * color; color = RRTAndODTFit(color); color = ACESOutputMat * color;
          return clamp(color, 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec3 hdr = texture2D(tHDR, vUv).rgb * uExposure;
          vec3 c = mix(clamp(hdr, 0.0, 1.0), ACESFilmic(hdr), uToneMix);
          vec3 s = toSRGB(c);
          float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
          s = mix(vec3(l), s, uSat);
          s = (s - 0.5) * uContrast + 0.5;
          s = s * uGain + uLift * (1.0 - s);
          vec2 p = (vUv - uVigCenter) * vec2(uAspect, 1.0);
          float v = 1.0 - uVignette * pow(clamp(length(p) / 1.05, 0.0, 1.0), uVigPow);
          gl_FragColor = vec4(max(s * v, 0.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = W; this.overlayCanvas.height = H;
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.premultiplyAlpha = true;
    this.overlayTex.colorSpace = THREE.NoColorSpace;
    this.overlayTex.minFilter = THREE.LinearFilter; this.overlayTex.magFilter = THREE.LinearFilter;
    this.overlayTex.generateMipmaps = false;

    this.matFinal = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null }, tB: { value: null }, tOverlay: { value: this.overlayTex }, uMix: { value: 0 },
        uFade: { value: 1 }, uGrain: { value: 0.03 }, uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) },
      },
      vertexShader: VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tA, tB, tOverlay; uniform float uMix, uFade, uGrain, uSeed; uniform vec2 uRes; varying vec2 vUv;
        float hash(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
        void main() {
          vec3 a = texture2D(tA, vUv).rgb;
          vec3 c = a;
          if (uMix > 0.0) { vec3 b = texture2D(tB, vUv).rgb; c = mix(a, b, uMix); }
          vec4 o = texture2D(tOverlay, vUv);
          c = o.rgb + c * (1.0 - o.a);
          c *= uFade;
          // film grain: soft gaussian-ish, stronger in mid-tones, plus dither
          vec2 px = floor(gl_FragCoord.xy);
          float n1 = hash(vec3(px, uSeed)); float n2 = hash(vec3(px + 17.0, uSeed + 3.1));
          float g = (n1 + n2 - 1.0);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float amp = uGrain * (0.55 + 0.9 * l * (1.0 - l) * 4.0 * 0.5);
          c += g * amp + (hash(vec3(px, uSeed + 7.7)) - 0.5) / 255.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  setDofUniforms(mat, cam, p) {
    const u = mat.uniforms;
    u.tDepth.value = this.rtScene.depthTexture;
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uFocus.value = p.focus; u.uCocScale.value = p.cocScale; u.uDeadZone.value = p.deadZone || 0; u.uMaxCoc.value = p.maxCoc;
  }

  // Render a scene definition into ldr[slot]. p = post params from scene.update()
  renderScene(sc, p, slot) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(p.clear || 0x000000, 1);
    r.clear(true, true, true);
    r.render(sc.scene, sc.camera);

    let hdrTex = this.rtScene.texture;
    if (p.dof && p.dof.maxCoc > 0.5) {
      // prefilter (full -> half, color + coc)
      this.setDofUniforms(this.matPrefilter, sc.camera, p.dof);
      this.matPrefilter.uniforms.tColor.value = this.rtScene.texture;
      this.quad.material = this.matPrefilter;
      r.setRenderTarget(this.rtHalf); this.quad.render(r);
      // gather
      this.matGather.uniforms.tHalf.value = this.rtHalf.texture;
      this.matGather.uniforms.uMaxRadius.value = Math.max(1.0, p.dof.maxCoc * 0.5);
      this.matGather.uniforms.uRadScale.value = p.dof.radScale || 0.8;
      this.quad.material = this.matGather;
      r.setRenderTarget(this.rtHalfBlur); this.quad.render(r);
      // composite
      this.setDofUniforms(this.matComposite, sc.camera, p.dof);
      this.matComposite.uniforms.tColor.value = this.rtScene.texture;
      this.matComposite.uniforms.tBlur.value = this.rtHalfBlur.texture;
      this.quad.material = this.matComposite;
      r.setRenderTarget(this.rtDof); this.quad.render(r);
    } else {
      // copy through the composite with zero coc
      this.setDofUniforms(this.matComposite, sc.camera, { focus: 1, cocScale: 0, maxCoc: 0 });
      this.matComposite.uniforms.tColor.value = this.rtScene.texture;
      this.matComposite.uniforms.tBlur.value = this.rtScene.texture;
      this.quad.material = this.matComposite;
      r.setRenderTarget(this.rtDof); this.quad.render(r);
    }
    hdrTex = this.rtDof.texture;

    if (p.bloom && p.bloom.strength > 0) {
      this.bloom.strength = p.bloom.strength;
      this.bloom.radius = p.bloom.radius;
      this.bloom.threshold = p.bloom.threshold;
      this.bloom.render(r, null, this.rtDof, 0, false);
    }

    const u = this.matTone.uniforms;
    u.tHDR.value = this.rtDof.texture;
    u.uExposure.value = p.exposure ?? 1;
    u.uVignette.value = p.vignette ?? 0.35;
    u.uVigPow.value = p.vigPow ?? 2.2;
    u.uSat.value = p.sat ?? 1;
    u.uContrast.value = p.contrast ?? 1;
    u.uToneMix.value = p.toneMix ?? 1;
    u.uLift.value.set(...(p.lift || [0, 0, 0]));
    u.uGain.value.set(...(p.gain || [1, 1, 1]));
    u.uVigCenter.value.set(...(p.vigCenter || [0.5, 0.5]));
    this.quad.material = this.matTone;
    r.setRenderTarget(this.ldr[slot]); this.quad.render(r);
  }

  final({ mix = 0, fade = 1, grain = 0.03, seed = 0 }) {
    const r = this.renderer;
    const u = this.matFinal.uniforms;
    u.tA.value = this.ldr[0].texture; u.tB.value = this.ldr[1].texture;
    u.uMix.value = mix; u.uFade.value = fade; u.uGrain.value = grain; u.uSeed.value = seed;
    this.overlayTex.needsUpdate = true;
    this.quad.material = this.matFinal;
    r.setRenderTarget(null); this.quad.render(r);
  }
}
