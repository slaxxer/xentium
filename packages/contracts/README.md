# @nodevo/contracts

**Shared contracts for the Nodevo framework.**

Types, constants and the NEC error-code registry shared by every
Nodevo-framework application and by the browser.

Deliberately dependency-light and runtime-free where possible: the frontend
imports the same NEC codes the server emits, which is what lets the API stay
locale-agnostic — a client branches on the code and localizes the message
itself.

---

Part of the [Nodevo framework](https://github.com/slaxxer/nodevo). Nodevo is a framework with the Nodevo CMS as its first application.

MIT © Slaxxer
