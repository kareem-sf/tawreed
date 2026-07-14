import { Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconClockHour4,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import styles from "./NavigationRail.module.css";

export type AppPage = "workbench" | "runs" | "settings";

interface NavigationRailProps {
  active: AppPage;
  onNavigate: (page: AppPage) => void;
}

const navigation = [
  { page: "workbench", icon: IconLayoutGrid },
  { page: "runs", icon: IconClockHour4 },
] as const;

export function NavigationRail({ active, onNavigate }: NavigationRailProps) {
  const { t } = useTranslation();
  const compact = useMediaQuery("(max-width: 1100px)");

  return (
    <aside className={styles.rail} aria-label="Primary navigation">
      <div className={styles.brand}>
        <img className={styles.logo} src="/tawreed-logo.png" alt="" />
        <span className={styles.srOnly}>{t("brand")}</span>
      </div>

      <Stack component="nav" gap={0} className={styles.links}>
        {navigation.map(({ page, icon: Icon }) => (
          <Tooltip
            key={page}
            label={t(`nav.${page}`)}
            position="right"
            openDelay={450}
            disabled={!compact}
          >
            <UnstyledButton
              className={styles.link}
              data-active={active === page || undefined}
              aria-current={active === page ? "page" : undefined}
              aria-label={t(`nav.${page}`)}
              onClick={() => onNavigate(page)}
            >
              <Icon size={24} stroke={1.55} aria-hidden="true" />
              <Text component="span" size="sm">
                {t(`nav.${page}`)}
              </Text>
            </UnstyledButton>
          </Tooltip>
        ))}
      </Stack>

      <div className={styles.footer}>
        <Tooltip
          label={t("nav.settings")}
          position="right"
          openDelay={450}
          disabled={!compact}
        >
          <UnstyledButton
            className={styles.link}
            data-active={active === "settings" || undefined}
            aria-current={active === "settings" ? "page" : undefined}
            aria-label={t("nav.settings")}
            onClick={() => onNavigate("settings")}
          >
            <IconSettings size={25} stroke={1.55} aria-hidden="true" />
            <Text component="span" size="sm">
              {t("nav.settings")}
            </Text>
          </UnstyledButton>
        </Tooltip>
      </div>
    </aside>
  );
}
