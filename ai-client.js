// メインスレッド側：探索を Web Worker に任せる。
// Worker が使えない／古い WASM の場合は、従来どおりメインスレッドで同期探索する（フォールバック）。
const AIClient = (() => {
    let worker = null;
    let readyPromise = null;
    let readyResolve = null;
    let broken = false;           // Worker 初期化に失敗したら以後フォールバック
    let seq = 0;
    const pending = new Map();    // id -> resolve

    function workerUsable() {
        return !broken && typeof Worker !== 'undefined' && Engine &&
               typeof Engine._engine_getHistoryLen === 'function' &&
               typeof Engine._engine_playRaw === 'function';
    }

    function start() {
        if (worker) return readyPromise;
        worker = new Worker('engine-worker.js');
        const w = worker;
        readyPromise = new Promise((resolve, reject) => {
            readyResolve = resolve;
            w.onmessage = (ev) => {
                const d = ev.data;
                if (d.type === 'ready') { resolve(); }
                else if (d.type === 'error') { reject(new Error(d.message)); }
                else if (d.type === 'result') {
                    const r = pending.get(d.id);
                    if (r) { pending.delete(d.id); r(d); }
                }
            };
            w.onerror = (e) => { reject(new Error(e.message || 'worker error')); };
        });
        // 初期化失敗時は握りつぶさず broken にする
        readyPromise.catch(() => { broken = true; kill(); });
        return readyPromise;
    }

    function kill() {
        if (readyResolve) { readyResolve(); readyResolve = null; }   // 起動待ちを解放（request側で worker==null を見て中断扱い）
        if (worker) { worker.terminate(); worker = null; readyPromise = null; }
        for (const r of pending.values()) r(null);   // 待っている呼び出しは「中断」で解決
        pending.clear();
    }

    function currentHistory() {
        const n = Engine._engine_getHistoryLen();
        const h = [];
        for (let i = 0; i < n; i++) h.push(Engine._engine_getHistoryMove(i));
        return h;
    }

    // Worker に依頼。戻り値: 結果 | null(中断) | undefined(Worker 使用不可 → フォールバック)
    async function request(type, depth, timeLimit) {
        if (!workerUsable()) return undefined;
        const history = currentHistory();
        try { await start(); } catch (e) { console.warn('Worker 初期化失敗、同期探索に切替:', e); return undefined; }
        if (!worker) return null;   // 待機中に cancel された
        const id = ++seq;
        const p = new Promise((resolve) => pending.set(id, resolve));
        worker.postMessage({ type, id, history, depth, timeLimit: timeLimit | 0 });
        const d = await p;
        if (d === null) return null;
        if (d.error) { console.warn('Worker エラー、同期探索に切替:', d.error); return undefined; }
        return d;
    }

    return {
        cancel() { kill(); },
        think: (depth, timeLimit) => request('think', depth, timeLimit),
        analyze: (depth, timeLimit) => request('analyze', depth, timeLimit),
        // 事前に Worker を温めておく（初回の WASM 読み込み待ちを減らす）
        warmup() { if (workerUsable()) start().catch(() => {}); },
    };
})();

// 経過秒数つきの「考え中」表示。stop() で止める。
function formatTimeLimit(ms) {
    if (!ms) return '無制限';
    return ms >= 60000 ? `${Math.round(ms / 60000)}分` : `${Math.round(ms / 1000)}秒`;
}

// UIの時間制限セレクト(ms)を読む。0 = 無制限
function getTimeLimitMs(selectId) {
    const el = document.getElementById(selectId);
    const v = el ? parseInt(el.value) : 0;
    return isNaN(v) ? 0 : v;
}

// 時間制限セレクトの選択を記憶（使えない環境では何もしない）
['ai-time-limit', 'analysis-time-limit'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
        const saved = localStorage.getItem(id);
        if (saved !== null && [...el.options].some(o => o.value === saved)) el.value = saved;
    } catch (e) {}
    el.addEventListener('change', () => { try { localStorage.setItem(id, el.value); } catch (e) {} });
});

function startThinkingTicker(baseText, limitMs) {
    const el = document.getElementById('turn-indicator');
    const t0 = Date.now();
    const limitText = limitMs ? ` / 上限${formatTimeLimit(limitMs)}` : '';
    const tick = () => {
        if (!el) return;
        const sec = Math.floor((Date.now() - t0) / 1000);
        el.textContent = sec >= 1 ? `${baseText} ${sec}秒${limitText}` : baseText;
    };
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
}

// AIに1手指させる。メイン盤面に反映した上で 1(成功) / 0(指し手なし) / -1(中断) を返す。
// 成功時は Engine._engine_getLastMove*() で従来どおり指し手を読める。
async function aiPlay(depth) {
    const el = document.getElementById('turn-indicator');
    const limitMs = getTimeLimitMs('ai-time-limit');
    const stop = startThinkingTicker(el ? el.textContent : '', limitMs);
    try {
        const r = await AIClient.think(depth, limitMs);
        if (r === null) return -1;
        if (r === undefined) {
            // フォールバック：メインスレッドで同期探索
            await new Promise(res => setTimeout(res, 10));
            if (typeof Engine._engine_setTimeLimit === 'function') Engine._engine_setTimeLimit(limitMs);
            return Engine._engine_playAI(depth);
        }
        if (!r.ok) return 0;
        return Engine._engine_playRaw(r.raw, r.score) ? 1 : 0;
    } finally {
        stop();
    }
}
