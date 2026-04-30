import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodeTypes = {};

export default function GraphView() {
  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={[]}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
