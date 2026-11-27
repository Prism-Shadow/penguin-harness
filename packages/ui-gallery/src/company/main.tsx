import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, TooltipLayer } from "@prismshadow/penguin-ui";
import "./company.css";
import { CompanyApp } from "./app";

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <CompanyApp />
    <Toaster />
    <TooltipLayer />
  </StrictMode>,
);
