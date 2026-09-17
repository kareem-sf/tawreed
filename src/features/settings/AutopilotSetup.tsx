import { useEffect, useState } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAutopilotTrust, setAutopilotTrust, type AutopilotGrant } from '../../bridge';

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Per-project auto-pilot grants: enable here is read-only, revoke is the action.
 * Grants are created from history rows (where the project name is known). */
export function AutopilotSetup() {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<AutopilotGrant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAutopilotTrust()
      .then((loaded) => { if (!cancelled) setGrants(loaded); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, []);

  const revoke = async (projectKey: string) => {
    const previous = grants;
    const next = previous.filter((grant) => grant.projectKey !== projectKey);
    setGrants(next);
    setError(null);
    try {
      await setAutopilotTrust(next);
    } catch (reason) {
      setGrants(previous);
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="space-y-2">
      <Text size="xs" c="dimmed">{t('autopilotDetail')}</Text>
      {grants.length === 0 && (
        <Text size="xs" c="dimmed">{t('autopilotEmpty')}</Text>
      )}
      {grants.map((grant) => (
        <Group key={grant.projectKey} justify="space-between" gap="xs">
          <Text size="xs" fw={500} truncate maw={220}>{grant.projectName}</Text>
          <Tooltip label={t('autopilotRevoke')} openDelay={220}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => void revoke(grant.projectKey)}
              aria-label={`${t('autopilotRevoke')}: ${grant.projectName}`}
            >
              <X size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}
      {error && (
        <Text size="xs" c="red" role="alert">{error}</Text>
      )}
    </div>
  );
}
