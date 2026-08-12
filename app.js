"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V6
   REAL-TIME TRADE + ORDER BOOK + MOMENTUM
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
    tradeWindow: 15000,
    shortWindow: 5000,
    longWindow: 60000,
    bookLevels: 10,
    reconnectDelay: 3000,
    updateRate: 250
};

const market = {};

let socket = null;
let reconnectTimer = null;

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

let lastUpdate = Date.now();


/* =========================================================
   MARKET OBJECT
========================================================= */

for (const symbol of COINS) {

    if (EXCLUDED.has(symbol)) continue;

    market[symbol] = {

        symbol,

        price: 0,
        previousPrice: 0,

        trades: [],
        prices: [],

        bids: [],
        asks: [],

        buyVolume: 0,
        sellVolume: 0,

        score: 50,

        signal: "WAIT",

        momentum5s: 0,
        momentum15s: 0,
        momentum60s: 0,

        pressure: 50,
        bookPressure: 50,

        tradeSpeed: 0,

        volumeRatio: 1,

        lastTrade: 0,

        alert: false
    };
}


/* =========================================================
   HELPERS
========================================================= */

function setText(id, value) {

    const el = document.getElementById(id);

    if (el) {
        el.textContent = value;
    }
}


function priceFormat(value) {

    if (!value) return "-";

    if (value >= 1000)
        return value.toFixed(2);

    if (value >= 1)
        return value.toFixed(4);

    if (value >= 0.01)
        return value.toFixed(6);

    return value.toFixed(8);
}


function setConnection(text) {

    setText(
        "connectionStatus",
        text
    );

    setText(
        "connection",
        text
    );
}


/* =========================================================
   BINANCE URL
========================================================= */

function buildURL() {

    const streams = [];

    for (const symbol of COINS) {

        if (EXCLUDED.has(symbol)) continue;

        const s =
            symbol.toLowerCase();

        streams.push(
            `${s}@trade`
        );

        streams.push(
            `${s}@depth10@100ms`
        );
    }

    return (
        "wss://stream.binance.com:9443/stream?streams=" +
        streams.join("/")
    );
}


/* =========================================================
   CONNECTION
========================================================= */

function connect() {

    clearTimeout(
        reconnectTimer
    );

    setConnection(
        "Bağlanıyor..."
    );

    try {

        socket =
            new WebSocket(
                buildURL()
            );

    } catch (error) {

        console.error(error);

        setConnection(
            "Bağlantı Hatası"
        );

        scheduleReconnect();

        return;
    }


    socket.onopen = () => {

        console.log(
            "V6 Binance WebSocket connected"
        );

        setConnection(
            "GERÇEK ZAMANLI"
        );
    };


    socket.onmessage = event => {

        totalMessages++;

        try {

            const packet =
                JSON.parse(
                    event.data
                );

            const data =
                packet.data;

            if (!data) return;

            const symbol =
                String(
                    data.s || ""
                ).toUpperCase();

            if (!market[symbol]) return;

            if (
                data.e === "trade"
            ) {

                processTrade(
                    symbol,
                    data
                );
            }

            else if (
                data.e ===
                "depthUpdate"
            ) {

                processBook(
                    symbol,
                    data
                );
            }

        } catch (error) {

            console.error(
                "Stream parse error:",
                error
            );
        }
    };


    socket.onerror = error => {

        console.error(
            "WebSocket error:",
            error
        );

        setConnection(
            "Bağlantı Hatası"
        );
    };


    socket.onclose = () => {

        setConnection(
            "Yeniden Bağlanıyor..."
        );

        scheduleReconnect();
    };
}


/* =========================================================
   RECONNECT
========================================================= */

function scheduleReconnect() {

    clearTimeout(
        reconnectTimer
    );

    reconnectTimer =
        setTimeout(
            connect,
            CONFIG.reconnectDelay
        );
}


/* =========================================================
   TRADE PROCESSING
========================================================= */

function processTrade(
    symbol,
    data
) {

    const m =
        market[symbol];

    const price =
        Number(data.p);

    const quantity =
        Number(data.q);

    if (
        !Number.isFinite(price) ||
        !Number.isFinite(quantity)
    ) {
        return;
    }

    const time =
        Number(data.T) ||
        Date.now();

    m.previousPrice =
        m.price;

    m.price =
        price;

    m.lastTrade =
        time;


    const side =
        data.m
            ? "SELL"
            : "BUY";


    m.trades.push({

        time,

        price,

        quantity,

        side

    });


    m.prices.push({

        time,

        price

    });


    if (side === "BUY") {

        m.buyVolume +=
            quantity;

    } else {

        m.sellVolume +=
            quantity;
    }


    totalTrades++;

    cleanup(m);

    calculateSignal(m);
}


/* =========================================================
   ORDER BOOK
========================================================= */

function processBook(
    symbol,
    data
) {

    const m =
        market[symbol];


    m.bids =
        (data.bids || [])
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(
                x => ({
                    price:
                        Number(x[0]),

                    quantity:
                        Number(x[1])
                })
            );


    m.asks =
        (data.asks || [])
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(
                x => ({
                    price:
                        Number(x[0]),

                    quantity:
                        Number(x[1])
                })
            );


    totalBooks++;

    calculateSignal(m);
}


/* =========================================================
   CLEANUP
========================================================= */

function cleanup(m) {

    const now =
        Date.now();


    const tradeCutoff =
        now -
        CONFIG.longWindow;


    while (
        m.trades.length &&
        m.trades[0].time <
        tradeCutoff
    ) {

        const old =
            m.trades.shift();

        if (
            old.side === "BUY"
        ) {

            m.buyVolume -=
                old.quantity;

        } else {

            m.sellVolume -=
                old.quantity;
        }
    }


    const priceCutoff =
        now -
        CONFIG.longWindow;


    while (
        m.prices.length &&
        m.prices[0].time <
        priceCutoff
    ) {

        m.prices.shift();
    }
}


/* =========================================================
   MOMENTUM
========================================================= */

function momentum(
    prices,
    milliseconds
) {

    if (
        prices.length <
        2
    ) {
        return 0;
    }

    const cutoff =
        Date.now() -
        milliseconds;


    let first = null;


    for (
        const item of prices
    ) {

        if (
            item.time >=
            cutoff
        ) {

            first =
                item;

            break;
        }
    }


    const last =
        prices[
            prices.length - 1
        ];


    if (
        !first ||
        !last ||
        first.price <= 0
    ) {
        return 0;
    }


    return (
        (
            last.price -
            first.price
        ) /
        first.price
    ) * 100;
}


/* =========================================================
   SIGNAL ENGINE
========================================================= */

function calculateSignal(m) {

    let score = 50;


    /* -------------------------
       MOMENTUM
    ------------------------- */

    m.momentum5s =
        momentum(
            m.prices,
            CONFIG.shortWindow
        );


    m.momentum15s =
        momentum(
            m.prices,
            CONFIG.tradeWindow
        );


    m.momentum60s =
        momentum(
            m.prices,
            CONFIG.longWindow
        );


    score +=
        m.momentum5s *
        12;


    score +=
        m.momentum15s *
        7;


    score +=
        m.momentum60s *
        3;


    /* -------------------------
       BUY / SELL PRESSURE
    ------------------------- */

    const volume =
        m.buyVolume +
        m.sellVolume;


    if (
        volume > 0
    ) {

        m.pressure =
            (
                m.buyVolume /
                volume
            ) * 100;


        score +=
            (
                m.pressure -
                50
            ) * 0.45;
    }


    /* -------------------------
       ORDER BOOK
    ------------------------- */

    let bids = 0;
    let asks = 0;


    for (
        const bid of m.bids
    ) {

        bids +=
            bid.quantity;
    }


    for (
        const ask of m.asks
    ) {

        asks +=
            ask.quantity;
    }


    if (
        bids + asks >
        0
    ) {

        m.bookPressure =
            (
                bids /
                (bids + asks)
            ) * 100;


        score +=
            (
                m.bookPressure -
                50
            ) * 0.35;
    }


    /* -------------------------
       TRADE SPEED
    ------------------------- */

    const recentTrades =
        m.trades.filter(
            t =>
                t.time >
                Date.now() -
                CONFIG.shortWindow
        );


    m.tradeSpeed =
        recentTrades.length;


    score +=
        Math.min(
            10,
            recentTrades.length /
            10
        );


    /* -------------------------
       FINAL SCORE
    ------------------------- */

    m.score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    /* -------------------------
       SIGNAL
    ------------------------- */

    if (
        m.score >= 85
    ) {

        m.signal =
            "STRONG BUY";

        m.alert = true;

    }

    else if (
        m.score >= 68
    ) {

        m.signal =
            "BUY";

        m.alert = false;

    }

    else if (
        m.score <= 15
    ) {

        m.signal =
            "STRONG SELL";

        m.alert = true;

    }

    else if (
        m.score <= 32
    ) {

        m.signal =
            "SELL";

        m.alert = false;

    }

    else {

        m.signal =
            "WAIT";

        m.alert = false;
    }
}


/* =========================================================
   TABLE
========================================================= */

function renderTable() {

    const tbody =
        document.querySelector(
            "#coinTable tbody"
        );

    if (!tbody) return;


    const list =
        Object.values(market)
            .sort(
                (a, b) =>
                    b.score -
                    a.score
            );


    tbody.innerHTML = "";


    for (
        const m of list
    ) {

        const row =
            document.createElement(
                "tr"
            );


        row.innerHTML = `

            <td>
                ${m.symbol.replace(
                    "USDT",
                    ""
                )}
            </td>

            <td>
                ${priceFormat(
                    m.price
                )}
            </td>

            <td>
                ${m.momentum5s >= 0
                    ? "+"
                    : ""
                }${m.momentum5s.toFixed(3)}%
            </td>

            <td>
                ${m.signal}
            </td>

            <td>
                ${m.score.toFixed(1)}
            </td>

            <td>
                ${m.pressure.toFixed(1)}%
            </td>

            <td>
                ${m.tradeSpeed}
            </td>

        `;


        tbody.appendChild(row);
    }
}


/* =========================================================
   GLOBAL UI
========================================================= */

function updateUI() {

    const active =
        Object.values(market)
            .filter(
                m =>
                    m.price > 0
            )
            .length;


    setText(
        "activeCoins",
        active
    );


    setText(
        "totalMessages",
        totalMessages
    );


    setText(
        "totalTrades",
        totalTrades
    );


    setText(
        "totalBooks",
        totalBooks
    );


    renderTable();
}


/* =========================================================
   START
========================================================= */

function start() {

    console.log(
        "COIN ANALİZ TERMİNALİ V6"
    );


    setConnection(
        "Bağlanıyor..."
    );


    connect();


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

} else {

    start();
}
