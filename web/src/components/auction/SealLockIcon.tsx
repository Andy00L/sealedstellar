// Custom icon: the hi-fi lock glyph (rounded body, shackle, keyhole dot) is
// the product's central seal motif and lucide ships no keyhole-dot variant,
// so this one component re-draws it verbatim.
// sourceRef: design-handoff/stellar/project/ss-ui.jsx SSLock.

type SealLockIconProps = {
  size?: number
  color?: string
  isOpen?: boolean
}

export function SealLockIcon({ size = 16, color = 'currentColor', isOpen = false }: SealLockIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="9.5" rx="3" />
      {isOpen ? (
        <path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 6.6 -1.6" />
      ) : (
        <path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" />
      )}
      <circle cx="12" cy="15.2" r="1.2" fill={color} stroke="none" />
    </svg>
  )
}
