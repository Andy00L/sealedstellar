// Debounce a rapidly changing value so expensive work (filtering on the search
// term) runs after typing settles, while the input itself stays instant via its
// own local state. Why new: no debounce helper exists in the app.

import { useEffect, useState } from 'react'

export function useDebouncedValue<ValueType>(value: ValueType, delayMs: number): ValueType {
  const [debouncedValue, setDebouncedValue] = useState<ValueType>(value)

  // external system: a debounce timer. One timeout per change, cleared on the
  // next change or on unmount.
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)
    return () => {
      clearTimeout(timerId)
    }
  }, [value, delayMs])

  return debouncedValue
}
