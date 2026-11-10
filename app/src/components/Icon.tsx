import type { IconKey } from "@contracts/blocks";

/**
 * Встроенные линейные иконки для преимуществ и информационных карточек.
 * Рисуются currentColor, набор ключей задан контрактом ICON_KEYS.
 */
const PATHS: Record<IconKey, React.ReactNode> = {
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </>
  ),
  truck: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  hand: (
    <>
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </>
  ),
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  shield: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  ),
  box: (
    <>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  card: (
    <>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </>
  ),
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  sparkle: (
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  ),
};

export function Icon({ name, size = 24 }: { name: IconKey; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Декоративная ветвь с листвой — мягкая тень поверх фотографий. */
export function LeafDecor({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 160"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 150 C 60 120, 110 90, 200 20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <g fill="currentColor" opacity="0.5">
        <ellipse
          cx="60"
          cy="112"
          rx="18"
          ry="8"
          transform="rotate(-28 60 112)"
        />
        <ellipse cx="95" cy="92" rx="16" ry="7" transform="rotate(-33 95 92)" />
        <ellipse
          cx="130"
          cy="68"
          rx="18"
          ry="8"
          transform="rotate(-36 130 68)"
        />
        <ellipse
          cx="165"
          cy="44"
          rx="15"
          ry="7"
          transform="rotate(-38 165 44)"
        />
        <ellipse
          cx="75"
          cy="130"
          rx="14"
          ry="6"
          transform="rotate(18 75 130)"
        />
        <ellipse
          cx="115"
          cy="103"
          rx="13"
          ry="6"
          transform="rotate(14 115 103)"
        />
        <ellipse
          cx="152"
          cy="76"
          rx="14"
          ry="6"
          transform="rotate(12 152 76)"
        />
      </g>
    </svg>
  );
}

export type MessengerKind = "telegram" | "whatsapp" | "vk" | "mail";

const MESSENGER_PATHS: Record<MessengerKind, React.ReactNode> = {
  telegram: (
    <path d="M21.6 4.1 18.9 18.9c-.2 1-.8 1.3-1.65.85l-4.35-3.2-2.1 2.02c-.23.23-.43.43-.87.43l.31-4.43L18.35 6.6c.35-.31-.08-.49-.54-.18l-9.93 6.25-4.28-1.34c-.93-.29-.95-.93.2-1.38L20.4 3.06c.78-.29 1.46.18 1.2 1.04Z" />
  ),
  whatsapp: (
    <path d="M12 2a10 10 0 0 0-8.62 15.06L2 22l5.06-1.33A10 10 0 1 0 12 2Zm5.35 14.13c-.22.63-1.3 1.21-1.79 1.26-.49.05-.94.22-3.17-.66-2.68-1.06-4.38-3.78-4.51-3.95-.13-.18-1.08-1.44-1.08-2.74s.68-1.94.92-2.2c.24-.27.53-.33.7-.33l.5.01c.16.01.38-.06.6.45.22.53.75 1.82.81 1.95.07.13.11.29.02.47-.09.18-.13.28-.26.44l-.39.45c-.13.13-.26.28-.11.54.15.26.66 1.09 1.41 1.76.97.86 1.79 1.13 2.05 1.26.26.13.41.11.56-.07.16-.17.66-.77.83-1.03.17-.26.35-.22.59-.13.24.09 1.55.73 1.81.86.26.13.44.2.5.31.06.11.06.63-.19 1.26Z" />
  ),
  vk: (
    <path d="M12.83 17.2c-5.1 0-8.02-3.5-8.14-9.32h2.56c.08 4.27 1.97 6.08 3.46 6.45V7.88h2.4v3.7c1.48-.16 3.03-1.84 3.55-3.7h2.4c-.4 2.29-2.08 3.97-3.27 4.66 1.19.56 3.1 2.02 3.83 4.66h-2.63c-.57-1.76-1.98-3.13-3.86-3.31v3.31h-.3Z" />
  ),
  mail: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m3 7 9 6.5L21 7" />
    </>
  ),
};

/** Логотипы мессенджеров для кнопок блока контактов. */
export function MessengerIcon({
  kind,
  size = 18,
}: {
  kind: MessengerKind;
  size?: number;
}) {
  const filled = kind !== "mail";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MESSENGER_PATHS[kind]}
    </svg>
  );
}
