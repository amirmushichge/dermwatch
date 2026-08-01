import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "../app/globals.css";
import Home from "../app/page";

const root = document.getElementById("root");
if (!root) throw new Error("DermWatch root element is missing");

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
