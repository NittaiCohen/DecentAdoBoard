import { getAncestors } from "./collections";

interface TestNode {
  id: number;
  parentId: number | null;
}

function getParentNode(nodes: Map<number, TestNode>) {
  return (node: TestNode): TestNode | undefined =>
    node.parentId === null ? undefined : nodes.get(node.parentId);
}

describe("getAncestors", () => {
  it("returns ancestors from the direct parent to the root", () => {
    const grandparent: TestNode = { id: 1, parentId: null };
    const parent: TestNode = { id: 2, parentId: grandparent.id };
    const child: TestNode = { id: 3, parentId: parent.id };
    const nodes = new Map([grandparent, parent, child].map((node) => [node.id, node]));

    expect(getAncestors(child, getParentNode(nodes))).toEqual([parent, grandparent]);
  });

  it("returns an empty array for a root item", () => {
    const root: TestNode = { id: 1, parentId: null };

    expect(getAncestors(root, () => undefined)).toEqual([]);
  });

  it("stops when the parent node is null or undefined", () => {
    const node: TestNode = { id: 1, parentId: 2 };

    expect(getAncestors(node, () => null)).toEqual([]);
    expect(getAncestors(node, () => undefined)).toEqual([]);
  });

  it("returns an empty array for a null or undefined initial node", () => {
    expect(getAncestors<TestNode>(null, () => undefined)).toEqual([]);
    expect(getAncestors<TestNode>(undefined, () => undefined)).toEqual([]);
  });

  it("stops when it encounters a cycle", () => {
    const first: TestNode = { id: 1, parentId: 2 };
    const second: TestNode = { id: 2, parentId: 1 };
    const nodes = new Map([first, second].map((node) => [node.id, node]));

    expect(getAncestors(first, getParentNode(nodes))).toEqual([second, first]);
  });
});
