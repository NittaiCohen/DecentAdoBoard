import { useMemo } from "react";
import { useBoardWorkItemTypes, useWorkItemTypeIcon } from "../hooks/useAdoData";

interface WorkItemTypeIconProps {
  workItemType: string;
  className?: string;
}

export default function WorkItemTypeIcon({
  workItemType,
  className = "h-4 w-4",
}: WorkItemTypeIconProps) {
  const { data: workItemTypes = [] } = useBoardWorkItemTypes(true);
  const typeMetadata = useMemo(
    () => workItemTypes.find((type) => type.name === workItemType),
    [workItemTypes, workItemType],
  );
  const { data: iconDataUrl } = useWorkItemTypeIcon(typeMetadata?.iconId, typeMetadata?.color);

  if (!iconDataUrl) {
    return null;
  }

  return <img src={iconDataUrl} alt="" aria-hidden="true" className={className} />;
}
