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

**A dialog when you enter the ACP.** It has a single OK button. The first administrator to
click it has read it for the whole site: the notice is deleted from your server and does not
appear for anyone else. Your site keeps no copy, no history and no record of who read what,
and there is no page to find it on again. The only thing left behind is the notice's id, so
that the next daily check does not bring it straight back, and that goes too once we stop
serving the notice.

If several are waiting, you see one at a time, the most urgent first. Notices carry one of
three urgencies: `info` is something worth knowing, `important` and `critical` are marked as
such in the dialog. All three open the dialog, and an announcement comes before a licence or
update dialog: we would rather send fewer than have you stop reading them.

There is no way to mute them, and that is on purpose. A channel you can turn off is a channel
we cannot rely on when it matters.

## Languages

We write announcements in English and translate them where we can. Your site shows each
administrator the text in their own language if we have it, then the site's default language,
then English.

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
