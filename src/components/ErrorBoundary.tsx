// Last-resort crash UI: a render-time throw must never leave a blank frameless window.
// Text is hardcoded bilingually so the fallback renders even if the i18n layer is what broke.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { appLog } from '../bridge';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
  stack: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null, stack: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Tawreed UI crash', error, info.componentStack);
    const message = error instanceof Error ? error.message : String(error);
    void appLog(`UI crash: ${message} | ${info.componentStack ?? ''}`).catch(() => undefined);
  }

  private copyDetails = () => {
    const details = [this.state.message, this.state.stack].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(details).catch(() => undefined);
  };

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="app-frame relative">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <Text className="font-serif-display" fw={650}>Something went wrong · حدث خطأ غير متوقع</Text>
          <Text size="xs" c="var(--danger)" ta="center" maw={420} role="alert" className="allow-select">
            {this.state.message}
          </Text>
          <Group gap="xs">
            <Button size="xs" color="gold" onClick={() => window.location.reload()}>
              Reload · إعادة التحميل
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={this.copyDetails}>
              Copy error details · نسخ تفاصيل الخطأ
            </Button>
          </Group>
        </div>
      </div>
    );
  }
}
