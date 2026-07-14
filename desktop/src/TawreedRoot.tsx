import { useState } from "react";
import { DirectionProvider, MantineProvider } from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";

import App from "./App";
import { tawreedTheme } from "./app/theme";

type RootColorScheme = "auto" | "dark" | "light";

export function TawreedRoot() {
  const [colorScheme, setColorScheme] = useState<RootColorScheme>("dark");
  const systemColorScheme = useColorScheme("dark");

  return (
    <DirectionProvider initialDirection="ltr">
      <MantineProvider
        theme={tawreedTheme}
        defaultColorScheme="dark"
        forceColorScheme={
          colorScheme === "auto" ? systemColorScheme : colorScheme
        }
      >
        <Notifications position="top-right" />
        <App onColorSchemeChange={setColorScheme} />
      </MantineProvider>
    </DirectionProvider>
  );
}
