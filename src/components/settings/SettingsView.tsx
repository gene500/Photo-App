"use client";

import Link from "next/link";
import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { IN_APP_KEY } from "@/components/InAppNavMarker";
import { LegalLinks } from "@/components/legal/LegalPage";
import { ChangePasswordButton, DeleteAccountButton, SignOutButton, SignOutEverywhereButton } from "@/components/SignOutButton";
import { btnSecondary, card, inputClass } from "@/components/ui/styles";
import { clearAllCopies } from "@/lib/offline-store";
import { MAX_DWELL_MINUTES } from "@/lib/validation";
import type { Settings } from "@/lib/settings";
import { useSettings } from "./SettingsProvider";

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`scroll-mt-4 space-y-5 p-5 ${card}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

type Option<T extends string> = { value: T; label: string };

/** A segmented control built on native radios, so arrow keys, grouping and labels come for free. */
function Segmented<K extends keyof Settings>({ legend, hint, name, value, options, onChange }: {
  legend: string;
  hint?: ReactNode;
  name: K;
  value: Settings[K];
  options: Option<Extract<Settings[K], string>>[];
  onChange: (v: Extract<Settings[K], string>) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-1 rounded-xl bg-hover p-1">
        {options.map((o) => (
          <label key={o.value} className="relative min-w-0 flex-1">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" />
            <span className="flex min-h-9 cursor-pointer items-center justify-center rounded-lg px-3 py-1.5 text-center text-sm text-muted transition hover:text-foreground peer-checked:bg-surface peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent-strong">
              {o.label}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

/** Back goes to the page the user came from (the trip, tab and all) when the tab has been inside the app; a direct visit falls back to the trips list. */
function goBack(e: MouseEvent<HTMLAnchorElement>) {
  try {
    if (window.history.length > 1 && window.sessionStorage.getItem(IN_APP_KEY) === "1") {
      e.preventDefault();
      window.history.back();
    }
  } catch {
    // Link's own href takes over.
  }
}

export function SettingsView({ email, hasPassword = true }: { email: string | null; hasPassword?: boolean }) {
  const { settings, update, reset } = useSettings();
  const dwellId = useId();
  // The text being typed may be empty or out of range; only a valid number is saved, and blur snaps it back.
  const [dwellText, setDwellText] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  function onDwell(text: string) {
    setDwellText(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) update({ defaultDwellMinutes: n });
  }

  return (
    <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-accent-strong">Skip to content</a>
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl space-y-5 px-4 py-8 outline-none">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link href="/trips" onClick={goBack} className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm text-muted hover:bg-hover hover:text-foreground">‹ Back</Link>
      </div>
      <p className="text-sm text-muted">These are saved on this device only.</p>

      <Section title="Appearance">
        <Segmented
          legend="Theme"
          name="theme"
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
        />
        <Segmented
          legend="Text size"
          name="textSize"
          value={settings.textSize}
          onChange={(textSize) => update({ textSize })}
          options={[{ value: "default", label: "Default" }, { value: "large", label: "Large" }, { value: "xlarge", label: "Extra large" }]}
          hint={<span data-testid="text-preview">The light is best an hour before sunset, so plan to arrive early.</span>}
        />
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={settings.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} className="h-6 w-6 shrink-0 accent-[var(--accent-strong)]" />
          <span className="text-sm">
            <span className="font-medium">Reduce motion</span>
            <span className="block text-xs text-muted">Turns off animations and transitions. Your device&apos;s own reduce-motion setting is always respected.</span>
          </span>
        </label>
      </Section>

      <Section title="Units and time">
        <Segmented
          legend="Units"
          name="distanceUnit"
          value={settings.distanceUnit}
          onChange={(distanceUnit) => update({ distanceUnit })}
          options={[{ value: "mi", label: "Imperial" }, { value: "km", label: "Metric" }]}
          hint="Imperial shows miles and °F. Metric shows kilometres and °C."
        />
        <Segmented
          legend="Time format"
          name="timeFormat"
          value={settings.timeFormat}
          onChange={(timeFormat) => update({ timeFormat })}
          options={[{ value: "auto", label: "Default (12-hour)" }, { value: "12h", label: "12-hour" }, { value: "24h", label: "24-hour" }]}
        />
      </Section>

      <Section title="Map">
        <Segmented
          legend="Map style"
          name="mapStyle"
          value={settings.mapStyle}
          onChange={(mapStyle) => update({ mapStyle })}
          options={[{ value: "beige", label: "Beige" }, { value: "standard", label: "Standard" }]}
          hint="Takes effect the next time the map loads."
        />
      </Section>

      <Section title="New stops">
        <div>
          <label htmlFor={dwellId} className="block text-sm font-medium">Time at each new stop (minutes)</label>
          <input
            id={dwellId}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DWELL_MINUTES}
            value={dwellText ?? String(settings.defaultDwellMinutes)}
            onChange={(e) => onDwell(e.target.value)}
            onBlur={() => setDwellText(null)}
            className={`${inputClass} max-w-40`}
          />
          <p className="mt-2 text-xs text-muted">0 to {MAX_DWELL_MINUTES}. Used when you add a stop.</p>
        </div>
        <Segmented
          legend="Best light for suggested stops"
          name="suggestionLightPref"
          value={settings.suggestionLightPref}
          onChange={(suggestionLightPref) => update({ suggestionLightPref })}
          options={[{ value: "auto", label: "Automatic" }, { value: "any", label: "Any light" }]}
          hint="Automatic picks golden hour for viewpoints and peaks and any light for everything else."
        />
      </Section>

      <Section title="Optimize route" id="optimize">
        <Segmented
          legend="What Optimize puts first"
          name="optimizeFocus"
          value={settings.optimizeFocus}
          onChange={(optimizeFocus) => update({ optimizeFocus })}
          options={[{ value: "priority", label: "Priority focus" }, { value: "time", label: "Time priority" }]}
          hint="Priority focus fits in as many High and Must stops (in their best light) as it can, even if the drive gets longer. Time priority treats every stop alike, so drive time and missed light decide the route. Takes effect the next time you optimize."
        />
      </Section>

      <Section title="Data">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnSecondary} onClick={() => { clearAllCopies(); setCleared(true); }}>
            Clear saved offline copies
          </button>
          {cleared && <p role="status" className="text-sm text-muted">Saved offline copies cleared.</p>}
        </div>
      </Section>

      <Section title="Account">
        <p className="text-sm">Signed in as <span className="break-all font-medium">{email ?? "your account"}</span></p>
        <div><SignOutButton className={btnSecondary} /></div>
        <div>
          <SignOutEverywhereButton className={btnSecondary} />
          <p className="mt-2 text-xs text-muted">Ends every session on every device, including this one. Use it if you lost a phone or signed in on a shared computer.</p>
        </div>
        {hasPassword && <div><ChangePasswordButton className={btnSecondary} /></div>}
        {!hasPassword && <p className="text-xs text-muted">You sign in with Google, so there is no password to change.</p>}
        <div><DeleteAccountButton className={btnSecondary} hasPassword={hasPassword} /></div>
      </Section>

      <div>
        <button type="button" className={btnSecondary} onClick={() => { reset(); setDwellText(null); }}>
          Reset to defaults
        </button>
      </div>
      <LegalLinks />
    </main>
    </>
  );
}
