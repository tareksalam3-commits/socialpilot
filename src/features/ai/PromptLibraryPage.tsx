import { useEffect, useState } from 'react';
import { Copy, Edit2, FolderPlus, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { usePrompts } from '@/hooks/usePrompts';
import { useToast } from '@/providers/ToastProvider';
import { Badge, Button, Card, Input, Modal, EmptyState } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { Prompt } from '@/types/ai';

const categories = ['general', 'social', 'marketing', 'seo', 'email', 'copywriting', 'creative', 'technical'];

export function PromptLibraryPage() {
  const { prompts, folders, loading, createPrompt, updatePrompt, deletePrompt, toggleFavorite, search, createFolder, deleteFolder } = usePrompts();
  const { push } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState<string | null>(null);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');

  const [form, setForm] = useState({ title: '', content: '', category: 'general', variables: '', folder_id: '' });

  useEffect(() => {
    if (searchQuery) {
      const t = setTimeout(() => search(searchQuery), 300);
      return () => clearTimeout(t);
    }
  }, [searchQuery, search]);

  const filtered = prompts.filter((p) => {
    if (filterCategory && p.category !== filterCategory) return false;
    if (filterFolder && p.folder_id !== filterFolder) return false;
    if (showFavOnly && !p.favorite) return false;
    return true;
  });

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      push({ title: 'Title and content are required', variant: 'error' });
      return;
    }
    const variables = form.variables.split(',').map((v) => v.trim()).filter(Boolean);
    if (editing) {
      await updatePrompt(editing.id, {
        title: form.title,
        content: form.content,
        category: form.category,
        variables,
        folder_id: form.folder_id || null,
      });
      push({ title: 'Prompt updated', variant: 'success' });
    } else {
      await createPrompt({
        title: form.title,
        content: form.content,
        category: form.category,
        variables,
        folder_id: form.folder_id || null,
      });
      push({ title: 'Prompt created', variant: 'success' });
    }
    setShowEditor(false);
    setEditing(null);
    setForm({ title: '', content: '', category: 'general', variables: '', folder_id: '' });
  };

  const handleEdit = (p: Prompt) => {
    setEditing(p);
    setForm({
      title: p.title,
      content: p.content,
      category: p.category,
      variables: p.variables.join(', '),
      folder_id: p.folder_id ?? '',
    });
    setShowEditor(true);
  };

  const handleDuplicate = async (p: Prompt) => {
    await createPrompt({
      title: `${p.title} (copy)`,
      content: p.content,
      category: p.category,
      variables: p.variables,
      folder_id: p.folder_id,
    });
    push({ title: 'Prompt duplicated', variant: 'success' });
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    push({ title: 'Copied to clipboard', variant: 'success' });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNew = () => {
    setEditing(null);
    setForm({ title: '', content: '', category: 'general', variables: '', folder_id: '' });
    setShowEditor(true);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    await createFolder(folderName.trim());
    setFolderName('');
    setShowFolderModal(false);
    push({ title: 'Folder created', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Prompt Library</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Save, organize, and reuse your best prompts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowFolderModal(true)}><FolderPlus className="h-4 w-4" /> Folder</Button>
          <Button variant="outline" onClick={handleExport}>Export</Button>
          <Button onClick={handleNew}><Plus className="h-4 w-4" /> New Prompt</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search prompts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={filterCategory ?? ''}
          onChange={(e) => setFilterCategory(e.target.value || null)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        {folders.length > 0 && (
          <select
            value={filterFolder ?? ''}
            onChange={(e) => setFilterFolder(e.target.value || null)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">All folders</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            showFavOnly ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
          }`}
        >
          <Star className={`h-4 w-4 ${showFavOnly ? 'fill-amber-400' : ''}`} /> Favorites
        </button>
      </div>

      {/* Folders */}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {folders.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-300">{f.name}</span>
              <span className="text-xs text-slate-400">({prompts.filter((p) => p.folder_id === f.id).length})</span>
              <button onClick={() => deleteFolder(f.id)} className="text-slate-400 hover:text-rose-500"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Prompts grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<Search className="h-10 w-10" />} title="No prompts found" description="Create a new prompt or adjust your filters." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{p.title}</h3>
                <button onClick={() => toggleFavorite(p.id, !p.favorite)} className="text-slate-400 hover:text-amber-500">
                  <Star className={`h-4 w-4 ${p.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-slate-500 dark:text-slate-400">{p.content}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="info">{p.category}</Badge>
                {p.variables.slice(0, 3).map((v) => <Badge key={v} className="font-mono">{`{${v}}`}</Badge>)}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                <span className="text-xs text-slate-400">{timeAgo(p.updated_at)}</span>
                <div className="flex gap-1">
                  <button onClick={() => handleCopy(p.content)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Copy"><Copy className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleEdit(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDuplicate(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Duplicate"><Plus className="h-3.5 w-3.5" /></button>
                  <button onClick={() => deletePrompt(p.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      <Modal
        open={showEditor}
        onClose={() => setShowEditor(false)}
        title={editing ? 'Edit Prompt' : 'New Prompt'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Prompt title" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={6}
              placeholder="Write your prompt here. Use {variable} for dynamic values."
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {categories.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <Input label="Variables (comma-separated)" value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} placeholder="topic, audience, tone" />
          </div>
          {folders.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Folder</label>
              <select
                value={form.folder_id}
                onChange={(e) => setForm({ ...form, folder_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Folder Modal */}
      <Modal
        open={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        title="New Folder"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowFolderModal(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder}>Create</Button>
          </>
        }
      >
        <Input label="Folder Name" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="My prompts" autoFocus />
      </Modal>
    </div>
  );
}
