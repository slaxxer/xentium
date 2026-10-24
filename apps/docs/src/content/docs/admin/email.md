---
title: Email
description: The mail server, how your emails look, the contact support link, and the messages your site sends.
sidebar:
  order: 9
---

Everything about the emails your site sends lives in **ACP → System → Email**: the mail
server, how the emails look, and the text of each message. Changes here wait in the save bar
at the bottom until you save them.

## The mail server

Under **Server**, enter your SMTP host and port, whether it uses TLS, the user and password,
and the address and name emails come from.
**SMTP test** sends a test email to an address you choose, so you know the settings work before
a member needs a password reset.

Without a working mail server, your site still runs, but nobody receives sign-in links, password
resets or notifications by email. A member asking for a password reset sees the same answer
either way, so the form never tells a stranger which addresses have an account.

## How your emails look

**Design** sets the frame every email is sent in. The live preview below it shows the password
reset email with your changes, exactly as it will be sent.

- **Accent colour**: the band at the top, the buttons and the links. On a light colour, the text
  on it turns dark, so it stays readable.
- **Page colour**: the background around the message.
- **Header**: your icon and site name, your logo alone, or the name only. The images come from
  **Appearance → Branding**. Mail apps only show PNG, JPEG and GIF, so an SVG logo falls back to
  the name.
- **Contact support link**: where "contact support" in the password reset email points. Enter a
  web address (`https://…`) or an email address. Leave it empty and the words show without a
  link.
- **Footer note**: a note under the message, such as your address. You write it with the same
  editor as posts, so it can have bold text, links and lists. Your site's name and address
  always follow it, as "Sent by …".

**Use defaults** puts the design back to how Xentium ships it.

Every email paints its own white card on your page colour, so it stays readable in mail apps that
use dark mode.

## The messages

The other sections are the messages your site sends: **Notification**, **Password reset**,
**Sign-in link**, **Verify email** and **Email change**. Each has a subject and a body you write
like a post. The frame, your colours and the buttons are added when the email is sent.

A few things to know when you edit one:

- **Language.** Unchanged, an email goes out in each member's own language. Once you edit it,
  your version goes to everyone as written. **Reset to default** brings back the translated
  versions.
- **Placeholders** like `{{site_name}}` or `{{username}}` are filled in when the email is sent.
  Each message lists the ones it can use; click one to insert it at the cursor.
- **The heading** at the very top of the body moves up into the coloured band.
- **Small print**: everything after a horizontal line is set smaller and quieter, for lines like
  "Not you? Ignore this email."
- **Buttons and boxes** are placeholders on a line of their own, like `{{reset_button}}` or
  `{{code_box}}`. Your site draws them in your accent colour.

### The password reset email

It tells the member who asked, in a **Request details** box:

- **Time**: when the reset was asked for, in your site's time zone and the member's language.
- **Device**: the browser and system, like "Chrome 141 · macOS".
- **Location**: the country the request came from. We look it up on your own server; the address
  itself is never written into the email.

A row we can't work out is left out. A reset you send from a member's page in the ACP has no
box, because nobody asked from a device.

These are its placeholders, besides the usual ones:

| Placeholder | What it shows |
|---|---|
| `{{reset_button}}` | The button, with how long the link works under it |
| `{{request_box}}` | The Request details box |
| `{{request_time}}`, `{{request_device}}`, `{{request_location}}` | One detail each, as text |
| `{{support_link}}` | "contact support", linked to your contact support link |

If you edited the password reset email before 1.0.0-alpha.20, it keeps your text and gets the new
frame. To get the new text with the request details, use **Reset to default**.
