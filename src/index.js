import React from "react";
import ReactDOM from "react-dom/client";
import "./css/index.css";
import App from "./App";

// Import React Query essentials
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

// Create a new QueryClient instance for React Query
const queryClient = new QueryClient();

// Get the root element from the HTML
const rootElement = document.getElementById("root");

// Create a root and render the App component using the new API
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* Provide the QueryClient instance to the whole app */}
    <QueryClientProvider client={queryClient}>
      <App />

      {/* Add React Query Devtools for debugging (optional, in development) */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);
