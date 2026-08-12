"use strict";

/* =========================================================
   ⚡ COIN ANALİZ TERMİNALİ V7.2
   MULTI EXCHANGE MARKET ENGINE

   Binance
   Bybit
   OKX
   Coinbase
   Gate.io

   5 BORSA BİRLİKTE ANALİZ
========================================================= */


/* =========================================================
   COINLER
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


/* =========================================================
   AYARLAR
========================================================= */

const CONFIG = {

    shortWindow: 5000,
    mediumWindow: 15000,
    longWindow: 60000,

    bookLevels: 10,

    reconnectDelay: 3000,

    updateRate: 500,

    signalBuy: 68,
    signalStrongBuy: 82,

    signalSell: 32,
    signalStrongSell: 18

};


/* =========================================================
   MARKET
========================================================= */

const market = {};

COINS.forEach(symbol => {

    if (EXCLUDED.has(symbol)) return;

    market[symbol] = {

        symbol,

        price: 0,

        previousPrice: 0,

        prices: [],

        trades: [],

        exchanges: {},

        bids: [],

        asks: [],

        momentum5: 0,

        momentum15: 0,

        pressure: 50,

        signal: 50,

        signalText: "NÖTR",

        lastUpdate: 0

    };

});


/* =========================================================
   BORSA İSTATİSTİKLERİ
========================================================= */

const exchangeStats = {

    Binance: {
        messages: 0,
        connected: false
    },

    Bybit: {
        messages: 0,
        connected: false
    },

    OKX: {
        messages: 0,
        connected: false
    },

    Coinbase: {
        messages: 0,
        connected: false
    },

    "Gate.io": {
        messages: 0,
        connected: false
    }

};


/* =========================================================
   GLOBAL
========================================================= */

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

let selectedCoin = "BTCUSDT";

const sockets = {};


/* =========================================================
   BYBIT LOCAL ORDER BOOK
========================================================= */

const bybitBooks = {};


/* =========================================================
   YARDIMCI
========================================================= */

function now() {

    return Date.now();

}


function normalizeSymbol(symbol) {

    if (!symbol) return null;

    return String(symbol)
        .toUpperCase()
        .replace(/[-_\/]/g, "");

}


function getMarket(symbol) {

    const s =
        normalizeSymbol(symbol);

    if (!s) return null;

    if (EXCLUDED.has(s)) return null;

    return market[s] || null;

}


function exchangeKey(exchange) {

    const map = {

        "Binance": "binance",
        "Bybit": "bybit",
        "OKX": "okx",
        "Coinbase": "coinbase",
        "Gate.io": "gate"

    };

    return map[exchange] || null;

}


/* =========================================================
   BORSA MESAJ SAYACI
========================================================= */

function countExchangeMessage(exchange) {

    if (!exchangeStats[exchange]) return;

    exchangeStats[exchange].messages++;

    totalMessages++;

    updateExchangeStatusUI(exchange);

}


/* =========================================================
   BORSA DURUMU
========================================================= */

function setExchangeStatus(
    exchange,
    connected
) {

    if (!exchangeStats[exchange]) return;

    exchangeStats[exchange].connected =
        connected;

    updateExchangeStatusUI(exchange);

    updateGlobalConnection();

}


/* =========================================================
   BORSA UI
========================================================= */

function updateExchangeStatusUI(exchange) {

    const key =
        exchangeKey(exchange);

    if (!key) return;

    const stats =
        exchangeStats[exchange];

    const status =
        document.getElementById(
            `${key}Status`
        );

    const dot =
        document.getElementById(
            `${key}Dot`
        );

    const counter =
        document.getElementById(
            `${key}Messages`
        );

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

    }

    if (counter) {

        counter.textContent =
            stats.messages.toLocaleString(
                "tr-TR"
            );

    }

}


/* =========================================================
   GENEL BAĞLANTI DURUMU
========================================================= */

function updateGlobalConnection() {

    const exchanges =
        Object.values(exchangeStats);

    const connected =
        exchanges.filter(
            x => x.connected
        ).length;

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
            `${connected}/5 borsa bağlı`;

    }

    if (dot) {

        dot.textContent =
            connected === 5
                ? "●"
                : "○";

    }

}


/* =========================================================
   PRICE
========================================================= */

function updateExchangePrice(
    symbol,
    price,
    exchange
) {

    const m =
        getMarket(symbol);

    if (!m) return;

    const p =
        Number(price);

    if (
        !Number.isFinite(p) ||
        p <= 0
    ) {
        return;
    }

    if (!m.exchanges[exchange]) {

        m.exchanges[exchange] = {

            price: 0,

            time: 0,

            bids: [],

            asks: []

        };

    }

    m.exchanges[exchange].price = p;

    m.exchanges[exchange].time = now();

    m.lastUpdate = now();

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

    const m =
        getMarket(symbol);

    if (!m) return;

    const p =
        Number(price);

    const q =
        Number(quantity);

    if (
        !Number.isFinite(p) ||
        p <= 0
    ) {
        return;
    }

    const qty =
        Number.isFinite(q) && q > 0
            ? q
            : 0;

    const time =
        now();

    m.trades.push({

        time: time,

        price: p,

        quantity: qty,

        side:
            side || "unknown",

        exchange:
            exchange

    });

    updateExchangePrice(
        symbol,
        p,
        exchange
    );

    totalTrades++;

    countExchangeMessage(exchange);

    cleanup(m);

}


/* =========================================================
   BORSA ORDER BOOK
========================================================= */

function saveExchangeBook(
    symbol,
    bids,
    asks,
    exchange
) {

    const m =
        getMarket(symbol);

    if (!m) return;

    if (!m.exchanges[exchange]) {

        m.exchanges[exchange] = {

            price: 0,

            time: 0,

            bids: [],

            asks: []

        };

    }

    m.exchanges[exchange].bids =
        normalizeBook(bids);

    m.exchanges[exchange].asks =
        normalizeBook(asks);

    m.exchanges[exchange].time =
        now();

    totalBooks++;

    countExchangeMessage(exchange);

    aggregateOrderBook(m);

}


/* =========================================================
   ORDER BOOK NORMALİZE
========================================================= */

function normalizeBook(levels) {

    if (!Array.isArray(levels)) {

        return [];

    }

    return levels

        .map(level => {

            if (!Array.isArray(level)) {
                return null;
            }

            const price =
                Number(level[0]);

            const quantity =
                Number(level[1]);

            if (
                !Number.isFinite(price) ||
                !Number.isFinite(quantity) ||
                price <= 0 ||
                quantity < 0
            ) {

                return null;

            }

            return [
                price,
                quantity
            ];

        })

        .filter(Boolean);

}


/* =========================================================
   ÇOKLU BORSA ORDER BOOK BİRLEŞTİR
========================================================= */

function aggregateOrderBook(m) {

    const bids = [];
    const asks = [];

    Object.values(m.exchanges)
        .forEach(exchange => {

            if (!exchange) return;

            if (Array.isArray(exchange.bids)) {

                exchange.bids.forEach(level => {

                    bids.push({

                        price:
                            Number(level[0]),

                        quantity:
                            Number(level[1]),

                        exchange:
                            "multi"

                    });

                });

            }

            if (Array.isArray(exchange.asks)) {

                exchange.asks.forEach(level => {

                    asks.push({

                        price:
                            Number(level[0]),

                        quantity:
                            Number(level[1]),

                        exchange:
                            "multi"

                    });

                });

            }

        });


    bids.sort(
        (a, b) =>
            b.price - a.price
    );


    asks.sort(
        (a, b) =>
            a.price - b.price
    );


    m.bids =
        bids.slice(
            0,
            CONFIG.bookLevels
        ).map(x => [
            x.price,
            x.quantity
        ]);


    m.asks =
        asks.slice(
            0,
            CONFIG.bookLevels
        ).map(x => [
            x.price,
            x.quantity
        ]);


    calculatePressure(m);

}


/* =========================================================
   TEMİZLİK
========================================================= */

function cleanup(m) {

    const limit =
        now() -
        CONFIG.longWindow;

    m.trades =
        m.trades.filter(
            t =>
                t.time >= limit
        );

    m.prices =
        m.prices.filter(
            p =>
                p.time >= limit
        );

}


/* =========================================================
   BİRLEŞİK FİYAT
========================================================= */

function calculateCompositePrice(m) {

    const limit =
        now() -
        CONFIG.mediumWindow;

    const trades =
        m.trades.filter(
            t =>
                t.time >= limit &&
                t.price > 0
        );


    if (trades.length) {

        let totalValue = 0;

        let totalVolume = 0;

        trades.forEach(t => {

            const qty =
                t.quantity > 0
                    ? t.quantity
                    : 1;

            totalValue +=
                t.price * qty;

            totalVolume +=
                qty;

        });


        if (totalVolume > 0) {

            return (
                totalValue /
                totalVolume
            );

        }

    }


    const prices = [];

    Object.values(m.exchanges)
        .forEach(e => {

            if (
                e &&
                e.price > 0 &&
                now() - e.time < 10000
            ) {

                prices.push(e.price);

            }

        });


    if (!prices.length) {

        return m.price || 0;

    }


    return (
        prices.reduce(
            (a, b) => a + b,
            0
        ) / prices.length
    );

}


/* =========================================================
   MOMENTUM
========================================================= */

function calculateMomentum(m) {

    const current =
        calculateCompositePrice(m);

    if (!current) {

        m.momentum5 = 0;

        m.momentum15 = 0;

        return;

    }


    const t =
        now();


    let old5 = null;

    let old15 = null;


    for (
        let i =
            m.prices.length - 1;
        i >= 0;
        i--
    ) {

        const item =
            m.prices[i];


        if (
            !old5 &&
            t - item.time >=
            CONFIG.shortWindow
        ) {

            old5 = item;

        }


        if (
            !old15 &&
            t - item.time >=
            CONFIG.mediumWindow
        ) {

            old15 = item;

        }


        if (
            old5 &&
            old15
        ) {

            break;

        }

    }


    m.momentum5 =
        old5
            ? (
                (current - old5.price) /
                old5.price
            ) * 100
            : 0;


    m.momentum15 =
        old15
            ? (
                (current - old15.price) /
                old15.price
            ) * 100
            : 0;


    m.previousPrice =
        m.price;

    m.price =
        current;


    m.prices.push({

        time: t,

        price: current

    });


    cleanup(m);

}


/* =========================================================
   BASKI
========================================================= */

function calculatePressure(m) {

    let bidVolume = 0;

    let askVolume = 0;


    Object.values(m.exchanges)
        .forEach(exchange => {

            if (!exchange) return;


            if (
                Array.isArray(
                    exchange.bids
                )
            ) {

                exchange.bids
                    .slice(
                        0,
                        CONFIG.bookLevels
                    )
                    .forEach(level => {

                        const price =
                            Number(level[0]);

                        const quantity =
                            Number(level[1]);

                        if (
                            price > 0 &&
                            quantity > 0
                        ) {

                            bidVolume +=
                                price *
                                quantity;

                        }

                    });

            }


            if (
                Array.isArray(
                    exchange.asks
                )
            ) {

                exchange.asks
                    .slice(
                        0,
                        CONFIG.bookLevels
                    )
                    .forEach(level => {

                        const price =
                            Number(level[0]);

                        const quantity =
                            Number(level[1]);

                        if (
                            price > 0 &&
                            quantity > 0
                        ) {

                            askVolume +=
                                price *
                                quantity;

                        }

                    });

            }

        });


    const total =
        bidVolume +
        askVolume;


    if (total <= 0) {

        m.pressure = 50;

        return;

    }


    m.pressure =
        (
            bidVolume /
            total
        ) * 100;

}


/* =========================================================
   SİNYAL
========================================================= */

function calculateSignal(m) {

    calculateMomentum(m);

    calculatePressure(m);


    let score = 50;


    score +=
        m.momentum5 * 8;


    score +=
        m.momentum15 * 5;


    score +=
        (m.pressure - 50) *
        0.35;


    score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    m.signal =
        score;


    if (
        score >=
        CONFIG.signalStrongBuy
    ) {

        m.signalText =
            "GÜÇLÜ AL";

    }
    else if (
        score >=
        CONFIG.signalBuy
    ) {

        m.signalText =
            "AL";

    }
    else if (
        score <=
        CONFIG.signalStrongSell
    ) {

        m.signalText =
            "GÜÇLÜ SAT";

    }
    else if (
        score <=
        CONFIG.signalSell
    ) {

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
                    s =>
                        !EXCLUDED.has(s)
                )
                .map(s => {

                    const x =
                        s.toLowerCase();

                    return [
                        `${x}@trade`,
                        `${x}@depth10@100ms`
                    ];

                })
                .flat()
                .join("/");


        const url =
            "wss://stream.binance.com:9443/stream?streams=" +
            streams;


        const ws =
            new WebSocket(url);


        sockets.binance =
            ws;


        ws.onopen = () => {

            setExchangeStatus(
                "Binance",
                true
            );

            log(
                "Binance bağlantısı aktif"
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


                if (d.e === "trade") {

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
                    d.e ===
                    "depthUpdate"
                ) {

                    saveExchangeBook(
                        d.s,
                        d.b || [],
                        d.a || [],
                        "Binance"
                    );

                }

            }
            catch (e) {

                console.error(
                    "Binance error",
                    e
                );

            }

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


        ws.onerror = () => {

            setExchangeStatus(
                "Binance",
                false
            );

        };

    }
    catch (e) {

        console.error(e);

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

                    op:
                        "subscribe",

                    args:
                        args

                })
            );


            log(
                "Bybit bağlantısı aktif"
            );

        };


        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );


                if (
                    msg.op === "pong"
                ) {

                    return;

                }


                if (
                    !msg.topic
                ) {

                    return;

                }


                countExchangeMessage(
                    "Bybit"
                );


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

                    return;

                }


                if (
                    msg.topic.startsWith(
                        "orderbook."
                    )
                ) {

                    if (!data) return;


                    const symbol =
                        normalizeSymbol(
                            data.s
                        );


                    if (!symbol) return;


                    if (
                        !bybitBooks[symbol]
                    ) {

                        bybitBooks[symbol] = {

                            bids: new Map(),

                            asks: new Map()

                        };

                    }


                    const book =
                        bybitBooks[symbol];


                    if (
                        msg.type ===
                        "snapshot"
                    ) {

                        book.bids.clear();

                        book.asks.clear();


                        (data.b || [])
                            .forEach(level => {

                                const p =
                                    Number(
                                        level[0]
                                    );

                                const q =
                                    Number(
                                        level[1]
                                    );

                                if (
                                    p > 0 &&
                                    q > 0
                                ) {

                                    book.bids.set(
                                        p,
                                        q
                                    );

                                }

                            });


                        (data.a || [])
                            .forEach(level => {

                                const p =
                                    Number(
                                        level[0]
                                    );

                                const q =
                                    Number(
                                        level[1]
                                    );

                                if (
                                    p > 0 &&
                                    q > 0
                                ) {

                                    book.asks.set(
                                        p,
                                        q
                                    );

                                }

                            });

                    }
                    else {

                        (data.b || [])
                            .forEach(level => {

                                const p =
                                    Number(
                                        level[0]
                                    );

                                const q =
                                    Number(
                                        level[1]
                                    );

                                if (
                                    q === 0
                                ) {

                                    book.bids.delete(p);

                                }
                                else if (
                                    p > 0
                                ) {

                                    book.bids.set(
                                        p,
                                        q
                                    );

                                }

                            });


                        (data.a || [])
                            .forEach(level => {

                                const p =
                                    Number(
                                        level[0]
                                    );

                                const q =
                                    Number(
                                        level[1]
                                    );

                                if (
                                    q === 0
                                ) {

                                    book.asks.delete(p);

                                }
                                else if (
                                    p > 0
                                ) {

                                    book.asks.set(
                                        p,
                                        q
                                    );

                                }

                            });

                    }


                    const bids =
                        Array.from(
                            book.bids.entries()
                        )
                        .sort(
                            (a, b) =>
                                b[0] - a[0]
                        )
                        .slice(
                            0,
                            50
                        );


                    const asks =
                        Array.from(
                            book.asks.entries()
                        )
                        .sort(
                            (a, b) =>
                                a[0] - b[0]
                        )
                        .slice(
                            0,
                            50
                        );


                    saveExchangeBook(
                        symbol,
                        bids,
                        asks,
                        "Bybit"
                    );

                }

            }
            catch (e) {

                console.error(
                    "Bybit error",
                    e
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


            setTimeout(
                connectBybit,
                CONFIG.reconnectDelay
            );

        };


        /* BYBIT HEARTBEAT */

        setInterval(() => {

            if (
                sockets.bybit === ws &&
                ws.readyState ===
                WebSocket.OPEN
            ) {

                ws.send(
                    JSON.stringify({
                        op: "ping"
                    })
                );

            }

        }, 20000);

    }
    catch (e) {

        console.error(e);

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


        sockets.okx =
            ws;


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


                const inst =
                    `${base}-USDT`;


                args.push({

                    channel:
                        "trades",

                    instId:
                        inst

                });


                args.push({

                    channel:
                        "books5",

                    instId:
                        inst

                });

            });


            ws.send(
                JSON.stringify({

                    op:
                        "subscribe",

                    args:
                        args

                })
            );


            log(
                "OKX bağlantısı aktif"
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


                countExchangeMessage(
                    "OKX"
                );


                const inst =
                    msg.arg.instId;


                const symbol =
                    inst.replace(
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

                    const book =
                        msg.data[0];


                    if (!book) return;


                    saveExchangeBook(

                        symbol,

                        book.bids || [],

                        book.asks || [],

                        "OKX"

                    );

                }

            }
            catch (e) {

                console.error(
                    "OKX error",
                    e
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


            setTimeout(
                connectOKX,
                CONFIG.reconnectDelay
            );

        };

    }
    catch (e) {

        console.error(e);

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
                        s =>
                            !EXCLUDED.has(s)
                    )
                    .map(
                        s =>
                            s.replace(
                                "USDT",
                                "-USD"
                            )
                    );


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


            log(
                "Coinbase bağlantısı aktif"
            );

        };


        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );


                if (
                    !msg.events
                ) return;


                msg.events.forEach(ev => {

                    if (
                        !ev.trades
                    ) return;


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

                            t.side ||
                                "unknown",

                            "Coinbase"

                        );

                    });

                });

            }
            catch (e) {

                console.error(
                    "Coinbase error",
                    e
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


            setTimeout(
                connectCoinbase,
                CONFIG.reconnectDelay
            );

        };

    }
    catch (e) {

        console.error(e);

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

                        time:
                            Math.floor(
                                Date.now() / 1000
                            ),

                        channel:
                            "spot.trades",

                        event:
                            "subscribe",

                        payload:
                            [pair]

                    })
                );


                ws.send(
                    JSON.stringify({

                        time:
                            Math.floor(
                                Date.now() / 1000
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

            });


            log(
                "Gate.io bağlantısı aktif"
            );

        };


        ws.onmessage = event => {

            try {

                const msg =
                    JSON.parse(
                        event.data
                    );


                if (
                    !msg.result
                ) return;


                countExchangeMessage(
                    "Gate.io"
                );


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


                    list.forEach(t => {

                        const symbol =
                            t.currency_pair
                                ? t.currency_pair
                                    .replace(
                                        "_",
                                        ""
                                    )
                                : null;


                        if (!symbol) return;


                        addTrade(

                            symbol,

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


                    saveExchangeBook(

                        symbol,

                        r.bids || [],

                        r.asks || [],

                        "Gate.io"

                    );

                }

            }
            catch (e) {

                console.error(
                    "Gate error",
                    e
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


            setTimeout(
                connectGate,
                CONFIG.reconnectDelay
            );

        };

    }
    catch (e) {

        console.error(e);

    }

}


/* =========================================================
   ORDER BOOK GÖSTER
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


    if (
        !bids ||
        !asks
    ) return;


    bids.innerHTML =
        m.bids
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(level => {

                return `
                    <div class="book-row">
                        <span>${Number(level[0]).toFixed(6)}</span>
                        <span>${Number(level[1]).toFixed(4)}</span>
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
                        <span>${Number(level[0]).toFixed(6)}</span>
                        <span>${Number(level[1]).toFixed(4)}</span>
                    </div>
                `;

            })
            .join("");

}


/* =========================================================
   SEÇİLİ COIN
========================================================= */

function renderSelected() {

    const m =
        market[selectedCoin];

    if (!m) return;


    const momentum5 =
        document.getElementById(
            "momentum5"
        );

    const momentum15 =
        document.getElementById(
            "momentum15"
        );

    const pressure =
        document.getElementById(
            "detailPressure"
        );


    if (momentum5) {

        momentum5.textContent =
            `${m.momentum5 >= 0 ? "+" : ""}${m.momentum5.toFixed(3)}%`;

    }


    if (momentum15) {

        momentum15.textContent =
            `${m.momentum15 >= 0 ? "+" : ""}${m.momentum15.toFixed(3)}%`;

    }


    if (pressure) {

        pressure.textContent =
            `${m.pressure.toFixed(1)}%`;

    }

}


/* =========================================================
   İSTATİSTİKLER
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

    const messageEl =
        document.getElementById(
            "totalMessages"
        );

    const tradeEl =
        document.getElementById(
            "totalTrades"
        );

    const bookEl =
        document.getElementById(
            "totalBooks"
        );


    if (activeEl) {

        activeEl.textContent =
            active;

    }


    if (messageEl) {

        messageEl.textContent =
            totalMessages.toLocaleString(
                "tr-TR"
            );

    }


    if (tradeEl) {

        tradeEl.textContent =
            totalTrades.toLocaleString(
                "tr-TR"
            );

    }


    if (bookEl) {

        bookEl.textContent =
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


            if (
                found &&
                market[found]
            ) {

                selectedCoin =
                    found;


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
        `[V7.2] ${message}`
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
        `${new Date().toLocaleTimeString("tr-TR")} — ${message}`;


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

                box.innerHTML =
                    "";

            }

        }
    );

}


/* =========================================================
   UI GÜNCELLE
========================================================= */

function updateUI() {

    Object.values(market)
        .forEach(m => {

            cleanup(m);

            calculateSignal(m);

        });


    updateStats();

    renderSelected();

    renderOrderBook();

    updateGlobalConnection();


    Object.keys(exchangeStats)
        .forEach(
            updateExchangeStatusUI
        );

}


/* =========================================================
   TÜM BORSA BAĞLANTILARI
========================================================= */

function connect() {

    log(
        "V7.2 çoklu borsa motoru başlatılıyor..."
    );


    connectBinance();

    connectBybit();

    connectOKX();

    connectCoinbase();

    connectGate();

}


/* =========================================================
   START
========================================================= */

function start() {

    console.log(
        "================================"
    );

    console.log(
        "COIN ANALİZ TERMİNALİ V7.2"
    );

    console.log(
        "MULTI EXCHANGE ENGINE"
    );

    console.log(
        "================================"
    );


    setupSearch();

    setupLogButton();

    renderSelected();

    renderOrderBook();


    setConnection(
        "5 borsaya bağlanıyor..."
    );


    connect();


    setInterval(
        updateUI,
        CONFIG.updateRate
    );

}


/* =========================================================
   ANA BAĞLANTI YAZISI
========================================================= */

function setConnection(text) {

    const status =
        document.getElementById(
            "connectionStatus"
        );


    if (status) {

        status.textContent =
            text;

    }

}


/* =========================================================
   DOM
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
