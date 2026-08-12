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
    shortWindow: 5000,
    mediumWindow: 15000,
    longWindow: 60000,
    bookLevels: 10,
    reconnectDelay: 3000,
    updateRate: 500
};

const market = {};

let socket = null;
let reconnectTimer = null;
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

        pressure: 50,
        tradeSpeed: 0,

        lastTradeTime: 0
    };
});


/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function setText(id, value) {

    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


function setConnection(text, state = "normal") {

    setText("connectionStatus", text);

    const dot =
        document.getElementById("connectionDot");

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

    line.className = "log-line";

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

    if (!price) {
        return "-";
    }

    if (price >= 1000) {

        return price.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
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

    const now = Date.now();

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


    const fiveSecond =
        [...m.prices]
            .reverse()
            .find(
                item =>
                    now - item.time >=
                    CONFIG.shortWindow
            );


    const fifteenSecond =
        [...m.prices]
            .reverse()
            .find(
                item =>
                    now - item.time >=
                    CONFIG.mediumWindow
            );


    if (
        fiveSecond &&
        fiveSecond.price
    ) {

        m.momentum5s =
            (
                (m.price - fiveSecond.price) /
                fiveSecond.price
            ) * 100;
    }


    if (
        fifteenSecond &&
        fifteenSecond.price
    ) {

        m.momentum15s =
            (
                (m.price - fifteenSecond.price) /
                fifteenSecond.price
            ) * 100;
    }
}


/* =========================================================
   ALIŞ / SATIŞ BASKISI
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
   SİNYAL SKORU
========================================================= */

function calculateSignal(m) {

    let score = 50;


    score +=
        m.momentum5s * 12;


    score +=
        m.momentum15s * 7;


    score +=
        (m.pressure - 50) * 0.45;


    score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    m.score = score;


    if (score >= 68) {

        m.signal = "BUY";

    }

    else if (score <= 32) {

        m.signal = "SELL";

    }

    else {

        m.signal = "WAIT";
    }
}


/* =========================================================
   TRADE HIZI
========================================================= */

function calculateTradeSpeed(m) {

    const now = Date.now();

    m.trades =
        m.trades.filter(
            trade =>
                now - trade.time <= 5000
        );


    m.tradeSpeed =
        m.trades.length / 5;
}


/* =========================================================
   TRADE VERİSİ
========================================================= */

function handleTrade(data) {

    const symbol = data.s;

    if (!market[symbol]) {
        return;
    }

    const m = market[symbol];

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

        time: Date.now(),

        price: price,

        quantity: quantity,

        buy: !buyerIsMaker
    });


    m.prices.push({

        time: Date.now(),

        price: price
    });


    totalTrades++;


    m.lastTradeTime =
        Date.now();


    calculateMomentum(m);

    calculatePressure(m);

    calculateSignal(m);

    calculateTradeSpeed(m);
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


    totalBooks++;
}


/* =========================================================
   WEBSOCKET BAĞLANTISI
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
            "Binance WebSocket bağlantısı kuruldu."
        );
    };


    socket.onmessage = event => {

        totalMessages++;


        try {

            const packet =
                JSON.parse(event.data);


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
   YENİDEN BAĞLAN
========================================================= */

function scheduleReconnect() {

    if (reconnectTimer) {
        return;
    }


    reconnectTimer =
        setTimeout(() => {

            reconnectTimer = null;

            connect();

        }, CONFIG.reconnectDelay);
}


/* =========================================================
   SİNYAL RENGİ
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
                m.symbol.includes(search)
        )

        .sort(
            (a, b) =>
                b.score - a.score
        )

        .forEach(m => {

            const row =
                document.createElement("tr");


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
                    ${m.symbol.replace("USDT", "")}
                </td>

                <td class="price">
                    ${formatPrice(m.price)}
                </td>

                <td class="${momentumClass}">
                    ${m.momentum5s >= 0 ? "+" : ""}
                    ${m.momentum5s.toFixed(3)}%
                </td>

                <td>
                    <span class="signal ${signalClass(m.signal)}">
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
        formatPrice(m.price)
    );


    setText(
        "signalScore",
        `Skor: ${m.score.toFixed(1)} / 100`
    );


    setText(
        "momentum5",
        `${m.momentum5s >= 0 ? "+" : ""}${m.momentum5s.toFixed(3)}%`
    );


    setText(
        "momentum15",
        `${m.momentum15s >= 0 ? "+" : ""}${m.momentum15s.toFixed(3)}%`
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
            `signal ${signalClass(m.signal)}`;
    }


    renderBook(m);
}


/* =========================================================
   ORDER BOOK GÖRÜNÜMÜ
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
            document.createElement("div");


        div.className =
            "book-line";


        div.innerHTML = `
            <span>
                ${formatPrice(level.price)}
            </span>

            <span>
                ${level.quantity.toFixed(4)}
            </span>
        `;


        bids.appendChild(div);
    });


    m.asks.forEach(level => {

        const div =
            document.createElement("div");


        div.className =
            "book-line";


        div.innerHTML = `
            <span>
                ${formatPrice(level.price)}
            </span>

            <span>
                ${level.quantity.toFixed(4)}
            </span>
        `;


        asks.appendChild(div);
    });
}


/* =========================================================
   GENEL GÜNCELLEME
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

            calculateSignal(m);

            calculateTradeSpeed(m);
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
   BAŞLAT
========================================================= */

function start() {

    console.log(
        "COIN ANALİZ TERMİNALİ V6 BAŞLATILDI"
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
