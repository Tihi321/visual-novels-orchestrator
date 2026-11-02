import { useState } from 'react'

/** One warning line that expands on click and hides with × until a different text arrives. */
export function WarnStrip({ text }: { text: string | undefined }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState<string | null>(null)
  if (!text || hidden === text) return null
  return (
    <div className={`warn-strip${open ? ' open' : ''}`} role="status" data-testid="warn-strip">
      <button type="button" className="warn-strip-text" aria-expanded={open} title={open ? undefined : 'Show the whole warning'} onClick={() => setOpen(!open)}>
        {'⚠ '}
        {text}
      </button>
      <button
        type="button"
        className="warn-strip-close"
        aria-label="Dismiss warning"
        data-testid="warn-dismiss"
        onClick={() => {
          setHidden(text)
          setOpen(false)
        }}
      >
        {'×'}
      </button>
    </div>
  )
}
