// Static, decorative example-trip map for the trips page background. Inline SVG, no network;
// colours come from the app's CSS tokens so it themes itself in light and dark mode.
// Drawn zoomed out: many small land shapes and roads, and one long route through 12 stops.
const PINS: ReadonlyArray<readonly [number, number]> = [
  [70, 690], [190, 610], [300, 660], [400, 540], [500, 590], [610, 470],
  [700, 520], [790, 390], [880, 430], [960, 300], [1060, 340], [1140, 200],
];

// Smooth single path through every stop (Catmull-Rom converted to cubic Beziers).
function routePath(pts: ReadonlyArray<readonly [number, number]>): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = Math.round(p1[0] + (p2[0] - p0[0]) / 6);
    const c1y = Math.round(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = Math.round(p2[0] - (p3[0] - p1[0]) / 6);
    const c2y = Math.round(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const ROUTE = routePath(PINS);

export function TripMapBackdrop() {
  return (
    <svg
      aria-hidden
      data-testid="trip-map-backdrop"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none opacity-[0.3]"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="1200" height="800" fill="var(--surface)" />
      {/* parks and land areas */}
      <g data-map-layer="land" fill="var(--accent-soft)" opacity="0.8">
        <path d="M-20 40 C 60 10, 160 20, 200 70 C 230 120, 170 160, 100 160 C 30 160, -20 110, -20 40 Z" />
        <path d="M300 30 C 360 0, 440 20, 450 70 C 460 120, 390 140, 340 120 C 290 100, 270 60, 300 30 Z" />
        <path d="M560 40 C 620 10, 700 30, 710 80 C 720 130, 650 150, 600 130 C 550 110, 530 70, 560 40 Z" />
        <path d="M860 60 C 930 20, 1040 40, 1060 100 C 1080 160, 1000 190, 930 170 C 860 150, 820 100, 860 60 Z" />
        <path d="M1090 330 C 1150 300, 1230 330, 1230 400 C 1230 470, 1150 480, 1100 450 C 1060 420, 1060 350, 1090 330 Z" />
        <path d="M20 330 C 80 290, 170 310, 190 370 C 210 430, 140 470, 80 460 C 20 450, -10 380, 20 330 Z" />
        <path d="M600 620 C 680 580, 790 600, 820 670 C 850 740, 770 790, 690 780 C 610 770, 560 670, 600 620 Z" />
        <path d="M880 560 C 950 530, 1050 560, 1070 630 C 1090 700, 1020 740, 950 730 C 880 720, 840 610, 880 560 Z" />
        <path d="M250 740 C 300 710, 380 720, 400 760 C 420 800, 300 820, 260 790 Z" />
      </g>
      {/* rivers and lake */}
      <g stroke="var(--accent)" opacity="0.5">
        <path d="M-20 450 C 100 420, 160 500, 270 470 S 440 400, 540 460 S 720 560, 800 500 S 960 440, 1040 480 S 1160 520, 1220 490" strokeWidth="8" />
        <path d="M340 -20 C 350 60, 300 120, 360 200 S 400 330, 380 400 S 330 450, 350 480" strokeWidth="4" />
        <path d="M760 -20 C 780 80, 740 160, 800 240 S 840 340, 820 420" strokeWidth="4" />
      </g>
      <ellipse cx="500" cy="270" rx="46" ry="22" fill="var(--accent)" opacity="0.4" />
      <ellipse cx="1000" cy="620" rx="34" ry="16" fill="var(--accent)" opacity="0.4" />
      {/* roads */}
      <g data-map-layer="roads" stroke="var(--border)" strokeWidth="3">
        <path d="M-20 740 C 200 770, 400 730, 600 760 S 1000 740, 1220 700" />
        <path d="M-20 560 C 150 540, 300 580, 480 540 S 800 590, 1220 570" strokeWidth="2" />
        <path d="M-20 250 C 300 230, 500 300, 760 240 S 1100 260, 1220 300" strokeWidth="2" />
        <path d="M-20 130 C 200 150, 420 110, 640 170 S 1000 130, 1220 160" strokeWidth="2" />
        <path d="M120 -20 C 140 200, 90 400, 150 820" strokeWidth="2" />
        <path d="M240 -20 C 260 200, 210 400, 270 820" />
        <path d="M440 -20 C 460 200, 410 400, 470 820" strokeWidth="2" />
        <path d="M660 -20 C 640 200, 700 400, 650 820" strokeWidth="2" />
        <path d="M900 -20 C 880 200, 940 400, 890 820" />
        <path d="M1040 -20 C 1060 200, 1000 400, 1060 820" strokeWidth="2" />
        <path d="M-20 360 L 300 330 L 560 380 L 900 340 L 1220 390" strokeWidth="1.5" />
        <path d="M200 820 L 380 600 L 560 640 L 740 480" strokeWidth="1.5" />
      </g>
      {/* route */}
      <path data-testid="trip-map-route" d={ROUTE} stroke="var(--route)" strokeWidth="4" />
      {PINS.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="11" fill={i === 0 ? "var(--ink)" : "var(--sand)"} stroke="var(--surface)" strokeWidth="2" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="var(--font-sans)" fill={i === 0 ? "var(--ink-foreground)" : "var(--surface)"} stroke="none">
            {i + 1}
          </text>
        </g>
      ))}
      <g fontFamily="var(--font-sans)" fontSize="13" fontStyle="italic" fill="var(--muted)" stroke="none" letterSpacing="2">
        <text x="40" y="100">NATIONAL PARK</text>
        <text x="880" y="120">STATE FOREST</text>
        <text x="620" y="700">VALLEY</text>
      </g>
    </svg>
  );
}
