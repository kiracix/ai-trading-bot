"use strict";

/* =========================================================
   COIN ANALİZ TERMİNALİ V7
   TREND + MOMENTUM + TRADE + ORDER BOOK
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

    reconnectDelay: 3000,

    updateRate: 500,

    signalBuy: 68,
    signalStrongBuy: 82,

    signalSell: 32,
    signalStrongSell: 18
};

const market = {};

let socket = null;
let reconnectTimer = null;

let selectedCoin = "BTCUSDT";

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;


/* =========================================================
   MARKET
========================================================= */

COINS.forEach(symbol => {

    if (EXCLUDED.has(symbol)) return;

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

        signalStrength: "NORMAL",

        momentum5s: 0,
        momentum15s: 0,

        pressure: 50,

        bookPressure: 50,

        tradeSpeed: 0,

        trend: 50,

        lastTradeTime: 0
    };
});


/* =========================================================
   YARDIMCI
========================================================= */

function setText(id, value) {

    const element =
        document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


function setConnection(text, state = "normal") {

    setText(
        "connectionStatus",
        text
    );

    const dot =
        document.getElementById(
            "connectionDot"
        );

    if (!dot) return;

    if (state === "good") {
        dot.style.color = "#19e68c";
    }

    else if (state === "bad") {
        dot.style.color = "#ff4d67";
    }

    else {
        dot.style.color = "#ffd34d";
    }
}


function logMessage(message) {

    const log =
        document.getElementById("log");

    if (!log) return;

    const line =
        document.createElement("div");

    line.className =
        "log-line";

    const time =
        new Date().toLocaleTimeString("tr-TR");

    line.innerHTML =
        `<span class="log-time">${time}</span>${message}`;

    log.prepend(line);

    while (log.children.length > 100) {
        log.removeChild(log.lastChild);
    }
}


function formatPrice(price) {

    if (!price) return "-";

    if (price >= 1000) {

        return price.toLocaleString(
            "en-US",
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );
    }

    if (price >= 1) {
        return price.toFixed(4);
    }

    if (price >= 0.01) {
        return price.toFixed(5);
    }

    return price.toFixed(8);
}


/* =========================================================
   MOMENTUM
========================================================= */

function calculateMomentum(m) {

    const now =
        Date.now();

    m.prices =
        m.prices.filter(
            item =>
                now - item.time <=
                CONFIG.longWindow
        );

    if (
        m.prices.length < 2 ||
        !m.price
    ) {
        m.momentum5s = 0;
        m.momentum15s = 0;
        return;
    }


    const fiveAgo =
        [...m.prices]
            .reverse()
            .find(
                item =>
                    now - item.time >=
                    CONFIG.shortWindow
            );


    const fifteenAgo =
        [...m.prices]
            .reverse()
            .find(
                item =>
                    now - item.time >=
                    CONFIG.mediumWindow
            );


    if (
        fiveAgo &&
        fiveAgo.price
    ) {

        m.momentum5s =
            (
                (m.price - fiveAgo.price) /
                fiveAgo.price
            ) * 100;
    }


    if (
        fifteenAgo &&
        fifteenAgo.price
    ) {

        m.momentum15s =
            (
                (m.price - fifteenAgo.price) /
                fifteenAgo.price
            ) * 100;
    }
}


/* =========================================================
   TRADE BASKISI
========================================================= */

function calculatePressure(m) {

    const total =
        m.buyVolume +
        m.sellVolume;

    if (total <= 0) {

        m.pressure = 50;

        return;
    }

    m.pressure =
        (
            m.buyVolume /
            total
        ) * 100;
}


/* =========================================================
   ORDER BOOK BASKISI
========================================================= */

function calculateBookPressure(m) {

    let bidVolume = 0;
    let askVolume = 0;


    m.bids.forEach(level => {

        bidVolume +=
            Number(level.quantity) || 0;
    });


    m.asks.forEach(level => {

        askVolume +=
            Number(level.quantity) || 0;
    });


    const total =
        bidVolume + askVolume;


    if (total <= 0) {

        m.bookPressure = 50;

        return;
    }


    m.bookPressure =
        (
            bidVolume /
            total
        ) * 100;
}


/* =========================================================
   TRADE HIZI
========================================================= */

function calculateTradeSpeed(m) {

    const now =
        Date.now();

    m.trades =
        m.trades.filter(
            trade =>
                now - trade.time <= 5000
        );


    m.tradeSpeed =
        m.trades.length / 5;
}


/* =========================================================
   TREND
========================================================= */

function calculateTrend(m) {

    let trend = 50;


    if (m.momentum5s > 0) {
        trend += 15;
    }

    else if (m.momentum5s < 0) {
        trend -= 15;
    }


    if (m.momentum15s > 0) {
        trend += 15;
    }

    else if (m.momentum15s < 0) {
        trend -= 15;
    }


    if (m.pressure > 55) {
        trend += 10;
    }

    else if (m.pressure < 45) {
        trend -= 10;
    }


    m.trend =
        Math.max(
            0,
            Math.min(
                100,
                trend
            )
        );
}


/* =========================================================
   V7 SİNYAL MOTORU
========================================================= */

function calculateSignal(m) {

    /*
       Ağırlıklar:

       Momentum 5 sn     = %25
       Momentum 15 sn    = %20
       Trade baskısı     = %25
       Order book        = %20
       Trend             = %10
    */


    const momentum5 =
        normalizeMomentum(
            m.momentum5s
        );


    const momentum15 =
        normalizeMomentum(
            m.momentum15s
        );


    const tradePressure =
        m.pressure;


    const bookPressure =
        m.bookPressure;


    const trend =
        m.trend;


    let score =

        momentum5 * 0.25 +

        momentum15 * 0.20 +

        tradePressure * 0.25 +

        bookPressure * 0.20 +

        trend * 0.10;


    score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    m.score =
        score;


    if (
        score >=
        CONFIG.signalStrongBuy
    ) {

        m.signal =
            "BUY";

        m.signalStrength =
            "STRONG";
    }

    else if (
        score >=
        CONFIG.signalBuy
    ) {

        m.signal =
            "BUY";

        m.signalStrength =
            "NORMAL";
    }

    else if (
        score <=
        CONFIG.signalStrongSell
    ) {

        m.signal =
            "SELL";

        m.signalStrength =
            "STRONG";
    }

    else if (
        score <=
        CONFIG.signalSell
    ) {

        m.signal =
            "SELL";

        m.signalStrength =
            "NORMAL";
    }

    else {

        m.signal =
            "WAIT";

        m.signalStrength =
            "NORMAL";
    }
}


/* =========================================================
   MOMENTUM NORMALİZASYONU
========================================================= */

function normalizeMomentum(value) {

    /*
       -1%  -> 0
        0%  -> 50
       +1%  -> 100

       Aşırı hareketler sınırlandırılır.
    */

    const limited =
        Math.max(
            -1,
            Math.min(
                1,
                value
            )
        );


    return (
        (limited + 1) *
        50
    );
}


/* =========================================================
   TRADE
========================================================= */

function handleTrade(data) {

    const symbol =
        data.s;

    if (!market[symbol]) {
        return;
    }


    const m =
        market[symbol];


    const price =
        Number(data.p);


    const quantity =
        Number(data.q);


    if (
        !price ||
        !quantity
    ) {
        return;
    }


    m.previousPrice =
        m.price;


    m.price =
        price;


    const buyerIsMaker =
        data.m;


    if (buyerIsMaker) {

        m.sellVolume +=
            quantity;
    }

    else {

        m.buyVolume +=
            quantity;
    }


    m.trades.push({

        time:
            Date.now(),

        price,

        quantity,

        buy:
            !buyerIsMaker
    });


    m.prices.push({

        time:
            Date.now(),

        price
    });


    totalTrades++;


    m.lastTradeTime =
        Date.now();


    calculateMomentum(m);

    calculatePressure(m);

    calculateTradeSpeed(m);

    calculateTrend(m);

    calculateSignal(m);
}


/* =========================================================
   ORDER BOOK
========================================================= */

function handleDepth(data) {

    const symbol =
        data.s;

    if (!market[symbol]) {
        return;
    }


    const m =
        market[symbol];


    m.bids =
        (data.b || [])
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(level => ({

                price:
                    Number(level[0]),

                quantity:
                    Number(level[1])
            }));


    m.asks =
        (data.a || [])
            .slice(
                0,
                CONFIG.bookLevels
            )
            .map(level => ({

                price:
                    Number(level[0]),

                quantity:
                    Number(level[1])
            }));


    calculateBookPressure(m);

    calculateTrend(m);

    calculateSignal(m);


    totalBooks++;
}


/* =========================================================
   WEBSOCKET
========================================================= */

function connect() {

    if (socket) {

        try {
            socket.close();
        }

        catch (error) {}
    }


    const streams = [];


    COINS.forEach(symbol => {

        if (EXCLUDED.has(symbol)) {
            return;
        }


        const coin =
            symbol.toLowerCase();


        streams.push(
            `${coin}@trade`
        );


        streams.push(
            `${coin}@depth10@100ms`
        );

    });


    const url =
        "wss://stream.binance.com:9443/stream?streams=" +
        streams.join("/");


    setConnection(
        "Bağlanıyor..."
    );


    socket =
        new WebSocket(url);


    socket.onopen = () => {

        setConnection(
            "Canlı",
            "good"
        );


        logMessage(
            "V7 Binance bağlantısı kuruldu."
        );
    };


    socket.onmessage = event => {

        totalMessages++;


        try {

            const packet =
                JSON.parse(
                    event.data
                );


            if (!packet.data) {
                return;
            }


            const data =
                packet.data;


            if (
                data.e === "trade"
            ) {

                handleTrade(data);
            }


            else if (
                data.e === "depthUpdate"
            ) {

                handleDepth(data);
            }

        }

        catch (error) {

            console.error(
                "Veri işleme hatası:",
                error
            );
        }
    };


    socket.onerror = () => {

        setConnection(
            "Bağlantı hatası",
            "bad"
        );


        logMessage(
            "WebSocket bağlantı hatası."
        );
    };


    socket.onclose = () => {

        setConnection(
            "Yeniden bağlanıyor...",
            "bad"
        );


        logMessage(
            "Bağlantı kapandı."
        );


        scheduleReconnect();
    };
}


/* =========================================================
   RECONNECT
========================================================= */

function scheduleReconnect() {

    if (reconnectTimer) {
        return;
    }


    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer =
                    null;

                connect();

            },
            CONFIG.reconnectDelay
        );
}


/* =========================================================
   SİNYAL RENK
========================================================= */

function signalClass(signal) {

    if (signal === "BUY") {
        return "buy";
    }


    if (signal === "SELL") {
        return "sell";
    }


    return "wait";
}


/* =========================================================
   TABLO
========================================================= */

function renderTable() {

    const tbody =
        document.getElementById(
            "coinTableBody"
        );


    if (!tbody) {
        return;
    }


    const search =
        (
            document.getElementById(
                "coinSearch"
            )?.value || ""
        ).toUpperCase();


    tbody.innerHTML = "";


    Object.values(market)

        .filter(
            m =>
                m.symbol.includes(
                    search
                )
        )

        .sort(
            (a, b) =>
                b.score - a.score
        )

        .forEach(m => {

            const row =
                document.createElement(
                    "tr"
                );


            row.className =
                "coin-row" +
                (
                    selectedCoin ===
                    m.symbol
                        ? " selected"
                        : ""
                );


            const momentumClass =
                m.momentum5s >= 0
                    ? "green"
                    : "red";


            row.innerHTML = `

                <td class="coin-name">
                    ${m.symbol.replace(
                        "USDT",
                        ""
                    )}
                </td>

                <td class="price">
                    ${formatPrice(
                        m.price
                    )}
                </td>

                <td class="${momentumClass}">
                    ${m.momentum5s >= 0
                        ? "+"
                        : ""}
                    ${m.momentum5s.toFixed(3)}%
                </td>

                <td>
                    <span class="signal ${signalClass(
                        m.signal
                    )}">
                        ${m.signal}
                    </span>
                </td>

                <td>
                    ${m.score.toFixed(1)}
                </td>

                <td>
                    ${m.pressure.toFixed(1)}%
                </td>

                <td>
                    ${m.tradeSpeed.toFixed(1)}
                </td>

            `;


            row.addEventListener(
                "click",
                () => {

                    selectedCoin =
                        m.symbol;

                    renderTable();

                    renderSelected();
                }
            );


            tbody.appendChild(row);

        });
}


/* =========================================================
   SEÇİLİ COIN
========================================================= */

function renderSelected() {

    const m =
        market[selectedCoin];


    if (!m) {
        return;
    }


    setText(
        "selectedCoin",
        m.symbol.replace(
            "USDT",
            "/USDT"
        )
    );


    setText(
        "detailPrice",
        formatPrice(
            m.price
        )
    );


    setText(
        "signalScore",
        `Skor: ${m.score.toFixed(1)} / 100`
    );


    setText(
        "momentum5",
        `${m.momentum5s >= 0
            ? "+"
            : ""}${m.momentum5s.toFixed(3)}%`
    );


    setText(
        "momentum15",
        `${m.momentum15s >= 0
            ? "+"
            : ""}${m.momentum15s.toFixed(3)}%`
    );


    setText(
        "detailPressure",
        `${m.pressure.toFixed(1)}%`
    );


    const signal =
        document.getElementById(
            "bigSignal"
        );


    if (signal) {

        signal.textContent =
            m.signal;

        signal.className =
            `signal ${signalClass(
                m.signal
            )}`;
    }


    renderBook(m);
}


/* =========================================================
   ORDER BOOK UI
========================================================= */

function renderBook(m) {

    const bids =
        document.getElementById(
            "bids"
        );


    const asks =
        document.getElementById(
            "asks"
        );


    if (!bids || !asks) {
        return;
    }


    bids.innerHTML = "";

    asks.innerHTML = "";


    m.bids.forEach(level => {

        const div =
            document.createElement(
                "div"
            );


        div.className =
            "book-line";


        div.innerHTML = `

            <span>
                ${formatPrice(
                    level.price
                )}
            </span>

            <span>
                ${level.quantity.toFixed(4)}
            </span>

        `;


        bids.appendChild(div);
    });


    m.asks.forEach(level => {

        const div =
            document.createElement(
                "div"
            );


        div.className =
            "book-line";


        div.innerHTML = `

            <span>
                ${formatPrice(
                    level.price
                )}
            </span>

            <span>
                ${level.quantity.toFixed(4)}
            </span>

        `;


        asks.appendChild(div);
    });
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


    Object.values(market)
        .forEach(m => {

            calculateMomentum(m);

            calculatePressure(m);

            calculateBookPressure(m);

            calculateTradeSpeed(m);

            calculateTrend(m);

            calculateSignal(m);
        });


    renderTable();

    renderSelected();
}


/* =========================================================
   ARAMA
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
   LOG TEMİZLE
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

            const log =
                document.getElementById(
                    "log"
                );


            if (log) {
                log.innerHTML = "";
            }

        }
    );
}


/* =========================================================
   START
========================================================= */

function start() {

    console.log(
        "COIN ANALİZ TERMİNALİ V7 BAŞLATILDI"
    );


    setupSearch();

    setupLogButton();

    renderTable();

    renderSelected();

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

}

else {

    start();
}
