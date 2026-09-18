// Last-resort crash UI: a render-time throw must never leave a blank frameless window.
// Text is hardcoded bilingually so the fallback renders even if the i18n layer is what broke.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { appLog } from '../bridge';
import { Button } from './ui/button';

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
          <p className="font-semibold text-foreground">Something went wrong · حدث خطأ غير متوقع</p>
          <p role="alert" className="allow-select mx-auto max-w-[420px] text-center text-xs text-destructive">
            {this.state.message}
          </p>
          <div className="flex items-center gap-2.5">
            <Button size="sm" variant="default" onClick={() => window.location.reload()}>
              Reload · إعادة التحميل
            </Button>
            <Button size="sm" variant="ghost" onClick={this.copyDetails}>
              Copy error details · نسخ تفاصيل الخطأ
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
