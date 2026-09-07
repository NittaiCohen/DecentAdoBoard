const DEFAULT_OVERVIEW_FIELD_REFERENCES = new Set([
  "Microsoft.VSTS.Common.AcceptanceCriteria",
  "Microsoft.VSTS.Common.Activity",
  "Microsoft.VSTS.Common.CompletedWork",
  "Microsoft.VSTS.Common.Effort",
  "Microsoft.VSTS.Common.OriginalEstimate",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Common.RemainingWork",
  "Microsoft.VSTS.Common.Severity",
  "Microsoft.VSTS.Common.StackRank",
  "Microsoft.VSTS.Common.StoryPoints",
  "Microsoft.VSTS.TCM.ReproSteps",
  "System.AreaPath",
  "System.Description",
  "System.History",
  "System.IterationPath",
]);

const DEFAULT_OVERVIEW_FIELD_NAMES = new Set([
  "acceptance criteria",
  "activity",
  "area path",
  "completed work",
  "description",
  "effort",
  "history",
  "iteration path",
  "original estimate",
  "priority",
  "remaining work",
  "repro steps",
  "severity",
  "stack rank",
  "story points",
]);

export const ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES = new Set([
  "System.AssignedTo",
  "System.State",
  "System.Tags",
  "System.Title",
]);

interface OverviewFieldReference {
  referenceName: string;
  name: string;
}

function isDefaultVisibleField(field: OverviewFieldReference): boolean {
  if (DEFAULT_OVERVIEW_FIELD_REFERENCES.has(field.referenceName)) {
    return true;
  }

  return DEFAULT_OVERVIEW_FIELD_NAMES.has(field.name.trim().toLowerCase());
}

export function getDefaultOverviewFieldSelection(fields: OverviewFieldReference[]): string[] {
  return fields.filter(isDefaultVisibleField).map((field) => field.referenceName);
}
