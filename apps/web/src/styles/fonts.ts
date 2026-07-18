export const FONT_REGISTRY = [
  { value: "Poppins",     label: "Poppins",     stack: "Poppins, sans-serif" },
  { value: "Nunito",      label: "Nunito",      stack: "Nunito, sans-serif" },
  { value: "Montserrat",  label: "Montserrat",  stack: "Montserrat, sans-serif" },
  { value: "Open Sans",   label: "Open Sans",   stack: '"Open Sans", sans-serif' },
  { value: "Ubuntu",      label: "Ubuntu",      stack: "Ubuntu, sans-serif" },
] as const;

export type FontValue = typeof FONT_REGISTRY[number]["value"];
export const DEFAULT_FONT: FontValue = "Poppins";
