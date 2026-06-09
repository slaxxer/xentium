import { prisma } from "../infrastructure/db.js";

/**
 * Seeds core system profile fields.
 * Safe to re-run; never wipes admin-customised labels or positions.
 */
const SYSTEM_FIELDS = [
  {
    key: "date_of_birth",
    label: "Date of Birth",
    type: "date",
    placeholder: "",
    position: 1,
    showOnRegistration: true,
    requiredOnRegistration: false,
    showOnProfile: true,
    dobDisplayFormat: "age",
  },
  {
    key: "website",
    label: "Website",
    type: "url",
    placeholder: "https://yoursite.com",
    position: 2,
    showOnRegistration: false,
    requiredOnRegistration: false,
    showOnProfile: true,
    dobDisplayFormat: null,
  },
  {
    key: "github",
    label: "GitHub",
    type: "text",
    placeholder: "your-username",
    position: 3,
    showOnRegistration: false,
    requiredOnRegistration: false,
    showOnProfile: true,
    dobDisplayFormat: null,
  },
  {
    key: "discord",
    label: "Discord",
    type: "text",
    placeholder: "username or tag",
    position: 4,
    showOnRegistration: false,
    requiredOnRegistration: false,
    showOnProfile: true,
    dobDisplayFormat: null,
  },
] as const;

export async function seedSystemProfileFields() {
  for (const f of SYSTEM_FIELDS) {
    await prisma.userProfileField.upsert({
      where: { key: f.key },
      update: {
        // never overwrite admin-customised label/position — only ensure flag presence
        type: f.type,
        isSystem: true,
      },
      create: {
        key: f.key,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        position: f.position,
        showOnRegistration: f.showOnRegistration,
        requiredOnRegistration: f.requiredOnRegistration,
        showOnProfile: f.showOnProfile,
        dobDisplayFormat: f.dobDisplayFormat,
        isSystem: true,
      },
    });
  }
}
