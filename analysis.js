// ===== 棋譜解析（ぴよ将棋風）engine_analyze 版 =====
let analysisData = [];
let analyzing = false;
let cur_matchRate = { white: 0, black: 0 };
let lastMatchRate = { sente: null, gote: null };

const MATE_THRESHOLD = 80000; // これ以上は詰みスコア扱い


const LABEL = {
    BEST:      { name: '最善',  cls: 'lbl-best', max: 0 },
    GOOD:      { name: '好手',  cls: 'lbl-good', max: 30 },
    OK:        { name: '',      cls: 'lbl-ok',   max: 80 },
    INACCURACY:{ name: '緩手',  cls: 'lbl-inac', max: 200 },
    MISTAKE:   { name: '疑問手', cls: 'lbl-mist', max: 500 },
    BLUNDER:   { name: '悪手',  cls: 'lbl-blun', max: Infinity }
};

function classifyLoss(lossCp) {
    if (lossCp <= LABEL.BEST.max)       return LABEL.BEST;
    if (lossCp <= LABEL.GOOD.max)       return LABEL.GOOD;
    if (lossCp <= LABEL.OK.max)         return LABEL.OK;
    if (lossCp <= LABEL.INACCURACY.max) return LABEL.INACCURACY;
    if (lossCp <= LABEL.MISTAKE.max)    return LABEL.MISTAKE;
    return LABEL.BLUNDER;
}

// ★詰み探索/防御フラグを安全に読む（関数が存在すれば呼ぶ）
function readMateInfo() {
    const g = (name) => (typeof Engine[name] === 'function' ? Engine[name]() : 0);
    return {
        mateSearchRan:    g('_engine_getAnalyzeMateSearchRan'),
        mateFound:        g('_engine_getAnalyzeMateFound'),
        mateLen:          g('_engine_getAnalyzeMateLen'),
        defenseSearchRan: g('_engine_getAnalyzeDefenseSearchRan'),
        defenseTriggered: g('_engine_getAnalyzeDefenseTriggered'),
        defenseFound:     g('_engine_getAnalyzeDefenseFound'),
    };
}

// ★保存用：詰み探索/防御を短いテキストにする
// 例: "詰み5手", "必至", "詰めろ回避", "詰み3手/詰めろ回避"
function mateNoteFromInfo(mi) {
    if (!mi) return '';
    const parts = [];
    if (mi.mateFound) {
        parts.push(mi.mateLen > 0 ? `詰み${mi.mateLen}手` : '詰みあり');
    }
    if (mi.defenseTriggered) {
        parts.push(mi.defenseFound ? '詰めろ回避' : '必至');
    }
    return parts.join('/');
}

// 現在のエンジン局面を「指さずに」解析する（engine_analyze 使用）
function analyzeCurrentPosition(depth) {
    const side = Engine._engine_getSideToMove();
    const scoreStm = Engine._engine_analyze(depth); // 手番側視点（詰み探索の汚染なし）

    // ★analyze 直後にフラグを読む（次の呼び出しで上書きされる前に）
    const mateInfo = readMateInfo();

    const from   = Engine._engine_getAnalyzeBestFrom();
    const to     = Engine._engine_getAnalyzeBestTo();
    const isDrop = Engine._engine_getAnalyzeBestIsDrop();
    const dropPt = Engine._engine_getAnalyzeBestDropPiece();

    let bestMove = null;
    if (to >= 0) {
        bestMove = isDrop
            ? formatMove(-1, to, dropPt)
            : formatMove(from, to, null);
    }

    // ★候補手（上位手とスコア）を取得
    const cands = [];
    const cn = Engine._engine_getCandCount();
    for (let k = 0; k < cn && k < 3; k++) {   // 上位3手
        const cFrom  = Engine._engine_getCandFrom(k);
        const cTo    = Engine._engine_getCandTo(k);
        const cIsDrop= Engine._engine_getCandIsDrop(k);
        const cDrop  = Engine._engine_getCandDropPiece(k);
        const cScore = Engine._engine_getCandScore(k);
        if (cTo < 0) continue;
        const mv = cIsDrop ? formatMove(-1, cTo, cDrop) : formatMove(cFrom, cTo, null);
        cands.push({ move: mv, score: cScore });  // score は手番側視点
    }

    return { side, scoreStm, bestMove, cands, mateInfo };
}

async function analyzeKifu(depth) {
    if (analyzing) return;
    if (moveHistory.length === 0) { alert('解析する棋譜がありません'); return; }
    analyzing = true;
    document.getElementById('analyze-btn').disabled = true;

    const savedMoves = moveHistory.slice();
    analysisData = [];
    const progressEl = document.getElementById('analysis-progress');
    const total = moveHistory.length;

    for (let i = 0; i <= total; i++) {
        restoreEngineToPosition(i);

        const a = analyzeCurrentPosition(depth);
        const scoreSente = (a.side === 0) ? a.scoreStm : -a.scoreStm;

        analysisData.push({
            ply: i,
            side: a.side,
            scoreStm: a.scoreStm,
            scoreSente: scoreSente,
            bestMove: a.bestMove,
            actualMove: (i < total) ? moveHistory[i].move : null,
            cands: a.cands,                          // 候補手
            mateInfo: a.mateInfo,                    // 詰み探索/防御情報（生フラグ）
            mateNote: mateNoteFromInfo(a.mateInfo)   // ★保存用の整形テキスト
        });

        if (progressEl) progressEl.textContent = `解析中... ${i}/${total}`;
        await new Promise(r => setTimeout(r, 0));
    }

    let matchCount = { 0: 0, 1: 0 }, moveCount = { 0: 0, 1: 0 };

    for (let i = 0; i < total; i++) {
        const cur = analysisData[i];      // i手目を指す局面（手番 = cur.side）
        const next = analysisData[i + 1]; // i手目を指した直後

        const sign = (cur.side === 0) ? 1 : -1;
        // cur.scoreSente = この局面で「最善手」を指したときの評価（先手視点）
        // next.scoreSente = 実際の手を指した後の評価（先手視点）
        const bestForMover  = sign * cur.scoreSente;   // 最善を指した結果
        const afterForMover = sign * next.scoreSente;  // 実際に指した結果

        let loss = Math.max(0, bestForMover - afterForMover);

        // ★実際の手が第一候補（最善）と一致するなら loss=0
        if (cur.cands && cur.cands.length > 0 && cur.actualMove === cur.cands[0].move) {
            loss = 0;
        }
        // bestMove とも一致判定（保険）
        if (cur.bestMove && cur.actualMove === cur.bestMove) {
            loss = 0;
        }

        cur.loss = loss;
        cur.label = classifyLoss(loss);

        // 詰みが絡む局面はラベルを抑制
        if (Math.abs(cur.scoreSente) > MATE_THRESHOLD ||
            Math.abs(next.scoreSente) > MATE_THRESHOLD) {
            cur.label = LABEL.OK;
            cur.loss = 0;
        }

        const mover = cur.side;
        moveCount[mover]++;
        if (cur.bestMove && cur.actualMove === cur.bestMove) {
            cur.matched = true;
            matchCount[mover]++;
        } else {
            cur.matched = false;
        }
    }

    cur_matchRate = {
        white: moveCount[0] ? Math.round(matchCount[0] / moveCount[0] * 100) : 0,
        black: moveCount[1] ? Math.round(matchCount[1] / moveCount[1] * 100) : 0
    };

    // ★保存/表示用にマッチ率を lastMatchRate にも反映
    lastMatchRate = { sente: cur_matchRate.white, gote: cur_matchRate.black };

    restoreEngineToPosition(savedMoves.length);
    moveHistory = savedMoves;
    replayPosition = savedBoardStates.length - 1;

    analyzing = false;
    document.getElementById('analyze-btn').disabled = false;
    if (progressEl) progressEl.textContent = '解析完了';
    renderAnalysis();
    renderEvalGraph();
}

function fmtScore(s) {
    if (s > MATE_THRESHOLD)  return '+詰';
    if (s < -MATE_THRESHOLD) return '-詰';
    return (s > 0 ? '+' : '') + s;
}

// ★詰み探索/防御をアイコン付きテキストタグに整形（画面表示用）
function fmtMateTag(d) {
    if (!d || !d.mateInfo) return '';
    const mi = d.mateInfo;
    let tag = '';
    if (mi.mateFound) {
        tag += ` 🗡️詰み${mi.mateLen > 0 ? `${mi.mateLen}手` : ''}`;
    }
    if (mi.defenseTriggered) {
        tag += mi.defenseFound ? ' 🛡️詰めろ回避' : ' 💀必至';
    }
    return tag;
}

function renderAnalysis() {
    const entries = document.querySelectorAll('.move-entry');
    entries.forEach((entry, i) => {
        const d = analysisData[i];
        if (!d) return;

        // ★既存の注釈を削除（二重表示防止）
        const old = entry.querySelector('.anno');
        if (old) old.remove();

        // ★詰み/必至タグは「その手を指した後の局面」= analysisData[i+1] を使う
        const dAfter = analysisData[i + 1] || null;

        const anno = document.createElement('span');
        anno.className = 'anno ' + d.label.cls;
        anno.textContent = ` ${fmtScore(d.scoreSente)}` +
            (d.label.name ? ` ${d.label.name}` : '') +
            (d.matched ? '' : (d.bestMove ? ` (最善:${d.bestMove})` : '')) +
            fmtMateTag(dAfter) +      // ★指した後の詰み状況（i+1）
            fmtCands(d);
        entry.appendChild(anno);
    });
}

// 候補手を「 候補1. d6d5 -90 2. f7g7 -85 3. c7d5 -80」の形に整形
function fmtCands(d) {
    if (!d.cands || d.cands.length === 0) return '';
    // 全候補が詰みスコア（完全に詰んでいる決着局面）なら表示しない
    if (d.cands.every(c => Math.abs(c.score) > MATE_THRESHOLD)) {
        return '';
    }
    const sign = (d.side === 0) ? 1 : -1;
    const parts = d.cands.slice(0, 3).map((c, k) =>
        `${k + 1}. ${c.move} ${fmtScore(sign * c.score)}`
    );
    return ' 候補' + parts.join(' ');
}

function renderEvalGraph() {
  const canvas = document.getElementById('eval-graph');
  if (!canvas) return;

  // ★内部解像度を実表示サイズに同期（縮小表示によるズレ&にじみ防止）
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.round(rect.width  * dpr);
  const needH = Math.round(rect.height * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width  = needW;
    canvas.height = needH;
  }

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const n = analysisData.length;
  if (n < 2) return;

  // ▼ 上下分割：上70%を評価値、下30%をloss棒グラフに
  const EVAL_H = H * 0.7;   // 評価値エリアの高さ
  const LOSS_H = H - EVAL_H; // loss エリアの高さ
  const EVAL_MID = EVAL_H / 2;

  const CLAMP = 3000;  // ★広げた（大駒得くらいでは張り付かない）
  const evalToY = (s) => {
    if (s > MATE_THRESHOLD) s = CLAMP;
    else if (s < -MATE_THRESHOLD) s = -CLAMP;
    else s = Math.max(-CLAMP, Math.min(CLAMP, s));
    return EVAL_MID - (s / CLAMP) * EVAL_MID;
  };

  // 中央線
  ctx.strokeStyle = '#888';
  ctx.beginPath(); ctx.moveTo(0, EVAL_MID); ctx.lineTo(W, EVAL_MID); ctx.stroke();

  // 評価値の折れ線
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const y = evalToY(analysisData[i].scoreSente);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ▼ 詰み探索/防御マーカー（loss棒と同じ「指した後」の位置に揃える）
  for (let i = 0; i < n; i++) {
    const d = analysisData[i];
    if (!d || !d.mateInfo) continue;
    const mi = d.mateInfo;
    const x = (i / (n - 1)) * W;          // ★ i+1 をやめて局面iの位置に戻す
    const y = evalToY(d.scoreSente);

    if (mi.mateFound) {              // 詰み発見 → 赤い菱形
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
    }
    if (mi.defenseTriggered) {       // 詰めろ検知 → 受けあり=青塗り / 必至=オレンジ白抜き
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      if (mi.defenseFound) {
        ctx.fillStyle = '#40c4ff';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#ff8f00';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // ▼ 下段：loss 棒グラフ
  const LOSS_CLAMP = 800; // 800cp以上の損は同じ高さで頭打ち
  const barW = Math.max(1, W / n * 0.7);
  for (let i = 0; i < n; i++) {
    const d = analysisData[i];
    if (!d || !d.loss) continue;
    const markIdx = Math.min(i + 1, n - 1);   // ★指した"後"の位置に寄せる
    const x = (markIdx / (n - 1)) * W;
    const h = Math.min(d.loss, LOSS_CLAMP) / LOSS_CLAMP * LOSS_H;
    // 悪手=赤 / 疑問手=オレンジ / それ以外=薄い色
    ctx.fillStyle = (d.label.cls === 'lbl-blun') ? '#ff3b30'
                  : (d.label.cls === 'lbl-mist') ? '#ffab40'
                  : 'rgba(255,255,255,0.15)';
    ctx.fillRect(x - barW/2, H - h, barW, h); // canvasの一番下から上に伸ばす
  }

  // 上下の境界線
  ctx.strokeStyle = '#555';
  ctx.beginPath(); ctx.moveTo(0, EVAL_H); ctx.lineTo(W, EVAL_H); ctx.stroke();

  // 現在位置ライン
  const px = (replayPosition / (n - 1)) * W;
  ctx.strokeStyle = '#FF9800'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();

  renderCandidates(replayPosition);
}

// 指定局面の候補手パネルを描画
function renderCandidates(idx) {
    const panel = document.getElementById('candidate-panel');
    if (!panel) return;
    const d = analysisData[idx];

    if (!d || !d.cands || d.cands.length === 0) {
        // 候補手が無くても、詰み情報だけは出す
        if (d && d.mateInfo) {
            const tag = fmtMateTag(d).trim();
            if (tag) { panel.innerHTML = `<div class="cand-title">${tag}</div>`; return; }
        }
        panel.innerHTML = '<div class="cand-empty">候補手なし</div>';
        return;
    }

    // ★詰み探索/防御の見出しタグ
    let html = '';
    const mateTag = fmtMateTag(d).trim();
    if (mateTag) {
        html += `<div class="cand-title" style="color:#ffcc80;">${mateTag}</div>`;
    }

    // 手番側視点スコアを「先手視点」に揃えて表示（グラフと符号を統一）
    const sign = (d.side === 0) ? 1 : -1;
    html += '<div class="cand-title">候補手（' +
            (d.side === 0 ? '先手' : '後手') + '番）</div>';
    d.cands.forEach((c, i) => {
        const sente = sign * c.score;
        html += `<div class="cand-row"><span class="cand-move">${i + 1}. ${c.move}</span>` +
                `<span class="cand-score">${fmtScore(sente)}</span></div>`;
    });
    panel.innerHTML = html;
}

window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('analyze-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            const depth = parseInt(document.getElementById('analysis-depth').value);
            analyzeKifu(depth);
        });
    }

    // ★評価グラフをクリックして該当局面へジャンプ
    const canvas = document.getElementById('eval-graph');
    if (canvas) {
        canvas.style.cursor = 'pointer';
        canvas.addEventListener('click', (e) => {
            const n = analysisData.length;
            if (n < 2) return; // 解析前は何もしない

            // 表示が縮小されている場合に備え内部座標系へ補正
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);

            // renderEvalGraph と同じ等間隔換算の逆算で局面インデックス i を求める
            let i = Math.round((x / canvas.width) * (n - 1));
            i = Math.max(0, Math.min(n - 1, i));

            goToMove(i);       // 局面へジャンプ（内部で replayPosition も更新）
            renderEvalGraph(); // オレンジの現在位置ラインを更新
        });
    }
});
