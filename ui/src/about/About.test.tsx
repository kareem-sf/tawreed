import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

for (const language of ["en", "ar"] as const) {
  test(`About shows the selected proprietary notice and no MIT text in ${language}`, async () => {
    fakeService({
      "GET /settings": () => ({ language, theme: "light", ai: null }),
      "GET /about": () => ({ version: "0.1.0", data_folder: "/synthetic/.tawreed" }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: language === "en" ? "About" : "حول توريد" }));
    expect(await screen.findByText(language === "en" ? "© 2026 QS Mind. All rights reserved." : "© 2026 كيو إس مايند. جميع الحقوق محفوظة.")).toBeInTheDocument();
    expect(screen.queryByText(/MIT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/open source|مفتوح المصدر/i)).not.toBeInTheDocument();
  });
}

for (const language of ["en", "ar"] as const) {
  test(`the limits of use show under the drop zone and in About in ${language}`, async () => {
    fakeService({
      "GET /settings": () => ({ language, theme: "light", ai: null }),
      "GET /about": () => ({ version: "0.1.0", data_folder: "/synthetic/.tawreed" }),
    });
    renderApp();
    const user = userEvent.setup();
    const summary =
      language === "en"
        ? /^Tawreed helps you sort BOQ items .* It does not design, calculate loads or approve anything\. Everything it produces is for review; checking and approval rest with the engineer and the firm\.$/
        : /^يساعدك توريد في توزيع بنود .* لا يصمّم ولا يحسب أحمالاً ولا يعتمد أي شيء\. كل ما يخرج منه للمراجعة، والتحقق والاعتماد مسؤولية المهندس والشركة\.$/;
    expect(await screen.findByText(summary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: language === "en" ? "About" : "حول توريد" }));
    expect(await screen.findByText(language === "en" ? "Limits of use" : "حدود الاستخدام")).toBeInTheDocument();
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.getByText(language === "en" ? /not market prices\.$/ : /لا أسعار السوق\.$/)).toBeInTheDocument();
  });
}
