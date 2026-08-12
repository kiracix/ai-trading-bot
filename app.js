"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V7
   MULTI EXCHANGE MARKET ENGINE

   Binance
   Bybit
   OKX
   Coinbase
   Gate.io
========================================================= */


/* =========================================================
   EXCLUDED COINS
========================================================= */

const EXCLUDED = new Set([
    "RIZOUSDT",
    "VANRYUSDT"
]);


/* =========================================================
   COINS
========================================================= */

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
   CONFIG
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

    if (EXCLUDED.has(symbol)) {
        return;
    }

    market[symbol] = {

        symbol,

        price: 0,

        previousPrice: 0,

        prices: [],

        trades: [],

        bids: [],

        asks: [],

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
   EXCHANGE STATISTICS
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
   GLOBAL COUNTERS
========================================================= */

let totalMessages = 0;

let totalTrades = 0;

let totalBooks = 0;

let selectedCoin = "BTCUSDT";


/* =========================================================
   SOCKETS
========================================================= */

const sockets = {};


/* =========================================================
   HELPERS
========================================================= */

function normalizeSymbol(symbol) {

    if (!symbol) {
        return null;
    }

    return String(symbol)
        .toUpperCase()
        .replace(/[-_]/g, "");
}


function getMarket(symbol) {

    const normalized =
        normalizeSymbol(symbol);

    if (!normalized) {
        return null;
    }

    if (EXCLUDED.has(normalized)) {
        return null;
    }

    return market[normalized] || null;
}


function currentTime() {

    return Date.now();

}


/* =========================================================
   EXCHANGE KEY
========================================================= */

function getExchangeKey(exchange) {

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
   EXCHANGE COUNTER
========================================================= */

function updateExchangeCounter(exchange) {

    const key =
        getExchangeKey(exchange);

    if (!key) {
        return;
    }

    const counter =
        document.getElementById(
            `${key}Messages`
        );

    if (!counter) {
        return;
    }

    const stats =
        exchangeStats[exchange];

    if (!stats) {
        return;
    }

    counter.textContent =
        stats.messages.toLocaleString(
            "tr-TR"
        );
}


/* =========================================================
   EXCHANGE STATUS UI
========================================================= */

function updateExchangeStatusUI(exchange) {

    const key =
        getExchangeKey(exchange);

    if (!key) {
        return;
    }

    const stats =
        exchangeStats[exchange];

    if (!stats) {
        return;
    }

    const status =
        document.getElementById(
            `${key}Status`
        );

    const dot =
        document.getElementById(
            `${key}Dot`
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

    updateExchangeCounter(exchange);
}


/* =========================================================
   UPDATE EXCHANGE MESSAGE
========================================================= */

function countExchangeMessage(exchange) {

    if (!exchangeStats[exchange]) {
        return;
    }

    exchangeStats[exchange].messages++;

    updateExchangeCounter(exchange);
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

    if (!m) {
        return;
    }

    price =
        Number(price);

    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {
        return;
    }

    m.previousPrice =
        m.price;

    m.price =
        price;

    m.lastUpdate =
        currentTime();

    m.prices.push({

        time: currentTime(),

        price: price

    });

    m.exchanges[exchange] = {

        price: price,

        time: currentTime()

    };

    cleanup(m);

    totalMessages++;

    countExchangeMessage(exchange);
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

    if (!m) {
        return;
    }

    price =
        Number(price);

    quantity =
        Number(quantity);

    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {
        return;
    }

    m.trades.push({

        time: currentTime(),

        price: price,

        quantity:
            Number.isFinite(quantity)
                ? quantity
                : 0,

        side: side || "unknown",

        exchange: exchange

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

    const m =
        getMarket(symbol);

    if (!m) {
        return;
    }

    m.bids =
        Array.isArray(bids)
            ? bids.slice(
                0,
                CONFIG.bookLevels
            )
            : [];

    m.asks =
        Array.isArray(asks)
            ? asks.slice(
                0,
                CONFIG.bookLevels
            )
            : [];

    totalBooks++;

    countExchangeMessage(exchange);

    calculatePressure(m);
}


/* =========================================================
   CLEANUP
========================================================= */

function cleanup(m) {

    const limit =
        currentTime() -
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
}


/* =========================================================
   MOMENTUM
========================================================= */

function calculateMomentum(m) {

    const current =
        m.price;

    if (
        !current ||
        !m.prices.length
    ) {

        m.momentum5 = 0;

        m.momentum15 = 0;

        return;
    }

    const time =
        currentTime();

    let old5 = null;

    let old15 = null;

    for (
        let i = m.prices.length - 1;
        i >= 0;
        i--
    ) {

        const item =
            m.prices[i];

        if (
            !old5 &&
            time - item.time >=
            CONFIG.shortWindow
        ) {

            old5 = item;
        }

        if (
            !old15 &&
            time - item.time >=
            CONFIG.mediumWindow
        ) {

            old15 = item;
        }

        if (old5 && old15) {
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
}


/* =========================================================
   PRESSURE
========================================================= */

function calculatePressure(m) {

    let bidVolume = 0;

    let askVolume = 0;


    m.bids.forEach(level => {

        if (!level) {
            return;
        }

        const quantity =
            Number(level[1]);

        if (
            Number.isFinite(quantity)
        ) {

            bidVolume +=
                quantity;

        }

    });


    m.asks.forEach(level => {

        if (!level) {
            return;
        }

        const quantity =
            Number(level[1]);

        if (
            Number.isFinite(quantity)
        ) {

            askVolume +=
                quantity;

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
   SIGNAL
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
                    symbol =>
                        !EXCLUDED.has(symbol)
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


        const url =
            `wss://stream.binance.com:9443/stream?streams=${streams}`;


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

                if (!d) {
                    return;
                }


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


                if (
                    d.e ===
                    "depthUpdate"
                ) {

                    updateBook(

                        d.s,

                        d.b || [],

                        d.a || [],

                        "Binance"

                    );

                }

            }
            catch (error) {

                console.error(
                    "Binance parse error",
                    error
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
    catch (error) {

        console.error(
            "Binance connection error",
            error
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

                if (
                    EXCLUDED.has(symbol)
                ) {
                    return;
                }

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

                    args: args

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
                    !msg.topic
                ) {
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
                        !Array.isArray(data)
                    ) {
                        return;
                    }


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


                if (
                    msg.topic.startsWith(
                        "orderbook."
                    )
                ) {

                    if (!data) {
                        return;
                    }


                    updateBook(

                        data.s,

                        data.b || [],

                        data.a || [],

                        "Bybit"

                    );

                }

            }
            catch (error) {

                console.error(
                    "Bybit parse error",
                    error
                );

            }

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


        ws.onerror = () => {

            setExchangeStatus(
                "Bybit",
                false
            );

        };

    }
    catch (error) {

        console.error(
            "Bybit connection error",
            error
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

                if (
                    EXCLUDED.has(symbol)
                ) {
                    return;
                }


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

                    op: "subscribe",

                    args: args

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
                ) {
                    return;
                }


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


                if (
                    msg.arg.channel ===
                    "books5"
                ) {

                    const book =
                        msg.data[0];


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
                    "OKX parse error",
                    error
                );

            }

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


        ws.onerror = () => {

            setExchangeStatus(
                "OKX",
                false
            );

        };

    }
    catch (error) {

        console.error(
            "OKX connection error",
            error
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
                        symbol =>
                            !EXCLUDED.has(symbol)
                    )
                    .map(
                        symbol =>
                            symbol.replace(
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
                ) {
                    return;
                }


                msg.events.forEach(ev => {

                    if (
                        !ev.trades
                    ) {
                        return;
                    }


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
            catch (error) {

                console.error(
                    "Coinbase parse error",
                    error
                );

            }

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


        ws.onerror = () => {

            setExchangeStatus(
                "Coinbase",
                false
            );

        };

    }
    catch (error) {

        console.error(
            "Coinbase connection error",
            error
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


            const now =
                Math.floor(
                    Date.now() / 1000
                );


            COINS.forEach(symbol => {

                if (
                    EXCLUDED.has(symbol)
                ) {
                    return;
                }


                const pair =
                    symbol.replace(
                        "USDT",
                        "_USDT"
                    );


                ws.send(
                    JSON.stringify({

                        time: now,

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

                        time: now,

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
                ) {
                    return;
                }


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
                        ) {
                            return;
                        }


                        const symbol =
                            t.currency_pair
                                .replace(
                                    "_",
                                    ""
                                );


                        addTrade(

                            symbol,

                            t.price,

                            t.amount,

                            t.side,

                            "Gate.io"

                        );

                    });

                }


                if (
                    msg.channel ===
                    "spot.order_book"
                ) {

                    const result =
                        msg.result;


                    if (!result) {
                        return;
                    }


                    const symbol =
                        result.s
                            ? result.s.replace(
                                "_",
                                ""
                            )
                            : null;


                    if (!symbol) {
                        return;
                    }


                    updateBook(

                        symbol,

                        result.bids || [],

                        result.asks || [],

                        "Gate.io"

                    );

                }

            }
            catch (error) {

                console.error(
                    "Gate.io parse error",
                    error
                );

            }

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


        ws.onerror = () => {

            setExchangeStatus(
                "Gate.io",
                false
            );

        };

    }
    catch (error) {

        console.error(
            "Gate.io connection error",
            error
        );

    }
}


/* =========================================================
   CONNECTION STATUS
========================================================= */

function setExchangeStatus(
    exchange,
    connected
) {

    console.log(
        exchange,
        connected
            ? "ONLINE"
            : "OFFLINE"
    );


    if (
        exchangeStats[exchange]
    ) {

        exchangeStats[exchange]
            .connected =
            connected;

    }


    updateExchangeStatusUI(
        exchange
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
            connected
                ? `${exchange} bağlı`
                : `${exchange} bağlantı bekleniyor`;

    }


    if (dot) {

        dot.textContent =
            connected
                ? "●"
                : "○";

    }

}


/* =========================================================
   CONNECT ALL
========================================================= */

function connect() {

    log(
        "Çoklu borsa bağlantıları başlatılıyor..."
    );


    connectBinance();

    connectBybit();

    connectOKX();

    connectCoinbase();

    connectGate();

}


/* =========================================================
   UPDATE UI
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


    Object.keys(exchangeStats)
        .forEach(exchange => {

            updateExchangeStatusUI(
                exchange
            );

        });

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
   SELECTED COIN
========================================================= */

function renderSelected() {

    const m =
        market[selectedCoin];


    if (!m) {
        return;
    }


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
   ORDER BOOK RENDER
========================================================= */

function renderOrderBook() {

    const m =
        market[selectedCoin];


    if (!m) {
        return;
    }


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
    ) {

        return;

    }


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
        () => {

            const value =
                input.value
                    .trim()
                    .toUpperCase();


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


                log(
                    `${selectedCoin} seçildi`
                );


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
        `[V7] ${message}`
    );


    const box =
        document.getElementById(
            "log"
        );


    if (!box) {
        return;
    }


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
   START
========================================================= */

function start() {

    console.log(
        "================================="
    );


    console.log(
        "COIN ANALİZ TERMİNALİ V7"
    );


    console.log(
        "MULTI EXCHANGE ENGINE"
    );


    console.log(
        "================================="
    );


    setupSearch();

    setupLogButton();

    renderSelected();

    renderOrderBook();


    setConnection(
        "Çoklu borsalara bağlanıyor..."
    );


    connect();


    setInterval(
        updateUI,
        CONFIG.updateRate
    );

}


/* =========================================================
   MAIN CONNECTION LABEL
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
   DOM READY
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
