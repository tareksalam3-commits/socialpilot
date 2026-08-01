import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { mediaRepository, mediaFolderRepository } from '@/repositories/mediaRepository';
import type { MediaItem, MediaFolder } from '@/types/social';

export function useMedia() {
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(
    async (signal?: { active: boolean }) => {
      if (!workspace) return;
      try {
        setLoading(true);
        setError(null);
        const [mediaData, folderData] = await Promise.all([
          searchQuery
            ? mediaRepository.search(workspace.id, searchQuery)
            : mediaRepository.list(workspace.id, { type: filterType ?? undefined, folder_id: filterFolder }),
          mediaFolderRepository.list(workspace.id),
        ]);
        if (!signal || signal.active) {
          setItems(mediaData);
          setFolders(folderData);
        }
      } catch (e) {
        if (!signal || signal.active) setError(e instanceof Error ? e.message : 'Failed to load media');
      } finally {
        if (!signal || signal.active) setLoading(false);
      }
    },
    [workspace, filterType, filterFolder, searchQuery],
  );

  useEffect(() => {
    const signal = { active: true };
    // Debounce so typing in the search box doesn't fire a request per keystroke,
    // and guard against out-of-order responses overwriting fresher results.
    const handle = setTimeout(() => load(signal), searchQuery ? 300 : 0);
    return () => {
      signal.active = false;
      clearTimeout(handle);
    };
  }, [load, searchQuery]);

  const upload = useCallback(
    async (files: FileList) => {
      if (!workspace) return;
      // Upload files concurrently instead of one at a time — with several files
      // selected, sequential awaits made every upload wait on the full round trip
      // of the previous one. A Promise.allSettled also means one failed file no
      // longer aborts the rest of the batch.
      const results = await Promise.allSettled(
        Array.from(files).map(async (file) => {
          const url = await mediaRepository.upload(file, workspace.id);
          const type: MediaItem['type'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
          return mediaRepository.create({
            workspace_id: workspace.id,
            name: file.name,
            type,
            url,
            size_bytes: file.size,
            mime_type: file.type,
            folder_id: filterFolder,
          });
        }),
      );

      const uploaded = results.filter((r): r is PromiseFulfilledResult<MediaItem> => r.status === 'fulfilled').map((r) => r.value);
      if (uploaded.length > 0) setItems((prev) => [...uploaded, ...prev]);

      const failedCount = results.length - uploaded.length;
      if (failedCount > 0) {
        setError(failedCount === results.length ? 'Upload failed' : `${failedCount} of ${results.length} files failed to upload`);
      }
    },
    [workspace, filterFolder],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await mediaRepository.remove(id);
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete media');
    }
  }, []);

  const createFolder = useCallback(
    async (name: string) => {
      if (!workspace) return;
      try {
        const folder = await mediaFolderRepository.create({ workspace_id: workspace.id, name });
        setFolders((prev) => [...prev, folder]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create folder');
      }
    },
    [workspace],
  );

  const deleteFolder = useCallback(async (id: string) => {
    try {
      await mediaFolderRepository.remove(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (filterFolder === id) setFilterFolder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete folder');
    }
  }, [filterFolder]);

  return {
    items,
    folders,
    loading,
    error,
    upload,
    remove,
    createFolder,
    deleteFolder,
    filterType,
    setFilterType,
    filterFolder,
    setFilterFolder,
    searchQuery,
    setSearchQuery,
    reload: load,
  };
}
