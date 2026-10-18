import type { WeatherLine } from "@/lib/use-weather";
import { weatherAriaLabel, type WeatherLabel } from "@/lib/weather";

const SUN_RAYS = "M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4";
const CLOUD = "M7 19a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a4.75 4.75 0 0 1 0 9.5Z";

/** One outline per forecast label, in a 24-unit box; the colour is whatever text colour the caller sets. */
const SHAPES: Record<WeatherLabel, React.ReactNode> = {
  Clear: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d={SUN_RAYS} />
    </>
  ),
  "Partly cloudy": (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 2v1M2 8h1M3.8 3.8l.7.7M12.2 3.8l-.7.7" />
      <path d="M8.5 20a3.5 3.5 0 0 1-.5-6.96A5 5 0 0 1 17.5 12a4 4 0 0 1 0 8Z" />
    </>
  ),
  "Mostly cloudy": (
    <>
      <circle cx="17.5" cy="6" r="2.5" />
      <path d="M17.5 1.5v.8M22 6h-.8M20.7 2.8l-.6.6" />
      <path d="M6.5 20.5a4 4 0 0 1-.5-7.96A5.5 5.5 0 0 1 16.5 11a4.75 4.75 0 0 1 0 9.5Z" />
    </>
  ),
  Overcast: <path d={CLOUD} />,
  "Rain likely": (
    <>
      <path d="M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 5.5a4.75 4.75 0 0 1 0 9.5" />
      <path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" />
    </>
  ),
};

export function WeatherIcon({ sky, className = "" }: { sky: WeatherLabel; className?: string }) {
  return (
    <svg
      data-sky={sky}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 ${className}`}
    >
      {SHAPES[sky]}
    </svg>
  );
}

/** A weather line: the icon (when there is a sky) and the temperature, spoken as one image with the words. */
export function WeatherText({ line, className = "" }: { line: WeatherLine; className?: string }) {
  return (
    <span role="img" aria-label={weatherAriaLabel(line)} className={`inline-flex items-center gap-1 align-middle ${className}`}>
      {line.sky && <WeatherIcon sky={line.sky} />}
      {line.text}
    </span>
  );
}
