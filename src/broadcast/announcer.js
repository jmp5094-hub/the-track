const downloads = new Map();
const decoded = new WeakMap();

export function loadAnnouncer(ctx, file = 'announcer') {
  if (!downloads.has(file)) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    downloads.set(file, fetch(import.meta.env.BASE_URL + 'broadcast/audio/' + file + '.mp3',{signal:controller.signal})
    .then(response => { if (!response.ok) throw Error('Announcer unavailable'); return response.arrayBuffer(); })
    .catch(error => { downloads.delete(file); throw error; }).finally(()=>clearTimeout(timeout)));
  }
  if (!decoded.has(ctx)) decoded.set(ctx, new Map());
  const buffers = decoded.get(ctx);
  if (!buffers.has(file)) buffers.set(file, downloads.get(file)
    .then(bytes => ctx.decodeAudioData(bytes.slice(0)))
    .catch(error => { buffers.delete(file); downloads.delete(file); throw error; }));
  return buffers.get(file);
}
