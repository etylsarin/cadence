import { useRef, useState, type CSSProperties, type ReactNode, type MouseEvent, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  /** Tooltip body. */
  content: ReactNode
  /** Trigger element(s). */
  children: ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  maxWidth?: string
  disabled?: boolean
  /**
   * Anchor the tip to the pointer instead of the trigger's centre — for
   * triggers wider than the viewport (e.g. Gantt bars).
   */
  followCursor?: boolean
  className?: string
}

export default function AppTooltip({
  content,
  children,
  placement = 'top',
  maxWidth = '300px',
  disabled = false,
  followCursor = false,
  className = '',
  ...rest
}: Props) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const cursorX = useRef(0)
  const [show, setShow] = useState(false)
  const [tipStyle, setTipStyle] = useState<CSSProperties>({})

  function calcPos() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 8
    const base: CSSProperties = { position: 'fixed', zIndex: 9999, maxWidth, pointerEvents: 'none' }
    const halfW = (parseFloat(maxWidth) || 300) / 2
    const anchorX = followCursor
      ? Math.min(window.innerWidth - 8 - halfW, Math.max(8 + halfW, cursorX.current))
      : r.left + r.width / 2

    if (placement === 'right') {
      setTipStyle({ ...base, top: `${r.top + r.height / 2}px`, left: `${r.right + gap}px`, transform: 'translateY(-50%)' })
    } else if (placement === 'bottom') {
      setTipStyle({ ...base, top: `${r.bottom + gap}px`, left: `${anchorX}px`, transform: 'translateX(-50%)' })
    } else if (placement === 'left') {
      setTipStyle({ ...base, top: `${r.top + r.height / 2}px`, right: `${window.innerWidth - r.left + gap}px`, transform: 'translateY(-50%)' })
    } else {
      setTipStyle({ ...base, bottom: `${window.innerHeight - r.top + gap}px`, left: `${anchorX}px`, transform: 'translateX(-50%)' })
    }
  }

  function onEnter(ev: MouseEvent) {
    if (disabled) return
    cursorX.current = ev.clientX
    calcPos()
    setShow(true)
  }

  function onMove(ev: MouseEvent) {
    if (!show || !followCursor) return
    cursorX.current = ev.clientX
    calcPos()
  }

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-flex items-center ${className}`}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={() => setShow(false)}
        {...rest}
      >
        {children}
      </div>

      {show && createPortal(
        <div style={tipStyle}>
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300 whitespace-normal leading-relaxed">
            {content}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
