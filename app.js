"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V7.3
   MULTI EXCHANGE ENGINE
   Binance + Bybit + OKX + Coinbase + Gate.io
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

const CONFIG = {
    shortWindow: 5000,
    mediumWindow: 15000,
    longWindow: 60000,
    bookLevels: 10,
    reconnectDelay: 4000,
    updateRate: 500
};

const market = {};

let selectedCoin = "BTCUSDT";

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

const sockets = {};


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
        bids: [],
        asks: [],

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
   BORSA DURUMU
========================================================= */

const exchangeStats = {

    Binance: {
        connected: false,
        messages: 0
    },

    Bybit: {
        connected: false,
        messages: 0
    },

    OKX: {
        connected: false,
        messages: 0
    },

    Coinbase: {
        connected: false,
        messages: 0
    },

    "Gate.io": {
        connected: false,
        messages: 0
    }
};


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


function now() {
    return Date.now();
}


/* =========================================================
   BORSA SAYACI
========================================================= */

function countMessage(exchange) {

    totalMessages++;

    if (exchangeStats[exchange]) {
        exchangeStats[exchange].messages++;
    }

    updateExchangeUI(exchange);
}


/* =========================================================
   BORSA UI
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


function updateExchangeUI(exchange) {

    const key = exchangeKey(exchange);

    if (!key) return;

    const stats = exchangeStats[exchange];

    const status =
        document.getElementById(`${key}Status`);

    const dot =
        document.getElementById(`${key}Dot`);

    const messages =
        document.getElementById(`${key}Messages`);

    if (status) {
        status.textContent =
            stats.connected
                ? "Bağlı"
                : "Bekleniyor";
    }

    if (dot) {
        dot.textContent =
            stats.connected
                ? "●"
                : "○";

        dot.style.color =
            stats.connected
                ? "#22c55e"
                : "#64748b";
    }

    if (messages) {
        messages.textContent =
            stats.messages.toLocaleString("tr-TR");
    }
}


function setExchangeStatus(exchange, connected) {

    if (!exchangeStats[exchange]) return;

    exchangeStats[exchange].connected =
        connected;

    updateExchangeUI(exchange);

    const connectedCount =
        Object.values(exchangeStats)
            .filter(x => x.connected)
            .length;

    const status =
        document.getElementById(
            "connectionStatus"
        );

    const dot =
        document.getElementById(
            "connectionDot"
        );

    if (status) {
        status.textContent =
            connectedCount > 0
                ? `${connectedCount}/5 borsa bağlı`
                : "Borsalara bağlanıyor...";
    }

    if (dot) {
        dot.textContent =
            connectedCount > 0
                ? "●"
                : "○";

        dot.style.color =
            connectedCount > 0
                ? "#22c55e"
                : "#f59e0b";
    }
}


/* =========================================================
   FİYAT
========================================================= */

function updatePrice(symbol, price, exchange) {

    const m = getMarket(symbol);

    price = Number(price);

    if (!m) return;

    if (!Number.isFinite(price) || price <= 0) {
        return;
    }

    m.price = price;

    m.prices.push({
        time: now(),
        price
    });

    m.exchanges[exchange] = {
        price,
        time: now()
    };

    cleanup(m);

    countMessage(exchange);
}


/* =========================================================
   TRADE
========================================================= */

function addTrade(
    symbol,
    price,
    quantity,
    side,
    exchange
) {

    const m = getMarket(symbol);

    if (!m) return;

    price = Number(price);
    quantity = Number(quantity);

    if (!Number.isFinite(price)) {
        return;
    }

    m.trades.push({
        time: now(),
        price,
        quantity:
            Number.isFinite(quantity)
                ? quantity
                : 0,
        side:
            String(side || "")
                .toLowerCase(),
        exchange
    });

    totalTrades++;

    updatePrice(
        symbol,
        price,
        exchange
    );
}


/* =========================================================
   ORDER BOOK
========================================================= */

function updateBook(
    symbol,
    bids,
    asks,
    exchange
) {

    const m = getMarket(symbol);

    if (!m) return;

    if (Array.isArray(bids)) {
        m.bids =
            bids.slice(
                0,
                CONFIG.bookLevels
            );
    }

    if (Array.isArray(asks)) {
        m.asks =
            asks.slice(
                0,
                CONFIG.bookLevels
            );
    }

    totalBooks++;

    countMessage(exchange);

    calculatePressure(m);
}


/* =========================================================
   TEMİZLE
========================================================= */

function cleanup(m) {

    const cutoff =
        now() - CONFIG.longWindow;

    m.prices =
        m.prices.filter(
            x => x.time >= cutoff
        );

    m.trades =
        m.trades.filter(
            x => x.time >= cutoff
        );
}


/* =========================================================
   MOMENTUM
========================================================= */

function calculateMomentum(m) {

    if (!m.price || !m.prices.length) {

        m.momentum5 = 0;
        m.momentum15 = 0;

        return;
    }

    const t = now();

    let old5 = null;
    let old15 = null;

    for (
        let i = m.prices.length - 1;
        i >= 0;
        i--
    ) {

        const p = m.prices[i];

        if (
            !old5 &&
            t - p.time >=
            CONFIG.shortWindow
        ) {
            old5 = p;
        }

        if (
            !old15 &&
            t - p.time >=
            CONFIG.mediumWindow
        ) {
            old15 = p;
        }

        if (old5 && old15) break;
    }

    m.momentum5 =
        old5
            ? (
                (m.price - old5.price) /
                old5.price
            ) * 100
            : 0;

    m.momentum15 =
        old15
            ? (
                (m.price - old15.price) /
                old15.price
            ) * 100
            : 0;
}


/* =========================================================
   ORDER BOOK BASKI
========================================================= */

function calculatePressure(m) {

    let bids = 0;
    let asks = 0;

    m.bids.forEach(level => {

        if (!level) return;

        const q = Number(level[1]);

        if (Number.isFinite(q)) {
            bids += q;
        }
    });

    m.asks.forEach(level => {

        if (!level) return;

        const q = Number(level[1]);

        if (Number.isFinite(q)) {
            asks += q;
        }
    });

    const total = bids + asks;

    if (total <= 0) {
        m.pressure = 50;
        return;
    }

    m.pressure =
        (bids / total) * 100;
}


/* =========================================================
   TRADE AKIŞI
========================================================= */

function calculateTradeScore(m) {

    const cutoff =
        now() - 15000;

    let buy = 0;
    let sell = 0;

    m.trades.forEach(t => {

        if (t.time < cutoff) return;

        const value =
            Math.max(
                1,
                t.price * t.quantity
            );

        if (
            t.side === "buy"
        ) {
            buy += value;
        }

        if (
            t.side === "sell"
        ) {
            sell += value;
        }
    });

    const total =
        buy + sell;

    if (total <= 0) {
        m.tradeScore = 50;
        return;
    }

    m.tradeScore =
        (buy / total) * 100;
}


/* =========================================================
   BORSA UYUMU
========================================================= */

function calculateExchangeScore(m) {

    const values = [];

    Object.keys(m.exchanges)
        .forEach(exchange => {

            const item =
                m.exchanges[exchange];

            if (!item || !item.price) {
                return;
            }

            values.push(item.price);
        });

    if (values.length < 2) {

        m.exchangeScore = 50;

        return;
    }

    const average =
        values.reduce(
            (a, b) => a + b,
            0
        ) / values.length;

    if (!average) {
        m.exchangeScore = 50;
        return;
    }

    let deviation = 0;

    values.forEach(price => {

        deviation +=
            Math.abs(
                price - average
            ) / average;
    });

    deviation =
        deviation / values.length;

    /*
       Küçük fiyat farkı = daha yüksek uyum
    */

    m.exchangeScore =
        Math.max(
            0,
            Math.min(
                100,
                100 -
                deviation * 100000
            )
        );
}


/* =========================================================
   AI SİNYAL
========================================================= */

function calculateSignal(m) {

    calculateMomentum(m);

    calculatePressure(m);

    calculateTradeScore(m);

    calculateExchangeScore(m);


    /*
       MOMENTUM SKORU
    */

    let momentumScore =
        50 +
        m.momentum5 * 8 +
        m.momentum15 * 4;

    momentumScore =
        Math.max(
            0,
            Math.min(
                100,
                momentumScore
            )
        );


    /*
       ORDER BOOK
    */

    m.bookScore =
        Math.max(
            0,
            Math.min(
                100,
                m.pressure
            )
        );


    /*
       AĞIRLIKLI AI
    */

    const score =
        momentumScore * 0.30 +
        m.bookScore * 0.30 +
        m.tradeScore * 0.25 +
        m.exchangeScore * 0.15;


    m.signal =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


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
                .map(symbol => {

                    const s =
                        symbol.toLowerCase();

                    return [
                        `${s}@trade`,
                        `${s}@depth10@100ms`
                    ];
                })
                .flat()
                .join("/");

        const ws =
            new WebSocket(
                `wss://stream.binance.com:9443/stream?streams=${streams}`
            );

        sockets.binance = ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Binance",
                true
            );

            log(
                "✓ Binance bağlantısı aktif"
            );
        };

        ws.onmessage = event => {

            try {

                const packet =
                    JSON.parse(
                        event.data
                    );

                const d =
                    packet.data;

                if (!d) return;

                if (
                    d.e === "trade"
                ) {

                    addTrade(
                        d.s,
                        d.p,
                        d.q,
                        d.m
                            ? "sell"
                            : "buy",
                        "Binance"
                    );
                }

                else if (
                    d.e === "depthUpdate"
                ) {

                    updateBook(
                        d.s,
                        d.b || [],
                        d.a || [],
                        "Binance"
                    );
                }

            }
            catch (e) {}
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

            setTimeout(
                connectBinance,
                CONFIG.reconnectDelay
            );
        };

    }
    catch (e) {

        setTimeout(
            connectBinance,
            CONFIG.reconnectDelay
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

        sockets.bybit = ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Bybit",
                true
            );

            const args = [];

            COINS.forEach(symbol => {

                if (
                    EXCLUDED.has(symbol)
                ) return;

                args.push(
                    `publicTrade.${symbol}`
                );

                args.push(
                    `orderbook.50.${symbol}`
                );
            });

            ws.send(
                JSON.stringify({
                    op: "subscribe",
                    args
                })
            );

            log(
                "✓ Bybit bağlantısı aktif"
            );
        };

        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );

                if (!msg.topic) return;

                const data =
                    msg.data;

                if (
                    msg.topic.startsWith(
                        "publicTrade."
                    )
                ) {

                    if (
                        !Array.isArray(data)
                    ) return;

                    data.forEach(t => {

                        addTrade(
                            t.s,
                            t.p,
                            t.v,
                            t.S === "Sell"
                                ? "sell"
                                : "buy",
                            "Bybit"
                        );
                    });
                }

                else if (
                    msg.topic.startsWith(
                        "orderbook."
                    )
                ) {

                    if (!data) return;

                    updateBook(
                        data.s,
                        data.b || [],
                        data.a || [],
                        "Bybit"
                    );
                }

            }
            catch (e) {}
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

            setTimeout(
                connectBybit,
                CONFIG.reconnectDelay
            );
        };

    }
    catch (e) {

        setTimeout(
            connectBybit,
            CONFIG.reconnectDelay
        );
    }
}


/* =========================================================
   OKX
========================================================= */

function connectOKX() {

    try {

        const ws =
            new WebSocket(
                "wss://ws.okx.com:8443/ws/v5/public"
            );

        sockets.okx = ws;

        ws.onopen = () => {

            setExchangeStatus(
                "OKX",
                true
            );

            const args = [];

            COINS.forEach(symbol => {

                if (
                    EXCLUDED.has(symbol)
                ) return;

                const base =
                    symbol.replace(
                        "USDT",
                        ""
                    );

                args.push({
                    channel: "trades",
                    instId: `${base}-USDT`
                });

                args.push({
                    channel: "books5",
                    instId: `${base}-USDT`
                });
            });

            ws.send(
                JSON.stringify({
                    op: "subscribe",
                    args
                })
            );

            log(
                "✓ OKX bağlantısı aktif"
            );
        };

        ws.onmessage = event => {

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
                    msg.arg.instId
                        .replace(
                            "-USDT",
                            "USDT"
                        );

                if (
                    msg.arg.channel ===
                    "trades"
                ) {

                    msg.data.forEach(t => {

                        addTrade(
                            symbol,
                            t.p,
                            t.sz,
                            t.side,
                            "OKX"
                        );
                    });
                }

                else if (
                    msg.arg.channel ===
                    "books5"
                ) {

                    const b =
                        msg.data[0];

                    if (!b) return;

                    updateBook(
                        symbol,
                        b.bids || [],
                        b.asks || [],
                        "OKX"
                    );
                }

            }
            catch (e) {}
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

            setTimeout(
                connectOKX,
                CONFIG.reconnectDelay
            );
        };

    }
    catch (e) {

        setTimeout(
            connectOKX,
            CONFIG.reconnectDelay
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

        sockets.coinbase = ws;

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

            ws.send(
                JSON.stringify({
                    type: "subscribe",
                    product_ids: products,
                    channel: "market_trades"
                })
            );

            log(
                "✓ Coinbase bağlantısı aktif"
            );
        };

        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );

                if (!msg.events) return;

                msg.events.forEach(ev => {

                    if (!ev.trades) return;

                    ev.trades.forEach(t => {

                        const symbol =
                            t.product_id
                                .replace(
                                    "-USD",
                                    "USDT"
                                );

                        addTrade(
                            symbol,
                            t.price,
                            t.size,
                            "buy",
                            "Coinbase"
                        );
                    });
                });

            }
            catch (e) {}
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

            setTimeout(
                connectCoinbase,
                CONFIG.reconnectDelay
            );
        };

    }
    catch (e) {

        setTimeout(
            connectCoinbase,
            CONFIG.reconnectDelay
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

        sockets.gate = ws;

        ws.onopen = () => {

            setExchangeStatus(
                "Gate.io",
                true
            );

            const timestamp =
                Math.floor(
                    Date.now() / 1000
                );

            COINS.forEach(symbol => {

                if (
                    EXCLUDED.has(symbol)
                ) return;

                const pair =
                    symbol.replace(
                        "USDT",
                        "_USDT"
                    );

                ws.send(
                    JSON.stringify({
                        time: timestamp,
                        channel: "spot.trades",
                        event: "subscribe",
                        payload: [pair]
                    })
                );

                ws.send(
                    JSON.stringify({
                        time: timestamp,
                        channel: "spot.order_book",
                        event: "subscribe",
                        payload: [
                            pair,
                            "10",
                            "100ms"
                        ]
                    })
                );
            });

            log(
                "✓ Gate.io bağlantısı aktif"
            );
        };

        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );

                if (!msg.result) return;

                if (
                    msg.channel ===
                    "spot.trades"
                ) {

                    const list =
                        Array.isArray(
                            msg.result
                        )
                            ? msg.result
                            : [msg.result];

                    list.forEach(t => {

                        if (
                            !t.currency_pair
                        ) return;

                        addTrade(
                            t.currency_pair
                                .replace(
                                    "_",
                                    ""
                                ),
                            t.price,
                            t.amount,
                            t.side,
                            "Gate.io"
                        );
                    });
                }

                else if (
                    msg.channel ===
                    "spot.order_book"
                ) {

                    const r =
                        msg.result;

                    if (!r) return;

                    const symbol =
                        r.s
                            ? r.s.replace(
                                "_",
                                ""
                            )
                            : null;

                    if (!symbol) return;

                    updateBook(
                        symbol,
                        r.bids || [],
                        r.asks || [],
                        "Gate.io"
                    );
                }

            }
            catch (e) {}
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

            setTimeout(
                connectGate,
                CONFIG.reconnectDelay
            );
        };

    }
    catch (e) {

        setTimeout(
            connectGate,
            CONFIG.reconnectDelay
        );
    }
}


/* =========================================================
   TÜM BORSALARI BAŞLAT
========================================================= */

function connectAll() {

    log(
        "Çoklu borsa motoru başlatılıyor..."
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


/* =========================================================
   RENK
========================================================= */

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
   SEÇİLİ COIN
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
            Math.round(m.signal);
    }

    if (text) {

        text.textContent =
            m.signalText;

        text.style.color =
            signalColor(m.signal);
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
            signalColor(m.signal);
    }

    if (price) {
        price.textContent =
            formatPrice(m.price);
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
            signalColor(m.pressure);
    }

    if (factorMomentum) {
        const momentumScore =
            Math.max(
                0,
                Math.min(
                    100,
                    50 +
                    m.momentum5 * 8 +
                    m.momentum15 * 4
                )
            );

        factorMomentum.textContent =
            Math.round(momentumScore);
    }

    if (factorBook) {
        factorBook.textContent =
            Math.round(m.bookScore);
    }

    if (factorTrade) {
        factorTrade.textContent =
            Math.round(m.tradeScore);
    }

    if (factorExchange) {
        factorExchange.textContent =
            Math.round(m.exchangeScore);
    }
}


/* =========================================================
   COIN LİSTESİ
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
        coins.map(m => {

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
                            ${m.symbol.replace("USDT", "")}
                        </span>

                        <span
                            class="coin-signal"
                            style="color:${color}"
                        >
                            ${m.signalText}
                        </span>

                    </div>

                    <div class="coin-price">
                        ${formatPrice(m.price)}
                    </div>

                    <div class="coin-bottom">

                        <span class="coin-momentum">
                            5s:
                            ${m.momentum5 >= 0 ? "+" : ""}
                            ${m.momentum5.toFixed(3)}%
                        </span>

                        <span>
                            AI:
                            <strong style="color:${color}">
                                ${Math.round(m.signal)}
                            </strong>
                        </span>

                    </div>

                </div>
            `;

        }).join("");


    container
        .querySelectorAll(".coin-card")
        .forEach(card => {

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

        });
}


/* =========================================================
   ORDER BOOK
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

    bids.innerHTML =
        m.bids
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(level => {

                return `
                    <div class="book-row">
                        <span>
                            ${formatPrice(
                                Number(level[0])
                            )}
                        </span>

                        <span>
                            ${Number(level[1])
                                .toFixed(4)}
                        </span>
                    </div>
                `;

            })
            .join("");


    asks.innerHTML =
        m.asks
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(level => {

                return `
                    <div class="book-row">
                        <span>
                            ${formatPrice(
                                Number(level[0])
                            )}
                        </span>

                        <span>
                            ${Number(level[1])
                                .toFixed(4)}
                        </span>
                    </div>
                `;

            })
            .join("");
}


/* =========================================================
   GENEL İSTATİSTİK
========================================================= */

function updateStats() {

    const active =
        Object.values(market)
            .filter(
                m => m.price > 0
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
   ARAMA
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
        `[V7.3] ${message}`
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
        box.children.length > 100
    ) {

        box.removeChild(
            box.lastChild
        );
    }
}


/* =========================================================
   LOG TEMİZLE
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
                box.innerHTML = "";
            }
        }
    );
}


/* =========================================================
   ANA UPDATE
========================================================= */

function updateUI() {

    Object.values(market)
        .forEach(m => {

            cleanup(m);
            calculateSignal(m);

        });

    updateStats();

    renderSelected();

    renderCoinList();

    renderOrderBook();
}


/* =========================================================
   BAŞLAT
========================================================= */

function start() {

    log(
        "================================"
    );

    log(
        "COIN ANALİZ TERMİNALİ V7.3"
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

    connectAll();

    setInterval(
        updateUI,
        CONFIG.updateRate
    );
}


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
