import type { ComponentProps } from 'react'
import './FlightLink.css'

interface FlightLinkProps extends Omit<ComponentProps<'button'>, 'children' | 'type'> {
  label: string
}

/** The link that carries the visitor on to the next page. Each page places it with its own class. */
export function FlightLink({ label, className, ...button }: FlightLinkProps) {
  return (
    <button type="button" className={className ? `flight-link ${className}` : 'flight-link'} {...button}>
      <span className="flight-link__label">{label}</span>
      <svg className="flight-link__arrow" viewBox="0 0 46 10" width="46" height="10" fill="none" aria-hidden="true">
        <path d="M0 5h44M39.5 1l4.5 4-4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
