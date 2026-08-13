"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V8
   MULTI EXCHANGE MARKET ENGINE

   Binance
   Bybit
   OKX
   Coinbase Advanced Trade
   Gate.io

   V8:
   - Her borsa ayrı veri deposu
   - Her borsa ayrı order book
   - Her borsa ayrı trade akışı
   - Ortak piyasa skoru
   - Gerçek BUY / SELL akışı
   - Coinbase maker -> taker dönüşümü
   - Reconnect
   - Heartbeat
   - RIZOUSDT / VANRYUSDT hariç
========================================================= */

const EXCLUDED = new Set([
    "RIZOUSDT",
    "VANRYUSDT"
]);

const COINS = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT"
];

const EXCHANGES = [
    "Binance",
    "Bybit",
    "OKX",
    "Coinbase",
    "Gate.io"
];

const CONFIG = {
    shortWindow: 5000,
    mediumWindow: 15000,
    longWindow: 60000,

    bookLevels: 10,

    reconnectDelay: 4000,

    updateRate: 500,

    maxTrades: 500,

    maxPrices: 300
};


/* =========================================================
   GLOBAL
========================================================= */

const market = {};
const sockets = {};
const exchangeStats = {};

let selectedCoin = "BTCUSDT";

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;


/* =========================================================
   MARKET OLUŞTUR
========================================================= */

COINS.forEach(symbol => {

    if (EXCLUDED.has(symbol)) return;

    market[symbol] = {

        symbol,

        price: 0,

        prices: [],

        trades: [],

        exchanges: {},

        momentum5: 0,

        momentum15: 0,

        pressure: 50,

        tradeScore: 50,

        exchangeScore: 50,

        bookScore: 50,

        signal: 50,

        signalText: "NÖTR"
    };

});


/* =========================================================
   BORSA STATE
========================================================= */

EXCHANGES.forEach(exchange => {

    exchangeStats[exchange] = {
        connected: false,
        messages: 0,
        lastMessage: 0,
        reconnecting: false
    };

    Object.values(market).forEach(m => {

        m.exchanges[exchange] = {

            price: 0,

            trades: [],

            bids: new Map(),

            asks: new Map(),

            lastUpdate: 0,

            messages: 0,

            tradeCount: 0,

            buyVolume: 0,

            sellVolume: 0
        };

    });

});


/* =========================================================
   YARDIMCI
========================================================= */

function normalizeSymbol(symbol) {

    if (!symbol) return null;

    return String(symbol)
        .toUpperCase()
        .replace(/[-_/]/g, "");

}


function getMarket(symbol) {

    const s = normalizeSymbol(symbol);

    if (!s) return null;

    if (EXCLUDED.has(s)) return null;

    return market[s] || null;
}


function getExchangeMarket(symbol, exchange) {

    const m = getMarket(symbol);

    if (!m) return null;

    return m.exchanges[exchange] || null;
}


function now() {

    return Date.now();

}


function safeNumber(value) {

    const n = Number(value);

    return Number.isFinite(n) ? n : 0;

}


function clamp(value, min = 0, max = 100) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function average(values) {

    if (!values.length) return 0;

    return values.reduce(
        (a, b) => a + b,
        0
    ) / values.length;

}


function median(values) {

    if (!values.length) return 0;

    const sorted = [...values].sort(
        (a, b) => a - b
    );

    const middle =
        Math.floor(sorted.length / 2);

    if (sorted.length % 2) {

        return sorted[middle];

    }

    return (
        sorted[middle - 1] +
        sorted[middle]
    ) / 2;

}


/* =========================================================
   EXCHANGE UI
========================================================= */

function exchangeKey(exchange) {

    const map = {

        Binance: "binance",

        Bybit: "bybit",

        OKX: "okx",

        Coinbase: "coinbase",

        "Gate.io": "gate"
    };

    return map[exchange];

}


function setExchangeStatus(
    exchange,
    connected
) {

    const stat =
        exchangeStats[exchange];

    if (!stat) return;

    stat.connected = connected;

    stat.reconnecting = !connected;

    updateExchangeUI(exchange);

    updateGlobalConnection();

}


function countMessage(exchange) {

    totalMessages++;

    const stat =
        exchangeStats[exchange];

    if (stat) {

        stat.messages++;

        stat.lastMessage = now();

    }

    updateExchangeUI(exchange);

}


function updateExchangeUI(exchange) {

    const key =
        exchangeKey(exchange);

    if (!key) return;

    const status =
        document.getElementById(
            `${key}Status`
        );

    const dot =
        document.getElementById(
            `${key}Dot`
        );

    const messages =
        document.getElementById(
            `${key}Messages`
        );

    const stat =
        exchangeStats[exchange];

    if (!stat) return;

    if (status) {

        status.textContent =
            stat.connected
                ? "Bağlı"
                : "Bekleniyor";

    }

    if (dot) {

        dot.textContent =
            stat.connected
                ? "●"
                : "○";

    }

    if (messages) {

        messages.textContent =
            stat.messages.toLocaleString(
                "tr-TR"
            );

    }

}


function updateGlobalConnection() {

    const status =
        document.getElementById(
            "connectionStatus"
        );

    const dot =
        document.getElementById(
            "connectionDot"
        );

    const connected =
        Object.values(exchangeStats)
            .filter(x => x.connected)
            .length;

    if (status) {

        status.textContent =
            `${connected}/${EXCHANGES.length} borsa bağlı`;

    }

    if (dot) {

        dot.textContent =
            connected > 0
                ? "●"
                : "○";

    }

}


/* =========================================================
   TRADE
========================================================= */

function addTrade(
    symbol,
    price,
    size,
    side,
    exchange
) {

    const m =
        getMarket(symbol);

    if (!m) return;

    const em =
        getExchangeMarket(
            symbol,
            exchange
        );

    if (!em) return;

    const p =
        safeNumber(price);

    const q =
        safeNumber(size);

    if (
        p <= 0 ||
        q <= 0
    ) {
        return;
    }

    const timestamp =
        now();

    em.price = p;

    em.lastUpdate =
        timestamp;

    em.tradeCount++;

    if (side === "buy") {

        em.buyVolume += q;

    }

    else if (side === "sell") {

        em.sellVolume += q;

    }

    em.trades.push({

        time: timestamp,

        price: p,

        size: q,

        side

    });

    if (
        em.trades.length >
        CONFIG.maxTrades
    ) {

        em.trades.splice(
            0,
            em.trades.length -
            CONFIG.maxTrades
        );

    }

    countMessage(exchange);

    totalTrades++;

}


/* =========================================================
   ORDER BOOK HELPERS
========================================================= */

function setBookLevel(
    em,
    side,
    price,
    quantity
) {

    const p =
        safeNumber(price);

    const q =
        safeNumber(quantity);

    if (p <= 0) return;

    const map =
        side === "bid"
            ? em.bids
            : em.asks;

    if (q <= 0) {

        map.delete(p);

    }

    else {

        map.set(
            p,
            q
        );

    }

}


function clearBook(em) {

    em.bids.clear();

    em.asks.clear();

}


function mapToBook(map, reverse) {

    const result =
        [...map.entries()]
            .sort(
                (a, b) =>
                    reverse
                        ? b[0] - a[0]
                        : a[0] - b[0]
            );

    return result
        .slice(
            0,
            CONFIG.bookLevels
        )
        .map(
            x => [
                x[0],
                x[1]
            ]
        );

}


/* =========================================================
   ORDER BOOK
========================================================= */

function updateBook(
    symbol,
    bids,
    asks,
    exchange,
    replace = true
) {

    const m =
        getMarket(symbol);

    if (!m) return;

    const em =
        getExchangeMarket(
            symbol,
            exchange
        );

    if (!em) return;

    if (replace) {

        clearBook(em);

    }

    if (Array.isArray(bids)) {

        bids.forEach(level => {

            if (!level) return;

            setBookLevel(
                em,
                "bid",
                level[0],
                level[1]
            );

        });

    }

    if (Array.isArray(asks)) {

        asks.forEach(level => {

            if (!level) return;

            setBookLevel(
                em,
                "ask",
                level[0],
                level[1]
            );

        });

    }

    em.lastUpdate =
        now();

    totalBooks++;

    countMessage(exchange);

}


/* =========================================================
   BOOK PRESSURE
========================================================= */

function calculateBookPressure(em) {

    const bids =
        mapToBook(
            em.bids,
            true
        );

    const asks =
        mapToBook(
            em.asks,
            false
        );

    if (
        !bids.length &&
        !asks.length
    ) {

        return 50;

    }

    let bidVolume = 0;

    let askVolume = 0;

    bids.forEach(
        level => {

            bidVolume +=
                safeNumber(level[1]);

        }
    );

    asks.forEach(
        level => {

            askVolume +=
                safeNumber(level[1]);

        }
    );

    const total =
        bidVolume +
        askVolume;

    if (total <= 0) return 50;

    return clamp(
        (bidVolume / total) * 100
    );

}


/* =========================================================
   TRADE SCORE
========================================================= */

function calculateTradeScore(em) {

    const cutoff =
        now() -
        CONFIG.mediumWindow;

    const recent =
        em.trades.filter(
            t =>
                t.time >= cutoff
        );

    if (!recent.length) {

        return 50;

    }

    let buy = 0;

    let sell = 0;

    recent.forEach(t => {

        if (t.side === "buy") {

            buy +=
                t.price *
                t.size;

        }

        else {

            sell +=
                t.price *
                t.size;

        }

    });

    const total =
        buy + sell;

    if (total <= 0) return 50;

    return clamp(
        (buy / total) * 100
    );

}


/* =========================================================
   MARKET MOMENTUM
========================================================= */

function calculateMomentum(m) {

    const prices =
        m.prices;

    if (prices.length < 2) {

        return;

    }

    const current =
        m.price;

    if (!current) return;

    const t =
        now();

    const p5 =
        [...prices]
            .reverse()
            .find(
                x =>
                    x.time <=
                    t -
                    CONFIG.shortWindow
            );

    const p15 =
        [...prices]
            .reverse()
            .find(
                x =>
                    x.time <=
                    t -
                    CONFIG.mediumWindow
            );

    if (p5 && p5.price > 0) {

        m.momentum5 =
            (
                (current -
                    p5.price) /
                p5.price
            ) *
            100;

    }

    if (p15 && p15.price > 0) {

        m.momentum15 =
            (
                (current -
                    p15.price) /
                p15.price
            ) *
            100;

    }

}


/* =========================================================
   EXCHANGE SCORE
========================================================= */

function calculateExchangeScore(m) {

    const prices =
        EXCHANGES
            .map(
                exchange =>
                    m.exchanges[
                        exchange
                    ].price
            )
            .filter(
                p => p > 0
            );

    if (prices.length < 2) {

        return 50;

    }

    const reference =
        median(prices);

    if (!reference) return 50;

    const deviations =
        prices.map(
            p =>
                Math.abs(
                    (p - reference) /
                    reference
                ) *
                100
        );

    const deviation =
        average(
            deviations
        );

    /*
       0 deviation = 100
       Larger deviation = lower score
    */

    return clamp(
        100 -
        deviation * 500
    );

}


/* =========================================================
   GLOBAL BOOK SCORE
========================================================= */

function calculateGlobalBookScore(m) {

    const scores = [];

    EXCHANGES.forEach(
        exchange => {

            const em =
                m.exchanges[
                    exchange
                ];

            if (
                em.bids.size ||
                em.asks.size
            ) {

                scores.push(
                    calculateBookPressure(
                        em
                    )
                );

            }

        }
    );

    if (!scores.length) {

        return 50;

    }

    return clamp(
        average(scores)
    );

}


/* =========================================================
   GLOBAL TRADE SCORE
========================================================= */

function calculateGlobalTradeScore(m) {

    let buy = 0;

    let sell = 0;

    const cutoff =
        now() -
        CONFIG.mediumWindow;

    EXCHANGES.forEach(
        exchange => {

            const em =
                m.exchanges[
                    exchange
                ];

            em.trades.forEach(
                t => {

                    if (
                        t.time <
                        cutoff
                    ) {
                        return;
                    }

                    const value =
                        t.price *
                        t.size;

                    if (
                        t.side ===
                        "buy"
                    ) {

                        buy += value;

                    }

                    else {

                        sell += value;

                    }

                }
            );

        }
    );

    const total =
        buy + sell;

    if (total <= 0) {

        return 50;

    }

    return clamp(
        (buy / total) * 100
    );

}


/* =========================================================
   PRICE UPDATE
========================================================= */

function updateMarketPrice(m) {

    const prices =
        EXCHANGES
            .map(
                exchange =>
                    m.exchanges[
                        exchange
                    ].price
            )
            .filter(
                p =>
                    p > 0 &&
                    Number.isFinite(p)
            );

    if (!prices.length) return;

    const price =
        median(prices);

    if (!price) return;

    m.price =
        price;

    const t =
        now();

    m.prices.push({

        time: t,

        price

    });

    if (
        m.prices.length >
        CONFIG.maxPrices
    ) {

        m.prices.splice(
            0,
            m.prices.length -
            CONFIG.maxPrices
        );

    }

}


/* =========================================================
   SIGNAL
========================================================= */

function calculateSignal(m) {

    updateMarketPrice(m);

    calculateMomentum(m);

    m.bookScore =
        calculateGlobalBookScore(m);

    m.tradeScore =
        calculateGlobalTradeScore(m);

    m.exchangeScore =
        calculateExchangeScore(m);

    const momentumScore =
        clamp(
            50 +
            m.momentum5 * 8 +
            m.momentum15 * 4
        );

    const score =

        momentumScore * 0.30 +

        m.bookScore * 0.30 +

        m.tradeScore * 0.25 +

        m.exchangeScore * 0.15;

    m.signal =
        clamp(score);

    if (m.signal >= 82) {

        m.signalText =
            "GÜÇLÜ AL";

    }

    else if (m.signal >= 68) {

        m.signalText =
            "AL";

    }

    else if (m.signal <= 18) {

        m.signalText =
            "GÜÇLÜ SAT";

    }

    else if (m.signal <= 32) {

        m.signalText =
            "SAT";

    }

    else {

        m.signalText =
            "NÖTR";

    }

}


/* =========================================================
   CLEANUP
========================================================= */

function cleanup(m) {

    const cutoff =
        now() -
        CONFIG.longWindow;

    m.prices =
        m.prices.filter(
            x =>
                x.time >=
                cutoff
        );

    EXCHANGES.forEach(
        exchange => {

            const em =
                m.exchanges[
                    exchange
                ];

            em.trades =
                em.trades.filter(
                    t =>
                        t.time >=
                        cutoff
                );

        }
    );

}


/* =========================================================
   BINANCE
========================================================= */

function connectBinance() {

    try {

        const streams =
            COINS
                .filter(
                    x =>
                        !EXCLUDED.has(x)
                )
                .flatMap(
                    symbol => {

                        const s =
                            symbol.toLowerCase();

                        return [
                            `${s}@trade`,
                            `${s}@depth10@100ms`
                        ];

                    }
                )
                .join("/");

        const ws =
            new WebSocket(
                `wss://stream.binance.com:9443/stream?streams=${streams}`
            );

        sockets.binance =
            ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Binance",
                true
            );

            log(
                "✓ Binance V8 bağlantısı aktif"
            );

        };

        ws.onmessage =
            event => {

                try {

                    const packet =
                        JSON.parse(
                            event.data
                        );

                    const d =
                        packet.data;

                    if (!d) return;

                    if (
                        d.e ===
                        "trade"
                    ) {

                        /*
                           m=true:
                           buyer is maker
                           => taker is SELL
                        */

                        const side =
                            d.m
                                ? "sell"
                                : "buy";

                        addTrade(
                            d.s,
                            d.p,
                            d.q,
                            side,
                            "Binance"
                        );

                    }

                    else if (
                        d.e ===
                        "depthUpdate"
                    ) {

                        updateBook(
                            d.s,
                            d.bids ||
                            [],
                            d.asks ||
                            [],
                            "Binance",
                            true
                        );

                    }

                }

                catch (error) {

                    log(
                        "Binance veri parse hatası"
                    );

                }

            };

        ws.onerror = () => {

            setExchangeStatus(
                "Binance",
                false
            );

        };

        ws.onclose = () => {

            setExchangeStatus(
                "Binance",
                false
            );

            scheduleReconnect(
                "Binance",
                connectBinance
            );

        };

    }

    catch (error) {

        scheduleReconnect(
            "Binance",
            connectBinance
        );

    }

}


/* =========================================================
   BYBIT
========================================================= */

function connectBybit() {

    try {

        const ws =
            new WebSocket(
                "wss://stream.bybit.com/v5/public/spot"
            );

        sockets.bybit =
            ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Bybit",
                true
            );

            const args = [];

            COINS.forEach(
                symbol => {

                    if (
                        EXCLUDED.has(symbol)
                    ) return;

                    args.push(
                        `publicTrade.${symbol}`
                    );

                    args.push(
                        `orderbook.50.${symbol}`
                    );

                }
            );

            ws.send(
                JSON.stringify({
                    op: "subscribe",
                    args
                })
            );

            log(
                "✓ Bybit V8 bağlantısı aktif"
            );

        };

        ws.onmessage =
            event => {

                try {

                    const msg =
                        JSON.parse(
                            event.data
                        );

                    if (
                        msg.op ===
                        "pong"
                    ) {
                        return;
                    }

                    if (!msg.topic) {

                        return;

                    }

                    const data =
                        msg.data;

                    if (
                        msg.topic.startsWith(
                            "publicTrade."
                        )
                    ) {

                        if (
                            !Array.isArray(
                                data
                            )
                        ) return;

                        data.forEach(
                            t => {

                                addTrade(
                                    t.s,
                                    t.p,
                                    t.v,
                                    t.S ===
                                    "Buy"
                                        ? "buy"
                                        : "sell",
                                    "Bybit"
                                );

                            }
                        );

                    }

                    else if (
                        msg.topic.startsWith(
                            "orderbook."
                        )
                    ) {

                        if (!data) return;

                        const symbol =
                            data.s;

                        const em =
                            getExchangeMarket(
                                symbol,
                                "Bybit"
                            );

                        if (!em) return;

                        /*
                           Bybit snapshot
                           resets book.
                        */

                        if (
                            msg.type ===
                            "snapshot"
                        ) {

                            clearBook(em);

                        }

                        if (
                            Array.isArray(
                                data.b
                            )
                        ) {

                            data.b.forEach(
                                level => {

                                    setBookLevel(
                                        em,
                                        "bid",
                                        level[0],
                                        level[1]
                                    );

                                }
                            );

                        }

                        if (
                            Array.isArray(
                                data.a
                            )
                        ) {

                            data.a.forEach(
                                level => {

                                    setBookLevel(
                                        em,
                                        "ask",
                                        level[0],
                                        level[1]
                                    );

                                }
                            );

                        }

                        em.lastUpdate =
                            now();

                        totalBooks++;

                        countMessage(
                            "Bybit"
                        );

                    }

                }

                catch (error) {

                    log(
                        "Bybit veri parse hatası"
                    );

                }

            };

        ws.onerror = () => {

            setExchangeStatus(
                "Bybit",
                false
            );

        };

        ws.onclose = () => {

            setExchangeStatus(
                "Bybit",
                false
            );

            scheduleReconnect(
                "Bybit",
                connectBybit
            );

        };

    }

    catch (error) {

        scheduleReconnect(
            "Bybit",
            connectBybit
        );

    }

}


/* =========================================================
   BYBIT HEARTBEAT
========================================================= */

setInterval(
    () => {

        const ws =
            sockets.bybit;

        if (
            ws &&
            ws.readyState ===
            WebSocket.OPEN
        ) {

            try {

                ws.send(
                    JSON.stringify({
                        op: "ping"
                    })
                );

            }

            catch (error) {}

        }

    },
    20000
);


/* =========================================================
   OKX
========================================================= */

function connectOKX() {

    try {

        const ws =
            new WebSocket(
                "wss://ws.okx.com:8443/ws/v5/public"
            );

        sockets.okx =
            ws;

        ws.onopen = () => {

            setExchangeStatus(
                "OKX",
                true
            );

            const args = [];

            COINS.forEach(
                symbol => {

                    if (
                        EXCLUDED.has(symbol)
                    ) return;

                    const base =
                        symbol.replace(
                            "USDT",
                            ""
                        );

                    const instId =
                        `${base}-USDT`;

                    args.push({

                        channel:
                            "trades",

                        instId

                    });

                    args.push({

                        channel:
                            "books5",

                        instId

                    });

                }
            );

            ws.send(
                JSON.stringify({
                    op: "subscribe",
                    args
                })
            );

            log(
                "✓ OKX V8 bağlantısı aktif"
            );

        };

        ws.onmessage =
            event => {

                try {

                    const msg =
                        JSON.parse(
                            event.data
                        );

                    if (
                        !msg.arg ||
                        !msg.data
                    ) return;

                    const symbol =
                        normalizeSymbol(
                            msg.arg.instId
                        );

                    if (
                        msg.arg.channel ===
                        "trades"
                    ) {

                        msg.data.forEach(
                            t => {

                                addTrade(
                                    symbol,
                                    t.px,
                                    t.sz,
                                    t.side ===
                                    "buy"
                                        ? "buy"
                                        : "sell",
                                    "OKX"
                                );

                            }
                        );

                    }

                    else if (
                        msg.arg.channel ===
                        "books5"
                    ) {

                        const book =
                            msg.data[0];

                        if (!book) return;

                        updateBook(
                            symbol,
                            book.bids ||
                            [],
                            book.asks ||
                            [],
                            "OKX",
                            true
                        );

                    }

                }

                catch (error) {

                    log(
                        "OKX veri parse hatası"
                    );

                }

            };

        ws.onerror = () => {

            setExchangeStatus(
                "OKX",
                false
            );

        };

        ws.onclose = () => {

            setExchangeStatus(
                "OKX",
                false
            );

            scheduleReconnect(
                "OKX",
                connectOKX
            );

        };

    }

    catch (error) {

        scheduleReconnect(
            "OKX",
            connectOKX
        );

    }

}


/* =========================================================
   COINBASE
========================================================= */

function connectCoinbase() {

    try {

        const ws =
            new WebSocket(
                "wss://advanced-trade-ws.coinbase.com"
            );

        sockets.coinbase =
            ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Coinbase",
                true
            );

            const products =
                COINS
                    .filter(
                        x =>
                            !EXCLUDED.has(x)
                    )
                    .map(
                        x =>
                            x.replace(
                                "USDT",
                                "-USD"
                            )
                    );

            /*
               HEARTBEATS
            */

            ws.send(
                JSON.stringify({
                    type:
                        "subscribe",
                    channel:
                        "heartbeats"
                })
            );

            /*
               MARKET TRADES
            */

            ws.send(
                JSON.stringify({
                    type:
                        "subscribe",
                    product_ids:
                        products,
                    channel:
                        "market_trades"
                })
            );

            /*
               LEVEL 2 ORDER BOOK
            */

            ws.send(
                JSON.stringify({
                    type:
                        "subscribe",
                    product_ids:
                        products,
                    channel:
                        "level2"
                })
            );

            log(
                "✓ Coinbase V8 bağlantısı aktif"
            );

        };

        ws.onmessage =
            event => {

                try {

                    const msg =
                        JSON.parse(
                            event.data
                        );

                    if (
                        msg.channel ===
                        "heartbeats"
                    ) {

                        return;

                    }

                    if (
                        msg.channel ===
                        "market_trades"
                    ) {

                        if (
                            !Array.isArray(
                                msg.events
                            )
                        ) return;

                        msg.events.forEach(
                            ev => {

                                if (
                                    !Array.isArray(
                                        ev.trades
                                    )
                                ) return;

                                ev.trades.forEach(
                                    t => {

                                        const symbol =
                                            normalizeSymbol(
                                                t.product_id
                                            );

                                        /*
                                           Coinbase side
                                           = maker side.

                                           Maker SELL
                                           => taker BUY

                                           Maker BUY
                                           => taker SELL
                                        */

                                        const side =
                                            t.side ===
                                            "SELL"
                                                ? "buy"
                                                : "sell";

                                        addTrade(
                                            symbol,
                                            t.price,
                                            t.size,
                                            side,
                                            "Coinbase"
                                        );

                                    }
                                );

                            }
                        );

                    }

                    else if (
                        msg.channel ===
                        "l2_data"
                    ) {

                        if (
                            !Array.isArray(
                                msg.events
                            )
                        ) return;

                        msg.events.forEach(
                            ev => {

                                const symbol =
                                    normalizeSymbol(
                                        ev.product_id
                                    );

                                const em =
                                    getExchangeMarket(
                                        symbol,
                                        "Coinbase"
                                    );

                                if (!em) return;

                                if (
                                    ev.type ===
                                    "snapshot"
                                ) {

                                    clearBook(
                                        em
                                    );

                                }

                                if (
                                    !Array.isArray(
                                        ev.updates
                                    )
                                ) return;

                                ev.updates.forEach(
                                    u => {

                                        const side =
                                            u.side ===
                                            "bid"
                                                ? "bid"
                                                : "ask";

                                        setBookLevel(
                                            em,
                                            side,
                                            u.price_level,
                                            u.new_quantity
                                        );

                                    }
                                );

                                em.lastUpdate =
                                    now();

                                totalBooks++;

                                countMessage(
                                    "Coinbase"
                                );

                            }
                        );

                    }

                }

                catch (error) {

                    log(
                        "Coinbase veri parse hatası"
                    );

                }

            };

        ws.onerror = () => {

            setExchangeStatus(
                "Coinbase",
                false
            );

        };

        ws.onclose = () => {

            setExchangeStatus(
                "Coinbase",
                false
            );

            scheduleReconnect(
                "Coinbase",
                connectCoinbase
            );

        };

    }

    catch (error) {

        scheduleReconnect(
            "Coinbase",
            connectCoinbase
        );

    }

}


/* =========================================================
   GATE.IO
========================================================= */

function connectGate() {

    try {

        const ws =
            new WebSocket(
                "wss://api.gateio.ws/ws/v4/"
            );

        sockets.gate =
            ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Gate.io",
                true
            );

            const pairs =
                COINS
                    .filter(
                        x =>
                            !EXCLUDED.has(x)
                    )
                    .map(
                        x =>
                            x.replace(
                                "USDT",
                                "_USDT"
                            )
                    );

            /*
               TRADES
            */

            ws.send(
                JSON.stringify({
                    time:
                        Math.floor(
                            Date.now() /
                            1000
                        ),
                    channel:
                        "spot.trades",
                    event:
                        "subscribe",
                    payload:
                        pairs
                })
            );

            /*
               ORDER BOOK
            */

            pairs.forEach(
                pair => {

                    ws.send(
                        JSON.stringify({
                            time:
                                Math.floor(
                                    Date.now() /
                                    1000
                                ),
                            channel:
                                "spot.order_book",
                            event:
                                "subscribe",
                            payload: [
                                pair,
                                "10",
                                "100ms"
                            ]
                        })
                    );

                }
            );

            log(
                "✓ Gate.io V8 bağlantısı aktif"
            );

        };

        ws.onmessage =
            event => {

                try {

                    const msg =
                        JSON.parse(
                            event.data
                        );

                    if (
                        !msg.result
                    ) return;

                    if (
                        msg.channel ===
                        "spot.trades"
                    ) {

                        const list =
                            Array.isArray(
                                msg.result
                            )
                                ? msg.result
                                : [
                                    msg.result
                                ];

                        list.forEach(
                            t => {

                                if (
                                    !t.currency_pair
                                ) return;

                                const symbol =
                                    normalizeSymbol(
                                        t.currency_pair
                                    );

                                addTrade(
                                    symbol,
                                    t.price,
                                    t.amount,
                                    t.side ===
                                    "buy"
                                        ? "buy"
                                        : "sell",
                                    "Gate.io"
                                );

                            }
                        );

                    }

                    else if (
                        msg.channel ===
                        "spot.order_book"
                    ) {

                        const r =
                            msg.result;

                        if (!r) return;

                        const symbol =
                            normalizeSymbol(
                                r.s ||
                                r.currency_pair
                            );

                        if (!symbol) return;

                        updateBook(
                            symbol,
                            r.bids ||
                            [],
                            r.asks ||
                            [],
                            "Gate.io",
                            true
                        );

                    }

                }

                catch (error) {

                    log(
                        "Gate.io veri parse hatası"
                    );

                }

            };

        ws.onerror = () => {

            setExchangeStatus(
                "Gate.io",
                false
            );

        };

        ws.onclose = () => {

            setExchangeStatus(
                "Gate.io",
                false
            );

            scheduleReconnect(
                "Gate.io",
                connectGate
            );

        };

    }

    catch (error) {

        scheduleReconnect(
            "Gate.io",
            connectGate
        );

    }

}


/* =========================================================
   GATE HEARTBEAT
========================================================= */

setInterval(
    () => {

        const ws =
            sockets.gate;

        if (
            ws &&
            ws.readyState ===
            WebSocket.OPEN
        ) {

            try {

                ws.send(
                    JSON.stringify({
                        time:
                            Math.floor(
                                Date.now() /
                                1000
                            ),
                        channel:
                            "spot.ping",
                        event:
                            "subscribe",
                        payload: []
                    })
                );

            }

            catch (error) {}

        }

    },
    20000
);


/* =========================================================
   RECONNECT
========================================================= */

function scheduleReconnect(
    exchange,
    fn
) {

    const stat =
        exchangeStats[exchange];

    if (!stat) return;

    if (stat.reconnectingTimer) {

        return;

    }

    stat.reconnectingTimer =
        setTimeout(
            () => {

                stat.reconnectingTimer =
                    null;

                fn();

            },
            CONFIG.reconnectDelay
        );

}


/* =========================================================
   CONNECT ALL
========================================================= */

function connectAll() {

    log(
        "V8 çoklu borsa motoru başlatılıyor..."
    );

    connectBinance();

    connectBybit();

    connectOKX();

    connectCoinbase();

    connectGate();

}


/* =========================================================
   FORMAT
========================================================= */

function formatPrice(price) {

    if (!price) return "--";

    if (price >= 1000) {

        return price.toLocaleString(
            "tr-TR",
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );

    }

    if (price >= 1) {

        return price.toLocaleString(
            "tr-TR",
            {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4
            }
        );

    }

    return price.toLocaleString(
        "tr-TR",
        {
            minimumFractionDigits: 6,
            maximumFractionDigits: 8
        }
    );

}


function signalColor(score) {

    if (score >= 68) {

        return "#22c55e";

    }

    if (score <= 32) {

        return "#ef4444";

    }

    return "#f59e0b";

}


/* =========================================================
   SELECTED COIN
========================================================= */

function renderSelected() {

    const m =
        market[selectedCoin];

    if (!m) return;

    const score =
        document.getElementById(
            "signalScore"
        );

    const text =
        document.getElementById(
            "signalText"
        );

    const desc =
        document.getElementById(
            "signalDescription"
        );

    const bar =
        document.getElementById(
            "signalBar"
        );

    const price =
        document.getElementById(
            "selectedPrice"
        );

    const mom5 =
        document.getElementById(
            "momentum5"
        );

    const mom15 =
        document.getElementById(
            "momentum15"
        );

    const pressure =
        document.getElementById(
            "detailPressure"
        );

    const factorMomentum =
        document.getElementById(
            "factorMomentum"
        );

    const factorBook =
        document.getElementById(
            "factorBook"
        );

    const factorTrade =
        document.getElementById(
            "factorTrade"
        );

    const factorExchange =
        document.getElementById(
            "factorExchange"
        );

    if (score) {

        score.textContent =
            Math.round(
                m.signal
            );

    }

    if (text) {

        text.textContent =
            m.signalText;

        text.style.color =
            signalColor(
                m.signal
            );

    }

    if (desc) {

        if (m.signal >= 82) {

            desc.textContent =
                "Çok güçlü yükseliş koşulları";

        }

        else if (m.signal >= 68) {

            desc.textContent =
                "Yükseliş yönlü sinyal";

        }

        else if (m.signal <= 18) {

            desc.textContent =
                "Çok güçlü düşüş koşulları";

        }

        else if (m.signal <= 32) {

            desc.textContent =
                "Düşüş yönlü sinyal";

        }

        else {

            desc.textContent =
                "Piyasa dengeli";

        }

    }

    if (bar) {

        bar.style.width =
            `${m.signal}%`;

        bar.style.background =
            signalColor(
                m.signal
            );

    }

    if (price) {

        price.textContent =
            formatPrice(
                m.price
            );

    }

    if (mom5) {

        mom5.textContent =
            `${m.momentum5 >= 0 ? "+" : ""}${m.momentum5.toFixed(3)}%`;

        mom5.style.color =
            m.momentum5 >= 0
                ? "#22c55e"
                : "#ef4444";

    }

    if (mom15) {

        mom15.textContent =
            `${m.momentum15 >= 0 ? "+" : ""}${m.momentum15.toFixed(3)}%`;

        mom15.style.color =
            m.momentum15 >= 0
                ? "#22c55e"
                : "#ef4444";

    }

    if (pressure) {

        pressure.textContent =
            `${m.pressure.toFixed(1)}%`;

        pressure.style.color =
            signalColor(
                m.pressure
            );

    }

    if (factorMomentum) {

        const momentumScore =
            clamp(
                50 +
                m.momentum5 * 8 +
                m.momentum15 * 4
            );

        factorMomentum.textContent =
            Math.round(
                momentumScore
            );

    }

    if (factorBook) {

        factorBook.textContent =
            Math.round(
                m.bookScore
            );

    }

    if (factorTrade) {

        factorTrade.textContent =
            Math.round(
                m.tradeScore
            );

    }

    if (factorExchange) {

        factorExchange.textContent =
            Math.round(
                m.exchangeScore
            );

    }

}


/* =========================================================
   COIN LIST
========================================================= */

function renderCoinList() {

    const container =
        document.getElementById(
            "coinList"
        );

    if (!container) return;

    const coins =
        Object.values(market)
            .sort(
                (a, b) =>
                    b.signal -
                    a.signal
            );

    container.innerHTML =
        coins
            .map(
                m => {

                    const color =
                        signalColor(
                            m.signal
                        );

                    return `

                        <div
                            class="coin-card ${m.symbol === selectedCoin ? "selected" : ""}"
                            data-symbol="${m.symbol}"
                        >

                            <div class="coin-top">

                                <span class="coin-name">

                                    ${m.symbol.replace(
                                        "USDT",
                                        ""
                                    )}

                                </span>

                                <span
                                    class="coin-signal"
                                    style="color:${color}"
                                >

                                    ${m.signalText}

                                </span>

                            </div>


                            <div class="coin-price">

                                ${formatPrice(
                                    m.price
                                )}

                            </div>


                            <div class="coin-bottom">

                                <span class="coin-momentum">

                                    5s:
                                    ${m.momentum5 >= 0 ? "+" : ""}
                                    ${m.momentum5.toFixed(3)}%

                                </span>


                                <span>

                                    AI:

                                    <strong
                                        style="color:${color}"
                                    >

                                        ${Math.round(
                                            m.signal
                                        )}

                                    </strong>

                                </span>

                            </div>

                        </div>

                    `;

                }
            )
            .join("");


    container
        .querySelectorAll(
            ".coin-card"
        )
        .forEach(
            card => {

                card.addEventListener(
                    "click",
                    () => {

                        selectedCoin =
                            card.dataset.symbol;

                        renderCoinList();

                        renderSelected();

                        renderOrderBook();

                        log(
                            `${selectedCoin} seçildi`
                        );

                    }
                );

            }
        );

}


/* =========================================================
   ORDER BOOK RENDER
========================================================= */

function renderOrderBook() {

    const m =
        market[selectedCoin];

    if (!m) return;

    const bids =
        document.getElementById(
            "bids"
        );

    const asks =
        document.getElementById(
            "asks"
        );

    if (!bids || !asks) return;

    /*
       Global order book:
       İlk 10 seviye,
       borsalardan gelen verilerin
       basit konsolide görünümü.
    */

    const bidMap =
        new Map();

    const askMap =
        new Map();

    EXCHANGES.forEach(
        exchange => {

            const em =
                m.exchanges[
                    exchange
                ];

            mapToBook(
                em.bids,
                true
            ).forEach(
                level => {

                    const p =
                        level[0];

                    const q =
                        level[1];

                    bidMap.set(
                        p,
                        (bidMap.get(p) || 0) +
                        q
                    );

                }
            );

            mapToBook(
                em.asks,
                false
            ).forEach(
                level => {

                    const p =
                        level[0];

                    const q =
                        level[1];

                    askMap.set(
                        p,
                        (askMap.get(p) || 0) +
                        q
                    );

                }
            );

        }
    );


    const bidLevels =
        mapToBook(
            bidMap,
            true
        );

    const askLevels =
        mapToBook(
            askMap,
            false
        );


    bids.innerHTML =
        bidLevels
            .map(
                level => `

                    <div class="book-row">

                        <span>

                            ${formatPrice(
                                level[0]
                            )}

                        </span>

                        <span>

                            ${safeNumber(
                                level[1]
                            ).toFixed(4)}

                        </span>

                    </div>

                `
            )
            .join("");


    asks.innerHTML =
        askLevels
            .map(
                level => `

                    <div class="book-row">

                        <span>

                            ${formatPrice(
                                level[0]
                            )}

                        </span>

                        <span>

                            ${safeNumber(
                                level[1]
                            ).toFixed(4)}

                        </span>

                    </div>

                `
            )
            .join("");

}


/* =========================================================
   STATS
========================================================= */

function updateStats() {

    const active =
        Object.values(market)
            .filter(
                m =>
                    m.price > 0
            )
            .length;

    const activeEl =
        document.getElementById(
            "activeCoins"
        );

    const messagesEl =
        document.getElementById(
            "totalMessages"
        );

    const tradesEl =
        document.getElementById(
            "totalTrades"
        );

    const booksEl =
        document.getElementById(
            "totalBooks"
        );

    if (activeEl) {

        activeEl.textContent =
            active;

    }

    if (messagesEl) {

        messagesEl.textContent =
            totalMessages.toLocaleString(
                "tr-TR"
            );

    }

    if (tradesEl) {

        tradesEl.textContent =
            totalTrades.toLocaleString(
                "tr-TR"
            );

    }

    if (booksEl) {

        booksEl.textContent =
            totalBooks.toLocaleString(
                "tr-TR"
            );

    }

}


/* =========================================================
   SEARCH
========================================================= */

function setupSearch() {

    const input =
        document.getElementById(
            "coinSearch"
        );

    if (!input) return;

    input.addEventListener(
        "input",
        () => {

            const value =
                input.value
                    .trim()
                    .toUpperCase();

            if (!value) return;

            const found =
                COINS.find(
                    symbol =>
                        symbol.includes(
                            value
                        )
                );

            if (found) {

                selectedCoin =
                    found;

                renderCoinList();

                renderSelected();

                renderOrderBook();

            }

        }
    );

}


/* =========================================================
   LOG
========================================================= */

function log(message) {

    console.log(
        `[V8] ${message}`
    );

    const box =
        document.getElementById(
            "log"
        );

    if (!box) return;

    const line =
        document.createElement(
            "div"
        );

    line.textContent =
        `${new Date().toLocaleTimeString(
            "tr-TR"
        )} — ${message}`;

    box.prepend(line);

    while (
        box.children.length >
        100
    ) {

        box.removeChild(
            box.lastChild
        );

    }

}


/* =========================================================
   LOG BUTTON
========================================================= */

function setupLogButton() {

    const button =
        document.getElementById(
            "clearLog"
        );

    if (!button) return;

    button.addEventListener(
        "click",
        () => {

            const box =
                document.getElementById(
                    "log"
                );

            if (box) {

                box.innerHTML =
                    "";

            }

        }
    );

}


/* =========================================================
   UI UPDATE
========================================================= */

function updateUI() {

    Object.values(market)
        .forEach(
            m => {

                cleanup(m);

                calculateSignal(m);

            }
        );

    /*
       pressure = global book score
    */

    Object.values(market)
        .forEach(
            m => {

                m.pressure =
                    m.bookScore;

            }
        );

    updateStats();

    renderSelected();

    renderCoinList();

    renderOrderBook();

}


/* =========================================================
   START
========================================================= */

function start() {

    log(
        "================================"
    );

    log(
        "COIN ANALİZ TERMİNALİ V8"
    );

    log(
        "MULTI EXCHANGE ENGINE"
    );

    log(
        "================================"
    );

    setupSearch();

    setupLogButton();

    renderCoinList();

    renderSelected();

    renderOrderBook();

    updateGlobalConnection();

    connectAll();

    setInterval(
        updateUI,
        CONFIG.updateRate
    );

}


/* =========================================================
   START
========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        start
    );

}

else {

    start();

}
