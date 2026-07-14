import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import styles from "./WorkflowRoute.module.css";

export type WorkflowStage = "workbook" | "process" | "review" | "export";

interface WorkflowRouteProps {
  stage: WorkflowStage;
  complete?: boolean;
}

const stages: WorkflowStage[] = ["workbook", "process", "review", "export"];

export function WorkflowRoute({ stage, complete = false }: WorkflowRouteProps) {
  const { t } = useTranslation();
  const activeIndex = stages.indexOf(stage);

  return (
    <ol className={styles.route} aria-label={t("workflowRoute.label")}>
      {stages.map((item, index) => {
        const state =
          complete || index < activeIndex
            ? "complete"
            : index === activeIndex
              ? "active"
              : "pending";

        return (
          <li
            key={item}
            className={styles.step}
            data-state={state}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className={styles.marker} aria-hidden="true">
              {state === "complete" ? (
                <IconCheck size={17} stroke={2.2} />
              ) : (
                index + 1
              )}
            </span>
            <span className={styles.label}>{t(`workflowRoute.${item}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
