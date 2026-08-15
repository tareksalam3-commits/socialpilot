import { MessageSquare, Inbox as InboxIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function InboxScreen() {
  return (
    <div className="px-5 py-6 safe-top">
      <div className="flex items-center gap-2 mb-6">
        <InboxIcon size={22} className="text-ink-300" />
        <h1 className="text-lg font-bold text-ink-50">الرسائل</h1>
      </div>
      <EmptyState
        icon={<MessageSquare size={28} />}
        title="صندوق الرسائل الموحد"
        subtitle="التعليقات والمحادثات من جميع المنصات ستظهر هنا. اربط حساباتك للبدء."
      />
    </div>
  );
}
