import { expect, test } from "vitest";
import { figure } from "./format";

test("a figure shows as the source wrote it, except Excel's float noise, which shows to the cent", () => {
  expect(figure("38700")).toEqual({ shown: "38700" });
  expect(figure("1,250.00")).toEqual({ shown: "1,250.00" });
  expect(figure("1240.5")).toEqual({ shown: "1240.5" });
  expect(figure("0.125")).toEqual({ shown: "0.125" }); // real decimals stay
  expect(figure("267012.13961836405")).toEqual({ shown: "267012.14", exact: "267012.13961836405" });
  expect(figure("296407.79000000004")).toEqual({ shown: "296407.79", exact: "296407.79000000004" });
  expect(figure("m3")).toEqual({ shown: "m3" });
});
