import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

for (const language of ["en", "ar"] as const) {
  test(`About shows the selected proprietary notice and retains font notices in ${language}`, async () => {
    fakeService({
      "GET /settings": () => ({ language, theme: "light", ai: null }),
      "GET /about": () => ({ version: "0.1.0", data_folder: "/synthetic/.tawreed" }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: language === "en" ? "About" : "حول توريد" }));
    expect(await screen.findByText(language === "en" ? "© 2026 QS Mind. All rights reserved." : "© 2026 كيو إس مايند. جميع الحقوق محفوظة.")).toBeInTheDocument();
    expect(screen.queryByText(/MIT/)).not.toBeInTheDocument();
    expect(screen.getByText(/Figtree/)).toBeInTheDocument();
    expect(screen.getByText(language === "en" ? /Thmanyah Sans/ : /خط ثمانية/)).toBeInTheDocument();
  });
}
