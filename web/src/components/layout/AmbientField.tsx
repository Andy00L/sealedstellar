// Ambient color field behind the glass: drifting blurred orbs that give the
// frosted surfaces something to refract, plus a soft vignette. Purely
// decorative, fixed, behind all content (z-0), and aria-hidden. The drift
// keyframes (ss-drift/2/3) live in index.css.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html ambient color field.

import type { CSSProperties } from 'react'

// Each orb's exact placement, size, colour, blur and drift are lifted from
// the design so the field reads identically.
const AMBIENT_ORBS: CSSProperties[] = [
  {
    top: -180,
    left: '5%',
    width: 560,
    height: 560,
    background: 'radial-gradient(circle, rgba(43,95,217,.34), transparent 62%)',
    filter: 'blur(26px)',
    animation: 'ss-drift 18s ease-in-out infinite',
  },
  {
    bottom: -220,
    right: '4%',
    width: 600,
    height: 600,
    background: 'radial-gradient(circle, rgba(126,45,38,.26), transparent 62%)',
    filter: 'blur(30px)',
    animation: 'ss-drift2 22s ease-in-out infinite',
  },
  {
    top: '24%',
    right: '22%',
    width: 460,
    height: 460,
    background: 'radial-gradient(circle, rgba(43,95,217,.22), transparent 66%)',
    filter: 'blur(28px)',
    animation: 'ss-drift3 26s ease-in-out infinite',
  },
  {
    top: '55%',
    left: '14%',
    width: 380,
    height: 380,
    background: 'radial-gradient(circle, rgba(95,72,180,.16), transparent 68%)',
    filter: 'blur(30px)',
    animation: 'ss-drift 30s ease-in-out infinite',
  },
  {
    top: -60,
    left: '34%',
    width: 300,
    height: 300,
    background: 'radial-gradient(circle, rgba(255,255,255,.6), transparent 66%)',
    filter: 'blur(24px)',
  },
]

export function AmbientField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      {AMBIENT_ORBS.map((orbStyle, orbIndex) => (
        <div
          key={orbIndex}
          className="absolute rounded-full"
          style={orbStyle}
        />
      ))}
      {/* Soft top-down vignette so the page edges settle into the paper. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(120% 95% at 50% -8%, transparent 48%, rgba(58,50,38,.16) 100%)',
        }}
      />
    </div>
  )
}
