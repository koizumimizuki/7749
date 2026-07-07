const PIECE_SYMBOLS = {
    1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '☆', 7: '♔',
    9: '♙', 10: '♘', 11: '♗', 12: '♖', 13: '♕',
    17: '♟', 18: '♞', 19: '♝', 20: '♜', 21: '♛', 22: '★', 23: '♚',
    25: '♟', 26: '♞', 27: '♝', 28: '♜', 29: '♛'
};

const HAND_SYMBOLS = {
    1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '☆'
};

const PIECE_NAMES = ['', 'P', 'N', 'B', 'R', 'Q', 'G', 'K'];
const HAND_PIECE_TYPES = [1, 2, 3, 4, 5, 6];

let Engine = null;
let selectedSquare = null;
let selectedHand = null;
let lastMove = { from: -1, to: -1 };
let moveHistory = [];
let gameOver = false;
let aiThinking = false;
let selfPlayRunning = false;
let selfPlayTimer = null;

// 棋譜再生用の変数
let replayMode = false;
let replayPosition = 0;
let savedBoardStates = []; // 各手の後の盤面状態を保存

// マス番号を文字列に変換 (例: 0 -> "a1", 48 -> "g7")
function squareToString(sq) {
    const col = sq % 7;
    const row = Math.floor(sq / 7);
    const colChar = String.fromCharCode('a'.charCodeAt(0) + col);
    const rowChar = (7 - row).toString();
    return colChar + rowChar;
}

function getGameMode() {
    const radio = document.querySelector('input[name="game-mode"]:checked');
    return radio ? radio.value : 'pvp';
}

function getAIDepth(side) {
    if (side === 0) {
        return parseInt(document.getElementById('ai-depth-white').value);
    } else {
        return parseInt(document.getElementById('ai-depth-black').value);
    }
}

function getSelfPlaySpeed() {
    return parseInt(document.getElementById('self-play-speed').value);
}

function isAITurn() {
    if (gameOver || aiThinking || replayMode) return false;
    const mode = getGameMode();
    const side = Engine._engine_getSideToMove();
    if (mode === 'ai-white' && side === 0) return true;
    if (mode === 'ai-black' && side === 1) return true;
    if (mode === 'ai-vs-ai') return true;
    return false;
}

// 現在の盤面状態を取得（配列には追加しない）
function getBoardState() {
    const state = {
        board: [],
        whiteHand: [],
        blackHand: [],
        sideToMove: Engine._engine_getSideToMove(),
        ply: Engine._engine_getPly()
    };
    
    for (let sq = 0; sq < 49; sq++) {
        state.board.push(Engine._engine_getPiece(sq));
    }
    
    for (let pt of HAND_PIECE_TYPES) {
        state.whiteHand.push(Engine._engine_getHandCount(0, pt));
        state.blackHand.push(Engine._engine_getHandCount(1, pt));
    }
    
    return state;
}

// 現在の盤面状態を保存（配列に追加）
function saveBoardState() {
    const state = getBoardState();
    savedBoardStates.push(state);
    return state;
}

// 盤面状態を復元（表示のみ、エンジン状態は変更しない）
function displayBoardState(state) {
    const board = document.getElementById('board');
    board.innerHTML = '';
    
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            const sq = row * 7 + col;
            const cell = document.createElement('div');
            cell.className = 'cell ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
            cell.dataset.square = sq;
            
            const piece = state.board[sq];
            if (piece !== 0) {
                const span = document.createElement('span');
                span.className = 'piece';
                if (piece >= 17) {
                    span.classList.add('black-piece');
                } else {
                    span.classList.add('white-piece');
                }
                
                // 成り駒判定
                if ((piece >= 9 && piece <= 13) || (piece >= 25 && piece <= 29)) {
                    span.classList.add('promoted');
                }
                
                span.textContent = PIECE_SYMBOLS[piece] || '?';
                cell.appendChild(span);
            }
            
            board.appendChild(cell);
        }
    }
    
    // 持ち駒表示
    const whiteHandEl = document.getElementById('white-hand-pieces');
    const blackHandEl = document.getElementById('black-hand-pieces');
    whiteHandEl.innerHTML = '';
    blackHandEl.innerHTML = '';
    
    for (let i = 0; i < HAND_PIECE_TYPES.length; i++) {
        const pt = HAND_PIECE_TYPES[i];
        const whiteCount = state.whiteHand[i];
        const blackCount = state.blackHand[i];
        
        if (whiteCount > 0) {
            const span = document.createElement('span');
            span.className = 'hand-piece white-piece';
            span.textContent = HAND_SYMBOLS[pt] + (whiteCount > 1 ? ' x' + whiteCount : '');
            whiteHandEl.appendChild(span);
        }
        
        if (blackCount > 0) {
            const span = document.createElement('span');
            span.className = 'hand-piece black-piece';
            span.textContent = HAND_SYMBOLS[pt] + (blackCount > 1 ? ' x' + blackCount : '');
            blackHandEl.appendChild(span);
        }
    }
    
    // 手番表示
    const turnEl = document.getElementById('turn-indicator');
    turnEl.textContent = (state.sideToMove === 0 ? '先手' : '後手') + 'の番';
    
    // 手数表示
    document.getElementById('move-count').textContent = '手数: ' + state.ply;
}

// 棋譜再生：指定位置へ移動
function goToMove(position) {
    if (position < 0 || position >= savedBoardStates.length) return;

    replayPosition = position;
    replayMode = true;

    // 最終局面以外なら gameOver を解除
    if (position < savedBoardStates.length - 1) {
        gameOver = false;
    }

    displayBoardState(savedBoardStates[position]);
    updateKifuHighlight();
    updateReplayControls();

    const turnEl = document.getElementById('turn-indicator');
    turnEl.textContent = '再生モード (' + position + '/' + (savedBoardStates.length - 1) + ')';
    turnEl.classList.add('replay');

    // ★追加：解析グラフがあれば現在位置ラインを連動更新
    if (typeof renderEvalGraph === 'function') renderEvalGraph();
}

// 再生モードを終了
function exitReplayMode() {
    replayMode = false;
    replayPosition = savedBoardStates.length - 1;
    renderBoard();
    updateInfo();
    updateKifuHighlight();
    updateReplayControls();
}

// 棋譜ハイライト更新
function updateKifuHighlight() {
    const entries = document.querySelectorAll('.move-entry');
    entries.forEach((entry, index) => {
        entry.classList.remove('current', 'future');
        if (index === replayPosition - 1) {
            entry.classList.add('current');
        } else if (index >= replayPosition) {
            entry.classList.add('future');
        }
    });
    
    // 位置表示更新
    const posEl = document.getElementById('kifu-position');
    if (posEl) {
        posEl.textContent = replayPosition + '/' + (savedBoardStates.length - 1);
    }
}

// 再生コントロール更新
function updateReplayControls() {
    const startBtn = document.getElementById('kifu-start');
    const prevBtn = document.getElementById('kifu-prev');
    const nextBtn = document.getElementById('kifu-next');
    const endBtn = document.getElementById('kifu-end');
    
    if (startBtn) startBtn.disabled = replayPosition <= 0;
    if (prevBtn) prevBtn.disabled = replayPosition <= 0;
    if (nextBtn) nextBtn.disabled = replayPosition >= savedBoardStates.length - 1;
    if (endBtn) endBtn.disabled = replayPosition >= savedBoardStates.length - 1;
}

// 棋譜表示（クリック可能）
function renderKifu() {
    const list = document.getElementById('kifu-list');
    list.innerHTML = '';
    
    for (let i = 0; i < moveHistory.length; i++) {
        const moveNum = i + 1;
        const side = moveHistory[i].side === 0 ? '先手' : '後手';
        
        const span = document.createElement('span');
        span.className = 'move-entry ' + (moveHistory[i].side === 0 ? 'white' : 'black');
        span.textContent = moveNum + '.' + side + ' ' + moveHistory[i].move;
        span.dataset.moveIndex = i;
        
        // クリックで該当局面へジャンプ
        span.addEventListener('click', () => {
            goToMove(i + 1);
        });
        
        list.appendChild(span);
    }
    
    list.scrollTop = list.scrollHeight;
    updateKifuHighlight();
    updateReplayControls();
}

function getKifuText() {
    const mode = getGameMode();
    let text = '7x7チャトランガ 棋譜\n';
    text += '日時: ' + new Date().toLocaleString() + '\n';
    text += 'モード: ' + mode + '\n';
    if (mode === 'ai-vs-ai' || mode === 'ai-white') {
        text += '先手AI: レベル' + getAIDepth(0) + '\n';
    }
    if (mode === 'ai-vs-ai' || mode === 'ai-black') {
        text += '後手AI: レベル' + getAIDepth(1) + '\n';
    }
    text += '---\n';
    
    for (let i = 0; i < moveHistory.length; i++) {
        const moveNum = i + 1;
        const side = moveHistory[i].side === 0 ? '先手' : '後手';
        text += moveNum + '.' + side + ' ' + moveHistory[i].move + '\n';
    }
    
    if (gameOver) {
        text += '---\n';
        text += document.getElementById('status').textContent + '\n';
    }
    
    return text;
}

// 棋譜読み込み
function loadKifu(text) {
    // JSON形式（解析込み）かどうか判定
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(trimmed);
            if (obj.format === 'chaturanga-kifu') {
                loadKifuJson(obj);
                return;
            }
        } catch (e) {
            console.error('JSON parse failed, falling back to text:', e);
        }
    }
    const lines = text.split('\n');
    const moves = [];
    
    for (const line of lines) {
        // WebUI形式: "1.先手 f2f3" または "1.後手 B*d4"
        let match = line.match(/^\d+\.(先手|後手)\s+(\S+)/);
        if (match) {
            moves.push({
                side: match[1] === '先手' ? 0 : 1,
                move: match[2]
            });
            continue;
        }
        
        // CUI形式: "1.White f2f3" または "2.Black B*d4"
        match = line.match(/^\d+\.(White|Black)\s+(\S+)/i);
        if (match) {
            moves.push({
                side: match[1].toLowerCase() === 'white' ? 0 : 1,
                move: match[2]
            });
            continue;
        }
    }
    
    if (moves.length === 0) {
        alert('有効な棋譜が見つかりませんでした');
        return false;
    }
    
    // リセットして棋譜を再生
    Engine._engine_reset();
    moveHistory = [];
    savedBoardStates = [];
    gameOver = false;
    replayMode = false;
    replayPosition = 0;
    
    // 初期局面を保存
    savedBoardStates.push(getBoardState());
    
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        if (!applyMoveFromString(move.move)) {
            alert('棋譜の再生中にエラーが発生しました: ' + move.move);
            break;
        }
        
        // plyを正しく設定
        moveHistory.push({
            ply: i + 1,
            side: move.side,
            move: move.move
        });
        
        // 盤面状態を保存
        savedBoardStates.push(getBoardState());
    }
    
    replayPosition = savedBoardStates.length - 1;
    renderBoard();
    renderHands();
    updateInfo();
    renderKifu();
    updateReplayControls();
    checkGameEnd();
    
    return true;
}

function loadKifuJson(obj) {
    Engine._engine_reset();
    moveHistory = [];
    savedBoardStates = [saveBoardState()];
    gameOver = false;
    replayMode = false;
    replayPosition = 0;

    const moves = obj.moves || [];
    for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];
        if (!applyMoveFromString(mv.move)) {
            console.error('Failed to replay move:', mv.move);
            alert('棋譜の再生に失敗しました: ' + mv.move);
            break;
        }
        moveHistory.push({ ply: i + 1, side: mv.side, move: mv.move });
        saveBoardState();
    }

    replayPosition = savedBoardStates.length - 1;
    gameOver = !!obj.gameOver;

    // 解析データの復元
    if (obj.analysis && Array.isArray(obj.analysis.data)) {
        analysisData = obj.analysis.data;
        if (typeof lastMatchRate !== 'undefined' && obj.analysis.matchRate) {
            lastMatchRate = obj.analysis.matchRate;
        }
    } else {
        analysisData = [];
    }

    renderBoard();
    renderKifu();

    // 解析表示を復元（関数が存在すれば）
    if (analysisData.length > 0) {
        if (typeof renderAnalysis === 'function') renderAnalysis();
        if (typeof renderEvalGraph === 'function') renderEvalGraph();
    }
}

// 棋譜文字列から手を適用
function applyMoveFromString(moveStr) {
    console.log('applyMoveFromString:', moveStr);
    
    // 駒打ち: "B*d4" の形式
    const dropMatch = moveStr.match(/^([PNBRQG])\*([a-g])([1-7])$/i);
    if (dropMatch) {
        const pieceChar = dropMatch[1].toUpperCase();
        const col = dropMatch[2].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
        const row = 7 - parseInt(dropMatch[3]);  // 反転
        const to = row * 7 + col;
        
        console.log('Drop:', pieceChar, 'col:', col, 'row:', row, 'to:', to);
        
        const pieceType = PIECE_NAMES.indexOf(pieceChar);
        if (pieceType <= 0) {
            console.log('Invalid pieceType:', pieceType);
            return false;
        }
        
        const numMoves = Engine._engine_generateMoves();
        console.log('numMoves:', numMoves);
        
        for (let i = 0; i < numMoves; i++) {
            const mTo = Engine._engine_getMoveTo(i);
            const mFrom = Engine._engine_getMoveFrom(i);
            const mIsDrop = Engine._engine_getMoveIsDrop(i);
            const mDropPt = Engine._engine_getMoveDropPieceType(i);
            
            if (mIsDrop && mTo === to && mDropPt === pieceType) {
                console.log('Found drop move at index:', i);
                if (Engine._engine_makeMove(i)) {
                    return true;
                }
            }
        }
        console.log('Drop move not found');
        return false;
    }
    
    // 通常の移動: "f2f3" または "f2f3+" の形式
    const moveMatch = moveStr.match(/^([a-g])([1-7])([a-g])([1-7])(\+?)$/i);
    if (moveMatch) {
        const fromCol = moveMatch[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
        const fromRow = 7 - parseInt(moveMatch[2]);  // 反転
        const toCol = moveMatch[3].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
        const toRow = 7 - parseInt(moveMatch[4]);    // 反転
        const from = fromRow * 7 + fromCol;
        const to = toRow * 7 + toCol;
        
        console.log('Move:', moveStr, 'from:', from, '(col:', fromCol, 'row:', fromRow, ') to:', to, '(col:', toCol, 'row:', toRow, ')');
        
        if (Engine._engine_makeMoveFromTo(from, to)) {
            console.log('Move success');
            return true;
        }
        console.log('Move failed');
    }
    
    console.log('No match for:', moveStr);
    return false;
}


async function initEngine() {
    try {
        Engine = await ChaturangaEngine();
        Engine._engine_init();
        
        // 初期局面を保存
        savedBoardStates = [saveBoardState()];
        replayPosition = 0;
        
        renderBoard();
        updateInfo();
        setupEventListeners();
        updateReplayControls();
        console.log('Engine initialized');
    } catch (e) {
        console.error('Engine initialization failed:', e);
        document.getElementById('turn-indicator').textContent = 'エンジン初期化エラー';
    }
}

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';
    
    // 選択中の駒の移動可能マスを取得
    let movableSquares = new Set();
    
    if (selectedSquare !== null) {
        for (let to = 0; to < 49; to++) {
            if (Engine._engine_canMoveTo(selectedSquare, to)) {
                movableSquares.add(to);
            }
        }
    } else if (selectedHand !== null) {
        // 持ち駒の場合、合法手から該当する駒打ちを探す
        const numMoves = Engine._engine_generateMoves();
        for (let i = 0; i < numMoves; i++) {
            if (Engine._engine_getMoveIsDrop(i)) {
                const dropPt = Engine._engine_getMoveDropPieceType(i);
                if (dropPt === selectedHand.pieceType) {
                    const to = Engine._engine_getMoveTo(i);
                    movableSquares.add(to);
                }
            }
        }
    }
    
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            const sq = row * 7 + col;
            const cell = document.createElement('div');
            cell.className = 'cell ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
            cell.dataset.square = sq;
            
            if (sq === lastMove.from || sq === lastMove.to) {
                cell.classList.add('last-move');
            }
            
            if (sq === selectedSquare) {
                cell.classList.add('selected');
            }
            
            // 移動可能なマスをハイライト
            if (movableSquares.has(sq)) {
                cell.classList.add('movable');
                const piece = Engine._engine_getPiece(sq);
                if (piece !== 0) {
                    cell.classList.add('has-enemy');
                }
            }
            
            const piece = Engine._engine_getPiece(sq);
            if (piece !== 0) {
                const span = document.createElement('span');
                span.className = 'piece';
                if (piece >= 17) {
                    span.classList.add('black-piece');
                } else {
                    span.classList.add('white-piece');
                }
                
                // 成り駒判定（9-13が先手成り、25-29が後手成り）
                if ((piece >= 9 && piece <= 13) || (piece >= 25 && piece <= 29)) {
                    span.classList.add('promoted');
                }
                
                span.textContent = PIECE_SYMBOLS[piece] || '?';
                cell.appendChild(span);
            }
            
            board.appendChild(cell);
        }
    }
    
    renderHands();
}


function renderHands() {
    const whiteHand = document.getElementById('white-hand-pieces');
    const blackHand = document.getElementById('black-hand-pieces');
    whiteHand.innerHTML = '';
    blackHand.innerHTML = '';
    
    for (let pt of HAND_PIECE_TYPES) {
        const whiteCount = Engine._engine_getHandCount(0, pt);
        const blackCount = Engine._engine_getHandCount(1, pt);
        
        if (whiteCount > 0) {
            const span = document.createElement('span');
            span.className = 'hand-piece white-piece';
            span.dataset.pieceType = pt;
            span.dataset.color = 0;
            span.textContent = HAND_SYMBOLS[pt] + (whiteCount > 1 ? ' x' + whiteCount : '');
            if (selectedHand && selectedHand.color === 0 && selectedHand.pieceType === pt) {
                span.classList.add('selected');
            }
            whiteHand.appendChild(span);
        }
        
        if (blackCount > 0) {
            const span = document.createElement('span');
            span.className = 'hand-piece black-piece';
            span.dataset.pieceType = pt;
            span.dataset.color = 1;
            span.textContent = HAND_SYMBOLS[pt] + (blackCount > 1 ? ' x' + blackCount : '');
            if (selectedHand && selectedHand.color === 1 && selectedHand.pieceType === pt) {
                span.classList.add('selected');
            }
            blackHand.appendChild(span);
        }
    }
}

function updateInfo() {
    const side = Engine._engine_getSideToMove();
    const turnEl = document.getElementById('turn-indicator');
    
    if (replayMode) {
        turnEl.textContent = '棋譜再生中 (' + (side === 0 ? '先手' : '後手') + 'の番)';
        turnEl.classList.add('replay');
    } else {
        turnEl.textContent = (side === 0 ? '先手' : '後手') + 'の番';
        turnEl.classList.remove('replay');
    }
    
    const ply = Engine._engine_getPly();
    document.getElementById('move-count').textContent = '手数: ' + ply;
    
    if (Engine._engine_isInCheck()) {
        document.getElementById('status').textContent = '王手！';
    } else {
        document.getElementById('status').textContent = '';
    }
}

function checkGameEnd() {
    const isCheckmate = Engine._engine_isCheckmate();
    const isStalemate = Engine._engine_isStalemate();
    const isDraw = Engine._engine_isDraw();
    
    console.log('checkGameEnd:', { isCheckmate, isStalemate, isDraw });
    
    if (isCheckmate !== 0) {
        const winner = Engine._engine_getSideToMove() === 0 ? '後手' : '先手';
        console.log('Checkmate detected! Winner:', winner);
        
        const statusEl = document.getElementById('status');
        const turnEl = document.getElementById('turn-indicator');
        
        statusEl.textContent = '🎉 チェックメイト！ ' + winner + 'の勝ち！';
        statusEl.classList.add('winner');
        turnEl.textContent = 'ゲーム終了';
        
        gameOver = true;
        console.log('gameOver set to:', gameOver);
        return true;
    }
    if (isStalemate !== 0) {
        const statusEl = document.getElementById('status');
        const turnEl = document.getElementById('turn-indicator');
        statusEl.textContent = 'ステイルメイト - 引き分け';
        turnEl.textContent = 'ゲーム終了';
        gameOver = true;
        return true;
    }
    if (isDraw !== 0) {
        const statusEl = document.getElementById('status');
        const turnEl = document.getElementById('turn-indicator');
        statusEl.textContent = '引き分け';
        turnEl.textContent = 'ゲーム終了';
        gameOver = true;
        return true;
    }
    return false;
}

function formatMove(from, to, dropPieceType) {
    const toCol = String.fromCharCode('a'.charCodeAt(0) + (to % 7));
    const toRow = 7 - Math.floor(to / 7);
    
    if (dropPieceType !== null) {
        return PIECE_NAMES[dropPieceType] + '*' + toCol + toRow;
    }
    
    const fromCol = String.fromCharCode('a'.charCodeAt(0) + (from % 7));
    const fromRow = 7 - Math.floor(from / 7);
    return fromCol + fromRow + toCol + toRow;
}

function handleCellClick(sq) {
    console.log('handleCellClick called:', sq, 'replayMode:', replayMode, 'gameOver:', gameOver);
    
    if (gameOver || aiThinking || replayMode) return;
    
    const mode = getGameMode();
    const side = Engine._engine_getSideToMove();
    
    if (mode === 'ai-vs-ai') return;
    if (mode === 'ai-white' && side === 0) return;
    if (mode === 'ai-black' && side === 1) return;
    
    const piece = Engine._engine_getPiece(sq);
    const isOwnPiece = (side === 0 && piece >= 1 && piece <= 15) ||
                       (side === 1 && piece >= 17 && piece <= 31);
    
    // 持ち駒が選択されている場合
    if (selectedHand) {
        const targetPiece = Engine._engine_getPiece(sq);
        
        // 空きマスにのみ打てる
        if (targetPiece === 0) {
            console.log('Trying to drop piece at', sq, 'pieceType:', selectedHand.pieceType);
            
            // 合法手を生成して、該当する駒打ちを探す
            const numMoves = Engine._engine_generateMoves();
            let dropMoveIndex = -1;
            
            for (let i = 0; i < numMoves; i++) {
                if (Engine._engine_getMoveIsDrop(i)) {
                    const to = Engine._engine_getMoveTo(i);
                    const dropPt = Engine._engine_getMoveDropPieceType(i);
                    if (to === sq && dropPt === selectedHand.pieceType) {
                        dropMoveIndex = i;
                        break;
                    }
                }
            }
            
            if (dropMoveIndex >= 0) {
                if (Engine._engine_makeMove(dropMoveIndex)) {
                    const ply = Engine._engine_getPly();
                    const moveSide = (ply % 2 === 0) ? 1 : 0;
                    moveHistory.push({
                        num: ply,
                        side: moveSide,
                        move: formatMove(-1, sq, selectedHand.pieceType)
                    });
                    saveBoardState();
                    replayPosition = savedBoardStates.length - 1;
                    
                    lastMove = { from: -1, to: sq };
                    selectedHand = null;
                    selectedSquare = null;
                    renderBoard();
                    renderKifu();
                    
                    if (checkGameEnd()) return;
                    updateInfo();
                    
                    if (isAITurn()) {
                        setTimeout(aiMove, 100);
                    }
                    return;
                }
            }
        }
        
        // 置けなかった場合、選択解除または別の駒を選択
        selectedHand = null;
        if (isOwnPiece) {
            selectedSquare = sq;
        }
        renderBoard();
        return;
    }
    
    // 盤上の駒が選択されている場合
    if (selectedSquare !== null) {
        if (selectedSquare === sq) {
            selectedSquare = null;
            renderBoard();
            return;
        }
        
        if (Engine._engine_canMoveTo(selectedSquare, sq)) {
            const from = selectedSquare;
            if (Engine._engine_makeMoveFromTo(from, sq)) {
                const ply = Engine._engine_getPly();
                const moveSide = (ply % 2 === 0) ? 1 : 0;
                moveHistory.push({
                    num: ply,
                    side: moveSide,
                    move: formatMove(from, sq, null)
                });
                saveBoardState();
                replayPosition = savedBoardStates.length - 1;
                
                lastMove = { from: from, to: sq };
                selectedSquare = null;
                renderBoard();
                renderKifu();
                
                if (checkGameEnd()) return;
                updateInfo();
                
                if (isAITurn()) {
                    setTimeout(aiMove, 100);
                }
                return;
            }
        }
        
        if (isOwnPiece) {
            selectedSquare = sq;
        } else {
            selectedSquare = null;
        }
        renderBoard();
        return;
    }
    
    // 何も選択されていない場合、自分の駒をクリックしたら選択
    if (isOwnPiece) {
        selectedSquare = sq;
        renderBoard();
    }
}


function handleHandClick(color, pieceType) {
    console.log('handleHandClick called:', color, pieceType);
    
    if (gameOver || aiThinking || replayMode) {
        console.log('blocked: gameOver=', gameOver, 'aiThinking=', aiThinking, 'replayMode=', replayMode);
        return;
    }
    
    const mode = getGameMode();
    const side = Engine._engine_getSideToMove();
    
    console.log('mode:', mode, 'side:', side, 'color:', color);
    
    if (mode === 'ai-vs-ai') return;
    if (mode === 'ai-white' && side === 0) return;
    if (mode === 'ai-black' && side === 1) return;
    
    if (color !== side) {
        console.log('not your piece');
        return;
    }
    
    selectedSquare = null;
    
    if (selectedHand && selectedHand.color === color && selectedHand.pieceType === pieceType) {
        selectedHand = null;
    } else {
        selectedHand = { color, pieceType };
    }
    
    console.log('selectedHand:', selectedHand);
    
    renderBoard();
}

async function aiMove() {
    if (gameOver || aiThinking || replayMode) return;
    
    aiThinking = true;
    const turnEl = document.getElementById('turn-indicator');
    turnEl.classList.add('thinking');
    turnEl.textContent = (Engine._engine_getSideToMove() === 0 ? '先手' : '後手') + 'AI思考中...';
    
    await new Promise(r => setTimeout(r, 10));
    
    const side = Engine._engine_getSideToMove();
    const depth = getAIDepth(side);
    const result = Engine._engine_playAI(depth);
    
    aiThinking = false;
    turnEl.classList.remove('thinking');
    
    if (result === 1) {
        const from = Engine._engine_getLastMoveFrom();
        const to = Engine._engine_getLastMoveTo();
        const isDrop = Engine._engine_getLastMoveIsDrop();
        const dropPt = Engine._engine_getLastMoveDropPiece();
        
        const ply = Engine._engine_getPly();
        const moveSide = (ply % 2 === 0) ? 1 : 0;
        const moveStr = isDrop ? formatMove(-1, to, dropPt) : formatMove(from, to, null);
        moveHistory.push({ num: ply, side: moveSide, move: moveStr });
        saveBoardState();
        replayPosition = savedBoardStates.length - 1;
        
        lastMove = { from: isDrop ? -1 : from, to: to };
        
        renderBoard();
        renderKifu();
        
        // checkGameEnd を先に呼ぶ
        if (checkGameEnd()) {
            // ゲーム終了
            return;
        }
        
        // ゲームが続く場合のみ updateInfo を呼ぶ
        updateInfo();
        
        if (isAITurn() && getGameMode() !== 'ai-vs-ai') {
            setTimeout(aiMove, 100);
        }
    }
}

function startSelfPlay() {
    if (selfPlayRunning) return;
    
    selfPlayRunning = true;
    document.getElementById('start-self-play').disabled = true;
    document.getElementById('stop-self-play').disabled = false;
    
    selfPlayStep();
}

function stopSelfPlay() {
    selfPlayRunning = false;
    if (selfPlayTimer) {
        clearTimeout(selfPlayTimer);
        selfPlayTimer = null;
    }
    document.getElementById('start-self-play').disabled = false;
    document.getElementById('stop-self-play').disabled = true;
    
    const turnEl = document.getElementById('turn-indicator');
    turnEl.classList.remove('thinking');
    
    // ゲーム終了時は updateInfo を呼ばない
    if (!gameOver) {
        updateInfo();
    }
}

async function selfPlayStep() {
    if (!selfPlayRunning || gameOver) {
        console.log('selfPlayStep stopped: running=' + selfPlayRunning + ', gameOver=' + gameOver);
        stopSelfPlay();
        return;
    }
    
    aiThinking = true;
    const turnEl = document.getElementById('turn-indicator');
    turnEl.classList.add('thinking');
    
    const side = Engine._engine_getSideToMove();
    turnEl.textContent = (side === 0 ? '先手' : '後手') + 'AI思考中';
    
    await new Promise(r => setTimeout(r, 10));
    
    const depth = getAIDepth(side);
    const result = Engine._engine_playAI(depth);
    
    aiThinking = false;
    turnEl.classList.remove('thinking');
    
    if (result === 1) {
        const from = Engine._engine_getLastMoveFrom();
        const to = Engine._engine_getLastMoveTo();
        const isDrop = Engine._engine_getLastMoveIsDrop();
        const dropPt = Engine._engine_getLastMoveDropPiece();
        
        const plyAfter = Engine._engine_getPly();
        const moveSide = (plyAfter % 2 === 0) ? 1 : 0;
        const moveStr = isDrop ? formatMove(-1, to, dropPt) : formatMove(from, to, null);
        moveHistory.push({ num: plyAfter, side: moveSide, move: moveStr });
        saveBoardState();
        replayPosition = savedBoardStates.length - 1;
        
        lastMove = { from: isDrop ? -1 : from, to: to };
        
        renderBoard();
        renderKifu();
        
        // ゲーム終了チェック（これより後に updateInfo を呼ばない）
        const ended = checkGameEnd();
        console.log('Game ended?', ended);
        
        if (ended) {
            stopSelfPlay();
            return;  // ここで終了、updateInfo は呼ばない
        }
        
        // ゲームが続く場合のみ
        updateInfo();
    } else {
        console.log('AI returned no move');
        stopSelfPlay();
        return;
    }
    
    const speed = getSelfPlaySpeed();
    selfPlayTimer = setTimeout(selfPlayStep, speed);
}

function resetGame() {
    if (selfPlayRunning) {
        stopSelfPlay();
    }
    
    Engine._engine_reset();
    selectedSquare = null;
    selectedHand = null;
    lastMove = { from: -1, to: -1 };
    moveHistory = [];
    savedBoardStates = [saveBoardState()];
    replayPosition = 0;
    replayMode = false;
    gameOver = false;
    aiThinking = false;
    
    renderBoard();
    updateInfo();
    renderKifu();
    updateReplayControls();
    
    if (isAITurn()) {
        setTimeout(aiMove, 100);
    }
}

function undoMove() {
    if (aiThinking || selfPlayRunning || replayMode) return;
    if (Engine._engine_getPly() === 0) return;
    
    Engine._engine_undoMove();
    
    if (moveHistory.length > 0) {
        moveHistory.pop();
        savedBoardStates.pop();
        replayPosition = savedBoardStates.length - 1;
    }
    
    const mode = getGameMode();
    if ((mode === 'ai-white' || mode === 'ai-black') && Engine._engine_getPly() > 0) {
        Engine._engine_undoMove();
        if (moveHistory.length > 0) {
            moveHistory.pop();
            savedBoardStates.pop();
            replayPosition = savedBoardStates.length - 1;
        }
    }
    
    selectedSquare = null;
    selectedHand = null;
    lastMove = { from: -1, to: -1 };
    gameOver = false;
    
    renderBoard();
    updateInfo();
    renderKifu();
}

function setupEventListeners() {
    document.getElementById('board').addEventListener('click', (e) => {
        const cell = e.target.closest('.cell');
        if (cell) {
            handleCellClick(parseInt(cell.dataset.square));
        }
    });
    
    document.getElementById('white-hand-pieces').addEventListener('click', (e) => {
        const hp = e.target.closest('.hand-piece');
        if (hp) {
            handleHandClick(parseInt(hp.dataset.color), parseInt(hp.dataset.pieceType));
        }
    });
    
    document.getElementById('black-hand-pieces').addEventListener('click', (e) => {
        const hp = e.target.closest('.hand-piece');
        if (hp) {
            handleHandClick(parseInt(hp.dataset.color), parseInt(hp.dataset.pieceType));
        }
    });
    
    document.getElementById('reset-btn').addEventListener('click', resetGame);
    document.getElementById('undo-btn').addEventListener('click', undoMove);
    
    document.querySelectorAll('input[name="game-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const mode = getGameMode();
            const selfPlayControls = document.getElementById('self-play-controls');
            
            if (mode === 'ai-vs-ai') {
                selfPlayControls.style.display = 'block';
            } else {
                selfPlayControls.style.display = 'none';
                if (selfPlayRunning) {
                    stopSelfPlay();
                }
            }
            
            // 再生モードを終了
            if (replayMode) {
                exitReplayMode();
            }
            
            if (isAITurn()) {
                setTimeout(aiMove, 100);
            }
        });
    });
    
    document.getElementById('start-self-play').addEventListener('click', startSelfPlay);
    document.getElementById('stop-self-play').addEventListener('click', stopSelfPlay);
    
    document.getElementById('copy-kifu-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(getKifuText()).then(() => {
            alert('棋譜をコピーしました');
        });
    });
    
    document.getElementById('download-kifu-btn').addEventListener('click', () => {
        const text = getKifuText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kifu_' + new Date().toISOString().slice(0, 10) + '.txt';
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('download-json-btn').addEventListener('click', () => {
        if (typeof analysisData === 'undefined' || !analysisData || analysisData.length === 0) {
            alert('先に「棋譜解析」を実行してください');
            return;
        }

        const obj = {
            format: 'chaturanga-kifu',
            version: 1,
            savedAt: new Date().toISOString(),
            mode: getGameMode(),
            gameOver: gameOver,
            moves: moveHistory.map(m => ({ side: m.side, move: m.move })),
            analysis: {
                matchRate: (typeof lastMatchRate !== 'undefined') ? lastMatchRate : null,
                // ★詰み関連のサマリー（必至・詰みN手が出た手だけ抜き出し）
                mateSummary: analysisData
                    .filter(d => d.mateNote)
                    .map(d => ({ ply: d.ply, side: d.side, note: d.mateNote })),
                data: analysisData
            }
        };

        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kifu_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });
    
    // 棋譜読み込み
    document.getElementById('load-kifu-btn').addEventListener('click', () => {
        document.getElementById('kifu-file-input').click();
    });
    
    document.getElementById('kifu-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                loadKifu(event.target.result);
            };
            reader.readAsText(file);
        }
        e.target.value = '';
    });
    
    // 棋譜ナビゲーション
    document.getElementById('kifu-start').addEventListener('click', () => {
        goToMove(0);
    });
    
    document.getElementById('kifu-prev').addEventListener('click', () => {
        goToMove(replayPosition - 1);
    });
    
    document.getElementById('kifu-next').addEventListener('click', () => {
        goToMove(replayPosition + 1);
    });
    
    document.getElementById('kifu-end').addEventListener('click', () => {
        goToMove(savedBoardStates.length - 1);
    });
    
    // AI思考ボタン
    document.getElementById('ai-think').addEventListener('click', aiThinkCurrentPosition);
    
    // 続行ボタン（この行を追加）
    document.getElementById('resume-from-here').addEventListener('click', resumeFromCurrentPosition);
    
    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch (e.key) {
            case 'ArrowLeft':
                goToMove(replayPosition - 1);
                e.preventDefault();
                break;
            case 'ArrowRight':
                goToMove(replayPosition + 1);
                e.preventDefault();
                break;
            case 'Home':
                goToMove(0);
                e.preventDefault();
                break;
            case 'End':
                goToMove(savedBoardStates.length - 1);
                e.preventDefault();
                break;
        }
    });
}

// エンジンの盤面を指定位置まで復元
function restoreEngineToPosition(position) {
    // エンジンをリセット
    Engine._engine_reset();
    
    // 指定位置まで手を再生
    for (let i = 0; i < position && i < moveHistory.length; i++) {
        const move = moveHistory[i];
        if (!applyMoveFromString(move.move)) {
            console.error('Failed to restore move:', move.move);
            return false;
        }
    }
    return true;
}

// AI思考機能（修正版）
function aiThinkCurrentPosition() {
    if (aiThinking) {
        alert('AIは既に思考中です');
        return;
    }
    
    // リプレイモード中なら、エンジンの盤面を復元
    if (replayMode) {
        const targetPosition = replayPosition;
        
        // エンジンの盤面を現在位置まで復元
        if (!restoreEngineToPosition(targetPosition)) {
            alert('盤面の復元に失敗しました');
            return;
        }
        
        // 現在位置より後の履歴を削除（targetPositionの局面は残す）
        moveHistory = moveHistory.slice(0, targetPosition);
        savedBoardStates = savedBoardStates.slice(0, targetPosition + 1);
        
        gameOver = false;
        replayMode = false;
        replayPosition = targetPosition;
        
        const turnEl = document.getElementById('turn-indicator');
        turnEl.classList.remove('replay');
    }
    
    if (gameOver) {
        alert('ゲームは終了しています');
        return;
    }
    
    // 合法手があるか確認
    const numMoves = Engine._engine_generateMoves();
    if (numMoves === 0) {
        alert('この局面には合法手がありません');
        return;
    }
    
    const side = Engine._engine_getSideToMove();
    const sideStr = side === 0 ? '先手' : '後手';
    
    console.log('AI思考開始:', sideStr);
    console.log('現在の履歴数:', moveHistory.length, '盤面数:', savedBoardStates.length);
    
    aiThinking = true;
    const turnEl = document.getElementById('turn-indicator');
    turnEl.textContent = sideStr + ' (AI思考中...)';
    turnEl.classList.add('thinking');
    
    setTimeout(() => {
        const depth = getAIDepth(side);
        console.log('AI depth:', depth);
        
        const result = Engine._engine_playAI(depth);
        
        if (result === 1) {
            const from = Engine._engine_getLastMoveFrom();
            const to = Engine._engine_getLastMoveTo();
            const isDrop = Engine._engine_getLastMoveIsDrop();
            const dropPt = Engine._engine_getLastMoveDropPiece();
            
            const ply = Engine._engine_getPly();
            const moveSide = (ply % 2 === 1) ? 0 : 1;
            
            let moveStr;
            if (isDrop) {
                moveStr = PIECE_NAMES[dropPt] + '*' + squareToString(to);
            } else {
                moveStr = squareToString(from) + squareToString(to);
            }
            
            // 履歴に追加
            moveHistory.push({
                ply: ply,
                side: moveSide,
                move: moveStr
            });
            
            // 盤面状態を保存（saveBoardStateは配列に追加する）
            saveBoardState();
            
            // リプレイ位置を最新に更新
            replayPosition = savedBoardStates.length - 1;
            
            console.log('AI思考後の履歴数:', moveHistory.length, '盤面数:', savedBoardStates.length);
            
            lastMove = { from: isDrop ? -1 : from, to: to };
            
            renderBoard();
            renderHands();
            renderKifu();
            updateReplayControls();
            
            if (checkGameEnd()) {
                aiThinking = false;
                turnEl.classList.remove('thinking');
                return;
            }
            
            updateInfo();
        } else {
            console.log('AI move failed');
            alert('AIが手を見つけられませんでした');
        }
        
        aiThinking = false;
        turnEl.classList.remove('thinking');
    }, 50);
}
// この局面から手動で続行
function resumeFromCurrentPosition() {
    if (!replayMode) {
        alert('再生モード中でないと使えません');
        return;
    }
    
    // エンジンの盤面を現在位置まで復元
    if (!restoreEngineToPosition(replayPosition)) {
        alert('盤面の復元に失敗しました');
        return;
    }
    
    // 現在位置より後の履歴を削除
    moveHistory = moveHistory.slice(0, replayPosition);
    savedBoardStates = savedBoardStates.slice(0, replayPosition + 1);
    gameOver = false;
    replayMode = false;
    replayPosition = savedBoardStates.length - 1;
    
    const turnEl = document.getElementById('turn-indicator');
    turnEl.classList.remove('replay');
    
    renderBoard();
    renderHands();
    updateInfo();
    updateReplayControls();
    renderKifu();
    
    console.log('局面から続行:', replayPosition);
}

initEngine();
