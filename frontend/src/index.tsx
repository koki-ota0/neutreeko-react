import React from "react";
import ReactDOM from "react-dom/client";
import "react-flow-renderer/dist/style.css";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

reportWebVitals();
