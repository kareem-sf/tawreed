import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./app/i18n";
import "./global.css";

import { TawreedRoot } from "./TawreedRoot";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TawreedRoot />
  </StrictMode>,
);
