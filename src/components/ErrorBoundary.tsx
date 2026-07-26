// Last-resort crash UI: a render-time throw must never leave a blank frameless window.
// Text is hardcoded bilingually so the fallback renders even if the i18n layer is what broke.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Text } from '@mantine/core';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Tawreed UI crash', error, info.componentStack);
  }

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="app-frame relative">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <Text fw={650}>Something went wrong · حدث خطأ غير متوقع</Text>
          <Text size="xs" c="red" ta="center" maw={420} role="alert" className="allow-select">
            {this.state.message}
          </Text>
          <Button size="xs" onClick={() => window.location.reload()}>
            Reload · إعادة التحميل
          </Button>
        </div>
      </div>
    );
  }
}
