const MEMORY_SCHEME = 'memory://';

export function toVirtualPath(absolutePath: string, collectionName: string, collectionRoot: string): string {
  const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
  const normalizedRoot = collectionRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedAbsolute.startsWith(normalizedRoot)) return absolutePath;
  const relativePath = normalizedAbsolute.slice(normalizedRoot.length).replace(/^\//, '');
  return `${MEMORY_SCHEME}${collectionName}/${relativePath}`;
}

export function fromVirtualPath(virtualPath: string, collections: Array<{ name: string; paths: string[] }>): string | null {
  if (!virtualPath.startsWith(MEMORY_SCHEME)) return null;
  const rest = virtualPath.slice(MEMORY_SCHEME.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;
  const collectionName = rest.slice(0, slashIdx);
  const relativePath = rest.slice(slashIdx + 1);
  const collection = collections.find(c => c.name === collectionName);
  if (!collection || collection.paths.length === 0) return null;
  const root = collection.paths[0].replace(/\\/g, '/').replace(/\/$/, '');
  return `${root}/${relativePath}`;
}

export function isVirtualPath(path: string): boolean {
  return path.startsWith(MEMORY_SCHEME);
}

export function parseVirtualPath(virtualPath: string): { collection: string; relativePath: string } | null {
  if (!virtualPath.startsWith(MEMORY_SCHEME)) return null;
  const rest = virtualPath.slice(MEMORY_SCHEME.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;
  return { collection: rest.slice(0, slashIdx), relativePath: rest.slice(slashIdx + 1) };
}
