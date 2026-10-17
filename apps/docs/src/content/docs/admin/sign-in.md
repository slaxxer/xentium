---
title: Ways to sign in
description: Passwords, passkeys, sign-in links, and Google, GitHub or Discord. What each one needs from you, and how they keep an account safe.
sidebar:
  order: 5
---

Your members can get into their account in several ways. A password always works. The
others appear on the sign-in page only once they can actually work on your site, so
nobody meets a button that leads nowhere.

## Keep me signed in

The sign-in form has a "Keep me signed in" box, ticked by default. Ticked, a session lasts
30 days. Unticked, the browser forgets it when it closes, and the server ends it 12 hours
after it was last used, for a browser that never closes.

## Sign-in links

A member types their email and gets a link that signs them in. It works once and expires
after 15 minutes. The page answers the same way whether or not the address has an account,
so nobody can use it to find out who is registered.

Opening the link does not sign anyone in by itself. The member presses **Continue**. Some
mail scanners open every link they see, and without that step they would use up the link
before the member got to it.

Sign-in links need email to work: set up SMTP under **ACP → System → Email**. Until you
do, the option stays hidden on a production site.

## Passkeys

A passkey lets a member sign in with Face ID, Touch ID, Windows Hello or a security key.
They add one in **Account → Security**, or while creating their account, and can rename or
remove it there.

Passkeys only work when your site is served over https, because browsers refuse them
anywhere else. They are tied to your site's address (`APP_URL`), so a passkey made for
`community.example.com` does not work on another address. **ACP → System → Settings → Login** says
whether passkeys are on for your site.

## Google, GitHub and Discord

To offer these, create an app with the provider and give your site its credentials:

1. Open **ACP → System → Settings → Login**. Each provider shows a **callback URL**.
2. At the provider, create an OAuth app (the panel links to the right console) and enter
   that callback URL exactly as shown.
3. Copy the app's client ID and client secret into the panel, press **Set** for the
   secret, and switch the provider on.

The button appears on the sign-in page once the provider is on and both values are set.
The secret is stored encrypted and is never shown again. To change it, remove it and set
a new one.

Someone signing in with a provider for the first time gets a new account, if registration
is open and the provider confirms their email address. If that address already belongs to
a member, we do not connect the two automatically. The member signs in the usual way and
connects the provider from **Account → Security**. That way, owning an email address at
Google is never enough to take over an account here. Invite-only and closed registration
apply to provider sign-ups too.

## The login PIN still counts

A member who set a login PIN is asked for it after a sign-in link or a provider as well,
not only after their password. A passkey that the device unlocked with a fingerprint, a
face or the device's own PIN already counts as two steps, so it skips the login PIN.

## Nobody gets locked out

Your site will not remove someone's last way to sign in. A member who joined through
Google and never set a password cannot disconnect Google until they add a passkey or set
a password. They can set a password at any time with **Forgot password**.
