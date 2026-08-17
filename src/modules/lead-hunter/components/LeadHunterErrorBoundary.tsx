import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class LeadHunterErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lead Hunter isolated error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-ink-950">
        <div className="w-16 h-16 rounded-2xl bg-warning-500/15 flex items-center justify-center">
          <AlertTriangle className="text-warning-400" size={30} />
        </div>
        <h1 className="text-ink-100 font-semibold">تعذر تحميل مركز العملاء</h1>
        <p className="text-ink-500 text-sm max-w-sm">حدث خطأ داخل هذه الوحدة فقط. وظائف SocialPilot الأخرى لم تتأثر.</p>
        <Button variant="secondary" onClick={() => this.setState({ hasError: false })}>إعادة المحاولة</Button>
      </div>
    );
  }
}
