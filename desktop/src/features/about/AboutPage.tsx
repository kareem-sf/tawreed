import { Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import styles from "./AboutPage.module.css";

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <article className={styles.about} aria-labelledby="about-title">
      <Title id="about-title" order={2} className={styles.title}>
        {t("about.title")}
      </Title>
      <Text className={styles.description}>{t("about.description")}</Text>

      <section className={styles.section}>
        <Title order={3}>{t("about.privacyTitle")}</Title>
        <Text>{t("about.privacy")}</Text>
      </section>

      <dl className={styles.details}>
        <div>
          <dt>{t("about.stackTitle")}</dt>
          <dd>{t("about.stack")}</dd>
        </div>
        <div>
          <dt>{t("about.version")}</dt>
          <dd>0.1.0</dd>
        </div>
      </dl>
    </article>
  );
}
