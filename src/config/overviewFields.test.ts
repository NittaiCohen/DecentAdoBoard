import { describe, expect, it } from "vitest";
import {
  getDefaultOverviewFieldSelection,
  getOverviewFieldsForWorkItemType,
} from "./overviewFields";

describe("getDefaultOverviewFieldSelection", () => {
  it("keeps only useful standard overview fields", () => {
    const references = [
      { referenceName: "System.Title", name: "Title" },
      { referenceName: "System.State", name: "State" },
      { referenceName: "System.Id", name: "ID" },
      { referenceName: "System.ChangedDate", name: "Changed Date" },
      { referenceName: "System.Description", name: "Description" },
      { referenceName: "Custom.BusinessValue", name: "Business Value" },
    ];

    expect(getDefaultOverviewFieldSelection(references)).toEqual(["System.Description"]);
  });

  it("excludes noisy fields from the default allowlist", () => {
    expect(
      getDefaultOverviewFieldSelection([
        { referenceName: "System.IterationLevel1", name: "Iteration level 1" },
        { referenceName: "System.AreaLevel1", name: "Area level 1" },
        { referenceName: "Custom.RevisedDate", name: "Revised date" },
        { referenceName: "Custom.Resolution", name: "Resolution" },
        { referenceName: "Custom.IsException", name: "Is Exception" },
        { referenceName: "Custom.OriginalRisk", name: "Original risk rating" },
        { referenceName: "Custom.AdjustedRisk", name: "Adjusted risk rating" },
        { referenceName: "System.CommentCount", name: "Comment Count" },
        { referenceName: "Custom.BusinessValue", name: "Business Value" },
        { referenceName: "System.Title", name: "Title" },
      ]),
    ).toEqual([]);
  });

  it("keeps the approved field names and excludes custom fields by default", () => {
    const allowedNames = [
      "Acceptance Criteria",
      "Activity",
      "Area Path",
      "Assigned To",
      "Completed Work",
      "Description",
      "Effort",
      "History",
      "Iteration Path",
      "Original Estimate",
      "Priority",
      "Remaining Work",
      "Repro Steps",
      "Severity",
      "Stack Rank",
      "State",
      "Story Points",
      "System Info",
      "Tags",
      "Title",
    ];
    const hiddenNames = [
      "Parent",
      "Remote Link Count",
      "Work Item Type",
      "Board Lane",
      "Closed Date",
      "Closed By",
      "Activated Date",
      "Activated By",
      "Backlog Priority",
      "Business Value",
      "Value Area",
      "Integration Build",
      "Resolved By",
      "Resolved Date",
      "Target Date",
      "Start Date",
      "Finish Date",
      "Due Date",
      "Triage",
      "Security Rating",
      "Exception Owner",
      "Exception Approved",
      "Exception Approver",
      "Risk Area",
      "Impact Assessment HTML",
      "Actual Attendee 2",
      "Status",
      "Release Vehicle",
      "Service Name",
      "External Reference ID",
      "Custom Field 1",
      "IcM Incident Count",
      "IcM Incident IDs",
      "IcM Repair Item Type",
      "IcM Delivery Type",
      "IcM Incident Severity",
      "Partner Universal ID",
    ];

    expect(
      getDefaultOverviewFieldSelection([
        ...allowedNames.map((name, index) => ({
          referenceName: `Custom.Allowed${index}`,
          name,
        })),
        ...hiddenNames.map((name, index) => ({
          referenceName: `Custom.Hidden${index}`,
          name,
        })),
      ]),
    ).toEqual(
      allowedNames.flatMap((name, index) =>
        ["Assigned To", "State", "Tags", "Title"].includes(name) ? [] : [`Custom.Allowed${index}`],
      ),
    );
  });
});

describe("getOverviewFieldsForWorkItemType", () => {
  it("excludes Description from Bug overviews", () => {
    const fields = [
      { referenceName: "System.Description", name: "Description" },
      { referenceName: "Microsoft.VSTS.TCM.ReproSteps", name: "Repro Steps" },
    ];

    expect(getOverviewFieldsForWorkItemType(fields, "Bug")).toEqual([
      { referenceName: "Microsoft.VSTS.TCM.ReproSteps", name: "Repro Steps" },
    ]);
  });

  it("keeps Description for other work item types", () => {
    const fields = [{ referenceName: "System.Description", name: "Description" }];

    expect(getOverviewFieldsForWorkItemType(fields, "Task")).toEqual(fields);
  });
});
