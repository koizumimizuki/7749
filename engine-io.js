// Worker とメインスレッド（フォールバック）で共有する解析結果の読み出し処理
// E: ChaturangaEngine のインスタンス
function runAnalysis(E, depth) {
    const scoreStm = E._engine_analyze(depth);   // 手番側視点

    // analyze 直後にフラグを読む（次の呼び出しで上書きされる前に）
    const g = (name) => (typeof E[name] === 'function' ? E[name]() : 0);
    const mate = {
        mateSearchRan:    g('_engine_getAnalyzeMateSearchRan'),
        mateFound:        g('_engine_getAnalyzeMateFound'),
        mateLen:          g('_engine_getAnalyzeMateLen'),
        defenseSearchRan: g('_engine_getAnalyzeDefenseSearchRan'),
        defenseTriggered: g('_engine_getAnalyzeDefenseTriggered'),
        defenseFound:     g('_engine_getAnalyzeDefenseFound'),
    };

    const best = {
        from:   E._engine_getAnalyzeBestFrom(),
        to:     E._engine_getAnalyzeBestTo(),
        isDrop: E._engine_getAnalyzeBestIsDrop(),
        dropPt: E._engine_getAnalyzeBestDropPiece(),
    };

    const cands = [];
    const cn = E._engine_getCandCount();
    for (let k = 0; k < cn && k < 3; k++) {   // 上位3手
        cands.push({
            from:   E._engine_getCandFrom(k),
            to:     E._engine_getCandTo(k),
            isDrop: E._engine_getCandIsDrop(k),
            dropPt: E._engine_getCandDropPiece(k),
            score:  E._engine_getCandScore(k),
        });
    }
    return { scoreStm, mate, best, cands };
}
