import { useState } from "react";
import GraphView from "./components/GraphView";
import ActionableSidebar from "./components/ActionableSidebar";
import "./App.css";

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-gray-100">
      {/* Main graph area */}
      <div className="flex-1 relative">
        <GraphView />
      </div>

      {/* Actionable sidebar */}
      <ActionableSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
    </div>
  );
}

export default App;
