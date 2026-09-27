# Last codebase update

Composer click fix.

- `apps/web/src/components/composer/Composer.tsx`: a press on the body's empty area puts the caret at
  the end of the text. With `minHeight` the editable element stayed one line tall, so clicks in the rest
  of the box focused nothing. `EditorContent` gets `className="nvc-editor"` so a press on its wrapper
  counts too.
- `CHANGELOG.md`: Fixed entry for the above.
