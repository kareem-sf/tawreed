import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Logo } from "./Logo";

test("the mark is as tall as its size, and wider, like the letter", () => {
  render(<Logo size={22} />);
  const logo = screen.getByTestId("logo");
  expect(logo).toHaveAttribute("height", "22");
  expect(Number(logo.getAttribute("width"))).toBeCloseTo(27.53, 1);
});

test("in the brand tone the bowl is gold and the dots ivory", () => {
  render(<Logo tone="brand" />);
  const [bowl, dots] = screen.getByTestId("logo").querySelectorAll("path");
  expect(bowl).toHaveAttribute("fill", "#E9AD38");
  expect(dots).toHaveAttribute("fill", "#F3EFE6");
});
