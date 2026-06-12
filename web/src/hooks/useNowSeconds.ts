import { useEffect, useState } from 'react'

// Wall-clock seconds, ticking once per second. Drives countdowns and the
// open/awaiting tone split.
export function useNowSeconds(): number {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  // external system: the wall clock; a 1s interval keeps countdowns live,
  // cleared on unmount.
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(intervalId)
  }, [])

  return nowSeconds
}
