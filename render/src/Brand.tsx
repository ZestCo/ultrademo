import {useEffect, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

// Brand profile (brands/<name>/brand.json, copied into the project's public
// dir under brand/ at render time). Optional: without a theme the renderer
// keeps its default dark slides and no sting/watermark.
export type LogoLayer = {name: string; file: string; x: number; y: number; w: number; h: number; z: number};
export type BrandTheme = {
  name: string;
  font?: {family: string; file: string; weight?: string};
  colors: {background: string; text: string; muted: string; emphasis: string; kicker?: string; literal?: string};
  logo: {full: string; mark: string; layers: string; dir: string; mark_parts?: string};
  sting?: {
    open?: {seconds: number; tagline?: boolean};
    close?: {seconds: number; tagline?: boolean};
    tagline?: string;
    audio?: string;
    timeScale?: number; // >1 slows the whole sting animation (2 = half speed)
  };
  watermark?: {src: string; width: number; opacity: number; position: 'bottom-right' | 'top-right'};
  // Filled in by Root from logo.layers / logo.mark_parts so components render
  // synchronously. The mark is two full petals (pink under yellow); the orange
  // in the logo is simply their overlap, drawn live during the sting.
  layers?: {width: number; height: number; layers: LogoLayer[]};
  mark?: {x: number; y: number; w: number; h: number; orange: string; pivot: {x: number; y: number}; fold: number; baseline?: number};
};

// The website's standard easing (design system --ease-out). Restrained: no
// bounce, no overshoot.
const EASE = Easing.bezier(0.165, 0.84, 0.44, 1);

const ease = (frame: number, start: number, dur: number, easing = EASE) =>
  interpolate(frame, [start, start + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});
// Smooth in-and-out for the fan, so overlapping phases flow into one motion
// (the ease-out curve decelerates hard and reads as a pause between phases).
const FAN = Easing.bezier(0.45, 0, 0.25, 1);

export const BrandFont: React.FC<{theme: BrandTheme}> = ({theme}) => {
  const [handle] = useState(() => (theme.font ? delayRender(`font ${theme.font.family}`) : null));
  useEffect(() => {
    if (!theme.font || handle === null) return;
    const face = new FontFace(theme.font.family, `url(${staticFile(theme.font.file)})`, {weight: theme.font.weight ?? '400 800'});
    face
      .load()
      .then(() => document.fonts.add(face))
      .finally(() => continueRender(handle));
  }, [handle, theme.font]);
  return null;
};

export const fontStack = (theme: BrandTheme) =>
  `${theme.font ? `"${theme.font.family}", ` : ''}ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;

// Logo sting: petals settle in one at a time (bottom petal first), the
// wordmark letters rise in, the t's accent lands last; optional tagline.
export const Sting: React.FC<{theme: BrandTheme; tagline?: boolean}> = ({theme, tagline}) => {
  const frame = useCurrentFrame() / (theme.sting?.timeScale ?? 1);
  const L = theme.layers;
  if (!L) return null;
  const width = 1100;
  const scale = width / L.width;
  // The mark is two petals sharing one rounded tip, opened like a fan on that
  // tip. The pink petal swings up out of an invisible ground (the logo's
  // baseline); the yellow rides along with it, then carries on opening -
  // starting as a small bud tucked inside the pink. Everything pivots on the
  // centre of the shared tip circle, so the tips stay locked together, and the
  // orange is the live overlap of the two shapes, so there are no seams.
  const M = theme.mark;
  // Closed fan (yellow blade stacked on the pink) swings up from below the
  // ground and fades in, so the tip never shows on its own; then the yellow
  // blade slides across the pink to open the fan.
  // Fast-out swing so the blade clears the "thin wedge beside the tip" stage
  // in a blink; the fade covers that moment.
  const rise = ease(frame, 0, 22);
  const fadeIn = ease(frame, 0, 9, Easing.inOut(Easing.sin)); // soft finish - an abrupt end reads as a jolt
  // Gentle sine in-out, starting early and running long, so the yellow's
  // slide blends into the pink's settle instead of kicking in as a second push.
  const yellowP = ease(frame, 3, 28, Easing.inOut(Easing.sin));
  const pinkAngle = (1 - rise) * -75; // starts folded down below the floor
  const grow = 1;
  const yellowAngle = pinkAngle + (1 - yellowP) * (M?.fold ?? 0);
  // (yellow shares the pink's settle-in scale while it opens)
  const yellowScale = 1;
  // While closed, only the overlap (one orange blade) shows; the pink and
  // yellow edges appear as the blades separate.
  // Edges appear exactly as fast as the blades separate (no fixed-time pop).
  const sep = Math.min(1, yellowP * 4);
  const split = fadeIn * (1 - Math.cos(Math.PI * sep)) / 2;
  const mark = (() => {
    if (!M) return null;
    const pad = 300; // room around the mark inside the ground window
    const base = (M.baseline ?? M.h) * scale;
    const part = {position: 'absolute', left: pad, top: pad, width: M.w * scale, height: M.h * scale} as const;
    const origin = `${M.pivot.x * scale}px ${M.pivot.y * scale}px`;
    const maskFor = (file: string) => ({
      WebkitMaskImage: `url(${staticFile(theme.logo.dir + file)})`,
      maskImage: `url(${staticFile(theme.logo.dir + file)})`,
      WebkitMaskSize: '100% 100%',
      maskSize: '100% 100%',
    });
    const yellowT = `rotate(${yellowAngle}deg) scale(${yellowScale})`;
    return (
      // Hidden floor: everything below the logo's baseline is clipped away.
      <div style={{position: 'absolute', left: M.x * scale - pad, top: M.y * scale - pad, width: M.w * scale + pad * 2, height: base + pad, overflow: 'hidden'}}>
        <Img src={staticFile(theme.logo.dir + 'petal-pink-full.png')} style={{...part, opacity: split, transform: `rotate(${pinkAngle}deg) scale(${grow})`, transformOrigin: origin}} />
        <Img src={staticFile(theme.logo.dir + 'petal-yellow-full.png')} style={{...part, opacity: split, transform: yellowT, transformOrigin: origin}} />
        {/* overlap = yellow shape clipped to the (turning) pink shape, filled orange */}
        <div style={{...part, transform: `rotate(${pinkAngle}deg) scale(${grow})`, transformOrigin: origin, ...maskFor('petal-pink-full.png')}}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: M.orange,
              opacity: fadeIn,
              transform: `scale(${1 / grow}) rotate(${yellowAngle - pinkAngle}deg) scale(${yellowScale})`,
              transformOrigin: origin,
              ...maskFor('petal-yellow-full.png'),
            }}
          />
        </div>
      </div>
    );
  })();
  const letters = ['letter-z', 'letter-e', 'letter-s', 'letter-t'];
  const tag = ease(frame, 46, 18);

  return (
    <AbsoluteFill style={{background: theme.colors.background, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{position: 'relative', width, height: L.height * scale, transform: `translateY(${tagline ? -50 : 0}px)`}}>
        {mark}
        {[...L.layers].sort((a, b) => a.z - b.z).map((layer) => {
          let opacity: number;
          let transform: string;
          if (layer.name === 'letter-t-accent') {
            const p = ease(frame, 40, 14);
            opacity = p;
            transform = `scale(${0.6 + 0.4 * p})`;
          } else {
            const p = ease(frame, 20 + letters.indexOf(layer.name) * 4, 15);
            opacity = p;
            transform = `translateY(${(1 - p) * 30}px)`;
          }
          return (
            <Img
              key={layer.name}
              src={staticFile(theme.logo.dir + layer.file)}
              style={{
                position: 'absolute',
                left: layer.x * scale,
                top: layer.y * scale,
                width: layer.w * scale,
                height: layer.h * scale,
                opacity,
                transform,
              }}
            />
          );
        })}
      </div>
      {tagline && theme.sting?.tagline ? (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            marginTop: (L.height * scale) / 2 + 10,
            fontFamily: fontStack(theme),
            fontWeight: 600,
            fontSize: 52,
            letterSpacing: '-0.02em',
            color: theme.colors.text,
            opacity: tag,
            transform: `translateY(${(1 - tag) * 16}px)`,
          }}
        >
          {theme.sting.tagline}
        </div>
      ) : null}
      {theme.sting?.audio ? <Audio src={staticFile(theme.sting.audio)} /> : null}
    </AbsoluteFill>
  );
};

// Title text with *emphasis* -> the brand's emphasis colour (design system:
// pomelo, max once per asset).
const Emph: React.FC<{text: string; color: string}> = ({text, color}) => (
  <>
    {/* Non-breaking hyphens: "self-service" must never split across lines. */}
    {text.replace(/(\w)-(\w)/g, '$1\u2011$2').split(/(\*[^*]+\*)/).map((part, i) =>
      part.startsWith('*') && part.endsWith('*') ? (
        <span key={i} style={{color}}>
          {part.slice(1, -1)}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    )}
  </>
);

// Branded intro / outro card: cream surface, small logo, orange kicker,
// ExtraBold sentence-case title, optional framed screenshot (cream padding,
// 23px outer radius, soft shadow - the design system's screenshot treatment).
export const BrandSlide: React.FC<{
  theme: BrandTheme;
  kind: 'intro' | 'outro';
  title: string;
  subtitle?: string;
  kicker?: string;
  url?: string;
  screenshot?: string;
  vertical: boolean;
  narrated: boolean;
  captionPosition?: 'bottom' | 'top';
}> = ({theme, kind, title, subtitle, kicker, url, screenshot, vertical, narrated, captionPosition}) => {
  const frame = useCurrentFrame();
  const t = ease(frame, 0, 18);
  const s = ease(frame, 6, 18);
  const c = theme.colors;
  const split = kind === 'intro' && Boolean(screenshot) && !vertical;
  const clear = narrated ? {[captionPosition === 'top' ? 'paddingTop' : 'paddingBottom']: 230} : {};

  const text = (
    <div style={{opacity: t, transform: `translateY(${(1 - t) * 20}px)`, flex: split ? '0 0 760px' : undefined, textAlign: split ? 'left' : 'center'}}>
      {kicker ? (
        <div style={{color: c.kicker ?? c.emphasis, fontWeight: 700, fontSize: 26, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 26}}>
          {kicker}
        </div>
      ) : null}
      <div style={{color: c.text, fontWeight: 800, fontSize: split ? 82 : vertical ? 72 : 88, lineHeight: 1.08, letterSpacing: '-0.02em', maxWidth: split ? 760 : 1500}}>
        <Emph text={title} color={c.emphasis} />
      </div>
      {subtitle ? <div style={{color: c.muted, fontWeight: 500, fontSize: 36, marginTop: 26, letterSpacing: '-0.02em'}}>{subtitle}</div> : null}
      {url ? <div style={{color: c.emphasis, fontWeight: 700, fontSize: 40, marginTop: 34, letterSpacing: '-0.02em'}}>{url}</div> : null}
    </div>
  );

  const shot =
    split && screenshot ? (
      <div
        style={{
          opacity: s,
          transform: `translateY(${(1 - s) * 20}px)`,
          background: c.background,
          padding: 24,
          borderRadius: 23,
          boxShadow: '0 18px 50px rgba(0,0,0,0.12)',
          width: 900,
          flexShrink: 0,
        }}
      >
        <Img src={staticFile(screenshot)} style={{width: '100%', display: 'block', borderRadius: 10}} />
      </div>
    ) : null;

  return (
    <AbsoluteFill
      style={{
        background: c.background,
        fontFamily: fontStack(theme),
        flexDirection: split ? 'row' : 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 90,
        padding: split ? '0 110px' : '0 80px',
        ...clear,
      }}
    >
      <Img src={staticFile(theme.logo.full)} style={{position: 'absolute', top: 56, left: 70, width: 210, opacity: t}} />
      {text}
      {shot}
    </AbsoluteFill>
  );
};

// Anti-theft watermark over the screen recording (design system: small Zest
// mark bottom-right, max 80px wide).
export const Watermark: React.FC<{theme: BrandTheme}> = ({theme}) => {
  const w = theme.watermark;
  if (!w) return null;
  return (
    <Img
      src={staticFile(w.src)}
      style={{
        position: 'absolute',
        right: 40,
        ...(w.position === 'top-right' ? {top: 36} : {bottom: 36}),
        width: Math.min(80, w.width),
        opacity: w.opacity,
        pointerEvents: 'none',
      }}
    />
  );
};
