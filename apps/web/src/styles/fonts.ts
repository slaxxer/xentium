export const FONT_REGISTRY = [
  { value: "Raleway",     label: "Raleway",     stack: "Raleway, sans-serif" },
  { value: "Montserrat",  label: "Montserrat",  stack: "Montserrat, sans-serif" },
  { value: "Poppins",     label: "Poppins",     stack: "Poppins, sans-serif" },
  { value: "Open Sans",   label: "Open Sans",   stack: '"Open Sans", sans-serif' },
  { value: "Ubuntu",      label: "Ubuntu",      stack: "Ubuntu, sans-serif" },
  { value: "Roboto",      label: "Roboto",      stack: "Roboto, sans-serif" },
] as const;

export type FontValue = typeof FONT_REGISTRY[number]["value"];
export const DEFAULT_FONT: FontValue = "Raleway";
