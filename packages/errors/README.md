# @nodevo/errors

**Errors for the Nodevo framework.**

`NodevoError`, the NEC code registry, and the Express error middleware that
turns anything thrown during a request into one response shape:

```json
{ "error": { "code": "NEC-API-4004", "message": "Not found", "severity": "warn" } }
```

The middleware is a factory — an application injects whether it is production,
where a log line goes, and where an error record is stored:

```ts
import { createErrorMiddleware } from "@nodevo/errors";

app.use(createErrorMiddleware({
  isProd,
  logger,
  persist: (entry) => db.errorLog.create({ data: entry }),   // optional
}));
```

`persist` is optional: an application with no error-log table is a legitimate
consumer.

---

Part of the [Nodevo framework](https://github.com/slaxxer/nodevo). Nodevo is a framework with the Nodevo CMS as its first application.

MIT © Slaxxer
