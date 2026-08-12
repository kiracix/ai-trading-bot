"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V7.1
   MULTI EXCHANGE MARKET ENGINE

   Binance
   Bybit
   OKX
   Coinbase
   Gate.io
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

    freshPrice: 10000,
    bookLevels: 10,

    reconnectDelay: 4000,
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

    market[symbol] = {

        symbol,

        price: 0,
        previousPrice: 0,

        prices: [],
        trades: [],

        bids: [],
        asks: [],

        books: {},
        exchanges: {},

        momentum5: 0,
        momentum15: 0,

        pressure: 50,

        signal: 50,
        signalText: "NÖTR",

        lastUpdate: 0
    };

});


/* =========================================================
   EXCHANGES
========================================================= */

const EXCHANGES = [
    "Binance",
    "Bybit",
    "OKX",
    "Coinbase",
    "Gate.io"
];

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
   GLOBAL
========================================================= */

const sockets = {};

const retryTimers = {};

const bybitBooks = {};

const coinbaseBooks = {};

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

let selectedCoin = "BTCUSDT";


/* =========================================================
   SYMBOL NORMALIZE
========================================================= */

function normalizeSymbol(symbol) {

    if (!symbol) {
        return null;
    }

    let s = String(symbol)
        .toUpperCase()
        .replace(/[-_]/g, "");

    if (
        s.endsWith("USD") &&
        !s.endsWith("USDT")
    ) {

        s =
            s.slice(0, -3) +
            "USDT";

    }

    return s;

}


/* =========================================================
   MARKET GET
========================================================= */

function getMarket(symbol) {

    const s =
        normalizeSymbol(symbol);

    if (!s) {
        return null;
    }

    if (
        EXCLUDED.has(s)
    ) {
        return null;
    }

    return market[s] || null;

}


/* =========================================================
   EXCHANGE KEY
========================================================= */

function getExchangeKey(exchange) {

    const map = {

        Binance: "binance",
        Bybit: "bybit",
        OKX: "okx",
        Coinbase: "coinbase",
        "Gate.io": "gate"

    };

    return map[exchange] || null;

}


/* =========================================================
   LOG
========================================================= */

function log(message) {

    console.log(
        "[V7.1]",
        message
    );

    const box =
        document.getElementById("log");

    if (!box) {
        return;
    }

    const line =
        document.createElement("div");

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
   EXCHANGE STATUS
========================================================= */

function setExchangeStatus(
    exchange,
    connected
) {

    if (
        !exchangeStats[exchange]
    ) {
        return;
    }

    exchangeStats[exchange].connected =
        connected;

    updateExchangeUI(exchange);

    updateMainConnection();

}


/* =========================================================
   EXCHANGE UI
========================================================= */

function updateExchangeUI(exchange) {

    const key =
        getExchangeKey(exchange);

    if (!key) {
        return;
    }

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
   MAIN CONNECTION
========================================================= */

function updateMainConnection() {

    const connected =
        EXCHANGES.filter(
            exchange =>
                exchangeStats[exchange]
                    .connected
        );

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
            connected.length > 0
                ? `${connected.length}/5 borsa bağlı`
                : "Borsalara bağlanıyor...";

    }

    if (dot) {

        dot.textContent =
            connected.length > 0
                ? "●"
                : "○";

    }

}


/* =========================================================
   MESSAGE COUNTER
========================================================= */

function countMessage(exchange) {

    totalMessages++;

    if (
        exchangeStats[exchange]
    ) {

        exchangeStats[exchange]
            .messages++;

    }

    updateExchangeUI(exchange);

}


/* =========================================================
   RECONNECT
========================================================= */

function scheduleReconnect(
    name,
    callback
) {

    clearTimeout(
        retryTimers[name]
    );

    retryTimers[name] =
        setTimeout(
            callback,
            CONFIG.reconnectDelay
        );

}


/* =========================================================
   PRICE UPDATE
========================================================= */

function updatePrice(
    symbol,
    price,
    exchange
) {

    const m =
        getMarket(symbol);

    const p =
        Number(price);

    if (
        !m ||
        !Number.isFinite(p) ||
        p <= 0
    ) {
        return;
    }

    const now =
        Date.now();

    m.exchanges[exchange] = {

        price: p,

        time: now

    };

    /*
       Son 10 saniyede veri gönderen
       borsaların fiyatlarını kullan.
    */

    const validPrices =
        Object.values(
            m.exchanges
        )
        .filter(
            x =>
                now - x.time <=
                CONFIG.freshPrice
        )
        .map(
            x => x.price
        );

    if (!validPrices.length) {
        return;
    }

    const average =
        validPrices.reduce(
            (a, b) => a + b,
            0
        ) /
        validPrices.length;

    m.previousPrice =
        m.price;

    m.price =
        average;

    m.lastUpdate =
        now;

    m.prices.push({

        time: now,

        price: average

    });

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

    const m =
        getMarket(symbol);

    const p =
        Number(price);

    const q =
        Number(quantity);

    if (
        !m ||
        !Number.isFinite(p) ||
        p <= 0
    ) {
        return;
    }

    m.trades.push({

        time:
            Date.now(),

        price:
            p,

        quantity:
            Number.isFinite(q)
                ? q
                : 0,

        side:
            side || "unknown",

        exchange:
            exchange

    });

    totalTrades++;

    updatePrice(
        symbol,
        p,
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

    const m =
        getMarket(symbol);

    if (!m) {
        return;
    }

    m.books[exchange] = {

        bids:
            Array.isArray(bids)
                ? bids.slice(
                    0,
                    CONFIG.bookLevels
                )
                : [],

        asks:
            Array.isArray(asks)
                ? asks.slice(
                    0,
                    CONFIG.bookLevels
                )
                : [],

        time:
            Date.now()

    };

    totalBooks++;

    countMessage(exchange);

    combineBooks(m);

}


/* =========================================================
   COMBINE ORDER BOOKS
========================================================= */

function combineBooks(m) {

    const bids = [];
    const asks = [];

    Object.values(
        m.books
    ).forEach(book => {

        if (!book) {
            return;
        }

        (book.bids || [])
            .forEach(level => {

                bids.push([
                    Number(level[0]),
                    Number(level[1])
                ]);

            });

        (book.asks || [])
            .forEach(level => {

                asks.push([
                    Number(level[0]),
                    Number(level[1])
                ]);

            });

    });


    bids.sort(
        (a, b) =>
            b[0] - a[0]
    );

    asks.sort(
        (a, b) =>
            a[0] - b[0]
    );


    m.bids =
        bids.slice(
            0,
            CONFIG.bookLevels
        );

    m.asks =
        asks.slice(
            0,
            CONFIG.bookLevels
        );


    calculatePressure(m);

}


/* =========================================================
   CLEANUP
========================================================= */

function cleanup(m) {

    const now =
        Date.now();

    const limit =
        now -
        CONFIG.longWindow;


    m.prices =
        m.prices.filter(
            item =>
                item.time >= limit
        );


    m.trades =
        m.trades.filter(
            item =>
                item.time >= limit
        );


    Object.keys(
        m.exchanges
    ).forEach(exchange => {

        if (
            now -
            m.exchanges[exchange].time >
            CONFIG.freshPrice
        ) {

            delete m.exchanges[
                exchange
            ];

        }

    });


    Object.keys(
        m.books
    ).forEach(exchange => {

        if (
            now -
            m.books[exchange].time >
            15000
        ) {

            delete m.books[
                exchange
            ];

        }

    });


    combineBooks(m);

}


/* =========================================================
   PRESSURE
========================================================= */

function calculatePressure(m) {

    let bidVolume = 0;

    let askVolume = 0;


    m.bids.forEach(level => {

        const q =
            Number(level[1]);

        if (
            Number.isFinite(q)
        ) {

            bidVolume += q;

        }

    });


    m.asks.forEach(level => {

        const q =
            Number(level[1]);

        if (
            Number.isFinite(q)
        ) {

            askVolume += q;

        }

    });


    const total =
        bidVolume +
        askVolume;


    if (
        total <= 0
    ) {

        m.pressure = 50;

        return;

    }


    m.pressure =
        (
            bidVolume /
            total
        ) *
        100;

}


/* =========================================================
   SIGNAL
========================================================= */

function calculateSignal(m) {

    const now =
        Date.now();

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

        const age =
            now -
            item.time;


        if (
            !old5 &&
            age >=
            CONFIG.shortWindow
        ) {

            old5 =
                item;

        }


        if (
            !old15 &&
            age >=
            CONFIG.mediumWindow
        ) {

            old15 =
                item;

        }


        if (
            old5 &&
            old15
        ) {

            break;

        }

    }


    if (
        old5 &&
        m.price
    ) {

        m.momentum5 =
            (
                (
                    m.price -
                    old5.price
                ) /
                old5.price
            ) *
            100;

    }
    else {

        m.momentum5 =
            0;

    }


    if (
        old15 &&
        m.price
    ) {

        m.momentum15 =
            (
                (
                    m.price -
                    old15.price
                ) /
                old15.price
            ) *
            100;

    }
    else {

        m.momentum15 =
            0;

    }


    let score =
        50;


    score +=
        m.momentum5 *
        8;


    score +=
        m.momentum15 *
        5;


    score +=
        (
            m.pressure -
            50
        ) *
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
                "wss://stream.binance.com:443/stream?streams=" +
                streams
            );


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

                const data =
                    packet.data;

                if (!data) {
                    return;
                }


                if (
                    data.e ===
                    "trade"
                ) {

                    addTrade(
                        data.s,
                        data.p,
                        data.q,
                        data.m
                            ? "sell"
                            : "buy",
                        "Binance"
                    );

                }


                if (
                    data.e ===
                    "depthUpdate"
                ) {

                    updateBook(
                        data.s,
                        data.b || [],
                        data.a || [],
                        "Binance"
                    );

                }

            }
            catch (error) {

                console.error(
                    "Binance error",
                    error
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
                "binance",
                connectBinance
            );

        };

    }
    catch (error) {

        setExchangeStatus(
            "Binance",
            false
        );

        scheduleReconnect(
            "binance",
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


            COINS.forEach(symbol => {

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

                const message =
                    JSON.parse(
                        event.data
                    );


                if (
                    !message.topic ||
                    !message.data
                ) {

                    return;

                }


                if (
                    message.topic.startsWith(
                        "publicTrade."
                    )
                ) {

                    (
                        message.data || []
                    ).forEach(
                        tradeData => {

                            addTrade(

                                tradeData.s,

                                tradeData.p,

                                tradeData.v,

                                tradeData.S ===
                                    "Sell"
                                    ? "sell"
                                    : "buy",

                                "Bybit"

                            );

                        }
                    );

                }


                if (
                    message.topic.startsWith(
                        "orderbook."
                    )
                ) {

                    const data =
                        message.data;

                    const symbol =
                        normalizeSymbol(
                            data.s
                        );

                    if (!symbol) {
                        return;
                    }


                    if (
                        !bybitBooks[symbol] ||
                        message.type ===
                            "snapshot"
                    ) {

                        bybitBooks[symbol] = {

                            bids: {},
                            asks: {}

                        };

                    }


                    (
                        data.b || []
                    ).forEach(level => {

                        const price =
                            String(
                                level[0]
                            );

                        const qty =
                            Number(
                                level[1]
                            );


                        if (
                            qty === 0
                        ) {

                            delete bybitBooks[
                                symbol
                            ].bids[price];

                        }
                        else {

                            bybitBooks[
                                symbol
                            ].bids[price] =
                                qty;

                        }

                    });


                    (
                        data.a || []
                    ).forEach(level => {

                        const price =
                            String(
                                level[0]
                            );

                        const qty =
                            Number(
                                level[1]
                            );


                        if (
                            qty === 0
                        ) {

                            delete bybitBooks[
                                symbol
                            ].asks[price];

                        }
                        else {

                            bybitBooks[
                                symbol
                            ].asks[price] =
                                qty;

                        }

                    });


                    const bids =
                        Object.entries(
                            bybitBooks[
                                symbol
                            ].bids
                        )
                        .map(
                            x => [
                                x[0],
                                x[1]
                            ]
                        )
                        .sort(
                            (a, b) =>
                                Number(b[0]) -
                                Number(a[0])
                        )
                        .slice(
                            0,
                            CONFIG.bookLevels
                        );


                    const asks =
                        Object.entries(
                            bybitBooks[
                                symbol
                            ].asks
                        )
                        .map(
                            x => [
                                x[0],
                                x[1]
                            ]
                        )
                        .sort(
                            (a, b) =>
                                Number(a[0]) -
                                Number(b[0])
                        )
                        .slice(
                            0,
                            CONFIG.bookLevels
                        );


                    updateBook(
                        symbol,
                        bids,
                        asks,
                        "Bybit"
                    );

                }

            }
            catch (error) {

                console.error(
                    "Bybit error",
                    error
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
                "bybit",
                connectBybit
            );

        };

    }
    catch (error) {

        setExchangeStatus(
            "Bybit",
            false
        );

        scheduleReconnect(
            "bybit",
            connectBybit
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


        sockets.okx =
            ws;


        ws.onopen = () => {

            setExchangeStatus(
                "OKX",
                true
            );


            const args = [];


            COINS.forEach(symbol => {

                const base =
                    symbol.replace(
                        "USDT",
                        ""
                    );


                args.push({

                    channel:
                        "trades",

                    instId:
                        `${base}-USDT`

                });


                args.push({

                    channel:
                        "books5",

                    instId:
                        `${base}-USDT`

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

                const message =
                    JSON.parse(
                        event.data
                    );


                if (
                    !message.arg ||
                    !message.data
                ) {

                    return;

                }


                const symbol =
                    normalizeSymbol(
                        message.arg.instId
                    );


                if (
                    message.arg.channel ===
                    "trades"
                ) {

                    message.data.forEach(
                        tradeData => {

                            addTrade(

                                symbol,

                                tradeData.p,

                                tradeData.sz,

                                tradeData.side,

                                "OKX"

                            );

                        }
                    );

                }


                if (
                    message.arg.channel ===
                    "books5"
                ) {

                    const book =
                        message.data[0];

                    if (!book) {
                        return;
                    }


                    updateBook(

                        symbol,

                        book.bids || [],

                        book.asks || [],

                        "OKX"

                    );

                }

            }
            catch (error) {

                console.error(
                    "OKX error",
                    error
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
                "okx",
                connectOKX
            );

        };

    }
    catch (error) {

        setExchangeStatus(
            "OKX",
            false
        );

        scheduleReconnect(
            "okx",
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


        const products =
            COINS
                .filter(
                    symbol =>
                        symbol !==
                        "BNBUSDT"
                )
                .map(
                    symbol =>
                        symbol.replace(
                            "USDT",
                            "-USD"
                        )
                );


        ws.onopen = () => {

            setExchangeStatus(
                "Coinbase",
                true
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


            ws.send(
                JSON.stringify({

                    type:
                        "subscribe",

                    channel:
                        "heartbeats"

                })
            );


            log(
                "Coinbase bağlantısı aktif"
            );

        };


        ws.onmessage = event => {

            try {

                const message =
                    JSON.parse(
                        event.data
                    );


                if (
                    !Array.isArray(
                        message.events
                    )
                ) {

                    return;

                }


                message.events.forEach(
                    eventData => {

                        if (
                            Array.isArray(
                                eventData.trades
                            )
                        ) {

                            eventData.trades
                                .forEach(
                                    tradeData => {

                                        addTrade(

                                            tradeData.product_id,

                                            tradeData.price,

                                            tradeData.size,

                                            tradeData.side,

                                            "Coinbase"

                                        );

                                    }
                                );

                        }


                        if (
                            Array.isArray(
                                eventData.updates
                            )
                        ) {

                            eventData.updates
                                .forEach(
                                    update => {

                                        const symbol =
                                            normalizeSymbol(
                                                update.product_id
                                            );

                                        if (
                                            !symbol
                                        ) {
                                            return;
                                        }


                                        if (
                                            !coinbaseBooks[
                                                symbol
                                            ]
                                        ) {

                                            coinbaseBooks[
                                                symbol
                                            ] = {

                                                bids: {},
                                                asks: {}

                                            };

                                        }


                                        const side =
                                            String(
                                                update.side ||
                                                ""
                                            )
                                            .toLowerCase()
                                            .startsWith(
                                                "bid"
                                            )
                                                ? "bids"
                                                : "asks";


                                        const price =
                                            String(
                                                update.price_level
                                            );


                                        const quantity =
                                            Number(
                                                update.new_quantity
                                            );


                                        if (
                                            quantity === 0
                                        ) {

                                            delete coinbaseBooks[
                                                symbol
                                            ][side][
                                                price
                                            ];

                                        }
                                        else {

                                            coinbaseBooks[
                                                symbol
                                            ][side][
                                                price
                                            ] =
                                                quantity;

                                        }


                                        const bids =
                                            Object.entries(
                                                coinbaseBooks[
                                                    symbol
                                                ].bids
                                            )
                                            .map(
                                                x => [
                                                    x[0],
                                                    x[1]
                                                ]
                                            )
                                            .sort(
                                                (a, b) =>
                                                    Number(b[0]) -
                                                    Number(a[0])
                                            )
                                            .slice(
                                                0,
                                                CONFIG.bookLevels
                                            );


                                        const asks =
                                            Object.entries(
                                                coinbaseBooks[
                                                    symbol
                                                ].asks
                                            )
                                            .map(
                                                x => [
                                                    x[0],
                                                    x[1]
                                                ]
                                            )
                                            .sort(
                                                (a, b) =>
                                                    Number(a[0]) -
                                                    Number(b[0])
                                            )
                                            .slice(
                                                0,
                                                CONFIG.bookLevels
                                            );


                                        updateBook(

                                            symbol,

                                            bids,

                                            asks,

                                            "Coinbase"

                                        );

                                    }
                                );

                        }

                    }
                );

            }
            catch (error) {

                console.error(
                    "Coinbase error",
                    error
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
                "coinbase",
                connectCoinbase
            );

        };

    }
    catch (error) {

        setExchangeStatus(
            "Coinbase",
            false
        );

        scheduleReconnect(
            "coinbase",
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


            COINS.forEach(symbol => {

                const pair =
                    symbol.replace(
                        "USDT",
                        "_USDT"
                    );


                const time =
                    Math.floor(
                        Date.now() / 1000
                    );


                ws.send(
                    JSON.stringify({

                        time:
                            time,

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
                            time,

                        channel:
                            "spot.order_book",

                        event:
                            "subscribe",

                        payload:
                            [
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

                const message =
                    JSON.parse(
                        event.data
                    );


                if (
                    !message.result
                ) {

                    return;

                }


                if (
                    message.channel ===
                    "spot.trades"
                ) {

                    const list =
                        Array.isArray(
                            message.result
                        )
                            ? message.result
                            : [
                                message.result
                            ];


                    list.forEach(
                        tradeData => {

                            addTrade(

                                tradeData.currency_pair,

                                tradeData.price,

                                tradeData.amount,

                                tradeData.side,

                                "Gate.io"

                            );

                        }
                    );

                }


                if (
                    message.channel ===
                    "spot.order_book"
                ) {

                    const result =
                        Array.isArray(
                            message.result
                        )
                            ? message.result[0]
                            : message.result;


                    if (!result) {
                        return;
                    }


                    updateBook(

                        result.s ||
                        result.currency_pair,

                        result.bids || [],
                        result.asks || [],

                        "Gate.io"

                    );

                }

            }
            catch (error) {

                console.error(
                    "Gate error",
                    error
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
                "gate",
                connectGate
            );

        };

    }
    catch (error) {

        setExchangeStatus(
            "Gate.io",
            false
        );

        scheduleReconnect(
            "gate",
            connectGate
        );

    }

}


/* =========================================================
   STATS
========================================================= */

function updateStats() {

    const active =
        Object.values(
            market
        )
        .filter(
            m =>
                m.price > 0
        )
        .length;


    const set =
        (id, value) => {

            const element =
                document.getElementById(
                    id
                );

            if (element) {

                element.textContent =
                    value;

            }

        };


    set(
        "activeCoins",
        active
    );


    set(
        "totalMessages",
        totalMessages.toLocaleString(
            "tr-TR"
        )
    );


    set(
        "totalTrades",
        totalTrades.toLocaleString(
            "tr-TR"
        )
    );


    set(
        "totalBooks",
        totalBooks.toLocaleString(
            "tr-TR"
        )
    );

}


/* =========================================================
   SELECTED COIN
========================================================= */

function renderSelected() {

    const m =
        market[selectedCoin];

    if (!m) {
        return;
    }


    const set =
        (id, value) => {

            const element =
                document.getElementById(
                    id
                );

            if (element) {

                element.textContent =
                    value;

            }

        };


    set(
        "momentum5",
        `${m.momentum5 >= 0 ? "+" : ""}${m.momentum5.toFixed(3)}%`
    );


    set(
        "momentum15",
        `${m.momentum15 >= 0 ? "+" : ""}${m.momentum15.toFixed(3)}%`
    );


    set(
        "detailPressure",
        `${m.pressure.toFixed(1)}%`
    );


    const bids =
        document.getElementById(
            "bids"
        );


    const asks =
        document.getElementById(
            "asks"
        );


    const renderRow =
        level => {

            return `
                <div class="book-row">
                    <span>${Number(level[0]).toFixed(6)}</span>
                    <span>${Number(level[1]).toFixed(4)}</span>
                </div>
            `;

        };


    if (bids) {

        bids.innerHTML =
            m.bids
                .map(renderRow)
                .join("");

    }


    if (asks) {

        asks.innerHTML =
            m.asks
                .map(renderRow)
                .join("");

    }

}


/* =========================================================
   TABLE
========================================================= */

function renderTable() {

    const body =
        document.querySelector(
            "#marketTable tbody"
        ) ||
        document.getElementById(
            "marketBody"
        );


    if (!body) {
        return;
    }


    const input =
        document.getElementById(
            "coinSearch"
        );


    const query =
        input
            ? input.value
                .trim()
                .toUpperCase()
            : "";


    body.innerHTML =
        Object.values(
            market
        )
        .filter(
            m =>
                !query ||
                m.symbol.includes(
                    query
                )
        )
        .map(
            m => {

                return `
                    <tr
                        data-symbol="${m.symbol}"
                    >
                        <td>
                            ${m.symbol.replace(
                                "USDT",
                                ""
                            )}
                        </td>

                        <td>
                            ${
                                m.price
                                    ? m.price.toFixed(6)
                                    : "-"
                            }
                        </td>

                        <td>
                            ${m.momentum5.toFixed(3)}%
                        </td>

                        <td>
                            ${m.signalText}
                        </td>

                        <td>
                            ${m.signal.toFixed(1)}
                        </td>

                        <td>
                            ${m.pressure.toFixed(1)}%
                        </td>

                        <td>
                            ${
                                m.trades.filter(
                                    t =>
                                        Date.now() -
                                        t.time <
                                        1000
                                ).length
                            }
                        </td>
                    </tr>
                `;

            }
        )
        .join("");


    body
        .querySelectorAll(
            "tr[data-symbol]"
        )
        .forEach(row => {

            row.onclick = () => {

                selectedCoin =
                    row.dataset.symbol;

                renderSelected();

            };

        });

}


/* =========================================================
   SEARCH
========================================================= */

function setupSearch() {

    const input =
        document.getElementById(
            "coinSearch"
        );


    if (!input) {
        return;
    }


    input.addEventListener(
        "input",
        renderTable
    );

}


/* =========================================================
   CLEAR LOG
========================================================= */

function setupLogButton() {

    const button =
        document.getElementById(
            "clearLog"
        );


    if (!button) {
        return;
    }


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
   UPDATE
========================================================= */

function updateUI() {

    Object.values(
        market
    )
    .forEach(marketItem => {

        cleanup(
            marketItem
        );

        calculateSignal(
            marketItem
        );

    });


    updateStats();

    renderTable();

    renderSelected();


    EXCHANGES.forEach(
        updateExchangeUI
    );


    updateMainConnection();

}


/* =========================================================
   START
========================================================= */

function start() {

    console.log(
        "================================"
    );

    console.log(
        "COIN ANALİZ TERMİNALİ V7.1"
    );

    console.log(
        "MULTI EXCHANGE ENGINE"
    );

    console.log(
        "================================"
    );


    setupSearch();

    setupLogButton();

    updateUI();


    log(
        "V7.1 çoklu borsa motoru başlatılıyor..."
    );


    connectBinance();

    connectBybit();

    connectOKX();

    connectCoinbase();

    connectGate();


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
