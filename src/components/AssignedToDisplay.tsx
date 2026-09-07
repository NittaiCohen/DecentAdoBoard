interface AssignedToDisplayProps {
  value?: string | null;
}

export default function AssignedToDisplay({ value }: AssignedToDisplayProps) {
  if (!value) {
    return null;
  }

  return <p className="mt-1 truncate text-[10px] text-gray-500 dark:text-gray-400">{value}</p>;
}
