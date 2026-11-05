/**
 * The app icon as drawn in the top bar and onboarding: a blue tile with a dial whose ring shows
 * three activities and two clock hands. Decorative: the app name always sits next to it. The
 * colours are the icon's own, the same in every theme (like the Dock icon).
 */
export function AppLogo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="100 100 824 824"
      className={className}
      style={{ flex: 'none' }}
    >
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#2563EB" />
      <g transform="rotate(-90 512 512)" fill="none" strokeWidth="80">
        <circle cx="512" cy="512" r="262" stroke="#FFFFFF" strokeOpacity="0.16" />
        <circle cx="512" cy="512" r="262" pathLength={100} stroke="#C7D9FF" strokeDasharray="36 64" />
        <circle cx="512" cy="512" r="262" pathLength={100} stroke="#86EFAC" strokeDasharray="14 86" strokeDashoffset="-38" />
        <circle cx="512" cy="512" r="262" pathLength={100} stroke="#FDBA74" strokeDasharray="14 86" strokeDashoffset="-54" />
      </g>
      <circle cx="512" cy="512" r="170" fill="#FFFFFF" />
      <path d="M512 512 L512 404 M512 512 L592 560" stroke="#1D4ED8" strokeWidth="44" strokeLinecap="round" />
    </svg>
  );
}
