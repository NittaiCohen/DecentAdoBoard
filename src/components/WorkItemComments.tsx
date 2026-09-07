import DOMPurify from "dompurify";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addWorkItemComment } from "../api/tauri";
import RichTextFieldEditor from "./RichTextFieldEditor";
import type { WorkItemComment } from "../types";

function formatCommentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function hasCommentContent(value: string): boolean {
  const sanitizedValue = DOMPurify.sanitize(value);
  return sanitizedValue.replace(/<[^>]*>/g, "").trim().length > 0;
}

function formatCommentError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error) ?? "Unknown error";
}

function CommentContent({ comment }: { comment: WorkItemComment }) {
  if (comment.renderedText) {
    return (
      <div
        className="max-w-none text-sm leading-relaxed [&_li]:leading-relaxed [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
        /* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml */
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.renderedText) }}
      />
    );
  }

  return <p className="whitespace-pre-wrap text-sm">{comment.text}</p>;
}

interface WorkItemCommentsProps {
  workItemId: number;
  comments: WorkItemComment[];
  commentsError: unknown;
  commentsLoading: boolean;
}

export default function WorkItemComments({
  workItemId,
  comments,
  commentsError,
  commentsLoading,
}: WorkItemCommentsProps) {
  const queryClient = useQueryClient();
  const [draftComment, setDraftComment] = useState("");
  const addCommentMutation = useMutation({
    mutationFn: () => addWorkItemComment(workItemId, DOMPurify.sanitize(draftComment)),
    onSuccess: async () => {
      setDraftComment("");
      await queryClient.invalidateQueries({ queryKey: ["workItemComments", workItemId] });
    },
  });

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{"Comments"}</h2>
      <div className="space-y-2">
        <RichTextFieldEditor
          label="Add a comment"
          value={draftComment}
          onChange={setDraftComment}
          initiallyExpanded
        />
        <button
          type="button"
          onClick={() => addCommentMutation.mutate()}
          disabled={!hasCommentContent(draftComment) || addCommentMutation.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {addCommentMutation.isPending ? "Posting..." : "Post comment"}
        </button>
        {!!addCommentMutation.error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
            {formatCommentError(addCommentMutation.error)}
          </p>
        )}
      </div>
      {commentsLoading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{"Loading comments..."}</p>
      )}
      {!!commentsError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
          {formatCommentError(commentsError)}
        </p>
      )}
      {!commentsLoading && !commentsError && comments.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{"No comments yet."}</p>
      )}
      {!commentsError && comments.length > 0 && (
        <div className="space-y-3">
          {comments.map((comment) => (
            <article
              key={comment.id}
              className="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {comment.createdBy}
                </span>
                <time dateTime={comment.createdDate}>{formatCommentDate(comment.createdDate)}</time>
              </div>
              <CommentContent comment={comment} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
