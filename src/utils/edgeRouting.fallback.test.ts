import type { Edge } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { NodePosition } from "./graphLayout";

vi.mock("./pathfinding", () => ({
  routeAllEdges: (edges: Edge[]) => edges.map((edge) => ({ edge, path: [] })),
}));

import { assignLaneOffsets } from "./edgeRouting";

describe("assignLaneOffsets fallback", () => {
  it("uses a visible simple path when A* cannot route a forward edge", () => {
    const edges: Edge[] = [{ id: "dependency", source: "source", target: "target" }];
    const positions = new Map<string, NodePosition>([
      ["source", { x: 0, y: 20, width: 200, height: 80 }],
      ["target", { x: 400, y: 120, width: 200, height: 80 }],
    ]);

    const result = assignLaneOffsets(edges, positions);

    expect(result[0]?.data?.path).toContain("M");
    expect(result[0]?.data?.path).not.toBe("");
  });
});
