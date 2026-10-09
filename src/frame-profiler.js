const WINDOW_SAMPLES = 120;
const MAX_QUERIES = 3;

function rollingSamples() {
  const values = new Float64Array(WINDOW_SAMPLES);
  let count = 0, next = 0;
  return {
    add(value) {
      if (!Number.isFinite(value) || value < 0) return;
      values[next] = value; next = (next + 1) % WINDOW_SAMPLES;
      count = Math.min(count + 1, WINDOW_SAMPLES);
    },
    clear() { count = 0; next = 0; },
    stats() {
      if (!count) return { samples: 0, p50Ms: null, p95Ms: null };
      const sorted = Array.from(values.subarray(0, count)).sort((a, b) => a - b);
      const percentile = fraction => {
        const position = (count - 1) * fraction, low = Math.floor(position);
        const value = sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
        return Math.round(value * 1000) / 1000;
      };
      return { samples: count, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
    },
  };
}

/** Optional QA-only timings; this module reads no device/user identifiers.
 * beginFrame(); simulation/update work; beginRender(); composer.render();
 * endRender(); remaining frame work; endFrame();
 *
 * CPU values are synchronous elapsed spans, not OS process CPU utilization:
 * total covers the frame callback, render covers composer.render(), simulation
 * is the remaining callback time. GPU time is asynchronous elapsed GPU work.
 * The 120-sample windows are independent; GPU samples can arrive several frames
 * later. Missing GPU measurements are null, never misreported as zero.
 */
export function createFrameProfiler(renderer) {
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const cpuSimulation = rollingSamples(), cpuRender = rollingSamples();
  const cpuTotal = rollingSamples(), gpuTimes = rollingSamples();
  const canvas = renderer?.domElement;
  let gl = null, extension = null, supported = false, status = 'unsupported';
  let disposed = false, activeQuery = null, pending = [], disjointSeen = false;
  let frameStart = null, renderStart = null, renderedMs = 0, didRender = false;
  let frames = 0, droppedFrames = 0, submitted = 0, received = 0;
  let droppedQueries = 0, skippedQueries = 0, disjointEvents = 0;

  const deleteQuery = query => { try { gl?.deleteQuery(query); } catch { /* Diagnostic cleanup cannot interrupt play. */ } };
  const contextLost = () => Boolean(gl?.isContextLost?.());
  const discardActive = () => {
    if (!activeQuery) return;
    const query = activeQuery; activeQuery = null;
    try {
      // Never end a timer owned by another profiler or renderer extension.
      if (!contextLost() && gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === query)
        gl.endQuery(extension.TIME_ELAPSED_EXT);
    } catch { /* A lost context can invalidate the query between these calls. */ }
    deleteQuery(query); droppedQueries++;
  };
  const discardQueries = () => {
    discardActive();
    for (const query of pending) { deleteQuery(query); droppedQueries++; }
    pending = [];
  };
  const failGPU = () => { discardQueries(); gpuTimes.clear(); status = 'disabled'; };
  const onContextLost = () => {
    if (disposed) return;
    discardQueries(); gpuTimes.clear(); status = 'context-lost';
  };
  const initializeGPU = () => {
    extension = null; supported = false; status = 'unsupported'; disjointSeen = false;
    try {
      gl = renderer?.getContext?.() ?? null;
      if (!gl) return;
      if (contextLost()) { status = 'context-lost'; return; }
      if (!['createQuery', 'deleteQuery', 'beginQuery', 'endQuery', 'getQuery', 'getQueryParameter', 'getParameter']
        .every(method => typeof gl[method] === 'function')) return;
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!extension || !Number.isFinite(extension.TIME_ELAPSED_EXT) || !Number.isFinite(extension.GPU_DISJOINT_EXT)) return;
      // A present extension can still expose a zero-bit elapsed-time counter.
      if (Number.isFinite(extension.QUERY_COUNTER_BITS_EXT)
        && !(gl.getQuery(extension.TIME_ELAPSED_EXT, extension.QUERY_COUNTER_BITS_EXT) > 0)) return;
      supported = true; status = 'ready';
    } catch { status = 'unsupported'; extension = null; }
  };
  const onContextRestored = () => {
    if (disposed) return;
    discardQueries(); gpuTimes.clear(); initializeGPU();
  };
  const checkDisjoint = () => {
    if (contextLost()) { onContextLost(); return true; }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      if (!disjointSeen) disjointEvents++;
      disjointSeen = true; discardQueries(); gpuTimes.clear(); status = 'disjoint'; return true;
    }
    disjointSeen = false; status = 'ready'; return false;
  };
  const pollGPU = () => {
    if (!supported || status === 'disabled' || status === 'context-lost') return;
    try {
      if (checkDisjoint()) return;
      // This runs once at the NEXT beginFrame, after the browser had control.
      // QUERY_RESULT is never requested until AVAILABLE is true. No spin, wait,
      // flush, finish, fence wait, or unbounded allocation is used.
      const ready = [];
      for (const query of pending) {
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        ready.push({ query, milliseconds: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 });
      }
      // If a disjoint happened during readback, discard the whole batch.
      if (checkDisjoint()) return;
      for (const { query, milliseconds } of ready) {
        if (Number.isFinite(milliseconds) && milliseconds >= 0) { gpuTimes.add(milliseconds); received++; }
        else droppedQueries++;
        deleteQuery(query); pending.splice(pending.indexOf(query), 1);
      }
    } catch { failGPU(); }
  };
  const beginGPU = () => {
    if (!supported || status !== 'ready') return;
    if (pending.length >= MAX_QUERIES) { skippedQueries++; return; }
    try {
      if (checkDisjoint()) return;
      if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { skippedQueries++; return; }
      const query = gl.createQuery();
      if (!query) { skippedQueries++; return; }
      activeQuery = query;
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== query) {
        discardActive(); skippedQueries++; return;
      }
      submitted++;
    } catch { failGPU(); }
  };
  const endGPU = () => {
    if (!activeQuery) return;
    try {
      if (contextLost()) { onContextLost(); return; }
      const query = activeQuery;
      if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== query) {
        discardActive(); return;
      }
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      activeQuery = null; pending.push(query);
      checkDisjoint();
    } catch { failGPU(); }
  };

  const beginFrame = () => {
    if (disposed) return false;
    // An interrupted previous callback is abandoned, never extended into this
    // frame. Closing its timer also prevents overlapping TIME_ELAPSED queries.
    if (frameStart !== null) { droppedFrames++; discardActive(); }
    frameStart = null; renderStart = null; renderedMs = 0; didRender = false;
    pollGPU(); frameStart = clock(); return true;
  };
  const beginRender = () => {
    if (disposed || frameStart === null || renderStart !== null || didRender) return false;
    beginGPU(); renderStart = clock(); return true;
  };
  const endRender = () => {
    if (disposed || renderStart === null) return false;
    renderedMs = Math.max(0, clock() - renderStart); renderStart = null; didRender = true;
    endGPU(); return true;
  };
  const endFrame = () => {
    if (disposed || frameStart === null) return false;
    if (renderStart !== null) endRender();
    const total = clock() - frameStart;
    if (didRender && Number.isFinite(total) && total >= 0 && renderedMs <= total) {
      cpuTotal.add(total); cpuRender.add(renderedMs); cpuSimulation.add(total - renderedMs); frames++;
    } else { droppedFrames++; discardActive(); }
    frameStart = null; renderStart = null; return true;
  };
  const snapshot = () => ({
    windowSamples: WINDOW_SAMPLES, frames, droppedFrames,
    cpu: { simulation: cpuSimulation.stats(), render: cpuRender.stats(), total: cpuTotal.stats() },
    gpu: { supported, status, ...gpuTimes.stats(), pendingQueries: pending.length,
      activeQueries: activeQuery ? 1 : 0, queryLimit: MAX_QUERIES,
      submitted, received, droppedQueries, skippedQueries, disjointEvents },
  });
  const dispose = () => {
    if (disposed) return;
    discardQueries(); disposed = true; status = 'disposed'; frameStart = renderStart = null;
    canvas?.removeEventListener?.('webglcontextlost', onContextLost);
    canvas?.removeEventListener?.('webglcontextrestored', onContextRestored);
  };
  initializeGPU();
  canvas?.addEventListener?.('webglcontextlost', onContextLost);
  canvas?.addEventListener?.('webglcontextrestored', onContextRestored);
  return { beginFrame, beginRender, endRender, endFrame, snapshot, dispose };
}
