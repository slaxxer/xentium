export const SLOTS = { HEADER: 'header', SIDEBAR: 'sidebar', MAIN: 'main', FOOTER: 'footer' } as const;
export type SlotName = (typeof SLOTS)[keyof typeof SLOTS];
