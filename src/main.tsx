import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

const STALE_TIME_MS = 300_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      retry: 1,
    },
  },
});

// Clear stale query cache on hot module reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    queryClient.clear();
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
