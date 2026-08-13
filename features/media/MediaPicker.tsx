import { useState } from 'react';
import { Check, File, Film, FolderOpen, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';
import { useMedia } from '@/hooks/useMedia';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { aiGateway } from '@/services/aiGateway';
import { mediaRepository } from '@/repositories/mediaRepository';
import { Badge, Button, Modal, Select, Tabs } from '@/ui';
import type { MediaItem } from '@/types/social';

const typeIcons = { image: ImageIcon, video: Film, document: File };

type PickerTab = 'library' | 'upload' | 'generate';

export type MediaPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Called once with every URL the user attached in this session. The
   * editor is responsible for appending these to the post's media_urls. */
  onAttach: (urls: string[]) => void;
};

// Add Media → Media Library / Upload / Generate with AI, all inline inside
// the post editor. Every path here ends the same way — one or more URLs
// handed back via onAttach — so the post editor doesn't need to know which
// tab produced them; they all resolve to plain media_urls entries.
export function MediaPicker({ open, onClose, onAttach }: MediaPickerProps) {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { push } = useToast();
  const {
    items,
    folders,
    loading,
    filterType,
    setFilterType,
    filterFolder,
    setFilterFolder,
    searchQuery,
    setSearchQuery,
  } = useMedia();

  const [tab, setTab] = useState<PickerTab>('library');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState<string>('');

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [saveGenerated, setSaveGenerated] = useState(true);
  const [genFolder, setGenFolder] = useState<string>('');
  const [genError, setGenError] = useState<string | null>(null);

  const reset = () => {
    setSelected(new Set());
    setPrompt('');
    setGeneratedUrl(null);
    setGenFolder('');
    setGenError(null);
    setTab('library');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleSelect = (item: MediaItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.url)) next.delete(item.url);
      else next.add(item.url);
      return next;
    });
  };

  const attachFromLibrary = () => {
    if (selected.size === 0) return;
    onAttach(Array.from(selected));
    handleClose();
  };

  // Upload happens immediately on file selection — no separate "confirm"
  // step, matching the rest of Media Library's upload UX. The file becomes
  // a normal media_items row (so it's reusable later) AND is attached to
  // this post in the same action, so the user never has to leave the post
  // editor to find what they just uploaded.
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !workspace) return;
    setUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of Array.from(files)) {
        const url = await mediaRepository.upload(file, workspace.id);
        const type: MediaItem['type'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
        await mediaRepository.create({
          workspace_id: workspace.id,
          name: file.name,
          type,
          url,
          size_bytes: file.size,
          mime_type: file.type,
          folder_id: uploadFolder || null,
        });
        uploadedUrls.push(url);
      }
      if (uploadedUrls.length > 0) {
        push({ title: t('media.toast.uploaded', { count: uploadedUrls.length }), variant: 'success' });
        onAttach(uploadedUrls);
        handleClose();
      }
    } catch (e) {
      push({ title: e instanceof Error ? e.message : t('media.toast.uploadFailed'), variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  // "Create Images" for a single post, outside the AI Assistant campaign
  // pipeline. Saving to the Media Library is optional (saveGenerated) — the
  // file already exists in Storage either way (the ai-gateway edge function
  // wrote it there), so skipping the media_items row just means it won't
  // show up in the library for reuse later.
  const handleGenerate = async () => {
    if (!workspace || !prompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const { url } = await aiGateway.generateImage({ workspaceId: workspace.id, prompt: prompt.trim(), width: 1024, height: 1024 });
      setGeneratedUrl(url);
      if (saveGenerated) {
        await mediaRepository
          .create({
            workspace_id: workspace.id,
            name: prompt.trim().slice(0, 60) || 'AI image',
            type: 'image',
            url,
            tags: ['ai-generated'],
            folder_id: genFolder || null,
          })
          .catch(() => {});
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : t('media.picker.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const attachGenerated = () => {
    if (!generatedUrl) return;
    onAttach([generatedUrl]);
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('media.picker.title')} size="lg">
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(id) => setTab(id as PickerTab)}
        tabs={[
          { id: 'library', label: t('media.picker.tab.library'), icon: <FolderOpen className="h-4 w-4" /> },
          { id: 'upload', label: t('media.picker.tab.upload'), icon: <Upload className="h-4 w-4" /> },
          { id: 'generate', label: t('media.picker.tab.generate'), icon: <Sparkles className="h-4 w-4" /> },
        ]}
      />

      {tab === 'library' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder={t('media.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <select
              value={filterType ?? ''}
              onChange={(e) => setFilterType(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">{t('media.filter.allTypes')}</option>
              <option value="image">{t('media.filter.images')}</option>
              <option value="video">{t('media.filter.videos')}</option>
              <option value="document">{t('media.filter.documents')}</option>
            </select>
          </div>

          {folders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterFolder(null)}
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${!filterFolder ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}
              >
                {t('media.filter.all')}
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterFolder(f.id)}
                  className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${filterFolder === f.id ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-500">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('media.empty.title')}</p>
          ) : (
            <div className="grid max-h-72 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {items.map((item) => {
                const Icon = typeIcons[item.type] ?? File;
                const isSelected = selected.has(item.url);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleSelect(item)}
                    className={`group relative aspect-square overflow-hidden rounded-lg border-2 bg-slate-100 transition dark:bg-slate-800 ${isSelected ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'}`}
                  >
                    {item.type === 'image' ? (
                      <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Icon className="h-8 w-8 text-slate-400" />
                      </div>
                    )}
                    {isSelected && (
                      <span className="absolute end-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button onClick={attachFromLibrary} disabled={selected.size === 0}>
              {t('media.picker.attach', { count: selected.size })}
            </Button>
          </div>
        </div>
      )}

      {tab === 'upload' && (
        <div className="space-y-4">
          <Select label={t('media.picker.uploadFolder')} value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)}>
            <option value="">{t('media.picker.noFolder')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/50">
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-slate-400" /> : <Upload className="h-8 w-8 text-slate-400" />}
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{uploading ? t('media.picker.uploading') : t('media.picker.uploadPrompt')}</span>
            <input type="file" multiple accept="image/*,video/*" className="hidden" disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
          </label>
        </div>
      )}

      {tab === 'generate' && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('media.picker.promptLabel')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={t('media.picker.promptPlaceholder')}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={saveGenerated} onChange={(e) => setSaveGenerated(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            {t('media.picker.saveToLibrary')}
          </label>

          {saveGenerated && !generatedUrl && (
            <Select label={t('media.picker.uploadFolder')} value={genFolder} onChange={(e) => setGenFolder(e.target.value)}>
              <option value="">{t('media.picker.noFolder')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          )}

          {!generatedUrl && (
            <Button onClick={handleGenerate} loading={generating} disabled={!prompt.trim()}>
              <Sparkles className="h-4 w-4" /> {t('media.picker.generate')}
            </Button>
          )}

          {genError && <p className="text-sm text-rose-600 dark:text-rose-400">{genError}</p>}

          {generatedUrl && (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <img src={generatedUrl} alt={prompt} className="max-h-72 w-full object-contain" />
                {saveGenerated && (
                  <Badge className="absolute end-2 top-2" variant="success">{t('media.picker.savedBadge')}</Badge>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setGeneratedUrl(null); setGenError(null); }}>
                  {t('media.picker.regenerate')}
                </Button>
                <Button onClick={attachGenerated}>{t('media.picker.attachThis')}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
