import type { ReactNode } from "react";

interface WorkItemTitleButtonProps {
  title: string;
  onOpen: () => void;
  className?: string;
  children?: ReactNode;
}

export default function WorkItemTitleButton({
  title,
  onOpen,
  className,
  children = title,
}: WorkItemTitleButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={className}
      title={title}
    >
      {children}
    </button>
  );
}
