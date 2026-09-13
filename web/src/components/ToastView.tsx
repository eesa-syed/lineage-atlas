import { useEffect } from 'react';
import { useAtlas } from '../state/store';

export function ToastView() {
  const toast = useAtlas((s) => s.toast);
  const dismiss = useAtlas((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.tone === 'error' ? 3600 : 2400);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className={`toast${toast.tone === 'error' ? ' bad' : ''}`} role="status">
      {toast.message}
    </div>
  );
}
