# @xentium/errors

**Errors for the Xentium framework.**

`XentiumError`, the XEC code registry, and the Express error middleware that
turns anything thrown during a request into one response shape:

```json
{ "error": { "code": "XEC-API-4004", "message": "Not found", "severity": "warn" } }
```

The middleware is a factory — an application injects whether it is production,
where a log line goes, and where an error record is stored:

```ts
import { createErrorMiddleware } from "@xentium/errors";

app.use(createErrorMiddleware({
  isProd,
  logger,
  persist: (entry) => db.errorLog.create({ data: entry }),   // optional
}));
```

`persist` is optional: an application with no error-log table is a legitimate
consumer.

---

Part of the [Xentium framework](https://github.com/slaxxer/xentium). Xentium is a framework with the Xentium CMS as its first application.

MIT © Slaxxer
