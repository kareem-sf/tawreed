import { loadFaces } from "./fonts";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SettingsProvider } from "./app/settings";
import { ApiError } from "./api/client";

// The service's own answers (4xx) won't change by asking again; only a dropped connection or a 5xx is worth a retry.
const queries = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// Arabic fonts first, so the first paint is already in them; a missing or slow font never holds the app back.
void loadFaces().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queries}>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
