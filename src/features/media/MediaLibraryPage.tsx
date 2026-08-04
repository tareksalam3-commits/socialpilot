import { useState } from 'react';
import { File, Film, Image as ImageIcon, FolderPlus, Search, Trash2, Upload, X } from 'lucide-react';
import { useMedia } from '@/hooks/useMedia';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, EmptyState, Input, Modal } from '@/ui';
import { formatDate } from '@/utils/format';
import type { MediaItem } from '@/types/social';

const typeIcons = { image: ImageIcon, video: Film, document: File };
const typeColors = { image: 'text-emerald-600', video: 'text-purple-600', document: 'text-amber-600' };

export function MediaLibraryPage() {
  const { items, folders, loading, upload, remove, createFolder, deleteFolder, filterType, setFilterType, filterFolder, setFilterFolder, searchQuery, setSearchQuery } = useMedia();
  const { push } = useToast();
  const { t } = useLanguage();
  const [showFolder, setShowFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await upload(files);
    push({ title: `${files.length} file(s) uploaded`, variant: 'success' });
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    await createFolder(folderName.trim());
    setFolderName('');
    setShowFolder(false);
    push({ title: 'Folder created', variant: 'success' });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Media Library</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Upload, organize, and manage your media assets.</p>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setShowFolder(true)}><FolderPlus className="h-4 w-4" /> Folder</Button>
          <label className="flex-1 sm:flex-none">
            <Button className="w-full" onClick={() => {}}><Upload className="h-4 w-4" /> Upload</Button>
            <input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" placeholder="Search media…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
        <select value={filterType ?? ''} onChange={(e) => setFilterType(e.target.value || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="document">Documents</option>
        </select>
      </div>

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilterFolder(null)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${!filterFolder ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}>All</button>
          {folders.map((f) => (
            <div key={f.id} className="flex items-center gap-1">
              <button onClick={() => setFilterFolder(f.id)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${filterFolder === f.id ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}>{f.name}</button>
              <button onClick={() => deleteFolder(f.id)} className="flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-500 sm:h-6 sm:w-6"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<ImageIcon className="h-10 w-10" />} title="No media yet" description="Upload images, videos, or documents to get started." action={<label><Button onClick={() => {}}><Upload className="h-4 w-4" /> Upload</Button><input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} /></label>} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => {
            const Icon = typeIcons[item.type] ?? File;
            return (
              <div key={item.id} className="group overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="relative aspect-square cursor-pointer bg-slate-100 dark:bg-slate-800" onClick={() => setPreview(item)}>
                  {item.type === 'image' ? (
                    <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Icon className={`h-10 w-10 ${typeColors[item.type]}`} />
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); remove(item.id); }} className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-slate-500 opacity-100 transition hover:text-rose-500 active:scale-95 dark:bg-slate-900/90 sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-slate-900 dark:text-white">{item.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{formatSize(item.size_bytes)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showFolder} onClose={() => setShowFolder(false)} title="New Folder" size="sm" footer={<><Button variant="outline" onClick={() => setShowFolder(false)}>Cancel</Button><Button onClick={handleCreateFolder}>Create</Button></>}>
        <Input label="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="My folder" autoFocus />
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? ''} size="lg" footer={<Button onClick={() => setPreview(null)}>Close</Button>}>
        {preview && (
          <div className="space-y-3">
            {preview.type === 'image' ? <img src={preview.url} alt={preview.name} className="max-h-96 w-full rounded-lg object-contain" /> : <div className="flex h-48 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">{(() => { const Icon = typeIcons[preview.type] ?? File; return <Icon className={`h-12 w-12 ${typeColors[preview.type]}`} />; })()}</div>}
            <div className="flex flex-wrap gap-2">{preview.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-slate-500 dark:text-slate-400">Type:</span> <span className="text-slate-900 dark:text-white">{preview.type}</span></div>
              <div><span className="text-slate-500 dark:text-slate-400">Size:</span> <span className="text-slate-900 dark:text-white">{preview.size_bytes ? (preview.size_bytes / 1024).toFixed(1) + ' KB' : '—'}</span></div>
              <div><span className="text-slate-500 dark:text-slate-400">Uploaded:</span> <span className="text-slate-900 dark:text-white">{formatDate(preview.created_at)}</span></div>
              <div><span className="text-slate-500 dark:text-slate-400">MIME:</span> <span className="text-slate-900 dark:text-white">{preview.mime_type ?? '—'}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
