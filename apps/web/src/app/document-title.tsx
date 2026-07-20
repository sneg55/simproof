import { useLayoutEffect } from 'react'

const DEFAULT_TITLE = 'SimProof'

export function DocumentTitle({ value }: { readonly value: string }) {
  useLayoutEffect(() => {
    document.title = value
    return () => {
      if (document.title === value) document.title = DEFAULT_TITLE
    }
  }, [value])
  return null
}
