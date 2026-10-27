// Static, decorative example-trip map for the trips page background. Inline SVG, no network;
// colours come from the app's CSS tokens so it themes itself in light and dark mode.
const PINS: ReadonlyArray<readonly [number, number]> = [
  [150, 640], [330, 520], [520, 560], [700, 380], [880, 300], [1060, 180],
];

const ROUTE = "M150 640 C 220 600, 260 560, 330 520 S 450 590, 520 560 S 640 430, 700 380 S 820 340, 880 300 S 1000 240, 1060 180";

export function TripMapBackdrop() {
  return (
    <svg
      aria-hidden
      data-testid="trip-map-backdrop"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none opacity-[0.4]"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="1200" height="800" fill="var(--surface)" />
      {/* park areas */}
      <g fill="var(--accent-soft)" opacity="0.8">
        <path d="M-20 80 C 120 20, 300 40, 380 130 C 440 210, 360 290, 240 300 C 120 310, 0 260, -20 200 Z" />
        <path d="M760 520 C 860 470, 1020 490, 1110 560 C 1200 640, 1130 760, 980 780 C 840 800, 740 700, 760 520 Z" />
        <path d="M520 60 C 600 20, 700 50, 720 110 C 740 170, 650 200, 580 180 C 520 160, 480 100, 520 60 Z" />
      </g>
      {/* river */}
      <path d="M-20 420 C 120 380, 200 470, 330 430 S 520 330, 640 420 S 860 520, 960 440 S 1130 380, 1220 420" stroke="var(--accent)" strokeWidth="14" opacity="0.55" />
      <path d="M380 -20 C 400 100, 330 180, 420 280 S 460 380, 440 430" stroke="var(--accent)" strokeWidth="7" opacity="0.5" />
      {/* roads */}
      <g stroke="var(--border)" strokeWidth="5">
        <path d="M-20 700 C 200 740, 400 690, 600 720 S 1000 700, 1220 660" />
        <path d="M240 -20 C 260 200, 200 400, 260 820" />
        <path d="M980 -20 C 940 200, 1020 400, 960 820" />
        <path d="M0 250 C 300 230, 500 300, 760 240 S 1100 260, 1220 300" strokeWidth="3" />
      </g>
      {/* route */}
      <path d={ROUTE} stroke="var(--route)" strokeWidth="7" strokeDasharray="1 0" />
      {PINS.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="18" fill={i === 0 ? "var(--ink)" : "var(--sand)"} stroke="var(--surface)" strokeWidth="3" />
          <text x={x} y={y + 6} textAnchor="middle" fontSize="17" fontWeight="600" fontFamily="var(--font-sans)" fill={i === 0 ? "var(--ink-foreground)" : "var(--surface)"} stroke="none">
            {i + 1}
          </text>
        </g>
      ))}
      <g fontFamily="var(--font-sans)" fontSize="20" fontStyle="italic" fill="var(--muted)" stroke="none" letterSpacing="3">
        <text x="90" y="170">NATIONAL PARK</text>
        <text x="800" y="680">VALLEY</text>
      </g>
    </svg>
  );
}
