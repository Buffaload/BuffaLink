import React from "react";
import ReactDOM from "react-dom/client"; // This is the new import for React 18
import "./css/index.css";
import App from "./App";

// Get the root element from the HTML
const rootElement = document.getElementById("root");

// Create a root and render the App component using the new API
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
