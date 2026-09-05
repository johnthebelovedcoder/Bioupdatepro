/**
 * Icon set.
 *
 * Hand-written inline SVG rather than an icon package: the product needs about
 * twenty icons, and a dependency for that would be more weight than the icons.
 * All are 24×24 on a 2px stroke grid so they sit on the same optical weight,
 * and all inherit `currentColor` so tone is set by the surrounding CSS.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  size = 20,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconFarm = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M5 9.8V20h14V9.8" />
    <path d="M9.5 20v-5h5v5" />
  </Svg>
);

export const IconBird = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 7h.01" />
    <path d="M3.5 13a6.5 6.5 0 0 1 6.5-6.5h1.2A5.3 5.3 0 0 1 16.5 4L21 6l-2 2.5V11a6 6 0 0 1-6 6h-1l-2.5 4" />
    <path d="M7 17.5 5 21" />
  </Svg>
);

export const IconSnail = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="13.5" r="6" />
    <circle cx="10.5" cy="13.5" r="2.6" />
    <path d="M16.5 13.5c0 3.6 1.2 5.5 4.5 5.5H4" />
    <path d="M18.5 8.5 20 6M21.5 8 22 5.5" />
  </Svg>
);

export const IconBox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 8.5v7a1.8 1.8 0 0 1-.95 1.6l-7 3.7a1.8 1.8 0 0 1-1.7 0l-7-3.7A1.8 1.8 0 0 1 3 15.5v-7" />
    <path d="M3.3 7.6 12 3l8.7 4.6L12 12.3 3.3 7.6Z" />
    <path d="M12 12.3V21" />
  </Svg>
);

export const IconCart = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
    <path d="M2.5 3.5h2.2l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.3l1.4-7.2H6" />
  </Svg>
);

export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 11.4V4.5a1 1 0 0 1 1-1h6.9a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.9 6.9a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z" />
    <path d="M8 8h.01" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 7.5V6a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-1.5" />
    <path d="M21 8.5h-5a3.5 3.5 0 0 0 0 7h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1Z" />
    <path d="M16.5 12h.01" />
  </Svg>
);

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3v16.5a1.5 1.5 0 0 0 1.5 1.5H21" />
    <path d="M7.5 15.5V11M12 15.5V7.5M16.5 15.5v-3" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 20v-1.6a3.9 3.9 0 0 0-3.9-3.9H6.4a3.9 3.9 0 0 0-3.9 3.9V20" />
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M21.5 20v-1.6a3.9 3.9 0 0 0-2.9-3.8M16 4.2a3.9 3.9 0 0 1 0 7.5" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 0 4 20.5Z" />
    <path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H20" />
    <path d="M8 7h8M8 10.5h5" />
  </Svg>
);

export const IconCheckCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.3 3.9 2.4 17.1A1.9 1.9 0 0 0 4 20h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Svg>
);

export const IconTrendDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M22 17.5 13.5 9l-4 4L2 5.5" />
    <path d="M16.5 17.5H22V12" />
  </Svg>
);

export const IconTrendUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M22 6.5 13.5 15l-4-4L2 18.5" />
    <path d="M16.5 6.5H22V12" />
  </Svg>
);

export const IconEgg = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c3.6 0 6.5 5.4 6.5 9.6A6.5 6.5 0 0 1 12 21a6.5 6.5 0 0 1-6.5-8.4C5.5 8.4 8.4 3 12 3Z" />
  </Svg>
);

export const IconFeed = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
    <path d="M4 8.5 12 13l8-4.5M12 13v7" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
    <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconSignOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" />
    <path d="m16 16 5-4-5-4M21 12H9" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconClipboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="3" width="8" height="4" rx="1.2" />
    <path d="M16 5h2a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 5h2" />
    <path d="M8.5 12h7M8.5 16h4" />
  </Svg>
);

export const IconConstruction = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.5h17v4h-17z" />
    <path d="M6 13.5V21M18 13.5V21M4.5 21h15" />
    <path d="m7 9.5 3-6M13 9.5l3-6" />
  </Svg>
);

/** The outbox trigger's icon — the same cloud-sync idiom as Drive/Dropbox/Notion for "is my work saved". */
export const IconCloudSync = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.4-2.3A4.5 4.5 0 0 1 17 18.5H7Z" />
    <path d="M9.5 13.5 12 11l2.5 2.5M12 11.2V17" />
  </Svg>
);
