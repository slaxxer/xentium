---
title: Announcements
description: How the Xentium team reaches your admin panel, what we will and will not send, and how to tell a real notice from a fake one.
sidebar:
  order: 3
---

Sometimes we need to tell you something directly: a security problem, a change that needs
your attention, a deadline. Your site picks those up on its own and shows them in the ACP.

## How your site finds out

Once a day, and again whenever the worker process restarts, your site asks us whether there
is anything to pass on. The question is anonymous. It sends no site id, no account, no
version and no list of your plugins, and it works the same whether or not you have connected
a marketplace account. We cannot tell which sites asked, and we do not record who read what.

It rides along with the same daily check that looks for new releases, so if you have disabled
the **Marketplace sync** job in **ACP → System → Scheduled Tasks**, announcements stop
arriving too.

If we can't be reached, your site keeps whatever it already had and carries on.

## What you see

**A dialog when you enter the ACP**, once per administrator. It has a single OK button, and
clicking it is the acknowledgement. That is recorded on your server against your account, so
the same notice will not meet you again on another machine.

**ACP → Announcements** keeps everything still current, so you can re-read something you
clicked past. Anything you have not acknowledged is marked, and you can acknowledge it from
there instead of waiting for the dialog.

Notices carry one of three urgencies. `info` is something worth knowing, `important` sits
above plugin updates in the queue, and `critical` comes before everything else, including a
licence about to expire. All three open the dialog: we would rather send fewer than have you
stop reading them.

There is no way to mute them, and that is on purpose. A channel you can turn off is a channel
we cannot rely on when it matters.

## Languages

We write announcements in English and translate them where we can. Your site shows each
administrator the text in their own language if we have it, then the site's default language,
then English. When you are reading a translation that we do not have, the page says so, so
you know it is a gap in our translations rather than a setting on your side.

## How to tell a real notice from a fake one

Every announcement is signed by us, and your site checks the signature before it renders
anything. One that does not verify is thrown away without being shown, and the same goes for
one whose text has been altered along the way or whose signature has expired. This matters
because the alternative would be a box in front of every administrator running Xentium that
says whatever the network said it should.

**We will never ask you for a password, a payment detail or a recovery code through an
announcement.** Nothing we send needs you to enter anything. If you ever see a Xentium notice
asking for any of that, it did not come from us, and we would like to hear about it.

Announcements can carry a single link. It is always shown in full, always points at
`xentium.org`, and your site never opens it for you.
