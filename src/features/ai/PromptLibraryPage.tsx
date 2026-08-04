import { useEffect, useState } from 'react';
import { Copy, Edit2, FolderPlus, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { usePrompts } from '@/hooks/usePrompts';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, Input, Modal, EmptyState, Skeleton } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { Prompt } from '@/types/ai';

const categories = ['general', 'social', 'marketing', 'seo', 'email', 'copywriting', 'creative', 'technical'];

export function PromptLibraryPage() {
  const { t } = useLanguage();
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
      const timer = setTimeout(() => search(searchQuery), 300);
      return () => clearTimeout(timer);
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
      push({ title: t('ai.prompts.toast.titleContentRequired'), variant: 'error' });
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
      push({ title: t('ai.prompts.toast.updated'), variant: 'success' });
    } else {
      await createPrompt({
        title: form.title,
        content: form.content,
        category: form.category,
        variables,
        folder_id: form.folder_id || null,
      });
      push({ title: t('ai.prompts.toast.created'), variant: 'success' });
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
    push({ title: t('ai.prompts.toast.duplicated'), variant: 'success' });
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    push({ title: t('ai.prompts.toast.copiedToClipboard'), variant: 'success' });
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
    push({ title: t('ai.prompts.toast.folderCreated'), variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.prompts.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.prompts.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setShowFolderModal(true)}><FolderPlus className="h-4 w-4" /> {t('ai.prompts.folderButton')}</Button>
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={handleExport}>{t('ai.prompts.exportButton')}</Button>
          <Button className="w-full sm:w-auto" onClick={handleNew}><Plus className="h-4 w-4" /> {t('ai.prompts.newPromptButton')}</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder={t('ai.prompts.searchPlaceholder')}
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
          <option value="">{t('ai.prompts.allCategories')}</option>
          {categories.map((c) => <option key={c} value={c}>{t(`options.${c}`)}</option>)}
        </select>
        {folders.length > 0 && (
          <select
            value={filterFolder ?? ''}
            onChange={(e) => setFilterFolder(e.target.value || null)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">{t('ai.prompts.allFolders')}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            showFavOnly ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
          }`}
        >
          <Star className={`h-4 w-4 ${showFavOnly ? 'fill-amber-400' : ''}`} /> {t('ai.prompts.favoritesFilter')}
        </button>
      </div>

      {/* Folders */}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {folders.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-300">{f.name}</span>
              <span className="text-xs text-slate-400">({prompts.filter((p) => p.folder_id === f.id).length})</span>
              <button onClick={() => deleteFolder(f.id)} className="flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-500 sm:h-6 sm:w-6"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Prompts grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<Search className="h-10 w-10" />} title={t('ai.prompts.empty.title')} description={t('ai.prompts.empty.description')} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{p.title}</h3>
                <button onClick={() => toggleFavorite(p.id, !p.favorite)} className="-me-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center text-slate-400 hover:text-amber-500">
                  <Star className={`h-4 w-4 ${p.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-slate-500 dark:text-slate-400">{p.content}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="info">{t(`options.${p.category}`)}</Badge>
                {p.variables.slice(0, 3).map((v) => <Badge key={v} className="font-mono">{`{${v}}`}</Badge>)}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                <span className="text-xs text-slate-400">{timeAgo(p.updated_at)}</span>
                <div className="-me-1 flex gap-0.5">
                  <button onClick={() => handleCopy(p.content)} className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('ai.prompts.copy')}><Copy className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleEdit(p)} className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('ai.prompts.edit')}><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDuplicate(p)} className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('ai.prompts.duplicate')}><Plus className="h-3.5 w-3.5" /></button>
                  <button onClick={() => deletePrompt(p.id)} className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800" title={t('ai.prompts.delete')}><Trash2 className="h-3.5 w-3.5" /></button>
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
        title={editing ? t('ai.prompts.modal.editTitle') : t('ai.prompts.modal.newTitle')}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowEditor(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave}>{editing ? t('ai.prompts.modal.update') : t('ai.prompts.modal.create')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label={t('ai.prompts.modal.titleLabel')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('ai.prompts.modal.titlePlaceholder')} />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.prompts.modal.contentLabel')}</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={6}
              placeholder={t('ai.prompts.modal.contentPlaceholder')}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.prompts.modal.categoryLabel')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {categories.map((c) => <option key={c} value={c}>{t(`options.${c}`)}</option>)}
              </select>
            </div>
            <Input label={t('ai.prompts.modal.variablesLabel')} value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} placeholder={t('ai.prompts.modal.variablesPlaceholder')} />
          </div>
          {folders.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.prompts.modal.folderLabel')}</label>
              <select
                value={form.folder_id}
                onChange={(e) => setForm({ ...form, folder_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">{t('ai.prompts.modal.noFolder')}</option>
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
        title={t('ai.prompts.modal.newFolderTitle')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowFolderModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreateFolder}>{t('common.create')}</Button>
          </>
        }
      >
        <Input label={t('ai.prompts.modal.folderNameLabel')} value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder={t('ai.prompts.modal.folderNamePlaceholder')} autoFocus />
      </Modal>
    </div>
  );
}
