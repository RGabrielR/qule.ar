const base = {
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
};

export const GroupIcon = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></svg>
);
export const ChatIcon = () => (
  <svg {...base}><path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const UserIcon = () => (
  <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.2 4-6.5 8-6.5s7 2.3 8 6.5" /></svg>
);
export const BackIcon = () => (
  <svg {...base}><path d="M15 5l-7 7 7 7" /></svg>
);
export const SendIcon = () => (
  <svg {...base}><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>
);
export const ImageIcon = () => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>
);
export const ClockIcon = () => (
  <svg {...base} width={14} height={14}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const DotsIcon = () => (
  <svg {...base}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
);
export const GridIcon = () => (
  <svg {...base}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></svg>
);
export const FilterIcon = () => (
  <svg {...base} width={16} height={16}><path d="M4 6h16M7 12h10M10 18h4" /></svg>
);
export const PinIcon = ({ size = 28 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const StarIcon = ({ filled = false, size = 20 }: { filled?: boolean; size?: number }) => (
  <svg {...base} width={size} height={size} fill={filled ? "currentColor" : "none"}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
);
export const LockIcon = () => (
  <svg {...base} width={16} height={16}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const EyeIcon = () => (
  <svg {...base} width={18} height={18}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const EyeOffIcon = () => (
  <svg {...base} width={18} height={18}><path d="M3 3l18 18M10.6 5.1A9 9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.5M6.1 6.1A17 17 0 0 0 2 12s3.6 7 10 7a9 9 0 0 0 5.9-2.1M10 10a3 3 0 0 0 4 4" /></svg>
);
export const TimerIcon = () => (
  <svg {...base} width={18} height={18}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>
);
export const InfoIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const PlusIcon = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const RefreshIcon = () => (
  <svg {...base}><path d="M20 4v6h-6m6 0a8 8 0 1 0-.7 6" /></svg>
);
export const CheckIcon = () => (
  <svg {...base}><path d="m5 12 4 4L19 6" /></svg>
);
export const EditIcon = () => (
  <svg {...base}><path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" /></svg>
);
export const SettingsIcon = () => (
  <svg {...base}><path d="M9.5 3h5l.7 2.4 2 .9 2.3-.8 2.5 4.3-1.7 1.8v2l1.7 1.8-2.5 4.3-2.3-.8-2 .9-.7 2.2h-5l-.7-2.2-2-.9-2.3.8L2 15.4l1.7-1.8v-2L2 9.8l2.5-4.3 2.3.8 2-.9L9.5 3Z" /><circle cx="12" cy="12.5" r="3" /></svg>
);
export const ChevronLeftIcon = () => (
  <svg {...base}><path d="m15 5-7 7 7 7" /></svg>
);
export const ChevronRightIcon = () => (
  <svg {...base}><path d="m9 5 7 7-7 7" /></svg>
);
export const CloseIcon = () => (
  <svg {...base} width={18} height={18}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
/**
 * Frases guardadas del chat: un globo rectangular con dos renglones.
 * Rectangular para que los renglones queden centrados y no se confunda con el globo redondo de Mensajes.
 */
export const PhraseIcon = () => (
  <svg {...base}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z" /><path d="M8 8.5h8M8 12.5h5" /></svg>
);
/** Avisos (notificaciones): una campana. */
export const BellIcon = () => (
  <svg {...base} width={18} height={18}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19.5a2.2 2.2 0 0 0 4 0" /></svg>
);
