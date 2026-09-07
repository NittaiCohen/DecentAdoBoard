import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import { TextStyleKit } from "@tiptap/extension-text-style";
import UnderlineExtension from "@tiptap/extension-underline";
import {
  Bold,
  ChevronDown,
  Code,
  CodeXml,
  Highlighter,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListIndentDecrease,
  ListIndentIncrease,
  Palette,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";

interface RichTextFieldEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
}

const editorExtensions = [
  StarterKit,
  UnderlineExtension,
  Highlight.configure({ multicolor: true }),
  ImageExtension,
  LinkExtension.configure({ autolink: true, openOnClick: false }),
  TextStyleKit,
];
const TOOLBAR_ICON_SIZE = 16;
const HEADING_LEVEL_ONE = 1;
const HEADING_LEVEL_TWO = 2;
const HEADING_LEVEL_THREE = 3;
const HEADING_LEVELS = [HEADING_LEVEL_ONE, HEADING_LEVEL_TWO, HEADING_LEVEL_THREE] as const;

function sanitizeHtml(value: string): string {
  return DOMPurify.sanitize(value);
}

function hasRichTextContent(value: string): boolean {
  const sanitizedValue = sanitizeHtml(value);
  const textContent = sanitizedValue
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .trim();

  return textContent.length > 0 || /<(img|hr|table)\b/i.test(sanitizedValue);
}

function ToolbarButton({
  label,
  icon,
  onClick,
  active = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded border p-0 text-xs ${
        active
          ? "border-blue-500 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      }`}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}

function RichTextToolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const url = window.prompt("Link URL", "");
    if (url === null) {
      return;
    }

    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().setLink({ href: url.trim() }).run();
  }

  function insertImage() {
    const url = window.prompt("Image URL");
    if (url?.trim()) {
      editor.chain().focus().setImage({ src: url.trim() }).run();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
      <ToolbarButton
        label="Bold"
        icon={<Bold size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        icon={<Italic size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Underline"
        icon={<UnderlineIcon size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolbarButton
        label="Strikethrough"
        icon={<Strikethrough size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        label="Bulleted list"
        icon={<List size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Numbered list"
        icon={<ListOrdered size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Outdent"
        icon={<ListIndentDecrease size={TOOLBAR_ICON_SIZE} />}
        onClick={() => editor.chain().focus().liftListItem("listItem").run()}
      />
      <ToolbarButton
        label="Indent"
        icon={<ListIndentIncrease size={TOOLBAR_ICON_SIZE} />}
        onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
      />
      <ToolbarButton
        label="Highlight"
        icon={<Highlighter size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("highlight")}
        onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()}
      />
      <label
        title="Text color"
        className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <Palette size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
        <input
          type="color"
          aria-label="Text color"
          onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <label
        title="Heading"
        className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <Heading size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
        <select
          aria-label="Heading"
          value={
            HEADING_LEVELS.find((level) => editor.isActive("heading", { level }))?.toString() ?? ""
          }
          onChange={(event) => {
            if (event.target.value === "") {
              editor.chain().focus().setParagraph().run();
            } else {
              const headingLevel = HEADING_LEVELS.find(
                (level) => level.toString() === event.target.value,
              );
              if (headingLevel !== undefined) {
                editor.chain().focus().setHeading({ level: headingLevel }).run();
              }
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        >
          <option value="">{"Paragraph"}</option>
          {HEADING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {`Heading ${level}`}
            </option>
          ))}
        </select>
      </label>
      <ToolbarButton
        label="Inline code"
        icon={<Code size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToolbarButton
        label="Code block"
        icon={<CodeXml size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <ToolbarButton
        label="Link"
        icon={<LinkIcon size={TOOLBAR_ICON_SIZE} />}
        active={editor.isActive("link")}
        onClick={setLink}
      />
      <ToolbarButton
        label="Image"
        icon={<ImageIcon size={TOOLBAR_ICON_SIZE} />}
        onClick={insertImage}
      />
    </div>
  );
}

export default function RichTextFieldEditor({
  label,
  value,
  onChange,
  editable = true,
}: RichTextFieldEditorProps) {
  const [isSelected, setIsSelected] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => !hasRichTextContent(value));
  const containerRef = useRef<HTMLDivElement>(null);
  const sanitizedValue = useMemo(() => sanitizeHtml(value), [value]);
  const editor = useEditor({
    extensions: editorExtensions,
    content: sanitizedValue,
    editable,
    onUpdate: ({ editor: updatedEditor }) => {
      onChange(sanitizeHtml(updatedEditor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(editable);
    if (!editor.isFocused && editor.getHTML() !== sanitizedValue) {
      editor.commands.setContent(sanitizedValue, { emitUpdate: false });
    }
  }, [editor, editable, sanitizedValue]);

  if (!editor) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded border border-gray-300 dark:border-gray-600">
      <button
        type="button"
        onClick={() => {
          setIsCollapsed((current) => !current);
          setIsSelected(false);
        }}
        className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-expanded={!isCollapsed}
      >
        <ChevronDown
          size={TOOLBAR_ICON_SIZE}
          className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
          aria-hidden="true"
        />
        {label}
      </button>
      {!isCollapsed && (
        <div
          ref={containerRef}
          onFocusCapture={() => setIsSelected(true)}
          onBlurCapture={(event) => {
            const relatedTarget = event.relatedTarget;
            if (
              !(relatedTarget instanceof Node) ||
              !containerRef.current?.contains(relatedTarget)
            ) {
              setIsSelected(false);
            }
          }}
        >
          <EditorContent
            editor={editor}
            className="min-h-40 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:bg-gray-900 dark:text-gray-100 [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none [&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_p]:mb-2 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:bg-gray-100 [&_.ProseMirror_pre]:p-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6"
          />
          {editable && isSelected && <RichTextToolbar editor={editor} />}
        </div>
      )}
    </div>
  );
}
