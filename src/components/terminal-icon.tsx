import type { ReactNode, SVGProps } from 'react'

export type TerminalIconName =
  | 'grid'
  | 'layers'
  | 'activity'
  | 'review'
  | 'ledger'
  | 'repeat'
  | 'target'
  | 'wallet'
  | 'shield'
  | 'settings'
  | 'search'
  | 'panel'
  | 'bell'
  | 'chevron'
  | 'refresh'
  | 'close'

const paths: Record<TerminalIconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  activity: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
  review: <><path d="M5 3h14v18H5z" /><path d="M8 8h8M8 12h6M8 16h4" /></>,
  ledger: <><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 5v14" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" /><path d="M15 11h7v4h-7a2 2 0 0 1 0-4Z" /></>,
  shield: <><path d="M12 3 4 6v5c0 5.2 3.3 8.4 8 10 4.7-1.6 8-4.8 8-10V6l-8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  panel: <><path d="M4 4h16v16H4zM9 4v16" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6" /><path d="M20 4v7h-7" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
}

export function TerminalIcon({ name, ...props }: { name: TerminalIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
