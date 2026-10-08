import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect } from "react";
import { RICH_EXTENSIONS } from "./ArticleEditor";

interface Props {
  body: unknown; // TipTap JSON
}

/** Read-only renderer for stored TipTap JSON. Uses the same extension set as the
 *  editor (RICH_EXTENSIONS) so every stored mark renders consistently. */
export function ArticleContent({ body }: Props) {
  const editor = useEditor({
    extensions: RICH_EXTENSIONS,
    content: (body && typeof body === "object") ? (body as never) : { type: "doc", content: [] },
    editable: false,
    editorProps: { attributes: { class: "article-editor__content prose xt-rich" } },
  });

  useEffect(() => {
    if (!editor || !body) return;
    editor.commands.setContent(body as never, { emitUpdate: false });
  }, [editor, body]);

  return <EditorContent editor={editor} />;
}
