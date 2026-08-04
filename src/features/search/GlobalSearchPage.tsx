import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Image as ImageIcon, Link2, MessageSquare, Search, Sparkles, X } from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { Badge } from '@/ui';
import type { Post } from '@/types/social';
import type { Conversation, Prompt } from '@/types/ai';
import type { MediaItem, ExtendedConnectedAccount } from '@/types/social';

type SearchResult = {
  type: 'post' | 'conversation' | 'prompt' | 'media' | 'account';
  id: string;
  title: string;
  subtitle: string;
  icon: typeof Search;
  route: string;
};

export function GlobalSearchPage() {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim() || !workspace) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const [posts, conversations, prompts, media, accounts] = await Promise.all([
          import('@/repositories/postRepository').then((m) => m.postRepository.search(workspace.id, query)),
          user ? import('@/repositories/conversationRepository').then((m) => m.conversationRepository.search(user.id, query)) : Promise.resolve([]),
          user ? import('@/repositories/promptRepository').then((m) => m.promptRepository.search(user.id, query)) : Promise.resolve([]),
          import('@/repositories/mediaRepository').then((m) => m.mediaRepository.search(workspace.id, query)),
          import('@/repositories/accountRepository').then((m) => m.accountRepository.list(workspace.id)),
        ]);

        const filteredAccounts = accounts.filter((a) => a.platform.includes(query.toLowerCase()) || (a.handle ?? '').toLowerCase().includes(query.toLowerCase()));

        const all: SearchResult[] = [
          ...posts.map((p: Post) => ({ type: 'post' as const, id: p.id, title: p.title ?? p.content.slice(0, 40), subtitle: `Post · ${p.status}`, icon: FileText, route: '/app/scheduled' })),
          ...conversations.map((c: Conversation) => ({ type: 'conversation' as const, id: c.id, title: c.title, subtitle: 'Conversation', icon: MessageSquare, route: '/app/playground' })),
          ...prompts.map((p: Prompt) => ({ type: 'prompt' as const, id: p.id, title: p.title, subtitle: `Prompt · ${p.category}`, icon: Sparkles, route: '/app/prompts' })),
          ...media.map((m: MediaItem) => ({ type: 'media' as const, id: m.id, title: m.name, subtitle: `Media · ${m.type}`, icon: ImageIcon, route: '/app/media' })),
          ...filteredAccounts.map((a: ExtendedConnectedAccount) => ({ type: 'account' as const, id: a.id, title: a.handle ?? a.platform, subtitle: `Account · ${a.platform}`, icon: Link2, route: '/app/accounts' })),
        ];
        if (!cancelled) setResults(all);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, workspace, user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Search</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Search across posts, prompts, conversations, accounts, and media.</p>
      </div>

      <div className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input type="search" autoFocus placeholder="Search everything…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-10 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        {query && <button onClick={() => setQuery('')} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>}
      </div>

      {loading && <p className="text-sm text-slate-500">Searching…</p>}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} onClick={() => navigate(r.route)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800"><r.icon className="h-4 w-4 text-slate-500" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-slate-900 dark:text-white">{r.title}</p><p className="text-xs text-slate-500 dark:text-slate-400">{r.subtitle}</p></div>
              <Badge variant="default">{r.type}</Badge>
            </button>
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No results found for "{query}"</p>}
      {!loading && !query.trim() && <p className="py-6 text-center text-sm text-slate-500">Start typing to search across your workspace.</p>}
    </div>
  );
}
