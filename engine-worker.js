// 探索専用の Web Worker。メインスレッドとは別のエンジンインスタンスを持つ。
// 局面は「指し手履歴（raw）」を毎回再生して同期する。
importScripts('chaturanga.js', 'engine-io.js');

let E = null;

function syncPosition(history) {
    E._engine_reset();
    for (const raw of history) {
        if (!E._engine_playRaw(raw, 0)) return false;
    }
    return true;
}

ChaturangaEngine().then((m) => {
    E = m;
    E._engine_init();
    postMessage({ type: 'ready' });
}).catch((e) => {
    postMessage({ type: 'error', message: String(e) });
});

onmessage = (ev) => {
    const d = ev.data;
    if (!E) { postMessage({ type: 'result', id: d.id, error: 'not ready' }); return; }
    try {
        if (!syncPosition(d.history)) {
            postMessage({ type: 'result', id: d.id, error: 'sync failed' });
            return;
        }
        if (d.type === 'think') {
            if (E._engine_setTimeLimit) E._engine_setTimeLimit(d.timeLimit | 0);
            const ok = E._engine_playAI(d.depth);
            postMessage({
                type: 'result', id: d.id, ok: ok === 1,
                raw: ok === 1 ? E._engine_getLastMoveRaw() : 0,
                score: ok === 1 ? E._engine_getLastScore() : 0,
            });
        } else if (d.type === 'analyze') {
            postMessage({ type: 'result', id: d.id, data: runAnalysis(E, d.depth, d.timeLimit) });
        }
    } catch (e) {
        postMessage({ type: 'result', id: d.id, error: String(e) });
    }
};
