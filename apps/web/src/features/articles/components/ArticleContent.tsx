import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

interface Props {
  body: unknown; // TipTap JSON
}

/** Read-only renderer for stored TipTap JSON. Uses the editor in non-editable mode
 *  so the same extension set produces consistent output as the editor itself. */
export function ArticleContent({ body }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (body && typeof body === "object") ? (body as never) : { type: "doc", content: [] },
    editable: false,
    editorProps: { attributes: { class: "article-editor__content prose" } },
  });

  useEffect(() => {
    if (!editor || !body) return;
    editor.commands.setContent(body as never, { emitUpdate: false });
  }, [editor, body]);

  return <EditorContent editor={editor} />;
}
